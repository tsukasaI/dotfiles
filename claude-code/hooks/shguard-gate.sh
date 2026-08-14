#!/usr/bin/env bash
# PreToolUse Bash gate — meant to replace block-dangerous.sh as the sole
# live enforcer, but NOT YET WIRED into settings.json: cutover is paused
# pending upstream fixes (see docs/shguard-migration-deltas.md #23 and #24).
#
# Fails closed on every way this can go wrong, not just a PATH miss:
# - the binary can't be resolved (a bare `shguard` PATH miss would
#   otherwise exit 127 with no stdout, which the harness reads as allow)
# - the config file is missing (delta #18's residual gap: a cleanly
#   absent config silently falls back to built-in-only, not fail-closed)
# - shguard itself exits non-zero or produces no output (crash, panic)
# - the config exists but fails to load (malformed TOML etc.): shguard's
#   own fail-closed path returns `ask` with exit 0, not a nonzero exit,
#   so the RC/empty-output check below can't catch it — matched instead
#   on shguard's own documented "refusing to evaluate any command until
#   this is fixed" message (also the wording delta #18 already quotes
#   for the missing-explicit-$SHGUARD_CONFIG case)
# - jq itself missing: every check below (including deny_json) depends on
#   it, so its absence must be caught before any other check runs — a
#   missing jq would otherwise make deny_json emit nothing, and empty
#   stdout is read as allow by the harness, same as a PATH miss

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jq not found on PATH — failing closed"}}'
  exit 0
fi

deny_json() {
  jq -cn --arg reason "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
}

CONFIG="${SHGUARD_CONFIG:-$HOME/.config/shguard/config.toml}"
if [[ ! -e "$CONFIG" ]]; then
  deny_json "shguard config not found at $CONFIG — failing closed"
  exit 0
fi

BIN="$(command -v shguard 2>/dev/null)"
if [[ -z "$BIN" ]]; then
  deny_json "shguard binary not found on PATH — failing closed"
  exit 0
fi

OUT=$("$BIN")
RC=$?
if [[ $RC -ne 0 || -z "$OUT" ]]; then
  deny_json "shguard exited abnormally (exit $RC) — failing closed"
  exit 0
fi

if ! REASON=$(printf '%s' "$OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null); then
  deny_json "shguard emitted unparseable output — failing closed"
  exit 0
fi
if [[ "$REASON" == *"refusing to evaluate any command until this is fixed"* ]]; then
  deny_json "shguard config failed to load ($REASON) — failing closed instead of shguard's own ask"
  exit 0
fi

printf '%s\n' "$OUT"
