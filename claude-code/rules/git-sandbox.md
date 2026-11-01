# git / gh inside the Bash sandbox

Patterns that the sandbox or shguard denies by mechanism, not by policy:

- Never put `secret` or `credential` in a branch name: the ref lock file
  (`.git/refs/heads/...secret....lock`) matches the `**/*secret*` /
  `**/*credential*` sandbox denyRead glob, so `git switch -c` fails.
- Create branches with `--no-track` (`git switch -c <b> --no-track origin/main`,
  `git worktree add --no-track -b <b> <path> origin/main`): the sandbox
  write-protects `.git/config`, so recording the upstream fails. Set the
  upstream with the unsandboxed `git push -u origin <b>` instead.
- shguard refuses a `gh` body file outside `/private/tmp` and the repository
  (`dotfiles-gh-upload-path`: gh runs unsandboxed and uploads it), and
  `gh api` with `-X`/`-f`/`-F`/`--input`, which turn it into a write.
