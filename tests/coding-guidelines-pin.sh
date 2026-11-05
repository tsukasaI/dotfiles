#!/usr/bin/env bash
# claude-code/cloud/coding-guidelines.{ref,sha256} pin the tsukasaI/coding-guidelines
# files that cloud/setup.sh installs as user-level rules (and whose path list
# setup.sh also uses for the Mac symlinks). This checks that every listed
# file, read at the pinned commit, matches its digest, so a pin can't point at
# a state the cloud setup script would reject.
#
#   bash tests/coding-guidelines-pin.sh                check
#   bash tests/coding-guidelines-pin.sh --write <ref>  re-pin the listed paths
#                                                       to <ref> (a commit on
#                                                       coding-guidelines main)
#
# Files are read with `git show` from a local checkout ($CODING_GUIDELINES,
# default ~/engineer/coding-guidelines, then ../coding-guidelines) when it has
# the commit, else from raw.githubusercontent.com. Never skipped: no source
# for a file is a failure. To add or drop a file, edit the path column of the
# .sha256 file, then run --write.

set -euo pipefail
cd "$(dirname "$0")/.."

REF_FILE=claude-code/cloud/coding-guidelines.ref
SUMS=claude-code/cloud/coding-guidelines.sha256
CG_REPO=tsukasaI/coding-guidelines

checkout=""
for dir in "${CODING_GUIDELINES:-}" "$HOME/engineer/coding-guidelines" ../coding-guidelines; do
  if [[ -n $dir && -d $dir/.git ]]; then
    checkout=$dir
    break
  fi
done

# Prints the file's content at the ref; returns non-zero if no source has it.
read_at() {
  local ref=$1 path=$2
  if [[ -n $checkout ]] && git -C "$checkout" cat-file -e "$ref:$path" 2>/dev/null; then
    git -C "$checkout" show "$ref:$path"
  else
    curl -fsSL --proto '=https' --retry 3 --max-time 60 \
      "https://raw.githubusercontent.com/$CG_REPO/$ref/$path"
  fi
}

paths() {
  local _digest path
  while read -r _digest path; do
    [[ $path =~ ^(principles|languages/[a-z]+|frontend/[a-z]+)\.md$ ]] || {
      echo "FAIL $SUMS: path outside the installed set: $path" >&2
      return 1
    }
    echo "$path"
  done <"$SUMS"
}

if [[ ${1-} == --write ]]; then
  ref=${2-}
  [[ -n $checkout ]] || { echo "FAIL --write needs a local coding-guidelines checkout" >&2; exit 1; }
  ref=$(git -C "$checkout" rev-parse --verify "${ref:?usage: --write <ref>}^{commit}")
  if ! git -C "$checkout" merge-base --is-ancestor "$ref" origin/main 2>/dev/null; then
    echo "FAIL $ref is not on coding-guidelines origin/main; raw.githubusercontent.com may stop serving it" >&2
    exit 1
  fi
  list=$(paths)
  out=""
  while IFS= read -r path; do
    out+="$(read_at "$ref" "$path" | sha256sum | cut -d' ' -f1)  $path"$'\n'
  done <<<"$list"
  printf '%s' "$out" >"$SUMS"
  echo "$ref" >"$REF_FILE"
  echo "pinned $(wc -l <"$SUMS") coding-guidelines files at $ref; now run: bash tests/cloud-manifest-sync.sh --write"
  exit 0
fi

ref=$(<"$REF_FILE")
[[ $ref =~ ^[0-9a-f]{40}$ ]] || { echo "FAIL $REF_FILE must hold one 40-hex commit SHA" >&2; exit 1; }
list=$(paths)
fail=0
while IFS= read -r path; do
  want=$(grep -E "^[0-9a-f]{64}  $path\$" "$SUMS" | cut -d' ' -f1)
  if ! got=$(read_at "$ref" "$path" | sha256sum | cut -d' ' -f1); then
    echo "FAIL cannot read $path at $ref" >&2
    fail=1
    continue
  fi
  if [[ $got != "$want" ]]; then
    echo "FAIL $path at $ref doesn't match its digest; run: bash tests/coding-guidelines-pin.sh --write <ref>" >&2
    fail=1
  fi
done <<<"$list"
((fail == 0)) || exit 1
echo "coding-guidelines pin matches $(wc -l <<<"$list") files at $ref"
