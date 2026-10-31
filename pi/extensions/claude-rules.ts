/**
 * claude-rules: loads the project's .claude/rules/ into pi the way Claude Code
 * does. Rules without `paths:` frontmatter are always on, so their bodies go
 * into the system prompt; path-scoped rules are listed with their globs and the
 * model reads one before touching matching files (pi has no per-file trigger).
 *
 * Only the project's rules: ~/.claude/rules is the global set that
 * pi/AGENTS.md already distills, and loading both would duplicate it.
 * Re-scanned before every prompt so edits apply without /reload.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface Rule {
	/** Path relative to the project root, e.g. ".claude/rules/pi.md". */
	file: string;
	paths: string[];
	body: string;
}

// Always-on bodies past this many characters are listed instead, so one
// oversized rule cannot crowd out the conversation.
const INLINE_BUDGET = 16_000;

/**
 * Nearest .claude/rules from cwd upward, stopping at the repository root (.git)
 * or $HOME. $HOME/.claude/rules is the global set and is never returned.
 */
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

/** Splits YAML frontmatter and reads `paths:` (block list, inline list, or a single string). */
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
		if (entry.isDirectory()) out.push(...markdownFiles(full));
		else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
	}
	return out.sort();
}

export function loadRules(rulesDir: string): Rule[] {
	const root = dirname(dirname(rulesDir));
	return markdownFiles(rulesDir).map((full) => ({ file: relative(root, full), ...parseRule(readFileSync(full, "utf8")) }));
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
	let out = "\n\n# Project rules (.claude/rules)\n";
	for (const r of inline) out += `\n## ${r.file}\n\n${r.body}\n`;
	if (listed.length > 0) {
		out +=
			"\nRead a rule below with the read tool before working on files that match its paths" +
			" (rules marked always apply to every task):\n";
		for (const r of listed) out += `- ${r.file}: ${r.paths.length > 0 ? r.paths.join(", ") : "always"}\n`;
	}
	return out;
}

export default function claudeRules(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const dir = findRulesDir(ctx.cwd);
		if (!dir) return;
		let section: string;
		try {
			section = buildSection(loadRules(dir));
		} catch (err) {
			// An unreadable rule file should not block the prompt; say so instead of dropping rules silently.
			if (ctx.hasUI) ctx.ui.notify(`claude-rules: could not read ${dir}: ${(err as Error).message}`, "warning");
			return;
		}
		if (section) return { systemPrompt: event.systemPrompt + section };
	});
}
