#!/bin/bash

# Unicode icons (standard characters that render in most terminals)
icon_branch="λ"
icon_folder="❯"
icon_context="◔"

# Read JSON input from stdin
input=$(cat)

# Extract context usage percentage (pre-calculated field)
context_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

# Get current directory from JSON input
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')

# Convert absolute path to home-relative path
home_dir="$HOME"
if [[ "$current_dir" == "$home_dir"* ]]; then
    display_dir="~${current_dir#$home_dir}"
else
    display_dir="$current_dir"
fi

# Change to the current directory to run git commands
cd "$current_dir" 2>/dev/null || cd "$(pwd)"

# Get git branch (skip optional locks for performance)
git_branch=$(git -c gc.autodetach=false branch --show-current 2>/dev/null || echo "")

# Check if we're in a git worktree
is_worktree=""
if [ -n "$git_branch" ]; then
    # Check if .git is a file (worktree) rather than a directory
    if [ -f .git ]; then
        is_worktree=" [worktree]"
    fi
fi

# Build the status line
status_parts=()

# Add git branch if available
if [ -n "$git_branch" ]; then
    status_parts+=("${icon_branch}$git_branch$is_worktree")
fi

# Add working directory (with ~ for home)
status_parts+=("${icon_folder} $display_dir")

# Add context percentage if available
if [ -n "$context_used" ]; then
    # Format to 1 decimal place
    context_formatted=$(printf "%.1f" "$context_used")
    status_parts+=("${icon_context} ${context_formatted}%")
fi

# Join parts with " | "
output=""
for i in "${!status_parts[@]}"; do
    if [ $i -eq 0 ]; then
        output="${status_parts[$i]}"
    else
        output="$output | ${status_parts[$i]}"
    fi
done

echo "$output"
