---
name: maintain-sweep
description: Runs the maintenance investigation agents (crash-fuzzer, dup-unifier, dead-code-removal, etc.) against the current repository in parallel — read-only, opus — feeds their findings to a single sequential implementer agent (sonnet) that verifies and applies the confirmed fixes, then has a fable code-reviewer review every PR it opened. Use when the user wants to run a maintenance sweep, "メンテナンスルーチンを回して", or asks to run several/all of the maintenance agents at once. Not for running one investigation agent by name with no implementation step — invoke that agent directly instead.
disable-model-invocation: true
argument-hint: [routine ...] (optional — omit to run all 10 investigation agents)
allowed-tools: Bash, Workflow
---

# /maintain-sweep — investigate in parallel, implement sequentially, review in parallel

Three-phase design. Phases 1 and 2 are split because 10 agents editing the
same working tree in parallel would conflict, while 10 agents
*investigating* it in parallel cannot — they never write anything. Phase 3
exists because every PR falls under the global fable review gate:

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
3. **Review** (fable, parallel, read-only): every PR the implementer opened
   gets a `code-reviewer` pass. The implementer has no Agent tool, so the
   workflow runs the reviews, not the implementer. PRs are independent
   branches, so reviewing them in parallel is safe.

Launch argument: $ARGUMENTS

## Investigation agents

| Name | What it investigates |
|---|---|
| crash-fuzzer | Real app crashes and their root cause |
| internal-flag-auditor | Forgotten internal-only/beta features and stable 100%-rollout flags — ship (inline) or delete |
| logic-simplifier | Nested business logic that can simplify without behavior change |
| logic-bugfixer | Real bugs found by modeling logic and state transitions |
| dup-unifier | Near-duplicate implementations worth unifying |
| dead-code-removal | Provably unreachable code |
| useless-test-pruner | Tests that can never fail |
| flaky-test-fixer | Root cause of CI tests that pass/fail inconsistently |
| abstraction-improver | Overengineered abstractions with few real implementations |
| abstraction-police | Violations of the project's own documented layering rules |

## Preflight

1. Confirm the current directory is a git repository
   (`git rev-parse --is-inside-work-tree`). If not, tell the user and stop.
2. Parse `$ARGUMENTS` into a routine list:
   - Empty → all 10 routines above.
   - Space-separated names → validate each against the table above; if any
     name doesn't match, list the valid names and stop without running
     anything.
3. State the plan before running: which routines investigate, that
   `maintenance-implementer` will act on whatever they find (each fix on
   its own branch + PR, never pushed to main or merged), that it caps
   itself at 8 findings per run, and that each PR then gets a fable
   `code-reviewer` pass. The skill invocation itself is the go-ahead —
   this is a status line, not a second confirmation prompt.

## Run

Call the Workflow tool with this script, passing the routine list from step
2 as `args` (a JSON array of routine-name strings, e.g.
`["crash-fuzzer", "dup-unifier"]`):

```js
export const meta = {
  name: 'maintain-sweep',
  description: 'Investigate with the maintenance agents in parallel (opus, read-only), implement confirmed fixes sequentially (sonnet), then review every PR (fable)',
  phases: [{ title: 'Investigate' }, { title: 'Implement' }, { title: 'Review' }],
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string' },
    prs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          url: { type: 'string' },
          branch: { type: 'string' },
          finding: { type: 'string' },
        },
        required: ['number', 'url', 'branch', 'finding'],
      },
    },
  },
  required: ['report', 'prs'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
        },
        required: ['severity', 'title', 'summary'],
      },
    },
  },
  required: ['approved', 'findings'],
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
  return { reports, implemented: null, reviews: [] }
}

phase('Implement')
const implemented = await agent(
  "Here are this repository's maintenance findings from the investigation " +
  'pass, as JSON: ' + JSON.stringify(allFindings) +
  '. Verify and implement the ones that hold up, one at a time.',
  { agentType: 'maintenance-implementer', label: 'implement', schema: IMPLEMENT_SCHEMA }
)

phase('Review')
const reviews = await parallel((implemented.prs || []).map(pr => () =>
  agent(
    `Review pull request #${pr.number} (${pr.url}) in this repository. ` +
    'Read the PR diff with `gh pr diff` and review it for correctness, ' +
    'security, and quality. `approved` is true only when there is no ' +
    'critical or high finding.',
    { agentType: 'code-reviewer', label: `review:#${pr.number}`, schema: REVIEW_SCHEMA }
  ).then(r => ({ ...pr, ...r }))
   .catch(e => ({ ...pr, approved: false, findings: [], error: String(e) }))
))

return { reports, implemented, reviews }
```

## Report

Present:
- One row per routine: name, finding count, and any `error` it returned.
- If findings existed, the implementer's own final report verbatim (it
  already lists implemented / skipped / deferred per finding with reasons
  and PR links) — do not re-summarize away a PR link, branch name, or
  skip reason.
- One row per PR from the review phase: PR number, `approved`, and every
  critical/high finding by title and file:line. A review that errored is
  not approved; say so and name the PR rather than treating silence as a
  pass.
- What happens next follows the global CLAUDE.md fable gate: an approved
  PR is mergeable (medium/low findings become GitHub issues); a PR with a
  critical/high finding needs fixups and a re-review before merging. This
  skill only reports the verdicts; it never merges. The re-review is a
  fresh `code-reviewer` Agent, not a `SendMessage` resume: reviewers
  spawned inside the Workflow script have no agent id to resume.
- If a routine returned zero findings, say so briefly; don't pad the
  report with "nothing found" detail per routine.

## Red flags

| Rationalization | Reality |
|---|---|
| "調査エージェントにもEditを持たせれば早い" | 調査担当11体はread-onlyだから並列実行が安全になっている。Editを与えた瞬間また競合が起きる。書き込みはmaintenance-implementer 1体だけの役目。 |
| "findingを全部一気に実装させよう" | 実装担当は1回8件まで。残りは次回に回す設計 — 1回のPR群が大きくなりすぎてレビューできなくなるのを防ぐ。 |
| "調査結果をそのまま信じて直せばいい" | 実装担当は着手前に必ず再検証する。調査から実装までの間にコードが変わっている/finding自体が誤っている可能性がある。 |
