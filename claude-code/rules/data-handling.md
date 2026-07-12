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

# Bounded data

Source: Fable review of cc-memory/ewc/fini — unbounded growth and repeated work (7 of 46 issues).

- Every listing/query endpoint gets a server-side `LIMIT` (with total count, and cursor/offset if callers need more). Don't rely on callers or on "the data is small today" — append-only tables and long-lived stores grow past any assumption.
- Don't buffer whole files when a streaming pass suffices (`read_to_string`, collecting all inputs into a `Vec` before processing). Peak memory proportional to input size × parallelism is a design smell in a tool meant to run on arbitrary repos.
- Cheap classification runs before the expensive read: check the first few KB for binary detection, gate on file size — don't read the whole file and then look at 8KB of it.
- In per-item hot loops, don't repeat work: fuse multiple passes over the same content into one, stat/classify each input once and thread the result through, and hoist invariant checks (empty pattern list, config flags) out of the loop.
