# dotfiles

Personal dotfiles for macOS (Apple Silicon) managed with nix-darwin.

## Structure

```
.
├── nix-darwin/    # System configuration (packages, Homebrew, macOS defaults)
├── nvim/          # Neovim with lazy.nvim
├── zsh/           # Shell config and aliases
├── ghostty/       # Terminal emulator
├── mise/          # Task runner config
├── git/           # Git configuration
└── claude-code/   # Claude Code permissions and hooks
```

## Prerequisites

- macOS (Apple Silicon)
- [Nix](https://nixos.org/download) with flakes enabled
- [Homebrew](https://brew.sh)
- `herdr` (installed via the `nix-darwin/flake.nix` flake input) self-installs
  `~/.claude/hooks/herdr-agent-state.sh`, wired to the `SessionStart` hook in
  `claude-code/settings.json`. This file lives outside the repo and outside
  `setup.sh`'s symlinks — it's managed entirely by `herdr` (reinstalling or
  updating the integration overwrites it), not version-controlled here.

## Installation

```sh
# Clone
git clone https://github.com/tsukasaI/dotfiles.git ~/dotfiles

# Symlink configs
sh setup.sh

# Apply nix-darwin configuration
darwin-rebuild switch --flake ~/dotfiles/nix-darwin
```

## nix-darwin

Declarative system configuration via Nix Flakes.

**Packages** and **Homebrew Casks**: see [`nix-darwin/flake.nix`](nix-darwin/flake.nix) (`environment.systemPackages` and `homebrew.casks`) — the source of truth; not duplicated here to avoid drift.

**macOS defaults** (`system.defaults`): fastest key repeat (`KeyRepeat=1`, `InitialKeyRepeat=10`), press-and-hold character picker disabled, trackpad/mouse tracking speed maxed (`3.0`). Requires logout after `darwin-rebuild switch` to take effect.

**Standalone**: Claude Code (native installer, auto-updates)

## Update

```sh
# Update all dependencies (nix flake + Homebrew + darwin-rebuild)
nix flake update --flake ~/dotfiles/nix-darwin && sudo darwin-rebuild switch --flake ~/dotfiles/nix-darwin
```

## Shell

Zsh with modern CLI aliases:

| Alias | Tool | Replaces |
|-------|------|----------|
| `ls`  | eza  | ls       |
| `find`| fd   | find     |
| `ps`  | procs| ps       |
| `cd`  | zoxide | cd     |

## Editor

- **Neovim**: lazy.nvim plugin manager, fzf-lua, transparent background
- **VS Code**: Solarized Dark, Biome formatter

## Terminal

Primary: Ghostty (GitHub Dark theme, BlexMono Nerd Font, 80% opacity). WezTerm is kept as a fallback.

## Claude Code

Configuration lives in `claude-code/`.

```
claude-code/
├── settings.json        # Permissions, hooks, model, status line
├── statusline.ts        # Powerline status line (Bun/TypeScript)
└── shguard/
    └── config.toml       # Rules for the shguard binary (PreToolUse Bash guardrail)
```

### How the hook works

`claude-code/settings.json`'s `PreToolUse`/`Bash` hook calls the `shguard` binary directly
(inline command, no wrapper script), with `SHGUARD_STRICT_CONFIG=1` set so a missing or
malformed config denies instead of asking. `shguard` evaluates the command against
`claude-code/shguard/config.toml` and its own built-in rules, and returns `allow`, `ask`,
or `deny`. The inline command also fails closed if `shguard` itself can't be found or
crashes (empty output would otherwise read as an implicit allow).

### Managing the ruleset

`claude-code/shguard/config.toml` is Claude-edit-blocked (see `block-config-edit.sh`); changes
need to be applied manually. See the `hooks-guardrails` skill for the safe-change procedure
and `docs/shguard-migration-deltas.md` for the history of behavior differences found and
resolved during the migration from the old hand-written hook.

Each rule is a `[[deny]]`/`[[ask]]`/`[[allow]]` block with `id`, `reason`, `command`, and
`targets` (matcher shapes: `exact`, `prefix`, `normalized`, `normalized_prefix`,
`normalized_basename`). Test a change with:

```
echo '{"tool_input":{"command":"<CMD>"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard
```

and run `tests/shguard-parity-check.sh` to check the full regression suite before treating
a change as done.

### Read tool restrictions

`settings.json` `permissions.deny` still covers the `Read` tool (the hook is Bash-only):

```json
"Read(**/*secret*)", "Read(**/*credential*)",
"Read(.env*)", "Read(id_rsa)", "Read(id_ed25519)"
```

### Session habits

- New task → new session. Exception: tightly related follow-ups (e.g. writing docs for a feature just implemented) where re-reading files would be wasteful. NG (new session anyway): an unrelated bug fix in the same repo, or a feature discussed more than a day ago — re-reading cheaply beats carrying stale context.
- Prefer `/rewind` (Esc Esc) over correction. When an approach fails, rewind to before the failed attempt and re-prompt with what was learned, rather than saying "that didn't work, try X".
- `/clear` > `/compact` when you know what matters. Writing the brief yourself ("refactoring X, constraint is Y, relevant files are A/B, ruled out Z") produces cleaner context than trusting the model to summarize.
- Compact proactively, not reactively. Run `/compact` early with a directive (e.g. `/compact focus on the auth refactor, drop the test debugging`) — auto-compact fires when context rot has already degraded the model.

## Troubleshooting

- `darwin-rebuild switch` fails with a user mismatch: ensure `system.primaryUser` in `nix-darwin/flake.nix` matches `whoami`.
- `setup.sh` fails on symlink conflicts: remove the existing target (e.g. `rm ~/.zshrc`) and re-run.
- Claude Code hooks do nothing: confirm `~/.claude/settings.json` resolves on this host and `$HOME/dotfiles/...` paths exist.
- Homebrew cask conflict after `cleanup = "zap"`: run `brew uninstall --cask <name>` manually, then rebuild.
- `SessionStart` hook errors or is missing: on a fresh machine, `~/.claude/hooks/herdr-agent-state.sh` doesn't exist until `herdr` has run its own install step (it is not cloned or symlinked by this repo). Run the `herdr` integration setup for Claude Code, or remove the `SessionStart` entry in `claude-code/settings.json` if you don't use `herdr`.

## License

MIT
