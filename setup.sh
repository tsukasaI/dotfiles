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

# SSH (UseKeychain integration)
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ -e ~/.ssh/config ] && [ ! -L ~/.ssh/config ]; then
  mv ~/.ssh/config ~/.ssh/config.backup.$(date +%Y%m%d-%H%M%S)
fi
ln -sfn "$DOTFILES/ssh/config" ~/.ssh/config

# Claude Code
mkdir -p ~/.claude
ln -sfn "$DOTFILES/claude-code/skills" ~/.claude/skills
ln -sfn "$DOTFILES/claude-code/rules" ~/.claude/rules
ln -sfn "$DOTFILES/claude-code/agents" ~/.claude/agents
ln -sfn "$DOTFILES/claude-code/settings.json" ~/.claude/settings.json
ln -sfn "$DOTFILES/claude-code/CLAUDE.md" ~/.claude/CLAUDE.md
chmod +x "$DOTFILES/claude-code/hooks/"*.sh 2>/dev/null || true

echo "Done."
