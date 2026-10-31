// Offline tests for pi/extensions (no model calls). Run: bun test pi/tests
// Lives outside pi/extensions/ because pi loads every .ts file there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import gitCheckpoint, { createCheckpoint } from "../extensions/git-checkpoint.ts";
import usageLog, { costTotals, readMonth, summarize, toRecord } from "../extensions/usage-log.ts";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Minimal ExtensionAPI stand-in: records handlers and commands. */
function fakePi() {
	const handlers = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const api: any = {
		on: (ev: string, h: Function) => handlers.set(ev, [...(handlers.get(ev) ?? []), h]),
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
	};
	const emit = async (ev: string, payload: any, ctx: any) => {
		for (const h of handlers.get(ev) ?? []) await h(payload, ctx);
	};
	return { api, emit, commands };
}

function fakeCtx(cwd: string, sessionId = "test-session") {
	const notes: string[] = [];
	return {
		notes,
		ctx: {
			cwd,
			hasUI: true,
			sessionManager: { getSessionId: () => sessionId },
			ui: { notify: (t: string) => notes.push(t), setStatus: () => {}, confirm: async () => true },
		},
	};
}

describe("git-checkpoint", () => {
	let repo: string;
	beforeAll(() => {
		repo = mkdtempSync(join(tmpdir(), "pi-cp-test-"));
		sh(repo, "init", "-q");
		sh(repo, "config", "user.email", "t@example.com");
		sh(repo, "config", "user.name", "t");
		sh(repo, "config", "commit.gpgSign", "false");
		writeFileSync(join(repo, "a.txt"), "v1\n");
		writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
		sh(repo, "add", ".");
		sh(repo, "commit", "-qm", "init");
	});
	afterAll(() => rmSync(repo, { recursive: true, force: true }));

	test("snapshots tracked + untracked files without touching worktree, index, or stash", async () => {
		writeFileSync(join(repo, "a.txt"), "v2-staged\n");
		sh(repo, "add", "a.txt");
		writeFileSync(join(repo, "a.txt"), "v3-unstaged\n");
		writeFileSync(join(repo, "new.txt"), "untracked\n");
		writeFileSync(join(repo, "ignored.txt"), "secret\n");

		const statusBefore = sh(repo, "status", "--porcelain");
		const cachedBefore = sh(repo, "diff", "--cached");
		const headBefore = sh(repo, "rev-parse", "HEAD");

		const cp = await createCheckpoint(repo, "s1", "label");
		expect(cp?.n).toBe(1);
		expect(cp?.ref).toBe("refs/pi-checkpoints/s1/0001");

		expect(sh(repo, "status", "--porcelain")).toBe(statusBefore);
		expect(sh(repo, "diff", "--cached")).toBe(cachedBefore);
		expect(sh(repo, "rev-parse", "HEAD")).toBe(headBefore);
		expect(sh(repo, "stash", "list")).toBe("");

		expect(sh(repo, "show", `${cp!.sha}:a.txt`)).toBe("v3-unstaged");
		expect(sh(repo, "show", `${cp!.sha}:new.txt`)).toBe("untracked");
		expect(sh(repo, "ls-tree", "--name-only", cp!.sha)).not.toContain("ignored.txt");
		expect(sh(repo, "rev-parse", `${cp!.sha}^`)).toBe(headBefore);
	});

	test("skips when nothing changed, numbers the next one", async () => {
		expect(await createCheckpoint(repo, "s1", "same")).toBeUndefined();
		writeFileSync(join(repo, "new.txt"), "changed\n");
		expect((await createCheckpoint(repo, "s1", "next"))?.n).toBe(2);
	});

	test("outside a git repo: no-op", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-cp-norepo-"));
		try {
			expect(await createCheckpoint(dir, "s1", "x")).toBeUndefined();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("one checkpoint per prompt even with parallel mutating tool calls", async () => {
		const { api, emit, commands } = fakePi();
		gitCheckpoint(api);
		const { ctx, notes } = fakeCtx(repo, "s2");

		await emit("before_agent_start", { prompt: "do things" }, ctx);
		await emit("agent_start", {}, ctx);
		writeFileSync(join(repo, "a.txt"), "prompt1\n");
		await Promise.all([
			emit("tool_call", { toolName: "read" }, ctx),
			emit("tool_call", { toolName: "edit" }, ctx),
			emit("tool_call", { toolName: "bash" }, ctx),
		]);
		writeFileSync(join(repo, "a.txt"), "during-run\n");
		await emit("tool_call", { toolName: "write" }, ctx); // same prompt: no new checkpoint
		expect(sh(repo, "for-each-ref", "--format=%(refname)", "refs/pi-checkpoints/s2/")).toBe("refs/pi-checkpoints/s2/0001");

		await emit("agent_start", {}, ctx); // next prompt
		await emit("tool_call", { toolName: "edit" }, ctx);
		expect(sh(repo, "for-each-ref", "--format=%(refname)", "refs/pi-checkpoints/s2/").split("\n")).toHaveLength(2);
		expect(sh(repo, "log", "-1", "--format=%s", "refs/pi-checkpoints/s2/0001")).toBe("pi checkpoint 1: do things");

		await commands.get("checkpoints").handler("list", ctx);
		expect(notes.at(-1)).toContain("s2/0002");
		await commands.get("checkpoints").handler("restore 1", ctx);
		expect(notes.at(-1)).toContain("git restore --source=");
		expect(sh(repo, "status", "--porcelain")).toContain("a.txt"); // restore did not run
		await commands.get("checkpoints").handler("prune", ctx);
		expect(sh(repo, "for-each-ref", "--format=%(refname)", "refs/pi-checkpoints/")).not.toContain("/s1/");
		expect(sh(repo, "for-each-ref", "--format=%(refname)", "refs/pi-checkpoints/")).toContain("/s2/");
	});
});

describe("usage-log", () => {
	let dir: string;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-usage-test-"));
		process.env.PI_USAGE_LOG_DIR = dir;
	});
	afterAll(() => {
		delete process.env.PI_USAGE_LOG_DIR;
		rmSync(dir, { recursive: true, force: true });
	});

	const assistant = (cost: number) => ({
		role: "assistant",
		provider: "anthropic",
		model: "claude-haiku-5-5",
		stopReason: "stop",
		usage: {
			input: 1000,
			output: 200,
			cacheRead: 5000,
			cacheWrite: 300,
			totalTokens: 6500,
			cost: { input: cost / 2, output: cost / 2, cacheRead: 0, cacheWrite: 0, total: cost },
		},
	});

	test("ignores non-assistant messages", () => {
		expect(toRecord({ turnIndex: 0, message: { role: "user" } }, "s", "/")).toBeUndefined();
	});

	test("turn_end appends a JSONL record; /usage summarizes", async () => {
		const { api, emit, commands } = fakePi();
		usageLog(api);
		const { ctx, notes } = fakeCtx("/work", "sess-A");
		await emit("turn_end", { turnIndex: 0, message: assistant(0.01), toolResults: [] }, ctx);
		await emit(
			"turn_end",
			{ turnIndex: 1, message: assistant(0.02), toolResults: [{ usage: { totalTokens: 10, cost: { total: 0.005 } } }] },
			ctx,
		);
		await emit("turn_end", { turnIndex: 2, message: { role: "toolResult" } }, ctx);

		const recs = readMonth(new Date());
		expect(recs).toHaveLength(2);
		expect(recs[1]).toMatchObject({ sessionId: "sess-A", cwd: "/work", turnIndex: 1, model: "claude-haiku-5-5", input: 1000, toolCost: 0.005 });
		const file = readFileSync(join(dir, `${recs[0].ts.slice(0, 7)}.jsonl`), "utf8");
		expect(file.trim().split("\n")).toHaveLength(2);

		await commands.get("usage").handler("", ctx);
		expect(notes.at(-1)).toContain("session   $0.0350  turns 2");
		expect(summarize(recs, "other")).toContain("session   $0.0000  turns 0");
		const totals = costTotals();
		expect(totals.today).toBeCloseTo(0.035, 6);
		expect(totals.month).toBeCloseTo(0.035, 6);
	});

	test("a torn line does not hide other records", () => {
		const f = join(dir, `${new Date().toISOString().slice(0, 7)}.jsonl`);
		writeFileSync(f, `${readFileSync(f, "utf8")}{"broken\n`);
		expect(readMonth(new Date())).toHaveLength(2);
	});
});
