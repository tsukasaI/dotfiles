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

# Comments

Default is still "no comment" (top-level system rule). This file exists to draw the line more
precisely than "the WHY is non-obvious" alone does — based on a real investigation (shguard's
`src/*.rs`, 2026-08-07): most of that codebase's dense doc comments turned out to be
load-bearing, not filler, but ~20-30% was redundant restatement or a development narrative that
belonged in the commit body instead. Neither "comment everything" nor "comment nothing" was
right; the split below is. Re-confirmed in a follow-up shguard audit (2026-08-31): ~98
fable-review narrative comments had accumulated in `src/gate.rs`, `src/rules.rs`,
`src/decision_log.rs`, and several `tests/*.rs` files, tracked for removal in
tsukasaI/shguard#394.

## Keep in code, right above the thing it explains
- A measured/tuned value (threshold, magic number, timeout) — state the conclusion and what
  invalidates it ("re-measure if X changes"), not just the number. A doc file is only found by
  someone who goes looking; a comment on the constant is read by whoever is about to change it.
- A non-obvious invariant or adversarial reasoning behind a security- or correctness-critical
  choice (why the naive approach is exploitable, why eager evaluation closes a specific bypass).
- Why a type/API shape looks the way it does, when the reason isn't re-derivable from its
  callers (why boxed, why a sum type instead of optional fields, why a newtype).
- Use the language's native doc-comment form when one exists (`///`/`//!` in Rust, docstrings in
  Python, JSDoc in TS/JS, godoc in Go, XML doc comments in C#, …) so it's tooled — rendered by
  `cargo doc` / IDE hover / language server — instead of a bespoke `//` block reinventing it.

## Move out of code
- The story of how a bug was found, what an earlier version looked like, or who caught it in
  review never goes in source, not even as a doc comment. It goes in the commit body
  (`decision`/`rejected`/`learned` lines, see Workflow's Contextual Commits format in the global
  CLAUDE.md) or a GitHub PR/issue comment. This includes mentions of a specific review pass by
  name (e.g. "a fable review found...").
- Issue/task references stay a bare pointer (`issue #52`) — don't re-explain the issue's content
  inline; the pointer rots less than a paraphrase does.

## Never
- Restate what the next line already shows.
- Say the same non-obvious fact in more than one place (a struct's doc, its constructor's doc,
  and its only call site all explaining the same constraint) — write it once, at the
  most-likely-to-be-read site, and let the rest either point there or stay silent.

## Applies to every language equally
The test doesn't change with comment syntax: "does this survive being deleted?" If yes, delete
it. If no, keep exactly the part that doesn't survive — not the surrounding narrative.
