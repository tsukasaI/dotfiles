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
  local s=$1 out="" i c
  for (( i=0; i<${#s}; i++ )); do
    c=${s:i:1}
    case $c in
      "."|"^"|"\$"|"*"|"+"|"?"|"("|")"|"["|"]"|"{"|"}"|"|"|"\\") out+="\\"$c ;;
      *) out+=$c ;;
    esac
  done
  printf '%s' "$out"
}

# Strip text inside single- and double-quoted regions so blocklist patterns
# don't false-positive on words like "secret" inside commit messages or echo args.
# Inside double quotes, $(...) and `...` still execute (bash expansion), so
# preserve those regions verbatim. Conservative: when in doubt, keep text.
strip_quotes_preserving_subst() {
  local s=$1
  local n=${#s}
  local out=""
  local i=0
  local c start depth cc
  while (( i < n )); do
    c=${s:i:1}
    if [[ $c == "'" ]]; then
      ((i++))
      while (( i < n )) && [[ ${s:i:1} != "'" ]]; do ((i++)); done
      (( i < n )) && ((i++))
    elif [[ $c == '"' ]]; then
      ((i++))
      while (( i < n )); do
        c=${s:i:1}
        if [[ $c == '"' ]]; then
          ((i++)); break
        elif [[ $c == '\' ]]; then
          ((i+=2))
        elif [[ $c == '$' && ${s:i+1:1} == '(' ]]; then
          start=$i; depth=1
          ((i+=2))
          while (( i < n )) && (( depth > 0 )); do
            cc=${s:i:1}
            if [[ $cc == '\' ]]; then
              ((i+=2)); continue
            elif [[ $cc == '(' ]]; then ((depth++))
            elif [[ $cc == ')' ]]; then ((depth--))
            fi
            ((i++))
          done
          out+=${s:start:i-start}
        elif [[ $c == '`' ]]; then
          start=$i
          ((i++))
          while (( i < n )) && [[ ${s:i:1} != '`' ]]; do
            if [[ ${s:i:1} == '\' ]]; then ((i+=2)); else ((i++)); fi
          done
          (( i < n )) && ((i++))
          out+=${s:start:i-start}
        else
          ((i++))
        fi
      done
    else
      out+=$c
      ((i++))
    fi
  done
  printf '%s' "$out"
}

# Strip the body of quoted heredocs (<<'TAG' / <<"TAG" / <<-'TAG' / <<-"TAG").
# Per POSIX, a quoted heredoc delimiter disables parameter expansion and command
# substitution → body is pure literal data. Keeping the start/terminator lines
# preserves the wrapper (so `python <<'EOF'` etc. still match the blocklist),
# but the body is removed before scanning so commit messages containing words
# like 'bash' / 'secret' / 'credential' don't false-positive.
strip_quoted_heredoc_bodies() {
  local s=$1 out="" line tag="" tabstrip="" cmp
  while IFS= read -r line; do
    if [[ -n "$tag" ]]; then
      cmp=$line
      [[ -n "$tabstrip" ]] && cmp="${line#"${line%%[!$'\t']*}"}"
      if [[ "$cmp" == "$tag" ]]; then
        out+="$line"$'\n'
        tag=""; tabstrip=""
      fi
    else
      if [[ "$line" =~ \<\<(-)?\'([A-Za-z_][A-Za-z0-9_]*)\' ]] \
        || [[ "$line" =~ \<\<(-)?\"([A-Za-z_][A-Za-z0-9_]*)\" ]]; then
        tabstrip="${BASH_REMATCH[1]}"
        tag="${BASH_REMATCH[2]}"
      fi
      out+="$line"$'\n'
    fi
  done <<< "$s"
  printf '%s' "${out%$'\n'}"
}

CMD_NOQUOTES=$(strip_quotes_preserving_subst "$(strip_quoted_heredoc_bodies "$CMD")")

# Command-boundary leading char class. Chars that can legitimately precede
# a command name in bash:
#   `<` process substitution `<(rm ...)`
#   `\` alias-bypass `\rm`
#   `/` full path `/usr/bin/rm`
#   `{` `,` brace expansion `{rm,echo}`
#   `;` `&` `|` `` ` `` `$` `(` shell separators / substitution starters
CB='(^|[<\\/{,;&|`$([:space:]])'

# Command-boundary trailing char class: chars that legitimately follow a
# command name in bash. Originally only space|EOL, which let bypasses like
# `rm;ls`, `bash;ls`, `rm>file` slip through. `,` and `}` cover brace
# expansion forms like `{rm,echo}` and `{cmd,rm}`.
TB='([[:space:];&|<>()`,{}]|$)'

# ── Special case: curl (localhost allowed, external blocked) ─────────────────
if [[ "$CMD" =~ ${CB}curl[[:space:]] ]]; then
  if ! [[ "$CMD" =~ curl[^\'\"]*https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|[[:space:]]|$) ]]; then
    block "NETWORK" "'curl' to a non-localhost address can exfiltrate data."
  fi
fi

# ── Special case: git push --force / -f blocked, --force-with-lease allowed ──
if [[ "$CMD_NOQUOTES" =~ ${CB}git[[:space:]]+push([[:space:]]|$) ]]; then
  if [[ "$CMD_NOQUOTES" =~ (^|[[:space:]])(--force([[:space:]]|$)|-f([[:space:]]|$)) ]]; then
    block "GIT" "git push --force / -f rewrites remote history. Use --force-with-lease if force is genuinely needed."
  fi
fi

# ── Special case: reader commands accessing secret files ────────────────────
# Single-statement bounded via [^;&|<>]* to avoid false-positives like
# `cat README.md && echo done > .env`. Regex stored in a variable because
# bash's [[ ]] tokenizer treats `;&` (case fall-through) as a syntax token.
SECRET_READ_RE='(cat|head|tail|less|more|bat|nano|vim|nvim)[[:space:]]+[^;&|<>]*(\.env([.][a-zA-Z0-9_-]+)?|\.pem|\.key|\.p12|id_rsa|id_ed25519|id_ecdsa|id_dsa)([[:space:]]|$|[;&|<>])'
if [[ "$CMD_NOQUOTES" =~ ${CB}${SECRET_READ_RE} ]]; then
  block "CREDENTIAL" "Reader command targets a secret file (.env* / .pem / .key / .p12 / SSH private key)."
fi

# ── Pipe-to-shell / pipe-to-interpreter injection ───────────────────────────
# Includes script interpreters that read commands from stdin (python, node, etc.)
if [[ "$CMD" =~ \|[[:space:]]*(bash|sh|zsh|dash|fish|ksh|python|python3|node|perl|ruby|php)([[:space:]]|$) ]]; then
  block "CODE_INJECTION" "Piping into a shell or script interpreter can execute arbitrary code."
fi

# ── /dev/tcp and /dev/udp (bash network pseudo-devices) ─────────────────────
if [[ "$CMD" =~ /dev/(tcp|udp)/ ]]; then
  block "NETWORK" "Bash /dev/tcp|udp opens covert network channels."
fi

# ── ANSI-C $'...' strings hide command names via \xNN / \NNN escapes ────────
# Bash decodes $'\x72\x6d' to literal "rm" at runtime, so the scanner can't
# see the underlying command. Block any use of $'...' to close this hole.
if [[ "$CMD" =~ \$\' ]]; then
  block "CODE_INJECTION" "ANSI-C \$'...' strings can hide command names via escape sequences."
fi

# ── Allowlist: security tools that match blocklist patterns ──────────────────
ALLOWLIST="$SCRIPT_DIR/allowlist.conf"
if [[ -f "$ALLOWLIST" ]]; then
  while IFS= read -r tool; do
    [[ "$tool" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${tool//[[:space:]]/}" ]] && continue
    tool=$(trim "$tool")
    escaped=$(escape_regex "$tool")
    if [[ "$CMD_NOQUOTES" =~ ${CB}${escaped}${TB} ]]; then
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
    pattern="${CB}${escaped}${TB}"
  fi

  if [[ "$CMD_NOQUOTES" =~ $pattern ]]; then
    block "$category" "$reason"
  fi
done < "$BLOCKLIST"

exit 0
