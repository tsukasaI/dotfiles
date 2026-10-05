import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

const KEEP = 3

const blocked = atom({ plugin: 'dotfiles-mod', key: 'blocked' } as const, [])
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

const NOTE =
  'dotfiles-mod: this command is now shown to the user above the prompt as `! <command>`. ' +
  'Do not route around the block with an equivalent command; use an allowed tool if one ' +
  'genuinely fits, otherwise stop and let the user run it.'

export function parseShguardDeny(text: string | undefined): { rule: string } | undefined {
  if (text === undefined || !SHGUARD_DENY.test(text)) return undefined
  return { rule: RULE.exec(text)?.[1] ?? '' }
}

export function registerBlockedBand(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError !== true) return ran
    const hit = parseShguardDeny(ran.text)
    if (hit === undefined) return ran

    await update($, blocked, list =>
      [...list.filter(b => b.command !== e.command), { command: e.command, rule: hit.rule }].slice(-KEEP),
    )
    return { ...ran, context: [...(ran.context ?? []), NOTE] }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, blocked, () => [])
    return next(e)
  })
}

export function registerBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, blocked)
    const reviews = await read($, prs)
    if (e.props.hasSurvey || (list.length === 0 && reviews.length === 0)) return next(e)

    const { Box, Button, Code, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {reviews.map(p => (
          <Text key={p.url} color={p.review === 'blocking' ? 'error' : p.review === 'clear' ? 'success' : 'warning'}>
            PR #{p.number}: {REVIEW_LABEL[p.review]}
            {p.reviewer ? ` (reviewer ${p.reviewer})` : ''}
          </Text>
        ))}
        {list.map(b => (
          <Box key={b.command} flexDirection="column">
            <Text color="error">blocked{b.rule ? ` by ${b.rule}` : ''}: run it yourself if it is needed</Text>
            <Code source={`! ${b.command}`} language="bash" />
          </Box>
        ))}
        {list.length > 0 && (
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, blocked, () => [])} />
        )}
      </Box>
    )
  })
}
