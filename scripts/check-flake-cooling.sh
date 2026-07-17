#!/usr/bin/env bash
# Cooling-period gate for nix-darwin/flake.lock (recurrence prevention, #26).
#
# safe-flake-update.sh enforces the cooling policy when it does the updating,
# but a bare `nix flake update` (e.g. run by hand while adding a new input)
# bypasses it entirely and lands a fresh flake.lock straight in the working
# tree. This script re-derives the same policy from two git revisions so CI
# can catch that regardless of how the lock file was produced.
#
# Usage: check-flake-cooling.sh [base-rev] [head-rev]
#        check-flake-cooling.sh --base-file <path> --head-file <path>
#   base-rev defaults to HEAD^, head-rev defaults to HEAD.
#   --base-file/--head-file read raw flake.lock JSON straight from disk
#   instead of via git show — useful for testing synthetic locks.
#
# Root inputs (".nodes.root.inputs") are matched by INPUT NAME, not node
# name: node names are auto-numbered ("nixpkgs_2", "nixpkgs_3", ...) and get
# renumbered exactly when inputs are added/removed — the scenario this check
# exists to catch. Matching by name means a renumbered root input still gets
# its rev compared and its cooling age checked. Nodes only reachable
# transitively (not a root input) fall back to best-effort name matching.
#
# For every changed rev, require:
#   now - locked.lastModified >= 7 days   (COOLING_DAYS, default 7)
#   now - locked.lastModified >= 14 days  (NIXPKGS_COOLING_DAYS, default 14)
#     for the root input literally named "nixpkgs"
# Inputs/nodes that don't exist in base (newly added) are exempt.
#
# Exit codes: 0 clean, 1 cooling violation found, 2 runtime/usage error.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/cooling.sh
source "$SCRIPT_DIR/lib/cooling.sh"

LOCK_PATH="nix-darwin/flake.lock"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 2
fi

BASE_FILE=""
HEAD_FILE=""
POSITIONAL=()
while (($#)); do
  case "$1" in
    --base-file)
      [[ $# -ge 2 ]] || {
        echo "error: --base-file requires a value" >&2
        exit 2
      }
      BASE_FILE="$2"
      shift 2
      ;;
    --head-file)
      [[ $# -ge 2 ]] || {
        echo "error: --head-file requires a value" >&2
        exit 2
      }
      HEAD_FILE="$2"
      shift 2
      ;;
    --base-file=*)
      BASE_FILE="${1#*=}"
      shift
      ;;
    --head-file=*)
      HEAD_FILE="${1#*=}"
      shift
      ;;
    --)
      shift
      while (($#)); do
        POSITIONAL+=("$1")
        shift
      done
      ;;
    -*)
      echo "error: unknown option '$1'" >&2
      exit 2
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ -n "$BASE_FILE" || -n "$HEAD_FILE" ]]; then
  if [[ -z "$BASE_FILE" || -z "$HEAD_FILE" ]]; then
    echo "error: --base-file and --head-file must be used together" >&2
    exit 2
  fi
  if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
    echo "error: positional revisions cannot be combined with --base-file/--head-file" >&2
    exit 2
  fi
  MODE="file"
else
  MODE="git"
  BASE_REV="${POSITIONAL[0]:-HEAD^}"
  HEAD_REV="${POSITIONAL[1]:-HEAD}"
fi

if [[ "$MODE" == "file" ]]; then
  [[ -f "$BASE_FILE" ]] || {
    echo "error: base file '$BASE_FILE' not found" >&2
    exit 2
  }
  [[ -f "$HEAD_FILE" ]] || {
    echo "error: head file '$HEAD_FILE' not found" >&2
    exit 2
  }
  base_json=$(cat "$BASE_FILE")
  head_json=$(cat "$HEAD_FILE")
  base_label="$BASE_FILE"
  head_label="$HEAD_FILE"
else
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "error: not inside a git repository" >&2
    exit 2
  }

  for rev in "$BASE_REV" "$HEAD_REV"; do
    if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "${rev}^{commit}" >/dev/null; then
      echo "error: '$rev' is not a valid git revision" >&2
      exit 2
    fi
  done

  if ! git -C "$REPO_ROOT" cat-file -e "${BASE_REV}:${LOCK_PATH}" 2>/dev/null; then
    echo "$LOCK_PATH does not exist at base revision '$BASE_REV' — nothing to compare"
    exit 0
  fi

  if ! git -C "$REPO_ROOT" cat-file -e "${HEAD_REV}:${LOCK_PATH}" 2>/dev/null; then
    echo "error: $LOCK_PATH not found at head revision '$HEAD_REV'" >&2
    exit 2
  fi

  base_json=$(git -C "$REPO_ROOT" show "${BASE_REV}:${LOCK_PATH}")
  head_json=$(git -C "$REPO_ROOT" show "${HEAD_REV}:${LOCK_PATH}")
  base_label="$BASE_REV"
  head_label="$HEAD_REV"
fi

if ! jq empty >/dev/null 2>&1 <<<"$base_json"; then
  echo "error: $LOCK_PATH at '$base_label' is not valid JSON" >&2
  exit 2
fi

if ! jq empty >/dev/null 2>&1 <<<"$head_json"; then
  echo "error: $LOCK_PATH at '$head_label' is not valid JSON" >&2
  exit 2
fi

if [[ "$base_json" == "$head_json" ]]; then
  echo "$LOCK_PATH unchanged between $base_label and $head_label"
  exit 0
fi

now=$(date +%s)
declare -i violations=0
HANDLED_NODES=""

# Print a violation (or an unverifiable-age warning) for $2 (the node whose
# lastModified is read from head) under label $1, threshold $3.
check_cooling() {
  local label="$1" node="$2" threshold="$3"
  local last_modified age_days
  last_modified=$(jq -r --arg n "$node" '.nodes[$n].locked.lastModified // empty' <<<"$head_json")

  if [[ -z "$last_modified" ]]; then
    printf '[violation] %-50s no lastModified — cannot verify cooling age\n' "$label"
    violations+=1
    return
  fi

  age_days=$(((now - last_modified) / 86400))

  if ((age_days < threshold)); then
    printf '[violation] %-50s age %dd < %dd threshold\n' "$label" "$age_days" "$threshold"
    violations+=1
  fi
}

# --- Pass 1: root inputs, matched by INPUT NAME (renumber-proof) ----------
head_root_inputs=$(jq -c '.nodes.root.inputs // {}' <<<"$head_json")
base_root_inputs=$(jq -c '.nodes.root.inputs // {}' <<<"$base_json")

root_names=$(jq -r 'keys[]' <<<"$head_root_inputs")

while IFS= read -r name; do
  [[ -z "$name" ]] && continue

  head_type=$(jq -r --arg k "$name" '.[$k] | type' <<<"$head_root_inputs")
  if [[ "$head_type" != "string" ]]; then
    echo "[warn] root input '$name' is a follows-path (array) in head — skipping, not directly comparable"
    continue
  fi
  head_node=$(jq -r --arg k "$name" '.[$k]' <<<"$head_root_inputs")
  HANDLED_NODES+=" $head_node"

  base_has=$(jq -r --arg k "$name" 'has($k)' <<<"$base_root_inputs")
  if [[ "$base_has" != "true" ]]; then
    continue # root input didn't exist in base -> newly added, exempt
  fi

  base_type=$(jq -r --arg k "$name" '.[$k] | type' <<<"$base_root_inputs")
  if [[ "$base_type" != "string" ]]; then
    echo "[warn] root input '$name' is a follows-path (array) in base — skipping, not directly comparable"
    continue
  fi
  base_node=$(jq -r --arg k "$name" '.[$k]' <<<"$base_root_inputs")

  head_rev=$(jq -r --arg n "$head_node" '.nodes[$n].locked.rev // empty' <<<"$head_json")
  [[ -z "$head_rev" ]] && continue

  base_rev=$(jq -r --arg n "$base_node" '.nodes[$n].locked.rev // empty' <<<"$base_json")
  [[ -z "$base_rev" ]] && continue

  [[ "$base_rev" == "$head_rev" ]] && continue # rev unchanged

  if [[ "$name" == "nixpkgs" ]]; then
    threshold=$NIXPKGS_COOLING_DAYS
  else
    threshold=$COOLING_DAYS
  fi

  label="$head_node (root input: $name)"
  [[ "$head_node" != "$base_node" ]] && label="$head_node (root input: $name, renumbered from $base_node)"

  check_cooling "$label" "$head_node" "$threshold"
done <<<"$root_names"

# --- Pass 2: transitive nodes not reachable as a root input, best effort --
# Name-based fallback (can miscompare across a renumber if an unrelated node
# happens to reuse a freed name), but every node handled above is excluded
# so it is never double-reported.
all_nodes=$(jq -r '.nodes | keys[] | select(. != "root")' <<<"$head_json")

while IFS= read -r node; do
  [[ -z "$node" ]] && continue

  case " $HANDLED_NODES " in
    *" $node "*) continue ;;
  esac

  head_rev=$(jq -r --arg n "$node" '.nodes[$n].locked.rev // empty' <<<"$head_json")
  [[ -z "$head_rev" ]] && continue

  base_rev=$(jq -r --arg n "$node" '.nodes[$n].locked.rev // empty' <<<"$base_json")
  [[ -z "$base_rev" ]] && continue

  [[ "$base_rev" == "$head_rev" ]] && continue

  check_cooling "$node" "$node" "$COOLING_DAYS"
done <<<"$all_nodes"

if ((violations > 0)); then
  echo "---"
  echo "$violations input(s) changed rev without clearing the cooling period"
  exit 1
fi

echo "all changed $LOCK_PATH inputs cleared their cooling period"
exit 0
