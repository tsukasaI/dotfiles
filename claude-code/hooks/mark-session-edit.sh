#!/usr/bin/env bash
# PostToolUse hook: records file paths this session edited via
# Edit/Write/NotebookEdit, so the Stop hook (warn-uncommitted.sh) can tell
# whether ITS session left dirty work — not just whether the shared working
# tree is dirty, which conflates concurrent herdr sessions on the same repo.
# stdin  -> JSON: {"session_id": str, "tool_input": {"file_path"|"notebook_path": str}, ...}
# Always exits 0 — advisory only, must never block a tool call. Every step
# is individually guarded so a missing jq/TMPDIR/etc. degrades to "no
# record," never a stuck or blocked tool call (same fail-open contract as
# warn-uncommitted.sh).

SESSION_DIR="${TMPDIR:-/tmp}/claude-session-edits"

INPUT=$(cat 2>/dev/null)
[[ -n "$INPUT" ]] || exit 0

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
[[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0

FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[[ -n "$FILE_PATH" ]] || exit 0

mkdir -p "$SESSION_DIR" 2>/dev/null
printf '%s\0' "$FILE_PATH" >> "$SESSION_DIR/$SESSION_ID" 2>/dev/null

exit 0
