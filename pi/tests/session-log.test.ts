import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sessionLog from "../extensions/session-log.ts";
import { parseSession, saveSession } from "../lib/save-session.ts";

const usage = (input: number, output: number, cost: number) => ({ input, output, cacheRead: 100, cacheWrite: 10, cost: { total: cost } });
const lines = [
	{ type: "session", id: "s-1", cwd: "/Users/me/proj", version: 3, timestamp: "2026-10-31T10:00:00Z" },
	{ type: "message", timestamp: "2026-10-31T10:00:01Z", message: { role: "user", content: "key sk-ant-api03-" + "a".repeat(90) } },
	{ type: "message", timestamp: "2026-10-31T10:00:02Z", message: { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage: usage(10, 5, 0.5) } },
	{ type: "message", timestamp: "2026-10-31T10:00:03Z", message: { role: "toolResult", toolName: "subagent", usage: usage(20, 7, 0.25) } },
	{ type: "custom", customType: "goal", timestamp: "2026-10-31T10:00:04Z" },
].map((l) => JSON.stringify(l));

describe("parseSession", () => {
	test("sums assistant and tool-result usage; counts user and assistant messages", () => {
		const m = parseSession([...lines, "not json", "null"]);
		expect(m).toMatchObject({
			sessionId: "s-1",
			cwd: "/Users/me/proj",
			formatVersion: 3,
			model: "anthropic/claude-opus-5-5",
			startedAt: "2026-10-31T10:00:00Z",
			endedAt: "2026-10-31T10:00:04Z",
			inputTokens: 30,
			outputTokens: 12,
			cacheReadTokens: 200,
			numUser: 1,
			numAssistant: 1,
		});
		expect(m.costUsd).toBeCloseTo(0.75, 6);
		expect([...m.dayCounts.values()].reduce((a, b) => a + b, 0)).toBe(2);
	});
	test("no session header, nothing saved", () => {
		expect(saveSession("/nonexistent/db", lines.slice(1).join("\n"), "quit", "/Users/me")).toBeUndefined();
	});
});

describe("saveSession", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-sl-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("writes pi_* tables only, redacted, home-abbreviated, 0600; re-save replaces", () => {
		const db = join(dir, "logs.db");
		saveSession(db, lines.join("\n"), "reload", "/Users/me");
		saveSession(db, lines.join("\n"), "quit", "/Users/me");
		expect(statSync(db).mode & 0o777).toBe(0o600);
		const d = new Database(db);
		const tables = d.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r: any) => r.name);
		expect(tables).toEqual(["pi_session_days", "pi_sessions", "pi_transcript_raw"]);
		expect(d.query("SELECT project_dir, end_reason, cost_usd FROM pi_sessions").all()).toEqual([
			{ project_dir: "~/proj", end_reason: "quit", cost_usd: 0.75 },
		]);
		const raw = (d.query("SELECT transcript_jsonl FROM pi_transcript_raw").get() as any).transcript_jsonl;
		expect(raw).not.toContain("a".repeat(90));
		d.close();
	});
});

describe("extension", () => {
	function fire(file: string | undefined, env?: string) {
		const calls: string[][] = [];
		let h: Function | undefined;
		if (env) process.env.PI_SUBAGENT = env;
		try {
			sessionLog({ on: (_e: string, fn: Function) => (h = fn) } as any, (a) => calls.push(a));
		} finally {
			delete process.env.PI_SUBAGENT;
		}
		h?.({ reason: "quit" }, { sessionManager: { getSessionFile: () => file } });
		return calls;
	}
	test("launches the saver with the session file; skips without a file or in a subagent", () => {
		expect(fire("/s.jsonl")).toEqual([["/s.jsonl", "quit"]]);
		expect(fire(undefined)).toEqual([]);
		expect(fire("/s.jsonl", "1")).toEqual([]);
	});
});
