import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { PrReview } from '../types'

const prs = atom({ plugin: 'dotfiles-mod', key: 'prs' } as const, [])

const PR_CREATE = /\bgh\s+pr\s+create\b/
const PR_MERGE = /\bgh\s+pr\s+merge\b/
const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/
const AGENT_ID = /agentId:\s*([A-Za-z0-9_-]+)/
// A critical/high that names a finding's severity: at the start of a line
// (after a list marker or heading), in brackets, bold or parens, after
// "severity", or as a dash-separated field. A rating that qualifies a
// confidence ("high confidence", "confidence: **high**"), "high-level",
// "critical path", or a zero count ("Critical: 0") is not a severity.
const SEVERITY_NOTATION = new RegExp(
  '(?:^\\s*(?:[-*>]\\s+|\\d+[.)]\\s+)*|[[(]|\\*\\*|#+\\s+|\\s[—–]\\s*|\\s-\\s+|severity[\\s*_:=|/—–-]*)' +
    '(?<!confidence[\\s*_:=—–-]*\\**)' +
    '(?:critical(?!\\s+path\\b)|high)\\b' +
    '(?!-level\\b)(?!\\s+confidence\\b)(?!\\s*:?\\s*(?:0|none)\\b)',
  'i',
)
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_RATING = /^[\s*_`]*(critical|high|medium|low)[\s*_`]*$/i

function lineHasCriticalOrHigh(line: string): boolean {
  if (TABLE_ROW.test(line)) {
    // A severity column comes before the confidence column, so the first rating cell is the severity.
    const rating = line.split('|').map(c => TABLE_RATING.exec(c)?.[1]).find(r => r !== undefined)
    return rating !== undefined && /^(critical|high)$/i.test(rating)
  }
  return SEVERITY_NOTATION.test(line)
}

/**
 * Whether a code-reviewer report has a critical/high finding, judged from
 * severity notation only (the reviewer also rates confidence high/medium/low,
 * and prose says "no critical or high findings"). A guess from wording:
 * display only, never a gate.
 */
export function hasCriticalOrHigh(report: string): boolean {
  return report.split('\n').some(lineHasCriticalOrHigh)
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
      await update($, prs, list => {
        if (n !== undefined) return list.filter(p => p.number !== n)
        return list.length === 1 ? [] : list
      })
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
