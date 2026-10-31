/**
 * model-router: registers the virtual model `router/auto`, which sends each
 * user turn to Haiku, Sonnet, or Opus according to how demanding the request
 * is. Haiku rates the latest user message before the turn starts.
 *
 * Manual override is ordinary model selection: pick a physical model with
 * Ctrl+P or /model (settings.json's enabledModels limits the cycle to these
 * four), and pick router/auto again to return to automatic routing. The
 * selected thinking level passes through to whichever model is chosen.
 *
 * Tool follow-ups and retries stay on the model that handled the turn, so the
 * prompt cache survives within a turn; switching between user turns costs one
 * cache miss. A failed or unparseable rating falls back to Sonnet.
 *
 * The rating call's cost is appended to usage-log's JSONL (so today/month
 * totals include it); pi gives routers no way to add it to the session total.
 */

import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendRecord } from "./usage-log.ts";

export type Tier = "light" | "standard" | "heavy";

const PROVIDER = "anthropic";
export const TIER_MODEL: Record<Tier, string> = {
	light: "claude-haiku-5-5",
	standard: "claude-sonnet-5-5",
	heavy: "claude-opus-5-5",
};
const RATER = TIER_MODEL.light;
const FALLBACK: Tier = "standard";

interface RouterState {
	tier: Tier;
}

const RATER_PROMPT = `You route requests for a coding agent to a model tier. Reply with exactly one word: light, standard, or heavy.

light: questions and explanations, lookups, running or reading a command, small mechanical edits (rename, typo, formatting), routine git operations.
standard: ordinary features, bug fixes, refactors within a few files, tests, code review.
heavy: design or architecture decisions, changes across many files, subtle or long debugging, security-sensitive work, large ambiguous tasks.

If the request is a short acknowledgement or a follow-up that continues the current work (e.g. "OK", "continue", "yes do it"), answer the current tier given below.`;

export function lastUserText(messages: readonly Message[]): string {
	const content = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
	if (typeof content === "string") return content;
	return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

/** First tier word in the rater's reply; undefined when there is none. */
export function parseTier(reply: string): Tier | undefined {
	const m = reply.toLowerCase().match(/\b(light|standard|heavy)\b/);
	return m ? (m[1] as Tier) : undefined;
}

type Rate = (prompt: string, current: Tier | undefined, ctx: ExtensionContext, signal?: AbortSignal) => Promise<Tier | undefined>;

const rateWithHaiku: Rate = async (prompt, current, ctx, signal) => {
	const model = ctx.modelRegistry.find(PROVIDER, RATER);
	if (!model) return undefined;
	const reply = await ctx.modelRegistry.complete(
		model,
		{
			systemPrompt: RATER_PROMPT,
			messages: [
				{
					role: "user",
					content: `Current tier: ${current ?? "none"}\n\nRequest:\n${prompt.slice(0, 8000)}`,
					timestamp: Date.now(),
				},
			],
		},
		{ maxTokens: 16, signal } as any,
	);
	try {
		appendRecord({
			ts: new Date().toISOString(),
			sessionId: ctx.sessionManager.getSessionId?.() ?? "",
			cwd: ctx.cwd,
			turnIndex: -1,
			provider: PROVIDER,
			model: RATER,
			stopReason: `router:${reply.stopReason}`,
			input: reply.usage?.input ?? 0,
			output: reply.usage?.output ?? 0,
			cacheRead: reply.usage?.cacheRead ?? 0,
			cacheWrite: reply.usage?.cacheWrite ?? 0,
			totalTokens: reply.usage?.totalTokens ?? 0,
			cost: {
				input: reply.usage?.cost?.input ?? 0,
				output: reply.usage?.cost?.output ?? 0,
				cacheRead: reply.usage?.cost?.cacheRead ?? 0,
				cacheWrite: reply.usage?.cost?.cacheWrite ?? 0,
				total: reply.usage?.cost?.total ?? 0,
			},
			toolCost: 0,
			toolTokens: 0,
		});
	} catch {
		// Logging is best effort; routing must not fail because the log is unwritable.
	}
	if (reply.stopReason !== "stop") return undefined;
	return parseTier(reply.content.flatMap((b: any) => (b.type === "text" ? [b.text] : [])).join(" "));
};

export interface RouteDeps {
	rate: Rate;
}

/** Route one request; separated from registration so tests can drive it with fakes. */
export async function route(request: any, ctx: ExtensionContext, deps: RouteDeps = { rate: rateWithHaiku }) {
	const pick = (id: string, state?: RouterState) => {
		const model = ctx.modelRegistry.find(PROVIDER, id);
		if (!model) throw new Error(`model-router: ${PROVIDER}/${id} is not in the catalog`);
		return { model, thinkingLevel: request.thinkingLevel, state };
	};

	// Summaries and other out-of-loop calls: Sonnet keeps compaction summaries good without Opus cost.
	if (request.reason === "direct") return pick(TIER_MODEL.standard);
	const sticky = request.reason === "retry" ? request.failed : request.previous;
	if (request.reason !== "user" && sticky?.model?.provider === PROVIDER) {
		return { model: sticky.model, thinkingLevel: request.thinkingLevel };
	}
	if (request.reason !== "user") return pick(TIER_MODEL[(request.state as RouterState | undefined)?.tier ?? FALLBACK]);

	const current = (request.state as RouterState | undefined)?.tier;
	let tier: Tier | undefined;
	try {
		tier = await deps.rate(lastUserText(request.messages), current, ctx, request.signal);
	} catch {
		tier = undefined;
	}
	tier ??= FALLBACK;
	return pick(TIER_MODEL[tier], tier === current ? undefined : { tier });
}

export default function modelRouter(pi: ExtensionAPI) {
	pi.registerVirtualModel<RouterState>({
		provider: "router",
		id: "auto",
		name: "Auto (Haiku / Sonnet / Opus)",
		thinkingLevels: ["off", "low", "medium", "high"],
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		route: (request, ctx) => route(request, ctx) as any,
	});
}
