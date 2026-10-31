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
  `extensions/` and `prompts/` here and at two skills read directly from
  `~/.claude/skills/` (`ja-lint`, `handover`; read-only reuse, no copies).
  Pi ignores `allowed-tools`/`argument-hint` and does not substitute
  `$ARGUMENTS` (it appends args after the body), so shared skills must work
  under both. The unused built-in `mcp` and `llama.cpp` extensions are
  disabled there (`-builtin:<name>`).
- `AGENTS.md` → `~/.pi/agent/AGENTS.md` (symlink: context files have no
  settings path option). Pi does not read `~/.claude/CLAUDE.md`, so this is
  the pi-side distillation of it; keep the two in step by hand.
- `extensions/`: every `.ts` file here is loaded, so tests live in `tests/`
  (`bun test pi/tests`, offline). `git-checkpoint.ts` snapshots the repo to
  `refs/pi-checkpoints/<session>/<n>` once per prompt before the first
  edit/write/bash; `usage-log.ts` appends per-turn tokens/cost to
  `~/.pi/agent/usage/YYYY-MM.jsonl` (`PI_USAGE_LOG_DIR` overrides).
  `statusline.ts` replaces the TUI footer (theme colors; today's cost is
  read from usage-log's JSONL, so it imports `./usage-log.ts`).
  `claude-rules.ts` puts the project's `.claude/rules/` into the system
  prompt (bodies of rules without `paths:`, a read-on-demand list for the
  rest); `~/.claude/rules` is skipped because this `AGENTS.md` distills it.
  `shguard.ts` runs each model-issued bash command through
  `shguard check --json` (same `~/.config/shguard/config.toml` as Claude
  Code) and blocks anything but `Allow`, fail-closed; `!` commands are not
  gated. `subagent.ts` runs scout (Haiku) / research / worker (Sonnet) as
  child `pi --mode json -p` processes with `PI_SUBAGENT=1`, which stops the
  child from registering these tools and from logging usage (the parent
  counts it as `toolCost`). `advisor.ts` sends a structured brief, no
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
- Load check without model calls: send `{"type":"get_commands"}` to
  `pi --mode rpc --no-session`.
- The `--container` mode uses its own `pi-agent-home` volume, so none of
  the above reaches it.
- The `pi` binary itself comes from nixpkgs (`pi-coding-agent`).
