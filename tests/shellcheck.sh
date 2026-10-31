#!/usr/bin/env bash
# Shared shellcheck target list for CI (ci.yaml) and the pre-push lefthook
# check — single source of truth so the two callers can't drift apart on
# which files are covered (the guardrail hook files can't take disable
# comments themselves; they are Edit-protected by block-config-edit.sh, #34).
set -euo pipefail
cd "$(dirname "$0")/.."

# Every tracked *.sh, so a new script can't be silently left out of the list,
# plus extensionless scripts, which the glob misses.
{ git ls-files -z '*.sh'; printf '%s\0' pi/pi-factory; } | xargs -0 shellcheck -x --severity=warning
