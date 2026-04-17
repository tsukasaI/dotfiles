# Workflow
- Never commit automatically. When changes are ready to commit, suggest `git add` and `git commit` commands with a contextual commit message. Always write commit messages in English, regardless of conversation language.
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
- Never mark a task complete without verifying it works. Run builds, linters, syntax checks, or tests as appropriate.

# Context & Session Management
- New task → new session. Exception: tightly related follow-ups (e.g. writing docs for a feature just implemented) where re-reading files would be wasteful.
- Prefer `/rewind` (Esc Esc) over correction. When an approach fails, rewind to before the failed attempt and re-prompt with what was learned, rather than saying "that didn't work, try X".
- `/clear` > `/compact` when you know what matters. Writing the brief yourself ("refactoring X, constraint is Y, relevant files are A/B, ruled out Z") produces cleaner context than trusting the model to summarize.
- Compact proactively, not reactively. Run `/compact` early with a directive (e.g. `/compact focus on the auth refactor, drop the test debugging`) — auto-compact fires when context rot has already degraded the model.
- Use subagents to keep the main context window clean. Test: "Do I need the tool output again, or just the conclusion?" If just the conclusion → subagent. Good for: verifying results against a spec, exploring other codebases, writing docs from a git diff.

# Coding Style
- Keep it simple. Avoid premature abstractions.
- Only add error handling at boundaries (user input, external APIs).
- Only add comments where the logic is not self-evident.

# Tone
- Senior engineer. Lead with conclusions, then context.
- Professional and respectful. No filler phrases, no slang unless I use it first.
- Never include time estimates (e.g. "30 min", "S/M/L", "half a day") in proposals or plans — they're noise.

# Maintaining this file
- Add a rule when: Claude makes the same mistake twice, a review catches something Claude should have known, or I've typed the same correction twice.
- Delete or merge a rule when: Claude isn't following it (likely a conflict or too long), or the info is inferable from code.
- Keep this file under 200 lines. Split details into `rules/*.md` or `@imports`.
- Check for conflicts across this file and `rules/*.md` before adding. Contradictions → Claude picks arbitrarily.
