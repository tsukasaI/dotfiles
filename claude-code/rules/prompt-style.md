---
paths:
  - "**/CLAUDE.md"
  - "**/SKILL.md"
  - "claude-code/rules/*.md"
  - "claude-code/agents/*.md"
---

# Prompt style

Loaded when editing a prompt file itself (rule/skill/agent/CLAUDE.md), not on
every session; this file is about writing these files, not about code. The
usual defects are broken tool references, stale worked examples, cross-file
contradictions, and unscoped clusters of unreasoned prohibitions, not length.

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
- **Opus 5.5**: thinking is always on and effort is the depth control; lower
  `effort:` before adding "be brief" or "think less" prose. Emphasis only on
  the one instruction that's actually under-triggering; marking everything
  critical erases the signal. Re-test rules written for older Opus verbosity
  or over-verification before keeping them.
- **Sonnet 5**: state scope explicitly — it won't generalize a rule from one
  case to another on its own. A worked example gets followed literally,
  including a wrong one, so keep examples correct and current.
- **Fable 5.1**: state the goal and constraints, not the steps, unless the
  operation is fragile enough to need an exact script. State the autonomy
  boundary and the scope explicitly: it tends to ask permission it doesn't
  need and to widen scope and test coverage on its own.

## Test
Would deleting this line lose a reason, a script for something fragile, or a
fact that isn't true elsewhere? If yes, keep it. If it's register, choreography
for a non-fragile call, or a restated fact, cut it.
