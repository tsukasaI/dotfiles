#!/usr/bin/env bash
# PreToolUse hook: blocks dangerous Bash commands.
# stdin  -> JSON: {"tool_input":{"command":"..."}}
# exit 0 -> allow  (proceeds to normal permission check)
# exit 2 -> block  (stderr is fed back to the model as the reason)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOCKLIST="$SCRIPT_DIR/blocklist.conf"

CMD=""

block() {
  local alt="${3:-}"
  printf '[BLOCKED: %s] %s\n' "$1" "$2"
  [[ -n "$alt" ]] && printf '→ Use instead: %s\n' "$alt"
  printf 'Blocked command:\n  %s\n' "${CMD:-<unparsed hook input>}"
  exit 2
} >&2

# Fail closed (#32): any unhandled top-level failure must surface as exit 2
# (block) — with plain `set -e` the script dies with a non-2 status, which
# the harness treats as allow. Deliberately NOT `set -E`: the ERR trap must
# not be inherited by command substitutions — the quote-stripping parser
# below uses arithmetic statements like ((i++)) whose status is legitimately
# non-zero when the value is 0, and inheriting the trap there would
# false-positive-block commands that start with a quote character.
trap 'block "INTERNAL_ERROR" "guardrail hook crashed unexpectedly — failing closed"' ERR

INPUT=$(cat) || block "INTERNAL_ERROR" "failed to read hook input — failing closed"
CMD_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_input.command | type' 2>/dev/null) \
  || block "INTERNAL_ERROR" "hook input is not valid JSON — failing closed"
case "$CMD_TYPE" in
  string) CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command') ;;
  null)   exit 0 ;;  # payload has no command field — nothing to scan
  *)      block "INTERNAL_ERROR" "tool_input.command is not a string — failing closed" ;;
esac
[[ -z "$CMD" ]] && exit 0

# Fail closed (#33): a missing/unreadable blocklist must block everything,
# not silently disable every rule below. Asymmetric with the allowlist on
# purpose: a missing allowlist only loses exceptions, so it may stay soft.
[[ -r "$BLOCKLIST" ]] || block "INTERNAL_ERROR" "blocklist.conf missing or unreadable — failing closed"

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

# Normalize a command string for scanning (bash-word semantics, not a full
# tokenizer). Two modes (#1):
#   scan    -> used against the block/allow lists. Backslashes outside quotes
#              are resolved (r\m → rm — bash drops the backslash and runs rm).
#              A quoted region is restored without its quote chars when it is
#              glued to an unquoted word fragment (cur'l' → curl) or sits at
#              command position (start of string / after ; & | ` ( — catches
#              'rm' -rf). A standalone quoted argument (git commit -m
#              'rm -rf /') is dropped, so blocklist words inside plain string
#              arguments don't false-positive. $(...) and `...` inside double
#              quotes still execute despite the quotes → always kept.
#   resolve -> all quoted content restored. Used by the curl localhost check,
#              which must see quoted URLs.
# Arithmetic uses assignment form (i=$((i+1))), never bare ((i++)) — the
# latter returns non-zero status when the value is 0, which is a set -e trap.
normalize_cmd() {
  local mode=$1 s=$2
  local n=${#s} out="" i=0
  local c qc region subst start depth cc keep t
  while (( i < n )); do
    c=${s:i:1}
    if [[ $c == '\' ]]; then
      # Backslash outside quotes: bash removes it and keeps the next char.
      out+=${s:i+1:1}
      i=$((i+2))
    elif [[ $c == "'" || $c == '"' ]]; then
      qc=$c
      region=""   # resolved content of the quoted region
      subst=""    # $(...) / `...` parts only (execute even when quoted)
      i=$((i+1))
      if [[ $qc == "'" ]]; then
        # Single quotes: content is literal, backslashes included.
        while (( i < n )) && [[ ${s:i:1} != "'" ]]; do
          region+=${s:i:1}
          i=$((i+1))
        done
        (( i < n )) && i=$((i+1))
      else
        while (( i < n )); do
          c=${s:i:1}
          if [[ $c == '"' ]]; then
            i=$((i+1)); break
          elif [[ $c == '\' ]]; then
            # In double quotes, backslash only escapes $ ` " \ — anything
            # else keeps both chars (so cur"\l" stays cur\l, not curl).
            case ${s:i+1:1} in
              '$'|'`'|'"'|'\') region+=${s:i+1:1} ;;
              *)               region+=${s:i:2} ;;
            esac
            i=$((i+2))
          elif [[ $c == '$' && ${s:i+1:1} == '(' ]]; then
            start=$i; depth=1
            i=$((i+2))
            while (( i < n )) && (( depth > 0 )); do
              cc=${s:i:1}
              if [[ $cc == '\' ]]; then
                i=$((i+2)); continue
              elif [[ $cc == '(' ]]; then depth=$((depth+1))
              elif [[ $cc == ')' ]]; then depth=$((depth-1))
              fi
              i=$((i+1))
            done
            region+=${s:start:i-start}
            subst+=${s:start:i-start}
          elif [[ $c == '`' ]]; then
            start=$i
            i=$((i+1))
            while (( i < n )) && [[ ${s:i:1} != '`' ]]; do
              if [[ ${s:i:1} == '\' ]]; then i=$((i+2)); else i=$((i+1)); fi
            done
            (( i < n )) && i=$((i+1))
            region+=${s:start:i-start}
            subst+=${s:start:i-start}
          else
            region+=$c
            i=$((i+1))
          fi
        done
      fi
      keep=0
      if [[ $mode == resolve ]]; then
        keep=1
      else
        # Glued to an unquoted word fragment on either side?
        [[ ${out: -1} == [A-Za-z0-9_/.-] ]] && keep=1
        [[ ${s:i:1} == [A-Za-z0-9_/.-] ]] && keep=1
        # At command position (start of string / after a real separator)?
        if (( keep == 0 )); then
          t=$out
          t="${t%"${t##*[![:space:]]}"}"
          if [[ -z $t ]]; then
            keep=1
          else
            case ${t: -1} in ';'|'&'|'|'|'`'|'(') keep=1 ;; esac
          fi
        fi
      fi
      if (( keep )); then
        out+=$region
      else
        out+=$subst
      fi
    else
      out+=$c
      i=$((i+1))
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

CMD_SANS_HEREDOC=$(strip_quoted_heredoc_bodies "$CMD")
CMD_NOQUOTES=$(normalize_cmd scan "$CMD_SANS_HEREDOC")
CMD_RESOLVED=$(normalize_cmd resolve "$CMD_SANS_HEREDOC")

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
# Detection on CMD_NOQUOTES so quoted prose about curl doesn't trigger it and
# quote-split forms (cur'l') do; target check on CMD_RESOLVED so quoted URLs
# are visible (#1). The exemption requires at least one explicit localhost
# URL AND no other http(s) URL anywhere in the command — the old form
# exempted the whole command as soon as one localhost URL existed.
LOCAL_URL_RE='https?://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/[^[:space:];&|<>]*)?([[:space:];&|<>]|$)'
if [[ "$CMD_NOQUOTES" =~ ${CB}curl${TB} ]]; then
  u=$CMD_RESOLVED
  has_local=0
  while [[ $u =~ $LOCAL_URL_RE ]]; do
    has_local=1
    u=${u/"${BASH_REMATCH[0]}"/ }
  done
  if (( has_local == 0 )) || [[ $u =~ https?:// ]]; then
    block "NETWORK" "'curl' to a non-localhost address can exfiltrate data." "WebFetch tool"
  fi
fi

# ── Special case: git push --force / -f blocked, --force-with-lease allowed ──
if [[ "$CMD_NOQUOTES" =~ ${CB}git[[:space:]]+push([[:space:]]|$) ]]; then
  if [[ "$CMD_NOQUOTES" =~ (^|[[:space:]])(--force([[:space:]]|$)|-f([[:space:]]|$)) ]]; then
    block "GIT" "git push --force / -f rewrites remote history." "--force-with-lease"
  fi
fi

# ── Special case: gh api with a DELETE method (#2) ──────────────────────────
# `gh api` reaches the full authenticated GitHub REST surface, so `-X DELETE`
# can destroy the same resources the GITHUB blocklist rules (gh repo delete
# etc.) guard against. Read-only gh api calls stay unblocked; other write
# verbs go through the normal permission prompt (gh api was removed from
# settings.json unprompted-allow). Method scanned on CMD_RESOLVED so a
# quoted '-X DELETE' can't hide; command detection on CMD_NOQUOTES keeps
# quoted prose about gh api from triggering it.
if [[ "$CMD_NOQUOTES" =~ ${CB}gh[[:space:]]+api([[:space:]]|$) ]]; then
  if [[ "$CMD_RESOLVED" =~ (^|[[:space:]])(-X|--method)[[:space:]=]*[Dd][Ee][Ll][Ee][Tt][Ee]([[:space:]]|$) ]]; then
    block "GITHUB" "gh api with a DELETE method can permanently destroy remote resources." "the specific gh subcommand, or ask the user to run it"
  fi
fi

# ── Special case: reader commands accessing secret files ────────────────────
# Single-statement bounded via [^;&|<>]* to avoid false-positives like
# `cat README.md && echo done > .env`. Regex stored in a variable because
# bash's [[ ]] tokenizer treats `;&` (case fall-through) as a syntax token.
SECRET_READ_RE='(cat|head|tail|less|more|bat|nano|vim|nvim)[[:space:]]+[^;&|<>]*(\.env([.][a-zA-Z0-9_-]+)?|\.pem|\.key|\.p12|id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials?|kubeconfig|\.kube/config|\.npmrc|\.netrc|\.pgpass|\.aws/[^;&|<>[:space:]]*|\.docker/config\.json|\.config/gcloud/[^;&|<>[:space:]]*)([[:space:]]|$|[;&|<>])'
if [[ "$CMD_NOQUOTES" =~ ${CB}${SECRET_READ_RE} ]]; then
  block "CREDENTIAL" "Reader command targets a secret file (.env* / key material / cloud & registry credentials)." "built-in Read tool (respects deny rules)"
fi

# ── Special case: bare sh/bash/zsh invocation (heredoc / script-file execution) ──
# Uses a stricter boundary than $CB: only start-of-string or immediately after a
# real shell separator — not "any space". $CB's space-boundary also matches
# ordinary flag *values* (e.g. `fd -e sh`, `rg -t sh`), which isn't a command
# start. `bash -c`/`sh -c`/etc. (actual code injection) stay in blocklist.conf
# under the normal $CB, since that vector must still be caught even through a
# wrapper like `env bash -c '...'`, where this stricter boundary would miss it.
STRICT_CB='(^|[<\\/{,;&|`$(])[[:space:]]*'
for interp in sh bash zsh; do
  if [[ "$CMD_NOQUOTES" =~ ${STRICT_CB}${interp}${TB} ]]; then
    block "CODE_INJECTION" "$interp invocation (heredoc / script file can run arbitrary code)."
  fi
done

# ── Pipe-to-shell / pipe-to-interpreter injection ───────────────────────────
# Includes script interpreters that read commands from stdin (python, node, etc.)
# Scanned on CMD_NOQUOTES (#7): raw-$CMD scanning here false-positived on quoted
# prose like `git commit -m "curl x | bash today"` — a standalone quoted argument
# is dropped by quote-stripping, so it no longer matches, while an unquoted pipe
# (the actual injection vector) is untouched by stripping and still matches; a
# quote-split form (`|'bash'`) is restored at command position and still matches.
if [[ "$CMD_NOQUOTES" =~ \|[[:space:]]*(bash|sh|zsh|dash|fish|ksh|python|python3|node|perl|ruby|php)([[:space:]]|$) ]]; then
  block "CODE_INJECTION" "Piping into a shell or script interpreter can execute arbitrary code."
fi

# ── /dev/tcp and /dev/udp (bash network pseudo-devices) ─────────────────────
# Scanned on CMD_NOQUOTES (#7), same rationale as the pipe-injection check above:
# quoted prose mentioning /dev/tcp/... no longer false-positives, and an actual
# unquoted /dev/tcp/host/port still matches.
if [[ "$CMD_NOQUOTES" =~ /dev/(tcp|udp)/ ]]; then
  block "NETWORK" "Bash /dev/tcp|udp opens covert network channels."
fi

# ── ANSI-C $'...' strings hide command names via \xNN / \NNN escapes ────────
# Bash decodes $'\x72\x6d' to literal "rm" at runtime, so the scanner can't
# see the underlying command. Block any use of $'...' to close this hole.
# Deliberately kept on raw $CMD, NOT $CMD_NOQUOTES (#7): normalize_cmd treats a
# $'...' string as an ordinary single-quoted argument. Since it isn't glued to
# an unquoted fragment or sitting at command position, quote-stripping drops
# the whole region — including the closing quote character — which would erase
# every $'...' occurrence from CMD_NOQUOTES and make this check permanently
# blind, not just narrower. Raw $CMD is the only view where this check can see
# its own target, so it also fires on prose that merely mentions $'...' — an
# accepted trade-off, not an oversight.
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
while IFS='|' read -r category prefix reason alt; do
  # Skip comments and blank lines
  [[ "$category" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${category//[[:space:]]/}" ]] && continue

  category="${category//[[:space:]]/}"
  prefix=$(trim "$prefix")
  reason=$(trim "$reason")
  alt=$(trim "${alt:-}")

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
    block "$category" "$reason" "$alt"
  fi
done < "$BLOCKLIST"

exit 0
