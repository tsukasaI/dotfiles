# /triage test invocations

Manual verification suite for `SKILL.md`. Run each in a fresh session on a
repo whose issues match the setup note, and compare against the expected
behaviour. Re-run after any edit to the skill, and whenever the main-loop
model changes tier. These tests close and comment on real issues; run them
on a scratch repo, not on a backlog you care about.

## Pass criteria common to all tests

- Bash runs only `gh issue list|view|close|comment` and `date +%F`.
  No verification command is ever executed, no file outside the
  scratchpad is written, and no code is edited.
- No issue is closed or commented on before the board is approved, and
  every applied action matches the approved board's row for that issue.
- Multi-line comment bodies go through `--body-file` with a file under the
  scratchpad, never a multi-line `--body`.
- Every `go` issue ends with exactly one comment starting with
  `<!-- triage:v1 -->`, carrying all seven contract fields with no field
  reading `undecided`, and the date taken from `date +%F`.
- The final output lists the `go` issues in work order, one line per
  group, followed by at most one pointer line to `/mkgoal`; the skill
  never runs `/mkgoal` or `/goal`. Every group holds 5–10 issues, except
  when fewer than 5 issues are `go` or a dependency unit alone exceeds 10.

## Tests

### 1. Empty backlog

(Repo with zero open issues.)

Expected: says there is nothing to triage and stops. No AskUserQuestion,
no other Bash after `gh issue list`.

### 2. Duplicate pair

(Two open issues asking for the same change to the same code, worded
differently.)

Expected: the board proposes `merge → #M` for one of them, with #M kept
open. After approval: a `gh issue comment <M> --body-file ...` summarizing
what the duplicate adds, then `gh issue close <N> --duplicate-of <M>`.

### 3. Already-resolved issue

(An open issue whose requested change is already present in the code.)

Expected: the board proposes `close: stale` with `file:line` evidence that
the change exists. After approval: `gh issue close <N> --reason "not
planned" --comment "<evidence>"`. An old issue with no such evidence is
never proposed as stale.

### 4. Design question without explicit options in the body

(A `go`-worthy issue whose body describes a problem but names no approach,
where the code admits two reasonable fixes.)

Expected: Design asks via AskUserQuestion with options that each cite the
body or a `file:line`, the recommended one first and marked
"(Recommended)", plus "Move to schedule" and no "Undecided" option. The
chosen option lands in the Triage comment's `Decision`. Picking "Move to
schedule" posts the `Scheduled` comment instead of a Triage comment, and
the remaining `go` issues are re-packed and shown before Apply.

### 5. Plain bug, no design question

(An issue reporting one bug with one obvious fix.)

Expected: no Design question for it; its Triage comment reads
`Decision: none`.

### 6. Board revision cap

(Any backlog with at least one issue.) Answer every board with a revision
request.

Expected: re-presents the board as "Revision 1 of 3" through
"Revision 3 of 3"; after the third rejection, stops and suggests
re-running `/triage`, with no `gh issue close` or `gh issue comment`
anywhere in the transcript.

### 7. Grouping

Run three backlogs of `go`-worthy issues:

- (a) Seven independent issues.
- (b) Thirteen issues: a chain of four where each depends on the previous
  one, plus nine independent issues.
- (c) Twelve issues forming one dependency chain.

Expected: (a) one group of 7, not seven groups of 1. (b) two groups of
near-equal size (7 + 6 or 6 + 7), the chain of four kept whole inside one
group in dependency order. (c) one group of 12, not split. Hand off lines
match each Triage comment's `Group: G<n> (order <k>)`.

### 8. Fan-out above 5 issues

(Six or more open issues.)

Expected: Analyze launches at most 3 `Agent` calls in one message, each
`subagent_type: Explore` with `model: sonnet`, and the transcript shows one
claim from each report re-checked by the main loop before the board is
shown. With 5 or fewer issues, no Agent call is made.

### 9. Re-triage

Run test 7 (a), then run `/triage` again without changing anything.

Expected: the board marks each previously triaged issue "triaged <date>";
each still-`go` issue gets a fresh Triage comment, and `/mkgoal` (tested in
its own suite) picks the most recent one.

### 10. Follow-up issue with a decision note

(An open issue labeled `needs-decision` whose body starts with
`<!-- decision-note:v1 -->`, filled `Decide` and `Options`, plus an
unlabeled issue of the same age.)

Expected: the board ranks the `needs-decision` issue above the unlabeled
one. If it goes `go`, Design asks its `Decide` line as the question, with
the note's `Options` as the options (the recommended one first), each
citing the note, plus "Move to schedule". The same body without the label
gets no pre-filled question.

### 11. Completion condition not derivable

(A `go`-worthy issue whose body and code suggest no checkable done-state or
command.)

Expected: Design asks for its completion condition and verification
command, with grounded candidates and "Move to schedule". A judgment-word
answer (e.g.「いい感じに動く」) is re-asked once with a concrete candidate.
The Triage comment never reads `undecided`.

### 12. Change-specific constraint

(Two `go`-worthy issues: one whose body says an exported API must stay
unchanged, one plain bug.)

Expected: Design asks a constraint question only for the first, offering
the candidate tied to a command (Recommended) and "None". The plain bug
gets no constraint question and `Constraints: none`. No Triage comment
records "no deleted tests" or "stay within Scope" as a constraint.
