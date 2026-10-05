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
