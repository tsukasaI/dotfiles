#!/bin/bash

set -euo pipefail

DOTFILES="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up symlinks..."

# Symlink $1 -> $2. If $2 already exists as a real file/dir (not a symlink),
# back it up with a timestamp first instead of silently overwriting or
# (for directories) linking inside it. No-op on re-run once $2 is already
# the right symlink. Fails closed if $1 doesn't exist, so a wrong $DOTFILES
# (e.g. cloned to a different path) aborts loudly instead of leaving a
# dangling symlink.
link_with_backup() {
  local src="$1" dest="$2"
  if [[ ! -e "$src" ]]; then
    echo "Error: source '$src' does not exist (is \$DOTFILES correct?)" >&2
    exit 1
  fi
  if [[ -e "$dest" && ! -L "$dest" ]]; then
    local backup
    backup="${dest}.backup.$(date +%Y%m%d-%H%M%S)"
    mv "$dest" "$backup"
    echo "Backed up existing $dest to $backup"
  fi
  ln -sfn "$src" "$dest"
}

# ~/.config symlinks
mkdir -p ~/.config
link_with_backup "$DOTFILES/nvim" ~/.config/nvim
link_with_backup "$DOTFILES/ghostty" ~/.config/ghostty
link_with_backup "$DOTFILES/wezterm" ~/.config/wezterm
mkdir -p ~/.config/karabiner
link_with_backup "$DOTFILES/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json
mkdir -p ~/.config/shguard
link_with_backup "$DOTFILES/claude-code/shguard/config.toml" ~/.config/shguard/config.toml


# Home directory symlinks
link_with_backup "$DOTFILES/zsh/zshrc" ~/.zshrc
link_with_backup "$DOTFILES/git/gitconfig" ~/.gitconfig
mkdir -p ~/.config/git
link_with_backup "$DOTFILES/git/ignore" ~/.config/git/ignore
link_with_backup "$DOTFILES/git/gitconfig-oss" ~/.config/git/gitconfig-oss
# Clean up the retired global-hooks symlink (dangling since git/hooks/ was
# removed in favor of per-repo lefthook.yaml; core.hooksPath is unset so this
# is inert either way, but leaving stale cruft around is confusing).
if [[ -L ~/.config/git/hooks && "$(readlink ~/.config/git/hooks)" == "$DOTFILES/git/hooks" ]]; then
  rm ~/.config/git/hooks
fi

# SSH (UseKeychain integration)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
link_with_backup "$DOTFILES/ssh/config" ~/.ssh/config

# Claude Code
mkdir -p ~/.claude
link_with_backup "$DOTFILES/claude-code/skills" ~/.claude/skills
link_with_backup "$DOTFILES/claude-code/rules" ~/.claude/rules
link_with_backup "$DOTFILES/claude-code/agents" ~/.claude/agents
link_with_backup "$DOTFILES/claude-code/themes" ~/.claude/themes
link_with_backup "$DOTFILES/claude-code/settings.json" ~/.claude/settings.json
link_with_backup "$DOTFILES/claude-code/CLAUDE.md" ~/.claude/CLAUDE.md
chmod +x "$DOTFILES/claude-code/hooks/"*.sh 2>/dev/null || true

# Per-repo git hooks (lefthook): this repo's own pre-commit gitleaks check.
# On a fresh machine setup.sh runs before darwin-rebuild switch, so lefthook
# may not be on PATH yet — warn loudly instead of silently leaving the hook
# uninstalled (security.md: disabled security checks must not fail silent).
if command -v lefthook >/dev/null 2>&1; then
  (cd "$DOTFILES" && lefthook install)
else
  echo "WARNING: lefthook not on PATH — pre-commit gitleaks hook NOT installed." >&2
  echo "Run 'darwin-rebuild switch' first, then re-run setup.sh (or 'lefthook install' directly)." >&2
fi

echo "Done."
