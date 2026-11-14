# Commits in dotfiles

- Stage whole files under `claude-code/`. A commit that leaves part of a
  file unstaged fails pre-commit: lefthook hides the unstaged hunks with
  `git checkout --force`, and the sandbox's denyWrite refuses that write.
- So when two subtasks touched the same file, stage the whole file and
  commit them together, without asking first. List both subtasks in the
  message body. This applies only to this repo, and only to files changed
  in this session; leave unrelated working-tree changes out, as the global
  CLAUDE.md says.
