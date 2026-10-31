// Offline tests for pi/extensions/copy-code.ts. Run: bun test pi/tests
import { describe, expect, test } from "bun:test";
import { assistantText, extractCodeBlocks, latestBlocks, pickBlock } from "../extensions/copy-code.ts";

const msg = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });

describe("extractCodeBlocks", () => {
	test("returns the bodies without fences or info strings", () => {
		expect(extractCodeBlocks("a\n```bash\necho hi\n```\nb\n~~~\nx\n~~~")).toEqual(["echo hi", "x"]);
	});

	test("a longer fence keeps inner ``` fences as content", () => {
		const md = "````markdown\nprompt\n```bash\nls\n```\nend\n````\nafter";
		expect(extractCodeBlocks(md)).toEqual(["prompt\n```bash\nls\n```\nend"]);
	});

	test("closing fence must match the opening character", () => {
		expect(extractCodeBlocks("~~~\n```\nx\n~~~")).toEqual(["```\nx"]);
	});

	test("an unclosed fence runs to the end; empty blocks are kept", () => {
		expect(extractCodeBlocks("```\na\nb")).toEqual(["a\nb"]);
		expect(extractCodeBlocks("```\n```")).toEqual([""]);
	});

	test("indented fences strip at most the fence's indent", () => {
		expect(extractCodeBlocks("  ```\n  a\n    b\nc\n  ```")).toEqual(["a\n  b\nc"]);
	});

	test("inline code and backtick info strings are not fences", () => {
		expect(extractCodeBlocks("use ```x``` here")).toEqual([]);
		expect(extractCodeBlocks("``` a`b\nx")).toEqual([]);
		expect(extractCodeBlocks("")).toEqual([]);
	});
});

describe("message selection", () => {
	test("assistantText joins text parts and ignores other roles and parts", () => {
		expect(assistantText({ role: "assistant", content: [{ type: "thinking", thinking: "t" }, { type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
		expect(assistantText({ role: "user", content: "```\nx\n```" })).toBe("");
		expect(assistantText(undefined)).toBe("");
	});

	test("latestBlocks walks back past replies without code blocks", () => {
		const entries = [msg("assistant", "```\nold\n```"), msg("assistant", "```\nmine\n```"), msg("user", "```\nuser\n```"), { type: "custom" }, msg("assistant", "no code")];
		expect(latestBlocks(entries)).toEqual(["mine"]);
		expect(latestBlocks([msg("assistant", "none")])).toEqual([]);
	});
});

describe("pickBlock", () => {
	const blocks = ["short", "the longest one", "mid size"];

	test("no argument picks the longest, first on ties", () => {
		expect(pickBlock(blocks, "")).toEqual({ ok: true, text: "the longest one", index: 2, total: 3 });
		expect(pickBlock(["ab", "cd"], "  ")).toMatchObject({ index: 1 });
	});

	test("a number picks that block (1-based)", () => {
		expect(pickBlock(blocks, " 3 ")).toEqual({ ok: true, text: "mid size", index: 3, total: 3 });
	});

	test("bad or out-of-range arguments and no blocks are errors", () => {
		for (const arg of ["0", "4", "x", "-1", "1.5"]) expect(pickBlock(blocks, arg).ok).toBe(false);
		expect(pickBlock([], "")).toEqual({ ok: false, error: expect.stringContaining("No code block") });
	});
});
