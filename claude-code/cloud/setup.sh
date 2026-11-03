#!/bin/bash
# Installs the shared Claude Code config (CLAUDE.md + the cloud overlay,
# rules/, skills/, agents/) into ~/.claude of a Claude Code cloud container,
# whatever repo the session is for, and turns git commit/tag signing off.
#
#   setup.sh <commit-sha> <manifest-sha256>
#
# Run by the bootstrap in the environment's setup-script box (as root, before
# Claude Code starts); claude-code/cloud/pin.sh prints that bootstrap. Files
# come from raw.githubusercontent.com at the pinned commit and must match
# cloud/manifest.sha256, whose own digest is the second argument. Re-running
# with the same arguments gives the same ~/.claude.
#
# Exit status:
#   1  Anything wrong with the config itself: a bad argument, a fetch that
#      failed, a digest mismatch, a malformed manifest, an install error.
#      Fail closed: nothing is installed when a check fails. Not exit 0,
#      because the environment snapshot is kept for about 7 days and a
#      session without its config should not be cached as "set up"; the
#      platform's SessionStart hook tells the model the setup script failed,
#      and the session still starts.
#   0  Everything installed, or only the signing step failed (logged as
#      WARN): a session with the config but signed commits is still usable.
#
# Not user.name/user.email here: the platform rewrites both in ~/.gitconfig
# after this script runs. The identity comes from GIT_AUTHOR_*/GIT_COMMITTER_*
# in the environment's variables, which git ranks above any config file.
# Signing stays off because the platform's key isn't mine, so it would sign
# commits made under my identity.

set -uo pipefail

REPO=tsukasaI/dotfiles

REF=${1-}
MANIFEST_SHA256=${2-}
CLAUDE_DIR=${HOME:-/root}/.claude
STATE=$CLAUDE_DIR/.dotfiles-cloud-files
BASE=https://raw.githubusercontent.com/$REPO/$REF/claude-code

log() { echo "dotfiles-cloud: $*" >&2; }
die() {
  log "FAILED: $*"
  log "the dotfiles config was not installed (or only partly, if the install step failed)"
  exit 1
}

warnings=0
if ! { git config --global commit.gpgsign false && git config --global tag.gpgsign false; }; then
  log "WARN: turning git signing off failed; commits will be signed with the platform's key"
  warnings=1
fi

[[ $REF =~ ^[0-9a-f]{40}$ ]] || die "arg 1 must be a full 40-hex commit SHA, got '$REF'"
[[ $MANIFEST_SHA256 =~ ^[0-9a-f]{64}$ ]] || die "arg 2 must be a sha256 hex digest, got '$MANIFEST_SHA256'"

stage=$(mktemp -d) || die "mktemp failed"
trap 'rm -rf "$stage"' EXIT

fetch() {
  curl -fsSL --proto '=https' --retry 3 --max-time 60 --create-dirs -o "$2" "$BASE/$1"
}

fetch cloud/manifest.sha256 "$stage/manifest" || die "could not fetch the manifest at $REF"
echo "$MANIFEST_SHA256  $stage/manifest" | sha256sum -c --quiet - ||
  die "manifest digest mismatch at $REF"

# The manifest is pinned by digest, but its paths still decide where files
# are written, so a path that could escape ~/.claude is refused anyway.
paths=()
while read -r digest path; do
  [[ $digest =~ ^[0-9a-f]{64}$ ]] || die "malformed manifest line: $digest $path"
  [[ $path =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ && /$path/ != */../* ]] ||
    die "unsafe path in manifest: $path"
  case $path in
    CLAUDE.md | cloud/CLAUDE.cloud.md | rules/* | skills/* | agents/*) ;;
    *) die "path outside the installed set: $path" ;;
  esac
  paths+=("$path")
done <"$stage/manifest"
((${#paths[@]} > 0)) || die "empty manifest"

for path in "${paths[@]}"; do
  fetch "$path" "$stage/files/$path" || die "could not fetch $path at $REF"
done
(cd "$stage/files" && sha256sum -c --quiet --strict -) <"$stage/manifest" ||
  die "file digest mismatch at $REF"

mkdir -p "$CLAUDE_DIR" || die "cannot create $CLAUDE_DIR"
installed=()
for path in "${paths[@]}"; do
  case $path in
    CLAUDE.md | cloud/CLAUDE.cloud.md) ;;
    *)
      install -D -m 644 "$stage/files/$path" "$CLAUDE_DIR/$path" || die "install $path"
      installed+=("$path")
      ;;
  esac
done
{ cat "$stage/files/CLAUDE.md" "$stage/files/cloud/CLAUDE.cloud.md"; } >"$CLAUDE_DIR/CLAUDE.md.tmp" &&
  mv "$CLAUDE_DIR/CLAUDE.md.tmp" "$CLAUDE_DIR/CLAUDE.md" || die "install CLAUDE.md"

# Remove what an earlier run installed and this manifest dropped. Only paths
# from our own state file are touched: ~/.claude/skills also holds the
# platform's own skills.
if [[ -f $STATE ]]; then
  while IFS= read -r old; do
    [[ $old =~ ^(rules|skills|agents)/[A-Za-z0-9._/-]+$ && /$old/ != */../* ]] || continue
    printf '%s\n' "${installed[@]}" | grep -Fxq -- "$old" && continue
    rm -f -- "${CLAUDE_DIR:?}/$old"
    rmdir -p --ignore-fail-on-non-empty -- "$(dirname "$CLAUDE_DIR/$old")" 2>/dev/null
  done <"$STATE"
fi
printf '%s\n' "${installed[@]}" >"$STATE" || die "write $STATE"

log "installed ${#installed[@]} files + CLAUDE.md from $REPO@$REF into $CLAUDE_DIR"
((warnings == 0)) || log "finished with warnings (see WARN above)"
exit 0
