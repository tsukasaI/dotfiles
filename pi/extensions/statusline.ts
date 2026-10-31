/**
 * statusline: replaces pi's footer with a two-row status line in the active
 * theme's colors (pi-side counterpart of claude-code/statusline.ts).
 *
 *   row 1: » dir │ ⎇ branch │ ◇ model │ ↯ thinking │ ⚙ running tool(s)
 *   row 2: context bar % / window │ ≡ in↓ out↑ │ $session · today · month │ rate limit │ extension statuses
 *
 * Today's and this month's cost come from usage-log's JSONL, re-read at session
 * start, turn start, and when the run settles, so they lag by at most the
 * in-flight turn. The rate limit is the most-used Anthropic bucket from the
 * last response's anthropic-ratelimit-* headers (limits are per model).
 * TUI mode only; other modes keep no footer.
 */

import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { costTotals } from "./usage-log.ts";

/** The subset of pi's Theme this file uses; keeps renderLines testable. */
export interface FgTheme {
	fg(color: string, text: string): string;
}

export interface StatusData {
	cwd: string;
	branch: string | null;
	model: string | undefined;
	thinking: string;
	contextPercent: number | null;
	contextWindow: number;
	input: number;
	output: number;
	sessionCost: number;
	todayCost: number;
	monthCost: number;
	/** Top-level tools currently executing, in start order. */
	runningTools: string[];
	rateLimit: RateLimit | undefined;
	statuses: string[];
}

export interface RateLimit {
	/** Bucket closest to its limit: requests, tokens, input, or output. */
	bucket: string;
	usedPercent: number;
	reset?: string;
}

const BUCKETS: [header: string, label: string][] = [
	["requests", "req"],
	["tokens", "tok"],
	["input-tokens", "in"],
	["output-tokens", "out"],
];

/** Pick the most-used bucket from anthropic-ratelimit-* headers; undefined when none are present or parseable. */
export function parseRateLimit(headers: Record<string, string>): RateLimit | undefined {
	const h: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) h[key.toLowerCase()] = value;
	let best: RateLimit | undefined;
	for (const [name, label] of BUCKETS) {
		const limit = Number(h[`anthropic-ratelimit-${name}-limit`]);
		const remaining = Number(h[`anthropic-ratelimit-${name}-remaining`]);
		if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) continue;
		const usedPercent = Math.max(0, Math.min(100, (1 - remaining / limit) * 100));
		if (!best || usedPercent > best.usedPercent) {
			best = { bucket: label, usedPercent, reset: h[`anthropic-ratelimit-${name}-reset`] };
		}
	}
	return best;
}

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export function abbreviateHome(path: string, home = homedir()): string {
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const THINKING_COLOR: Record<string, string> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

function contextColor(pct: number): string {
	return pct >= 90 ? "error" : pct >= 70 ? "warning" : pct >= 50 ? "accent" : "success";
}

export function renderLines(d: StatusData, theme: FgTheme, width: number): string[] {
	const sep = theme.fg("borderMuted", " │ ");

	const row1 = [theme.fg("accent", `» ${abbreviateHome(d.cwd)}`)];
	if (d.branch) row1.push(theme.fg("text", `⎇ ${d.branch}`));
	if (d.model) row1.push(theme.fg("mdHeading", `◇ ${d.model}`));
	row1.push(theme.fg(THINKING_COLOR[d.thinking] ?? "muted", `↯ ${d.thinking}`));
	if (d.runningTools.length > 0) {
		const more = d.runningTools.length > 1 ? ` +${d.runningTools.length - 1}` : "";
		row1.push(theme.fg("toolTitle", `⚙ ${d.runningTools[0]}${more}`));
	}

	const row2: string[] = [];
	if (d.contextPercent !== null) {
		const pct = Math.max(0, Math.min(100, d.contextPercent));
		const filled = Math.round(pct / 10);
		const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
		row2.push(theme.fg(contextColor(pct), `${bar} ${pct.toFixed(1)}%`) + theme.fg("dim", ` / ${k(d.contextWindow)}`));
	} else {
		row2.push(theme.fg("dim", `▱▱▱▱▱▱▱▱▱▱ ?% / ${k(d.contextWindow)}`));
	}
	row2.push(theme.fg("muted", `≡ ${k(d.input)}↓ ${k(d.output)}↑`));
	row2.push(
		theme.fg("warning", `$${d.sessionCost.toFixed(2)}`) +
			theme.fg("dim", ` · today $${d.todayCost.toFixed(2)} · month $${d.monthCost.toFixed(2)}`),
	);
	if (d.rateLimit) {
		const pct = d.rateLimit.usedPercent;
		const color = pct >= 90 ? "error" : pct >= 70 ? "warning" : "muted";
		row2.push(theme.fg(color, `RL ${d.rateLimit.bucket} ${pct.toFixed(0)}%`));
	}
	row2.push(...d.statuses);

	return [truncateToWidth(row1.join(sep), width), truncateToWidth(row2.join(sep), width)];
}

/** Tokens and cost over every entry in the session file, abandoned branches included: they were paid for too. */
export function sessionTotals(entries: readonly any[]): { input: number; output: number; cost: number } {
	const t = { input: 0, output: 0, cost: 0 };
	for (const e of entries) {
		if (e?.type !== "message") continue;
		const m = e.message;
		if (m?.role === "assistant" && m.usage) {
			t.input += m.usage.input ?? 0;
			t.output += m.usage.output ?? 0;
			t.cost += m.usage.cost?.total ?? 0;
		} else if (m?.role === "toolResult" && m.usage) {
			t.cost += m.usage.cost?.total ?? 0;
		}
	}
	return t;
}

export default function statusline(pi: ExtensionAPI) {
	let costs = { today: 0, month: 0 };
	let rateLimit: RateLimit | undefined;
	const running = new Map<string, string>(); // toolCallId -> tool name
	let requestRender: (() => void) | undefined;

	const refreshToday = () => {
		try {
			costs = costTotals();
		} catch {
			// Unreadable log: keep the last value rather than break the footer.
		}
		requestRender?.();
	};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		refreshToday();
		install(ctx);
	});
	pi.on("turn_start", async () => refreshToday());
	pi.on("turn_end", async () => requestRender?.());
	pi.on("agent_settled", async () => {
		running.clear(); // an aborted run may never send tool_execution_end
		refreshToday();
	});
	pi.on("tool_execution_start", async (event) => {
		if (event.parentToolCallId) return; // nested calls belong to their parent tool
		running.set(event.toolCallId, event.toolName);
		requestRender?.();
	});
	pi.on("tool_execution_end", async (event) => {
		if (running.delete(event.toolCallId)) requestRender?.();
	});
	pi.on("after_provider_response", async (event) => {
		const parsed = parseRateLimit(event.headers ?? {});
		if (parsed) {
			rateLimit = parsed;
			requestRender?.();
		}
	});
	pi.on("model_select", async () => requestRender?.());
	pi.on("thinking_level_select", async () => requestRender?.());

	function install(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose() {
					unsub();
					requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const totals = sessionTotals(ctx.sessionManager.getEntries());
					const usage = ctx.getContextUsage();
					return renderLines(
						{
							cwd: ctx.cwd,
							branch: footerData.getGitBranch(),
							model: ctx.model?.id,
							thinking: pi.getThinkingLevel(),
							contextPercent: usage?.percent ?? null,
							contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
							input: totals.input,
							output: totals.output,
							sessionCost: totals.cost,
							todayCost: costs.today,
							monthCost: costs.month,
							runningTools: [...running.values()],
							rateLimit,
							statuses: [...footerData.getExtensionStatuses().values()],
						},
						theme,
						width,
					);
				},
			};
		});
	}
}
