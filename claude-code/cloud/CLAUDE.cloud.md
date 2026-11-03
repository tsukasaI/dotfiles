
# Cloud sessions (Claude Code on the web)

This session runs in a managed cloud container, not on my Mac. Where the
sections above conflict with this one, this one wins.

- shguard, the Bash sandbox, `sandbox.excludedCommands`, GPG, and
  `/private/tmp` don't exist here. Instructions that only work around them
  (the excluded-prefix rules, `--body-file` to dodge the keychain,
  `rules/shell-tools.md`, `rules/git-sandbox.md`) don't apply. Put temp files
  in the scratchpad directory the system prompt names.
- `gh` goes through a proxy that rejects every GraphQL call, so `gh pr ...`
  and `gh issue ...` fail. Use the built-in GitHub tools (`mcp__github__*`)
  or REST via `gh api repos/{owner}/{repo}/...`. When a skill says
  `gh pr`/`gh issue`, translate it to one of these.
- Never push to main, in any repo, `dotfiles` and `ops` included: this
  replaces "commit directly to main" above. Work on a `<type>/<short-slug>`
  branch, push it, open a PR, and leave merging to me. The proxy doesn't
  restrict which branch a push updates, so this rule is the guard.
- Never merge a PR here. The merge step of the `review-gate` skill
  (`gh pr merge --squash --delete-branch`, and the same step `/mkgoal` writes
  into a goal) doesn't run: once the review is settled, stop and report the
  PR URL.
