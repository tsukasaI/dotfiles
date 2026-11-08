#!/usr/bin/env bash
# Driver for ops' /dream skill. Run only through the dream-extract wrapper
# (nix-darwin/dream-extract.nix), which sets every variable below.
# Not paths in argv: shguard keeps Bash out of ~/.claude and out of mkdir under
# .claude, so the folders are fixed by the wrapper and every argument is
# shape-checked here.
set -euo pipefail
shopt -s nullglob

log_dir=${DREAM_LOG_DIR:?set by the dream-extract wrapper}
out_dir=${DREAM_OUT_DIR:?set by the dream-extract wrapper}
filter=${DREAM_FILTER:?set by the dream-extract wrapper}

iso='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
count='^(0|[1-9][0-9]*)$'
session='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

usage() {
  echo 'usage: dream-extract list [<ISO8601 UTC lower bound, second precision>]' >&2
  echo '       dream-extract extract <session-id> <from> <to> <ISO8601 UTC lower bound or "">' >&2
  # Not 2: jq exits 2 on a missing or unreadable file, which is a parse_error.
  exit 64
}

refuse() {
  echo "dream-extract: $1" >&2
  exit 1
}

prepare_out_dir() {
  # Not mkdir -p alone or a -L test on the leaf: a planted symlink on any
  # component would lead the writes out of ops.
  [ "$(realpath -m -- "$out_dir")" = "$out_dir" ] || refuse "$out_dir resolves elsewhere"
  mkdir -p "$out_dir"
}

case "${1:-}" in
  list)
    [ "$#" -le 2 ] || usage
    after=${2:-}
    [ -z "$after" ] || [[ $after =~ $iso ]] || usage
    [ -d "$log_dir" ] || refuse "no session log folder at $log_dir"
    prepare_out_dir
    # Keep at most one run's owner text on disk: a run starts with list.
    rm -f -- "$out_dir"/*.ndjson
    args=(--no-ignore --type file --extension jsonl --max-depth 1 --absolute-path)
    if [ -n "$after" ]; then
      args+=(--changed-within "@$(date -u -d "$after" +%s)")
    fi
    fd "${args[@]}" . "$log_dir" | sort | while IFS= read -r file; do
      lines=$(wc -l < "$file") || exit 1
      printf '%s\t%s\n' "$(basename "$file" .jsonl)" "${lines// /}"
    done
    ;;
  extract)
    [ "$#" -eq 5 ] || usage
    id=$2 from=$3 to=$4 after=$5
    [[ $id =~ $session ]] || usage
    [[ $from =~ $count && $to =~ $count ]] || usage
    [ -z "$after" ] || [[ $after =~ $iso ]] || usage
    prepare_out_dir
    out="$out_dir/$id.ndjson"
    # Not a plain > onto the old file: a planted symlink there would be followed.
    rm -f -- "$out"
    set -o noclobber
    exec jq -n -c --argjson from "$from" --argjson to "$to" --arg after "$after" \
      -f "$filter" "$log_dir/$id.jsonl" > "$out"
    ;;
  *) usage ;;
esac
