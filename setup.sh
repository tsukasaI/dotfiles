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
mkdir -p ~/.config/mise
link_with_backup "$DOTFILES/mise/config.toml" ~/.config/mise/config.toml
mkdir -p ~/.config/karabiner
link_with_backup "$DOTFILES/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json


# Home directory symlinks
link_with_backup "$DOTFILES/zsh/zshrc" ~/.zshrc
link_with_backup "$DOTFILES/git/gitconfig" ~/.gitconfig
mkdir -p ~/.config/git
link_with_backup "$DOTFILES/git/ignore" ~/.config/git/ignore
link_with_backup "$DOTFILES/git/gitconfig-oss" ~/.config/git/gitconfig-oss
# shguard's own default config lookup path (it does not read XDG_CONFIG_HOME).
# The settings.json PreToolUse hook runs `shguard` without SHGUARD_CONFIG,
# relying on this symlink instead.
mkdir -p ~/.config/shguard
link_with_backup "$DOTFILES/claude-code/shguard/config.toml" ~/.config/shguard/config.toml

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

# coding-guidelines (a separate repo) as user-level rules: principles.md loads
# in every session, the language/frontend files carry paths: frontmatter and
# load only for matching files. Linked into a gitignored subdirectory of
# claude-code/rules, which ~/.claude/rules points at. react.md and solid.md
# are left out: both use .tsx, so a project imports the one it uses.
# Mac links track the checkout's HEAD; only the cloud copy is pinned.
CODING_GUIDELINES=${CODING_GUIDELINES:-$HOME/engineer/coding-guidelines}
if [[ -d $CODING_GUIDELINES ]]; then
  mkdir -p "$DOTFILES/claude-code/rules/coding-guidelines"
  # The file list is the one the cloud setup pins; the digests are unused here.
  while read -r _ f; do
    if [[ ! -f $CODING_GUIDELINES/$f ]]; then
      echo "Error: $CODING_GUIDELINES/$f does not exist" >&2
      exit 1
    fi
    ln -sfn "$CODING_GUIDELINES/$f" \
      "$DOTFILES/claude-code/rules/coding-guidelines/${f//\//-}"
  done <"$DOTFILES/claude-code/cloud/coding-guidelines.sha256"
else
  echo "WARNING: $CODING_GUIDELINES not found; coding-guidelines rules NOT linked." >&2
  echo "Clone tsukasaI/coding-guidelines there (or set CODING_GUIDELINES) and re-run setup.sh." >&2
fi

# Pi coding agent (API-key billing, separate from Claude Code)
mkdir -p ~/.local/bin ~/.pi/agent
link_with_backup "$DOTFILES/pi/pi-factory" ~/.local/bin/pi-factory
link_with_backup "$DOTFILES/pi/settings.json" ~/.pi/agent/settings.json
# Context files have no settings.json path option, so AGENTS.md needs a link;
# extensions/prompts/skills are referenced from settings.json instead.
link_with_backup "$DOTFILES/pi/AGENTS.md" ~/.pi/agent/AGENTS.md

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
