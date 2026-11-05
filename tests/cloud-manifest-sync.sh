#!/usr/bin/env bash
# claude-code/cloud/manifest.sha256 lists every file the cloud setup script
# installs, with its sha256 (raw.githubusercontent.com has no directory
# listing, so setup.sh can't discover files on its own). This rebuilds the
# expected manifest from the tracked files and fails when the committed one
# has drifted: a file added, removed, or edited without regenerating it.
#
#   bash tests/cloud-manifest-sync.sh           check (exit 1 on drift)
#   bash tests/cloud-manifest-sync.sh --write   regenerate the manifest
#
# Scope: claude-code/CLAUDE.md, the cloud overlay, the coding-guidelines pin
# (cloud/coding-guidelines.{ref,sha256}), rules/, skills/, agents/,
# minus the path prefixes in claude-code/cloud/exclude.txt.

set -euo pipefail
cd "$(dirname "$0")/../claude-code"

MANIFEST=cloud/manifest.sha256
EXCLUDE=cloud/exclude.txt

excluded() {
  local path=$1 prefix
  [[ -f $EXCLUDE ]] || return 1
  while read -r prefix _; do
    [[ -z $prefix || $prefix == \#* ]] && continue
    [[ $path == "$prefix"* ]] && return 0
  done <"$EXCLUDE"
  return 1
}

expected() {
  local path
  git ls-files -- CLAUDE.md cloud/CLAUDE.cloud.md cloud/coding-guidelines.ref \
    cloud/coding-guidelines.sha256 rules skills agents |
    LC_ALL=C sort |
    while IFS= read -r path; do
      excluded "$path" || sha256sum -- "$path"
    done
}

if [[ ${1-} == --write ]]; then
  expected >"$MANIFEST"
  echo "wrote claude-code/$MANIFEST ($(wc -l <"$MANIFEST") files)"
  exit 0
fi

want=$(expected)

# Not diff or mktemp for the verdict: in a commit hook inside the Claude Code
# Bash sandbox, mktemp and diff on a pipe both fail with "Operation not
# permitted", which would read as a drifted manifest.
if [[ $(<"$MANIFEST") == "$want" ]]; then
  echo "cloud manifest matches the tracked files"
else
  diff -u "$MANIFEST" <(printf '%s\n' "$want") || true
  echo "FAIL claude-code/$MANIFEST drifted; run: bash tests/cloud-manifest-sync.sh --write" >&2
  exit 1
fi
