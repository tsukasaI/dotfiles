/**
 * statusline: replaces pi's footer with powerline-style segments (pi-side
 * counterpart of claude-code/statusline.ts). Only the cwd stands out; the
 * other segments alternate two quiet grays so boundaries stay visible, and a
 * context or rate-limit segment turns warning/error colored at 70%/90%.
 *
 *   row 1: » dir  ⎇ branch  ◇ model  ↯ thinking  ⚙ running tool(s)
 *   row 2: context bar % / window  ≡ in↓ out↑  $session · today · month
 *   row 3: rate limit  extension statuses (omitted when both are empty)
 *
 * Today's and this month's cost come from usage-log's JSONL, re-read at session
 * start, turn start, and when the run settles, so they lag by at most the
 * in-flight turn. The rate limit is the most-used Anthropic bucket from the
 * last response's anthropic-ratelimit-* headers (limits are per model).
 * TUI mode only; other modes keep no footer.
 */

import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { colorToRgb, mixColors, truncateToWidth } from "@earendil-works/pi-tui";
import { GOAL_ENTRY } from "./goal.ts";
import { costTotals } from "./usage-log.ts";

export type Role = "cwd" | "quiet" | "quiet2" | "warn" | "crit";

/** Maps segment roles to colors; keeps renderLines testable without pi's Theme. */
export interface SegmentTheme {
	paint(role: Role, text: string): string;
	/** ARROW in `from`'s background over `to`'s background (the terminal's when undefined). */
	arrow(from: Role, to: Role | undefined): string;
}

/** Powerline separator (Nerd Font U+E0B0); the terminal font must be a Nerd Font. */
const ARROW = "\ue0b0";

interface Segment {
	role: Role;
	text: string;
}

function powerline(segments: Segment[], theme: SegmentTheme): string {
	return segments
		.map((s, i) => {
			// An extension status may end in a full reset, which would also clear the segment background.
			const text = s.text.replaceAll("\x1b[0m", "\x1b[39m");
			return theme.paint(s.role, ` ${text} `) + theme.arrow(s.role, segments[i + 1]?.role);
		})
		.join("");
}

type Rgb = { r: number; g: number; b: number };
const luminance = ({ r, g, b }: Rgb) => {
	const c = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const contrast = (a: Rgb, b: Rgb) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const NEAR_BLACK = { kind: "rgb", r: 16, g: 18, b: 22 } as const;
const WHITE = { kind: "rgb", r: 255, g: 255, b: 255 } as const;

/**
 * Adapts pi's Theme. Every color is derived from theme tokens, so segments
 * follow dark/light switches. The theme's own background tokens all share one
 * lightness, which blurs segment boundaries, hence the vivid foreground tokens
 * as backgrounds for cwd/alerts and a lighter mix of toolPendingBg as the
 * second quiet shade.
 */
export function segmentTheme(theme: any): SegmentTheme {
	const c = theme.colors;
	const readableOn = (bg: any) => (contrast(colorToRgb(bg), NEAR_BLACK) >= contrast(colorToRgb(bg), WHITE) ? NEAR_BLACK : WHITE);
	const bgOf: Record<Role, any> = {
		cwd: c.mdLink,
		quiet: c.toolPendingBg,
		quiet2: mixColors(c.toolPendingBg, c.text, 0.18),
		warn: c.warning,
		crit: c.error,
	};
	const fgOf: Record<Role, any> = {
		cwd: readableOn(bgOf.cwd),
		quiet: c.text,
		quiet2: c.text,
		warn: readableOn(bgOf.warn),
		crit: readableOn(bgOf.crit),
	};
	return {
		paint: (role, text) => theme.style(text, { fg: fgOf[role], bg: bgOf[role] }),
		arrow: (from, to) => theme.style(ARROW, { fg: bgOf[from], bg: to ? bgOf[to] : undefined }),
	};
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

function levelRole(pct: number): Role | undefined {
	return pct >= 90 ? "crit" : pct >= 70 ? "warn" : undefined;
}

/** Fills unset roles with the quiet shade that differs from the previous segment, so neighbors never merge. */
function alternate(segments: { role?: Role; text: string }[]): Segment[] {
	const out: Segment[] = [];
	for (const s of segments) {
		const prev = out[out.length - 1]?.role;
		out.push({ role: s.role ?? (prev === "quiet" ? "quiet2" : "quiet"), text: s.text });
	}
	return out;
}

export function renderLines(d: StatusData, theme: SegmentTheme, width: number): string[] {
	const row1: { role?: Role; text: string }[] = [{ role: "cwd", text: `» ${abbreviateHome(d.cwd)}` }];
	if (d.branch) row1.push({ text: `⎇ ${d.branch}` });
	if (d.model) row1.push({ text: `◇ ${d.model}` });
	row1.push({ text: `↯ ${d.thinking}` });
	if (d.runningTools.length > 0) {
		const more = d.runningTools.length > 1 ? ` +${d.runningTools.length - 1}` : "";
		row1.push({ text: `⚙ ${d.runningTools[0]}${more}` });
	}

	const row2: { role?: Role; text: string }[] = [];
	if (d.contextPercent !== null) {
		const pct = Math.max(0, Math.min(100, d.contextPercent));
		const filled = Math.round(pct / 10);
		const bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
		row2.push({ role: levelRole(pct), text: `${bar} ${pct.toFixed(1)}% / ${k(d.contextWindow)}` });
	} else {
		row2.push({ text: `▱▱▱▱▱▱▱▱▱▱ ?% / ${k(d.contextWindow)}` });
	}
	row2.push({ text: `≡ ${k(d.input)}↓ ${k(d.output)}↑` });
	row2.push({ text: `$${d.sessionCost.toFixed(2)} · today $${d.todayCost.toFixed(2)} · month $${d.monthCost.toFixed(2)}` });

	const row3: { role?: Role; text: string }[] = [];
	if (d.rateLimit) {
		const pct = d.rateLimit.usedPercent;
		row3.push({ role: levelRole(pct), text: `RL ${d.rateLimit.bucket} ${pct.toFixed(0)}%` });
	}
	for (const s of d.statuses) row3.push({ text: s });

	const rows = [row1, row2];
	if (row3.length > 0) rows.push(row3);
	return rows.map((r) => truncateToWidth(powerline(alternate(r), theme), width));
}

/** Tokens and cost over every entry in the session file, abandoned branches included: they were paid for too. */
export function sessionTotals(entries: readonly any[]): { input: number; output: number; cost: number } {
	const t = { input: 0, output: 0, cost: 0 };
	for (const e of entries) {
		// goal.ts's evaluator calls are not messages; each goal entry carries its own call's usage.
		if (e?.type === "custom" && e.customType === GOAL_ENTRY && e.data?.evalUsage) {
			t.cost += e.data.evalUsage.cost?.total ?? 0;
			continue;
		}
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
						segmentTheme(theme),
						width,
					);
				},
			};
		});
	}
}
