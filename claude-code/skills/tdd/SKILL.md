---
name: tdd
description: Follow a strict test-driven development cycle — write a failing test before the code that passes it. Use when implementing a feature with defined acceptance criteria, or fixing a bug where a regression test would prevent recurrence. Triggered by red-green-refactor, prove-it patterns, or explicit TDD requests.
---

# Test-Driven Development

Tests are proof. "Seems right" is not done. A test that passes on first write proves nothing — you did not watch it fail.

## When to use

- New feature with testable acceptance criteria
- Bug fix where a regression test would guard recurrence
- Refactoring critical paths that lack coverage — add tests first, refactor under them

When NOT to use:
- Exploratory prototypes where the target behavior is not yet known
- Pure UI tweaks verified by eye (use browser-test instead)
- One-shot scripts with no future maintenance

## The cycle

```
RED              GREEN              REFACTOR
Write a test  -> Write minimal   -> Clean up while
that fails       code to pass       tests stay green  -> (repeat)
```

1. **Red** — Write a failing test that defines the behavior. Run it. Confirm it fails for the right reason (not a typo, not a missing import).
2. **Green** — Write the minimum code to pass. Do not over-engineer. Run the test; confirm it passes.
3. **Refactor** — Improve structure while tests stay green. Run the full suite after each change.

## Bug fixes (prove-it pattern)

Do not start by trying to fix the bug. Start by reproducing it in a test.

1. Write a test that demonstrates the bug — it must FAIL on current code
2. Implement the fix
3. Test PASSES — bug fixed, regression guarded
4. Run the full suite — confirm no regressions

## Writing good tests

- **State, not interactions** — Assert on outcomes, not which methods were called
- **DAMP over DRY** — Each test tells a complete story without tracing through shared helpers
- **Real > Fake > Stub > Mock** — Prefer real implementations. Mock only at boundaries.
- **Arrange-Act-Assert** — Set up, perform, verify
- **One concept per test** — Separate tests for separate behaviors
- **Descriptive names** — `it('sets completedAt when task completes')`, not `it('works')`

## Test pyramid (rough shape)

- Unit (~80%): pure logic, isolated, milliseconds each
- Integration (~15%): component interactions, API boundaries
- E2E (~5%): critical user flows only

## Output format (what to report back)

```
## TDD: <behavior name>

- RED: <test file>:<line> — failed with <error summary>
- GREEN: <impl file>:<line> — minimal change to pass
- REFACTOR: <what improved; tests still green>
- Full suite: <N passed, 0 failed>
```

## Red flags

| Rationalization | Reality |
|---|---|
| "I'll write the test after, the code is simple." | Test-after skips the "watch it fail" step. You never learn whether the test could have caught the bug. |
| "The test passed on first run — great, moving on." | A test that never failed is not a test. Break the code temporarily and confirm the test catches it, or rewrite the assertion. |
| "Mocking everything is faster." | Tests pass, production breaks. Mock at boundaries only. |
| "I'll skip this flaky test to go green." | Flake is a bug. Investigate the race/timing, do not silence it. |
| "One big test covers all the cases." | One assertion failing hides the others. Split by behavior. |
| "Snapshot covers it." | Large snapshots nobody reviews rot fast. Prefer targeted assertions. |
