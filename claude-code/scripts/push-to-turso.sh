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
#   2. Create the Turso schema if absent, and confirm the CLI session can reach the DB.
#   3. Stream the snapshot's changed rows (those not yet recorded in the local push_state
#      table as pushed with the same ended_at/size_bytes) as INSERTs to Turso, batched by
#      bytes. `turso db shell` autocommits each statement (not one transaction), so an
#      UPSERT keeps re-runs idempotent.
#   4. Gate deletion on BOTH: the push exited 0 AND per-table counts reconcile. On
#      success, record the snapshot rows in push_state so the next run skips them.
#   5. Delete from the LIVE local DB only the snapshot sessions whose live row is unchanged
#      since the snapshot, then VACUUM to reclaim space. Rows the hook added or re-saved
#      after the snapshot are left intact.
#
# On any doubt the script keeps the local data and exits non-zero (fail-safe).
# Re-runs are idempotent: a row already in Turso is only overwritten by a newer copy
# (a session resumed after an earlier push is re-saved locally with INSERT OR REPLACE).
#
# REDACTION (#4): save-transcript.ts masks well-known credential formats at
# write time since 2026-07-13, but transcript_raw rows written BEFORE that
# date were stored raw and may contain unredacted secrets. Review old rows
# before the first push.
#
# Flags:
#   --keep-local   push + verify, but do NOT delete (recommended for the first run)
#   --full         ignore push_state and push every snapshot row again

set -euo pipefail

DB="$HOME/.local/share/claude-logs/logs.db"
TURSO_DB="${TURSO_DB_NAME:-cc-logs}"
TABLES=(sessions transcript_raw session_days)
# Not a session count: transcripts range from a few KB to 55MB, so a fixed count either
# stacks large ones past the Hrana stream lifetime or wastes a shell start per handful of
# small ones. Batches of 10 sessions averaging ~36MB each pushed reliably, so 50MB stays
# inside what has been observed to work; a single larger session still goes alone.
BATCH_BYTES="${TURSO_PUSH_BATCH_BYTES:-52428800}"

KEEP_LOCAL=0
FULL=0
for arg in "$@"; do
  case "$arg" in
    --keep-local) KEEP_LOCAL=1 ;;
    --full) FULL=1 ;;
    *) echo "未知の引数: $arg (使えるのは --keep-local, --full)" >&2; exit 2 ;;
  esac
done

# --- Preflight ---
command -v turso   >/dev/null 2>&1 || { echo "turso CLI が見つかりません。README参照。" >&2; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 が見つかりません。" >&2; exit 1; }
[ -f "$DB" ] || { echo "ローカルDBがありません: $DB" >&2; exit 1; }
sqlite3 "$DB" "CREATE TABLE IF NOT EXISTS push_state (session_id TEXT PRIMARY KEY, ended_at TEXT, size_bytes INTEGER);"

# --- 1. WAL-consistent snapshot ---
SNAP="$(mktemp -t claude-logs-snap.XXXXXX)"
PUSH_SQL="$(mktemp -t claude-logs-push.XXXXXX)"
CANDIDATES="$(mktemp -t claude-logs-cand.XXXXXX)"
trap 'rm -f "$SNAP" "$SNAP-wal" "$SNAP-shm" "$PUSH_SQL" "$CANDIDATES"' EXIT
sqlite3 "$DB" ".backup '$SNAP'"

echo "Local DB: $DB"
echo "Turso DB: $TURSO_DB"
echo "Mode:     $([ "$KEEP_LOCAL" -eq 1 ] && echo 'keep-local (削除なし)' || echo 'send + delete')$([ "$FULL" -eq 1 ] && echo ', full (全行再送)')"
echo "--- snapshot counts ---"
for t in "${TABLES[@]}"; do
  printf '  %-15s %s\n' "$t" "$(sqlite3 "$SNAP" "SELECT count(*) FROM $t;")"
done

# --- 2. Schema on Turso (idempotent; data columns only, identical to local) ---
echo "Ensuring Turso schema..."
# Not the exit status: `turso db shell` exits 0 even when the CLI is logged out, so only
# a value the server computed proves the session reached the DB.
schema_out="$(turso db shell "$TURSO_DB" 2>&1 <<'SQL'
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
SELECT 'probe' || '-ok' AS result;
SQL
)" || true
case "$schema_out" in
  *probe-ok*) ;;
  *) printf '%s\n' "$schema_out" >&2
     echo "Turso に接続できません（未ログインなら turso auth login）。何も送信していません。" >&2
     exit 1 ;;
esac

# --- 3. Push rows, batched by session ---
# Notes on `turso db shell` / libSQL constraints discovered in practice:
#   - no sqlite dot-commands (.bail), and BEGIN/COMMIT are NOT honored as one atomic txn
#     (each statement autocommits) — so partial pushes persist.
#   - libSQL lacks unistr(), which modern sqlite `.mode insert` emits for control chars.
#   - a single `turso db shell < file` piping the whole snapshot in one call rides one
#     Hrana stream, which expires under a long-running/large input (upstream issues
#     #839, #925, #671, #985) — so we split the push into one shell call per batch of
#     sessions instead of one call for the whole dump.
# We therefore build the INSERTs ourselves with the SQL quote() function (standard literal,
# control bytes raw, single quotes doubled — libSQL-compatible and safe for multi-line
# transcripts). Each INSERT is an UPSERT whose update fires only when the incoming row is
# at least as new, so re-runs after a partial push are idempotent, a resumed session's
# longer transcript replaces the stale remote copy, and an older local row never
# overwrites a newer remote one. The count gate in step 4 cannot catch a stale remote
# row (the count matches either way), so this ordering is what prevents that loss.
sessions_sql() { echo "SELECT 'INSERT INTO sessions (session_id,project_dir,git_branch,model,claude_version,started_at,ended_at,end_reason,input_tokens,output_tokens,num_user_messages,num_assistant_messages) VALUES ('||quote(session_id)||','||quote(project_dir)||','||quote(git_branch)||','||quote(model)||','||quote(claude_version)||','||quote(started_at)||','||quote(ended_at)||','||quote(end_reason)||','||quote(input_tokens)||','||quote(output_tokens)||','||quote(num_user_messages)||','||quote(num_assistant_messages)||') ON CONFLICT(session_id) DO UPDATE SET project_dir=excluded.project_dir,git_branch=excluded.git_branch,model=excluded.model,claude_version=excluded.claude_version,started_at=excluded.started_at,ended_at=excluded.ended_at,end_reason=excluded.end_reason,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,num_user_messages=excluded.num_user_messages,num_assistant_messages=excluded.num_assistant_messages WHERE coalesce(excluded.ended_at,'''') >= coalesce(sessions.ended_at,'''');' FROM sessions WHERE session_id IN ($1);"; }
transcript_sql() { echo "SELECT 'INSERT INTO transcript_raw (session_id,transcript_jsonl,size_bytes) VALUES ('||quote(session_id)||','||quote(transcript_jsonl)||','||quote(size_bytes)||') ON CONFLICT(session_id) DO UPDATE SET transcript_jsonl=excluded.transcript_jsonl,size_bytes=excluded.size_bytes WHERE coalesce(excluded.size_bytes,0) >= coalesce(transcript_raw.size_bytes,0);' FROM transcript_raw WHERE session_id IN ($1);"; }
days_sql() { echo "SELECT 'INSERT INTO session_days (session_id,day,message_count) VALUES ('||quote(session_id)||','||quote(day)||','||quote(message_count)||') ON CONFLICT(session_id,day) DO UPDATE SET message_count=max(coalesce(excluded.message_count,0),coalesce(session_days.message_count,0));' FROM session_days WHERE session_id IN ($1);"; }

push_batch() {
  # $1 = comma-separated quoted session_ids.
  # Each producer writes to a shared file rather than feeding a pipe: a brace-group
  # piped into another command only exposes the LAST command's exit status, so an
  # earlier sqlite3 failure would go unnoticed. Chaining with && checks every
  # producer's exit code individually before we ever call this batch a success.
  sqlite3 "$SNAP" "$(sessions_sql "$1")" > "$PUSH_SQL" \
    && sqlite3 "$SNAP" "$(transcript_sql "$1")" >> "$PUSH_SQL" \
    && sqlite3 "$SNAP" "$(days_sql "$1")" >> "$PUSH_SQL" \
    && turso db shell "$TURSO_DB" < "$PUSH_SQL"
}

changed_filter="p.session_id IS NULL
  OR coalesce(s.ended_at,'') <> coalesce(p.ended_at,'')
  OR coalesce(t.size_bytes,-1) <> coalesce(p.size_bytes,-1)"
[ "$FULL" -eq 1 ] && changed_filter="1"
sqlite3 "$SNAP" "SELECT quote(s.session_id), coalesce(t.size_bytes,0)
  FROM sessions s
  LEFT JOIN transcript_raw t USING (session_id)
  LEFT JOIN push_state p USING (session_id)
  WHERE $changed_filter
  ORDER BY s.session_id;" > "$CANDIDATES"

TOTAL_SESSIONS="$(sqlite3 "$SNAP" "SELECT count(*) FROM sessions;")"
PENDING="$(wc -l < "$CANDIDATES" | tr -dc '0-9')"
echo "Pushing $PENDING of $TOTAL_SESSIONS sessions (残りは送信済みで変更なし), up to $((BATCH_BYTES / 1048576))MB per batch..."
batch_num=0
batch_ids=""
batch_count=0
batch_bytes=0
flush_batch() {
  batch_num=$((batch_num + 1))
  if push_batch "$batch_ids"; then
    echo "  batch $batch_num ($batch_count sessions, $((batch_bytes / 1048576))MB) 送信成功。"
  else
    echo "送信に失敗しました（batch $batch_num）。ローカルは無変更（次回は UPSERT で再開可能）。" >&2
    exit 1
  fi
  batch_ids=""
  batch_count=0
  batch_bytes=0
}
while IFS='|' read -r id size <&3; do
  if [ -n "$batch_ids" ] && [ $((batch_bytes + size)) -gt "$BATCH_BYTES" ]; then
    flush_batch
  fi
  batch_ids="${batch_ids:+$batch_ids,}$id"
  batch_count=$((batch_count + 1))
  batch_bytes=$((batch_bytes + size))
done 3< "$CANDIDATES"
[ -n "$batch_ids" ] && flush_batch
echo "送信コマンド成功。"

# --- 4. Snapshot-scoped confirmation gate ---
# Compare, per table, how many of THIS snapshot's rows are present in Turso (scoped by the
# snapshot's session_ids), not Turso's total count. Total counts would wrongly pass on
# incremental drains (Turso keeps all history while local is drained), risking deletion of
# rows that never made it. Scoping to the snapshot keeps the gate safe on every run.
scoped_count_sql() {
  # $1 = table. Counts Turso rows whose session_id is in this snapshot's set for that table.
  local ids
  ids="$(sqlite3 "$SNAP" "SELECT group_concat(quote(session_id)) FROM (SELECT DISTINCT session_id FROM $1);")"
  echo "(SELECT count(*) FROM $1 WHERE session_id IN (${ids:-NULL}))"
}

echo "--- snapshot-scoped confirmation (local snapshot vs Turso) ---"
gate_sql="SELECT 'gate=' || $(scoped_count_sql sessions) || '/' || $(scoped_count_sql transcript_raw) || '/' || $(scoped_count_sql session_days) AS result;"
gate_out="$(turso db shell "$TURSO_DB" "$gate_sql" 2>/dev/null | grep -oE 'gate=[0-9]+/[0-9]+/[0-9]+' || true)"
remote_counts=()
if [ -n "$gate_out" ]; then
  IFS='/' read -r -a remote_counts <<< "${gate_out#gate=}"
fi
gate_ok=1
for i in "${!TABLES[@]}"; do
  t="${TABLES[$i]}"
  l="$(sqlite3 "$SNAP" "SELECT count(*) FROM $t;")"
  r="${remote_counts[$i]:-}"
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

sqlite3 "$DB" <<SQL
ATTACH '$SNAP' AS snap;
INSERT OR REPLACE INTO push_state (session_id, ended_at, size_bytes)
  SELECT s.session_id, s.ended_at, t.size_bytes
  FROM snap.sessions s LEFT JOIN snap.transcript_raw t USING (session_id);
DETACH snap;
SQL

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
-- Not every snapshot session_id: a session resumed after the snapshot was re-saved with a
-- newer transcript that never reached Turso, so only sessions whose live row still matches
-- the snapshot are removed. The rest stay, and their stale push_state makes the next run send them.
CREATE TEMP TABLE confirmed AS
  SELECT s.session_id
  FROM snap.sessions s
  LEFT JOIN snap.transcript_raw st ON st.session_id = s.session_id
  JOIN main.sessions l ON l.session_id = s.session_id
  LEFT JOIN main.transcript_raw lt ON lt.session_id = s.session_id
  WHERE coalesce(l.ended_at,'') = coalesce(s.ended_at,'')
    AND coalesce(lt.size_bytes,-1) = coalesce(st.size_bytes,-1);
DELETE FROM transcript_raw WHERE session_id IN (SELECT session_id FROM confirmed);
DELETE FROM session_days   WHERE session_id IN (SELECT session_id FROM confirmed);
DELETE FROM sessions       WHERE session_id IN (SELECT session_id FROM confirmed);
DELETE FROM push_state     WHERE session_id IN (SELECT session_id FROM confirmed);
COMMIT;
DETACH snap;
SQL

echo "VACUUM (reclaiming space)..."
sqlite3 "$DB" "VACUUM;"

echo "--- remaining local rows (added or re-saved after snapshot, if any) ---"
for t in "${TABLES[@]}"; do
  printf '  %-15s %s\n' "$t" "$(sqlite3 "$DB" "SELECT count(*) FROM $t;")"
done
echo "完了: 送信済み行をローカルから削除しました。"
