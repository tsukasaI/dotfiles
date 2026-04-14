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

trim() {
  local s=$1
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

escape_regex() {
  printf '%s' "$1" | sed 's/[.^$*+?()[\]{}|\\]/\\&/g'
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

# ── Allowlist: security tools that match blocklist patterns ──────────────────
ALLOWLIST="$SCRIPT_DIR/allowlist.conf"
if [[ -f "$ALLOWLIST" ]]; then
  while IFS= read -r tool; do
    [[ "$tool" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${tool//[[:space:]]/}" ]] && continue
    tool=$(trim "$tool")
    escaped=$(escape_regex "$tool")
    if [[ "$CMD" =~ ${CB}${escaped}([[:space:]]|$) ]]; then
      exit 0
    fi
  done < "$ALLOWLIST"
fi

# ── Blocklist rules ──────────────────────────────────────────────────────────
while IFS='|' read -r category prefix reason; do
  # Skip comments and blank lines
  [[ "$category" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${category//[[:space:]]/}" ]] && continue

  category="${category//[[:space:]]/}"
  prefix=$(trim "$prefix")
  reason=$(trim "$reason")

  [[ -z "$prefix" ]] && continue

  # *...*  → "contains anywhere" match (e.g. *secret*)
  if [[ "$prefix" == \** && "$prefix" == *\* ]]; then
    escaped=$(escape_regex "${prefix:1:${#prefix}-2}")
    pattern="$escaped"
  # prefix*  → "starts with" match, no end-boundary (e.g. mkfs* matches mkfs.ext4)
  elif [[ "$prefix" == *\* ]]; then
    escaped=$(escape_regex "${prefix:0:${#prefix}-1}")
    pattern="${CB}${escaped}"
  else
    # Standard command-boundary prefix match (e.g. rm matches "rm foo" but not "remove-items")
    escaped=$(escape_regex "$prefix")
    pattern="${CB}${escaped}([[:space:]]|$)"
  fi

  if [[ "$CMD" =~ $pattern ]]; then
    block "$category" "$reason"
  fi
done < "$BLOCKLIST"

exit 0
