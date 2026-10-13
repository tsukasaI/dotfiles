import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, On } from 'claude-code'

import type { RunEntry, RunState } from '../types'

const PANE = 'running'
const COMMAND = 'running'
const TICK_MS = 1000
const HIDE_BELOW_MS = 10_000
const KEEP_FINISHED = 3
const STALE_MS = 3_600_000

type Outcome = NonNullable<RunEntry['outcome']>

// One atom for both lists: a finish moves an entry between them in one write.
const runs = atom({ plugin: 'dotfiles-mod', key: 'runs' } as const, { running: [], finished: [] })
const ticking = atom({ plugin: 'dotfiles-mod', key: 'ticking' } as const, false)

// Tempered `.`: a notification without a status must not borrow the next one's.
const NOTIFICATION =
  /<task-id>([^<]+)<\/task-id>(?:(?!<task-id>)[\s\S])*?<status>(completed|failed|killed)<\/status>/g
const STATUS_OUTCOME: Record<string, Outcome> = { completed: 'ok', failed: 'failed', killed: 'killed' }

export function parseTaskNotifications(text: string): { taskId: string; outcome: Outcome }[] {
  return [...text.matchAll(NOTIFICATION)].map(m => ({
    taskId: (m[1] ?? '').trim(),
    outcome: STATUS_OUTCOME[m[2] ?? ''] ?? 'failed',
  }))
}

export function startRun(state: RunState, entry: RunEntry): RunState {
  return { ...state, running: [...state.running.filter(x => x.id !== entry.id), entry] }
}

export function dropRun(state: RunState, id: string): RunState {
  return { ...state, running: state.running.filter(x => x.id !== id) }
}

export function rekeyRun(state: RunState, id: string, to: string): RunState {
  return { ...state, running: state.running.map(x => (x.id === id ? { ...x, id: to, background: true } : x)) }
}

// A foreground Bash is hidden until it has run HIDE_BELOW_MS: most finish before anyone looks.
export function isShown(entry: RunEntry, now: number): boolean {
  return entry.kind === 'agent' || entry.background || now - entry.startedAt >= HIDE_BELOW_MS
}

// An entry that was never shown leaves without a trace, not as a finished row.
export function finishRun(state: RunState, id: string, outcome: Outcome, endedAt: number): RunState {
  const entry = state.running.find(x => x.id === id)
  if (entry === undefined) return state
  const running = state.running.filter(x => x !== entry)
  if (!isShown(entry, endedAt)) return { ...state, running }
  return { running, finished: [{ ...entry, endedAt, outcome }, ...state.finished].slice(0, KEEP_FINISHED) }
}

export type Row = { entry: RunEntry; prefix: string }

// Children sit under their parent agent; one whose parent is not shown goes to the root.
export function treeRows(running: readonly RunEntry[], now: number): Row[] {
  const shown = running.filter(x => isShown(x, now))
  const ids = new Set(shown.map(x => x.id))
  const rows: Row[] = []
  const walk = (parent: string | undefined, trail: string): void => {
    const kids = shown.filter(x =>
      parent === undefined ? x.parentId === undefined || !ids.has(x.parentId) : x.parentId === parent,
    )
    kids.forEach((entry, i) => {
      const isLast = i === kids.length - 1
      rows.push({ entry, prefix: parent === undefined ? '' : `${trail}${isLast ? '└─ ' : '├─ '}` })
      walk(entry.id, parent === undefined ? '' : `${trail}${isLast ? '   ' : '│  '}`)
    })
  }
  walk(undefined, '')
  return rows
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return max <= 1 ? text.slice(0, Math.max(0, max)) : `${text.slice(0, max - 1)}…`
}

function firstLine(command: string): string {
  return command.split('\n')[0]?.trim() ?? ''
}

function backgroundTaskId(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const id = (result as { backgroundTaskId?: unknown }).backgroundTaskId
  return typeof id === 'string' && id !== '' ? id : undefined
}

function completedAgentId(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const { status, agentId } = result as { status?: unknown; agentId?: unknown }
  return status === 'completed' && typeof agentId === 'string' ? agentId : undefined
}

async function listAgents($: EngineInterface): Promise<AgentInfo[]> {
  try {
    return await $.agent.list()
  } catch {
    // Agent status only refines the pane; drawing without it is still correct.
    return []
  }
}

// Not rethrown: a failure in the bookkeeping must never fail the tool call it watches.
async function observe(work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch {}
}

async function settle($: EngineInterface, id: string, outcome: Outcome): Promise<void> {
  await observe(async () => {
    const endedAt = await $.clock.now()
    await update($, runs, state => finishRun(state, id, outcome, endedAt))
  })
}

async function reconcile($: EngineInterface): Promise<void> {
  const status = new Map((await listAgents($)).map(a => [a.id, a.status]))
  const now = await $.clock.now()
  await update($, runs, state => {
    let next = state
    for (const entry of state.running) {
      const s = status.get(entry.id)
      if (s === 'completed') next = finishRun(next, entry.id, 'ok', now)
      else if (s === 'failed' || s === 'killed') next = finishRun(next, entry.id, s, now)
      // Nothing reports the end of a Workflow agent or a lost task; this ends the row.
      else if (s === undefined && now - entry.startedAt > STALE_MS) next = dropRun(next, entry.id)
    }
    return next
  })
}

async function ensureTicker($: EngineInterface): Promise<void> {
  if (await read($, ticking)) return
  await update($, ticking, () => true)
  const timer = $.clock.every(TICK_MS, async () => {
    await reconcile($)
    if ((await read($, runs)).running.length === 0) {
      timer.cancel()
      await update($, ticking, () => false)
      return
    }
    $.ui.invalidate('ui.render')
  })
}

async function track($: EngineInterface, entry: Omit<RunEntry, 'startedAt'>): Promise<void> {
  await observe(async () => {
    const startedAt = await $.clock.now()
    await update($, runs, state => startRun(state, { ...entry, startedAt }))
    await ensureTicker($)
  })
}

export function registerRunning(on: On): void {
  // The matcher keeps this distinct from session-edits' unmatched
  // session.start (one event may not be registered twice without one);
  // the command and its pane only mean anything at an interactive prompt.
  on('session.start', { isInteractive: true }, async ($, e, next) => {
    await update($, ticking, () => false)
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Show the running subagents and long-running commands',
      })
    } catch (err) {
      $.ui.log(`dotfiles-mod: /${COMMAND} not registered: ${String(err)}`, { to: 'debug' })
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await $.ui.open({ id: PANE, title: 'Running' })
    return { text: 'Running pane opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.agentId === undefined) return ran
    await track($, {
      kind: 'agent',
      id: ran.agentId,
      label: `${e.subagentType} · ${e.description}`,
      model: ran.model,
      parentId: e.parentAgentId,
      background: e.background,
    })
    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    const id = ran.deny === undefined ? completedAgentId(ran.result) : undefined
    if (id !== undefined) await settle($, id, 'ok')
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await track($, {
      kind: 'bash',
      id: e.tool_use_id,
      label: firstLine(e.command),
      parentId: e.agentId,
      background: false,
    })
    let ran
    try {
      ran = await next(e)
    } catch (err) {
      await observe(() => update($, runs, state => dropRun(state, e.tool_use_id)))
      throw err
    }
    const taskId = ran.deny === undefined ? backgroundTaskId(ran.result) : undefined
    if (ran.deny !== undefined) await observe(() => update($, runs, state => dropRun(state, e.tool_use_id)))
    else if (taskId !== undefined) await observe(() => update($, runs, state => rekeyRun(state, e.tool_use_id, taskId)))
    else await settle($, e.tool_use_id, ran.isError === true ? 'failed' : 'ok')
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      for (const { taskId, outcome } of parseTaskNotifications(e.text)) await settle($, taskId, outcome)
    }
    return next(e)
  })

  // Per reason, not unmatched: the loader refuses a second unmatched turn.complete in the mod.
  for (const reason of ['answer', 'aborted', 'refusal', 'error'] as const) {
    on('turn.complete', { reason }, async ($, e, next) => {
      if (e.agentId !== undefined) await settle($, e.agentId, reason === 'answer' ? 'ok' : 'failed')
      return next(e)
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const { running, finished } = await read($, runs)
    const now = await $.clock.now()
    const idle = new Set(
      (await listAgents($)).filter(a => a.status === 'waiting' || a.status === 'idle').map(a => a.id),
    )
    const rows = treeRows(running, now)
    const width = e.props.bodyColumns

    return (
      <Box flexDirection="column">
        {rows.length === 0 && <Text dimColor>Nothing running.</Text>}
        {rows.map(({ entry, prefix }) => {
          const tail = `${entry.model ? ` ${entry.model}` : ''}${entry.background ? ' bg' : ''} ${formatElapsed(now - entry.startedAt)}`
          const head = `${prefix}${idle.has(entry.id) ? '◌' : '●'} `
          return (
            <Box key={entry.id}>
              <Text>{head + truncate(entry.label, width - head.length - tail.length)}</Text>
              <Text dimColor>{tail}</Text>
            </Box>
          )
        })}
        {finished.length > 0 && <Text dimColor>{'─'.repeat(Math.max(0, Math.min(width, 24)))}</Text>}
        {finished.map(entry => {
          const tail = ` ${formatElapsed((entry.endedAt ?? entry.startedAt) - entry.startedAt)}`
          const head = `${entry.outcome === 'ok' ? '✓' : '✗'} `
          return (
            <Text key={`${entry.id}@${entry.endedAt}`} dimColor color={entry.outcome === 'ok' ? undefined : 'error'}>
              {head + truncate(entry.label, width - head.length - tail.length) + tail}
            </Text>
          )
        })}
      </Box>
    )
  })
}
