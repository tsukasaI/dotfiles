#!/usr/bin/env bash
# Sync check for the setup.sh symlinks (issue #101): the SYMLINKED table in
# claude-code/mod/hooks/session-edits.tsx mirrors every `link_with_backup`
# pair in setup.sh, because a hooks module cannot import node:fs to resolve
# links. A link added to setup.sh but not to the table silently makes edits
# to that file look "not live" in the session-edits pane.
#
# This extracts both lists as "<link> <target>" pairs and fails if they differ.
# Run locally: bash tests/symlinked-sync.sh
# Exit: 0 the lists match, 1 a mismatch was found.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SETUP=setup.sh
TABLE=claude-code/mod/hooks/session-edits.tsx

# setup.sh lines: link_with_backup "$DOTFILES/<target>" ~/<link>
from_setup() {
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ ^link_with_backup[[:space:]]+\"\$DOTFILES/([^\"]+)\"[[:space:]]+~/([^[:space:]]+)[[:space:]]*$ ]]; then
      echo "${BASH_REMATCH[2]} ${BASH_REMATCH[1]}"
    fi
  done < <(grep -E '^link_with_backup ' "$SETUP")
}

# SYMLINKED rows: ['<link>', '<target>'],
from_table() {
  local line
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*\[\'([^\']+)\',[[:space:]]*\'([^\']+)\'\],?[[:space:]]*$ ]]; then
      echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
    fi
  done < <(grep -E "^[[:space:]]*\['[^']+',[[:space:]]*'[^']+'\]," "$TABLE")
}

setup_pairs=$(from_setup | sort)
table_pairs=$(from_table | sort)

if [[ -z "$setup_pairs" ]]; then
  echo "FAIL no link_with_backup pairs found in $SETUP - the sync check would pass vacuously" >&2
  exit 1
fi
if [[ -z "$table_pairs" ]]; then
  echo "FAIL no SYMLINKED pairs found in $TABLE - the sync check would pass vacuously" >&2
  exit 1
fi

if [[ "$setup_pairs" != "$table_pairs" ]]; then
  echo "FAIL SYMLINKED drift: < $SETUP vs > $TABLE"
  diff <(echo "$setup_pairs") <(echo "$table_pairs")
  exit 1
fi

echo "SYMLINKED matches setup.sh ($(echo "$setup_pairs" | wc -l | tr -d ' ') links)"
