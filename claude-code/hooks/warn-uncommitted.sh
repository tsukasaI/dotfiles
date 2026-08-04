#!/usr/bin/env bash
# Stop hook: remind the agent to commit before ending the turn.
# stdin  -> JSON: {"stop_hook_active": bool, "session_id": str, ...}
# exit 0 -> allow stop, exit 2 -> block once (stderr is fed back to the model)
#
# Reminder, not a guardrail: unlike the PreToolUse hooks this fails OPEN —
# a broken reminder must never trap the session in an unstoppable state.
# It runs no verification; pre-commit owns that when the commit happens.
#
# Scoped to THIS session's edits (recorded by mark-session-edit.sh under
# $TMPDIR/claude-session-edits/<session_id>) so a concurrent herdr session
# sharing this working tree can't trigger a reminder here for changes this
# session never made — e.g. a read-only review session shouldn't be told to
# commit another session's work.

set -uo pipefail

INPUT=$(cat) || exit 0

# A previous invocation of this hook already blocked this stop — don't loop.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null) || exit 0
[[ "$ACTIVE" == "true" ]] && exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
[[ "$SESSION_ID" =~ ^[A-Za-z0-9_-]+$ ]] || exit 0

MANIFEST="${TMPDIR:-/tmp}/claude-session-edits/$SESSION_ID"
[[ -f "$MANIFEST" ]] || exit 0

# No explicit in-repo filter: git itself fails closed on an out-of-repo
# pathspec (fatal, empty stdout), so a path outside this repo just leaves
# DIRTY empty and the loop moves on — no need to compare against
# `git rev-parse --show-toplevel`, whose symlink-resolved output (e.g.
# macOS /var -> /private/var) can silently mismatch the manifest's
# unresolved paths and mask a real reminder.
#
# sort -zu dedupes repeat edits of the same file (each git-status call below
# is a subprocess); the `|| cat` fallback keeps the (undeduped but correct)
# manifest order if sort ever fails, rather than silently reading nothing.
DIRTY=""
while IFS= read -r -d '' path; do
  DIRTY=$(git status --porcelain -- "$path" 2>/dev/null)
  [[ -n "$DIRTY" ]] && break
done < <(sort -zu "$MANIFEST" 2>/dev/null || cat "$MANIFEST")

[[ -n "$DIRTY" ]] || exit 0

printf '[REMINDER] Uncommitted changes remain in the working tree from this session (git status). Per the commit discipline rule, commit completed work before ending the turn — or state explicitly why it stays uncommitted.\n' >&2
exit 2
