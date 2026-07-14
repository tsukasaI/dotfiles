#!/bin/bash

set -e

DOTFILES="$HOME/dotfiles"

echo "Setting up symlinks..."

# ~/.config symlinks
ln -sfn "$DOTFILES/nvim" ~/.config/nvim
ln -sfn "$DOTFILES/ghostty" ~/.config/ghostty
ln -sfn "$DOTFILES/wezterm" ~/.config/wezterm
mkdir -p ~/.config/karabiner
ln -sfn "$DOTFILES/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json


# Home directory symlinks
ln -sfn "$DOTFILES/zsh/zshrc" ~/.zshrc
ln -sfn "$DOTFILES/git/gitconfig" ~/.gitconfig
mkdir -p ~/.config/git
ln -sfn "$DOTFILES/git/ignore" ~/.config/git/ignore
ln -sfn "$DOTFILES/git/gitconfig-oss" ~/.config/git/gitconfig-oss
if [ -e ~/.config/git/hooks ] && [ ! -L ~/.config/git/hooks ]; then
  # shellcheck disable=SC2046  # timestamp expands to digits and dashes only; real fix tracked in #5
  mv ~/.config/git/hooks ~/.config/git/hooks.backup.$(date +%Y%m%d-%H%M%S)
fi
ln -sfn "$DOTFILES/git/hooks" ~/.config/git/hooks
chmod +x "$DOTFILES/git/hooks/"* 2>/dev/null || true
# Lock hook files so `lefthook install -f` (npm postinstall) can't clobber them
# through the symlink (#22 recurrence). Unlock to edit: chflags nouchg <file>
chflags uchg "$DOTFILES/git/hooks/"* 2>/dev/null || true

# SSH (UseKeychain integration)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ -e ~/.ssh/config ] && [ ! -L ~/.ssh/config ]; then
  # shellcheck disable=SC2046  # timestamp expands to digits and dashes only; real fix tracked in #5
  mv ~/.ssh/config ~/.ssh/config.backup.$(date +%Y%m%d-%H%M%S)
fi
ln -sfn "$DOTFILES/ssh/config" ~/.ssh/config

# Claude Code
mkdir -p ~/.claude
ln -sfn "$DOTFILES/claude-code/skills" ~/.claude/skills
ln -sfn "$DOTFILES/claude-code/rules" ~/.claude/rules
ln -sfn "$DOTFILES/claude-code/agents" ~/.claude/agents
ln -sfn "$DOTFILES/claude-code/themes" ~/.claude/themes
ln -sfn "$DOTFILES/claude-code/settings.json" ~/.claude/settings.json
ln -sfn "$DOTFILES/claude-code/CLAUDE.md" ~/.claude/CLAUDE.md
chmod +x "$DOTFILES/claude-code/hooks/"*.sh 2>/dev/null || true

echo "Done."
