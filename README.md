# dotfiles

Personal dotfiles for macOS (Apple Silicon) managed with nix-darwin.

## Structure

```
.
├── nix-darwin/    # System configuration (packages, Homebrew)
├── nvim/          # Neovim with lazy.nvim
├── zsh/           # Shell config and aliases
├── starship/      # Cross-shell prompt
├── ghostty/       # Terminal emulator
├── vscode/        # Editor settings
├── mise/          # Task runner config
├── git/           # Git configuration
└── claude-code/   # Claude Code permissions and hooks
```

## Prerequisites

- macOS (Apple Silicon)
- [Nix](https://nixos.org/download) with flakes enabled
- [Homebrew](https://brew.sh)

## Installation

```sh
# Clone
git clone https://github.com/inouetsukasa/dotfiles.git ~/dotfiles

# Symlink configs
sh setup.sh

# Apply nix-darwin configuration
darwin-rebuild switch --flake ~/dotfiles/nix-darwin
```

## nix-darwin

Declarative system configuration via Nix Flakes.

**Packages**: neovim, git, bat, eza, fd, ripgrep, zoxide, starship, gh, awscli2, bun, go, nodejs, pnpm, rustup, terraform

**Homebrew Casks**: ghostty, raycast, orbstack, claude-code

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

Ghostty with GitHub Dark theme, BlexMono Nerd Font, 80% opacity.

## Claude Code

Configuration lives in `claude-code/`.

```
claude-code/
├── settings.json        # Permissions, hooks, model, status line
├── statusline.ts        # Powerline status line (Bun/TypeScript)
└── hooks/
    ├── block-dangerous.sh   # PreToolUse hook — reads blocklist and blocks matching commands
    └── blocklist.conf       # Plain-text list of blocked command patterns
```

### How the hook works

`block-dangerous.sh` is registered as a `PreToolUse` hook in `settings.json`. Claude Code
runs it before every Bash tool call. If a command matches a rule in `blocklist.conf`, the
hook exits with code 2 and shows a block reason. Otherwise it exits 0 and the normal
permission check proceeds.

### Managing the blocklist

Edit `claude-code/hooks/blocklist.conf`. Each non-comment line has three pipe-separated fields:

```
CATEGORY | pattern | Block reason shown to the user
```

Three pattern types:

| Syntax | Behaviour | Example |
|--------|-----------|---------|
| `prefix` | Blocked at a word boundary — won't match a longer command name | `rm` blocks `rm foo` but not `remove-items` |
| `prefix*` | Starts-with match, no end boundary — use when subcommand follows a dot or similar | `mkfs*` blocks `mkfs.ext4`, `mkfs.vfat` |
| `*keyword*` | Matches anywhere in the command | `*secret*` blocks any command containing "secret" |

**To block a new command** — add a line:
```
GIT | git switch -d | git switch -d detaches HEAD
```

**To unblock a command** — delete or comment out (`#`) its line.

**Special cases hardcoded in `block-dangerous.sh`** (require conditional logic):
- `curl` — external hosts blocked, localhost/127.0.0.1/[::1] allowed
- `| bash/sh/zsh/...` — pipe-to-shell injection
- `/dev/tcp`, `/dev/udp` — bash network pseudo-devices

### Read tool restrictions

`settings.json` `permissions.deny` still covers the `Read` tool (the hook is Bash-only):

```json
"Read(**/*secret*)", "Read(**/*credential*)",
"Read(.env*)", "Read(id_rsa)", "Read(id_ed25519)"
```

## License

MIT
