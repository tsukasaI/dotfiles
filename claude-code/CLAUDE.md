# Workflow
- Never commit automatically. When changes are ready to commit, suggest a conventional commit message instead.
- Editor: nvim

# Bash Hooks
- When a command is blocked by PreToolUse hook, present the blocked command to the user so they can run it manually.

# Context Management
- Use /clear between unrelated tasks to reset context.
- Delegate large research/exploration to subagents to keep main context small.
- Run /compact at task boundaries; include what to preserve in the instruction.
- Scope file reads to only the files needed (never read entire directories).

# Coding Style
- Keep it simple. Avoid premature abstractions.
- Only add error handling at boundaries (user input, external APIs).
- Only add comments where the logic is not self-evident.
