---
name: review-gate
description: Opens everything changed since the last release in difit, with AI-proposed comments at points flagged by decision()/rejected()/constraint() lines in commit messages, so accumulated changes can be reviewed in one batch right before a release. Use right before tagging/releasing, not per-PR.
disable-model-invocation: true
argument-hint: (none)
allowed-tools: Bash, Read
---

# /review-gate: batch human review since the last release

Open a difit session covering everything merged since the last release, then
stop. This skill never merges, tags, releases, or edits git history, and it
never drafts a fix; that is a separate step the user starts afterward. Match
the user's conversation language in all dialogue.

## Why this exists

Per-PR human review was deliberately dropped from this flow: fable's approval
is sufficient to merge to main, and the human decision already happened at
triage. The Deploy gate from the AI-native SDLC model still needs to exist
somewhere, though; it lives here, at release time, as one batched pass over
everything that shipped since the last release instead of N synchronous
per-PR reviews.

## Find the base

    base=$(gh release view --json tagName -q .tagName 2>/dev/null) \
      || base=$(git describe --tags --abbrev=0 2>/dev/null)

If neither produces a value, this repo has never been released or tagged.
Ask the user what commit/tag to diff from; do not guess (e.g. the root commit
could mean reviewing the entire project history).

*Done:* `base` holds a resolvable git ref older than `HEAD`.

## Collect flagged points

    git log <base>..HEAD --format='%H%x1f%B%x1e'

Split on `\x1e` per commit, then `\x1f` to separate the SHA from the body.
For each commit body, pull every line starting with `decision(`, `rejected(`,
or `constraint(` (the Contextual Commits convention). Commits with none of
these lines contribute no comment; they still appear in the diff difit shows.

For each flagged commit:
1. `git diff-tree --no-commit-id --name-only -r <sha>` for changed files.
2. Skip a file if `git cat-file -e HEAD:<file>` fails (renamed or deleted
   since); record it in the final report instead of silently dropping it.
3. `git diff <sha>^ <sha> -- <file>` and read the first `@@ -a,b +c,d @@`
   hunk header; use `c` as the comment's line. Do not guess a line number
   from anything else.

*Done:* one `(filePath, line, body)` triple per flagged file, or zero if no
commit had a flagged line (that is a valid outcome, not an error).

## Open difit

Build one `--comment` flag per triple:

    --comment '{"type":"thread","filePath":"<filePath>","position":{"side":"new","line":<line>},"body":"<the decision/rejected/constraint line text>"}'

Then run, in the foreground (it self-detaches and exits on its own once the
server is up, no backgrounding needed on this side):

    bunx difit <base> HEAD --background <--comment flags from above, zero or more>

First run may take a while resolving the package from the registry; that is
normal `bunx` behavior, not a hang. It prints one line of JSON on success:
`{"port":...,"url":"...","pid":...}`. Parse `url` from that line.

Run this even with zero comments; the human's own read-through of the full
diff is the point, not only the AI-flagged spots.

*Done:* difit server is up and its URL was parsed from the JSON handshake
line.

## Report and stop

Give the user the URL, and list any files skipped in step 2 above (renamed or
deleted since) so nothing silently vanished from review. Then stop.
Fixing what the review turns up, and releasing, are separate next steps the
user drives afterward, not part of this skill.

## Hard limits

- Never merge, tag, create a release, or edit git history.
- Never run `difit comment resolve`, and never modify or close the difit
  server on the user's behalf.
- Bash is scoped to `git`, `gh release view`, and `bunx difit` only; never any
  other command.
