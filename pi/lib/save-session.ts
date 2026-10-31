#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { abbreviateHome } from "../../claude-code/lib/home-path.ts";
import { redactTranscript } from "../../claude-code/lib/redact.ts";
import { localDay } from "../../claude-code/lib/transcript-parse.ts";

export interface PiSessionMeta {
	sessionId: string;
	cwd: string;
	formatVersion: number;
	model: string;
	startedAt: string;
	endedAt: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	costUsd: number;
	numUser: number;
	numAssistant: number;
	dayCounts: Map<string, number>;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseSession(lines: string[]): PiSessionMeta {
	const m: PiSessionMeta = {
		sessionId: "",
		cwd: "",
		formatVersion: 0,
		model: "",
		startedAt: "",
		endedAt: "",
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0,
		numUser: 0,
		numAssistant: 0,
		dayCounts: new Map(),
	};
	for (const line of lines) {
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e === null || typeof e !== "object") continue;
		const ts = str(e.timestamp);
		if (ts) {
			if (!m.startedAt) m.startedAt = ts;
			m.endedAt = ts;
		}
		if (e.type === "session") {
			m.sessionId = str(e.id);
			m.cwd = str(e.cwd);
			m.formatVersion = num(e.version);
			continue;
		}
		if (e.type !== "message") continue;
		const msg = e.message ?? {};
		// toolResult usage is a subagent's or advisor's spend; leaving it out would undercount the session.
		const u = msg.usage;
		if (u && (msg.role === "assistant" || msg.role === "toolResult")) {
			m.inputTokens += num(u.input);
			m.outputTokens += num(u.output);
			m.cacheReadTokens += num(u.cacheRead);
			m.cacheWriteTokens += num(u.cacheWrite);
			m.costUsd += num(u.cost?.total);
		}
		if (msg.role === "user") m.numUser++;
		else if (msg.role === "assistant") {
			m.numAssistant++;
			if (str(msg.model)) m.model = `${str(msg.provider)}/${str(msg.model)}`;
		} else continue;
		const day = ts ? localDay(ts) : "";
		if (day) m.dayCounts.set(day, (m.dayCounts.get(day) ?? 0) + 1);
	}
	return m;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pi_sessions (
    session_id TEXT PRIMARY KEY,
    project_dir TEXT,
    model TEXT,
    session_format_version INTEGER,
    started_at TEXT,
    ended_at TEXT,
    end_reason TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    num_user_messages INTEGER DEFAULT 0,
    num_assistant_messages INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pi_transcript_raw (
    session_id TEXT PRIMARY KEY,
    transcript_jsonl TEXT,
    size_bytes INTEGER,
    FOREIGN KEY (session_id) REFERENCES pi_sessions(session_id)
  );
  CREATE TABLE IF NOT EXISTS pi_session_days (
    session_id TEXT,
    day TEXT,
    message_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day),
    FOREIGN KEY (session_id) REFERENCES pi_sessions(session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_pi_session_days_day ON pi_session_days(day);
`;

export function defaultDbPath(home: string): string {
	return process.env.PI_SESSION_LOG_DB ?? join(home, ".local", "share", "claude-logs", "logs.db");
}

function openDb(path: string): Database {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	// Not left to Database's create: it follows the umask, so the file would briefly be group/world-readable.
	if (!existsSync(path)) {
		try {
			writeFileSync(path, "", { mode: 0o600, flag: "wx" });
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
		}
	}
	const db = new Database(path, { create: true });
	chmodSync(path, 0o600);
	db.exec("PRAGMA journal_mode=WAL");
	db.exec("PRAGMA busy_timeout=5000");
	db.exec(SCHEMA);
	return db;
}

export function saveSession(dbPath: string, transcript: string, endReason: string, home: string): PiSessionMeta | undefined {
	const meta = parseSession(transcript.split("\n").filter((l) => l.trim()));
	if (!meta.sessionId) return undefined;
	const db = openDb(dbPath);
	try {
		db.transaction(() => {
			db.prepare(
				`INSERT OR REPLACE INTO pi_sessions
         (session_id, project_dir, model, session_format_version, started_at, ended_at, end_reason,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd,
          num_user_messages, num_assistant_messages)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				meta.sessionId,
				abbreviateHome(meta.cwd, home),
				meta.model,
				meta.formatVersion,
				meta.startedAt,
				meta.endedAt,
				endReason,
				meta.inputTokens,
				meta.outputTokens,
				meta.cacheReadTokens,
				meta.cacheWriteTokens,
				meta.costUsd,
				meta.numUser,
				meta.numAssistant,
			);
			const redacted = redactTranscript(transcript);
			db.prepare(`INSERT OR REPLACE INTO pi_transcript_raw (session_id, transcript_jsonl, size_bytes) VALUES (?, ?, ?)`).run(
				meta.sessionId,
				redacted,
				Buffer.byteLength(redacted, "utf8"),
			);
			db.prepare(`DELETE FROM pi_session_days WHERE session_id = ?`).run(meta.sessionId);
			const insert = db.prepare(`INSERT INTO pi_session_days (session_id, day, message_count) VALUES (?, ?, ?)`);
			for (const [day, count] of meta.dayCounts) insert.run(meta.sessionId, day, count);
		})();
	} finally {
		db.close();
	}
	return meta;
}

if (import.meta.main) {
	try {
		const [file, reason = "quit"] = process.argv.slice(2);
		const home = process.env.HOME;
		if (!file || !home) throw new Error("usage: save-session.ts <session.jsonl> [reason]");
		const resolved = realpathSync(file);
		// Not any path: the parent passes what pi reports, but this process reads and stores whatever it is given.
		if (!resolved.startsWith(join(home, ".pi", "agent", "sessions") + "/")) throw new Error(`not a pi session file: ${resolved}`);
		saveSession(defaultDbPath(home), readFileSync(resolved, "utf8"), reason, home);
	} catch (err) {
		console.error(`[save-session] failed: ${err instanceof Error ? err.message : err}`);
	}
}
