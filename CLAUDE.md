# CLAUDE.md — dotfiles

Personal macOS (Apple Silicon) configuration for a single machine
(`Ino-macbook-air`, user `inouetsukasa`), managed by nix-darwin plus a
symlink script. Public repo: `tsukasaI/dotfiles`.

**This repo is live.** Most directories are symlinked into `$HOME` by
`setup.sh`, and the Claude Code hooks/statusline are referenced from
`settings.json` by absolute `$HOME/dotfiles/...` paths. An edit here
immediately changes the running system — the shell, this repo's own git
hooks (lefthook), and the guardrails of the very Claude Code session doing
the editing.
There is no staging or deploy step (hooks apply on the next tool call,
`settings.json` on the next session).

## Map

| Path | What it is |
|---|---|
| `nix-darwin/flake.nix` | Source of truth for packages, Homebrew, and macOS defaults. Single host config; `system.primaryUser` must equal `whoami`. |
| `claude-code/` | The user's **global** Claude Code config (`~/.claude/*` symlinks point here): `CLAUDE.md`, `settings.json`, `rules/`, `skills/`, `agents/`, `hooks/`, `shguard/config.toml`, `themes/`, `statusline.ts`. |
| `.claude/` | Project-scoped Claude state for *this repo only* (plans, memory, local settings). Not the same thing as `claude-code/`. |
| `nvim/` | lazy.nvim config: one file per plugin in `lua/plugins/` with that plugin's keymaps inside its spec; global options/keymaps in `init.lua`; LSP servers in `lsp/<name>.lua`, enabled at the bottom of `init.lua`. |
| `zsh/zshrc` | Hand-written, no framework. `_cached_eval` caches slow init output (mise/zoxide/fzf). Custom prompt — starship was removed. |
| `git/` | Global gitconfig; `gitconfig-oss` swaps `user.email` for `~/oss/**` via `includeIf`. No global hooks — `core.hooksPath` was retired (see Pitfalls); this repo's own pre-commit/pre-push checks live in the root `lefthook.yaml`, installed per-repo via `lefthook install` (see `setup.sh`). |
| `scripts/` | Utility scripts (currently empty after cooling-period removal). |
| `setup.sh` | First-time symlink installer; also runs `lefthook install` (warns if lefthook isn't on PATH yet). |
| `docs/` | Investigation memos specific to this repo's own subject matter (e.g. `turso-investigation.md`); not a knowledge-management store — see the Personal knowledge store bullet in Concepts for the cc-memory/docs boundary. |
| `ghostty/`, `wezterm/` | Terminals: ghostty primary, wezterm fallback, deliberately identical theme/font. |
| `karabiner/`, `ssh/`, `mise/` | Small configs. `mise/config.toml` is near-empty on purpose — toolchains come from Nix. |

## Commands

- Apply system config: `sudo darwin-rebuild switch --flake ~/dotfiles/nix-darwin`
  (flake output resolved by hostname; macOS `defaults` changes need logout).
- Verify a flake change without activating: `darwin-rebuild build --flake ~/dotfiles/nix-darwin`.
- Update flake inputs: `nix flake update` (in `nix-darwin/`), then
  `darwin-rebuild switch` to activate.
- Test a hook change with a synthetic payload:
  `echo '{"tool_input":{"command":"grep foo"}}' | claude-code/hooks/block-dangerous.sh; echo $?`
  — exit 0 = allow, exit 2 = block.
- CI: see `.github/workflows/ci.yaml` and `flake-check.yaml`. CI is a
  backstop, not the only loop — re-run `lefthook install` after pulling
  changes to hooks or lefthook config. No linter config for other file types.

## Concepts

- **Contextual Commits**: the commit-body format (see global CLAUDE.md) is
  used by `rules/comments.md` as the home for bug-hunt narrative that must
  stay out of source.
- **ewc / fini / herdr**: personal tools installed as flake inputs. `fini` is
  the formatter the PostToolUse hook runs on every Edit/Write. `herdr`
  supplies the SessionStart hook (`~/.claude/hooks/`, outside this repo).
- **claude-logs**: the SessionEnd hook (`hooks/save-transcript.ts`) writes
  transcripts to `~/.local/share/claude-logs/logs.db`.
  `claude-code/scripts/push-to-turso.sh` uploads that DB and is
  **intentionally manual** — never run or automate it; its credentials are
  deliberately kept out of Claude's process tree.
- **Personal knowledge store**: cc-memory (MCP) is the sole store for
  personal-life facts, Claude-Code session learnings, and article-idea
  candidates (`blog_candidate: true`). The Obsidian vault and the `kb`/`note`
  skills were retired — their content was migrated into cc-memory. A repo's
  own `docs/` still holds investigations specific to that repo's own subject
  matter (e.g. `docs/turso-investigation.md` here), separate from
  cc-memory's personal-knowledge scope. One store per finding — don't
  duplicate across them.

## Pitfalls

- **The hooks police this session too.** `grep`/`find`/`ssh`/`scp`, `curl` to
  non-localhost hosts, and more are blocked for you by `block-dangerous.sh`.
  A `[BLOCKED: ...]` result is policy, not a flaky tool — surface the command
  to the user instead of routing around it. `block-config-edit.sh` likewise
  hard-blocks Edit/Write on linter/formatter configs in any project.
- **The blocklist regexes encode false-positive history.** Quote-stripping,
  heredoc handling, and the CB/TB/STRICT_CB boundary classes each fix a past
  regression (see `git log claude-code/hooks/`). Don't simplify them; test
  every change with the synthetic-payload one-liner above. Rule format:
  `CATEGORY | pattern | reason | alternative`; `allowlist.conf` bypasses the
  blocklist for listed prefixes.
- **Skills run live through the `~/.claude/skills` symlink**: an edit is in
  production immediately, committed or not. Check `git status` before assuming
  committed state equals running state.
- **Global git hooks were retired, on purpose.** `core.hooksPath` used to
  chain into each repo's own lefthook config, but lefthook (and Python
  `pre-commit`) refuse to `install` while a global hooksPath is set — a
  structural conflict with normal `lefthook install` usage, not a one-off
  bug. Every repo, including language-less ones like this one, now carries
  its own `lefthook.yaml` with at least a gitleaks pre-commit check,
  installed via `lefthook install` (see `setup.sh`). Don't reintroduce a
  global `core.hooksPath` — it will silently break `lefthook install` in
  every other repo on this machine again.
- **Trust files over docs.** Parts of `hooks/README.md` are known-stale.
  When any doc — including this one — disagrees with reality, reality wins;
  update the doc.
- **shguard runs in shadow mode.** `hooks/shguard-shadow.sh` evaluates every
  Bash call against `claude-code/shguard/config.toml` and logs to
  `~/.local/share/shguard-shadow/shadow.jsonl` without blocking;
  `block-dangerous.sh` remains the enforcing guard. `shguard-gate.sh` is the
  enforcing variant, not yet wired in `settings.json`. Accepted deltas
  between the two are tracked in `docs/shguard-migration-deltas.md`;
  `config.toml` is Claude-edit-blocked like the other guard files.
- **flake.nix specifics**: the unfree allowlist contains only `terraform`
  (any other unfree package fails eval until added); Homebrew
  `cleanup = "zap"` uninstalls anything not declared in the flake;
  `extraFlags = ["--force-cleanup"]` was added before nix-darwin PR #1789
  (merged 2026-06-17) landed; check whether the pinned nix-darwin input
  already handles the underlying CLI-flag requirement and drop the flag if
  so.
- **Homebrew taps can't be content-pinned** — the exception to
  `rules/security.md`'s pin rule. The taps in `nix-darwin/flake.nix`
  (`bendews/tap`, `tursodatabase/tap`, `libsql/sqld`, `ariga/tap`,
  `charmbracelet/tap`) have no content-hash mechanism, and `trusted = true`
  on each is not optional: Homebrew 5.1+ refuses to install third-party-tap
  formulae without it (confirmed live in commit `ad07cb8`). Renewal
  mechanism: re-justify each tap's necessity whenever the tap list changes,
  and at least quarterly regardless (originally issue #25).
- **Known debt is catalogued.** 43 closed GitHub issues (security /
  architecture / quality / claude-config) document past structural
  problems, in Japanese, with a 問題の所在 → 推奨される対応方針 structure. Run
  `gh issue list --state all` before filing a "new" finding, and follow that
  format.
