#!/usr/bin/env bash
# PreToolUse hook: blocks Edit/Write to linter/formatter config files.
# Prevents Claude from weakening tool configs instead of fixing code.
# exit 0 -> allow, exit 2 -> block

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[[ -z "$FILE_PATH" ]] && exit 0

BASENAME=$(basename "$FILE_PATH")

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
      printf '[BLOCKED: CONFIG_PROTECTION] Editing linter/formatter config "%s" is not allowed.\nFix the code to satisfy the tool, not the other way around.\n' "$BASENAME"
      exit 2
      ;;
  esac
done

exit 0
