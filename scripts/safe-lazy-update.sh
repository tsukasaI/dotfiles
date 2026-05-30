#!/usr/bin/env bash
# Aging-aware lazy.nvim updater.
# Runs `:Lazy! update`, then for each plugin whose pinned commit changed,
# checks the commit timestamp via the already-cloned local plugin repo.
# Commits younger than COOLING_DAYS are reverted in lazy-lock.json,
# and `:Lazy! restore` is invoked to sync installed plugins back.

set -euo pipefail

DOTFILES="${DOTFILES:-$HOME/dotfiles}"
NVIM_DATA="${NVIM_DATA:-$HOME/.local/share/nvim/lazy}"
LOCK="$DOTFILES/nvim/lazy-lock.json"
COOLING_DAYS="${COOLING_DAYS:-7}"

if [[ ! -f "$LOCK" ]]; then
  echo "error: $LOCK not found" >&2
  exit 1
fi

before=$(mktemp -t lazy-lock.before.XXXXXX)
cp "$LOCK" "$before"

nvim --headless "+Lazy! update" +qa 2>/dev/null || true

now=$(date +%s)
threshold_sec=$((COOLING_DAYS * 86400))

declare -i accepted=0 skipped=0 unchanged=0
reverted=()

for plugin in $(jq -r 'keys[]' "$LOCK"); do
  old_commit=$(jq -r --arg p "$plugin" '.[$p].commit // empty' "$before")
  new_commit=$(jq -r --arg p "$plugin" '.[$p].commit // empty' "$LOCK")

  if [[ -z "$old_commit" || "$old_commit" == "$new_commit" ]]; then
    unchanged+=1
    continue
  fi

  plugin_dir="$NVIM_DATA/$plugin"
  if [[ ! -d "$plugin_dir/.git" ]]; then
    printf '[warn] %-32s no local clone, keeping update\n' "$plugin"
    accepted+=1
    continue
  fi

  committer_ts=$(git -C "$plugin_dir" show -s --format=%ct "$new_commit" 2>/dev/null || true)

  if [[ -z "$committer_ts" ]]; then
    printf '[warn] %-32s cannot resolve commit timestamp, keeping update\n' "$plugin"
    accepted+=1
    continue
  fi

  age_sec=$(( now - committer_ts ))
  age_days=$(( age_sec / 86400 ))

  if (( age_sec < threshold_sec )); then
    printf '[skip] %-32s age %dd < %dd\n' "$plugin" "$age_days" "$COOLING_DAYS"
    tmp=$(mktemp)
    jq --arg p "$plugin" --arg c "$old_commit" '.[$p].commit = $c' "$LOCK" > "$tmp"
    mv "$tmp" "$LOCK"
    reverted+=("$plugin")
    skipped+=1
  else
    printf '[ok]   %-32s age %dd\n' "$plugin" "$age_days"
    accepted+=1
  fi
done

rm "$before"

if (( ${#reverted[@]} > 0 )); then
  echo "syncing installed plugins back to reverted commits..."
  nvim --headless "+Lazy! restore" +qa 2>/dev/null || true
fi

echo "---"
echo "accepted: $accepted, skipped: $skipped, unchanged: $unchanged"
echo "review diff with: git -C $DOTFILES diff nvim/lazy-lock.json"
