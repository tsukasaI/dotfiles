#!/usr/bin/env bash
# Shared shellcheck target list for CI (ci.yaml) and the pre-push lefthook
# check — single source of truth so the two callers can't drift apart on
# which files are covered (the guardrail hook files can't take disable
# comments themselves; they are Edit-protected by block-config-edit.sh, #34).
set -euo pipefail
cd "$(dirname "$0")/.."

shellcheck -x --severity=warning \
  setup.sh \
  claude-code/hooks/*.sh \
  claude-code/scripts/*.sh \
  tests/shguard-parity-check.sh \
  tests/rules-paths-sync.sh
