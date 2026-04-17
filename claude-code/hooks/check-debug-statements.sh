#!/usr/bin/env bash
# Stop hook (async): warns about leftover debug statements in changed files.
# Non-blocking — outputs warnings but never fails.

set -euo pipefail

# Get changed files (staged + unstaged) relative to HEAD
FILES=$(git diff --name-only HEAD 2>/dev/null || true)
[[ -z "$FILES" ]] && exit 0

# Debug statement patterns per file extension
check_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local pattern=""
  case "$file" in
    *.js|*.jsx|*.ts|*.tsx|*.mjs|*.cjs)
      pattern='console\.(log|debug|info|warn|error)\(' ;;
    *.go)
      pattern='fmt\.Print(ln|f)?\(' ;;
    *.py)
      pattern='(^|[[:space:]])print\(|breakpoint\(\)|import pdb' ;;
    *.rs)
      pattern='dbg!\(|println!\(' ;;
    *.rb)
      pattern='(^|[[:space:]])puts[[:space:]]|binding\.pry|byebug' ;;
    *)
      return 0 ;;
  esac

  local hits
  hits=$(grep -nE "$pattern" "$file" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    printf '  %s:\n' "$file"
    printf '%s\n' "$hits" | while IFS= read -r line; do
      printf '    %s\n' "$line"
    done
  fi
}

OUTPUT=""
while IFS= read -r file; do
  result=$(check_file "$file")
  if [[ -n "$result" ]]; then
    OUTPUT+="$result"$'\n'
  fi
done <<< "$FILES"

if [[ -n "$OUTPUT" ]]; then
  printf '\n⚠ Debug statements found in changed files:\n%s' "$OUTPUT"
fi

exit 0
