/**
 * style-guards: the two Claude Code style checks pi was missing.
 *
 *   slop  write/edit of .md/.mdx/.txt runs claude-code/hooks/slop-guard.ts
 *         with a synthesized PreToolUse payload (pi's edits[] folded into one
 *         old/new pair), so the phrase list and em-dash rule stay in one place.
 *   commit  bash `git commit` gets claude-code/mod's checks: Conventional
 *         Commits subject, no Japanese, and no commit on main/master outside
 *         dotfiles/ops. The message parser is imported from the mod module.
 *
 * Both fail open, as they do in Claude Code: they enforce style, not safety.
 * A commit whose message can't be read statically (editor, `-F file`,
 * expanding `$`) is not checked here, whereas the mod hook denies it; that
 * flag is not exported and rule-guards.ts is a protected guard file.
 */

import { execFile } from "node:child_process";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { commitMessage, messageProblem } from "../../claude-code/mod/hooks/rule-guards.ts";
import { resolveToolPath } from "./file-guard.ts";

const SLOP_GUARD = resolve(dirname(fileURLToPath(import.meta.url)), "../../claude-code/hooks/slop-guard.ts");
const PROSE = new Set([".md", ".mdx", ".txt"]);
// Repos where committing straight to main is the workflow (same as rule-guards.ts).
const DIRECT_TO_MAIN = /[:/]tsukasaI\/(dotfiles|ops)(\.git)?$/;

type Block = { block: true; reason: string } | undefined;
export type Exec = (cmd: string, args: string[], opts: { cwd?: string; input?: string }) => Promise<{ code: number; stdout: string }>;

const exec: Exec = (cmd, args, { cwd, input }) =>
	new Promise((done) => {
		const child = execFile(cmd, args, { cwd, timeout: 10_000 }, (error, stdout) =>
			done({ code: error ? ((error as any).code ?? 1) : 0, stdout: String(stdout ?? "") }),
		);
		child.stdin?.end(input ?? "");
	});

/** Claude Code Edit/Write payload for slop-guard; undefined when the call has nothing to check. */
export function slopPayload(toolName: string, input: any, abs: string): object | undefined {
	if (!PROSE.has(extname(abs).toLowerCase())) return undefined;
	if (toolName === "write") {
		if (typeof input?.content !== "string") return undefined;
		return { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: abs, content: input.content } };
	}
	const edits: any[] = Array.isArray(input?.edits) ? input.edits : [input];
	const pairs = edits.filter((e) => typeof e?.oldText === "string" && typeof e?.newText === "string");
	if (pairs.length === 0) return undefined;
	return {
		hook_event_name: "PreToolUse",
		tool_name: "Edit",
		tool_input: { file_path: abs, old_string: pairs.map((e) => e.oldText).join("\n"), new_string: pairs.map((e) => e.newText).join("\n") },
	};
}

export async function checkSlop(payload: object, run: Exec = exec): Promise<Block> {
	const { stdout } = await run("bun", ["--config=/dev/null", SLOP_GUARD], { input: JSON.stringify(payload) });
	try {
		const out = JSON.parse(stdout)?.hookSpecificOutput;
		if (out?.permissionDecision === "deny") return { block: true, reason: `slop-guard: ${out.permissionDecisionReason}` };
	} catch {
		// no verdict printed = allow; any failure fails open
	}
	return undefined;
}

export async function checkCommit(command: string, cwd: string, run: Exec = exec): Promise<Block> {
	const message = commitMessage(command);
	if (message === undefined) return undefined;
	const bad = messageProblem(message);
	if (bad) return { block: true, reason: `commit-guard: ${bad}.` };
	// Which repo a `cd` / `-C` command commits in can't be told from the cwd.
	if (/(^|[;&|\n]\s*)cd\s|\s-C\s/.test(command)) return undefined;
	const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
	const name = branch.stdout.trim();
	if (branch.code !== 0 || (name !== "main" && name !== "master")) return undefined;
	const origin = await run("git", ["remote", "get-url", "origin"], { cwd });
	if (origin.code === 0 && DIRECT_TO_MAIN.test(origin.stdout.trim())) return undefined;
	return { block: true, reason: `commit-guard: this repo commits through a branch + PR, but HEAD is ${name}: create \`<type>/<short-slug>\` first.` };
}

export default function styleGuards(pi: ExtensionAPI, run: Exec = exec) {
	pi.on("tool_call", async (event, ctx) => {
		try {
			const input = event.input as any;
			if (event.toolName === "bash" && typeof input?.command === "string") return await checkCommit(input.command, ctx.cwd, run);
			if ((event.toolName === "write" || event.toolName === "edit") && typeof input?.path === "string") {
				if (process.env.SLOP_GUARD_DISABLE === "1") return undefined;
				const payload = slopPayload(event.toolName, input, resolveToolPath(input.path, ctx.cwd));
				return payload ? await checkSlop(payload, run) : undefined;
			}
		} catch {
			// fail open: a style check must never block on its own crash
		}
		return undefined;
	});
}
