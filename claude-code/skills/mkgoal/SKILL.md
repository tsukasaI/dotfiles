---
name: mkgoal
description: Builds a high-quality, verifiable /goal statement through a short slot-filling dialogue. Use when the user wants to start a Claude Code goal loop and needs the completion condition, verification command, and turn cap defined before running /goal.
disable-model-invocation: true
argument-hint: [達成したいこと]
allowed-tools: Read, Grep
---

# /mkgoal — draft a verifiable /goal statement

Produce ONE copy-pasteable `/goal` statement, then stop. This skill never runs
`/goal`, never executes the verification command, and never invokes other
skills or subagents. Match the user's conversation language in all dialogue.

Root quality: **checkable** — the evaluator model (Haiku) can answer yes/no from
transcript text alone, with zero judgment.

Launch argument: $ARGUMENTS

## Why the bars below exist (how /goal judges completion)

- After each turn, a small evaluator model (Haiku by default) reads ONLY the
  conversation transcript and answers yes/no: is the condition met? It cannot
  run tools — anything it must judge has to be visible in the transcript.
- `/goal` has NO built-in turn cap. The cap only exists if written into the
  statement text itself ("or when N turns have elapsed").
- Keep the finished statement to one line, a few sentences at most.

## Slots (all three required)

Fill silently from the launch argument; ask only about slots that are missing
or not yet checkable.

1. **Completion condition** — objective: a reader of the transcript can answer
   yes/no without exercising judgment. Must name a concrete command outcome,
   metric + threshold, or artifact.
2. **Verification command** — the exact command whose output proves the
   condition (e.g. `go test ./...`, `npm run lighthouse`).
3. **Turn cap** — a positive integer. If the user gave none, propose `5` and
   get confirmation.

*Done:* all 3 slots filled and checkable.

### Objectivity gate for slot 1 (the most important check)

Treat the condition as UNFILLED if it rests on judgment words with no measure:
clean, better, improved, refactored, readable, faster, more robust, nicer,
きれいに, いい感じ, 改善. Ask the user to restate it as something checkable.

- Reject: "improve performance" → ask: which metric, measured by which command,
  past what threshold?
- Accept: "Lighthouse performance score ≥ 90 on /, via `npm run lighthouse`"
- Reject: "make the code clean" → offer a proxy: "would `golangci-lint run`
  reporting 0 issues satisfy you? If not, what objective check would?"
- Accept: "`go test ./...` exits 0"

A numeric condition with no verification command (slot 2 empty) is still
incomplete — ask how it will be measured.

## Dialogue rules

- Ask about ALL missing or below-bar slots in ONE batched, numbered plain-text
  message. State proposed defaults inline (turn cap: 5).
- Silence or an unrelated reply is not consent to a proposed default — wait for
  an explicit answer before assembling.
- If a slot answer is still subjective, re-ask that slot only, each time
  offering one concrete objective candidate the user can accept with "yes".
  After 3 failed attempts on the same slot, state that the condition cannot be
  made machine-checkable and exit the skill without producing a statement.
- Optional cheap sanity check: if the verification command references a repo
  script or target (npm script, make target, test path), you may Grep/Read to
  confirm it exists; if it does not, say so and ask for the correct command.
  Never execute it.

## Assemble

Build the statement on a single line from this template:

    /goal Run `<verification command>` and show its full output in the
    conversation each turn; the goal is met when that output confirms
    <objective condition>, or when <N> turns have elapsed without meeting it.

Rules:
- The turn cap MUST appear as the "or when <N> turns have elapsed" clause —
  `/goal` has no separate cap setting.
- Every condition must be judgeable from command output visible in the
  transcript. Multiple conditions: join with "and", each tied to a command.

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
| "3スロット全部聞くと煩わしいから推測で埋める" | 埋めない。欠けたスロットは必ず聞く。沈黙は同意ではない。 |
| "条件が複合的だから複数行の /goal にしよう" | しない。1行に収める。複数条件は "and" で繋ぎ、各々に検証コマンドを紐づける。 |

## Hard limits

- Never execute the verification command or any state-changing command.
- Never invoke `/goal`, the Skill tool, or subagents.
- If the launch argument is empty, first ask what the user wants to achieve,
  then run slot filling as above.
