---
name: maintain-sweep
description: Runs the maintenance investigation agents (crash-fuzzer, dup-unifier, dead-code-removal, etc.) against the current repository in parallel — read-only, opus — has a single fable agent triage their findings, then files the surviving ones as GitHub issues. Use when the user wants to run a maintenance sweep, "メンテナンスルーチンを回して", or asks to run several/all of the maintenance agents at once. Not for running one investigation agent by name — invoke that agent directly instead. Never edits code or opens PRs; fixes go through /triage → /mkgoal.
disable-model-invocation: true
argument-hint: [routine ...] (optional — omit to run all 10 investigation agents)
allowed-tools: Bash, Write, Workflow
---

# /maintain-sweep — investigate in parallel, triage once, file issues

The sweep's job ends at GitHub issues. Fixing them is a separate flow
(`/triage` → `/mkgoal`), so the sweep never writes to the working tree and
never opens a PR.

1. **Investigate** (opus, parallel, read-only): each selected routine agent
   inspects the repo and returns structured findings — it never edits a
   file. Running these in parallel against the shared working tree is safe
   precisely because none of them write to it.
2. **Triage** (fable, single agent, read-only): one agent sees every
   finding at once plus the repo's existing issues, merges duplicates,
   drops false positives and already-filed problems, and drafts at most 8
   issues in priority order. This is the one place in the sweep where
   Fable's judgment pays for itself: a single call over the whole finding
   set, instead of one call per PR.
3. **File** (main loop): the skill creates each drafted issue with `gh`.
   This runs outside the Workflow because `gh` needs the keychain, which a
   workflow agent's sandboxed Bash can't read.

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
3. Fetch the existing issues for the triage agent's duplicate check:
   `gh issue list --state all --limit 200 --json number,title,state`.
4. State the plan before running: which routines investigate, that one
   fable agent triages the findings, and that up to 8 resulting issues get
   filed in this repo. The skill invocation itself is the go-ahead for
   filing them — this is a status line, not a second confirmation prompt.

## Run

Call the Workflow tool with this script, passing `args` as
`{ "routines": [...], "existingIssues": [...] }` — the routine list from
step 2 and the JSON array from step 3:

```js
export const meta = {
  name: 'maintain-sweep',
  description: 'Investigate with the maintenance agents in parallel (opus, read-only), then triage every finding into issue drafts (fable)',
  phases: [{ title: 'Investigate' }, { title: 'Triage' }],
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

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          routines: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'body', 'priority', 'routines'],
      },
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          routine: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['title', 'routine', 'reason'],
      },
    },
  },
  required: ['issues', 'dropped'],
}

phase('Investigate')
const reports = await parallel(args.routines.map(routine => () =>
  agent(
    'Investigate this repository at the current working directory for ' +
    'your routine. Report findings only — do not edit any files, and do ' +
    'not call the advisor tool.',
    { agentType: routine, label: routine, schema: FINDING_SCHEMA }
  ).then(r => ({ routine, findings: r.findings || [] }))
   .catch(e => ({ routine, findings: [], error: String(e) }))
))

const allFindings = reports.flatMap(r =>
  (r.findings || []).map(f => ({ ...f, routine: r.routine }))
)
log(`${allFindings.length} findings across ${args.routines.length} routines`)

if (!allFindings.length) {
  return { reports, triage: null }
}

phase('Triage')
const triage = await agent(
  'You triage maintenance findings for the repository at the current ' +
  'working directory into GitHub issue drafts. Findings (JSON): ' +
  JSON.stringify(allFindings) +
  '. Existing issues, open and closed (JSON): ' +
  JSON.stringify(args.existingIssues || []) +
  '. Merge findings that describe the same problem; drop false positives ' +
  '(open the cited code with Read/Grep only when the evidence alone is ' +
  'ambiguous) and anything an existing issue already covers. Return at ' +
  'most 8 issues, highest priority first, and list every finding you did ' +
  'not turn into an issue under `dropped` with its reason. Write each ' +
  'issue title and body in Japanese; structure the body as 問題の所在 ' +
  '(the problem, with file:line and the evidence) followed by 推奨される' +
  '対応方針 (the recommended fix), and name the source routine(s). Read ' +
  'only: do not edit files, run gh, or call the advisor tool.',
  { model: 'fable', label: 'triage', schema: TRIAGE_SCHEMA }
)

return { reports, triage }
```

## File

For each entry in `triage.issues`, in order: write its `body` to a file
under the scratchpad directory and run
`gh issue create --title "<title>" --body-file <that file>`. Collect each
resulting issue URL. If one `gh issue create` fails, report it with its
error and continue with the rest — don't retry it in a loop.

## Report

Present:
- One row per routine: name, finding count, and any `error` it returned.
- One row per filed issue: number, URL, priority, title.
- Every `dropped` entry with its reason, so a wrongly dropped finding can
  be caught and filed by hand.
- Next step: run `/triage` to decide which of the new issues to work on.
- If a routine returned zero findings, say so briefly; don't pad the
  report with "nothing found" detail per routine.

## Red flags

| Rationalization | Reality |
|---|---|
| "調査エージェントにもEditを持たせれば早い" | 調査担当10体はread-onlyだから並列実行が安全になっている。sweepはコードを一切書き換えない。修正は/triage → /mkgoalの流れで行う。 |
| "findingをそのままissueにすればtriageは要らない" | 調査担当ごとに重複や誤検知が混ざる。全findingを一度に見て統合・除外するのがtriageの役目で、Fableを使うのもこの1回だけ。 |
| "issueを8件以上まとめて作ろう" | 1回8件まで。超えた分はdroppedに理由付きで残り、次回のsweepで再検出される。backlogを一度に膨らませると/triageで比較しきれない。 |
