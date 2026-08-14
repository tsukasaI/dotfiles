#!/usr/bin/env bash
# Sync check for the language-agnostic code rules (issue #43): atomicity.md,
# code-review.md, comments.md, data-handling.md, encoding.md, and
# error-handling.md each carry their own copy of the `paths:` frontmatter
# list (17 code-file extensions) because it must be readable per-file —
# there is no include mechanism. That leaves no single source of truth:
# adding/removing a language means editing 6 files identically, and a missed
# file silently narrows or widens just that one rule's scope with no signal.
#
# This extracts the `paths:` block from each file and fails if any of the
# 6 copies has drifted from the first. Run locally: bash tests/rules-paths-sync.sh
# Exit: 0 all match, 1 a mismatch was found.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
DIR=claude-code/rules
FILES=(atomicity code-review comments data-handling encoding error-handling)

# extract <file>: the `paths:` line through (not including) the closing `---`.
extract() {
  awk '/^paths:$/{f=1} f && /^---$/{exit} f{print}' "$DIR/$1.md"
}

reference=$(extract "${FILES[0]}")
fails=0

for f in "${FILES[@]:1}"; do
  current=$(extract "$f")
  if [[ "$current" != "$reference" ]]; then
    echo "FAIL paths: frontmatter drift: ${FILES[0]}.md vs $f.md"
    diff <(echo "$reference") <(echo "$current")
    fails=$((fails + 1))
  fi
done

echo "---"
if ((fails == 0)); then
  echo "paths: frontmatter identical across ${#FILES[@]} files"
else
  echo "$fails file(s) drifted from ${FILES[0]}.md"
fi
((fails == 0))
