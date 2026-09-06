#!/usr/bin/env bash
# PreToolUse hook: blocks Edit/Write to linter/formatter config files.
# Prevents Claude from weakening tool configs instead of fixing code.
# exit 0 -> allow, exit 2 -> block (stderr is fed back to the model as the reason)

set -euo pipefail

deny() {
  printf '[BLOCKED: %s] %s\n' "$1" "$2" >&2
  exit 2
}

# Fail closed (#32-class): unhandled failures must exit 2 (block), not the
# non-2 status `set -e` produces, which the harness treats as allow.
trap 'deny "INTERNAL_ERROR" "guardrail hook crashed unexpectedly — failing closed"' ERR

INPUT=$(cat) || deny "INTERNAL_ERROR" "failed to read hook input — failing closed"
PATH_TYPE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path | type' 2>/dev/null) \
  || deny "INTERNAL_ERROR" "hook input is not valid JSON — failing closed"
case "$PATH_TYPE" in
  string) FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path') ;;
  null)   exit 0 ;;  # payload has no file_path field — nothing to check
  *)      deny "INTERNAL_ERROR" "tool_input.file_path is not a string — failing closed" ;;
esac
[[ -z "$FILE_PATH" ]] && exit 0

BASENAME=$(basename "$FILE_PATH")

# Guardrail self-protection (#34): the files that define these guardrails
# must not be editable by the agent they police — otherwise a single Edit
# can disarm every rule. Matched on the full path (not basename) so
# same-named files in other projects stay editable. Both path forms are
# covered: the repo path (claude-code/hooks/) and the deployed symlink path
# (.claude/hooks/). Changing these files is a manual, human action — see
# the hooks-guardrails skill for the procedure.
case "$FILE_PATH" in
  */claude-code/hooks/block-config-edit.sh | \
  */.claude/hooks/block-config-edit.sh | \
  */claude-code/shguard/config.toml | \
  */.claude/shguard/config.toml)
    printf '[BLOCKED: GUARDRAIL_PROTECTION] "%s" defines the PreToolUse guardrails and must not be edited by Claude.\nAsk the user to change it manually (procedure: hooks-guardrails skill).\n' "$BASENAME" >&2
    exit 2
    ;;
esac

# Protected config file patterns
PROTECTED=(
  '.eslintrc'
  '.eslintrc.*'
  'eslint.config.*'
  '.prettierrc'
  '.prettierrc.*'
  'prettier.config.*'
  'biome.json'
  'biome.jsonc'
  '.oxlintrc.json'
  '.oxlintrc.jsonc'
  'oxlint.config.*'
  '.oxfmtrc.json'
  '.oxfmtrc.jsonc'
  'oxfmt.config.*'
  '.ruff.toml'
  'ruff.toml'
  '.golangci.yml'
  '.golangci.yaml'
  'golangci.yml'
  '.editorconfig'
  'rustfmt.toml'
  '.rustfmt.toml'
  'clippy.toml'
  '.clippy.toml'
)

for pattern in "${PROTECTED[@]}"; do
  # shellcheck disable=SC2254
  case "$BASENAME" in
    $pattern)
      printf '[BLOCKED: CONFIG_PROTECTION] Editing linter/formatter config "%s" is not allowed.\nFix the code to satisfy the tool, not the other way around.\n' "$BASENAME" >&2
      exit 2
      ;;
  esac
done

# Package-manager lockfiles: tool-generated, hand-edits drift from what the
# tool would produce and get silently clobbered on the next install —
# regenerate via the tool that owns the file instead.
LOCKFILES=(
  'package-lock.json'
  'pnpm-lock.yaml'
  'yarn.lock'
  'bun.lock'
  'bun.lockb'
  'Cargo.lock'
  'go.sum'
)

for pattern in "${LOCKFILES[@]}"; do
  # shellcheck disable=SC2254
  case "$BASENAME" in
    $pattern)
      printf '[BLOCKED: LOCKFILE_PROTECTION] "%s" is tool-generated; run the tool instead of editing it directly (e.g. npm install, cargo build, go mod tidy).\n' "$BASENAME" >&2
      exit 2
      ;;
  esac
done

# pyproject.toml is ruff's most common config location, but it also holds
# unrelated project metadata (deps, build system, etc.) that legitimately
# needs editing (#20) — so only protect it when a [tool.ruff] section is
# actually present, not unconditionally like the dedicated ruff.toml files
# above. A pyproject.toml that doesn't exist yet (new file via Write) has no
# ruff config to protect, so it's allowed.
if [[ "$BASENAME" == "pyproject.toml" && -f "$FILE_PATH" ]]; then
  CONTENT=$(cat "$FILE_PATH" 2>/dev/null) || CONTENT=""
  if [[ "$CONTENT" =~ \[tool\.ruff(\.|\]) ]]; then
    printf '[BLOCKED: CONFIG_PROTECTION] "%s" contains a [tool.ruff] section; editing linter/formatter config is not allowed.\nFix the code to satisfy the tool, not the other way around.\n' "$BASENAME" >&2
    exit 2
  fi
fi

exit 0
