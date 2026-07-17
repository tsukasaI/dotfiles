#!/usr/bin/env bash
# Aging-aware lazy.nvim updater.
# Runs `:Lazy! update`, then for each plugin whose pinned commit changed,
# checks the commit timestamp via the already-cloned local plugin repo.
# Commits younger than COOLING_DAYS are reverted in lazy-lock.json,
# and `:Lazy! restore` is invoked to sync installed plugins back.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/cooling.sh
source "$SCRIPT_DIR/lib/cooling.sh"

DOTFILES="${DOTFILES:-$HOME/dotfiles}"
NVIM_DATA="${NVIM_DATA:-$HOME/.local/share/nvim/lazy}"
LOCK="$DOTFILES/nvim/lazy-lock.json"

if [[ ! -f "$LOCK" ]]; then
  echo "error: $LOCK not found" >&2
  exit 1
fi

before=$(mktemp -t lazy-lock.before.XXXXXX)
trap 'rm -f "$before"' EXIT
cp "$LOCK" "$before"

nvim --headless "+Lazy! update" +qa 2>/dev/null || true

if ! jq empty "$LOCK" 2>/dev/null; then
  mv "$before" "$LOCK"
  echo "error: lazy-lock.json corrupt after update, restored from backup" >&2
  exit 1
fi

declare -i accepted=0 skipped=0 unchanged=0
reverted=()

for plugin in $(jq -r 'keys[]' "$LOCK"); do
  old_commit=$(jq -r --arg p "$plugin" '.[$p].commit // empty' "$before")
  new_commit=$(jq -r --arg p "$plugin" '.[$p].commit // empty' "$LOCK")

  if [[ -z "$old_commit" || "$old_commit" == "$new_commit" ]]; then
    unchanged+=1
    continue
  fi

  # Unknown age must fail closed (#36): if the commit's timestamp cannot be
  # resolved, revert instead of accepting — matching safe-flake-update.sh,
  # which reverts on a missing lastModified. Note there is no server-side
  # signal to cross-check here: the committer date is sealed inside the
  # commit hash, so the local clone's %ct already equals what any API would
  # return; only an upstream author can backdate, and that stays undetectable.
  plugin_dir="$NVIM_DATA/$plugin"
  committer_ts=""
  if [[ -d "$plugin_dir/.git" ]]; then
    committer_ts=$(git -C "$plugin_dir" show -s --format=%ct "$new_commit" 2>/dev/null || true)
  fi

  if [[ -z "$committer_ts" ]]; then
    printf '[skip] %-32s cannot resolve commit age (no clone or unknown commit), reverting\n' "$plugin"
    tmp=$(mktemp)
    jq --arg p "$plugin" --arg c "$old_commit" '.[$p].commit = $c' "$LOCK" > "$tmp"
    mv "$tmp" "$LOCK"
    reverted+=("$plugin")
    skipped+=1
    continue
  fi

  age_days=$(cooling_age_days "$committer_ts")

  if (( age_days < COOLING_DAYS )); then
    cooling_msg_skip 32 "$plugin" "$age_days" "$COOLING_DAYS"
    tmp=$(mktemp)
    jq --arg p "$plugin" --arg c "$old_commit" '.[$p].commit = $c' "$LOCK" > "$tmp"
    mv "$tmp" "$LOCK"
    reverted+=("$plugin")
    skipped+=1
  else
    cooling_msg_ok 32 "$plugin" "$age_days"
    accepted+=1
  fi
done

rm "$before"

declare -i restore_failed=0
if (( ${#reverted[@]} > 0 )); then
  echo "syncing installed plugins back to reverted commits..."
  if ! nvim --headless "+Lazy! restore" +qa; then
    # Restore couldn't force the disk state back to lazy-lock.json's commits;
    # this script has no further fallback, so surface it loudly (#39) instead
    # of the prior `|| true`, which let the cooling revert silently no-op.
    echo "WARNING: Lazy! restore failed — installed plugins may not match lazy-lock.json. Run :Lazy restore manually." >&2
    restore_failed=1
  fi
fi

echo "---"
echo "accepted: $accepted, skipped: $skipped, unchanged: $unchanged"
echo "review diff with: git -C $DOTFILES diff nvim/lazy-lock.json"

if (( restore_failed )); then
  exit 1
fi
