# Claude Code Hooks

Hook scripts for Claude Code, configured in `~/.claude/settings.json`.

## Hooks

### PreToolUse

| Script | Matcher | Description |
|---|---|---|
| (inline) `shguard` | `Bash` | Deny dangerous shell commands per `claude-code/shguard/config.toml`. `SHGUARD_STRICT_CONFIG=1` (set in `settings.json`'s top-level `env`) makes a missing/malformed config deny instead of ask; see `docs/shguard-migration-deltas.md` |
| `block-config-edit.sh` | `Edit\|Write` | Block edits to linter/formatter config files |
| `slop-guard.ts` | `Edit\|Write` | Deny prose edits (`.md`/`.mdx`/`.txt`) that newly introduce an em dash or a cliché phrase from `slop-phrases.conf`; only the net-new count vs. the pre-edit text is checked, never the whole file. `SLOP_GUARD_DISABLE=1` disables it. |

### PostToolUse

| Script | Matcher | Description |
|---|---|---|
| (inline) `fini` | `Edit\|Write` | Auto-format edited files with fini |

### SessionEnd

| Script | Matcher | Description |
|---|---|---|
| `save-transcript.ts` | `""` | Save session transcript to SQLite (async) |

### SessionStart

| Script | Matcher | Description |
|---|---|---|
| `~/.claude/hooks/herdr-agent-state.sh session` | `*` (timeout 10s) | Reports agent session state to `herdr`. **Not part of this repo** — self-installed by the `herdr` flake package outside `setup.sh`'s symlinks; see root `README.md` Prerequisites/Troubleshooting. |

## Mod (`claude-code/mod/`)

Behavior that only needs to be *seen* by the user, or that enforces a
mechanically checkable CLAUDE.md rule, lives in the `dotfiles-mod` plugin
(Claude Code function hooks), loaded via `CLAUDE_CODE_PLUGIN_DIRS` in
`settings.json`'s `env`. Mod hooks fail open (a throwing hook is skipped), so
guardrails stay here as settings hooks.

- **Session edits pane** (`/edits`, auto-opens at 144+ columns): files this
  session edited via Edit/Write/NotebookEdit with their `git status`; an
  uncommitted file under `~/dotfiles` (outside `docs/`, `.claude/`, `tests/`,
  `.github/`) is flagged `LIVE`. Replaces the former `mark-session-edit.sh` +
  `warn-uncommitted.sh` Stop reminder, which mostly produced extra
  "not committing because..." turns.
- **Shell canonicalization**: rewrites `$TMPDIR` (to the sandbox's
  `/private/tmp/claude-<uid>`) and `$HOME` to literal paths before shguard
  sees a Bash command, so shguard checks the real target instead of denying
  an unresolved variable. Skipped inside single quotes, heredocs and
  `$(...)`/backquotes. shguard still decides.
- **Blocked-command band**: when shguard denies a Bash call, the command
  appears above the prompt as `! <command>` for the user to run, and the
  model is told not to route around it. Cleared on the next prompt.
- **Rule guards**: deny an Agent call without `model:` (unless the agent
  definition pins one, or it is a fork); deny `git commit` on main/master
  outside `tsukasaI/dotfiles`/`ops`, and a `-m` message that isn't
  Conventional Commits or contains Japanese. Unreadable cases pass.
- **PR review band**: PRs opened via `gh pr create` and their
  `code-reviewer` state (a wording guess; display only, never a merge gate).

Test with `claude plugin test claude-code/mod`; check with
`claude plugin validate claude-code/mod`.

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
