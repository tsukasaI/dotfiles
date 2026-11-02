import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonicalize } from "../../claude-code/mod/hooks/shell-canon.ts";

export type Verdict = { allow: true } | { allow: false; reason: string };

/** The Claude Code PreToolUse input shguard reads on stdin (hook mode). */
export function hookPayload(command: string): string {
	return JSON.stringify({ tool_name: "Bash", tool_input: { command }, hook_event_name: "PreToolUse" });
}

/** Interprets shguard's hook output; anything but a well-formed allow is a block (Ask included: pi cannot answer one). */
export function parseVerdict(stdout: string): Verdict {
	let d: any;
	try {
		d = JSON.parse(stdout);
	} catch {
		return { allow: false, reason: "shguard returned unparseable output" };
	}
	const out = d?.hookSpecificOutput;
	const decision = out?.permissionDecision;
	if (decision === "allow") return { allow: true };
	const reason = typeof out?.permissionDecisionReason === "string" ? out.permissionDecisionReason : "";
	return { allow: false, reason: `shguard: ${typeof decision === "string" ? decision : "no decision"}${reason ? ` (${reason})` : ""}` };
}

export type Runner = (stdin: string) => Promise<{ stdout: string; error?: Error }>;

// Hook mode: the payload goes in on stdin and the answer comes back on
// stdout with exit 0; exit 2 means it could not write one. stdout is parsed
// either way, and empty stdout blocks.
const runShguard: Runner = (stdin) =>
	new Promise((resolve) => {
		const child = spawn("shguard", [], { stdio: ["pipe", "pipe", "ignore"], timeout: 10_000 });
		let stdout = "";
		let error: Error | undefined;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (s: string) => (stdout += s));
		child.on("error", (e) => (error = e));
		child.on("close", (code, signal) => {
			if (!error && code !== 0) error = new Error(signal ? `killed by ${signal}` : `exit ${code}`);
			resolve({ stdout, error });
		});
		child.stdin.on("error", (e) => (error ??= e));
		child.stdin.end(stdin);
	});

export async function checkCommand(command: string, run: Runner = runShguard): Promise<Verdict> {
	const { stdout, error } = await run(hookPayload(command));
	if (!stdout.trim()) return { allow: false, reason: `shguard did not run: ${error?.message ?? "no output"}` };
	return parseVerdict(stdout);
}

export default function shguard(pi: ExtensionAPI, run: Runner = runShguard) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return { block: true, reason: "shguard: bash call without a command string" };
		const home = process.env.HOME;
		const canon = canonicalize(command, home ? { HOME: home } : {});
		const verdict = await checkCommand(canon, run);
		if (!verdict.allow) return { block: true, reason: verdict.reason };
		(event.input as { command: string }).command = canon;
		return undefined;
	});
}
