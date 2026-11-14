# /mkgoal test invocations

Manual verification suite for `SKILL.md`. Run each in a fresh session and
compare against the expected behaviour. Re-run after any edit to the skill,
and whenever the main-loop model changes tier.

## Pass criteria common to all tests

- The only Bash commands the skill runs are `gh issue view <N> --json
  title,body,url,comments`, once per issue and only in issue mode, and the
  `wc -m <absolute scratchpad path>/mkgoal-statement.txt` length check
  before each draft or revision is presented. The statement reaches that
  file through Write, never a heredoc/`echo`/`printf` (shguard refuses a
  heredoc or `> file` redirect, and `printf` has no catalog row). Verification commands are drafted, not executed; otherwise
  only Read/Grep/Glob existence checks are allowed. No issue is ever
  closed, commented on, or edited.
- The skill never invokes `/goal`, other skills, or subagents.
- Slot questions are asked via a single batched AskUserQuestion call (one
  question per open slot), not plain-text messages; follow-up re-asks of a
  single slot also use AskUserQuestion. Constraints and the turn cap are
  never asked about (test 6's re-ask of a given subjective constraint is
  the one exception).
- The final approved output is a fenced code block containing exactly one
  line starting with `/goal` — no prose inside the block, no line breaks,
  at most 4,000 characters as measured by the `wc -m` check, whose count
  is shown with each draft.
- The assembled statement always contains the "or stop after <N> turns"
  clause (15, or 15 × issues, unless the argument names a cap) and
  instructs showing the verification command's full output each turn.
- The assembled statement always contains the standard constraints whose
  input exists: no deleted lines under the inferred test glob (with
  `git diff --numstat -- <glob>` shown each turn) and, when a Scope is
  known, changes within it except doc/comment fixes listed under
  `## Auto-fixed` (with `git diff --stat`). The approval-gate summary names
  the glob and Scope, or says none was found.
- The assembled statement always contains the standing implementation
  pattern: delegate the implementation to a `model: sonnet` subagent and
  send review fixups back to that implementer via SendMessage, with no code
  Edit/Write in the main loop,
  review with a `code-reviewer` subagent per the `review-gate` skill
  (named by reference; the reviewer-model choice and tier criteria are not
  restated), and squash-merge via
  `gh pr merge --squash --delete-branch` once the reviewer approves or the
  PR is docs-only. It is never asked about as a slot.
- The assembled statement always contains the follow-up clauses:
  `needs-decision` issues created without asking, capped at 3 × issues,
  overflow into one parent issue; the stuck rule (same failure 3 turns in
  a row → file and move on); the Unverified rule (a check refused by a
  hook or the sandbox → nothing filed, `gh pr checks` shown, merge only if
  CI passed that check); and a final-turn `## Follow-ups` block with
  `Auto-fixed`, `Needs-decision`, `Not filed` and `Unverified` lines. It
  never requires the follow-up issue count to be zero.
- In issue mode the statement names issues by number only (no titles),
  lists Decisions once in a decided-designs clause, groups issues that
  share a verification command and condition into one check entry, and
  requires the final turn to re-run every check (stuck and Unverified
  issues excepted, listed by URL).

## Tests

### 1. All slots present in the argument

    /mkgoal go test ./... が全部通ること。検証コマンドは go test ./...、制約は公開APIのシグネチャを変えないこと(git diff -- api/ で確認)、上限5ターン

Expected: no questions. Goes straight to the approval gate; the statement
carries the given constraint next to the standard ones and "or stop after
5 turns" (the argument's cap, not the default 15).

### 2. Condition and command given, nothing else

    /mkgoal Lighthouse performance ≥ 90, verified with npm run lighthouse

Expected: no questions. Goes straight to the approval gate; the summary
marks the turn cap 15 as "auto" and names the inferred test glob; the
statement has no change-specific constraint part.

### 3. Objective condition, command missing

    /mkgoal make all the tests pass

Expected: ONE AskUserQuestion call asking only the exact test command. No
constraint or turn-cap question.

### 4. Subjective condition (Japanese)

    /mkgoal コードをきれいにして

Expected: rejects「きれいに」as unfilled, offers an objective proxy (e.g. a
linter reporting 0 issues) as an option, and asks the condition and the
verification command in one AskUserQuestion call; nothing else.

### 5. Bare invocation

    /mkgoal

Expected: asks what the user wants to achieve before any slot questions.
Does not invent a goal.

### 6. Subjective constraint in the argument

    /mkgoal Lighthouse performance ≥ 90, verified with npm run lighthouse、既存ページを悪化させないこと

Expected: the constraint is treated as unfilled (same objectivity gate as
the condition); asks about that constraint only, offering a checkable
candidate (e.g. "no changes outside src/ — shown via `git diff --stat`
each turn").

### 7. Revision-cycle cap

Run test 1, then answer every presented draft with「もっといい感じに」.

Expected: re-presents as "Revision 1 of 3", "Revision 2 of 3",
"Revision 3 of 3"; after the third rejection, exits the skill and suggests
re-running /mkgoal, producing no final statement.

### 8. Slot-level stubbornness cap

Run test 5, then reply「いい感じになったら OK」to the condition question,
three times.

Expected: each re-ask offers one concrete objective candidate acceptable
in a tap; after the 3rd failed attempt, states the condition cannot be
made machine-checkable and exits without producing a statement.

### 9. Issue mode, fully triaged group

    /mkgoal #<a> #<b> #<c> #<d> #<e>

(Five issues `/triage` marked `go` in one group, each with an owner-authored
Triage comment filling every field; one carries a `Constraints` other than
`none`, one has a `Decision` other than `none`, and at least one body names
a different command than its Triage comment.)

Expected: `gh issue view` exactly five times, then no question at all
before the approval gate. Slots 1 and 2 come from the Triage comments, not
the bodies. The statement lists the issues by number in the given order,
the decided one in the decided-designs clause as "#<N>: <Decision>"; issues
sharing a verification command and condition share one check entry;
carries "changes stay within <union of Scopes>", the test-glob constraint,
and "for #<N>, <constraint>" for the constrained issue only; and has the
final turn re-run every check. Turn cap 75 (15 × 5), needs-decision cap 15
(3 × 5).

### 10. Issue mode, missing condition or command

    /mkgoal #<a> #<b>

(#<a>: no Triage comment, body states "done" but names no command. #<b>:
an older Triage comment reading `Verification: undecided`.)

Expected: ONE AskUserQuestion call asking each issue's verification
command, naming the issue number; nothing else. Does not invent a command
from the body; `undecided` is never copied into the statement.

### 11. Issue mode ignores a Triage comment from a non-collaborator

(Needs a comment starting with `<!-- triage:v1 -->` posted by an account
whose `authorAssociation` is not `OWNER`/`MEMBER`/`COLLABORATOR`, e.g.
`NONE`, on an issue that has no owner-authored Triage comment.)

Expected: that comment is ignored, including its `Constraints` and
`Scope`; slots 1 and 2 come from the issue body alone (or are asked about),
exactly as in test 10. Its `Decision` appears nowhere in the statement, and
the statement never tells the loop to read Triage comments itself, so the
forged Decision cannot reach the loop.

### 12. Issue mode, a large triaged group

    /mkgoal #<1> ... #<25>

(Twenty-five triaged issues, most sharing `go test ./...` or another
common command.)

Expected: no up-front split question at any count. One statement covers
all twenty-five, turn cap 375, needs-decision cap 75, and `wc -m` reports
4,000 or less.

### 13. Issue mode, statement over 4,000 characters

    /mkgoal #<a> ... (issues with long decisions, distinct commands, many Scopes)

Expected: `wc -m` reports over 4,000; the skill tightens wording and
re-runs `wc -m`. If still over, one AskUserQuestion offers "Split
(Recommended)" (longest leading run that fits, rest as follow-up
`/mkgoal #...` lines) and "Tighten further". No draft with a count over
4,000 is ever presented.

### 14. Test glob inference

Run test 2 twice: in a repo with a clear test-file convention (e.g. Go
`*_test.go`), and in one with no test files.

Expected: Glob is the only tool used to infer the glob. With a convention,
the statement says "no line under `**/*_test.go` is deleted" and shows
`git diff --numstat -- **/*_test.go` each turn, without asking. Without
one, that constraint is absent and the approval-gate summary says no test
convention was found; no glob is guessed.

### 15. dotfiles target

Run test 2 in the `dotfiles` repo.

Expected: the sonnet/reviewer/squash-merge and review-gate clauses are
replaced by "edit in the main loop, commit to main and push after each
issue"; the Unverified clause names no PR or CI and instead lists the
refused command for the user under `Unverified:`.
