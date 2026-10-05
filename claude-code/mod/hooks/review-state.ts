import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { PrReview } from '../types'

const prs = atom({ plugin: 'dotfiles-mod', key: 'prs' } as const, [])

const PR_CREATE = /\bgh\s+pr\s+create\b/
const PR_MERGE = /\bgh\s+pr\s+merge\b/
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/
const AGENT_ID = /agentId:\s*([A-Za-z0-9_-]+)/
const SEVERITY = /\b(critical|high)\b/gi

/**
 * Whether a code-reviewer report has a critical/high finding. The reviewer
 * also rates confidence high/medium/low, so a "high" right after
 * "confidence" doesn't count. A guess from wording: display only, never a gate.
 */
export function hasCriticalOrHigh(report: string): boolean {
  for (const m of report.matchAll(SEVERITY)) {
    const before = report.slice(Math.max(0, m.index - 20), m.index)
    if (!/confidence/i.test(before)) return true
  }
  return false
}

export function mergedNumber(command: string): number | undefined {
  const n = /\bgh\s+pr\s+merge\s+(?:https:\/\/\S+\/pull\/)?(\d+)\b/.exec(command)
  return n ? Number(n[1]) : undefined
}

export function registerReviewState(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (PR_CREATE.test(e.command)) {
      const url = PR_URL.exec(ran.text ?? '')
      if (url) {
        const pr: PrReview = { url: url[0], number: Number(url[1]), review: 'none', reviewer: '' }
        await update($, prs, list => [...list.filter(p => p.url !== pr.url), pr])
      }
    } else if (PR_MERGE.test(e.command)) {
      const n = mergedNumber(e.command)
      await update($, prs, list =>
        n !== undefined ? list.filter(p => p.number !== n) : list.length === 1 ? [] : list,
      )
    }
    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.subagent_type !== 'code-reviewer' || ran.deny !== undefined || ran.isError === true) return ran

    const text = ran.text ?? ''
    // A background launch reports only its id; the verdict comes later.
    const isLaunchOnly = /launched successfully/i.test(text)
    const review: PrReview['review'] = isLaunchOnly ? 'running' : hasCriticalOrHigh(text) ? 'blocking' : 'clear'
    const reviewer = AGENT_ID.exec(text)?.[1] ?? ''
    await update($, prs, list =>
      list.length === 0 ? list : [...list.slice(0, -1), { ...list[list.length - 1], review, reviewer }],
    )
    return ran
  })

  // A background reviewer's verdict: its own turn ending, read from its transcript.
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const list = await read($, prs)
    if (!list.some(p => p.reviewer === id && p.review === 'running')) return next(e)

    const found = await $.session.messages({ agentId: id })
    if (!('deny' in found)) {
      const last = [...found].reverse().find(m => m.role === 'assistant')
      if (last !== undefined) {
        const review = hasCriticalOrHigh(last.text) ? 'blocking' : 'clear'
        await update($, prs, all => all.map(p => (p.reviewer === id ? { ...p, review } : p)))
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    await update($, prs, list =>
      list.map(p => (p.reviewer !== '' && p.reviewer === e.to ? { ...p, review: 'running' } : p)),
    )
    return ran
  })
}
