#!/bin/bash

set -e

DOTFILES="$HOME/dotfiles"

echo "Setting up symlinks..."

# ~/.config symlinks
ln -sf "$DOTFILES/nvim" ~/.config/nvim
ln -sf "$DOTFILES/ghostty" ~/.config/ghostty
ln -sf "$DOTFILES/wezterm" ~/.config/wezterm
mkdir -p ~/.config/karabiner
ln -sf "$DOTFILES/karabiner/karabiner.json" ~/.config/karabiner/karabiner.json


# Home directory symlinks
ln -sf "$DOTFILES/zsh/zshrc" ~/.zshrc
ln -sf "$DOTFILES/git/gitconfig" ~/.gitconfig
mkdir -p ~/.config/git
ln -sf "$DOTFILES/git/ignore" ~/.config/git/ignore
ln -sf "$DOTFILES/git/gitconfig-oss" ~/.config/git/gitconfig-oss

# Claude Code
mkdir -p ~/.claude
ln -sf "$DOTFILES/claude-code/skills" ~/.claude/skills
chmod +x "$DOTFILES/claude-code/hooks/"*.sh 2>/dev/null || true

echo "Done."
