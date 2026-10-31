/**
 * advisor: `consult_advisor` asks Claude Fable for advice on a problem the
 * main model is stuck on. One request, no tools, and no conversation history:
 * the main model writes a structured brief, which keeps the call cheap
 * (Fable costs 2.5x Opus) and forces the problem to be stated clearly.
 *
 * Every call needs the user's confirmation in the TUI, showing the brief and
 * a cost estimate; without a UI the call is refused (fail-closed).
 */

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_ENV } from "./usage-log.ts";

export const ADVISOR_MODEL = "claude-fable-5-1";
export const MAX_OUTPUT_TOKENS = 16_000;

const SYSTEM_PROMPT = `You are a senior advisor consulted by a coding agent on a hard problem. You see only the brief below, not the codebase or the conversation.
Answer with: a recommendation first, the reasoning that makes it right, the main risks or ways it could fail, and concrete next steps the agent can take. If alternatives are close, compare them briefly. If the brief lacks information you need to decide, say exactly what is missing instead of guessing.
Reply in the language of the brief.`;

export interface Brief {
	goal: string;
	background: string;
	problem: string;
	attempts?: string;
	excerpts?: string;
	question: string;
}

export function formatBrief(b: Brief): string {
	const parts = [
		["Goal", b.goal],
		["Background", b.background],
		["Problem to solve", b.problem],
		["Already tried", b.attempts],
		["Key excerpts", b.excerpts],
		["Question", b.question],
	] as const;
	return parts
		.filter(([, v]) => typeof v === "string" && v.trim())
		.map(([k, v]) => `## ${k}\n${(v as string).trim()}`)
		.join("\n\n");
}

/**
 * Upper-bound cost in dollars: input from the brief length (3 chars per token
 * leans high for English and is close for Japanese) plus the full output cap.
 */
export function estimateCost(text: string, cost: { input: number; output: number } | undefined): { input: number; outputCap: number } {
	const rates = cost ?? { input: 10, output: 50 };
	const inputTokens = Math.ceil((SYSTEM_PROMPT.length + text.length) / 3);
	return { input: (inputTokens * rates.input) / 1e6, outputCap: (MAX_OUTPUT_TOKENS * rates.output) / 1e6 };
}

export default function advisor(pi: ExtensionAPI) {
	if (process.env[SUBAGENT_ENV] === "1") return;

	pi.registerTool({
		name: "consult_advisor",
		label: "Advisor",
		description: `Ask Claude Fable (a stronger, ~2.5x pricier model than you) for advice on a genuinely hard problem: subtle design decisions, bugs you could not crack after real attempts, or high-stakes trade-offs. Not for routine questions or anything you can resolve by reading code. The advisor sees ONLY this brief (no files, no conversation), so make it self-contained and structured: what the user wants, the essential background and decisions so far, exactly what must be solved, what was tried and why it failed, and a precise question. The user must approve each call.`,
		promptSnippet: "Ask a stronger model (Fable) for advice on a hard problem, via a self-contained brief",
		promptGuidelines: [
			"Use consult_advisor only for genuinely hard problems after your own attempt; write the brief so it stands alone without the conversation.",
		],
		parameters: Type.Object({
			goal: Type.String({ description: "What the user ultimately wants" }),
			background: Type.String({ description: "Essential context: project, constraints, decisions so far, key points of the conversation" }),
			problem: Type.String({ description: "Exactly what must be solved and where it is stuck" }),
			attempts: Type.Optional(Type.String({ description: "What was tried and why it did not work" })),
			excerpts: Type.Optional(Type.String({ description: "Short code, logs, or errors that matter; keep it minimal" })),
			question: Type.String({ description: "The precise question for the advisor" }),
		}),
		async execute(_id, params: any, signal, _onUpdate, ctx) {
			const model = ctx.modelRegistry.find("anthropic", ADVISOR_MODEL);
			if (!model) throw new Error(`consult_advisor: anthropic/${ADVISOR_MODEL} is not in the catalog`);
			const brief = formatBrief(params as Brief);
			if (!ctx.hasUI) throw new Error("consult_advisor: needs the user's confirmation, which requires the interactive UI");
			const est = estimateCost(brief, (model as any).cost);
			const ok = await ctx.ui.confirm(
				`Consult ${ADVISOR_MODEL}?`,
				`Estimated: input ~$${est.input.toFixed(3)}, output up to $${est.outputCap.toFixed(2)} (cap ${MAX_OUTPUT_TOKENS} tokens)\n\n${brief.slice(0, 3000)}${brief.length > 3000 ? "\n…" : ""}`,
			);
			if (!ok) throw new Error("consult_advisor: the user declined this consultation; continue without it or ask the user");

			const reply = await ctx.modelRegistry
				.streamSimple(
					model,
					{ systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: brief, timestamp: Date.now() }] },
					{ reasoning: "high", maxTokens: MAX_OUTPUT_TOKENS, signal } as any,
				)
				.result();
			const text = reply.content
				.filter((b: any) => b.type === "text")
				.map((b: any) => b.text)
				.join("\n")
				.trim();
			if (reply.stopReason === "error" || reply.stopReason === "aborted" || !text) {
				throw new Error(`consult_advisor: ${reply.errorMessage || reply.stopReason || "empty reply"}`);
			}
			return {
				content: [{ type: "text", text: `## Advisor (${ADVISOR_MODEL})\n\n${text}` }],
				details: { model: ADVISOR_MODEL, stopReason: reply.stopReason },
				usage: reply.usage,
			};
		},
	} as any);
}
