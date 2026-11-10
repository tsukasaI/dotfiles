---
paths:
  - "pi/**"
---

# pi/

Pi coding agent on API-key billing, kept off Claude Code's subscription.

- `pi-factory` (→ `~/.local/bin`) reads the key from Keychain service
  `claude-factory` and exports it to that process only.
- `--build` builds `pi-sandbox:<host pi --version>` from `Dockerfile.pi`
  (the host's nixpkgs Pi is the only version source).
- `--container` runs that tag under apple/container (Homebrew `container`),
  mounting only `$PWD`, and refuses if the tag is missing.
- `settings.json` → `~/.pi/agent/settings.json`. It points pi at
  `extensions/` and `prompts/` here and at skills read directly from
  `~/.claude/skills/` (`ja-lint`, `handover`, `grill`, `review-gate`,
  `explain-plan`, `diagram-explain`;
  read-only reuse, no copies). Pi ignores `allowed-tools`/`argument-hint`
  and, for skills, does not substitute `$ARGUMENTS` (it appends args after
  the body; prompt templates do substitute), so shared skills must work
  under both: copy the literal-`$ARGUMENTS` fallback from `handover`, and
  put pi-only mechanics in an `## In pi` section as `review-gate` does.
  The other skills depend on Claude Code tools (Workflow, MCP,
  AskUserQuestion, SendMessage) and are not wired in. The unused built-in `mcp` and `llama.cpp` extensions are
  disabled there (`-builtin:<name>`).
- `themes/`: loaded through the `themes` setting. `flat-dark.json` is the
  built-in `dark.json` with `userMessageBg` and `tool*Bg` set to `""`
  (terminal default) and a pale blue `userMessageText` to mark user turns.
  Any explicit cell background shows as an opaque band under Ghostty's
  `background-opacity` even when it equals the window color, because
  `background-opacity-cells` composites it over the already-translucent
  window (ghostty discussion #8642), so don't reintroduce faint panel colors. Themes outside
  `~/.pi/agent/themes/` are not hot-reloaded: run `/reload` after editing.
  When pi updates, diff against the new built-in `dark.json` for added tokens.
- `AGENTS.md` → `~/.pi/agent/AGENTS.md` (symlink: context files have no
  settings path option). Pi does not read `~/.claude/CLAUDE.md`, so this is
  the pi-side distillation of it; keep the two in step by hand.
  `tests/pi-agents-sync.sh` (lefthook, CI) compares the `distilled-from`
  hash at the top of AGENTS.md with `claude-code/CLAUDE.md` and fails when
  it changed: re-check the distillation, then run it with `--write`. Rules are
  not distilled: `claude-rules.ts` loads `~/.claude/rules` itself, so
  AGENTS.md must not repeat their content.
- `extensions/`: every `.ts` file here is loaded, so tests live in `tests/`
  (`bun test pi/tests`, offline). `git-checkpoint.ts` snapshots the repo to
  `refs/pi-checkpoints/<session>/<n>` once per prompt before the first
  edit/write/bash; `usage-log.ts` appends per-turn tokens/cost to
  `~/.pi/agent/usage/YYYY-MM.jsonl` (local month; `PI_USAGE_LOG_DIR`
  overrides). "today" is the local day but "month" is the UTC month,
  matching Anthropic's billing reset, so it can read two files;
  `/checkpoints` and `/usage` inspect them.
  `statusline.ts` replaces the TUI footer (theme colors; today's cost is
  read from usage-log's JSONL and the goal state from goal's entries, so it
  imports `./usage-log.ts` and `./goal.ts`).
  `claude-rules.ts` puts `~/.claude/rules/` and the project's
  `.claude/rules/` into the system prompt (bodies of rules without
  `paths:`, a read-on-demand list for the rest). `git-sandbox.md` is
  skipped: it describes Claude Code's Bash sandbox, which pi lacks.
  `shguard.ts` runs each model-issued bash command through
  `shguard` on stdin as the same PreToolUse JSON the Claude Code hook gets
  (same `~/.config/shguard/config.toml`), reads
  `hookSpecificOutput.permissionDecision`, and blocks anything but `allow`
  (including `ask`), fail-closed; `!` commands are not
  gated. It first rewrites `$HOME` with `claude-code/mod/hooks/shell-canon.ts`
  (imported, not copied) and runs the rewritten command.
  `file-guard.ts` gates read/grep/find/ls by the `Read(...)` rules in
  `claude-code/settings.json` (plus `~/.pi/agent/auth.json`) and write/edit
  by `claude-code/hooks/block-config-edit.sh`, and also protects pi's own
  guards and the files that run unsandboxed (`file-guard.ts`, `shguard.ts`,
  `style-guards.ts`, `settings.json`, `pi-factory`, `Dockerfile.pi`, `.pi`
  extension dirs), so changing those is a manual edit, as on the Claude
  Code side.
  Known gaps: grep/find/ls on a parent of a denied path still reach it,
  and a new file in `extensions/` can register its own tools.
  `compact-diff.ts` (`registerToolRenderer`, display only) collapses edit
  and write to a one-line summary (`+N -M` / line count) and shows the
  built-in diff or content on `Ctrl+O`; the built-in edit renderer still
  runs while collapsed because it holds the diff preview in renderer state.
  `copy-code.ts` adds `/copy-code [n]`: walks the branch back to the newest
  assistant reply with a fenced block (CommonMark fences, so a ```` block
  quoting ``` stays whole) and `pbcopy`s block n, else the longest.
  `format.ts` runs `fini` after write/edit (as Claude Code's PostToolUse)
  and tells the model when the file changed. `style-guards.ts` runs
  `claude-code/hooks/slop-guard.ts` on prose writes and imports
  `claude-code/mod/hooks/rule-guards.ts`' commit-message and main-branch
  checks; both fail open, like their Claude Code originals.
  `subagent.ts` runs scout (Haiku) / research / worker (Sonnet) / reviewer
  (Opus; prompt = body of `claude-code/agents/code-reviewer.md`) as child
  `pi --mode json -p` processes with `PI_SUBAGENT=1`, which stops the
  child from registering these tools, logging usage (the parent counts it
  as `toolCost`), running goal, and taking checkpoints (the parent
  checkpoints on the `subagent` call). Children time out after 30 min.
  `session-log.ts` starts `lib/save-session.ts` (bun, detached) on
  `session_shutdown`; it writes the redacted session to `pi_sessions` /
  `pi_transcript_raw` / `pi_session_days` in Claude Code's
  `~/.local/share/claude-logs/logs.db` (`PI_SESSION_LOG_DB` overrides).
  `push-to-turso.sh` copies only its own three tables, so these rows stay
  local and are never pruned. `advisor.ts` sends a structured brief, no
  history, to Fable after a TUI confirmation. `goal.ts` adds `/goal
  [--max N] <condition>` (Claude Code's /goal): at `agent_before_settle`
  Haiku judges the transcript and a miss appends the reason and continues;
  it stops on met, the cap (`--max`, else the statement's "stop after N
  turns", else 20), `/goal stop`, an aborted run, or a failed evaluation
  (fail-closed). State is in `goal` custom entries; evaluator cost goes to
  usage-log as `turnIndex: -1` records and to the statusline session total.
  pi's boundary preview reports `canContinue: false` after an assistant
  reply; the appended custom message makes `continue: true` valid, so don't
  gate on it.
- `bun test pi/tests` runs on pre-push (lefthook) and in CI.
- Load check without model calls: send `{"type":"get_commands"}` to
  `pi --mode rpc --no-session`.
- The `--container` mode uses its own `pi-agent-home` volume, so none of
  the above reaches it.
- The `pi` binary itself comes from nixpkgs (`pi-coding-agent`).
