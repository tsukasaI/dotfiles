// Offline tests for pi/extensions/claude-rules.ts. Run: bun test pi/tests
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import claudeRules, { buildSection, findRulesDir, loadRules, parseRule } from "../extensions/claude-rules.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "claude-rules-"));
	dirs.push(root);
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(root, rel, ".."), { recursive: true });
		writeFileSync(join(root, rel), content);
	}
	return root;
}

describe("parseRule", () => {
	test("block list with quotes and a comment line", () => {
		const r = parseRule('---\n# why\npaths:\n  - "pi/**"\n  - \'*.ts\'\n---\n# Body\n');
		expect(r).toEqual({ paths: ["pi/**", "*.ts"], body: "# Body" });
	});
	test("inline list and single string", () => {
		expect(parseRule('---\npaths: ["a/**", b]\n---\nx').paths).toEqual(["a/**", "b"]);
		expect(parseRule("---\npaths: src/**\n---\nx").paths).toEqual(["src/**"]);
	});
	test("other keys after the list are not taken as paths", () => {
		expect(parseRule("---\npaths:\n  - a\ndescription: d\n---\nx").paths).toEqual(["a"]);
	});
	test("no frontmatter or no paths means always on", () => {
		expect(parseRule("plain rule")).toEqual({ paths: [], body: "plain rule" });
		expect(parseRule("---\ntitle: t\n---\nbody").paths).toEqual([]);
	});
});

describe("findRulesDir", () => {
	test("finds the nearest rules dir from a subdirectory, within the repo", () => {
		const root = tree({ ".git/HEAD": "", ".claude/rules/a.md": "x", "src/deep/f.ts": "" });
		expect(findRulesDir(join(root, "src", "deep"), "/nonexistent-home")).toBe(join(root, ".claude", "rules"));
	});
	test("stops at the repository root", () => {
		const outer = tree({ ".claude/rules/a.md": "x", "repo/.git/HEAD": "" });
		expect(findRulesDir(join(outer, "repo"), "/nonexistent-home")).toBeUndefined();
	});
	test("never returns the global ~/.claude/rules", () => {
		const home = tree({ ".claude/rules/global.md": "x", "work/f": "" });
		expect(findRulesDir(join(home, "work"), home)).toBeUndefined();
		expect(findRulesDir(home, home)).toBeUndefined();
	});
});

describe("buildSection", () => {
	test("inlines always-on rules and lists path-scoped ones", () => {
		const root = tree({
			".claude/rules/always.md": "Always do X.",
			".claude/rules/sub/pi.md": '---\npaths:\n  - "pi/**"\n---\nPi rule body',
		});
		const s = buildSection(loadRules(join(root, ".claude", "rules")));
		expect(s).toContain("## .claude/rules/always.md\n\nAlways do X.");
		expect(s).toContain("- .claude/rules/sub/pi.md: pi/**");
		expect(s).not.toContain("Pi rule body");
	});
	test("an oversized always-on rule is listed instead of inlined", () => {
		const s = buildSection([{ file: ".claude/rules/big.md", paths: [], body: "x".repeat(20_000) }]);
		expect(s).not.toContain("xxxx");
		expect(s).toContain("- .claude/rules/big.md: always");
	});
	test("no rules, no section", () => {
		expect(buildSection([])).toBe("");
	});
});

describe("extension", () => {
	test("appends the section to the system prompt; leaves it alone without rules", async () => {
		let handler: Function | undefined;
		claudeRules({ on: (_ev: string, h: Function) => (handler = h) } as any);
		const withRules = tree({ ".git/HEAD": "", ".claude/rules/r.md": "Rule." });
		const res = await handler!({ systemPrompt: "BASE" }, { cwd: withRules, hasUI: false });
		expect(res.systemPrompt).toStartWith("BASE");
		expect(res.systemPrompt).toContain("Rule.");
		const without = tree({ ".git/HEAD": "" });
		expect(await handler!({ systemPrompt: "BASE" }, { cwd: without, hasUI: false })).toBeUndefined();
	});
});
