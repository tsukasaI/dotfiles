---
name: empirical-prompt-tuning
description: Iteratively improve text instructions for agents (skills, slash commands, task prompts, CLAUDE.md sections, code-generation prompts) by having an unbiased executor actually run them, evaluating from both sides (executor self-report + instruction-side metrics), and looping until improvements plateau. Use right after creating or substantially revising a prompt or skill, or when an agent is not behaving as expected and the cause might be ambiguity on the instruction side.
---

# Empirical Prompt Tuning

You cannot judge the quality of a prompt you wrote yourself. The passages a writer considers "clear" are often the ones that trip up a different agent reading them. The core of this skill: **have an unbiased executor actually run the instructions, evaluate from both sides, and iterate** until improvements plateau. Do not stop early.

## When to use

- Right after creating or substantially revising a skill, slash command, or task prompt
- When an agent is not behaving as expected and you suspect instruction-side ambiguity
- When hardening a high-importance instruction (frequently-used skill, core automation prompt)

When NOT to use:
- Disposable one-off prompts (evaluation cost is not worth it)
- When the goal is not success-rate improvement but reflecting the writer's subjective preference

## Workflow

0. **Iteration 0 — description/body consistency check** (static, no dispatch needed)
   - Read the triggers and uses that the frontmatter `description` advertises
   - Read what the body actually covers
   - If there is drift, reconcile description or body before entering iter 1
   - Example: description says "navigation / form filling / data extraction" but body is only a `npx playwright test` CLI reference
   - Skipping this lets the subagent "reinterpret" the body to match the description, so accuracy looks good while the skill fails to meet its stated requirements (false positive)

1. **Baseline preparation**: Fix the target prompt and prepare:
   - **Evaluation scenarios**, 2–3 of them (one median case + 1–2 edge cases). Must be realistic tasks where the prompt would actually be applied.
   - **Requirements checklist** (for computing accuracy). For each scenario, list 3–7 items the output must satisfy. Accuracy % = items met / total items. Freeze these up front; do not move them later.
2. **Bias-free reading**: Have a "blank slate" executor read the instructions. Dispatch a **fresh subagent via the Task tool**. Do not substitute self-rereading (it is structurally impossible to view text you just wrote objectively). For parallel scenarios, issue multiple Agent calls in a single message. For environments where dispatch is unavailable, see the "Environment constraints" section.
3. **Execution**: Pass the subagent a prompt following the **subagent launch contract** below and let it run the scenario. The executor produces the artifact/output and returns a self-report at the end.
4. **Two-sided evaluation**: From the returned result, record:
   - **Executor self-report** (extracted from the subagent's report body): ambiguities, discretionary fills, places where template application got stuck
   - **Instruction-side measurements** (judgment rules defined once here; other sections reference this section):
     - Pass/fail: ○ only if **every** item tagged `[critical]` is ○. If any is × or partial, ×. Labels are ○ / × only (binary).
     - Accuracy (checklist completion %. ○ = full, × = 0, partial = 0.5. Sum and divide by total items.)
     - Steps (use the `tool_uses` field from the Task tool's usage meta as-is. Include Read/Grep; do not exclude them.)
     - Duration (`duration_ms` from the Task tool usage meta)
     - Retries (how often the subagent redid the same decision. Extract from the self-report; the instruction side cannot measure this.)
     - **On failure, add a line to the "ambiguities" section of the presentation format showing which [critical] item failed** (for root-cause tracing)
   - The requirements checklist must contain **at least one** `[critical]` item (zero makes pass/fail vacuous). Do not add or remove [critical] tags after the fact.
5. **Apply diff**: Make the minimum edit that addresses the ambiguities. One theme per iteration (multiple related fixes are OK; unrelated ones wait for the next iteration).
6. **Re-evaluate**: Run steps 2–5 again with a **new** subagent (do not reuse the same one — it has learned last round's improvements). Increase parallelism only if iterations stop producing improvements.
7. **Convergence check**: Stop when "two consecutive iterations produce zero new ambiguities AND metric change is below the thresholds (below)". Use three consecutive iterations for high-importance prompts.

## Evaluation axes

| Axis | How to capture | Meaning |
|---|---|---|
| Pass/fail | Did the executor produce the intended artifact? (binary) | Minimum bar |
| Accuracy | What % of requirements did the artifact meet? | Degree of partial success |
| Steps | Number of tool calls / decision steps the executor used | Indicator of wasted instruction |
| Duration | Executor's duration_ms | Proxy for cognitive load |
| Retries | How often the same decision was redone | Signal of instruction ambiguity |
| Ambiguities (self-reported) | Listed by the executor | Qualitative improvement material |
| Discretionary fills (self-reported) | Decisions the instruction did not fix | Surfacing of implicit specs |

**Weighting**: Qualitative (ambiguities, discretionary fills) is primary; quantitative (time, step count) is secondary. Chasing pure time reduction makes prompts anemic.

### Qualitative reading of `tool_uses`

Looking only at accuracy can hide structural problems in a skill. Use `tool_uses` as a **relative value across scenarios** to see structural flaws:

- If one scenario's `tool_uses` is **3–5× higher** than the others, the skill is likely **index-shaped (decision-tree) with weak self-containment**. The executor is being forced into a references descent.
- Typical pattern: all scenarios at `tool_uses` 1–3, but one scenario at 15+ → there is no recipe in the skill for that scenario, so the executor is foraging through references/.
- Fix: in iter 2, add a "minimum complete example inline" or "guidance on when to read references" to the top of SKILL.md. `tool_uses` usually drops sharply.

Even at 100% accuracy, a `tool_uses` imbalance is grounds for firing iter 2. "Stop when accuracy is perfect" tends to miss structural flaws.

## Subagent launch contract

The prompt handed to the executor has this shape. This is the input contract for two-sided evaluation.

```
You are an executor reading <target prompt name> with no prior context.

## Target prompt
<paste the full target prompt, or give a path for Read to fetch>

## Scenario
<one paragraph describing the scenario setup>

## Requirements checklist (items the output must satisfy)
1. [critical] <item included in the minimum bar>
2. <regular item>
3. <regular item>
...
(Judgment rules are defined once in "Workflow 4. Two-sided evaluation / instruction-side measurements".
 At least one [critical] item is required.)

## Task
1. Follow the target prompt to execute the scenario and produce the artifact.
2. At the end, respond with the report structure below.

## Report structure
- Artifact: <the produced output or an execution summary>
- Requirement results: ○ / × / partial (with reason) for each item
- Ambiguities: passages that stuck you or wording you had to interpret (bullets)
- Discretionary fills: decisions you made to cover gaps in the instruction (bullets)
- Retries: how many times you redid the same decision, and why
```

The caller extracts self-report fields from this report and pulls `tool_uses` / `duration_ms` from the Agent tool usage meta to fill the evaluation-axes table.

## Environment constraints

In environments where a fresh subagent cannot be dispatched (you are already running as a subagent, the Task tool is disabled, etc.), **do not apply this skill**.
- Alternative 1: Ask the parent session's user to launch a separate Claude Code session and run the evaluation there.
- Alternative 2: Skip evaluation and explicitly report "empirical evaluation skipped: dispatch unavailable" to the user.
- **Not OK**: substituting self-rereading (bias creeps in, so the result cannot be trusted).

**Structural-review mode**: When you want a structural/consistency review of a skill or prompt rather than an empirical evaluation, explicitly carve it out as structural-review mode. Put "This is structural-review mode: text-integrity check, not execution" into the subagent prompt. This lets the subagent return a static review without hitting the dispatch-unavailable skip path. Structural review is an aid to empirical, not a replacement — it cannot count toward the consecutive-pass convergence check.

## Stopping criteria

- **Convergence (stop)**: Two consecutive iterations that **all** of the following hold:
  - New ambiguities: 0
  - Accuracy improvement vs. previous iteration: ≤ +3 points (e.g., 5% → 8%, saturating)
  - Step-count change vs. previous iteration: within ±10%
  - Duration change vs. previous iteration: within ±15%
  - **Overfit check**: At convergence, add a held-out scenario not used before and evaluate. If accuracy drops ≥ 15 points vs. the recent average, you have overfit — go back to baseline scenario design and add more edges.
- **Divergence (suspect the design)**: If new ambiguities do not decrease after 3+ iterations, the prompt's design direction itself may be wrong. Stop patching and rewrite the structure.
- **Resource stop**: When importance and improvement cost no longer match up, stop (the "ship at 80" judgment).

## Presentation format

Record and present each iteration in this shape:

```
## Iteration N

### Changes (diff vs. previous)
- <one-line description of the edit>

### Results per scenario
| Scenario | Pass/fail | Accuracy | steps | duration | retries |
|---|---|---|---|---|---|
| A | ○ | 90% | 4 | 20s | 0 |
| B | × | 60% | 9 | 41s | 2 |

### Ambiguities (new this iteration)
- <scenario B>: [critical] item N failed — <one-line cause>   # always add on failure
- <scenario B>: <other finding, one line>
- <scenario A>: (none new)

### Discretionary fills (new this iteration)
- <scenario B>: <what was filled in>

### Next fix
- <one-line minimum edit>

(Convergence: X consecutive clears / Y iterations remaining before stop.)
```

## Red flags (watch for rationalizations)

| Rationalization | Reality |
|---|---|
| "I can just reread it myself for the same effect." | You cannot view text you just wrote objectively. Always dispatch a fresh subagent. |
| "One scenario is enough." | One scenario overfits. Minimum 2, preferably 3. |
| "Zero ambiguities once, so we're done." | Could be chance. Require two consecutive iterations. |
| "Let me fix several ambiguities at once." | You lose track of what actually helped. One theme per iteration. |
| "Let me split every tiny related fix into its own iteration." | The opposite trap. A "theme" is a meaning unit; 2–3 related small fixes in one iteration is fine. Over-splitting explodes the iteration count. |
| "Metrics look good, so I'll ignore the qualitative feedback." | Time reduction can also be the signal of an anemic prompt. Qualitative is primary. |
| "Rewriting is faster." | Correct once ambiguities have failed to decrease for 3+ iterations. Before that, it is an escape. |
| "Reusing the same subagent is fine." | It has learned the previous iteration's improvements. Dispatch fresh every time. |

## Common failure modes

- **Scenarios too easy or too hard**: Either extreme produces no signal. Pick one real-world median case and one edge case.
- **Metric-only reading**: Chasing duration alone erodes important explanatory text and makes the prompt brittle.
- **Too many changes per iteration**: You lose the ability to attribute improvement. One fix per iteration.
- **Tuning scenarios to match the fix**: Making scenarios easier so ambiguities appear to disappear is backwards and defeats the purpose.
