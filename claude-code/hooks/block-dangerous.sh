#!/usr/bin/env bash
# PreToolUse hook: blocks dangerous Bash commands.
# stdin  -> JSON: {"tool_input":{"command":"..."}}
# exit 0 -> allow  (proceeds to normal permission check)
# exit 2 -> block  (stdout shown as reason to the user)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKLIST="$SCRIPT_DIR/blocklist.conf"

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[[ -z "$CMD" ]] && exit 0

block() {
  printf '[BLOCKED: %s] %s\nBlocked command:\n  %s\n' "$1" "$2" "$CMD"
  exit 2
}

# Command-boundary prefix: ensures "remove-items" does not match "rm"
CB='(^|[;&|`$([:space:]])'

# ── Special case: curl (localhost allowed, external blocked) ─────────────────
if [[ "$CMD" =~ ${CB}curl[[:space:]] ]]; then
  if ! [[ "$CMD" =~ curl[^\'\"]*https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|[[:space:]]|$) ]]; then
    block "NETWORK" "'curl' to a non-localhost address can exfiltrate data."
  fi
fi

# ── Pipe-to-shell injection ──────────────────────────────────────────────────
if [[ "$CMD" =~ \|[[:space:]]*(bash|sh|zsh|dash|fish|ksh)([[:space:]]|$) ]]; then
  block "CODE_INJECTION" "Piping into a shell interpreter can execute arbitrary remote code."
fi

# ── /dev/tcp and /dev/udp (bash network pseudo-devices) ─────────────────────
if [[ "$CMD" =~ /dev/(tcp|udp)/ ]]; then
  block "NETWORK" "Bash /dev/tcp|udp opens covert network channels."
fi

# ── Blocklist rules ──────────────────────────────────────────────────────────
while IFS='|' read -r category prefix reason; do
  # Skip comments and blank lines
  [[ "$category" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${category//[[:space:]]/}" ]] && continue

  category="${category//[[:space:]]/}"
  prefix="${prefix#"${prefix%%[![:space:]]*}"}"   # ltrim
  prefix="${prefix%"${prefix##*[![:space:]]}"}"   # rtrim
  reason="${reason#"${reason%%[![:space:]]*}"}"   # ltrim
  reason="${reason%"${reason##*[![:space:]]}"}"   # rtrim

  [[ -z "$prefix" ]] && continue

  # *...*  → "contains anywhere" match (e.g. *secret*)
  if [[ "$prefix" == \** && "$prefix" == *\* ]]; then
    inner="${prefix:1:${#prefix}-2}"
    escaped=$(printf '%s' "$inner" | sed 's/[.^$*+?()[\]{}|\\]/\\&/g')
    if [[ "$CMD" =~ $escaped ]]; then
      block "$category" "$reason"
    fi
  # prefix*  → "starts with" match, no end-boundary (e.g. mkfs* matches mkfs.ext4)
  elif [[ "$prefix" == *\* ]]; then
    inner="${prefix:0:${#prefix}-1}"
    escaped=$(printf '%s' "$inner" | sed 's/[.^$*+?()[\]{}|\\]/\\&/g')
    pattern="${CB}${escaped}"
    if [[ "$CMD" =~ $pattern ]]; then
      block "$category" "$reason"
    fi
  else
    # Standard command-boundary prefix match (e.g. rm matches "rm foo" but not "remove-items")
    escaped=$(printf '%s' "$prefix" | sed 's/[.^$*+?()[\]{}|\\]/\\&/g')
    pattern="${CB}${escaped}([[:space:]]|$)"
    if [[ "$CMD" =~ $pattern ]]; then
      block "$category" "$reason"
    fi
  fi
done < "$BLOCKLIST"

exit 0
