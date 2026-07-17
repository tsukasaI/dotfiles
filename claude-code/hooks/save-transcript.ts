#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { readFileSync, mkdirSync, realpathSync, chmodSync, statSync, existsSync, writeFileSync } from "fs";
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

// Computed lazily (not at module scope) so a missing HOME throws inside the
// top-level try/catch below instead of crashing the process before the
// fail-safe is installed (both callers below only run inside that try).
function dbDir(): string {
  return join(Bun.env.HOME!, ".local", "share", "claude-logs");
}
function dbPath(): string {
  return join(dbDir(), "logs.db");
}

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
  CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
`;

// --- Size warning (#40) ---
// transcript_raw stores the full JSONL text per session and is the dominant
// contributor to logs.db's unbounded growth (239MB + 42MB WAL observed). We
// deliberately do NOT auto-prune it here: push-to-turso.sh only deletes a
// local row after its upload is confirmed against Turso, so every row still
// present in logs.db is by definition not yet archived — an age-based
// auto-prune in this hook would silently destroy transcripts whose only copy
// was local (e.g. the user hasn't run the manual push in >30 days). Per the
// issue's own recommendation, the sanctioned floor is a size warning; the
// only way rows leave logs.db is the user running push-to-turso.sh by hand.
const DB_SIZE_WARN_BYTES = 150 * 1024 * 1024; // 150MB soft warning threshold

function warnIfDbTooLarge(): void {
  try {
    const DB_PATH = dbPath();
    const mainSize = statSync(DB_PATH).size;
    const walPath = `${DB_PATH}-wal`;
    const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
    const totalMb = (mainSize + walSize) / 1024 / 1024;
    if (mainSize + walSize > DB_SIZE_WARN_BYTES) {
      console.error(
        `[save-transcript] warning: logs.db is ${totalMb.toFixed(1)}MB (threshold ${(DB_SIZE_WARN_BYTES / 1024 / 1024).toFixed(0)}MB) — run push-to-turso.sh by hand to archive and compact`,
      );
    }
  } catch {
    // best-effort; never fail the hook over a size check
  }
}

function openDb(): Database {
  const DB_DIR = dbDir();
  const DB_PATH = dbPath();
  mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  // Pre-create the file ourselves at 0o600 before Database's own create-if-
  // missing open(), which follows the process umask (commonly 0o644) — that
  // left a window where logs.db briefly existed world/group-readable until
  // the chmodSync below ran. O_CREAT|O_EXCL ("wx") makes this race-free: it
  // no-ops if the file already exists, and fails only on a genuine create
  // race with another process (benign here — the file it created is also
  // 0o600 by the time either process gets to chmodSync).
  if (!existsSync(DB_PATH)) {
    try {
      writeFileSync(DB_PATH, "", { mode: 0o600, flag: "wx" });
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
  }
  const db = new Database(DB_PATH, { create: true });
  chmodSync(DB_PATH, 0o600);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(SCHEMA);
  return db;
}

// --- Redaction (#4) ---
// The transcript is stored locally and may later be pushed verbatim to
// Turso (push-to-turso.sh), so mask well-known credential formats before
// they ever reach the DB. Regex-based on purpose: running gitleaks at
// SessionEnd would add process-spawn latency to every session close.
// Patterns are prefix-identifiable formats only — generic entropy
// heuristics would mangle ordinary code discussion in the transcript.
// Replacements contain no quotes/backslashes, so JSONL stays parseable.

const REDACTIONS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED:private-key]",
  ],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "[REDACTED:anthropic-key]"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED:api-key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED:github-token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED:github-token]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED:slack-token]"],
  [/\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, "[REDACTED:aws-key-id]"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "[REDACTED:google-key]"],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "[REDACTED:jwt]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g, "Bearer [REDACTED:token]"],
];

function redactSecrets(text: string): string {
  let out = text;
  for (const [re, label] of REDACTIONS) out = out.replace(re, label);
  return out;
}

// project_dir is later surfaced by harvest.ts (sessionStats) into the
// /weekly-digest skill, which may post it to a GitHub issue in ops_repo — an
// absolute path embeds the OS username, so redact the HOME prefix at this
// logging boundary rather than trusting every downstream consumer to do it.
function redactHome(path: string): string {
  const home = Bun.env.HOME;
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

// --- Transcript parsing ---

// ts is an ISO 8601 UTC timestamp; bucket by local calendar day so late-night/
// early-morning sessions attribute to the day the user experienced, not the
// UTC day (see _shared/harvest.ts localYMD for the same fix in a sibling file).
function localDay(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
      const day = localDay(ts);
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

try {
  const input: HookInput = await Bun.stdin.json();

  const claudeDir = join(Bun.env.HOME!, ".claude");
  const resolved = realpathSync(input.transcript_path);
  if (!resolved.startsWith(claudeDir + "/")) process.exit(0);

  const transcript = readFileSync(resolved, "utf-8");
  const lines = transcript.split("\n").filter((l) => l.trim());
  const meta = parseTranscript(lines);

  const endReason = input.reason ?? input.hook_event_name;
  const db = openDb();
  db.transaction(() => {
    saveSession(db, input.session_id, redactHome(input.cwd), endReason, meta);
    saveTranscript(db, input.session_id, redactSecrets(transcript));
    saveSessionDays(db, input.session_id, meta.dayCounts);
  })();
  db.close();
  warnIfDbTooLarge();
} catch (err) {
  console.error(`[save-transcript] failed: ${err instanceof Error ? err.message : err}`);
  process.exit(0);
}
