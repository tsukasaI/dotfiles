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
└── claude-code/   # AI assistant permissions
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

## License

MIT
