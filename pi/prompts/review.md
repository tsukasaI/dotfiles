---
description: Review uncommitted changes (or HEAD) without editing anything
argument-hint: "[focus]"
---
Review my current changes. Do not edit any file.

1. Run `git status --short` and `git diff HEAD --stat`. If the working tree is
   clean, review the last commit instead (`git show --stat HEAD`, then
   `git show HEAD`). Read untracked files that are part of the change.
2. Read enough surrounding code to judge each change in context, not just the
   diff hunks.
3. Focus: ${@:-correctness, edge inputs, error handling, security, tests, and naming}.

Check in particular:
- Does the change do what it appears to intend? Any logic or off-by-one errors?
- Edge inputs: empty, missing, malformed, oversize, whitespace, multi-line.
- Error paths: swallowed errors, fail-open security checks, leaked secrets.
- Tests: is the new behavior covered? Would the tests fail if the code broke?
- Unrelated changes mixed in, dead code left behind, comments that now lie.

Report findings ordered by severity (critical / high / medium / low), each with
`path:line`, the problem, and a concrete suggested fix. Separate "must fix"
from "nit". If you find nothing significant, say so plainly instead of
inventing issues. End by asking which findings I want addressed.
