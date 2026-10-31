/**
 * goal: `/goal <condition>` keeps the agent working until a small evaluator
 * model, reading only the transcript, says the condition is met. Pi's
 * counterpart to Claude Code's /goal, so mkgoal statements run unchanged.
 *
 * The condition is sent as the first prompt. At each agent_before_settle the
 * evaluator (Haiku, named as a physical model) answers met / not met; not met
 * appends the reason as a custom message and asks for one more run.
 * The loop ends when the evaluator says met, at the turn cap, on `/goal stop`,
 * when a run is aborted or fails, and when the evaluator call or its answer
 * fails (fail-closed: an unjudged turn never continues).
 *
 * State lives in "goal" custom entries, so it follows branches and resumes.
 * Evaluator cost goes to usage-log's JSONL as its own record, and into the
 * session total via the entry's evalUsage (statusline reads it).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendRecord, SUBAGENT_ENV, toRecord } from "./usage-log.ts";

export const GOAL_ENTRY = "goal";
export const EVAL_PROVIDER = "anthropic";
export const EVAL_MODEL = "claude-haiku-5-5";
export const DEFAULT_MAX_TURNS = 20;
const EVAL_TIMEOUT_MS = 120_000;
// Haiku sees the tail of the transcript; the latest turns decide the verdict.
const TRANSCRIPT_CHARS = 60_000;
const TOOL_RESULT_HEAD = 400;
const TOOL_RESULT_TAIL = 1_600;

export type GoalResult = "met" | "limit" | "stopped" | "aborted" | "eval-failed";

export interface GoalState {
	condition: string;
	maxTurns: number;
	/** Agent runs judged so far, the one started by /goal included. */
	turns: number;
	active: boolean;
	result?: GoalResult;
	reason?: string;
	evalUsage?: any;
}

const SYSTEM_PROMPT = `You judge whether a coding agent has met a goal condition. You see only the condition and the transcript; you cannot run anything.
Rules:
- Judge only from evidence visible in the transcript (command output, tool results, the agent's final messages). An agent's claim without shown evidence does not count.
- If the condition says to stop after N turns, the turn count given to you is the number of turns used so far.
- Reply with exactly one line of JSON and nothing else: {"met": true or false, "reason": "<one short sentence: what evidence decided it, or what is still missing>"}`;

/** `/goal` arguments: `stop`, `[--max N] <condition>`, or empty for status. */
export function parseArgs(raw: string): { kind: "status" } | { kind: "stop" } | { kind: "start"; condition: string; maxTurns: number } | { kind: "error"; message: string } {
	let s = raw.trim();
	if (!s) return { kind: "status" };
	if (s === "stop" || s === "clear") return { kind: "stop" };
	let max: number | undefined;
	const flag = s.match(/^--max(?:=|\s+)(\S+)\s*/);
	if (flag) {
		max = Number(flag[1]);
		if (!Number.isInteger(max) || max < 1) return { kind: "error", message: `--max needs a positive integer, got "${flag[1]}"` };
		s = s.slice(flag[0].length).trim();
	}
	if (!s) return { kind: "error", message: "usage: /goal [--max N] <condition> | /goal stop" };
	// mkgoal writes its cap into the statement ("or stop after N turns"); use it
	// so the hard cap never cuts a goal shorter than its own text allows.
	const stated = s.match(/stop after (\d+) turns?/i);
	return { kind: "start", condition: s, maxTurns: max ?? (stated ? Number(stated[1]) : DEFAULT_MAX_TURNS) };
}

function clip(text: string): string {
	if (text.length <= TOOL_RESULT_HEAD + TOOL_RESULT_TAIL + 50) return text;
	return `${text.slice(0, TOOL_RESULT_HEAD)}\n…[${text.length - TOOL_RESULT_HEAD - TOOL_RESULT_TAIL} chars omitted]…\n${text.slice(-TOOL_RESULT_TAIL)}`;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((b: any) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : ""))
		.filter(Boolean)
		.join("\n");
}

/** Plain-text transcript of the model-visible messages, newest kept when over the limit. Thinking is left out. */
export function renderTranscript(messages: readonly any[], limit = TRANSCRIPT_CHARS): string {
	const parts: string[] = [];
	for (const m of messages) {
		if (m?.role === "user") parts.push(`[user]\n${textOf(m.content)}`);
		else if (m?.role === "assistant") {
			for (const b of Array.isArray(m.content) ? m.content : []) {
				if (b?.type === "text" && b.text.trim()) parts.push(`[assistant]\n${b.text}`);
				else if (b?.type === "toolCall") parts.push(`[tool call: ${b.name}]\n${clip(JSON.stringify(b.arguments ?? {}))}`);
			}
		} else if (m?.role === "toolResult") parts.push(`[tool result: ${m.toolName ?? "?"}${m.isError ? ", error" : ""}]\n${clip(textOf(m.content))}`);
		else if (m?.content) parts.push(`[${m.role ?? "message"}]\n${clip(textOf(m.content))}`);
	}
	const all = parts.join("\n\n");
	return all.length <= limit ? all : `…[earlier transcript omitted]…\n${all.slice(-limit)}`;
}

/** Strict verdict parse: anything but a boolean `met` is a failed evaluation. */
export function parseVerdict(text: string): { met: boolean; reason: string } | undefined {
	const json = text.match(/\{[\s\S]*\}/);
	if (!json) return undefined;
	try {
		const v = JSON.parse(json[0]);
		if (typeof v?.met !== "boolean") return undefined;
		return { met: v.met, reason: typeof v.reason === "string" ? v.reason.trim() : "" };
	} catch {
		return undefined;
	}
}

/** Latest goal state on the active branch. */
export function restoreState(branch: readonly any[]): GoalState | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const e = branch[i];
		if (e?.type === "custom" && e.customType === GOAL_ENTRY && e.data?.condition) return e.data as GoalState;
	}
	return undefined;
}

export type Evaluate = (state: GoalState, transcript: string, ctx: any) => Promise<{ verdict?: { met: boolean; reason: string }; error?: string; reply?: any }>;

export const evaluateWithModel: Evaluate = async (state, transcript, ctx) => {
	const model = ctx.modelRegistry.find(EVAL_PROVIDER, EVAL_MODEL);
	if (!model) return { error: `${EVAL_PROVIDER}/${EVAL_MODEL} is not in the catalog` };
	const timeout = AbortSignal.timeout(EVAL_TIMEOUT_MS);
	const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
	const prompt = `## Goal condition\n${state.condition}\n\n## Turns used\n${state.turns} (hard cap ${state.maxTurns})\n\n## Transcript\n${transcript}`;
	const reply = await ctx.modelRegistry
		.streamSimple(model, { systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] }, { maxTokens: 1024, signal } as any)
		.result();
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return { error: reply.errorMessage || reply.stopReason, reply };
	const verdict = parseVerdict(textOf(reply.content));
	return verdict ? { verdict, reply } : { error: `unparseable verdict: ${textOf(reply.content).slice(0, 200)}`, reply };
};

const RESULT_TEXT: Record<GoalResult, string> = {
	met: "goal met",
	limit: "goal stopped at the turn cap",
	stopped: "goal stopped by /goal stop",
	aborted: "goal stopped: the run was aborted or failed",
	"eval-failed": "goal stopped: evaluation failed",
};

export default function goal(pi: ExtensionAPI, evaluate: Evaluate = evaluateWithModel) {
	if (process.env[SUBAGENT_ENV] === "1") return;
	let state: GoalState | undefined;

	const showStatus = (ctx: any) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("goal", state?.active ? `goal ${state.turns}/${state.maxTurns}` : undefined);
	};
	const notify = (ctx: any, text: string, level: "info" | "warning" | "error" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(text, level);
	};
	const restore = (ctx: any) => {
		state = restoreState(ctx.sessionManager.getBranch());
		showStatus(ctx);
	};

	pi.on("session_start", async (_e, ctx) => restore(ctx));
	pi.on("session_tree", async (_e, ctx) => restore(ctx));

	pi.on("agent_before_settle", async (event: any, ctx: any) => {
		if (!state?.active) return;
		const turns = state.turns + 1;
		const finish = (result: GoalResult, reason: string, evalUsage?: any) => {
			state = { ...state!, turns, active: false, result, reason, evalUsage };
			showStatus(ctx);
			notify(ctx, `${RESULT_TEXT[result]} (${turns}/${state.maxTurns})${reason ? `: ${reason}` : ""}`, result === "met" ? "info" : "warning");
			return { entries: [...event.entries, { type: "custom", customType: GOAL_ENTRY, data: state }] };
		};

		if (event.outcome !== "completed") return finish("aborted", event.outcome);

		let res: Awaited<ReturnType<Evaluate>>;
		try {
			res = await evaluate({ ...state, turns }, renderTranscript(event.context.llmMessages), ctx);
		} catch (err) {
			res = { error: (err as Error).message };
		}
		const usage = res.reply?.usage;
		if (usage) {
			try {
				const rec = toRecord({ turnIndex: -1, message: { ...res.reply, role: "assistant" } }, ctx.sessionManager.getSessionId(), ctx.cwd);
				if (rec) appendRecord(rec);
			} catch {
				// usage-log reports its own write failures; a lost record must not end the goal.
			}
		}
		if (!res.verdict) return finish("eval-failed", res.error ?? "no verdict", usage);
		if (res.verdict.met) return finish("met", res.verdict.reason, usage);
		if (turns >= state.maxTurns) return finish("limit", res.verdict.reason, usage);

		state = { ...state, turns, evalUsage: usage, reason: res.verdict.reason, result: undefined };
		showStatus(ctx);
		return {
			entries: [
				...event.entries,
				{ type: "custom", customType: GOAL_ENTRY, data: state },
				{
					type: "custom_message",
					customType: "goal-continue",
					display: true,
					content: `Goal not met yet (turn ${turns}/${state.maxTurns}). Evaluator: ${res.verdict.reason || "no reason given"}\nKeep working toward the goal:\n${state.condition}`,
				},
			],
			continue: true,
		};
	});

	pi.registerCommand("goal", {
		description: "Work until a Haiku evaluator says the condition is met: /goal [--max N] <condition> | /goal stop | /goal",
		handler: async (args: string, ctx: any) => {
			const cmd = parseArgs(args ?? "");
			if (cmd.kind === "error") return notify(ctx, cmd.message, "error");
			if (cmd.kind === "status") {
				if (!state) return notify(ctx, "no goal in this session");
				const head = state.active ? `goal active, turn ${state.turns}/${state.maxTurns}` : `${RESULT_TEXT[state.result ?? "stopped"]} (${state.turns}/${state.maxTurns})`;
				return notify(ctx, `${head}${state.reason ? `\nlast verdict: ${state.reason}` : ""}\n\n${state.condition}`);
			}
			if (cmd.kind === "stop") {
				if (!state?.active) return notify(ctx, "no active goal");
				// evalUsage is per entry; carrying it over would count that call twice.
				state = { ...state, active: false, result: "stopped", reason: "", evalUsage: undefined };
				pi.appendEntry(GOAL_ENTRY, state);
				showStatus(ctx);
				return notify(ctx, RESULT_TEXT.stopped);
			}
			await ctx.waitForIdle();
			state = { condition: cmd.condition, maxTurns: cmd.maxTurns, turns: 0, active: true };
			pi.appendEntry(GOAL_ENTRY, state);
			showStatus(ctx);
			await pi.sendUserMessage(cmd.condition);
		},
	});
}
