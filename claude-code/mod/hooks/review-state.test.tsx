import { expect, mock, test } from 'claude-code/testing'

import { hasCriticalOrHigh, mergedNumber } from './review-state'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 }
const PR = 'https://github.com/tsukasaI/app/pull/12'

test('hasCriticalOrHigh ignores confidence ratings', async () => {
  expect(hasCriticalOrHigh('src/a.ts:3 severity: high, confidence: medium')).toBe(true)
  expect(hasCriticalOrHigh('1. [Critical] SQL injection')).toBe(true)
  expect(hasCriticalOrHigh('src/a.ts:3 severity: low, confidence: high')).toBe(false)
  expect(hasCriticalOrHigh('No findings.')).toBe(false)
})

test('hasCriticalOrHigh does not flag clean reviews that mention the words', async () => {
  expect(hasCriticalOrHigh('No critical or high findings. 1 medium.')).toBe(false)
  expect(hasCriticalOrHigh('The high-level design is fine. a.ts:3 severity: low')).toBe(false)
  expect(hasCriticalOrHigh('| a.ts:3 | medium | high |')).toBe(false)
})

test('hasCriticalOrHigh detects the severity notations the reviewer emits', async () => {
  expect(hasCriticalOrHigh('[High] a.ts:3 bug')).toBe(true)
  expect(hasCriticalOrHigh('1. **High** a.ts:3 off-by-one, confidence: medium')).toBe(true)
  expect(hasCriticalOrHigh('- a.ts:3 (critical, confidence: high): injection')).toBe(true)
  expect(hasCriticalOrHigh('- **Severity**: High\n- **Confidence**: low')).toBe(true)
  expect(hasCriticalOrHigh('Critical: a.ts:3 hardcoded secret')).toBe(true)
  expect(hasCriticalOrHigh('| a.ts:3 | high | medium |')).toBe(true)
  expect(hasCriticalOrHigh('1. [Medium] a.ts:1 x\n2. [High] b.ts:2 y')).toBe(true)
  expect(hasCriticalOrHigh('1. [Low] a.ts:1 x, confidence: high')).toBe(false)
})

const CASES: [string, boolean][] = [
  ['- **High** shguard/config.toml:12 `cat x | sh` bypasses', true],
  ['- [High] hooks/x.sh:3 `a || b` short-circuits', true],
  ['## High', true],
  ['### Critical: hooks/x.sh:3 secret', true],
  ['- a.ts:3 — high — confidence medium', true],
  ['Severity — High', true],
  ['- **Severity:** High', true],
  ['| a.ts:3 | high | medium |', true],
  ['High-severity: a.ts:3 injection', true],
  ['- a.ts:3 **Medium** (high confidence): x', false],
  ['High confidence that the change is safe.', false],
  ['No findings. (high confidence)', false],
  ['- a.ts:3 **Low**, confidence: **high**', false],
  ['Critical path is unchanged.', false],
  ['No critical or high findings. 1 medium.', false],
  ['- Critical: 0', false],
  ['- High: none', false],
  ['The high-level design is fine. a.ts:3 severity: low', false],
  ['| a.ts:3 | medium | high |', false],
]

test('hasCriticalOrHigh table of severity notations', async () => {
  for (const [line, want] of CASES) expect([line, hasCriticalOrHigh(line)]).toEqual([line, want])
})

test('mergedNumber reads a number or URL argument', async () => {
  expect(mergedNumber('gh pr merge 12 --squash --delete-branch')).toBe(12)
  expect(mergedNumber(`gh pr merge ${PR} --squash`)).toBe(12)
  expect(mergedNumber('gh pr merge --squash')).toBeUndefined()
})

test('create → review → merge drives the band', async ($, on) => {
  mock.env(on, { HOME: '/Users/me' })
  on('session.cwd', () => ({ value: '/Users/me/src/app' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'feat/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const report = 'src/a.ts:3 severity: critical, confidence: high\nagentId: rev1'
  on('tool.call', { tool: 'Agent' }, () => ({ result: { ok: true }, text: report }))

  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'dotfiles-mod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const row = await ui.find({ type: 'Text', text: /PR #12/ })
    await ui.unmount()
    return row
  }

  // A hook's own { result } carries no `text`, so give it the way core does.
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: PR }, text: PR }))
  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title t --body-file /private/tmp/claude-501/b.md' })
  expect((await band())?.text).toMatch(/not reviewed/)

  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'code-reviewer', model: 'fable' })
  expect((await band())?.text).toMatch(/critical\/high finding \(reviewer rev1\)/)

  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 12 --squash --delete-branch' })
  expect(await band()).toBeUndefined()
})

test('a bare gh pr merge clears the only tracked PR', async ($, on) => {
  mock.env(on, { HOME: '/Users/me' })
  on('session.cwd', () => ({ value: '/Users/me/src/app' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: 'feat/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: PR }, text: PR }))

  const band = async () => {
    const ui = await $.ui.mount({ plugin: 'dotfiles-mod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const row = await ui.find({ type: 'Text', text: /PR #12/ })
    await ui.unmount()
    return row
  }

  await $.tool.call({ tool: 'Bash', command: 'gh pr create --title t --body-file /private/tmp/claude-501/b.md' })
  expect(await band()).toBeDefined()

  await $.tool.call({ tool: 'Bash', command: 'gh pr merge --squash --delete-branch' })
  expect(await band()).toBeUndefined()
})
