#!/usr/bin/env bash
# Prints the text for the cloud environment's setup-script box, pinned to one
# commit: the commit SHA, the digest of cloud/setup.sh, and the digest of
# cloud/manifest.sha256, all read from that commit's git objects. Renew the
# pin by running this on a newer main commit and pasting the output over the
# old box text.
#
#   bash claude-code/cloud/pin.sh [<commit>]    (default: origin/main)
#
# Refuses a commit whose manifest doesn't match its own files, so a pin can't
# point at a state the setup script would reject.

set -euo pipefail
cd "$(dirname "$0")/../.."

rev=${1:-origin/main}
sha=$(git rev-parse --verify "$rev^{commit}")
if ! git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
  echo "WARN: $sha is not on origin/main; raw.githubusercontent.com stops serving it once it's unreachable" >&2
fi

blob_sha256() { git show "$sha:claude-code/$1" | sha256sum | cut -d' ' -f1; }

manifest_sha256=$(blob_sha256 cloud/manifest.sha256)
setup_sha256=$(blob_sha256 cloud/setup.sh)

while read -r digest path; do
  actual=$(blob_sha256 "$path")
  if [[ $actual != "$digest" ]]; then
    echo "FAIL $path at $sha doesn't match its manifest entry; regenerate the manifest first" >&2
    exit 1
  fi
done < <(git show "$sha:claude-code/cloud/manifest.sha256")

cat <<EOF
#!/bin/bash
# dotfiles cloud setup, pinned to tsukasaI/dotfiles@$sha
# Renew: bash claude-code/cloud/pin.sh <newer main commit>, paste the output here.
REF=$sha
SETUP_SHA256=$setup_sha256
MANIFEST_SHA256=$manifest_sha256
f=\$(mktemp) &&
  curl -fsSL --proto '=https' --retry 3 --max-time 60 -o "\$f" "https://raw.githubusercontent.com/tsukasaI/dotfiles/\$REF/claude-code/cloud/setup.sh" &&
  echo "\$SETUP_SHA256  \$f" | sha256sum -c --quiet - &&
  bash "\$f" "\$REF" "\$MANIFEST_SHA256" || { echo "dotfiles-cloud: FAILED (see above)" >&2; exit 1; }
EOF
