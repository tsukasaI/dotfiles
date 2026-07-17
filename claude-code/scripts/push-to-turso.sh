#!/usr/bin/env bash
#
# Manual store-and-forward: push locally-accumulated Claude Code logs to Turso, then
# physically delete the rows that were sent. Run BY HAND by the user — never by Claude
# Code or any hook.
#
# Auth: uses the `turso` CLI session (`turso auth login`). No token is read from the
# environment, a file, or the keychain — so the Turso token never enters Claude's
# process tree. Claude must not run this script or any `turso` command.
#
# Flow (one-shot bulk migration / drain):
#   1. Take a WAL-consistent snapshot of the local DB (.backup) so we don't race the hook.
#   2. Create the Turso schema if absent (CREATE TABLE IF NOT EXISTS).
#   3. Stream the snapshot's rows as INSERTs inside one transaction (.bail on) to Turso.
#   4. Gate deletion on BOTH: the push exited 0 AND per-table counts reconcile.
#   5. Delete from the LIVE local DB only the rows that were in the snapshot, then VACUUM
#      to reclaim space. Rows added by the hook after the snapshot are left intact.
#
# On any doubt the script keeps the local data and exits non-zero (fail-safe).
# INSERT OR IGNORE makes re-runs idempotent (existing rows are skipped).
#
# REDACTION (#4): save-transcript.ts masks well-known credential formats at
# write time since 2026-07-13, but transcript_raw rows written BEFORE that
# date were stored raw and may contain unredacted secrets. Review old rows
# before the first push.
#
# Flags:
#   --keep-local   push + verify, but do NOT delete (recommended for the first run)

set -euo pipefail

DB="$HOME/.local/share/claude-logs/logs.db"
TURSO_DB="${TURSO_DB_NAME:-cc-logs}"
TABLES=(sessions transcript_raw session_days)

KEEP_LOCAL=0
for arg in "$@"; do
  case "$arg" in
    --keep-local) KEEP_LOCAL=1 ;;
    *) echo "未知の引数: $arg (使えるのは --keep-local)" >&2; exit 2 ;;
  esac
done

# --- Preflight ---
command -v turso   >/dev/null 2>&1 || { echo "turso CLI が見つかりません。README参照。" >&2; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 が見つかりません。" >&2; exit 1; }
[ -f "$DB" ] || { echo "ローカルDBがありません: $DB" >&2; exit 1; }

# --- 1. WAL-consistent snapshot ---
SNAP="$(mktemp -t claude-logs-snap.XXXXXX)"
PUSH_SQL="$(mktemp -t claude-logs-push.XXXXXX)"
trap 'rm -f "$SNAP" "$SNAP-wal" "$SNAP-shm" "$PUSH_SQL"' EXIT
sqlite3 "$DB" ".backup '$SNAP'"

echo "Local DB: $DB"
echo "Turso DB: $TURSO_DB"
echo "Mode:     $([ "$KEEP_LOCAL" -eq 1 ] && echo 'keep-local (削除なし)' || echo 'send + delete')"
echo "--- snapshot counts ---"
for t in "${TABLES[@]}"; do
  printf '  %-15s %s\n' "$t" "$(sqlite3 "$SNAP" "SELECT count(*) FROM $t;")"
done

# --- 2. Schema on Turso (idempotent; data columns only, identical to local) ---
echo "Ensuring Turso schema..."
turso db shell "$TURSO_DB" <<'SQL'
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
SQL

# --- 3. Push rows ---
# Notes on `turso db shell` / libSQL constraints discovered in practice:
#   - no sqlite dot-commands (.bail), and BEGIN/COMMIT are NOT honored as one atomic txn
#     (each statement autocommits) — so partial pushes persist.
#   - libSQL lacks unistr(), which modern sqlite `.mode insert` emits for control chars.
# We therefore build the INSERTs ourselves with the SQL quote() function (standard literal,
# control bytes raw, single quotes doubled — libSQL-compatible and safe for multi-line
# transcripts) and use INSERT OR IGNORE so re-runs after a partial push are idempotent.
SESSIONS_SQL="SELECT 'INSERT OR IGNORE INTO sessions (session_id,project_dir,git_branch,model,claude_version,started_at,ended_at,end_reason,input_tokens,output_tokens,num_user_messages,num_assistant_messages) VALUES ('||quote(session_id)||','||quote(project_dir)||','||quote(git_branch)||','||quote(model)||','||quote(claude_version)||','||quote(started_at)||','||quote(ended_at)||','||quote(end_reason)||','||quote(input_tokens)||','||quote(output_tokens)||','||quote(num_user_messages)||','||quote(num_assistant_messages)||');' FROM sessions;"
TRANSCRIPT_SQL="SELECT 'INSERT OR IGNORE INTO transcript_raw (session_id,transcript_jsonl,size_bytes) VALUES ('||quote(session_id)||','||quote(transcript_jsonl)||','||quote(size_bytes)||');' FROM transcript_raw;"
DAYS_SQL="SELECT 'INSERT OR IGNORE INTO session_days (session_id,day,message_count) VALUES ('||quote(session_id)||','||quote(day)||','||quote(message_count)||');' FROM session_days;"

echo "Pushing rows..."
# Each producer writes to a shared file rather than feeding a pipe: a brace-group
# piped into another command only exposes the LAST command's exit status, so an
# earlier sqlite3 failure would go unnoticed. Chaining with && checks every
# producer's exit code individually before we ever call the push a success.
if sqlite3 "$SNAP" "$SESSIONS_SQL" > "$PUSH_SQL" \
   && sqlite3 "$SNAP" "$TRANSCRIPT_SQL" >> "$PUSH_SQL" \
   && sqlite3 "$SNAP" "$DAYS_SQL" >> "$PUSH_SQL" \
   && turso db shell "$TURSO_DB" < "$PUSH_SQL"; then
  echo "送信コマンド成功。"
else
  echo "送信に失敗しました。ローカルは無変更（次回は OR IGNORE で再開可能）。" >&2
  exit 1
fi

# --- 4. Snapshot-scoped confirmation gate ---
# Compare, per table, how many of THIS snapshot's rows are present in Turso (scoped by the
# snapshot's session_ids), not Turso's total count. Total counts would wrongly pass on
# incremental drains (Turso keeps all history while local is drained), risking deletion of
# rows that never made it. Scoping to the snapshot keeps the gate safe on every run.
remote_confirmed() {
  # $1 = table. Count Turso rows whose session_id is in this snapshot's set for that table.
  local ids
  ids="$(sqlite3 "$SNAP" "SELECT group_concat(quote(session_id)) FROM (SELECT DISTINCT session_id FROM $1);")"
  [ -z "$ids" ] && { echo 0; return; }
  turso db shell "$TURSO_DB" "SELECT count(*) FROM $1 WHERE session_id IN ($ids);" 2>/dev/null | tr -dc '0-9'
}

echo "--- snapshot-scoped confirmation (local snapshot vs Turso) ---"
gate_ok=1
for t in "${TABLES[@]}"; do
  l="$(sqlite3 "$SNAP" "SELECT count(*) FROM $t;")"
  r="$(remote_confirmed "$t")"
  if [ -n "$r" ] && [ "$r" -ge "$l" ] 2>/dev/null; then
    printf '  %-15s local=%s turso(scoped)=%s OK\n' "$t" "$l" "$r"
  else
    printf '  %-15s local=%s turso(scoped)=%s MISMATCH\n' "$t" "$l" "${r:-?}"
    gate_ok=0
  fi
done

if [ "$gate_ok" -ne 1 ]; then
  echo "件数照合に失敗。ローカルは削除しません。Tursoの内容を確認してください。" >&2
  exit 1
fi

if [ "$KEEP_LOCAL" -eq 1 ]; then
  echo "--keep-local 指定: 送信・照合OKですがローカルは保持します。"
  exit 0
fi

# --- 5. Delete only the snapshot rows from the LIVE DB (children before parent) ---
echo "Deleting confirmed rows from local..."
sqlite3 "$DB" <<SQL
ATTACH '$SNAP' AS snap;
PRAGMA foreign_keys=OFF;
BEGIN IMMEDIATE;
DELETE FROM transcript_raw WHERE session_id IN (SELECT session_id FROM snap.transcript_raw);
DELETE FROM session_days   WHERE (session_id, day) IN (SELECT session_id, day FROM snap.session_days);
DELETE FROM sessions       WHERE session_id IN (SELECT session_id FROM snap.sessions);
COMMIT;
DETACH snap;
SQL

echo "VACUUM (reclaiming space)..."
sqlite3 "$DB" "VACUUM;"

echo "--- remaining local rows (added after snapshot, if any) ---"
for t in "${TABLES[@]}"; do
  printf '  %-15s %s\n' "$t" "$(sqlite3 "$DB" "SELECT count(*) FROM $t;")"
done
echo "完了: 送信済み行をローカルから削除しました。"
