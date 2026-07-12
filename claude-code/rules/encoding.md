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

# Encoding & serialization

Source: Fable review of cc-memory/ewc/fini — format-edge correctness (4 of 46 issues).

- Never hand-roll JSON/CSV escaping — use a serialization library. If one is truly off-limits, escape *all* of U+0000–U+001F (RFC 8259), not just quotes, backslashes, and the common `\n\r\t`. Filenames and CLI args legally contain control bytes.
- Length limits and column counts: decide the unit deliberately — bytes, Unicode scalar values, or display width — and document it in the flag help and README. `str::len()` / byte length silently diverges from user expectation on the first non-ASCII character.
- "Contains a null byte → binary" misclassifies UTF-16 text. Check for a UTF-16 BOM (`FF FE` / `FE FF`) before the null-byte heuristic, and report the skip reason accurately.
- Decide behavior for non-UTF-8 input explicitly (count raw bytes like `wc`, skip with a warning, lossy-decode) — a hard error on single files plus a silent drop in directory scans is the worst combination: same input, two behaviors, one invisible.
