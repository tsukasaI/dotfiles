#!/usr/bin/env bash
# PreToolUse Bash gate — meant to replace block-dangerous.sh as the sole
# live enforcer, but NOT YET WIRED into settings.json: cutover is paused
# pending an upstream fix (see docs/shguard-migration-deltas.md #22).
#
# Fails closed on every way this can go wrong, not just a PATH miss:
# - the binary can't be resolved (a bare `shguard` PATH miss would
#   otherwise exit 127 with no stdout, which the harness reads as allow)
# - the config file is missing (delta #18's residual gap: a cleanly
#   absent config silently falls back to built-in-only, not fail-closed)
# - shguard itself exits non-zero or produces no output (crash, panic)

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
printf '%s\n' "$OUT"
