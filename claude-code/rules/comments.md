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

Each kind of information has one home (t_wada):

| Where | What it carries |
|---|---|
| Code | **How**: names, types, and structure make the mechanics readable |
| Test code | **What**: the behavior the code promises, as executable examples |
| Commit log | **Why**: motivation, chosen approach, discarded alternatives (Contextual Commits body in the global CLAUDE.md) |
| Code comment | **Why not**: the obvious alternative a future editor will reach for, and why it's wrong here |

Write no other comments. Default is no comment at all; a comment has to earn its place by
answering "why not the obvious thing?"

## Why not: the only comment worth keeping
Write it right above the line a future editor would "simplify" or "fix" back into a bug:
- The naive approach is exploitable or incorrect, and the reason isn't visible from the code
  ("not `startsWith`: `/etc/passwd2` would match `/etc/passwd`").
- A measured/tuned value: why not a rounder or more intuitive number, and what invalidates
  the measurement ("not 100ms: p99 handshake is 140ms; re-measure if the TLS lib changes").
- An unusual type/API shape: why not the conventional one, when callers don't make it
  obvious ("not `Option` fields: the states are mutually exclusive").
- A deliberately ignored error or skipped check: why not handling it is safe.

If the comment would read as "why" with no rejected alternative, it belongs in the commit body.

## Doc comments
Only on public API, and only when the signature (name + types) doesn't already tell the caller
what they need: preconditions, panics/throws, units, ownership. Never on private functions,
fields, or modules just because the language has a doc-comment syntax. When one is warranted,
use the native form (`///` in Rust, JSDoc in TS/JS, godoc in Go, docstrings in Python) so it's
tooled.

## Never
- Restate what the next line shows, or paraphrase a function's name in its doc comment.
- Section banners, step narration (`// 1. parse input`), or `// end of X` markers. Extract a
  well-named function instead.
- The story of how a bug was found, what an earlier version looked like, or who caught it in
  review (including a review pass by name, e.g. "a fable review found..."). That's Why, so it
  goes in the commit body or a PR/issue comment.
- Re-explain an issue inline; a bare pointer (`issue #52`) is enough.
- Say the same fact in more than one place; write it once at the most-likely-to-be-read site.

## Test
"If this comment is deleted, will someone reintroduce the rejected alternative?" If no, delete
it. If yes, keep only the sentence that prevents that.
