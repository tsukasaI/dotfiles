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

/** Undefined when fini changed nothing and reported nothing. */
export async function formatFile(path: string, run: FiniRunner = runFini): Promise<string | undefined> {
	const before = snapshot(path);
	if (before === undefined) return undefined;
	const { stdout, error } = await run(path);
	if (error) return `[format] fini did not run on ${path}: ${error.message.split("\n")[0]}`;
	const notes: string[] = [];
	// Not silent like Claude Code's hook: after a rewrite the model's next edit would target stale text.
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
