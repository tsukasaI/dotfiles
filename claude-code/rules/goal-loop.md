# /goal loops

The goal's Stop hook judges only this session's transcript. Work merged in an
earlier session, and any condition on how it was done (delegation, review,
paths touched), cannot be shown, so the goal never clears.

- Before building or starting a /goal over issues, check each one with
  `gh issue view <N> --json state,closedByPullRequestsReferences` and search
  merged PRs with `gh pr list --state merged --search "<N>"`. An issue already
  closed by a merged PR does not go into the goal. Drop it, and list it to the
  user with that PR's URL.
- If that is only noticed after the goal has started: run the checks once,
  show what is missing, and ask the user once whether to accept the earlier
  work or keep the goal. Then stop. Never revert or redo merged work to
  create evidence for the hook, and never re-ask on each hook rejection.
