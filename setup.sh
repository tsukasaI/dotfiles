#!/bin/bash

set -e

DOTFILES="$HOME/dotfiles"

echo "Setting up symlinks..."

# ~/.config symlinks
ln -sf "$DOTFILES/nvim" ~/.config/nvim
ln -sf "$DOTFILES/ghostty" ~/.config/ghostty
ln -sf "$DOTFILES/starship/starship.toml" ~/.config/starship.toml

# Home directory symlinks
ln -sf "$DOTFILES/zsh/zshrc" ~/.zshrc
ln -sf "$DOTFILES/git/gitconfig" ~/.gitconfig
mkdir -p ~/.config/git
ln -sf "$DOTFILES/git/ignore" ~/.config/git/ignore

echo "Done."
