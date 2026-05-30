#!/usr/bin/env bash
# Run both aging-aware updaters in sequence.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "=== nix-darwin flake ==="
"$here/safe-flake-update.sh"

echo
echo "=== nvim (lazy.nvim) ==="
"$here/safe-lazy-update.sh"
