---
name: plan
description: Before writing code, produce an implementation plan broken into vertical slices. Use before any non-trivial task requiring 3+ steps, architectural decisions, or cross-file changes; also when scope is ambiguous and needs decomposition. Operate in read-only mode until the plan is confirmed.
---

# Planning and Task Breakdown

Fix the plan before touching code. A plan is wrong fast and cheap; code is wrong slowly and expensively.

## When to use

- Task spans 3+ steps, multiple files, or architectural decisions
- Scope is ambiguous — requirement needs decomposition before implementation starts
- Two or more reasonable approaches exist and the trade-off is not obvious

When NOT to use:
- Single-file, single-function edits with an obvious shape
- Pure refactors where the target state is already specified in the request
- Bug fixes where the failing test already pins the behavior

## Workflow

1. **Analyze** — Read the spec and the parts of the codebase the change will touch. Surface existing patterns, conventions, constraints.
2. **Map dependencies** — What must exist before what. Build foundations first.
3. **Slice vertically** — Each task delivers a working, testable path (not a horizontal layer). After each task the system still runs.
4. **Write each task** with:
   - Description (one paragraph)
   - Acceptance criteria (specific, testable)
   - Verification steps (tests, build, manual checks)
   - Files likely touched and dependencies on other tasks
5. **Order and checkpoint** — High-risk tasks first. Checkpoints every 2–3 tasks to re-verify assumptions.
6. **Call out risks and trade-offs** — Explicitly name what could go wrong and what you chose against.
7. **Present and wait** — Show the plan and wait for confirmation before coding.

## Splitting rule

If a task touches many files, has more than ~3 acceptance criteria, or its title contains "and" — split it. Split until each task delivers one coherent behavior.

## Parallelization

- **Safe to parallelize**: independent feature slices, tests for already-implemented features, docs
- **Must be sequential**: migrations, shared-state changes, dependency chains
- **Coordinate first, then parallelize**: features sharing an API contract — define the contract up front, then fan out

## Output format

```
# Plan: <short title>

## Goal
<one paragraph: what ships and why>

## Assumptions
- <assumption the plan rests on>

## Tasks
### 1. <task title>
- Description: <one paragraph>
- Acceptance: <bullets, testable>
- Verification: <tests / build / manual>
- Files: <paths>
- Depends on: <task numbers or "none">

### 2. ...

## Risks and trade-offs
- <risk>: <mitigation or accepted cost>
- <alternative considered>: <why rejected>

## Checkpoints
- After task N: <what to re-verify>
```

## Red flags

| Rationalization | Reality |
|---|---|
| "Let me just start — I'll plan as I go." | The cost of a wrong plan found mid-implementation is much higher than up-front planning. |
| "Horizontal layers are simpler to plan." | They leave the system broken between tasks. Vertical slices keep it working. |
| "One big task is fine if I know what to do." | If you can describe it in one task, you can describe it in three, and the three are easier to verify. |
| "I'll add the risks section later." | Risks not written down do not get mitigated. |
