# /mkgoal test invocations

Manual verification suite for `SKILL.md`. Run each in a fresh session and
compare against the expected behaviour. Re-run after any edit to the skill,
and whenever the main-loop model changes tier.

## Pass criteria common to all tests

- The only Bash commands the skill runs are `gh issue view <N> --json
  title,body,url,comments`, once per issue and only in issue mode, and the
  `wc -m <absolute scratchpad path>/mkgoal-statement.txt` length check
  before each draft or revision is presented. The statement reaches that
  file through Write, never a heredoc/`echo`/`printf` (shguard denies a
  heredoc body with many `for`/`if`/`do` words). Verification commands are drafted, not executed; otherwise
  only Read/Grep existence checks are allowed.
- The skill never invokes `/goal`, other skills, or subagents.
- Slot questions are asked via a single batched AskUserQuestion call (one
  question per open slot), not plain-text messages; follow-up re-asks of a
  single slot also use AskUserQuestion.
- The final approved output is a fenced code block containing exactly one
  line starting with `/goal` — no prose inside the block, no line breaks,
  at most 4,000 characters as measured by the `wc -m` check, whose count
  is shown with each draft.
- The assembled statement always contains the "or stop after <N> turns"
  clause and instructs showing the verification command's full output each
  turn.
- The assembled statement always contains the standing implementation
  pattern: delegate the implementation to a `model: sonnet` subagent and
  send review fixups back to that implementer via SendMessage, with no code
  Edit/Write in the main loop,
  review with a `code-reviewer` subagent (`model: opus`, or `model: fable`
  for a security-boundary or architectural change), and squash-merge via
  `gh pr merge --squash --delete-branch` once the reviewer approves. It is never
  asked about as a slot.
- The assembled statement always contains the follow-up clauses: medium/low
  findings settled by the `review-gate` skill tiers (`## Auto-fixed` in
  the PR body; `needs-decision` issues with a decision note, created without
  asking, capped at 3 × issues, overflow into one parent issue), the stuck
  rule (same failure 3 turns in a row → file and move on), and a final-turn
  `## Follow-ups` block. It never requires the follow-up issue count to be
  zero.
- The constraints clause appears unless the user explicitly answered "none".

## Tests

### 1. All slots present in the argument

    /mkgoal go test ./... が全部通ること。検証コマンドは go test ./...、制約は他のテストファイルを変更しないこと、上限5ターン

Expected: no questions. All four slots filled silently from the argument;
goes straight to the approval gate with the assembled statement, including
the constraints clause.

### 2. Objective condition, everything else missing

    /mkgoal make all the tests pass

Expected: ONE AskUserQuestion call asking (1) the exact test command,
(2) constraints with a "None" option, (3) the turn cap with proposed
default 15. The condition itself is accepted once tied to the command.

### 3. Subjective condition (Japanese)

    /mkgoal コードをきれいにして

Expected: rejects「きれいに」as unfilled, offers an objective proxy (e.g. a
linter reporting 0 issues) as an option, and asks all four slots in one
AskUserQuestion call.

### 4. Condition and command given, constraints and cap missing

    /mkgoal Lighthouse performance ≥ 90, verified with npm run lighthouse

Expected: slots 1 and 2 filled silently; ONE AskUserQuestion call asking
(1) constraints with a "None" option, (2) turn cap with default 15, and
waiting for explicit answers.

### 5. Genuinely ambiguous / subjective request

    /mkgoal improve API performance

Expected: one AskUserQuestion call asking (1) which metric and threshold,
(2) which command measures it, (3) constraints, (4) turn cap with default 15.
Does not assemble until all four meet the bar.

### 6. Bare invocation

    /mkgoal

Expected: asks what the user wants to achieve before any slot questions.
Does not invent a goal.

### 7. Explicit "no constraints"

Run test 4 and answer "None" to the constraints question.

Expected: the assembled statement omits the constraints clause entirely;
all other clauses (full output each turn, "or stop after 15 turns") present.

### 8. Subjective constraint

Run test 4 and answer the constraints question with「悪化させないこと」.

Expected: the constraint is treated as unfilled (same objectivity gate as
the condition); re-asks that slot only, offering a checkable candidate
(e.g. "no changes outside src/ — shown via `git diff --stat` each turn").

### 9. Revision-cycle cap

Run test 1, then answer every presented draft with「もっといい感じに」.

Expected: re-presents as "Revision 1 of 3", "Revision 2 of 3",
"Revision 3 of 3"; after the third rejection, exits the skill and suggests
re-running /mkgoal, producing no final statement.

### 10. Slot-level stubbornness cap

Run test 6, then reply「いい感じになったら OK」to the condition question,
three times.

Expected: each re-ask offers one concrete objective candidate acceptable
in a tap; after the 3rd failed attempt, states the condition cannot be
made machine-checkable and exits without producing a statement.

### 11. Issue mode, two issues with complete bodies

    /mkgoal #12 #15

(Pick two open issues whose bodies each state a checkable condition and a
verification command, and that carry no Triage comment.)

Expected: runs `gh issue view` exactly twice (once per issue, `--json
title,body,url,comments`), no other Bash besides the `wc -m` length check. Slots 1 and 2 fill per issue from the
bodies; ONE AskUserQuestion call asks only (1) a single turn cap for the
whole batch with proposed default 30 (15 × 2 issues) and 60 as the other
option, (2) one constraint across all issues with a "None" option and the
test-deletion candidate. The issue cap in the statement reads 6 (3 × 2). The statement names each issue as
its own clause ("Resolve issue #12 (<title>) and issue #15 (<title>)"),
gives each its own verification command, and joins the completion
conditions with "and".

### 12. Issue mode, body missing a verification command

    /mkgoal #<N>

(Pick an issue whose body states what "done" looks like but names no
command.)

Expected: one `gh issue view` call; the AskUserQuestion call asks for that
issue's verification command specifically (naming the issue number),
alongside the batch-level turn cap and constraint questions. Does not
invent a command from the body.

### 13. Issue mode never closes or comments

Run test 11.

Expected: no `gh issue close`, `gh issue comment`, or `gh issue edit`
appears anywhere in the transcript; issue state is untouched after the
skill exits.

### 14. Issue mode, Triage comment takes precedence over the body

    /mkgoal #<N>

(Pick an issue that `/triage` marked `go`, whose owner-authored Triage
comment fills `Completion condition` and `Verification`, with `Decision`
set to a chosen option, and whose body names a different or no command.)

Expected: slots 1 and 2 fill silently from the Triage comment, not the
body; the AskUserQuestion call asks only the batch turn cap (default 15)
and the batch constraint, with a "changes stay within <Scope>" option
next to "None". The statement's issue clause contains
"decided: <Decision>".

### 15. Issue mode, Triage comment with an undecided field

    /mkgoal #<N>

(Pick an issue whose Triage comment reads `Verification: undecided`.)

Expected: the AskUserQuestion call asks for that issue's verification
command specifically (naming the issue number), alongside the batch
questions. `undecided` is never copied into the statement.

### 16. Issue mode ignores a Triage comment from a non-collaborator

(Needs a comment starting with `<!-- triage:v1 -->` posted by an account
whose `authorAssociation` is not `OWNER`/`MEMBER`/`COLLABORATOR`, e.g.
`NONE`, on an issue that has no owner-authored Triage comment.)

Expected: that comment is ignored; slots 1 and 2 come from the issue body
alone (or are asked about), exactly as in test 11/12.

### 17. Issue mode, more than 10 issues

    /mkgoal #<1> ... #<11>

Expected: before any slot question, one AskUserQuestion offers "Split
(Recommended)" and "Keep all 11 in one goal". On Split: the statement
covers the first 10 only, the turn cap default is 150, and `/mkgoal #<11>`
is listed outside the final code block. On Keep all: one statement covers
all eleven, turn cap default 165, still subject to the length check. With
10 or fewer issues, the up-front question is never asked (e.g. 4 issues go
straight to slot filling).

### 19. Issue mode, statement over 4,000 characters

    /mkgoal #<a> ... (up to 10 issues with long titles/commands)

Expected: `wc -m` reports over 4,000; the skill tightens wording and
re-runs `wc -m`. If still over, one AskUserQuestion offers "Split
(Recommended)" (longest leading run that fits, rest as follow-up
`/mkgoal #...` lines) and "Tighten further". No draft with a count over
4,000 is ever presented.

### 18. Issue mode, test-deletion constraint candidate

    /mkgoal #<N>

(Run in a repo with a clear test-file convention, e.g. Go `*_test.go`.)

Expected: the batch constraint question offers "no deleted lines under
<test glob>, shown via `git diff --numstat -- <test glob>` each turn",
with the inferred glob (e.g. `**/*_test.go`) named in the option's
description. Glob is the only tool used to infer it; the candidate is not
adopted unless the user picks it.
