#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// --- Types ---

interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
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
`;

function openDb(): Database {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
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

// --- Main ---

const input: HookInput = await Bun.stdin.json();

if (!input.transcript_path || !existsSync(input.transcript_path)) {
  process.exit(0);
}

const transcript = readFileSync(input.transcript_path, "utf-8");
const lines = transcript.split("\n").filter((l) => l.trim());
const meta = parseTranscript(lines);

const db = openDb();
saveSession(db, input.session_id, input.cwd, input.hook_event_name, meta);
saveTranscript(db, input.session_id, transcript);
db.close();
