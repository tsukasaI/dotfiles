# Claude Code Hooks

Hook scripts for Claude Code, configured in `~/.claude/settings.json`.

## Hooks

### PreToolUse

| Script | Matcher | Description |
|---|---|---|
| `block-dangerous.sh` | `Bash` | Block dangerous shell commands defined in `blocklist.conf`; commands matching `allowlist.conf` bypass the blocklist |
| `block-config-edit.sh` | `Edit\|Write` | Block edits to linter/formatter config files |
| `slop-guard.ts` | `Edit\|Write` | Deny prose edits (`.md`/`.mdx`/`.txt`) that newly introduce an em dash or a cliché phrase from `slop-phrases.conf`; only the net-new count vs. the pre-edit text is checked, never the whole file. `SLOP_GUARD_DISABLE=1` disables it. |

### PostToolUse

| Script | Matcher | Description |
|---|---|---|
| (inline) `fini` | `Edit\|Write` | Auto-format edited files with fini |
| `mark-session-edit.sh` | `Edit\|Write\|NotebookEdit` | Record edited file paths per `session_id` so `warn-uncommitted.sh` can scope its reminder to this session's own edits |

### Stop

| Script | Matcher | Description |
|---|---|---|
| `warn-uncommitted.sh` | `""` | Remind the agent to commit before ending the turn — scoped to files THIS session edited (per its `mark-session-edit.sh` manifest), not the whole working tree, so a concurrent session sharing the repo can't trigger a spurious reminder |
| `slop-guard.ts` | `""` | Block the turn once if the last assistant reply mixes an unexpected Hangul/Cyrillic run into otherwise Japanese-context text (script-mixing decoding artifact). `SLOP_GUARD_DISABLE=1` disables it. |

### SessionEnd

| Script | Matcher | Description |
|---|---|---|
| `save-transcript.ts` | `*` | Save session transcript to SQLite (async) |

### SessionStart

| Script | Matcher | Description |
|---|---|---|
| `~/.claude/hooks/herdr-agent-state.sh` | `*` | Reports agent session state to `herdr`. **Not part of this repo** — self-installed by the `herdr` flake package outside `setup.sh`'s symlinks; see root `README.md` Prerequisites/Troubleshooting. |

## Session Edit Manifests

`mark-session-edit.sh` records every Edit/Write/NotebookEdit `file_path` (or
`notebook_path`) for the current session at
`${TMPDIR:-/tmp}/claude-session-edits/<session_id>`, one NUL-delimited path
per record. `warn-uncommitted.sh` reads it back to scope its reminder to
this session's own edits.

**Lifecycle**: no explicit cleanup — macOS's periodic daily job clears files
under `$TMPDIR` unaccessed for 3+ days. A session resumed via `--resume`
gets a new `session_id`, so its manifest resets (acceptable for a
best-effort reminder).

## Session Log Storage

Session transcripts are persisted to SQLite at `~/.local/share/claude-logs/logs.db`.

**Retention**: no automatic deletion. Every row stays local until the user manually
runs `push-to-turso.sh`, which is the only thing that ever removes rows (and only
after confirming the upload against Turso). The hook prints a stderr warning
(non-fatal) if the DB file + WAL exceed 150MB, prompting a manual push.

### Schema

```sql
sessions (
  session_id TEXT PRIMARY KEY,
  project_dir TEXT,
  git_branch TEXT,
  model TEXT,
  claude_version TEXT,
  started_at TEXT,      -- ISO 8601
  ended_at TEXT,        -- ISO 8601
  end_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  num_user_messages INTEGER,
  num_assistant_messages INTEGER
)

transcript_raw (
  session_id TEXT PRIMARY KEY,
  transcript_jsonl TEXT,  -- raw JSONL content
  size_bytes INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
)

session_days (
  session_id TEXT,
  day TEXT,
  message_count INTEGER DEFAULT 0,
  PRIMARY KEY (session_id, day),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
)
```

### Quick Commands

```bash
DB=~/.local/share/claude-logs/logs.db

# List all sessions
sqlite3 -header -column "$DB" "SELECT session_id, project_dir, model, started_at, input_tokens + output_tokens AS tokens FROM sessions ORDER BY started_at DESC;"

# Recent 10 sessions
sqlite3 -header -column "$DB" "SELECT session_id, project_dir, model, started_at, num_user_messages AS msgs, input_tokens + output_tokens AS tokens FROM sessions ORDER BY started_at DESC LIMIT 10;"

# Total token usage by project
sqlite3 -header -column "$DB" "SELECT project_dir, COUNT(*) AS sessions, SUM(input_tokens + output_tokens) AS total_tokens FROM sessions GROUP BY project_dir ORDER BY total_tokens DESC;"

# Model usage breakdown
sqlite3 -header -column "$DB" "SELECT model, COUNT(*) AS sessions, SUM(output_tokens) AS output FROM sessions GROUP BY model;"

# Sessions in a date range
sqlite3 -header -column "$DB" "SELECT session_id, project_dir, model, started_at, input_tokens + output_tokens AS tokens FROM sessions WHERE started_at >= '2026-03-01' ORDER BY started_at;"

# Search transcript content
sqlite3 -header -column "$DB" "SELECT s.session_id, s.project_dir, s.started_at FROM transcript_raw t JOIN sessions s ON t.session_id = s.session_id WHERE t.transcript_jsonl LIKE '%keyword%';"

# DB size
ls -lh "$DB"

# Record count
sqlite3 "$DB" "SELECT COUNT(*) || ' sessions, ' || (SELECT COUNT(*) FROM transcript_raw) || ' transcripts' FROM sessions;"
```

### Runtime

- **Runtime**: Bun (uses `bun:sqlite` built-in)
- **Trigger**: `SessionEnd` hook (async, non-blocking)
- **Storage**: `~/.local/share/claude-logs/logs.db`
