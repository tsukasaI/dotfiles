---
# Loaded only when code files are in context.
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.go"
  - "**/*.rs"
  - "**/*.py"
  - "**/*.rb"
  - "**/*.lua"
  - "**/*.nix"
  - "**/*.sh"
  - "**/*.bash"
  - "**/*.zsh"
  - "**/*.sql"
  - "**/*.vue"
  - "**/*.svelte"
---

# Error handling

Source: Fable review of cc-memory/ewc/fini — silent failure was the largest defect class (11 of 46 issues).

- Never discard an error without a comment justifying why it's safe. Anti-patterns to catch by reflex: `.ok()` / `.filter_map(Result::ok)` on fallible iterators, empty `catch {}`, `_ = err`, `continue` after a failed write with no tracking.
- Loops over items that can individually fail must count failures and surface them: in the return value, in a summary line, and in the exit code. "12 of 15 succeeded" must never collapse into a bare success.
- CLI exit codes distinguish three states: `0` success, `1` violations found (check/lint mode), `2` runtime error (bad config, I/O failure). Invalid config or flags is an error, never a silent no-op — a typo'd `--exclude` glob that skips everything and exits 0 is the worst failure mode a checking tool can have.
- A tool whose job is detection must exit nonzero when it detects a problem it can't fix — even in fix mode. Printing to stderr and exiting 0 is not reporting.
- Machine-readable output modes (`--json` etc.) must emit valid output for that format even on total failure: an empty array with an `errors` field, never empty stdout. Per-item errors go to stderr so stdout stays parseable.
- Handle external-service exceptions (DB, network) at one error boundary per entrypoint: log the detail, return a generic message. Raw driver errors leak schema names to clients.
