#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, realpathSync, chmodSync } from "fs";
import { join } from "path";

// --- Types ---

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  reason?: string;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface TranscriptLine {
  type: string;
  timestamp?: string;
  version?: string;
  gitBranch?: string;
  message?: {
    model?: string;
    usage?: Usage;
  };
}

interface SessionMeta {
  model: string;
  version: string;
  gitBranch: string;
  startedAt: string;
  endedAt: string;
  inputTokens: number;
  outputTokens: number;
  numUser: number;
  numAssistant: number;
  dayCounts: Map<string, number>;
}

// --- Database ---

const DB_DIR = join(Bun.env.HOME!, ".local", "share", "claude-logs");
const DB_PATH = join(DB_DIR, "logs.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_dir TEXT,
    git_branch TEXT,
    model TEXT,
    claude_version TEXT,
    started_at TEXT,
    ended_at TEXT,
    end_reason TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    num_user_messages INTEGER DEFAULT 0,
    num_assistant_messages INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS transcript_raw (
    session_id TEXT PRIMARY KEY,
    transcript_jsonl TEXT,
    size_bytes INTEGER,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );
  CREATE TABLE IF NOT EXISTS session_days (
    session_id TEXT,
    day TEXT,
    message_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_session_days_day ON session_days(day);
`;

function openDb(): Database {
  mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(DB_PATH, { create: true });
  chmodSync(DB_PATH, 0o600);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  return db;
}

// --- Transcript parsing ---

function sumTokens(usage: Usage): { input: number; output: number } {
  return {
    input:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    output: usage.output_tokens ?? 0,
  };
}

function parseTranscript(lines: string[]): SessionMeta {
  const meta: SessionMeta = {
    model: "",
    version: "",
    gitBranch: "",
    startedAt: "",
    endedAt: "",
    inputTokens: 0,
    outputTokens: 0,
    numUser: 0,
    numAssistant: 0,
    dayCounts: new Map(),
  };

  for (const line of lines) {
    let entry: TranscriptLine;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = entry.timestamp ?? "";
    if (!meta.startedAt && ts) meta.startedAt = ts;
    if (ts) meta.endedAt = ts;

    const isMessage = entry.type === "user" || entry.type === "assistant";
    if (ts && isMessage) {
      const day = ts.slice(0, 10);
      meta.dayCounts.set(day, (meta.dayCounts.get(day) ?? 0) + 1);
    }

    switch (entry.type) {
      case "user":
        meta.numUser++;
        meta.version ||= entry.version ?? "";
        meta.gitBranch ||= entry.gitBranch ?? "";
        break;

      case "assistant":
        meta.numAssistant++;
        meta.model ||= entry.message?.model ?? "";
        if (entry.message?.usage) {
          const tokens = sumTokens(entry.message.usage);
          meta.inputTokens += tokens.input;
          meta.outputTokens += tokens.output;
        }
        break;
    }
  }

  return meta;
}

// --- Persistence ---

function saveSession(
  db: Database,
  sessionId: string,
  projectDir: string,
  endReason: string,
  meta: SessionMeta,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions
     (session_id, project_dir, git_branch, model, claude_version,
      started_at, ended_at, end_reason,
      input_tokens, output_tokens, num_user_messages, num_assistant_messages)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    projectDir,
    meta.gitBranch,
    meta.model,
    meta.version,
    meta.startedAt,
    meta.endedAt,
    endReason,
    meta.inputTokens,
    meta.outputTokens,
    meta.numUser,
    meta.numAssistant,
  );
}

function saveTranscript(
  db: Database,
  sessionId: string,
  transcript: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO transcript_raw
     (session_id, transcript_jsonl, size_bytes)
     VALUES (?, ?, ?)`,
  ).run(sessionId, transcript, Buffer.byteLength(transcript, "utf-8"));
}

function saveSessionDays(
  db: Database,
  sessionId: string,
  dayCounts: Map<string, number>,
): void {
  db.prepare(`DELETE FROM session_days WHERE session_id = ?`).run(sessionId);
  const insert = db.prepare(
    `INSERT INTO session_days (session_id, day, message_count) VALUES (?, ?, ?)`,
  );
  for (const [day, count] of dayCounts) {
    insert.run(sessionId, day, count);
  }
}

// --- Main ---

const input: HookInput = await Bun.stdin.json();

try {
  const claudeDir = join(Bun.env.HOME!, ".claude");
  const resolved = realpathSync(input.transcript_path);
  if (!resolved.startsWith(claudeDir + "/")) process.exit(0);

  const transcript = readFileSync(resolved, "utf-8");
  const lines = transcript.split("\n").filter((l) => l.trim());
  const meta = parseTranscript(lines);

  const endReason = input.reason ?? input.hook_event_name;
  const db = openDb();
  db.transaction(() => {
    saveSession(db, input.session_id, input.cwd, endReason, meta);
    saveTranscript(db, input.session_id, transcript);
    saveSessionDays(db, input.session_id, meta.dayCounts);
  })();
  db.close();
} catch (err) {
  console.error(`[save-transcript] failed: ${err instanceof Error ? err.message : err}`);
  process.exit(0);
}
