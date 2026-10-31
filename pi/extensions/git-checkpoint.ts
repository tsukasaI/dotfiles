/**
 * git-checkpoint: snapshot the repo once per prompt, right before the first
 * mutating tool call (edit / write / bash), so a bad run can be undone.
 *
 * Snapshot = a commit object built from a throwaway index (GIT_INDEX_FILE),
 * stored at refs/pi-checkpoints/<session-id>/<NNNN>. Unlike `git stash create`
 * (examples/extensions/git-checkpoint.ts) it includes untracked files, and it
 * never touches the working tree, the real index, the stash list, or hooks.
 *
 * /checkpoints [list [all] | diff <n> | restore <n> | prune]
 *   restore only prints commands; it never rewrites files itself.
 */

import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MUTATING_TOOLS = new Set(["edit", "write", "bash"]);
const REF_ROOT = "refs/pi-checkpoints";
// Fixed identity: snapshots must not depend on user.name/email being set, and
// must not trigger GPG pinentry (see --no-gpg-sign below).
const IDENTITY_ENV = {
	GIT_AUTHOR_NAME: "pi-checkpoint",
	GIT_AUTHOR_EMAIL: "pi-checkpoint@localhost",
	GIT_COMMITTER_NAME: "pi-checkpoint",
	GIT_COMMITTER_EMAIL: "pi-checkpoint@localhost",
};

type GitResult = { code: number; stdout: string; stderr: string };

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<GitResult> {
	return new Promise((resolve) => {
		execFile(
			"git",
			args,
			{ cwd, env: { ...process.env, ...env }, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
			(err, stdout, stderr) => {
				const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
				resolve({ code, stdout: String(stdout), stderr: String(stderr) });
			},
		);
	});
}

async function gitOk(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
	const r = await git(cwd, args, env);
	if (r.code !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim() || `exit ${r.code}`}`);
	return r.stdout.trim();
}

export interface Checkpoint {
	ref: string;
	sha: string;
	n: number;
}

/** Create a checkpoint for the repo containing cwd. Returns undefined outside a git repo or when nothing changed since the last checkpoint of this session. */
export async function createCheckpoint(cwd: string, sessionId: string, label: string): Promise<Checkpoint | undefined> {
	const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
	if (top.code !== 0) return undefined;
	const root = top.stdout.trim();

	const tmp = mkdtempSync(join(tmpdir(), "pi-checkpoint-"));
	try {
		const indexFile = join(tmp, "index");
		// Seed from the real index so `add -A` can reuse its stat cache.
		let realIndex = await gitOk(root, ["rev-parse", "--git-path", "index"]);
		if (!isAbsolute(realIndex)) realIndex = join(root, realIndex);
		if (existsSync(realIndex)) copyFileSync(realIndex, indexFile);
		const env = { GIT_INDEX_FILE: indexFile };

		await gitOk(root, ["add", "-A", "--", "."], env);
		const tree = await gitOk(root, ["write-tree"], env);

		const prefix = `${REF_ROOT}/${sessionId}/`;
		const existing = (await gitOk(root, ["for-each-ref", "--sort=-refname", "--format=%(refname) %(objectname)", prefix]))
			.split("\n")
			.filter(Boolean);
		if (existing.length > 0) {
			const lastSha = existing[0].split(" ")[1];
			const lastTree = await gitOk(root, ["rev-parse", `${lastSha}^{tree}`]);
			if (lastTree === tree) return undefined;
		}
		const n = existing.length > 0 ? Number(existing[0].slice(prefix.length).split(" ")[0]) + 1 : 1;

		const head = await git(root, ["rev-parse", "-q", "--verify", "HEAD"]);
		const parents = head.code === 0 ? ["-p", head.stdout.trim()] : [];
		const message = `pi checkpoint ${n}: ${label}\n\nsession: ${sessionId}\ncwd: ${cwd}\n`;
		const sha = await gitOk(root, ["commit-tree", "--no-gpg-sign", tree, ...parents, "-m", message], IDENTITY_ENV);

		const ref = `${prefix}${String(n).padStart(4, "0")}`;
		await gitOk(root, ["update-ref", ref, sha]);
		return { ref, sha, n };
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

export default function gitCheckpoint(pi: ExtensionAPI) {
	let armed = false;
	let label = "";
	let pending: Promise<void> | undefined;

	pi.on("before_agent_start", async (event) => {
		const prompt = typeof event.prompt === "string" ? event.prompt : "";
		label = prompt.replace(/\s+/g, " ").trim().slice(0, 72) || "(no prompt)";
	});

	pi.on("agent_start", async () => {
		armed = true;
		pending = undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!MUTATING_TOOLS.has(event.toolName)) return;
		if (armed) {
			// Set synchronously: sibling tool calls run in parallel and must all
			// wait for the same snapshot instead of each taking one.
			armed = false;
			pending = snapshot(ctx);
		}
		if (pending) await pending;
	});

	async function snapshot(ctx: ExtensionContext): Promise<void> {
		try {
			const cp = await createCheckpoint(ctx.cwd, ctx.sessionManager.getSessionId(), label);
			if (cp && ctx.hasUI) ctx.ui.setStatus("git-checkpoint", `checkpoint #${cp.n} ${cp.sha.slice(0, 8)}`);
		} catch (err) {
			// Never block the tool: a failed snapshot is a warning, not a stop.
			if (ctx.hasUI) ctx.ui.notify(`git-checkpoint: ${(err as Error).message}`, "warning");
		}
	}

	pi.registerCommand("checkpoints", {
		description: "List / diff / restore-hint / prune git checkpoints taken before pi edits",
		handler: async (args, ctx) => {
			const [sub = "list", arg] = args.trim().split(/\s+/).filter(Boolean);
			const sessionId = ctx.sessionManager.getSessionId();
			const say = (text: string, level: "info" | "warning" | "error" = "info") =>
				ctx.hasUI ? ctx.ui.notify(text, level) : console.log(text);

			const top = await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
			if (top.code !== 0) return say("Not inside a git repository.", "warning");
			const root = top.stdout.trim();

			const resolve = async (n: string | undefined): Promise<string | undefined> => {
				if (!n || !/^\d+$/.test(n)) return undefined;
				const ref = `${REF_ROOT}/${sessionId}/${n.padStart(4, "0")}`;
				const r = await git(root, ["rev-parse", "-q", "--verify", ref]);
				return r.code === 0 ? r.stdout.trim() : undefined;
			};

			switch (sub) {
				case "list": {
					const scope = arg === "all" ? `${REF_ROOT}/` : `${REF_ROOT}/${sessionId}/`;
					const out = await gitOk(root, [
						"for-each-ref",
						"--sort=-creatordate",
						"--format=%(refname:lstrip=2)  %(objectname:short)  %(creatordate:format:%Y-%m-%d %H:%M)  %(subject)",
						scope,
					]);
					return say(out || `No checkpoints${arg === "all" ? "" : " for this session"}. (try: /checkpoints list all)`);
				}
				case "diff": {
					const sha = await resolve(arg);
					if (!sha) return say("Usage: /checkpoints diff <n>  (n from /checkpoints list)", "warning");
					const stat = await gitOk(root, ["diff", "--stat", sha]);
					return say(stat ? `Changes since checkpoint ${arg} (tracked files):\n${stat}` : `No tracked changes since checkpoint ${arg}.`);
				}
				case "restore": {
					const sha = await resolve(arg);
					if (!sha) return say("Usage: /checkpoints restore <n>", "warning");
					return say(
						[
							`Restore checkpoint ${arg} (${sha.slice(0, 8)}) by running these yourself:`,
							"  git stash push -u -m 'before pi checkpoint restore'   # keep current state",
							`  git restore --source=${sha} --worktree -- .`,
							"Files created after the checkpoint are not removed by git restore; review `git status`.",
						].join("\n"),
					);
				}
				case "prune": {
					if (!ctx.hasUI) return say("prune needs interactive confirmation.", "warning");
					const refs = (await gitOk(root, ["for-each-ref", "--format=%(refname)", `${REF_ROOT}/`]))
						.split("\n")
						.filter((r) => r && !r.startsWith(`${REF_ROOT}/${sessionId}/`));
					if (refs.length === 0) return say("Nothing to prune (only this session's checkpoints exist).");
					const ok = await ctx.ui.confirm("Prune checkpoints?", `Delete ${refs.length} checkpoint ref(s) from other sessions?`);
					if (!ok) return say("Prune cancelled.");
					for (const ref of refs) await gitOk(root, ["update-ref", "-d", ref]);
					return say(`Deleted ${refs.length} checkpoint ref(s). Objects are reclaimed by a later git gc.`);
				}
				default:
					return say("Usage: /checkpoints [list [all] | diff <n> | restore <n> | prune]", "warning");
			}
		},
	});
}
