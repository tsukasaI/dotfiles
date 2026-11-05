#!/usr/bin/env bash
# pi/AGENTS.md is a hand distillation of claude-code/CLAUDE.md (see
# .claude/rules/pi.md). Nothing ties the two together, so an edit to
# CLAUDE.md can leave the distillation stale with no signal. pi/AGENTS.md
# carries the sha256 of the CLAUDE.md it was last checked against:
#
#   <!-- distilled-from: claude-code/CLAUDE.md sha256:<hex> -->
#
# This recomputes that hash and fails when it differs. A failure means
# "re-check pi/AGENTS.md against the change"; it does not say what to edit.
#
#   bash tests/pi-agents-sync.sh           check (exit 1 on drift)
#   bash tests/pi-agents-sync.sh --write   record the current hash, after
#                                          re-checking pi/AGENTS.md by hand

set -euo pipefail
cd "$(dirname "$0")/.."

SRC=claude-code/CLAUDE.md
DST=pi/AGENTS.md
PREFIX="<!-- distilled-from: $SRC sha256:"

# sha256sum is coreutils (Linux, and macOS via Nix); shasum ships with macOS.
hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | cut -d' ' -f1
  else
    shasum -a 256 -- "$1" | cut -d' ' -f1
  fi
}

want=$(hash_of "$SRC")
marker="$PREFIX$want -->"

if [[ ${1-} == --write ]]; then
  if ! grep -qF "$PREFIX" "$DST"; then
    echo "FAIL no '$PREFIX...' marker in $DST; add one near the top first" >&2
    exit 1
  fi
  out=""
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line == "$PREFIX"* ]] && line=$marker
    out+="$line"$'\n'
  done <"$DST"
  printf '%s' "$out" >"$DST"
  echo "wrote $DST marker for $SRC sha256:$want"
  exit 0
fi

have=$(grep -F "$PREFIX" "$DST" | head -n 1 || true)
if [[ -z $have ]]; then
  echo "FAIL no '$PREFIX...' marker in $DST" >&2
  exit 1
fi
if [[ $have == "$marker" ]]; then
  echo "$DST matches the recorded $SRC hash"
else
  echo "FAIL $SRC changed; re-check $DST, then run: bash tests/pi-agents-sync.sh --write" >&2
  exit 1
fi
