import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseShguardDeny } from './blocked-band'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 }

function stubEngine(on: On): void {
  mock.env(on, { HOME: '/Users/me' })
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // The engine's own band, reached when the plugin defers.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
}

test('parseShguardDeny recognizes shguard wording only', async () => {
  expect(parseShguardDeny('matches blocklist rule "dotfiles-file-rm": rm deletes')).toEqual({ rule: 'dotfiles-file-rm' })
  expect(parseShguardDeny('command matches rule "dotfiles-code-rg-pre", but ... ask_outcome = "deny"')).toEqual({
    rule: 'dotfiles-code-rg-pre',
  })
  expect(parseShguardDeny('an argument ... could not be resolved to Allow; ask_outcome = "deny"')).toEqual({ rule: '' })
  expect(parseShguardDeny('Exit code 1\nls: no such file')).toBeUndefined()
  expect(parseShguardDeny(undefined)).toBeUndefined()
})

test('a shguard deny tells the model to stop and repeat the command for /copy', async ($, on) => {
  stubEngine(on)
  on('classic.PreToolUse', () => ({ deny: 'matches blocklist rule "dotfiles-file-rm": no' }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(ran.isError).toBe(true)
  expect(ran.context?.some(c => c.includes('do not route around'))).toBe(true)
  expect(ran.context?.some(c => c.includes('/copy'))).toBe(true)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'dotfiles-mod', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
})

test('a tool-policy deny points at the replacement tool', async ($, on) => {
  stubEngine(on)
  on('classic.PreToolUse', () => ({ deny: 'matches blocklist rule "dotfiles-tool-policy-find": use fd' }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'find . -name x' })
  expect(ran.isError).toBe(true)
  expect(ran.context?.some(c => c.includes('Retry right away'))).toBe(true)
  expect(ran.context?.some(c => c.includes('do not route around'))).toBe(false)
})

test('an ordinary tool error gets no note', async ($, on) => {
  stubEngine(on)
  on('tool.call', () => ({ isError: true, result: 'Exit code 1', text: 'Exit code 1' }))
  const ran = await $.tool.call({ tool: 'Bash', command: 'false' })
  expect(ran.context).toBeUndefined()
})
