import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

// Written by review-state.ts; read here so one hook draws the whole band.
const prs = atom({ plugin: 'dotfiles-mod', key: 'prs' } as const, [])

const REVIEW_LABEL = {
  none: 'not reviewed',
  running: 'review running',
  blocking: 'critical/high finding',
  clear: 'no critical/high',
} as const

// shguard's deny wording, both rule hits and unresolved-argument floors.
const SHGUARD_DENY = /matches (?:blocklist )?rule "|could not be resolved to Allow|ask_outcome = "deny"/
const RULE = /rule "([^"]+)"/
// Rules that only steer toward a gitignore-aware tool (find → fd);
// nothing unsafe is being stopped, so the model just switches tools.
const TOOL_POLICY = /^dotfiles-tool-policy-/

const NOTE =
  'dotfiles-mod: do not route around the block with an equivalent shell command (`unlink` for ' +
  '`rm`, piping around it). If a dedicated tool (Read, Grep, Glob, Edit, Write) does the job, use ' +
  'it; otherwise stop and let the user run it. When you stop, repeat the blocked command verbatim ' +
  'in a fenced bash code block in your reply: the user copies it from there with /copy.'

const TOOL_POLICY_NOTE =
  'dotfiles-mod: this is a tool-preference rule, not a safety block. Retry right away with ' +
  'the tool the reason names (fd or the Glob tool for find).'

export function parseShguardDeny(text: string | undefined): { rule: string } | undefined {
  if (text === undefined || !SHGUARD_DENY.test(text)) return undefined
  return { rule: RULE.exec(text)?.[1] ?? '' }
}

export function registerDenyNote(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError !== true) return ran
    const hit = parseShguardDeny(ran.text)
    if (hit === undefined) return ran
    const note = TOOL_POLICY.test(hit.rule) ? TOOL_POLICY_NOTE : NOTE
    return { ...ran, context: [...(ran.context ?? []), note] }
  })
}

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reviews = await read($, prs)
    if (e.props.hasSurvey || reviews.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {reviews.map(p => (
          <Text key={p.url} color={p.review === 'blocking' ? 'error' : p.review === 'clear' ? 'success' : 'warning'}>
            PR #{p.number}: {REVIEW_LABEL[p.review]}
            {p.reviewer ? ` (reviewer ${p.reviewer})` : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
