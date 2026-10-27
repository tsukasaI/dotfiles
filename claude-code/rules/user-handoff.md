# Commands handed to the user

Once you have asked the user to run a command, it is theirs: never issue the
same command yourself, in the foreground or background, until they report it
finished or explicitly hand it back. Two copies of a pre-push gate share the
target directory and CPU, so both run several times slower (a 2-minute gate
took over 10 minutes and its SSH connection dropped).

- While waiting, run nothing that competes with it in the same repository:
  no `cargo` build/test, no `git push`, no branch switch of the checkout it
  runs in. That includes subagents working in other worktrees of that repo.
- Check progress read-only (e.g. `gh api repos/<o>/<r>/branches/<b>`), and do
  not ask the user again while their run is in progress.
- If you stopped a background copy of the command before handing it over,
  say so, so the user knows nothing else is running.
