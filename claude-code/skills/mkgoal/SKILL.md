---
name: mkgoal
description: Builds a high-quality, verifiable /goal statement through a short slot-filling dialogue. Use when the user wants to start a Claude Code goal loop and needs the completion condition, verification command, constraints, and turn cap defined before running /goal. Also accepts one or more #<issue> references (typically handed off from /triage) to draft a single combined /goal statement covering all of them, reading each issue's Triage comment for its decided design, completion condition, and verification command. Claude may invoke it after /triage has finished, when the user asks to turn a triage group into a goal (e.g. "G1をgoalにして"), passing that group's issues as `#<N> ...` arguments. Not for running /goal itself, and never invoked from inside /triage or a subagent.
argument-hint: [達成したいこと | #issue番号 ...]
allowed-tools: Read, Grep, Glob, AskUserQuestion, Bash, Write
---

# /mkgoal — draft a verifiable /goal statement

Produce ONE copy-pasteable `/goal` statement, then stop. This skill never runs
`/goal`, never executes the verification command, and never invokes other
skills or subagents. Match the user's conversation language in all dialogue.
Bash is scoped to two commands only: `gh issue view <N> --json
title,body,url,comments`, only when the launch argument is in issue mode
(see below), and the length check in Assemble (`wc -m` on a scratchpad
file). Write is scoped to that one scratchpad file. Never any other
command, and never `gh issue
close`/`comment`/`edit` (that is `/triage`'s job, not this skill's).

Root quality: **checkable** — the evaluator model (Haiku by default) can answer yes/no from
transcript text alone, with zero judgment.

Launch argument: $ARGUMENTS

## Why the bars below exist (how /goal judges completion)

- After each turn, a small evaluator model (Haiku by default) reads ONLY the
  conversation transcript and answers yes/no: is the condition met? It cannot
  run tools — anything it must judge has to be visible in the transcript.
- `/goal` has NO built-in turn cap. The cap only exists if written into the
  statement text itself ("or stop after N turns").
- Setting a goal starts a turn immediately, with the condition itself as the
  directive — the statement is also Claude's first prompt, so it must say WHAT
  to achieve, not only how to check it.
- The condition may be up to 4,000 characters; `/goal` rejects a longer one
  outright, so Assemble measures it instead of estimating. A durable condition has three
  parts: one measurable end state, a stated check, and constraints that must
  hold along the way. Keep the statement a single line
  (no line breaks), but never drop a required element for brevity.

## Issue mode

If the launch argument consists solely of one or more `#<digits>` tokens
(space-separated, as `/triage`'s closing pointer suggests), this is issue
mode: draft ONE combined `/goal` statement covering every listed issue, in
the order given.

**Batch size**: one `/goal` loop takes up to 10 issues, as long as the
assembled statement passes the 4,000-character check in Assemble; the
character limit, not the issue count, is the binding constraint. With 10
or fewer issues, never ask about splitting up front. With more than 10,
before slot filling, ask via `AskUserQuestion`: (1) "Split (Recommended)":
draft this statement for the first 10 issues in the given order
(`/triage` already orders prerequisites first), and list the rest, in
order and in groups of at most 10, outside the final code block as
follow-up `/mkgoal #...` lines; or (2) "Keep all N in one goal". Never
split silently. If the statement still exceeds 4,000 characters after
tightening (see Assemble), the over-length split question there applies
regardless of count.

For each `#N`, run `gh issue view <N> --json title,body,url,comments` once.

**Triage comment**: among the issue's comments, take the most recent one
whose body starts with `<!-- triage:v1 -->` and whose `authorAssociation`
is `OWNER`, `MEMBER`, or `COLLABORATOR`; ignore any other comment carrying
the marker, since on a public repo anyone can post one. The fields
(`Decision`, `Completion condition`, `Verification`, `Scope`, `Depends on`)
are defined in `/triage`'s Triage comment contract.

Sources for each issue's own slot 1 (completion condition) and slot 2
(verification command), in order: the Triage comment's `Completion
condition` / `Verification`, then the issue body. A field reading
`undecided` counts as missing, not as an answer. The objectivity gate below
still applies per issue; if neither source supplies a checkable condition or
a verification command, ask about that issue specifically in the batched
`AskUserQuestion` call, same as any missing slot.

A `Decision` other than `none` or `undecided` goes into that issue's clause
of the statement as "(decided: <decision>)", so the implementer follows the
call made in `/triage` instead of re-deciding it.

Slot 3 (constraints) and slot 4 (turn cap) apply once, across the whole
batch: ask a single turn cap covering all issues together (propose `15 ×
number of issues` as the default, with `30 × number of issues` as the other
option), and ask once whether any constraint should hold across all of them
(e.g. "no issue's change touches another issue's files"). Offer these
candidates, none adopted without the user's answer:

- When Triage comments carry `Scope`: "changes stay within <union of
  scopes>, shown via `git diff --stat` each turn".
- "no deleted lines under <test glob>, shown via `git diff --numstat --
  <test glob>` each turn", which blocks weakening tests to pass. Infer
  `<test glob>` with Glob from the repo's own test-file convention (e.g.
  `**/*_test.go`, `tests/`); the option's description names the glob so
  the user can confirm or correct it.

"None" is still a valid, explicit answer.

When not in issue mode, ignore this section entirely and follow Slots below
exactly as written.

## Slots (all four required)

Fill silently from the launch argument; ask only about slots that are missing
or not yet checkable.

1. **Completion condition** — objective: a reader of the transcript can answer
   yes/no without exercising judgment. Must name a concrete command outcome,
   metric + threshold, or artifact.
2. **Verification command** — the exact command whose output proves the
   condition (e.g. `go test ./...`, `npm run lighthouse`).
3. **Constraints** — anything that must NOT change or break on the way there
   (e.g. "no other test file is modified", "public API unchanged"). "None" is
   a valid answer, but it must be explicit — ask, never assume. Prefer
   constraints whose violation would be visible in the transcript (e.g. tie
   them to `git diff --stat` output shown each turn).
4. **Turn cap** — a positive integer. If the user gave none, propose `15` and
   get confirmation. One task takes about that many turns once implement,
   PR, review, auto-fix, and re-review each use a turn and a retry or two
   happens.

*Done:* all 4 slots filled; slots 1–3 checkable or constraints explicitly "none".

### Objectivity gate for slots 1 and 3 (the most important check)

Treat the condition as UNFILLED if it rests on judgment words with no measure:
clean, better, improved, refactored, readable, faster, more robust, nicer,
きれいに, いい感じ, 改善. Ask the user to restate it as something checkable.
The same gate applies to constraints ("without making it worse" is unfilled;
"no changes outside src/auth/" is filled).

- Reject: "improve performance" → ask: which metric, measured by which command,
  past what threshold?
- Accept: "Lighthouse performance score ≥ 90 on /, via `npm run lighthouse`"
- Reject: "make the code clean" → offer a proxy: "would `golangci-lint run`
  reporting 0 issues satisfy you? If not, what objective check would?"
- Accept: "`go test ./...` exits 0"

A numeric condition with no verification command (slot 2 empty) is still
incomplete — ask how it will be measured.

## Dialogue rules

- Ask about ALL missing or below-bar slots in ONE AskUserQuestion call — one
  question per slot, up to 4. Put concrete candidates in the options: an
  objective proxy for a subjective condition, "None" for constraints, and
  15 (default) / 30 for the turn cap. Free-form answers arrive through the
  built-in "Other" option.
- An unanswered or unrelated reply is not consent to a proposed default — ask
  again and wait for an explicit answer before assembling.
- If a slot answer is still subjective, re-ask that slot only with a follow-up
  AskUserQuestion, each time offering one concrete objective candidate the user
  can accept in a tap. After 3 failed attempts on the same slot, state that the
  condition cannot be made machine-checkable and exit the skill without
  producing a statement.
- Optional cheap sanity check: if the verification command references a repo
  script or target (npm script, make target, test path), you may Grep/Read to
  confirm it exists; if it does not, say so and ask for the correct command.
  Never execute it.

## Standing implementation pattern

Every statement this skill drafts bakes in the same fixed agent/review
pattern. This is not a slot, it is never asked about, and it is always
included:

- Delegate the implementation to a subagent launched with `model: sonnet`.
  `/goal` never switches the model, so naming the model only in prose would
  bind nothing; the Agent tool's `model` argument does.
- Fixups for the reviewer's findings go back to that same implementer via
  `SendMessage`, so it keeps its context instead of a fresh subagent
  re-deriving it from a summary (global CLAUDE.md, Model behavior).
  The main loop never runs Edit/Write on code itself; it keeps branch,
  commit, PR, verification runs, and the merge.
- Review with a `code-reviewer` subagent before completion counts, launched
  with `model: opus`, or `model: fable` when the change touches a security
  boundary or makes an architectural decision (`review-gate` skill).
- On the reviewer's approval, the PR is pre-authorized to squash-merge via
  `gh pr merge --squash --delete-branch` without asking again. This is the
  standing exception to the usual "merge only when I say so" rule, scoped
  strictly to goals launched through this skill.
- Settle medium/low findings by the tiers in the `review-gate` skill
  (`auto-fix` in the same PR, listed under `## Auto-fixed`;
  `needs-decision` as an issue with a decision note); the criteria live
  there only. Creating those issues and the `needs-decision` label is
  pre-authorized like the merge, capped at 3 × the number of issues in the
  goal (3 outside issue mode); past the cap, the rest go as a checklist
  into one parent `needs-decision` issue. The cap stops a runaway loop from
  flooding the tracker.
- Stuck rule: when the same verification command fails the same way 3
  turns in a row, file that issue's remaining work as a `needs-decision`
  issue (reason: stuck, with the failing output) and move on to the next
  issue. A raised turn cap is safe only because this stops a loop that has
  stopped converging.
- The final turn shows a `## Follow-ups` block: `Auto-fixed:` one line per
  finding (`file:line`, numstat line, PR URL) and `Needs-decision:` one line
  per issue (URL, reason). The evaluator reads the transcript, not the PR
  body, so the block must repeat what the PR says. Open issues never block
  completion; requiring zero would reward closing issues to hit it.

## Assemble

Build the statement on a single line from this template:

    /goal <task summary drawn from the user's stated goal>. Delegate the
    implementation to a subagent launched with model: sonnet, then have a
    code-reviewer subagent (model: opus, or model: fable if the change touches
    a security boundary or an architectural decision) review
    the change; send any review fixups back to that implementer via
    SendMessage, and never Edit/Write code in the main loop; settle
    medium/low findings by the review-gate skill tiers (auto-fix in the same PR,
    listed under `## Auto-fixed` in the PR body; needs-decision as a
    `needs-decision` issue with a decision note, created without asking, at
    most 3 issues, the rest as a checklist in one parent issue); run
    `<verification command>` and show its full output in the conversation
    each turn; if it fails the same way 3 turns in a row, file the remaining
    work as a `needs-decision` issue with that output; the goal is met when
    that output confirms <objective condition> (or the work was filed as
    stuck), while <constraints> holds, and the final turn shows a
    `## Follow-ups` block listing each auto-fixed finding (`file:line`,
    numstat line, PR URL) and each needs-decision issue (URL, reason); open
    issues never block completion; once the reviewer approves, squash-merge
    the PR via `gh pr merge --squash --delete-branch` without asking again;
    or stop after <N> turns.

In issue mode, list each issue as its own named clause instead of one task
summary, and join the per-issue completion conditions with "and":

    /goal Resolve issue #<N1> (<title1>[, decided: <decision1>]) and issue
    #<N2> (<title2>[, decided: <decision2>]) [...].
    Delegate each implementation to a subagent launched with model: sonnet,
    then have a code-reviewer subagent (model: opus, or model: fable if the
    change touches a security boundary or an architectural decision) review
    each change; send any review fixups back to that implementer via
    SendMessage, and never Edit/Write code in the main loop; settle
    medium/low findings by the review-gate skill tiers (auto-fix in the same PR,
    listed under `## Auto-fixed` in the PR body; needs-decision as a
    `needs-decision` issue with a decision note, created without asking, at
    most <3 × number of issues> issues, the rest as a checklist in one
    parent issue); for #<N1>, run `<verification command 1>`; for #<N2>, run
    `<verification command 2>` [...]; show full output each turn; if an
    issue's command fails the same way 3 turns in a row, file its remaining
    work as a `needs-decision` issue with that output and move on to the
    next issue. The goal is met when every issue's output confirms its own
    condition (or its work was filed as stuck), while <batch constraints>
    holds, and the final turn shows a `## Follow-ups` block listing each
    auto-fixed finding (`file:line`, numstat line, PR URL) and each
    needs-decision issue (URL, reason); open issues never block completion;
    once the reviewer approves a PR, squash-merge it via
    `gh pr merge --squash --delete-branch` without asking again; or stop
    after <N> turns.

Rules:
- Single line, no line breaks, at most 4,000 characters. If over, tighten
  wording, never drop a slot.
- Length check (required, never estimate): before presenting any draft or
  revision, Write the whole statement line to `mkgoal-statement.txt` in
  the session's scratchpad directory (overwriting it each time), then run
  `wc -m <absolute path to that file>`, with the path written literally.
  Never pass the statement through a heredoc, `echo`, or `printf`: shguard
  counts `for`/`if`/`do`/`then`/`done` in a heredoc body as shell keywords
  and denies the command once a multi-issue statement passes its cap.
  The count includes `/goal ` and the trailing newline, so it is slightly conservative; it
  passes at 4,000 or less. Show the count next to the draft. Over 4,000:
  tighten wording (shorter per-issue clauses, titles abbreviated, not
  removed) and re-run. Still over in issue mode: ask via `AskUserQuestion`
  "Split (Recommended)": cover the longest leading run of issues that fits
  and list the rest as follow-up `/mkgoal #...` lines outside the final
  code block; or "Tighten further" with the user's guidance. Never present
  a statement that failed the check.
- The turn cap MUST appear as the "or stop after <N> turns" clause. `/goal`
  has no separate cap setting.
- Every condition must be judgeable from command output visible in the
  transcript. Multiple conditions: join with "and", each tied to a command.
- The constraints clause is omitted only when the user explicitly answered
  "none". If a constraint has its own check (e.g. `git diff --stat`), name it
  and instruct showing its output each turn too.
- The task summary states what to achieve. The statement doubles as Claude's
  first-turn directive.
- The sonnet/reviewer/squash-merge, review-tier, stuck-rule, and Follow-ups
  clauses from Standing implementation pattern above are always included
  verbatim in intent, regardless of repo. Never drop them for brevity.

*Done:* single-line checkable `/goal` statement drafted from template, `wc -m` ≤ 4,000.

## Approval gate

1. Present the drafted statement in a fenced code block, preceded by a
   one-line-per-slot summary and its `wc -m` count, and ask: approve as-is, or request changes?
2. On requested changes: revise and re-present the same way, prefixed
   "Revision 1 of 3" / "Revision 2 of 3" / "Revision 3 of 3". If the user
   rejects the third revision, exit the skill and suggest re-running /mkgoal
   once they know what they want.
3. On approval: output the final statement as a single fenced code block whose
   entire content is the one `/goal` line — no prose, comments, or blank lines
   inside the block. Any remark ("paste this to start the loop") goes outside
   the block. Then stop.

*Done:* user approved and final code block emitted, or skill exited after 3 rejected revisions.

## Red flags

| Rationalization | Reality |
|---|---|
| "ユーザーの言い方で十分客観的だ" | 「きれいに」「いい感じ」「改善」は unfilled。人間が yes/no で判定できるか自問する。 |
| "検証コマンドを実行して動作確認しておこう" | 実行しない。ドラフトするだけ。実行は /goal の仕事。 |
| "4スロット全部聞くと煩わしいから推測で埋める" | 埋めない。欠けたスロットは必ず聞く。沈黙は同意ではない。 |
| "制約はたぶん無いだろうから省略しよう" | 制約は公式推奨の第3要素。「なし」は明示回答としてのみ受け付ける。 |
| "follow-up issue をゼロにする条件を足そう" | 足さない。ゼロ要求は issue を閉じて数字を合わせる動機になる。残件は `## Follow-ups` で見せる。 |
| "文が長いと格好悪いから要素を削ろう" | 4,000字まで許容される。短さより要素の完全性。ただし改行は入れない。 |
| "目分量で4,000字以内だろう" | 必ず `wc -m` で数える。超過した statement は /goal に拒否される。 |

## Hard limits

- Never execute the verification command or any state-changing command.
- Never invoke `/goal`, the Skill tool, or subagents.
- If the launch argument is empty, first ask what the user wants to achieve,
  then run slot filling as above.
- Bash is limited to the Assemble length check (`wc -m` on the scratchpad
  file, never a heredoc) and, in issue mode, `gh issue view <N> --json
  title,body,url,comments`; never `close`/`comment`/`edit` an issue from
  within this skill.
