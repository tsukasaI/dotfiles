# Claude Code Hooks

Hook scripts for Claude Code, configured in `~/.claude/settings.json`.

## Hooks

### PreToolUse

| Script | Matcher | Description |
|---|---|---|
| `block-dangerous.sh` | `Bash` | Block dangerous shell commands defined in `blocklist.conf` |

### PostToolUse

| Script | Matcher | Description |
|---|---|---|
| (inline) `fini` | `Edit\|Write` | Auto-format edited files with fini |

### SessionEnd

| Script | Matcher | Description |
|---|---|---|
| `save-transcript.ts` | `*` | Save session transcript to SQLite |

## Session Log Storage

Session transcripts are persisted to SQLite at `~/.local/share/claude-logs/logs.db`.

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
