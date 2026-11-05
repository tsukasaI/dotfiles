#!/usr/bin/env bash
# Contract markers are parsed across skills: /mkgoal reads the
# `<!-- triage:v1 -->` comment /triage writes, and /triage reads the
# `<!-- decision-note:v1 -->` issue body review-gate defines. Each marker has
# one owner file; a version bump there that misses a reader would make the
# reader silently ignore every comment (it matches the marker by prefix).
#
# This checks, for each marker:
#   1. the owner file carries exactly one version of it;
#   2. no other file under claude-code/skills uses a different version;
#   3. the owner's field names appear (backticked) in the reader that parses
#      them, so a renamed or added field is not left behind.
#
# Run locally: bash tests/contract-markers-sync.sh
# Exit: 0 all consistent, 1 a mismatch was found.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SKILLS=claude-code/skills

# name | owner file | reader file | fields the reader need not mention
MARKERS=(
  "triage|$SKILLS/triage/SKILL.md|$SKILLS/mkgoal/SKILL.md|Group"
  "decision-note|$SKILLS/review-gate/SKILL.md|$SKILLS/triage/SKILL.md|Not auto-fixed because Source"
)

fails=0
fail() {
  echo "FAIL $*" >&2
  fails=$((fails + 1))
}

# fields <owner> <name>: field names of the contract block that follows the
# marker (`- Name:` lines), up to the first blank line or closing fence.
fields() {
  awk -v m="<!-- $2:v" '
    index($0, m) { f = 1; next }
    f && /^[[:space:]]*- [A-Za-z]/ {
      sub(/^[[:space:]]*- /, ""); sub(/:.*/, ""); print; got = 1; next
    }
    f && got && (/^$/ || /^[[:space:]]*```/) { exit }
  ' "$1"
}

for entry in "${MARKERS[@]}"; do
  IFS='|' read -r name owner reader skip <<<"$entry"

  owner_marker=$(grep -oE "<!-- $name:v[0-9]+ -->" "$owner" | sort -u)
  if [[ -z $owner_marker ]]; then
    fail "no '<!-- $name:vN -->' marker in $owner - the check would pass vacuously"
    continue
  fi
  if [[ $(wc -l <<<"$owner_marker") -ne 1 ]]; then
    fail "$owner carries more than one version of the $name marker"
    continue
  fi

  while IFS=: read -r file _ found; do
    [[ $found == "$owner_marker" ]] || fail "$file uses '$found', owner $owner has '$owner_marker'"
  done < <(grep -rnoE "<!-- $name:v[0-9]+ -->" "$SKILLS")

  names=$(fields "$owner" "$name")
  if [[ -z $names ]]; then
    fail "no field names found after the $name marker in $owner"
    continue
  fi
  # Join wrapped lines so a backticked name split across lines still matches.
  reader_text=$(tr '\n' ' ' <"$reader" | tr -s ' ')
  while IFS= read -r field; do
    [[ " $skip " == *" $field "* ]] && continue
    [[ $reader_text == *"\`$field\`"* ]] || fail "$name field '$field' (owner $owner) is not named in $reader"
  done <<<"$names"
done

echo "---"
if ((fails == 0)); then
  echo "contract markers and field names consistent across ${#MARKERS[@]} contracts"
fi
((fails == 0))
