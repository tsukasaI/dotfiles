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
  expect(parseShguardDeny('rule `dotfiles-file-rm` hit (item 0, link 0, cmd 0)')).toEqual({ rule: 'dotfiles-file-rm' })
  expect(parseShguardDeny('rule `git-push-delete-refspec` hit (item 0, link 0, cmd 0) (ask_outcome = deny)')).toEqual({
    rule: 'git-push-delete-refspec',
  })
  expect(
    parseShguardDeny('no catalog row matches the command (item 0, link 0, cmd 0, word 0) (ask_outcome = deny)'),
  ).toEqual({ rule: '' })
  expect(parseShguardDeny('shguard cannot load its config or catalog: /x/config.toml: invalid TOML or schema')).toEqual({
    rule: '',
  })
  expect(parseShguardDeny('shguard: internal error')).toEqual({ rule: '' })
  expect(parseShguardDeny('matches blocklist rule "dotfiles-file-rm": rm deletes')).toBeUndefined()
  expect(parseShguardDeny('Exit code 1\nls: no such file')).toBeUndefined()
  expect(parseShguardDeny(undefined)).toBeUndefined()
})

test('a shguard deny tells the model to stop and repeat the command for /copy', async ($, on) => {
  stubEngine(on)
  on('classic.PreToolUse', () => ({ deny: 'rule `dotfiles-file-rm` hit (item 0, link 0, cmd 0)' }))
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

test('a find deny points at the Glob tool', async ($, on) => {
  stubEngine(on)
  on('classic.PreToolUse', () => ({
    deny: 'no catalog row matches the command (item 0, link 0, cmd 0, word 0) (ask_outcome = deny)',
  }))
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
