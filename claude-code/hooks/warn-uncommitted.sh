#!/usr/bin/env bash
# Stop hook: remind the agent to commit before ending the turn.
# stdin  -> JSON: {"stop_hook_active": bool, ...}
# exit 0 -> allow stop, exit 2 -> block once (stderr is fed back to the model)
#
# Reminder, not a guardrail: unlike the PreToolUse hooks this fails OPEN —
# a broken reminder must never trap the session in an unstoppable state.
# It runs no verification; pre-commit owns that when the commit happens.

set -uo pipefail

INPUT=$(cat) || exit 0

# A previous invocation of this hook already blocked this stop — don't loop.
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null) || exit 0
[[ "$ACTIVE" == "true" ]] && exit 0

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[[ -z "$(git status --porcelain 2>/dev/null)" ]] && exit 0

printf '[REMINDER] Uncommitted changes remain in the working tree (git status). Per the commit discipline rule, commit completed work before ending the turn — or state explicitly why it stays uncommitted.\n' >&2
exit 2
