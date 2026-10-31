/**
 * format: runs `fini` on every file pi's write/edit tools changed, the same
 * normalizer Claude Code's PostToolUse hook runs on Edit/Write.
 *
 * Unlike that hook, the model is told when fini rewrote the file (its next
 * edit would otherwise target stale text) and sees fini's findings
 * (secrets, TODO, debug code). Best-effort, not a guard: a missing binary,
 * timeout, or failure leaves the tool result unchanged apart from a note.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveToolPath } from "./file-guard.ts";

const MAX_NOTE_CHARS = 2000;

export type FiniRunner = (path: string) => Promise<{ stdout: string; error?: Error }>;

const runFini: FiniRunner = (path) =>
	new Promise((done) => {
		execFile("fini", ["--no-color", "--no-progress", path], { timeout: 15_000 }, (error, stdout) =>
			done({ stdout: String(stdout ?? ""), error: error ?? undefined }),
		);
	});

const snapshot = (path: string): string | undefined => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

/** Formats the file and returns a note for the model, or undefined when there is nothing to say. */
export async function formatFile(path: string, run: FiniRunner = runFini): Promise<string | undefined> {
	const before = snapshot(path);
	if (before === undefined) return undefined;
	const { stdout, error } = await run(path);
	if (error) return `[format] fini did not run on ${path}: ${error.message.split("\n")[0]}`;
	const notes: string[] = [];
	if (snapshot(path) !== before) notes.push(`[format] fini normalized ${path}; re-read it before the next edit.`);
	const findings = stdout.trim();
	if (/^Detected:/m.test(findings)) notes.push(`[format] fini findings:\n${findings.slice(0, MAX_NOTE_CHARS)}`);
	return notes.length ? notes.join("\n") : undefined;
}

export default function format(pi: ExtensionAPI, run: FiniRunner = runFini) {
	pi.on("tool_result", async (event, ctx) => {
		if ((event.toolName !== "write" && event.toolName !== "edit") || event.isError) return undefined;
		const raw = (event.input as { path?: unknown }).path;
		if (typeof raw !== "string") return undefined;
		const note = await formatFile(resolveToolPath(raw, ctx.cwd), run);
		return note ? { content: [...event.content, { type: "text", text: note }] } : undefined;
	});
}
