// Offline tests for pi/extensions/file-guard.ts. Run: bun test pi/tests
// The last block runs the real claude-code/hooks/block-config-edit.sh.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fileGuard, {
	CLAUDE_SETTINGS,
	canonicalPath,
	checkRead,
	checkWrite,
	globToRegex,
	isPiGuardFile,
	loadReadDeny,
	matchesAny,
	resolveToolPath,
} from "../extensions/file-guard.ts";

const HOME = "/Users/me";

describe("resolveToolPath", () => {
	test("expands ~, strips @, resolves relative to cwd, normalizes", () => {
		expect(resolveToolPath("~/.ssh/id_rsa", "/w", HOME)).toBe("/Users/me/.ssh/id_rsa");
		expect(resolveToolPath("@src/a.ts", "/w", HOME)).toBe("/w/src/a.ts");
		expect(resolveToolPath("../x/./y", "/w/sub", HOME)).toBe("/w/x/y");
		expect(resolveToolPath("~", "/w", HOME)).toBe(HOME);
	});
});

describe("read deny rules", () => {
	const rules = ["**/.env*", "**/*secret*", "**/.wrangler/**", "~/.ssh/**", "~/.netrc", "~/Library/Application Support/turso/**"].map((g) =>
		globToRegex(g, HOME),
	);
	const denied = (p: string) => matchesAny(p, rules);

	test("basename globs match in any directory, case-insensitively", () => {
		expect(denied("/w/.env")).toBe(true);
		expect(denied("/w/app/.ENV.local")).toBe(true);
		expect(denied("/w/my-secret.txt")).toBe(true);
		expect(denied("/w/environment.ts")).toBe(false);
	});
	test("a denied directory covers everything below it", () => {
		expect(denied("/w/secrets/db.json")).toBe(true);
		expect(denied("/w/.wrangler/state/x")).toBe(true);
		expect(denied("/Users/me/.ssh")).toBe(true);
		expect(denied("/Users/me/.SSH/id_ed25519")).toBe(true);
		expect(denied("/Users/me/Library/Application Support/turso/db")).toBe(true);
	});
	test("~ rules are anchored at home", () => {
		expect(denied("/Users/me/.netrc")).toBe(true);
		expect(denied("/w/.netrc")).toBe(false);
		expect(denied("/tmp/.ssh/x")).toBe(false);
	});
	test("the real settings.json yields rules, including pi's auth.json", () => {
		const real = loadReadDeny(CLAUDE_SETTINGS, HOME);
		expect(matchesAny("/Users/me/.aws/credentials", real)).toBe(true);
		expect(matchesAny("/Users/me/.pi/agent/auth.json", real)).toBe(true);
		expect(matchesAny("/Users/me/dotfiles/README.md", real)).toBe(false);
	});
	test("a missing or ruleless settings file fails closed", () => {
		expect(() => loadReadDeny("/nonexistent/settings.json")).toThrow();
		const v = checkRead("/w/README.md", new Error("boom"));
		expect(v?.block).toBe(true);
	});
});

describe("pi guard files", () => {
	test("own guards, pi settings, and pi extension dirs are protected", () => {
		expect(isPiGuardFile("/r/pi/extensions/shguard.ts", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/r/PI/Extensions/File-Guard.ts", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/r/pi/settings.json", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/Users/me/.pi/agent/settings.json", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/Users/me/.pi/agent/extensions/x.ts", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/proj/.pi/extensions/x.ts", "/r/pi")).toBe(true);
		expect(isPiGuardFile("/r/pi/extensions/statusline.ts", "/r/pi")).toBe(false);
		expect(isPiGuardFile("/r/pi/AGENTS.md", "/r/pi")).toBe(false);
	});
});

describe("filesystem", () => {
	let dir: string;
	beforeAll(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-fg-")));
		mkdirSync(join(dir, "pi", "extensions"), { recursive: true });
		writeFileSync(join(dir, "pi", "settings.json"), "{}");
		symlinkSync(join(dir, "pi", "settings.json"), join(dir, "link.json"));
		symlinkSync(join(dir, "nowhere"), join(dir, "dangling"));
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const allow = async () => ({ code: 0, stderr: "" });

	test("canonicalPath follows symlinks and keeps a not-yet-existing tail", () => {
		expect(canonicalPath(join(dir, "link.json"))).toBe(join(dir, "pi", "settings.json"));
		expect(canonicalPath(join(dir, "new", "deep", "f.ts"))).toBe(join(dir, "new", "deep", "f.ts"));
		expect(canonicalPath(join(dir, "dangling"))).toBeUndefined();
	});
	test("writing through a symlink to a guard file is blocked", async () => {
		expect((await checkWrite(join(dir, "link.json"), allow, join(dir, "pi")))?.block).toBe(true);
		expect((await checkWrite(join(dir, "dangling"), allow, join(dir, "pi")))?.block).toBe(true);
		expect(await checkWrite(join(dir, "ok.ts"), allow, join(dir, "pi"))).toBeUndefined();
	});
	test("hook verdicts: exit 2 carries stderr, a crash or timeout blocks", async () => {
		const v = await checkWrite(join(dir, "ok.ts"), async () => ({ code: 2, stderr: "[BLOCKED: X] no" }), join(dir, "pi"));
		expect(v).toEqual({ block: true, reason: "[BLOCKED: X] no" });
		expect((await checkWrite(join(dir, "ok.ts"), async () => ({ code: null, stderr: "" }), join(dir, "pi")))?.block).toBe(true);
		expect((await checkWrite(join(dir, "ok.ts"), async () => ({ code: 1, stderr: "" }), join(dir, "pi")))?.block).toBe(true);
	});
});

describe("extension", () => {
	function handler(run = async () => ({ code: 0, stderr: "" })) {
		let h: Function | undefined;
		fileGuard({ on: (_e: string, fn: Function) => (h = fn) } as any, run);
		return (toolName: string, input: object) => h!({ toolName, input }, { cwd: "/w" });
	}

	test("other tools pass untouched", async () => {
		expect(await handler()("bash", { command: "cat .env" })).toBeUndefined();
	});
	test("read of a denied path is blocked, ordinary reads pass", async () => {
		const h = handler();
		expect((await h("read", { path: ".env" }))?.block).toBe(true);
		expect((await h("grep", { pattern: "x", path: "~/.aws" }))?.block).toBe(true);
		expect(await h("read", { path: "README.md" })).toBeUndefined();
		expect(await h("ls", {})).toBeUndefined();
	});
	test("write/edit without a string path is blocked", async () => {
		const h = handler();
		expect((await h("write", {}))?.block).toBe(true);
		expect((await h("edit", { path: 1 }))?.block).toBe(true);
	});
});

describe("real block-config-edit.sh", () => {
	test("blocks linter config and lockfiles, allows ordinary files", async () => {
		expect((await checkWrite("/tmp/pi-fg-proj/.eslintrc.json"))?.reason).toContain("CONFIG_PROTECTION");
		expect((await checkWrite("/tmp/pi-fg-proj/bun.lock"))?.reason).toContain("LOCKFILE_PROTECTION");
		expect((await checkWrite(`${CLAUDE_SETTINGS}`))?.reason).toContain("GUARDRAIL_PROTECTION");
		expect(await checkWrite("/tmp/pi-fg-proj/src/a.ts")).toBeUndefined();
	});
});
