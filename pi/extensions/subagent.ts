/**
 * subagent: lets the main model (Opus) hand work to cheaper models in
 * separate pi processes, so their exploration never enters the main context
 * and the main model's prompt cache stays on one model.
 *
 *   scout    Haiku   read-only recon: find files, read, summarize
 *   research Sonnet  read-only, deeper investigation
 *   worker   Sonnet  implements a well-specified change (can edit/write)
 *
 * Each child runs `pi --mode json -p --no-session` with the user's extensions,
 * so shguard and .claude/rules apply there too. PI_SUBAGENT=1 keeps the child
 * from registering these tools again (no recursion) and from logging its own
 * usage; the child's usage comes back as this tool's result usage instead.
 */

import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_ENV } from "./usage-log.ts";

export interface AgentSpec {
	model: string;
	thinking: string;
	tools: string[];
	prompt: string;
}

const READ_ONLY = ["read", "grep", "find", "ls", "bash"];
const READ_ONLY_RULE =
	"You are read-only: never create, edit, or delete files, and use bash only for commands that do not change anything (git log/diff/show/status, ls, rg, cat-like reads, running read-only checks).";

export const AGENTS: Record<string, AgentSpec> = {
	scout: {
		model: "claude-haiku-5-5",
		thinking: "low",
		tools: READ_ONLY,
		prompt: `You are a scout for a main agent that has NOT seen the files. ${READ_ONLY_RULE}
Investigate quickly and return compressed findings the main agent can act on without re-reading: relevant paths with line numbers, the key facts, short code excerpts only when essential. No preamble. Say plainly what you could not find.`,
	},
	research: {
		model: "claude-sonnet-5-5",
		thinking: "medium",
		tools: READ_ONLY,
		prompt: `You are a research agent for a main agent that has NOT seen the files. ${READ_ONLY_RULE}
Investigate thoroughly (follow imports, read tests, check history when it matters) and return structured findings: answer first, then evidence as path:line references, then open questions and risks. Keep it as short as the answer allows.`,
	},
	worker: {
		model: "claude-sonnet-5-5",
		thinking: "medium",
		tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
		prompt: `You are a worker implementing a well-specified task for a main agent. Change only what the task requires, follow the project's existing patterns, and do not commit, push, or touch git history. Run the relevant tests or checks if they exist.
Finish with: files changed (one line each on what and why), verification commands you ran with their result, and anything left undone or uncertain.`,
	},
};

export const MAX_TASKS = 4;
const MAX_OUTPUT_CHARS = 30_000;

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export const emptyUsage = (): Usage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

export function addUsage(into: Usage, u: any): void {
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	into.input += n(u?.input);
	into.output += n(u?.output);
	into.cacheRead += n(u?.cacheRead);
	into.cacheWrite += n(u?.cacheWrite);
	into.totalTokens += n(u?.totalTokens);
	for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) into.cost[key] += n(u?.cost?.[key]);
}

export interface TaskResult {
	agent: string;
	model: string;
	ok: boolean;
	text: string;
	error?: string;
	usage: Usage;
	turns: number;
}

/** Folds the child's JSON event lines into a result. Pure, so tests can feed recorded events. */
export class EventCollector {
	usage = emptyUsage();
	turns = 0;
	lastText = "";
	stopReason = "";
	errorMessage = "";
	lastTool = "";

	feed(line: string): void {
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			return; // stray non-JSON output from the child
		}
		if (e?.type === "tool_execution_start" && !e.parentToolCallId) this.lastTool = String(e.toolName ?? "");
		if (e?.type !== "message_end" || e.message?.role !== "assistant") return;
		const m = e.message;
		this.turns++;
		addUsage(this.usage, m.usage);
		this.stopReason = String(m.stopReason ?? "");
		this.errorMessage = String(m.errorMessage ?? "");
		const text = (m.content ?? [])
			.filter((b: any) => b?.type === "text")
			.map((b: any) => b.text)
			.join("\n")
			.trim();
		if (text) this.lastText = text;
	}
}

export function childArgs(spec: AgentSpec, task: string): string[] {
	return [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--model",
		`anthropic/${spec.model}`,
		"--thinking",
		spec.thinking,
		"--tools",
		spec.tools.join(","),
		"--append-system-prompt",
		spec.prompt,
		`Task: ${task}`,
	];
}

export type Spawner = (
	args: string[],
	opts: { cwd: string; signal?: AbortSignal; onLine: (line: string) => void },
) => Promise<{ code: number | null; stderr: string; aborted: boolean }>;

const spawnPi: Spawner = (args, { cwd, signal, onLine }) =>
	new Promise((resolve) => {
		const proc = spawn("pi", args, { cwd, env: { ...process.env, [SUBAGENT_ENV]: "1" }, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";
		let stderr = "";
		let aborted = false;
		const kill = () => {
			aborted = true;
			proc.kill("SIGTERM");
		};
		signal?.addEventListener("abort", kill, { once: true });
		proc.stdout.on("data", (d) => {
			buf += d;
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) {
				onLine(buf.slice(0, i));
				buf = buf.slice(i + 1);
			}
		});
		proc.stderr.on("data", (d) => {
			stderr = (stderr + d).slice(-4000);
		});
		proc.on("error", (err) => {
			stderr += String(err);
		});
		proc.on("close", (code) => {
			if (buf) onLine(buf);
			signal?.removeEventListener("abort", kill);
			resolve({ code, stderr, aborted });
		});
	});

export async function runTask(
	agent: string,
	task: string,
	cwd: string,
	spawner: Spawner = spawnPi,
	signal?: AbortSignal,
	onProgress?: (agent: string, tool: string) => void,
): Promise<TaskResult> {
	const spec = AGENTS[agent];
	if (!spec) return { agent, model: "-", ok: false, text: "", error: `unknown agent "${agent}"`, usage: emptyUsage(), turns: 0 };
	const c = new EventCollector();
	const { code, stderr, aborted } = await spawner(childArgs(spec, task), {
		cwd,
		signal,
		onLine: (line) => {
			const before = c.lastTool;
			c.feed(line);
			if (c.lastTool && c.lastTool !== before) onProgress?.(agent, c.lastTool);
		},
	});
	const failed = aborted || code !== 0 || c.stopReason === "error" || c.stopReason === "aborted" || !c.lastText;
	const error = aborted
		? "aborted"
		: c.errorMessage || (code !== 0 ? `exit ${code}: ${stderr.trim().slice(-500)}` : !c.lastText ? "no output" : undefined);
	return { agent, model: spec.model, ok: !failed, text: c.lastText, error: failed ? error : undefined, usage: c.usage, turns: c.turns };
}

export function formatResults(results: TaskResult[]): string {
	return results
		.map((r) => {
			const head = `## ${r.agent} (${r.model}) ${r.ok ? "done" : `FAILED: ${r.error}`} · ${r.turns} turns · $${r.usage.cost.total.toFixed(4)}`;
			let body = r.text;
			if (body.length > MAX_OUTPUT_CHARS) body = `${body.slice(0, MAX_OUTPUT_CHARS)}\n[truncated: ${body.length - MAX_OUTPUT_CHARS} more characters]`;
			return body ? `${head}\n\n${body}` : head;
		})
		.join("\n\n");
}

/** Validation the schema cannot express; returns an error message or undefined. */
export function checkTasks(tasks: { agent: string; task: string }[]): string | undefined {
	if (tasks.length === 0 || tasks.length > MAX_TASKS) return `give 1-${MAX_TASKS} tasks`;
	const unknown = tasks.find((t) => !AGENTS[t.agent]);
	if (unknown) return `unknown agent "${unknown.agent}" (use ${Object.keys(AGENTS).join(", ")})`;
	// Parallel workers could edit the same files at once.
	if (tasks.filter((t) => t.agent === "worker").length > 1) return "at most one worker per call";
	if (tasks.some((t) => !t.task.trim())) return "every task needs a non-empty description";
	return undefined;
}

export default function subagent(pi: ExtensionAPI, spawner: Spawner = spawnPi) {
	if (process.env[SUBAGENT_ENV] === "1") return;

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: `Delegate work to a cheaper model running in its own context; only its final report comes back. Agents: scout (Haiku, read-only quick recon: locate files, read, summarize), research (Sonnet, read-only deeper investigation), worker (Sonnet, implements a well-specified change; can edit files). The agent has not seen this conversation: write a self-contained task with the goal, relevant paths, constraints, and the exact shape of report you need. Up to ${MAX_TASKS} tasks run in parallel; at most one worker per call.`,
		promptSnippet: "Delegate recon, research, or a well-specified implementation to Haiku/Sonnet subagents",
		promptGuidelines: [
			"Prefer subagent scout/research over reading many files yourself when you only need the findings, and run independent lookups as parallel tasks.",
			"Use subagent worker for well-specified, mechanical implementation; do design and tricky changes yourself, then review the worker's diff before reporting.",
		],
		parameters: Type.Object({
			tasks: Type.Array(
				Type.Object({
					agent: Type.String({ description: "scout | research | worker" }),
					task: Type.String({ description: "Self-contained task: goal, relevant paths, constraints, expected report shape" }),
				}),
				{ minItems: 1, maxItems: MAX_TASKS },
			),
		}),
		executionMode: "sequential",
		async execute(_id, params: any, signal, onUpdate, ctx) {
			const tasks: { agent: string; task: string }[] = params.tasks ?? [];
			const invalid = checkTasks(tasks);
			if (invalid) throw new Error(`subagent: ${invalid}`);
			const progress = new Map<number, string>();
			const report = () =>
				onUpdate?.({
					content: [{ type: "text", text: tasks.map((t, i) => `${t.agent}: ${progress.get(i) ?? "starting"}`).join("\n") }],
					details: undefined,
				});
			const results = await Promise.all(
				tasks.map((t, i) =>
					runTask(t.agent, t.task, ctx.cwd, spawner, signal, (_a, tool) => {
						progress.set(i, `⚙ ${tool}`);
						report();
					}),
				),
			);
			const usage = emptyUsage();
			for (const r of results) addUsage(usage, r.usage);
			return {
				content: [{ type: "text", text: formatResults(results) }],
				details: results.map(({ text: _t, ...rest }) => rest),
				usage,
				isError: results.every((r) => !r.ok),
			};
		},
	} as any);
}
