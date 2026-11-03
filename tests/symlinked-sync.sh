#!/usr/bin/env bash
# Sync check for the setup.sh symlinks (issue #101): the SYMLINKED table in
# claude-code/mod/hooks/session-edits.tsx mirrors every `link_with_backup`
# pair in setup.sh, because a hooks module cannot import node:fs to resolve
# links. A link added to setup.sh but not to the table silently makes edits
# to that file look "not live" in the session-edits pane.
#
# This extracts both lists as "<link> <target>" pairs and fails if they differ.
# A link_with_backup line it cannot parse also fails, so it is never skipped.
# Run locally: bash tests/symlinked-sync.sh
# Exit: 0 the lists match, 1 a mismatch was found.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SETUP=${SETUP:-setup.sh}
TABLE=${TABLE:-claude-code/mod/hooks/session-edits.tsx}

# setup.sh lines: link_with_backup "$DOTFILES/<target>" ~/<link> [# comment]
# Prints "<link> <target>" pairs; returns 1 on a line it cannot parse.
from_setup() {
  local line
  local re='^link_with_backup[[:space:]]+"\$DOTFILES/([^"]+)"[[:space:]]+~/([^[:space:]]+)[[:space:]]*(#.*)?$'
  while IFS= read -r line; do
    if [[ "$line" =~ $re ]]; then
      echo "${BASH_REMATCH[2]} ${BASH_REMATCH[1]}"
    else
      echo "FAIL cannot parse $SETUP line: $line" >&2
      return 1
    fi
  done < <(grep -E '^link_with_backup ' "$SETUP" | grep -v '^link_with_backup()')
}

# Rows of the SYMLINKED array only: ['<link>', '<target>'],
from_table() {
  local line in_table=0
  local re="^[[:space:]]*\['([^']+)',[[:space:]]*'([^']+)'\],?[[:space:]]*\$"
  while IFS= read -r line; do
    if ((in_table == 0)); then
      [[ "$line" =~ ^(export[[:space:]]+)?const[[:space:]]+SYMLINKED[:[:space:]=] ]] && in_table=1
      continue
    fi
    [[ "$line" =~ ^[[:space:]]*\] ]] && break
    if [[ "$line" =~ $re ]]; then
      echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
    fi
  done <"$TABLE"
}

setup_out=$(from_setup) || exit 1
setup_pairs=$(echo "$setup_out" | sort)
table_pairs=$(from_table | sort)

if [[ -z "$setup_out" ]]; then
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
