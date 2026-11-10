# git / gh inside the Bash sandbox

Patterns that the sandbox or shguard denies by mechanism, not by policy:

- Never put `secret` or `credential` in a branch name: the ref lock file
  (`.git/refs/heads/...secret....lock`) matches the `**/*secret*` /
  `**/*credential*` sandbox denyRead glob, so `git switch -c` fails.
- Create branches with `--no-track` (`git switch -c <b> --no-track origin/main`,
  `git worktree add --no-track -b <b> <path> origin/main`): the sandbox
  write-protects `.git/config`, so recording the upstream fails. Set the
  upstream with the unsandboxed `git push -u origin <b>` instead.
- shguard refuses `git commit -F`, which its row doesn't list. Pass a multi-part
  message with repeated `-m`, one per paragraph.
- shguard refuses a `gh` body file outside `/private/tmp` and the repository
  (`dotfiles-gh-upload-path`: gh runs unsandboxed and uploads it), and
  `gh api` with `-X`/`-f`/`-F`/`--input`, which turn it into a write.
- shguard refuses `gh` with `-R`/`--repo` or a URL operand, which can send the
  token to another host, so `gh pr` commands reach only the cwd's repository.
  Read another repository with a GET `gh api repos/<o>/<r>/...` (`-H` is refused
  too); give the user the command for a write.

## Excluded commands and what shguard allows

`git push/fetch/pull/ls-remote`, `git remote prune`, `gh`, and
`go mod download`/`go mod tidy`/`go get` run outside the Bash sandbox
(`sandbox.excludedCommands` in `settings.json`): inside it, SSH remotes
can't resolve `github.com` and `gh` can't read the keychain.

- shguard allows everyday git/gh writes (commit, rebase, `reset --soft`,
  switch, stash, fetch/pull, push to a named remote,
  `gh pr create|merge|comment`, `gh issue create|comment`, GET-only
  `gh api`) and refuses what loses work for good or has no row
  (`reset --hard`, `checkout`, `restore`, `clean`, `branch -d`,
  `gh pr merge --admin`, `gh api` writes). Unstage with
  `git reset -- <path>`. For a refused command, follow the hook-blocked
  rule in CLAUDE.md (Workflow): stop and give the user the command.
- Only the exact prefixes listed there are excluded: for git, the bare form
  or `origin` after the subcommand or one of the listed flags (`git push`,
  `git push origin <branch>`, `git push -u origin <branch>`,
  `git fetch origin`, `git remote prune origin`,
  `git pull --rebase origin main`). Any other form, and any line with a
  redirect or pipe, runs sandboxed and fails SSH, so put other flags after
  `origin`.
- Every other git command, `git commit` included, runs sandboxed (GPG
  reaches its agent via `sandbox.network.allowUnixSockets`).
- Run excluded commands standalone, not chained after `cd`/`&&`, because
  every command in a chain must match the exclusion or the whole line runs
  sandboxed.
- A newline inside an argument splits the line the same way, so a
  multi-line `gh pr create -b`/`gh issue create -b` fails on the keychain:
  write the body to a file under the scratchpad
  (`/private/tmp/claude-501/...`) and pass `--body-file`.
- A backquote anywhere in the line, even inside single quotes or escaped in
  double quotes, also drops the exclusion (8 of 8 observed `gh` calls ran
  sandboxed): keep backquotes out of `--title`/`--body`/`--comment` and put
  Markdown text in a `--body-file`.
- If `gh auth status` inside the sandbox reports an invalid keyring token,
  that is the sandbox, not a broken login; never run `gh auth refresh` for
  it. shguard refuses `gh auth status` from Claude anyway: check access with
  a read such as `gh issue list` instead.
