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

# Atomicity & idempotency

Source: Fable review of cc-memory/ewc/fini — races and retry-duplication (6 of 46 issues).

- Read-then-write across separate statements is a race under concurrency. Claim with one conditional statement and check the affected-row count: `UPDATE ... WHERE id = ? AND state = 'pending'` then verify `changes == 1` — not SELECT-check-then-UPDATE. Same for counters: `get → +1 → put` on a KV store loses updates; use an atomic increment or document the limit as approximate.
- A compensating pair of statements (INSERT then conditional UPDATE, with DELETE on failure) is not a transaction — an exception between them leaves an orphan. Use a real transaction or the driver's batch API when it's atomic.
- Any write a caller might retry (network timeout resend, at-least-once delivery, user re-running a command) needs an idempotency key: `UNIQUE` constraint + `ON CONFLICT DO NOTHING/UPDATE`. A plain `INSERT` duplicates on retry.
- File writes that replace content: write to a temp file in the same directory, fsync, then rename into place — never truncate-in-place (`fs::write`, `open(..., "w")`). A crash mid-write destroys the original. Preserve the original's permissions, and decide symlink behavior explicitly.
- Minimize the read-to-write window: re-check a cheap fingerprint (mtime, length) just before writing and skip with a warning if the file changed externally.
- A fix pipeline must be idempotent: running fix twice, or check immediately after fix, must be a no-op. If step A can create work for step B, order B after A — and add a test that re-runs the pipeline on its own output and asserts zero changes.
