// Offline tests for pi/extensions/compact-diff.ts. Run: bun test pi/tests
import { describe, expect, mock, test } from "bun:test";

import { FakeBox, FakeContainer, piTuiFake } from "./pi-tui-fake.ts";

mock.module("@earendil-works/pi-tui", () => piTuiFake);
mock.module("@earendil-works/pi-coding-agent", () => ({ keyHint: () => "ctrl+o to expand" }));
const { default: compactDiff, diffStats, displayPath, lineCount, editSummaryLine } = await import("../extensions/compact-diff.ts");

const theme: any = {
	fg: (_role: string, s: string) => s,
	bg: (role: string, s: string) => `[${role}]${s}`,
	bold: (s: string) => s,
};

function resolve(toolName: string, base: any) {
	let resolver: any;
	compactDiff({ registerToolRenderer: (r: any) => (resolver = r) } as any);
	return resolver(toolName, () => base);
}

const ctx = (expanded: boolean, state: any = {}, extra: any = {}) => ({
	state,
	expanded,
	cwd: "/w",
	outputPad: 1,
	isError: false,
	lastComponent: "from-tool-execution",
	...extra,
});

describe("compact-diff helpers", () => {
	test("diffStats counts pi's numbered +/- lines and ignores context", () => {
		expect(diffStats(" 1 a\n-2 b\n+2 B\n+3 B2\n 3 c\n   ...")).toEqual({ added: 2, removed: 1 });
		expect(diffStats("")).toEqual({ added: 0, removed: 0 });
	});

	test("displayPath shortens only at a path boundary", () => {
		expect(displayPath("/w/a/b.ts", "/w", "/h")).toBe("a/b.ts");
		expect(displayPath("/w", "/w", "/h")).toBe(".");
		expect(displayPath("/w2/x", "/w", "/h")).toBe("/w2/x");
		expect(displayPath("/h/x", "/w", "/h")).toBe("~/x");
		expect(displayPath("/x", "", "")).toBe("/x");
	});

	test("lineCount ignores one trailing newline", () => {
		expect(lineCount("")).toBe(0);
		expect(lineCount("a")).toBe(1);
		expect(lineCount("a\nb\n")).toBe(2);
		expect(lineCount("a\n\n")).toBe(2);
	});

	test("edit summary shows the first error line instead of stats", () => {
		expect(editSummaryLine({ path: "/w/f" }, { error: "boom\nmore" }, theme, "/w")).toBe("edit f boom");
		expect(editSummaryLine({ path: "/w/f" }, { diff: "+1 a" }, theme, "/w")).toBe("edit f +1 -0 (ctrl+o to expand)");
		expect(editSummaryLine({}, undefined, theme, "/w")).toBe("edit ...");
	});
});

describe("compact-diff renderers", () => {
	test("other tools and tools without renderers pass through", () => {
		expect(resolve("read", "NEXT")).toBe("NEXT");
		expect(resolve("edit", undefined)).toBeUndefined();
		const callOnly = { renderCall: () => 1 };
		expect(resolve("edit", callOnly)).toBe(callOnly);
	});

	test("edit: base always runs on its own component; collapsed shows a one-line summary", () => {
		const seen: any[] = [];
		const base = {
			renderShell: "self",
			renderCall: (_a: any, _t: any, c: any) => {
				seen.push(c.lastComponent);
				c.state.callComponent = { preview: { diff: "+1 x\n-1 y\n+2 z" } };
				return "FULL_CALL";
			},
			renderResult: () => "FULL_RESULT",
		};
		const edit = resolve("edit", base);
		expect(edit.renderShell).toBe("self");
		const state: any = {};
		const box = edit.renderCall({ path: "/w/f.ts" }, theme, ctx(false, state));
		expect(box).toBeInstanceOf(FakeBox);
		expect(box.children[0].text).toBe("edit f.ts +2 -1 (ctrl+o to expand)");
		expect(box.bg).toBe("[toolSuccessBg]");
		expect(edit.renderCall({ path: "/w/f.ts" }, theme, ctx(true, state))).toBe("FULL_CALL");
		expect(seen).toEqual([undefined, state.callComponent]);
	});

	test("edit: collapsed hides the result unless it is an error", () => {
		const base = { renderCall: () => "C", renderResult: () => "FULL_RESULT" };
		const edit = resolve("edit", base);
		const opts = (expanded: boolean) => ({ expanded, isPartial: false });
		expect(edit.renderResult({}, opts(false), theme, ctx(false))).toBeInstanceOf(FakeContainer);
		expect(edit.renderResult({}, opts(true), theme, ctx(true))).toBe("FULL_RESULT");
		expect(edit.renderResult({}, opts(false), theme, ctx(false, {}, { isError: true }))).toBe("FULL_RESULT");
	});

	test("edit: failed or pending preview picks the matching background", () => {
		const withPreview = (callComponent: any) => ({
			renderCall: (_a: any, _t: any, c: any) => {
				c.state.callComponent = callComponent;
				return "C";
			},
			renderResult: () => "R",
		});
		const bgOf = (cc: any) => resolve("edit", withPreview(cc)).renderCall({ path: "/w/f" }, theme, ctx(false)).bg;
		expect(bgOf(undefined)).toBe("[toolPendingBg]");
		expect(bgOf({ preview: { error: "x" } })).toBe("[toolErrorBg]");
		expect(bgOf({ settledError: true })).toBe("[toolErrorBg]");
	});

	test("write: collapsed skips the base renderer; expanded reuses its component", () => {
		const seen: any[] = [];
		const base = {
			renderCall: (_a: any, _t: any, c: any) => {
				seen.push(c.lastComponent);
				return { id: seen.length };
			},
			renderResult: () => "R",
		};
		const write = resolve("write", base);
		const args = { path: "/w/g.ts", content: "a\nb\n" };
		const state: any = {};
		expect(write.renderCall(args, theme, ctx(false, state)).text).toBe("write g.ts (2 lines) (ctrl+o to expand)");
		const first = write.renderCall(args, theme, ctx(true, state));
		write.renderCall(args, theme, ctx(true, state));
		expect(seen).toEqual([undefined, first]);
		expect(write.renderResult).toBe(base.renderResult);
	});
});
