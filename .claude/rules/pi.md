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
- `AGENTS.md` → `~/.pi/agent/AGENTS.md` (symlink: context files have no
  settings path option). Pi does not read `~/.claude/CLAUDE.md`, so this is
  the pi-side distillation of it; keep the two in step by hand.
- `extensions/`: every `.ts` file here is loaded, so tests live in `tests/`
  (`bun test pi/tests`, offline). `git-checkpoint.ts` snapshots the repo to
  `refs/pi-checkpoints/<session>/<n>` once per prompt before the first
  edit/write/bash; `usage-log.ts` appends per-turn tokens/cost to
  `~/.pi/agent/usage/YYYY-MM.jsonl` (`PI_USAGE_LOG_DIR` overrides).
- Load check without model calls: send `{"type":"get_commands"}` to
  `pi --mode rpc --no-session`.
- The `--container` mode uses its own `pi-agent-home` volume, so none of
  the above reaches it.
- The `pi` binary itself comes from nixpkgs (`pi-coding-agent`).
