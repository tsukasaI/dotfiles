import { Database } from "bun:sqlite";
import { join } from "path";
import { expandHome as expandHomeShared } from "../../../lib/home-path";

export const HOME = Bun.env.HOME;

// Overridable for tests (e.g. pointing at a nonexistent path to exercise the
// DB-missing error path) — defaults to the standard claude-logs location.
export function logsDbPath(home: string): string {
  return Bun.env.CLAUDE_LOGS_DB || join(home, ".local", "share", "claude-logs", "logs.db");
}

// project_dir may have HOME redacted to "~" by the SessionEnd hook
// (save-transcript.ts's redactHome) before it was written to logs.db.
export function expandHome(p: string | null | undefined, home: string): string {
  return expandHomeShared(p, home);
}

// Synthetic "user" turns the harness injects — not something the user typed,
// so they must not be mistaken for correction phrases or prompt clusters.
const NON_PROMPT_PREFIXES = [
  "<system-reminder>",
  "<local-command-caveat>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<command-",
  "<bash-",
  "<user-prompt-submit-hook>",
];
const IMAGE_PLACEHOLDER_RE = /^\[image #\d+]/i;

export function isNonPromptText(trimmed: string): boolean {
  if (!trimmed) return true;
  if (NON_PROMPT_PREFIXES.some((p) => trimmed.startsWith(p))) return true;
  return IMAGE_PLACEHOLDER_RE.test(trimmed);
}

// Unfiltered MIN(started_at) across the whole sessions table, independent of
// any scan cutoff. Used to measure how much session history actually exists
// (e.g. "has this machine been logging for >= N days"), which a
// cutoff-filtered scan can never answer: every session that survives the
// cutoff filter is by construction newer than the cutoff, so its age can
// never exceed the cutoff window.
export function oldestSessionMs(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.query<{ oldest: string | null }, []>(`SELECT MIN(started_at) AS oldest FROM sessions`).get();
      const ms = row?.oldest ? Date.parse(row.oldest) : NaN;
      return isNaN(ms) ? null : ms;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export interface ScanResult<T> {
  extracts: T[];
  sessions_scanned: number;
  oldest_session_ms: number | null;
  errors: string[];
  db_unavailable: boolean;
}

// Reads sessions from the claude-logs SQLite DB (written by the SessionEnd
// hook, claude-code/hooks/save-transcript.ts) instead of walking
// ~/.claude/projects/<encoded-cwd>/*.jsonl directly. transcript_raw stores
// the same JSONL text the old per-file walk read, so per-line parsing in
// each caller's extractSession is unchanged. Sessions are fetched one at a
// time (not joined/batched) so peak memory stays proportional to one
// transcript, not the whole ~149MB table.
export function scanSessions<T>(
  dbPath: string,
  cutoffMs: number,
  extractSession: (transcriptJsonl: string, projectDir: string | null) => { extract: T; sessionStartMs: number | null },
): ScanResult<T> {
  const result: ScanResult<T> = {
    extracts: [],
    sessions_scanned: 0,
    oldest_session_ms: null,
    errors: [],
    db_unavailable: false,
  };

  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e) {
    result.errors.push(`could not open logs.db at ${dbPath}: ${e instanceof Error ? e.message : e}`);
    result.db_unavailable = true;
    return result;
  }

  try {
    const sessionRows = db
      .query<{ session_id: string; project_dir: string | null; started_at: string | null }, []>(
        `SELECT session_id, project_dir, started_at FROM sessions ORDER BY started_at ASC`,
      )
      .all();
    const transcriptStmt = db.query<{ transcript_jsonl: string }, [string]>(
      `SELECT transcript_jsonl FROM transcript_raw WHERE session_id = ?`,
    );

    let missingTranscripts = 0;
    for (const row of sessionRows) {
      const startMs = row.started_at ? Date.parse(row.started_at) : NaN;
      if (!isNaN(startMs) && startMs < cutoffMs) continue;

      const trow = transcriptStmt.get(row.session_id);
      if (!trow || !trow.transcript_jsonl) {
        missingTranscripts++;
        continue;
      }

      // Contained per-session: a malformed transcript entry (e.g. a
      // truncated/spliced record) must not abort every session queued
      // behind it in sessionRows.
      try {
        const { extract, sessionStartMs } = extractSession(trow.transcript_jsonl, row.project_dir);
        result.extracts.push(extract);
        result.sessions_scanned++;
        if (sessionStartMs !== null) {
          if (result.oldest_session_ms === null || sessionStartMs < result.oldest_session_ms) {
            result.oldest_session_ms = sessionStartMs;
          }
        }
      } catch (e) {
        result.errors.push(`session ${row.session_id} skipped: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (missingTranscripts > 0) {
      result.errors.push(`${missingTranscripts} session(s) had no transcript_raw row and were skipped`);
    }
  } catch (e) {
    result.errors.push(`logs.db query failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    db.close();
  }

  return result;
}
