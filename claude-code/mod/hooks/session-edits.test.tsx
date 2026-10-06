import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { isLivePath } from './session-edits'

const HOME = '/Users/me'
const SURFACES = ['terminal', 'desktop'] as const

// The engine nouns the module calls that the test kit leaves unanswered.
function stubEngine(on: On): void {
  mock.env(on, { HOME })
  on('session.cwd', () => ({ value: `${HOME}/dotfiles` }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
}

test('isLivePath: dotfiles is live except docs/.claude/tests/.github', async () => {
  expect(isLivePath(`${HOME}/dotfiles/claude-code/skills/x/SKILL.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/dotfiles/zsh/zshrc`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/dotfiles/docs/memo.md`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/dotfiles/.claude/plans/p.md`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/dotfiles/tests/a.sh`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/src/app/main.go`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/dotfilesX/a`, HOME)).toBe(false)
})

test('isLivePath: edits through the setup.sh symlinks under ~/.claude are live', async () => {
  expect(isLivePath(`${HOME}/.claude/rules/x.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/skills/a/SKILL.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/CLAUDE.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/settings.json`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.config/shguard/config.toml`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/rulesX/x.md`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/.claude/projects/p/s.jsonl`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}x/.claude/rules/x.md`, HOME)).toBe(false)
})

test('shows ~ only at a HOME path boundary', async ($, on) => {
  stubEngine(on)
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.tool.call({ tool: 'Write', file_path: `${HOME}bar/x.md`, content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/src/y.md`, content: 'y' })

  const ui = await $.ui.mount({
    plugin: 'dotfiles-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-edits',
    props: { title: 'Session edits', isFocused: false, bodyColumns: 80, placement: 'dock' },
  })
  expect(await ui.find({ type: 'Text', text: `${HOME}bar/x.md` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '~/src/y.md' })).toBeDefined()
  await ui.unmount()
})

test('records edits and shows dirty live files', async ($, on) => {
  stubEngine(on)
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.at(-1)?.endsWith('zshrc') ? ' M zsh/zshrc\n' : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))

  await $.tool.call({ tool: 'Edit', file_path: `${HOME}/dotfiles/zsh/zshrc`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/dotfiles/docs/memo.md`, content: 'x' })
  await $.tool.call({ tool: 'Edit', file_path: `${HOME}/dotfiles/zsh/zshrc`, old_string: 'b', new_string: 'c' })
  await $.command.run({ command: 'edits', args: '' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'dotfiles-mod',
      surface,
      component: 'Pane',
      requestId: 'session-edits',
      props: { title: 'Session edits', isFocused: false, bodyColumns: 80, placement: 'dock' },
    })
    expect(await ui.findAll({ type: 'Text', text: /zshrc/ })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: 'LIVE' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ok/ })).toBeDefined()
    await ui.unmount()
  }
})

test('ignores denied and errored edits', async ($, on) => {
  stubEngine(on)
  on('tool.call', () => ({ deny: 'no' }))
  await $.tool.call({ tool: 'Write', file_path: `${HOME}/dotfiles/zsh/zshrc`, content: 'x' })

  const ui = await $.ui.mount({
    plugin: 'dotfiles-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-edits',
    props: { title: 'Session edits', isFocused: false, bodyColumns: 80, placement: 'dock' },
  })
  expect(await ui.find({ type: 'Text', text: 'No edits yet.' })).toBeDefined()
  await ui.unmount()
})
