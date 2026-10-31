// Tests for pi/extensions/style-guards.ts. Run: bun test pi/tests
// The slop tests run the real claude-code/hooks/slop-guard.ts through bun.
import { describe, expect, test } from "bun:test";
import styleGuards, { checkCommit, checkSlop, slopPayload } from "../extensions/style-guards.ts";

describe("slop", () => {
	test("payload: prose only; edits[] folded into one old/new pair", () => {
		expect(slopPayload("write", { content: "x" }, "/w/a.ts")).toBeUndefined();
		expect(slopPayload("write", { content: "x" }, "/w/A.MD")).toMatchObject({ tool_name: "Write", tool_input: { content: "x" } });
		const p: any = slopPayload("edit", { edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] }, "/w/a.md");
		expect(p.tool_input).toEqual({ file_path: "/w/a.md", old_string: "a\nc", new_string: "b\nd" });
		expect(slopPayload("edit", { oldText: "a", newText: "b" }, "/w/a.md")).toMatchObject({ tool_name: "Edit" });
		expect(slopPayload("edit", { edits: [] }, "/w/a.md")).toBeUndefined();
	});
	test("real slop-guard: a new em dash is blocked, an existing one is not", async () => {
		const added = slopPayload("edit", { edits: [{ oldText: "a b", newText: "a — b" }] }, "/tmp/x.md")!;
		expect((await checkSlop(added))?.reason).toContain("em dash");
		const kept = slopPayload("edit", { edits: [{ oldText: "a — b", newText: "a — c" }] }, "/tmp/x.md")!;
		expect(await checkSlop(kept)).toBeUndefined();
	});
	test("garbage or no output fails open", async () => {
		expect(await checkSlop({}, async () => ({ code: 1, stdout: "boom" }))).toBeUndefined();
	});
});

describe("commit", () => {
	const git = (branch: string, origin: string) => async (_c: string, args: string[]) =>
		args[0] === "rev-parse" ? { code: 0, stdout: `${branch}\n` } : { code: 0, stdout: `${origin}\n` };
	const other = git("main", "git@github.com:tsukasaI/app.git");

	test("message rules", async () => {
		expect((await checkCommit("git commit -m 'update stuff'", "/w", git("feat/x", "")))?.reason).toContain("Conventional");
		expect((await checkCommit("git commit -m 'fix: 修正'", "/w", git("feat/x", "")))?.reason).toContain("Japanese");
		expect(await checkCommit("git commit -m 'fix(pi): handle x'", "/w", git("feat/x", ""))).toBeUndefined();
	});
	test("main is blocked except in dotfiles/ops", async () => {
		expect((await checkCommit("git commit -m 'fix: x'", "/w", other))?.reason).toContain("branch + PR");
		expect(await checkCommit("git commit -m 'fix: x'", "/w", git("main", "https://github.com/tsukasaI/dotfiles.git"))).toBeUndefined();
		expect(await checkCommit("cd ../app && git commit -m 'fix: x'", "/w", other)).toBeUndefined();
	});
	test("non-commits and unreadable messages pass", async () => {
		expect(await checkCommit("git log --grep commit", "/w", other)).toBeUndefined();
		expect(await checkCommit('git commit -m "$MSG"', "/w", other)).toBeUndefined();
	});
	test("extension fails open when the check throws", async () => {
		let h: Function | undefined;
		styleGuards({ on: (_e: string, fn: Function) => (h = fn) } as any, async () => {
			throw new Error("boom");
		});
		expect(await h!({ toolName: "bash", input: { command: "git commit -m 'fix: x'" } }, { cwd: "/w" })).toBeUndefined();
	});
});
