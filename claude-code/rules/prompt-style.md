---
paths:
  - "**/CLAUDE.md"
  - "**/SKILL.md"
  - "claude-code/rules/*.md"
  - "claude-code/agents/*.md"
---

# Prompt style

Loaded when editing a prompt file itself (rule/skill/agent/CLAUDE.md), not on
every session — this file is about writing these files, not about code. Based
on a review of all `claude-code/` prompt files against Sonnet 5 / Fable 5 /
Opus 4.6 (2026-08-07): most files already pass; the failures found were a
broken tool reference, a stale worked example, a cross-file contradiction, and
one unscoped cluster of unreasoned prohibitions — not verbosity in general.

## Keep
- A prohibition that carries a stated reason tied to a real, reproducible
  failure or a policy/business constraint — even if terse.
- An exact script or template for a genuinely fragile or irreversible
  operation (destructive edits, secret handling, one-shot approval gates).
- Tool-contract detail (exact commands, exact flags, exact output shape).
- Context that explains a non-obvious constraint.

## Cut
- Pressure markers (`CRITICAL`/`MUST`/`ALWAYS`) used as a default register
  rather than a scoped fix for one demonstrably under-triggering instruction.
- Step-by-step choreography for a judgment call that isn't fragile.
- The same constraint restated in two files that already load together for
  the same target — cross-reference the one source instead.
- A reference to a retired or nonexistent feature, skill, or tool. Verify
  worked examples and named tools still exist before trusting them.

## Model-specific
- **Opus 4.6**: emphasis only on the one instruction that's actually
  under-triggering. Marking everything critical erases the signal.
- **Sonnet 5**: state scope explicitly — it won't generalize a rule from one
  case to another on its own. A worked example gets followed literally,
  including a wrong one, so keep examples correct and current.
- **Fable 5**: state the goal and constraints, not the steps, unless the
  operation is fragile enough to need an exact script.

## Test
Would deleting this line lose a reason, a script for something fragile, or a
fact that isn't true elsewhere? If yes, keep it. If it's register, choreography
for a non-fragile call, or a restated fact, cut it.
