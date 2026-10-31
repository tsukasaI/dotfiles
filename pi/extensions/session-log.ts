import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_ENV } from "./usage-log.ts";

const SAVER = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/save-session.ts");

export type Launcher = (args: string[]) => void;

// Detached rather than awaited: quitting pi should not wait on a SQLite write
// (Claude Code's SessionEnd hook is async for the same reason). Not node:sqlite
// in-process: the saver shares bun:sqlite and claude-code/lib with save-transcript.ts.
const launch: Launcher = (args) => {
	const child = spawn("bun", ["--config=/dev/null", SAVER, ...args], { detached: true, stdio: "ignore" });
	child.on("error", () => {});
	child.unref();
};

export default function sessionLog(pi: ExtensionAPI, run: Launcher = launch) {
	if (process.env[SUBAGENT_ENV] === "1") return;
	pi.on("session_shutdown", async (event, ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		if (file) run([file, event.reason]);
	});
}
