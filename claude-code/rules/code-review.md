---
# Loaded only when code files are in context — a self-review checklist is
# meaningless without code. Extend this list when adopting a new language.
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

# Code review mindset

Apply this checklist to your own diff before declaring a task complete — you are reviewer #1.
Source: distilled from [google/eng-practices](https://github.com/google/eng-practices).

## Self-review checklist
- **Design**: Does the change fit the existing architecture? Right pieces in the right places?
- **Complexity**: Solve the present problem only. Over-engineering for speculative future requirements is a defect.
- **Naming**: Names communicate intent without becoming unwieldy.
- **Tests**: Cover edges and concurrency. Confirm the test would actually fail if the code broke.
- **Consistency**: When the style guide is silent, match the surrounding code — including *mechanisms*, not just style. If a sibling function already solves this problem class correctly (conditional-UPDATE claim, idempotency key, display limit), match it; the most common defect is the correct pattern existing one function away.
- **Duplicated truth**: A value maintained in two unlinked places (full schema vs migrations, infra IDs copied between configs, version pins, hand-computed checksums) needs a single source or a mechanical sync check. Any "manually copy X into Y" step in docs or comments is a defect.
- **Runs**: Self-review on a diff that doesn't compile is theater — verification (per CLAUDE.md) must already have run.
- **Every line**: If a line is unclear, don't assume the complexity is justified — simplify it or add a *why* comment.
- **Context**: A small local change shouldn't cumulatively degrade the file or system.

## Change size (PRs)
- One PR = one self-contained thing — typically a *slice* of a feature, not the whole feature.
- Target ~100 lines; 1000 lines is too big; 200 lines spread across 50 files is also too big.
- Refactoring is a separate PR from feature/bugfix changes — never combine them.
- Exceptions: whole-file deletions, mechanical refactors from trusted tooling.

## PR / commit description content
(Format itself follows the Contextual Commits spec in CLAUDE.md.)
- Subject line: imperative, complete sentence (`feat(rpc): delete the FizzBuzz RPC`, not `Deleting...` or `Deleted...`).
- Body explains *why* and trade-offs — the diff already shows *what*.
- Vague subjects (`Fix bug`, `Update code`, `Move things`) are not acceptable.

## Reader confusion = code defect
If you find yourself wanting to explain a change in chat or a PR comment to make it understandable, the diff or its comments are wrong. Fix the diff instead — chat explanations don't reach future readers.
