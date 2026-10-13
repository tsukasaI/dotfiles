import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { RunEntry, RunState } from '../types'
import { finishRun, formatElapsed, parseTaskNotifications, treeRows, truncate } from './running'

const SURFACES = ['terminal', 'desktop'] as const
const T0 = 1_000_000

function entry(over: Partial<RunEntry> & Pick<RunEntry, 'id'>): RunEntry {
  return { kind: 'bash', label: over.id, background: false, startedAt: T0, ...over }
}

// The engine nouns the module calls that the test kit leaves unanswered.
function stubEngine(on: On) {
  mock.env(on, { HOME: '/Users/me' })
  on('agent.list', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return mock.clock(on, { now: T0 })
}

// The texts a mounted pane draws, one string per Text.
async function paneTexts($: Engine, surface: (typeof SURFACES)[number] = 'terminal'): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'dotfiles-mod',
    surface,
    component: 'Pane',
    requestId: 'running',
    props: { title: 'Running', isFocused: false, bodyColumns: 80, placement: 'dock' },
  })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return texts
}

test('parseTaskNotifications reads id and status, one per notification', async () => {
  const one = '<task-notification>\n<task-id>a1f4</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<output-file>/x</output-file>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>'
  expect(parseTaskNotifications(one)).toEqual([{ taskId: 'a1f4', outcome: 'ok' }])
  expect(parseTaskNotifications(one.replace('completed', 'killed'))).toEqual([{ taskId: 'a1f4', outcome: 'killed' }])
  expect(parseTaskNotifications(one.replace('completed', 'failed'))).toEqual([{ taskId: 'a1f4', outcome: 'failed' }])
  expect(parseTaskNotifications(`${one}\n${one.replace('a1f4', 'b2')}`).map(n => n.taskId)).toEqual(['a1f4', 'b2'])
  expect(parseTaskNotifications('no markup here')).toEqual([])
})

test('parseTaskNotifications: a notification without a status does not borrow the next one', async () => {
  const text = '<task-id>a</task-id><summary>x</summary>\n<task-id>b</task-id><status>failed</status>'
  expect(parseTaskNotifications(text)).toEqual([{ taskId: 'b', outcome: 'failed' }])
})

test('formatElapsed and truncate', async () => {
  expect(formatElapsed(0)).toBe('0:00')
  expect(formatElapsed(65_900)).toBe('1:05')
  expect(formatElapsed(-5)).toBe('0:00')
  expect(truncate('abcdef', 6)).toBe('abcdef')
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(truncate('abcdef', 0)).toBe('')
})

test('treeRows hides a foreground Bash under 10s and indents children', async () => {
  const running = [
    entry({ id: 'a1', kind: 'agent' }),
    entry({ id: 'b1', parentId: 'a1', startedAt: T0 - 20_000 }),
    entry({ id: 'b2', parentId: 'a1', startedAt: T0 - 25_000 }),
    entry({ id: 'young', startedAt: T0 - 9_999 }),
    entry({ id: 'bg', background: true, startedAt: T0 }),
    entry({ id: 'orphan', parentId: 'gone', startedAt: T0 - 30_000 }),
  ]
  expect(treeRows(running, T0).map(r => `${r.prefix}${r.entry.id}`)).toEqual([
    'a1',
    '├─ b1',
    '└─ b2',
    'bg',
    'orphan',
  ])
  expect(treeRows(running, T0 + 1).some(r => r.entry.id === 'young')).toBe(true)
})

test('finishRun keeps the last 3 newest first and forgets a never-shown Bash', async () => {
  let state: RunState = { running: [], finished: [] }
  for (const id of ['a', 'b', 'c', 'd']) {
    state = { ...state, running: [entry({ id, startedAt: T0 - 20_000 })] }
    state = finishRun(state, id, 'ok', T0)
  }
  expect(state.finished.map(x => x.id)).toEqual(['d', 'c', 'b'])

  const quick = finishRun({ running: [entry({ id: 'q' })], finished: [] }, 'q', 'ok', T0 + 3_000)
  expect(quick).toEqual({ running: [], finished: [] })
  expect(finishRun(quick, 'missing', 'ok', T0)).toBe(quick)
})

test('an empty pane says nothing is running', async ($, on) => {
  stubEngine(on)
  for (const surface of SURFACES) expect(await paneTexts($, surface)).toEqual(['Nothing running.'])
})

test('a Bash under 10s never renders; over 10s it shows its elapsed time, then finishes', async ($, on) => {
  const clock = stubEngine(on)
  on('tool.call', { tool: 'Bash' }, async ($, e) => {
    await clock.sleep(e.command === 'sleep 2' ? 2_000 : 15_000)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  const quick = $.tool.call({ tool: 'Bash', command: 'sleep 2' })
  await clock.advance(2_000)
  await quick
  expect(await paneTexts($)).toEqual(['Nothing running.'])

  const slow = $.tool.call({ tool: 'Bash', command: 'sleep 15\necho hidden second line' })
  await clock.advance(5_000)
  expect((await paneTexts($)).join('|')).not.toMatch(/sleep 15/)
  await clock.advance(6_000)
  for (const surface of SURFACES) {
    const texts = await paneTexts($, surface)
    expect(texts.some(t => t.includes('● sleep 15') && !t.includes('hidden'))).toBe(true)
    expect(texts).toContain(' 0:11')
  }

  await clock.advance(4_000)
  await slow
  const done = await paneTexts($)
  expect(done.some(t => t.startsWith('✓ sleep 15') && t.endsWith(' 0:15'))).toBe(true)
})

test('a Bash result with backgroundTaskId shows a bg row at once', async ($, on) => {
  stubEngine(on)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bgtask1' },
  }))

  await $.tool.call({ tool: 'Bash', command: 'sleep 30', run_in_background: true })
  for (const surface of SURFACES) {
    const texts = await paneTexts($, surface)
    expect(texts.some(t => t.includes('● sleep 30'))).toBe(true)
    expect(texts).toContain(' bg 0:00')
  }
})

test('a Bash nested in an agent renders indented under it', async ($, on) => {
  const clock = stubEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ag1' }))
  on('tool.call', { tool: 'Bash' }, async () => {
    await clock.sleep(20_000)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  await $.agent.spawn({ prompt: 'p', description: 'scan repo', subagentType: 'Explore' })
  const nested = $.tool.call({ tool: 'Bash', command: 'sleep 20', agentId: 'ag1' })
  await clock.advance(12_000)

  const texts = await paneTexts($)
  expect(texts).toContain('● Explore · scan repo')
  expect(texts).toContain(' sonnet 0:12')
  expect(texts).toContain('└─ ● sleep 20')
  await clock.advance(8_000)
  await nested
})

test('a foreground Agent result ends the agent', async ($, on) => {
  stubEngine(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ag2' }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed', agentId: 'ag2' } }))

  await $.agent.spawn({ prompt: 'p', description: 'review', subagentType: 'code-reviewer' })
  expect(await paneTexts($)).toContain('● code-reviewer · review')

  await $.tool.call({ tool: 'Agent', description: 'review', prompt: 'p', model: 'sonnet' })
  const texts = await paneTexts($)
  expect(texts.some(t => t.startsWith('✓ code-reviewer · review'))).toBe(true)
  expect(texts).not.toContain('● code-reviewer · review')
})

test('a denied Bash is not recorded', async ($, on) => {
  stubEngine(on)
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'blocked' }))

  await $.tool.call({ tool: 'Bash', command: 'find .' })
  expect(await paneTexts($)).toEqual(['Nothing running.'])
})

test('the finished list is capped at 3, newest first', async ($, on) => {
  const clock = stubEngine(on)
  on('tool.call', { tool: 'Bash' }, async () => {
    await clock.sleep(12_000)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  for (const name of ['one', 'two', 'three', 'four']) {
    const call = $.tool.call({ tool: 'Bash', command: `sleep 12 # ${name}` })
    await clock.advance(12_000)
    await call
  }
  const texts = (await paneTexts($)).filter(t => t.startsWith('✓'))
  expect(texts.map(t => t.match(/# (\w+)/)?.[1])).toEqual(['four', 'three', 'two'])
})
