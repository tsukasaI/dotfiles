---
name: triage
description: Organizes the open GitHub issues in the current repo and settles their direction. Reads the code each issue touches (fanning out to sonnet Explore agents when the backlog is large) and proposes one board covering stale issues, duplicates to merge, groups of 5–10 issues sized for one /goal loop each, and work order. The user approves or revises the board in one step, then settles every open technical call (design option, completion condition, verification command, change-specific constraint). Records each "go" issue's decision, completion condition, verification command, scope, and constraints as a structured Triage comment on the issue, so /mkgoal needs no further technical questions. Use when reviewing the backlog or deciding what to build next. Ends with the go issues in work order, one line per group.
disable-model-invocation: true
argument-hint: (none, scans the current repo)
allowed-tools: Bash, Read, Grep, Glob, Write, AskUserQuestion, Agent
---

# /triage: make the backlog ready for /goal, once, for the whole picture

Scan all open issues, check each against the code, propose one board of
actions, get it approved, settle open design questions, record the outcome on
each issue, then stop. This skill never drafts a `/goal` statement, never
runs `/mkgoal` or `/goal`, and never edits code. Match the user's
conversation language in all dialogue.

## Why this exists

An issue is ready to work on when it is still valid, not duplicated, ordered
after what it depends on, has a decided design, and has a checkable
done-state. Deciding that per issue at random moments means duplicates
survive, stale issues get re-implemented, and design calls get made mid-task
by whoever is implementing. This skill makes those calls once, with the code
and the whole backlog in view, and leaves the answers on each issue in
GitHub, where any later step (`/mkgoal`, or a human picking an issue by
hand) can read them. Every technical call is made here, so `/mkgoal` only
assembles; and groups are sized for one long-running `/goal` loop each
(5–10 issues), since a loop for a single issue is rarely worth starting.

## Scan

    gh issue list --state open --json number,title,body,labels,createdAt,url,comments

If this returns zero issues, say so and stop; there is nothing to triage.

An issue that already carries a Triage comment (see Triage comment contract)
is still re-triaged; mark it "triaged <date>" on the board so the user sees
the earlier call, and note anything in the code that changed since.

## Analyze (read-only)

For each issue, read the code it concerns (Read/Grep/Glob) and determine:

- **Status**: still valid / partly resolved / already resolved, with
  `file:line` evidence. "Already resolved" needs evidence in the code, not a
  guess from age.
- **Scope**: the files or directories a fix would touch.
- **Depends on**: other open issues that must land first, or that touch the
  same code.
- **Design questions**: places where more than one reasonable approach
  exists. List the options, each grounded in the issue body or the code
  (cite which), and pick one recommendation with a one-line reason. A plain
  bug with one obvious fix has no design question; do not invent one.
  An issue labeled `needs-decision` whose body starts with
  `<!-- decision-note:v1 -->` (contract in the `review-gate` skill)
  already states its question: take `Decide` as the design question and
  `Options` as its options and recommendation, citing the note as their
  grounding, then check them against the current code like any other. The
  label is the trust signal, since only collaborators can apply labels.
- **Completion condition and verification command candidates**: an objective
  done-state and the command that would show it (`go test ./...`, a
  lefthook job, a `shguard` payload check). If the command references a repo
  script, target, or path, confirm it exists with Grep/Glob. Never execute
  it. If no checkable candidate exists, mark it missing; Design will ask.
- **Constraint candidates**: something that must not change for this issue
  specifically, with the command whose output would show a violation
  (e.g. "exported signatures in `pkg/api` unchanged, shown via `git diff
  -- pkg/api`"). Only what the issue body or code makes specific to this
  change; never the standard constraints `/mkgoal` applies to every goal
  (no deleted test lines, changes stay within Scope). Most issues have
  none; do not invent one.

**Fan-out**: with more than 5 open issues, split them across up to 3
`Agent` calls (`subagent_type: Explore`, `model: sonnet`), launched in one
message. Give each agent its issues' number, title, and body, and ask it to
return exactly the six fields above per issue, with `file:line` evidence.
Before using any agent's report, verify one load-bearing claim from it
yourself (e.g. re-read the `file:line` it cites for an "already resolved"
verdict).

Duplicate and overlap detection runs in the main loop over all results
together: two issues are duplicates when they ask for the same change to the
same code, not merely when they share a file.

*Done:* every open issue has all six fields, and every agent report had one
claim verified.

## Board

Present one markdown table, one row per issue:

| # | Proposed action | Reason / evidence | Group (order) |
|---|---|---|---|

Proposed action is exactly one of:

- `go`: work on it now
- `schedule`: keep it open, revisit later
- `close: stale`: already resolved; the evidence column cites `file:line`
- `merge → #M`: duplicate; #M is the canonical issue that stays open

Ordering: start from the label heuristic (a `priority:*`, `bug`, or
`needs-decision` label outranks unlabeled or `enhancement`-only; within the
same rank, older `createdAt` first), then adjust so every issue comes after
the issues it depends on. `needs-decision` ranks with `bug` because those
issues are follow-ups a `/goal` run left waiting on the user.

Grouping (for `go` issues only), one group per `/goal` loop:

1. Units: issues that depend on each other or touch the same code form one
   unit, in dependency order. A unit is never split across groups.
2. Packing: with T `go` issues, make ceil(T / 10) groups of near-equal
   size (13 → 7 + 6, 21 → 7 + 7 + 7), filling them with whole units in
   work order, so every group holds 5–10 issues. When whole units make an
   exact split impossible, stay as close to equal as they allow.
3. With T < 5, all `go` issues form G1. A unit larger than 10 forms its own
   group; `/mkgoal` asks about splitting it.

Name groups `G1`, `G2`, ... in work order.

Below the table, list each `go` issue's open questions for Design (design
question, missing completion condition or verification, constraint
candidate) in one line each, so the user sees what Design will ask.

Ask for approval with a single `AskUserQuestion` question: approve this
board as-is, or revise it (revisions come through the built-in "Other"
option). On a revision, apply it and re-present the full board, prefixed
"Revision 1 of 3" / "Revision 2 of 3" / "Revision 3 of 3". If the user
rejects the third revision, stop without applying anything and suggest
re-running `/triage`.

*Done:* the user approved one version of the board.

## Design

Every technical call is settled here; `/mkgoal` asks none in the normal
path. For each `go` issue, ask via `AskUserQuestion` (up to 4 questions per
call; run it back to back until every question has an answer):

- **Design question**: the options from Analyze, the recommended one first
  and marked "(Recommended)", each option's grounding (issue body or
  `file:line`) in its description.
- **Completion condition / verification command**, when Analyze found no
  checkable candidate: offer the closest objective candidates (grounded the
  same way); a free-form answer comes through "Other". The answer must pass
  `/mkgoal`'s objectivity gate (a yes/no from command output, no judgment
  words); re-ask once with a concrete candidate if it does not.
- **Constraint**, only when Analyze found a candidate: the candidate
  (Recommended) and "None".

The design and completion/verification questions also offer "Move to
schedule": a `go` issue must leave Design fully decided, so an issue the
user cannot decide yet becomes `schedule`. Picking it is the user's
authorization to apply `schedule` to that issue instead of `go`; re-pack
the remaining `go` issues by the Grouping rules and show the new group
lines before Apply.

This step runs only for `go` issues; never for `schedule`, `close`, or
`merge` ones.

*Done:* every question has an answer, and every remaining `go` issue has a
decided Decision, completion condition, verification command, and
constraints.

## Apply

The approved board is the user's explicit authorization for the action
listed on each issue, scoped to that issue and that action only. Apply each:

- **close: stale**: `gh issue close <N> --reason "not planned" --comment "<evidence, one line>"`
- **merge → #M**: first `gh issue comment <M> --body-file <file>` (what #N adds that #M lacks, or "nothing beyond #M"),
  then `gh issue close <N> --duplicate-of <M>`
- **schedule**: `gh issue comment <N> --body "Scheduled: revisit later."`
- **go**: post one Triage comment (contract below) with
  `gh issue comment <N> --body-file <file>`

Any comment body that spans more than one line (every Triage comment, and
most merge summaries) goes through `--body-file`: write it with Write to a
file under the session's scratchpad directory first. A newline inside a
`--body` argument makes `gh` run inside the Bash sandbox, where it cannot
read its keychain token.

Get the date for the Triage comment with `date +%F` at the moment of
writing; never write it from memory.

*Done:* every row of the approved board has its action applied.

## Triage comment contract

`/mkgoal` parses this exact shape; keep the marker and field names
verbatim:

    <!-- triage:v1 -->
    ## Triage YYYY-MM-DD
    - Group: G<n> (order <k>)
    - Decision: <chosen option, one line | none>
    - Completion condition: <objective done-state>
    - Verification: `<command>`
    - Scope: <files or directories the fix touches>
    - Constraints: <change-specific constraint, with the command that shows it | none>
    - Depends on: #<N>, ... | none

"none" under Decision means the issue posed no design question. A `go`
issue never carries `undecided`; comments from before this rule may, and
`/mkgoal` treats such a field as missing.

## Hand off

If no issue ended up `go`, say so and stop.

Otherwise list the `go` issues in work order, one line per group:

    G1: #<N1> → #<N2> → ... (<n> issues; dependency units in brackets, e.g. [#<N1> → #<N2>])
    G2: #<N3> → ...

Then add one closing line naming the usual next step (e.g. "`/mkgoal #<N1>
#<N2> ...` turns G1 into a /goal statement"); it is a pointer, not the
skill's output. Do not draft a goal statement.

## Red flags

| Rationalization | Reality |
|---|---|
| "古そうだから stale で閉じよう" | stale にするのはコードに解決済みの根拠 (`file:line`) がある時だけ。古さは根拠にならない。 |
| "同じファイルを触るから重複だ" | 重複は同じコードへの同じ変更を求めている時だけ。ファイルが重なるだけなら同じグループにまとめる。 |
| "独立した issue は1件ずつ別グループにしよう" | 1 issue の /goal はほぼ使わない。独立していても作業順に詰めて 5〜10 件のグループにする。依存単位だけは割らない。 |
| "決めきれないから undecided で go にしておこう" | go は全部決まった状態で出す。決められないなら「Move to schedule」。/mkgoal に技術判断を残さない。 |
| "制約を書いておいた方が安全だ" | テスト削除禁止と Scope 外禁止は /mkgoal が毎回自動で入れる。Constraints にはその変更だけに効くものを、本文かコードに根拠がある時だけ書く。 |
| "選択肢を増やした方が親切だ" | 選択肢はすべて本文かコードに根拠を持つこと。根拠のない選択肢は作らない。 |
| "盤面が承認されたから設計判断も推奨で埋めておこう" | 盤面の承認はアクションへの許可だけ。設計判断は Design で個別に聞き、答えを待つ。 |

## Hard limits

- Never run `/mkgoal` or `/goal` and never invoke another skill. Write is
  limited to comment-body files under the scratchpad directory; never edit
  or write any other file.
- Agent use is limited to `subagent_type: Explore` with `model: sonnet`, at
  most 3 per run, for Analyze only.
- Bash is scoped to `gh issue list`, `gh issue view`, `gh issue close`,
  `gh issue comment`, and `date +%F`. Never `gh issue edit` or
  `gh issue delete`, never touch already-closed issues, never any other
  command.
- Never close or comment on an issue unless the approved board lists that
  action for that issue.
- Never record a Decision, completion condition, verification command, or
  constraint the user did not pick or accept in Design (a candidate
  Analyze found unambiguously in the issue body or code is recorded without
  asking only for completion condition and verification).
- Never execute a verification command; only confirm the script or path
  it names exists.
