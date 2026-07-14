# shellcheck shell=bash
# Shared helper: after the global checks pass, delegate to the repo's own
# lefthook hooks (no `lefthook install` needed — its shims are just a binary
# resolver around `lefthook run`, which works standalone).
# Sourced by pre-commit / pre-push / prepare-commit-msg in this directory.
#
# These hook files are locked with `chflags uchg` so that `lefthook install -f`
# (run automatically by lefthook's npm postinstall) cannot clobber them through
# the ~/.config/git/hooks symlink again (issue #22, recurred 2026-07-13).
# To edit them: chflags nouchg ~/dotfiles/git/hooks/*  — setup.sh re-locks.
#
# Config detection covers lefthook.yml/.yaml only — every repo on this machine
# uses one of those two names. Extend here if a repo adopts another variant.

run_repo_lefthook() {
  hook_name=$1
  shift

  # Not in a work tree (bare repo, etc.) → nothing to delegate to.
  toplevel=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -f "$toplevel/lefthook.yml" ] || [ -f "$toplevel/lefthook.yaml" ] || return 0

  if command -v lefthook >/dev/null 2>&1; then
    lefthook run "$hook_name" "$@"
  elif [ -x "$toplevel/node_modules/.bin/lefthook" ]; then
    "$toplevel/node_modules/.bin/lefthook" run "$hook_name" "$@"
  elif command -v mise >/dev/null 2>&1 && mise exec -- lefthook --version >/dev/null 2>&1; then
    mise exec -- lefthook run "$hook_name" "$@"
  else
    # Allow deliberately: the security layer (gitleaks) already ran; language
    # checks are the repo's own responsibility, so a missing binary warns loudly
    # instead of blocking every commit in that repo.
    printf '\033[33mlefthook.yml present but no lefthook binary found — repo %s hooks SKIPPED.\033[0m\n' "$hook_name" >&2
    printf '\033[33mInstall lefthook (npm/brew/mise) to run them.\033[0m\n' >&2
    return 0
  fi
}
