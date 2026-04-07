---
description: Before writing any code, create an implementation plan with task breakdown
---

# Planning and Task Breakdown

Before writing any code, operate in read-only mode.

## Process

1. **Analyze**: Read the spec and relevant codebase to understand existing patterns, conventions, and constraints
2. **Map dependencies**: Identify what depends on what -- build foundations first
3. **Slice vertically**: Each task delivers a working, testable feature path (not horizontal layers)
4. **Write tasks**: For each task, define:
   - Description (one paragraph)
   - Acceptance criteria (specific, testable)
   - Verification steps (tests, build, manual checks)
   - Dependencies and files likely touched
   - Scope: XS (1 file), S (1-2), M (3-5), L (5-8), XL (break it down further)
5. **Order and checkpoint**: High-risk tasks early. Checkpoints every 2-3 tasks. System stays working after each task.
6. **Note risks and trade-offs**

## Task sizing

- If a task touches 8+ files or has more than 3 acceptance criteria, split it
- If the title contains "and", it's probably two tasks
- Agents perform best on S and M tasks

## Parallelization

- **Safe**: Independent feature slices, tests for implemented features, docs
- **Sequential**: Migrations, shared state, dependency chains
- **Coordinate first**: Features sharing an API contract -- define contract, then parallelize

## Output

Present the plan and **WAIT for my confirmation** before proceeding.
