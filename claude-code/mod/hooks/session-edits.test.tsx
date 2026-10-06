import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { isLivePath, resolveRepoPath } from './session-edits'

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

test('isLivePath: edits through the setup.sh symlinks are live', async () => {
  expect(isLivePath(`${HOME}/.claude/rules/x.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/skills/a/SKILL.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/CLAUDE.md`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/settings.json`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.config/shguard/config.toml`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.config/nvim/init.lua`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.zshrc`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.ssh/config`, HOME)).toBe(true)
  expect(isLivePath(`${HOME}/.claude/rulesX/x.md`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}/.claude/projects/p/s.jsonl`, HOME)).toBe(false)
  expect(isLivePath(`${HOME}x/.claude/rules/x.md`, HOME)).toBe(false)
})

test('resolveRepoPath: maps links to dotfiles, never through `..`', async () => {
  expect(resolveRepoPath(`${HOME}/.claude/rules/x.md`, HOME)).toBe(`${HOME}/dotfiles/claude-code/rules/x.md`)
  expect(resolveRepoPath(`${HOME}/.claude/settings.json`, HOME)).toBe(`${HOME}/dotfiles/claude-code/settings.json`)
  expect(resolveRepoPath(`${HOME}/dotfiles/zsh/zshrc`, HOME)).toBe(`${HOME}/dotfiles/zsh/zshrc`)
  expect(resolveRepoPath(`${HOME}/.claude/rules/../projects/p`, HOME)).toBeUndefined()
  expect(resolveRepoPath(`${HOME}/src/a.go`, HOME)).toBeUndefined()
  expect(isLivePath(`${HOME}/.claude/rules/../projects/p`, HOME)).toBe(false)
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

// An edit through a symlink must run git against the resolved repo path: the
// link itself is outside any repository (file links) or rejected as outside
// the repository (directory links).
for (const [edited, repoDir, repoPath] of [
  [`${HOME}/.claude/rules/x.md`, `${HOME}/dotfiles/claude-code/rules`, `${HOME}/dotfiles/claude-code/rules/x.md`],
  [`${HOME}/.claude/settings.json`, `${HOME}/dotfiles/claude-code`, `${HOME}/dotfiles/claude-code/settings.json`],
] as const) {
  test(`runs git status on the resolved path for ${edited}`, async ($, on) => {
    stubEngine(on)
    on('tool.call', () => ({ result: { ok: true } }))
    const calls: { argv: readonly string[]; cwd: string | undefined }[] = []
    on('process.run', ($, e) => {
      calls.push({ argv: e.argv, cwd: e.init?.cwd })
      return {
        value: {
          exitCode: 0,
          stdout: e.argv.at(-1) === repoPath ? ` M ${repoPath}\n` : '',
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })

    await $.tool.call({ tool: 'Edit', file_path: edited, old_string: 'a', new_string: 'b' })
    await $.command.run({ command: 'edits', args: '' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.cwd).toBe(repoDir)
    expect(calls[0]?.argv.at(-1)).toBe(repoPath)

    const ui = await $.ui.mount({
      plugin: 'dotfiles-mod',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'session-edits',
      props: { title: 'Session edits', isFocused: false, bodyColumns: 80, placement: 'dock' },
    })
    expect(await ui.find({ type: 'Text', text: 'LIVE' })).toBeDefined()
    await ui.unmount()
  })
}

test('dedupes a link edit and the same file edited by its repo path', async ($, on) => {
  stubEngine(on)
  on('tool.call', () => ({ result: { ok: true } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: ' M x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.tool.call({ tool: 'Edit', file_path: `${HOME}/.claude/rules/x.md`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: `${HOME}/dotfiles/claude-code/rules/x.md`, old_string: 'b', new_string: 'c' })
  await $.command.run({ command: 'edits', args: '' })

  const ui = await $.ui.mount({
    plugin: 'dotfiles-mod',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'session-edits',
    props: { title: 'Session edits', isFocused: false, bodyColumns: 80, placement: 'dock' },
  })
  expect(await ui.findAll({ type: 'Text', text: /x\.md/ })).toHaveLength(1)
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
