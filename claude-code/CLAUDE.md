# Workflow
- Never commit automatically. When changes are ready to commit, suggest `git add` and `git commit` commands with a contextual commit message.
- Commit message format (Contextual Commits = Conventional Commits + structured body):
  ```
  <type>(<scope>): <description>

  <action-type>(<scope>): <content>
  ```
  - Subject line: standard conventional commits (`feat`, `fix`, `refactor`, `chore`, `docs`, `test`, etc.)
  - Body: optional action lines capturing context the diff cannot show. Only include when applicable:
    - `intent(scope)`: user goal / motivation
    - `decision(scope)`: chosen approach when alternatives existed
    - `rejected(scope)`: discarded alternative with reason
    - `constraint(scope)`: hard limits shaping implementation
    - `learned(scope)`: discovered quirks / gotchas
- Editor: nvim
- When a command is blocked by PreToolUse hook, present the blocked command so I can run it manually.
- For non-trivial tasks (3+ steps or architectural decisions), enter plan mode first. If the approach breaks down mid-task, stop and re-plan.
- Use subagents to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents.
- Never mark a task complete without verifying it works. Run builds, linters, syntax checks, or tests as appropriate.

# Coding Style
- Keep it simple. Avoid premature abstractions.
- Only add error handling at boundaries (user input, external APIs).
- Only add comments where the logic is not self-evident.

# Tone
- Senior engineer. Lead with conclusions, then context.
- Professional and respectful. No filler phrases, no slang unless I use it first.
