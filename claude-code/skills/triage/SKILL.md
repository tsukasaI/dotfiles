---
name: triage
description: Scans every open GitHub issue in the current repo, proposes a priority order from label/age heuristics, gets an explicit go/schedule/reject decision on each from the user, and for any "go" issue whose body poses an open design question surfaces it and records the user's call as an issue comment. Use when starting a work session and deciding what to build next, before /mkgoal. Ends by emitting one copy-pasteable /mkgoal line listing every "go" issue in priority order.
disable-model-invocation: true
argument-hint: (none, scans the current repo)
allowed-tools: Bash, AskUserQuestion
---

# /triage: decide what to work on, once, for the whole backlog

Scan all open issues, get a decision on each, surface any design question a
"go" issue poses, then stop. This skill never drafts a `/goal` statement,
never runs `/mkgoal` or `/goal`, and never invokes other skills. Match the
user's conversation language in all dialogue.

## Why this exists

Every issue eventually needs one of three outcomes: work on it now, defer it,
or drop it. Deciding this per-issue at random moments means priority never
gets compared across the whole backlog. This skill forces one pass over
everything open, so the go/no-go call is made with the full picture, and the
resulting batch feeds straight into `/mkgoal`.

## Scan

    gh issue list --state open --json number,title,body,labels,createdAt,url

If this returns zero issues, say so and stop; there is nothing to triage.

## Propose an order

Rank by heuristic, not by asking the user for criteria each time:
1. A `priority:*` or `bug` label outranks an unlabeled or `enhancement`-only
   issue.
2. Within the same rank, older `createdAt` first.

Present the full list in this proposed order, one line each: `#N title
(labels, age)`. This is a starting point the user can reorder or reject
outright when answering below; it is not a decision by itself.

*Done:* every open issue listed once, in a stated order.

## Decide

Walk the list in the proposed order. For each issue ask, via
`AskUserQuestion`, one of **go / schedule / reject**, with the issue's title
and a one-line body summary as context. Batch up to 4 issues per
`AskUserQuestion` call (its hard limit); for more than 4 open issues, run it
multiple times back to back until every issue has an answer. Never guess a
decision from labels; the heuristic in Propose an order is for ranking, not
for deciding go/schedule/reject.

Apply each answer immediately (it is the user's explicit authorization for
that one issue, scoped to that issue only):

- **reject**: `gh issue close <N> --comment "<one-line reason from the user's answer>"`
- **schedule**: `gh issue comment <N> --body "Scheduled: revisit later."` (issue stays open, no label dependency)
- **go**: no Bash action; keep it in the go-list, in the proposed order

*Done:* every issue has go, schedule, or reject applied.

## Flag design decisions

For every issue marked **go**, check its body for a signal that it poses an
open design question rather than a single obvious fix: explicit alternatives
("Option A / Option B", a bulleted or numbered list of approaches), phrasing
like "needs one decision", "which way it should go", "decide deliberately",
or a stated interaction/conflict with another issue in the batch (a cross-
reference plus language like "the two need one decision"). A plain bug
report with one suggested fix is not a design question, even if it also
suggests adding a test; do not flag those.

For each flagged issue, ask the user to pick an option via `AskUserQuestion`
(batch up to 4 per call, same as Decide), phrasing the options directly from
the issue body's own alternatives; never invent options the issue doesn't
already pose. Include an explicit "Undecided, leave it to /mkgoal or
implementation time" option for anyone who'd rather not commit now.

Record a real answer immediately as `gh issue comment <N> --body "Design
decision (from /triage): <chosen option, one line>"` so it is visible to
`gh issue view` later, the same mechanism `/mkgoal` already reads issue
bodies through. Skip the comment for "Undecided".

This step runs only for "go" issues; never for "schedule" or "reject" ones.

*Done:* every "go" issue has been checked for an open design question, and
every flagged one with a real answer has that answer recorded as a comment.

## Hand off

If the go-list is empty, say so and stop; there is no `/mkgoal` line to emit.

Otherwise emit exactly one fenced code block, in priority order, and stop:

    /mkgoal #<N1> #<N2> #<N3> ...

Any remark ("paste this to start /mkgoal", noting which issues got a
recorded design decision) goes outside the block. Do not draft a goal
statement yourself; that is `/mkgoal`'s job once the user runs it.

## Hard limits

- Never run `/mkgoal` or `/goal`, and never invoke another skill or subagent.
- Bash is scoped to `gh issue list`, `gh issue close`, and `gh issue comment`
  only; never `gh issue delete`, never touch already-closed issues, never any
  other command.
- Never close or comment on an issue without an explicit go/schedule/reject
  answer for that specific issue.
- Never comment a design decision onto an issue without an explicit answer
  from the user in this session; "Undecided" is a valid answer and writes no
  comment.
- Never invent design options that aren't already present in the issue's own
  body.
