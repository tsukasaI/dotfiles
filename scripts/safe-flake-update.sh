#!/usr/bin/env bash
# Aging-aware nix flake updater.
# Only accepts updates where the upstream commit is at least N days old.
# Inputs younger than the threshold are reverted to the previously locked state.
#
# Per-input cooling defaults:
#   nixpkgs : NIXPKGS_COOLING_DAYS (default 14)
#   others  : COOLING_DAYS         (default 7)
#
# When ADDING a new flake input, lock only that input with
# `nix flake update <input-name>` (or `nix flake lock --update-input <input-name>`).
# Never run a bare `nix flake update` — it refreshes every input at once and
# bypasses the cooling policy above (#26).

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/dotfiles/nix-darwin}"
COOLING_DAYS="${COOLING_DAYS:-7}"
NIXPKGS_COOLING_DAYS="${NIXPKGS_COOLING_DAYS:-14}"

if [[ ! -f "$REPO_DIR/flake.lock" ]]; then
  echo "error: $REPO_DIR/flake.lock not found" >&2
  exit 1
fi

cd "$REPO_DIR"

# Fail closed on a pre-existing dirty flake.lock (roundup issue #42 item 4):
# the failure path below runs `git checkout -- flake.lock` unconditionally
# when the post-update eval fails, which would silently discard any
# uncommitted edit already sitting in flake.lock (e.g. a manual
# `nix flake update <input>`) with no diff shown and no confirmation.
git diff --quiet -- flake.lock || {
  echo "error: uncommitted changes in flake.lock — commit or stash before running" >&2
  exit 1
}

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

  # Cross-check the self-reported lastModified against the commit date on
  # GitHub (#36). lastModified is not covered by any hash in flake.lock, so
  # a tampered lock or fetch layer can fake it to sail past the cooling
  # window; a mismatch with what GitHub reports means the lock is lying →
  # revert (fail closed). Limitation: an upstream author who backdates the
  # commit itself stays undetectable — the date is sealed inside the commit
  # hash and GitHub exposes no per-commit push time.
  verified=""
  locked_type=$(jq -r ".nodes.\"$node\".locked.type // empty" flake.lock)
  if [[ "$locked_type" == "github" ]]; then
    owner=$(jq -r ".nodes.\"$node\".locked.owner" flake.lock)
    repo=$(jq -r ".nodes.\"$node\".locked.repo" flake.lock)
    rev=$(jq -r ".nodes.\"$node\".locked.rev" flake.lock)
    gh_ts=""
    gh_date=""
    if command -v gh >/dev/null 2>&1; then
      gh_date=$(gh api "repos/$owner/$repo/commits/$rev" --jq '.commit.committer.date' 2>/dev/null || true)
    fi
    if [[ -n "$gh_date" ]]; then
      gh_ts=$(date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$gh_date" +%s 2>/dev/null || true)
    fi
    if [[ -z "$gh_ts" ]]; then
      printf '[warn] %-12s server-side timestamp unavailable, using self-reported age only\n' "$input"
    elif (( gh_ts - last_modified > 60 || last_modified - gh_ts > 60 )); then
      printf '[spoof?] %-10s lock says lastModified=%s but GitHub says %s — reverting\n' \
        "$input" "$last_modified" "$gh_ts"
      mv "$before" flake.lock
      skipped+=1
      continue
    else
      verified=" (server-verified)"
    fi
  fi

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
    printf '[ok]   %-12s age %dd%s\n' "$input" "$age_days" "$verified"
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
