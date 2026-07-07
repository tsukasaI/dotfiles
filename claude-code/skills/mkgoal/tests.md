# /mkgoal test invocations

Manual verification suite for `SKILL.md`. Run each in a fresh session and
compare against the expected behaviour. Re-run after any edit to the skill,
and whenever the main-loop model changes tier (Opus/Sonnet/Haiku).

## Pass criteria common to all tests

- The skill never runs a Bash command (verification commands are drafted, not
  executed; only Read/Grep existence checks are allowed).
- The skill never invokes `/goal`, other skills, or subagents.
- The final approved output is a fenced code block containing exactly one
  line starting with `/goal` — no prose inside the block.
- The assembled statement always contains the "or when <N> turns have
  elapsed" clause and instructs showing the verification command's full
  output each turn.

## Tests

### 1. All slots present in the argument

    /mkgoal go test ./... が全部通ること。検証コマンドは go test ./...、上限5ターン

Expected: no questions. All three slots filled silently from the argument;
goes straight to the approval gate with the assembled statement.

### 2. Objective condition, command and cap missing

    /mkgoal make all the tests pass

Expected: ONE batched message asking (1) the exact test command, (2) the turn
cap with proposed default 5. The condition itself is accepted once tied to
the command.

### 3. Subjective condition (Japanese)

    /mkgoal コードをきれいにして

Expected: rejects「きれいに」as unfilled, offers an objective proxy (e.g. a
linter reporting 0 issues), and asks for all three slots in one message.

### 4. Only the turn cap missing

    /mkgoal Lighthouse performance ≥ 90, verified with npm run lighthouse

Expected: slots 1 and 2 filled silently; a single question proposing turn
cap 5 and waiting for explicit confirmation.

### 5. Genuinely ambiguous / subjective request

    /mkgoal improve API performance

Expected: one batched message asking (1) which metric and threshold,
(2) which command measures it, (3) turn cap with default 5. Does not
assemble until all three meet the bar.

### 6. Bare invocation

    /mkgoal

Expected: asks what the user wants to achieve before any slot questions.
Does not invent a goal.

### 7. Revision-cycle cap

Run test 1, then answer every presented draft with「もっといい感じに」.

Expected: re-presents as "Revision 1 of 3", "Revision 2 of 3",
"Revision 3 of 3"; after the third rejection, exits the skill and suggests
re-running /mkgoal, producing no final statement.

### 8. Slot-level stubbornness cap

Run test 6, then reply「いい感じになったら OK」to the condition question,
three times.

Expected: each re-ask offers one concrete objective candidate acceptable
with "yes"; after the 3rd failed attempt, states the condition cannot be
made machine-checkable and exits without producing a statement.
