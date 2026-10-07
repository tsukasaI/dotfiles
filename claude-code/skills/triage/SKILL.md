---
name: triage
description: Organizes the open GitHub issues in the current repo and settles their direction. Reads the code each issue touches (fanning out to sonnet Explore agents when the backlog is large) and proposes one board covering stale issues, duplicates to merge, dependency groups, and work order. The user approves or revises the board in one step, then picks an option for every open design question. Records each "go" issue's decision, completion condition, verification command, and scope as a structured Triage comment on the issue. Use when reviewing the backlog or deciding what to build next. Ends with the go issues in work order, grouped by dependency.
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
hand) can read them. Sizing work into `/goal` loops is not this skill's
concern; `/mkgoal` owns that.

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
- **Completion condition and verification command candidates**: an objective
  done-state and the command that would show it (`go test ./...`, a
  lefthook job, a `shguard` payload check). If the command references a repo
  script, target, or path, confirm it exists with Grep/Glob. Never execute
  it. If no checkable candidate exists, leave it "undecided"; `/mkgoal` will
  ask.

**Fan-out**: with more than 5 open issues, split them across up to 3
`Agent` calls (`subagent_type: Explore`, `model: sonnet`), launched in one
message. Give each agent its issues' number, title, and body, and ask it to
return exactly the five fields above per issue, with `file:line` evidence.
Before using any agent's report, verify one load-bearing claim from it
yourself (e.g. re-read the `file:line` it cites for an "already resolved"
verdict).

Duplicate and overlap detection runs in the main loop over all results
together: two issues are duplicates when they ask for the same change to the
same code, not merely when they share a file.

*Done:* every open issue has all five fields, and every agent report had one
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

Ordering: start from the label heuristic (a `priority:*` or `bug` label
outranks unlabeled or `enhancement`-only; within the same rank, older
`createdAt` first), then adjust so every issue comes after the issues it
depends on.

Grouping (for `go` issues only): issues that depend on each other or touch
the same code go in the same group, in dependency order, so they are worked
on together. Independent issues each get their own group. Groups have no
size cap here; how many issues one `/goal` loop takes is `/mkgoal`'s call.
Name groups `G1`, `G2`, ... in work order.

Below the table, list each `go` issue's design questions (if any) in one
line each, so the user sees what Design will ask.

Ask for approval with a single `AskUserQuestion` question: approve this
board as-is, or revise it (revisions come through the built-in "Other"
option). On a revision, apply it and re-present the full board, prefixed
"Revision 1 of 3" / "Revision 2 of 3" / "Revision 3 of 3". If the user
rejects the third revision, stop without applying anything and suggest
re-running `/triage`.

*Done:* the user approved one version of the board.

## Design

For every `go` issue with a design question, ask the user to pick an option
via `AskUserQuestion` (up to 4 questions per call; run it back to back until
every question has an answer). Use the options from Analyze, mark the
recommended one "(Recommended)" and put it first, and state each option's
grounding (issue body or `file:line`) in its description. Always include
an "Undecided, leave it to /mkgoal or implementation time" option.

This step runs only for `go` issues; never for `schedule`, `close`, or
`merge` ones.

*Done:* every design question has an answer, "Undecided" included.

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
    - Decision: <chosen option, one line | undecided | none>
    - Completion condition: <objective done-state | undecided>
    - Verification: `<command>` | undecided
    - Scope: <files or directories the fix touches>
    - Depends on: #<N>, ... | none

"none" under Decision means the issue posed no design question;
"undecided" means it did and the user deferred it.

## Hand off

If no issue ended up `go`, say so and stop.

Otherwise list the `go` issues in work order, one line per group:

    G1: #<N1> → #<N2>  (<one-line reason they belong together>)
    G2: #<N3>

Mark any issue whose Triage comment carries an `undecided` field, so the
user knows what is still open. Then add one closing line naming the usual
next step (e.g. "`/mkgoal #<N1> #<N2>` turns G1 into a /goal statement");
it is a pointer, not the skill's output. Do not draft a goal statement or
decide how many issues one `/goal` takes; that is `/mkgoal`'s job.

## Red flags

| Rationalization | Reality |
|---|---|
| "古そうだから stale で閉じよう" | stale にするのはコードに解決済みの根拠 (`file:line`) がある時だけ。古さは根拠にならない。 |
| "同じファイルを触るから重複だ" | 重複は同じコードへの同じ変更を求めている時だけ。ファイルが重なるだけなら同じグループにまとめる。 |
| "/goal に収まるようにグループを分割しておこう" | goal の大きさは /mkgoal が決める。triage は依存とコードの重なりだけでグループを作る。 |
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
- Never record a Decision the user did not pick in Design; "Undecided" is
  a valid answer and is recorded as `undecided`.
- Never execute a verification command; only confirm the script or path
  it names exists.
