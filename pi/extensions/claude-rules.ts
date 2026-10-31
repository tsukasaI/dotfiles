import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface Rule {
	/** How the model should refer to the file with the read tool. */
	file: string;
	paths: string[];
	body: string;
}

// Not a cap per rule: one oversized always-on rule is listed instead of inlined.
const INLINE_BUDGET = 16_000;
// Claude Code Bash-sandbox mechanics (.git/config write-protect, scratchpad paths); pi has no sandbox.
const CLAUDE_ONLY = new Set(["git-sandbox.md"]);

export const GLOBAL_RULES = join(homedir(), ".claude", "rules");

/** Nearest .claude/rules from cwd upward, within the repo; never $HOME's (that is the global set). */
export function findRulesDir(cwd: string, home = homedir()): string | undefined {
	let dir = cwd;
	for (;;) {
		const candidate = join(dir, ".claude", "rules");
		if (dir !== home && existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;
		if (dir === home || existsSync(join(dir, ".git"))) return undefined;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function parseRule(text: string): { paths: string[]; body: string } {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return { paths: [], body: text.trim() };
	const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
	const paths: string[] = [];
	const lines = m[1].split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const key = lines[i].match(/^paths:\s*(.*)$/);
		if (!key) continue;
		const inline = key[1].replace(/\s+#.*$/, "").trim();
		if (inline.startsWith("[")) {
			paths.push(...inline.slice(1, -1).split(",").map(unquote).filter(Boolean));
		} else if (inline) {
			paths.push(unquote(inline));
		} else {
			for (i++; i < lines.length; i++) {
				const item = lines[i].match(/^\s+-\s+(.+)$/);
				if (item) paths.push(unquote(item[1].replace(/\s+#.*$/, "")));
				else if (/^\s*(#.*)?$/.test(lines[i])) continue;
				else {
					i--;
					break;
				}
			}
		}
	}
	return { paths, body: text.slice(m[0].length).trim() };
}

function markdownFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		// Not entry.isFile(): it is false for a symlinked rule file.
		const isDir = entry.isDirectory() || (entry.isSymbolicLink() && statSync(full).isDirectory());
		if (isDir) out.push(...markdownFiles(full));
		else if (entry.name.endsWith(".md")) out.push(full);
	}
	return out.sort();
}

export function loadRules(rulesDir: string): Rule[] {
	const root = dirname(dirname(rulesDir));
	return markdownFiles(rulesDir).map((full) => ({ file: relative(root, full), ...parseRule(readFileSync(full, "utf8")) }));
}

export function loadGlobalRules(dir = GLOBAL_RULES): Rule[] {
	if (!existsSync(dir)) return [];
	return markdownFiles(dir)
		.filter((full) => !CLAUDE_ONLY.has(basename(full)))
		.map((full) => ({ file: `~/.claude/rules/${relative(dir, full)}`, ...parseRule(readFileSync(full, "utf8")) }));
}

export function buildSection(rules: Rule[]): string {
	if (rules.length === 0) return "";
	const inline: Rule[] = [];
	const listed: Rule[] = [];
	let budget = INLINE_BUDGET;
	for (const r of rules) {
		if (r.paths.length === 0 && r.body.length <= budget) {
			inline.push(r);
			budget -= r.body.length;
		} else {
			listed.push(r);
		}
	}
	let out = "\n\n# Rules (~/.claude/rules, .claude/rules)\n";
	for (const r of inline) out += `\n## ${r.file}\n\n${r.body}\n`;
	if (listed.length > 0) {
		out +=
			"\nRead a rule below with the read tool before working on files that match its paths" +
			" (rules marked always apply to every task):\n";
		for (const r of listed) out += `- ${r.file}: ${r.paths.length > 0 ? r.paths.join(", ") : "always"}\n`;
	}
	return out;
}

export default function claudeRules(pi: ExtensionAPI, globalDir = GLOBAL_RULES) {
	pi.on("before_agent_start", async (event, ctx) => {
		const rules: Rule[] = [];
		for (const [label, load] of [
			[globalDir, () => loadGlobalRules(globalDir)],
			[ctx.cwd, () => {
				const dir = findRulesDir(ctx.cwd);
				return dir ? loadRules(dir) : [];
			}],
		] as const) {
			try {
				rules.push(...load());
			} catch (err) {
				// Not thrown: a broken rule file should not block the prompt, but dropping rules silently would hide it.
				if (ctx.hasUI) ctx.ui.notify(`claude-rules: could not read rules for ${label}: ${(err as Error).message}`, "warning");
			}
		}
		const section = buildSection(rules);
		if (section) return { systemPrompt: event.systemPrompt + section };
	});
}
