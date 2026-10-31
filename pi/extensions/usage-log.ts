/**
 * usage-log: append one JSONL record per turn (= one model call) with token
 * usage and cost, and show totals with /usage.
 *
 * Log: $PI_USAGE_LOG_DIR or <agent-dir>/usage, one file per month
 * (YYYY-MM.jsonl, local time). Cost comes from pi's model catalog prices
 * (usage.cost), so models without catalog prices log 0.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Tokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	cost: number;
}

export interface UsageRecord {
	ts: string;
	sessionId: string;
	cwd: string;
	turnIndex: number;
	provider: string;
	model: string;
	stopReason: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	/** Nested model usage reported by tool results in this turn (not part of the main call). */
	toolCost: number;
	toolTokens: number;
}

export function logDir(): string {
	if (process.env.PI_USAGE_LOG_DIR) return process.env.PI_USAGE_LOG_DIR;
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	return join(agentDir, "usage");
}

function localDate(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthFile(d: Date): string {
	return join(logDir(), `${localDate(d).slice(0, 7)}.jsonl`);
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Build a record from a turn_end payload. Returns undefined for non-assistant messages. */
export function toRecord(
	event: { turnIndex: number; message: any; toolResults?: any[] },
	sessionId: string,
	cwd: string,
	now = new Date(),
): UsageRecord | undefined {
	const m = event.message;
	if (!m || m.role !== "assistant" || !m.usage) return undefined;
	const u = m.usage;
	let toolCost = 0;
	let toolTokens = 0;
	for (const r of event.toolResults ?? []) {
		if (!r?.usage) continue;
		toolCost += num(r.usage.cost?.total);
		toolTokens += num(r.usage.totalTokens);
	}
	return {
		ts: now.toISOString(),
		sessionId,
		cwd,
		turnIndex: event.turnIndex,
		provider: String(m.provider ?? ""),
		model: String(m.responseModel ?? m.model ?? ""),
		stopReason: String(m.stopReason ?? ""),
		input: num(u.input),
		output: num(u.output),
		cacheRead: num(u.cacheRead),
		cacheWrite: num(u.cacheWrite),
		totalTokens: num(u.totalTokens),
		cost: {
			input: num(u.cost?.input),
			output: num(u.cost?.output),
			cacheRead: num(u.cost?.cacheRead),
			cacheWrite: num(u.cost?.cacheWrite),
			total: num(u.cost?.total),
		},
		toolCost,
		toolTokens,
	};
}

export function appendRecord(rec: UsageRecord): void {
	mkdirSync(logDir(), { recursive: true });
	appendFileSync(monthFile(new Date(rec.ts)), `${JSON.stringify(rec)}\n`, { mode: 0o600 });
}

export function readMonth(d: Date): UsageRecord[] {
	const file = monthFile(d);
	if (!existsSync(file)) return [];
	const out: UsageRecord[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			// A torn line from a crash must not hide the rest of the month.
		}
	}
	return out;
}

/** Cost logged today and this month (local time), main calls plus nested tool usage. One file read. */
export function costTotals(now = new Date()): { today: number; month: number } {
	const today = localDate(now);
	const t = { today: 0, month: 0 };
	for (const r of readMonth(now)) {
		const c = r.cost.total + r.toolCost;
		t.month += c;
		if (localDate(new Date(r.ts)) === today) t.today += c;
	}
	return t;
}

function sum(recs: UsageRecord[]): Tokens & { turns: number } {
	const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0, turns: 0 };
	for (const r of recs) {
		t.input += r.input;
		t.output += r.output;
		t.cacheRead += r.cacheRead;
		t.cacheWrite += r.cacheWrite;
		t.total += r.totalTokens + r.toolTokens;
		t.cost += r.cost.total + r.toolCost;
		t.turns += 1;
	}
	return t;
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const line = (name: string, t: ReturnType<typeof sum>) =>
	`${name.padEnd(9)} $${t.cost.toFixed(4)}  turns ${t.turns}  in ${k(t.input)}  out ${k(t.output)}  cache r/w ${k(t.cacheRead)}/${k(t.cacheWrite)}`;

export function summarize(recs: UsageRecord[], sessionId: string, now = new Date()): string {
	const today = localDate(now);
	const todays = recs.filter((r) => localDate(new Date(r.ts)) === today);
	const byModel = new Map<string, UsageRecord[]>();
	for (const r of todays) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
	return [
		line("session", sum(recs.filter((r) => r.sessionId === sessionId))),
		line("today", sum(todays)),
		line("month", sum(recs)),
		...[...byModel].map(([model, rs]) => `  ${model}: $${sum(rs).cost.toFixed(4)} (${rs.length} turns)`),
		`log: ${monthFile(now)}`,
	].join("\n");
}

/** Set by subagent.ts for its child pi processes. */
export const SUBAGENT_ENV = "PI_SUBAGENT";

export default function usageLog(pi: ExtensionAPI) {
	let warned = false;

	pi.on("turn_end", async (event, ctx) => {
		// A subagent's usage reaches the parent as its tool result's usage, which
		// the parent's record counts as toolCost; logging it here too would double it.
		if (process.env[SUBAGENT_ENV] === "1") return;
		try {
			const rec = toRecord(event, ctx.sessionManager.getSessionId(), ctx.cwd);
			if (rec) appendRecord(rec);
		} catch (err) {
			if (!warned && ctx.hasUI) ctx.ui.notify(`usage-log: ${(err as Error).message}`, "warning");
			warned = true;
		}
	});

	pi.registerCommand("usage", {
		description: "Show token usage and cost for this session, today, and this month",
		handler: async (_args, ctx) => {
			// Session totals only count this month's file; a session spanning a
			// month boundary shows its current-month part.
			const text = summarize(readMonth(new Date()), ctx.sessionManager.getSessionId());
			if (ctx.hasUI) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});
}
