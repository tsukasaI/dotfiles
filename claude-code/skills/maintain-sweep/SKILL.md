---
name: maintain-sweep
description: Runs a batch of the manual code-maintenance agents (crash-fuzzer, dup-unifier, dead-code-removal, etc.) against the current repository in parallel, each in an isolated git worktree, and aggregates the results. Use when the user wants to run a maintenance sweep, "メンテナンスルーチンを回して", or asks to run several/all of the maintenance agents at once. Not for running one agent by name — invoke that agent directly instead.
disable-model-invocation: true
argument-hint: [routine ...] (optional — omit to run all 11)
allowed-tools: Bash, Workflow
---

# /maintain-sweep — batch-run the code-maintenance agents

Runs one or more of the manual-invocation maintenance agents defined in
`claude-code/agents/` against the current repository, each in its own
isolated git worktree, in parallel, then reports what each one did.

Launch argument: $ARGUMENTS

## Routines

| Name | What it does |
|---|---|
| crash-fuzzer | Fuzzes the app to find and fix real crashes |
| internal-flag-auditor | Reports which internal-only/beta features to ship or delete (report-only, no PR) |
| logic-simplifier | Simplifies nested business logic, same behavior |
| logic-bugfixer | Models logic to find and fix real bugs |
| dup-unifier | Unifies near-duplicate implementations |
| dead-code-removal | Removes provably unreachable code |
| useless-test-pruner | Removes tests that can never fail |
| shipped-feature-inliner | Removes flags for fully-shipped features |
| flaky-test-fixer | Fixes the root cause of flaky CI tests |
| abstraction-improver | Flattens overengineered abstractions |
| abstraction-police | Fixes architecture layering violations |

## Preflight

1. Confirm the current directory is a git repository
   (`git rev-parse --is-inside-work-tree`). If not, tell the user and stop.
2. Parse `$ARGUMENTS` into a routine list:
   - Empty → all 11 routines above.
   - Space-separated names → validate each against the table above; if any
     name doesn't match, list the valid names and stop without running
     anything.
3. State the plan before running: which routines, that each runs in its
   own isolated worktree (a dirty working tree is not at risk — a worktree
   is cut from the last commit, not uncommitted changes), and that each
   agent may open a PR but will never push to main or merge (every agent's
   own definition enforces this). The skill invocation itself is the
   go-ahead — this is a status line, not a second confirmation prompt.

## Run

Call the Workflow tool with this script, passing the routine list from step
2 as `args` (a JSON array of routine-name strings, e.g.
`["crash-fuzzer", "dup-unifier"]`):

```js
export const meta = {
  name: 'maintain-sweep',
  description: 'Run selected code-maintenance agents against the current repo in parallel, each in an isolated worktree',
  phases: [{ title: 'Sweep' }],
}

phase('Sweep')
const results = await parallel(args.map(routine => () =>
  agent(
    'Run your maintenance routine against the repository at the current ' +
    'working directory. Follow your own agent definition exactly, ' +
    'including every guardrail in it (branch+PR+stop, report-only ' +
    'fallbacks, etc.) — do not take shortcuts because this run is part ' +
    'of a batch.',
    { agentType: routine, label: routine, isolation: 'worktree' }
  ).then(r => ({ routine, result: r })).catch(e => ({ routine, error: String(e) }))
))

return results
```

## Report

Present one row per routine: name, outcome (PR opened / reported findings
only / no issues found / errored), and a one-line summary drawn from the
agent's returned text. Do not paraphrase away a PR link or branch name if
the agent's result includes one — surface it verbatim so the user can act
on it.

## Red flags

| Rationalization | Reality |
|---|---|
| "全部同じワークツリーで動かしても大丈夫だろう" | 11個が同時にブランチを切って編集・コミットするので衝突する。必ず `isolation: 'worktree'` を使う。 |
| "1つだけ実行したいだけならこのスキルで十分" | 単体実行は該当エージェントを直接名指しで呼ぶ方が速い。このスキルは複数/全部をまとめて回す用途専用。 |
| "エージェントの結果は要約だけ見せれば十分" | PRリンクやブランチ名は要約で潰さず、そのまま提示する。ユーザーが次のアクションを取れるようにする。 |
