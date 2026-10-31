/**
 * shguard: runs every model-issued bash command through the same shguard
 * config Claude Code uses (~/.config/shguard/config.toml) and blocks anything
 * shguard does not explicitly allow.
 *
 * Fail-closed throughout: a missing binary, timeout, unparseable output, or a
 * decision other than "Allow" blocks the command, and SHGUARD_STRICT_CONFIG=1
 * makes a missing or malformed config deny instead of ask (as in
 * claude-code/settings.json). pi also blocks the tool when this handler throws.
 *
 * Only the bash tool is checked. Commands the user types with `!` are the
 * user's own and are not gated; read/write/edit are out of scope by choice.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Verdict = { allow: true } | { allow: false; reason: string };

/** Interprets `shguard check --json` output; anything but a well-formed Allow is a block. */
export function parseVerdict(stdout: string): Verdict {
	let d: any;
	try {
		d = JSON.parse(stdout);
	} catch {
		return { allow: false, reason: "shguard returned unparseable output" };
	}
	if (d?.decision === "Allow") return { allow: true };
	const detail = [d?.deny_message, d?.reason].filter((s) => typeof s === "string" && s).join(" / ");
	return { allow: false, reason: `shguard: ${d?.decision ?? "no decision"}${detail ? ` (${detail})` : ""}` };
}

export type Runner = (command: string) => Promise<{ stdout: string; error?: Error }>;

// shguard exits 1 on Block while still printing the JSON verdict, so the exit
// code alone says nothing; stdout is parsed either way.
const runShguard: Runner = (command) =>
	new Promise((resolve) => {
		execFile(
			"shguard",
			["check", command, "--json"],
			{ timeout: 10_000, env: { ...process.env, SHGUARD_STRICT_CONFIG: "1" } },
			(error, stdout) => resolve({ stdout: String(stdout ?? ""), error: error ?? undefined }),
		);
	});

export async function checkCommand(command: string, run: Runner = runShguard): Promise<Verdict> {
	const { stdout, error } = await run(command);
	if (!stdout.trim()) return { allow: false, reason: `shguard did not run: ${error?.message ?? "no output"}` };
	return parseVerdict(stdout);
}

export default function shguard(pi: ExtensionAPI, run: Runner = runShguard) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return { block: true, reason: "shguard: bash call without a command string" };
		const verdict = await checkCommand(command, run);
		return verdict.allow ? undefined : { block: true, reason: verdict.reason };
	});
}
