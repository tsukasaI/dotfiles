# git / gh inside the Bash sandbox

Patterns that the sandbox or shguard denies by mechanism, not by policy:

- Never put `secret` or `credential` in a branch name: the ref lock file
  (`.git/refs/heads/...secret....lock`) matches the `**/*secret*` /
  `**/*credential*` sandbox denyRead glob, so `git switch -c` fails.
- Create branches with `--no-track` (`git switch -c <b> --no-track origin/main`,
  `git worktree add --no-track -b <b> <path> origin/main`): the sandbox
  write-protects `.git/config`, so recording the upstream fails. Set the
  upstream with the unsandboxed `git push -u origin <b>` instead.
- `gh pr|issue --body-file` takes an absolute path to a file that already
  exists under `/private/tmp/claude-501/`: shguard resolves symlinks, so a
  relative path (including after `cd`) or a not-yet-written file is denied.
