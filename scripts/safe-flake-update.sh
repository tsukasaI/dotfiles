#!/usr/bin/env bash
# Aging-aware nix flake updater.
# Only accepts updates where the upstream commit is at least N days old.
# Inputs younger than the threshold are reverted to the previously locked state.
#
# Per-input cooling defaults:
#   nixpkgs : NIXPKGS_COOLING_DAYS (default 14)
#   others  : COOLING_DAYS         (default 7)

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/dotfiles/nix-darwin}"
COOLING_DAYS="${COOLING_DAYS:-7}"
NIXPKGS_COOLING_DAYS="${NIXPKGS_COOLING_DAYS:-14}"

if [[ ! -f "$REPO_DIR/flake.lock" ]]; then
  echo "error: $REPO_DIR/flake.lock not found" >&2
  exit 1
fi

cd "$REPO_DIR"
now=$(date +%s)

inputs=$(jq -r '.nodes.root.inputs | keys[]' flake.lock)

declare -i accepted=0 skipped=0
for input in $inputs; do
  before=$(mktemp -t "flake.lock.before-$input.XXXXXX")
  cp flake.lock "$before"

  if ! nix flake update "$input" 2>/dev/null; then
    echo "[warn] $input: nix flake update failed, keeping previous state"
    mv "$before" flake.lock
    continue
  fi

  if cmp -s "$before" flake.lock; then
    rm "$before"
    continue
  fi

  node=$(jq -r ".nodes.root.inputs.\"$input\"" flake.lock)
  last_modified=$(jq -r ".nodes.\"$node\".locked.lastModified // empty" flake.lock)

  if [[ -z "$last_modified" ]]; then
    echo "[warn] $input: no lastModified, reverting"
    mv "$before" flake.lock
    continue
  fi

  age_days=$(( (now - last_modified) / 86400 ))

  if [[ "$input" == "nixpkgs" ]]; then
    threshold=$NIXPKGS_COOLING_DAYS
  else
    threshold=$COOLING_DAYS
  fi

  if (( age_days < threshold )); then
    printf '[skip] %-12s age %dd < %dd\n' "$input" "$age_days" "$threshold"
    mv "$before" flake.lock
    skipped+=1
  else
    printf '[ok]   %-12s age %dd\n' "$input" "$age_days"
    rm "$before"
    accepted+=1
  fi
done

if ! nix flake metadata . > /dev/null 2>&1; then
  echo "error: modified flake.lock fails to evaluate, restoring from git" >&2
  git checkout -- flake.lock
  exit 1
fi

echo "---"
echo "accepted: $accepted, skipped: $skipped"
echo "review diff with: git -C $REPO_DIR diff flake.lock"
