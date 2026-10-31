---
description: Behavior-preserving refactor with tests run before and after
argument-hint: "<target> [goal]"
---
Refactor: $1
Goal: ${@:2}

If no goal was given above, propose 1-3 concrete refactoring options for the
target (what changes, why it helps) and stop until I pick one.

Rules:
- Preserve behavior exactly. No feature changes, no bug fixes mixed in
  (report bugs you notice separately).
- Keep the diff surgical: touch only what the goal requires, follow the
  project's existing patterns, and remove only orphans your change creates.
- Update comments and docs that your change makes false.

Steps:
1. Find and run the tests that cover the target. Show the command and
   result. If coverage is missing or tests already fail, stop and tell me
   before changing anything.
2. Make the change in small steps.
3. Run the same tests again and show the result. Also run the project's
   type check / linter if it has one.
4. Summarize: what changed and why it is behavior-preserving, the before /
   after test results, and any risks or follow-ups.
