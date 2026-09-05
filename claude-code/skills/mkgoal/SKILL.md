---
name: mkgoal
description: Builds a high-quality, verifiable /goal statement through a short slot-filling dialogue. Use when the user wants to start a Claude Code goal loop and needs the completion condition, verification command, constraints, and turn cap defined before running /goal. Also accepts one or more #<issue> references (typically handed off from /triage) to draft a single combined /goal statement covering all of them.
disable-model-invocation: true
argument-hint: [達成したいこと | #issue番号 ...]
allowed-tools: Read, Grep, AskUserQuestion, Bash
---

# /mkgoal — draft a verifiable /goal statement

Produce ONE copy-pasteable `/goal` statement, then stop. This skill never runs
`/goal`, never executes the verification command, and never invokes other
skills or subagents. Match the user's conversation language in all dialogue.
Bash is scoped to `gh issue view <N> --json title,body,url` only, and only
when the launch argument is in issue mode (see below); never any other
command, and never `gh issue close`/`comment`/`edit` (that is `/triage`'s job,
not this skill's).

Root quality: **checkable** — the evaluator model (Haiku) can answer yes/no from
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
- The condition may be up to 4,000 characters. A durable condition has three
  parts: one measurable end state, a stated check, and constraints that must
  hold along the way. Keep the statement a single line
  (no line breaks), but never drop a required element for brevity.

## Issue mode

If the launch argument consists solely of one or more `#<digits>` tokens
(space-separated, as `/triage` emits), this is issue mode: draft ONE combined
`/goal` statement covering every listed issue, in the order given.

For each `#N`, run `gh issue view <N> --json title,body,url` once. Treat each
issue's body as the source for that issue's own slot 1 (completion condition)
and slot 2 (verification command); the objectivity gate below still applies
per issue; if an issue's body does not supply a checkable condition or a
verification command, ask about that issue specifically in the batched
`AskUserQuestion` call, same as any missing slot.

Slot 3 (constraints) and slot 4 (turn cap) apply once, across the whole
batch: ask a single turn cap covering all issues together (propose `5 ×
number of issues` as the default), and ask once whether any constraint should
hold across all of them (e.g. "no issue's change touches another issue's
files"). "None" is still a valid, explicit answer.

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
4. **Turn cap** — a positive integer. If the user gave none, propose `5` and
   get confirmation.

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
  5 (default) / 10 / 20 for the turn cap. Free-form answers arrive through the
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

- Implement using the **sonnet** model.
- Review with a **fable**-model `code-reviewer` subagent before completion
  counts.
- On fable's approval, the PR is pre-authorized to squash-merge via
  `gh pr merge --squash --delete-branch` without asking again. This is the
  standing exception to the usual "merge only when I say so" rule, scoped
  strictly to goals launched through this skill.

## Assemble

Build the statement on a single line from this template:

    /goal <task summary drawn from the user's stated goal>. Implement using
    the sonnet model, then have a fable-model code-reviewer subagent review
    the change; run `<verification command>` and show its full output in the
    conversation each turn; the goal is met when that output confirms
    <objective condition>, while <constraints> holds; once fable approves the
    review, squash-merge the PR via `gh pr merge --squash --delete-branch`
    without asking again; or stop after <N> turns.

In issue mode, list each issue as its own named clause instead of one task
summary, and join the per-issue completion conditions with "and":

    /goal Resolve issue #<N1> (<title1>) and issue #<N2> (<title2>) [...].
    Implement using the sonnet model, then have a fable-model code-reviewer
    subagent review each change; for #<N1>, run `<verification command 1>`;
    for #<N2>, run `<verification command 2>` [...]; show full output each
    turn. The goal is met when every issue's output confirms its own
    condition, while <batch constraints> holds; once fable approves a PR's
    review, squash-merge it via `gh pr merge --squash --delete-branch` without
    asking again; or stop after <N> turns.

Rules:
- Single line, no line breaks, at most 4,000 characters. If over, tighten
  wording, never drop a slot.
- The turn cap MUST appear as the "or stop after <N> turns" clause. `/goal`
  has no separate cap setting.
- Every condition must be judgeable from command output visible in the
  transcript. Multiple conditions: join with "and", each tied to a command.
- The constraints clause is omitted only when the user explicitly answered
  "none". If a constraint has its own check (e.g. `git diff --stat`), name it
  and instruct showing its output each turn too.
- The task summary states what to achieve. The statement doubles as Claude's
  first-turn directive.
- The sonnet/fable/squash-merge clauses from Standing implementation pattern
  above are always included verbatim in intent, regardless of repo. Never
  drop them for brevity.

*Done:* single-line checkable `/goal` statement drafted from template.

## Approval gate

1. Present the drafted statement in a fenced code block, preceded by a
   one-line-per-slot summary, and ask: approve as-is, or request changes?
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
| "文が長いと格好悪いから要素を削ろう" | 4,000字まで許容される。短さより要素の完全性。ただし改行は入れない。 |

## Hard limits

- Never execute the verification command or any state-changing command.
- Never invoke `/goal`, the Skill tool, or subagents.
- If the launch argument is empty, first ask what the user wants to achieve,
  then run slot filling as above.
- In issue mode, `gh issue view` is the only Bash command allowed; never
  `close`/`comment`/`edit` an issue from within this skill.
