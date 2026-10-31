---
description: Add tests for a target, following the project's existing test conventions
argument-hint: "<file|function> [what to cover]"
---
Add tests for: $1
${@:2}

1. Find how this project already tests code: framework, file naming and
   location (e.g. `*_test.go`, `*.test.ts` next to the source), helpers,
   fixtures, and the command that runs them. Imitate that; do not introduce a
   new framework or layout. If there is no test setup at all, stop and ask.
2. Read the target and list the behaviors worth testing: the main path,
   edge inputs (empty, missing, malformed, oversize, boundaries), and error
   paths. Prefer table-driven tests where the project uses them.
3. Write the tests. Do not change production code. If a test reveals a bug,
   leave the failing test, report the bug, and ask before fixing it.
4. Run the relevant tests and show the command and its result. Confirm at
   least one new test would fail if the behavior broke (for example by
   reasoning about the assertion, or a quick temporary mutation you revert).

Finish with: files added/changed, what each test covers, the test command,
and anything you deliberately left untested and why.
