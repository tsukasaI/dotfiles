---
name: maintain-sweep
description: Runs the maintenance investigation agents (crash-fuzzer, dup-unifier, dead-code-removal, etc.) against the current repository in parallel — read-only, opus — then feeds their findings to a single sequential implementer agent (sonnet) that verifies and applies the confirmed fixes. Use when the user wants to run a maintenance sweep, "メンテナンスルーチンを回して", or asks to run several/all of the maintenance agents at once. Not for running one investigation agent by name with no implementation step — invoke that agent directly instead.
disable-model-invocation: true
argument-hint: [routine ...] (optional — omit to run all 11 investigation agents)
allowed-tools: Bash, Workflow
---

# /maintain-sweep — investigate in parallel, implement sequentially

Two-phase design, chosen because 11 agents editing the same working tree in
parallel would conflict, while 11 agents *investigating* it in parallel
cannot — they never write anything:

1. **Investigate** (opus, parallel, read-only): each selected routine agent
   inspects the repo and returns structured findings — it never edits a
   file. Running these in parallel against the shared working tree is safe
   precisely because none of them write to it.
2. **Implement** (sonnet, single agent, sequential): one
   `maintenance-implementer` call receives every finding, re-verifies each
   before touching anything, and applies confirmed fixes one at a time —
   its own branch + PR per fix, never pushing to main or merging. Because
   it's a single agent working through the list serially, there's no
   concurrent-write conflict to isolate against.

Launch argument: $ARGUMENTS

## Investigation agents

| Name | What it investigates |
|---|---|
| crash-fuzzer | Real app crashes and their root cause |
| internal-flag-auditor | Forgotten internal-only/beta features — ship or delete |
| logic-simplifier | Nested business logic that can simplify without behavior change |
| logic-bugfixer | Real bugs found by modeling logic and state transitions |
| dup-unifier | Near-duplicate implementations worth unifying |
| dead-code-removal | Provably unreachable code |
| useless-test-pruner | Tests that can never fail |
| shipped-feature-inliner | Feature flags at 100% rollout, stable, ready to inline |
| flaky-test-fixer | Root cause of CI tests that pass/fail inconsistently |
| abstraction-improver | Overengineered abstractions with few real implementations |
| abstraction-police | Violations of the project's own documented layering rules |

## Preflight

1. Confirm the current directory is a git repository
   (`git rev-parse --is-inside-work-tree`). If not, tell the user and stop.
2. Parse `$ARGUMENTS` into a routine list:
   - Empty → all 11 routines above.
   - Space-separated names → validate each against the table above; if any
     name doesn't match, list the valid names and stop without running
     anything.
3. State the plan before running: which routines investigate, that
   `maintenance-implementer` will act on whatever they find (each fix on
   its own branch + PR, never pushed to main or merged), and that it caps
   itself at 8 findings per run. The skill invocation itself is the
   go-ahead — this is a status line, not a second confirmation prompt.

## Run

Call the Workflow tool with this script, passing the routine list from step
2 as `args` (a JSON array of routine-name strings, e.g.
`["crash-fuzzer", "dup-unifier"]`):

```js
export const meta = {
  name: 'maintain-sweep',
  description: 'Investigate with the maintenance agents in parallel (opus, read-only), then implement confirmed fixes sequentially (sonnet)',
  phases: [{ title: 'Investigate' }, { title: 'Implement' }],
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          evidence: { type: 'string' },
          proposed_fix: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'evidence', 'proposed_fix', 'confidence'],
      },
    },
  },
  required: ['findings'],
}

phase('Investigate')
const reports = await parallel(args.map(routine => () =>
  agent(
    'Investigate this repository at the current working directory for ' +
    'your routine. Report findings only — do not edit any files.',
    { agentType: routine, label: routine, schema: FINDING_SCHEMA }
  ).then(r => ({ routine, findings: r.findings || [] }))
   .catch(e => ({ routine, findings: [], error: String(e) }))
))

const allFindings = reports.flatMap(r =>
  (r.findings || []).map(f => ({ ...f, routine: r.routine }))
)
log(`${allFindings.length} findings across ${args.length} routines`)

if (!allFindings.length) {
  return { reports, implemented: null }
}

phase('Implement')
const implemented = await agent(
  "Here are this repository's maintenance findings from the investigation " +
  'pass, as JSON: ' + JSON.stringify(allFindings) +
  '. Verify and implement the ones that hold up, one at a time.',
  { agentType: 'maintenance-implementer', label: 'implement' }
)

return { reports, implemented }
```

## Report

Present:
- One row per routine: name, finding count, and any `error` it returned.
- If findings existed, the implementer's own final report verbatim (it
  already lists implemented / skipped / deferred per finding with reasons
  and PR links) — do not re-summarize away a PR link, branch name, or
  skip reason.
- If a routine returned zero findings, say so briefly; don't pad the
  report with "nothing found" detail per routine.

## Red flags

| Rationalization | Reality |
|---|---|
| "調査エージェントにもEditを持たせれば早い" | 調査担当11体はread-onlyだから並列実行が安全になっている。Editを与えた瞬間また競合が起きる。書き込みはmaintenance-implementer 1体だけの役目。 |
| "findingを全部一気に実装させよう" | 実装担当は1回8件まで。残りは次回に回す設計 — 1回のPR群が大きくなりすぎてレビューできなくなるのを防ぐ。 |
| "調査結果をそのまま信じて直せばいい" | 実装担当は着手前に必ず再検証する。調査から実装までの間にコードが変わっている/finding自体が誤っている可能性がある。 |
