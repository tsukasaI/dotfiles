#!/usr/bin/env bash
# PreToolUse shadow hook (migration plan step 5): logs what shguard WOULD
# have decided for this command, without affecting the live decision.
# block-dangerous.sh remains the sole enforcer while this runs alongside it.
#
# Always exits 0 and never writes to stdout — this script has zero
# enforcement authority, so every failure mode here (shguard missing, log
# write failure, malformed input) must fail OPEN and silent, unlike
# block-dangerous.sh's fail-closed discipline. No `set -e`/`-u`/pipefail:
# every risky step is individually guarded so the script always reaches
# the trailing `exit 0` no matter what fails along the way.
#
# Log: ~/.local/share/shguard-shadow/shadow.jsonl (outside the repo, 600
# perms — command text can carry secrets). Delete once the shadow period's
# parity check (migration plan step 6) is done with it.

LOG_DIR="$HOME/.local/share/shguard-shadow"
LOG_FILE="$LOG_DIR/shadow.jsonl"

INPUT=$(cat 2>/dev/null)

if [[ -n "$INPUT" ]] && command -v shguard >/dev/null 2>&1; then
  VERDICT=$(printf '%s' "$INPUT" | shguard 2>/dev/null)
  SHGUARD_EXIT=$?
  mkdir -p "$LOG_DIR" 2>/dev/null
  chmod 700 "$LOG_DIR" 2>/dev/null
  [[ -f "$LOG_FILE" ]] || { : > "$LOG_FILE"; chmod 600 "$LOG_FILE"; } 2>/dev/null
  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
  if [[ -n "$VERDICT" ]]; then
    jq -cn --arg ts "$TIMESTAMP" --arg payload_raw "$INPUT" --arg verdict_raw "$VERDICT" --argjson exit_code "$SHGUARD_EXIT" \
      '{timestamp: $ts, payload: ($payload_raw | try fromjson catch $payload_raw), verdict: ($verdict_raw | try fromjson catch $verdict_raw), shguard_exit: $exit_code}' \
      >> "$LOG_FILE" 2>/dev/null
  else
    # shguard produced no output at all (crash, killed, etc.) — log this
    # explicitly instead of silently skipping, so a shadow-log analysis
    # can't mistake "shguard broke" for "nothing happened here".
    jq -cn --arg ts "$TIMESTAMP" --arg payload_raw "$INPUT" --argjson exit_code "$SHGUARD_EXIT" \
      '{timestamp: $ts, payload: ($payload_raw | try fromjson catch $payload_raw), verdict: "EMPTY_VERDICT", shguard_exit: $exit_code}' \
      >> "$LOG_FILE" 2>/dev/null
  fi
fi

exit 0
