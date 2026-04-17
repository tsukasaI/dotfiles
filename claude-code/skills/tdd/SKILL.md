---
description: Follow a strict test-driven development cycle
when_to_use: When implementing a new feature with defined acceptance criteria, or when fixing a bug where a regression test would prevent recurrence. Triggered by red-green-refactor, prove-it patterns, or explicit TDD requests.
---

# Test-Driven Development

Write a failing test before writing the code that makes it pass. Tests are proof -- "seems right" is not done.

## The TDD Cycle

```
RED              GREEN              REFACTOR
Write a test  -> Write minimal   -> Clean up the
that fails       code to pass       implementation -> (repeat)
```

1. **Red**: Write a failing test that defines the desired behavior. A test that passes immediately proves nothing.
2. **Green**: Write the minimum code to make the test pass. Don't over-engineer.
3. **Refactor**: Clean up while keeping tests green. Run tests after every change.

## Rules

- Run the test after each step to confirm status (fail -> pass -> pass)
- Do not write implementation code before the test exists
- Each cycle should be small and focused -- one behavior at a time
- Ask me what behavior to implement if the requirement is ambiguous

## Bug Fixes (Prove-It Pattern)

Do not start by trying to fix a bug. Start by writing a test that reproduces it.

1. Write a test that demonstrates the bug -- it should FAIL
2. Implement the fix
3. Test PASSES -- bug fixed, regression guarded
4. Run full test suite -- no regressions

## Writing Good Tests

- **Test state, not interactions**: Assert on outcomes, not which methods were called
- **DAMP over DRY**: Each test should tell a complete story without tracing through shared helpers
- **Prefer real implementations over mocks**: Real > Fake > Stub > Mock. Mock only at boundaries.
- **Arrange-Act-Assert**: Set up, perform action, verify outcome
- **One assertion per concept**: Separate tests for separate behaviors
- **Descriptive names**: `it('sets completedAt when task is completed')` not `it('works')`

## Test Pyramid

- Unit tests (~80%): Pure logic, isolated, milliseconds each
- Integration tests (~15%): Component interactions, API boundaries
- E2E tests (~5%): Critical user flows only

## Anti-Patterns to Avoid

- Testing implementation details instead of behavior
- Flaky tests (timing, order-dependent)
- Snapshot abuse -- large snapshots nobody reviews
- Mocking everything -- tests pass but production breaks
- Skipping tests to make the suite pass
