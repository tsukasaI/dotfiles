#!/usr/bin/env bash
# Shared cooling-period helpers for the aging-aware update scripts (#9).
#
# Dedupes the age-in-days math and the "[skip]"/"[ok]" status-line format
# that safe-flake-update.sh, safe-lazy-update.sh, and check-flake-cooling.sh
# each reimplemented independently. Source this file after
# `set -euo pipefail`; it only sets env-var defaults and defines functions —
# no other side effects besides snapshotting "now" once, at source time.
#
# Revert mechanics differ enough between callers (flake.lock file-swap vs.
# lazy-lock.json jq patch vs. check-flake-cooling.sh's read-only git-revision
# diff) that they are deliberately NOT folded in here — only the parts every
# caller computed identically are shared.

COOLING_DAYS="${COOLING_DAYS:-7}"
NIXPKGS_COOLING_DAYS="${NIXPKGS_COOLING_DAYS:-14}"
COOLING_NOW="${COOLING_NOW:-$(date +%s)}"

# cooling_age_days <last_modified_epoch_seconds>
# Prints the whole-day age relative to COOLING_NOW (snapshotted once at
# source time so every call within a run shares the same instant).
cooling_age_days() {
  echo $(( (COOLING_NOW - $1) / 86400 ))
}

# cooling_msg_skip <name-column-width> <name> <age_days> <threshold_days>
cooling_msg_skip() {
  local width="$1" name="$2" age="$3" threshold="$4"
  printf '[skip] %-*s age %dd < %dd\n' "$width" "$name" "$age" "$threshold"
}

# cooling_msg_ok <name-column-width> <name> <age_days> [verified_suffix]
cooling_msg_ok() {
  local width="$1" name="$2" age="$3" verified="${4:-}"
  printf '[ok]   %-*s age %dd%s\n' "$width" "$name" "$age" "$verified"
}
