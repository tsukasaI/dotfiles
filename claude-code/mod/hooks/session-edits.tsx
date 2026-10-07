import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { EditEntry } from '../types'

const PANE = 'session-edits'
const COMMAND = 'edits'

const edits = atom({ plugin: 'dotfiles-mod', key: 'edits' } as const, [])
const status = atom({ plugin: 'dotfiles-mod', key: 'status' } as const, {})

// Paths under ~/dotfiles that setup.sh or settings.json do NOT wire into the
// running system, so an uncommitted edit there is not live.
const NOT_LIVE = ['docs/', '.claude/', 'tests/', '.github/']

// Every link_with_backup pair in setup.sh, as [path under $HOME, path under
// ~/dotfiles] (keep in sync with setup.sh). A hooks module cannot import
// node:fs, so these are explicit rather than resolved with realpath.
const SYMLINKED: ReadonlyArray<readonly [link: string, target: string]> = [
  ['.config/nvim', 'nvim'],
  ['.config/ghostty', 'ghostty'],
  ['.config/wezterm', 'wezterm'],
  ['.config/mise/config.toml', 'mise/config.toml'],
  ['.config/karabiner/karabiner.json', 'karabiner/karabiner.json'],
  ['.zshrc', 'zsh/zshrc'],
  ['.gitconfig', 'git/gitconfig'],
  ['.config/git/ignore', 'git/ignore'],
  ['.config/git/gitconfig-oss', 'git/gitconfig-oss'],
  ['.config/shguard/config.toml', 'claude-code/shguard/config.toml'],
  ['.ssh/config', 'ssh/config'],
  ['.claude/skills', 'claude-code/skills'],
  ['.claude/rules', 'claude-code/rules'],
  ['.claude/agents', 'claude-code/agents'],
  ['.claude/themes', 'claude-code/themes'],
  ['.claude/settings.json', 'claude-code/settings.json'],
  ['.claude/CLAUDE.md', 'claude-code/CLAUDE.md'],
]

// The path inside ~/dotfiles that `path` is, or is symlinked to; undefined
// when it is neither. A path with a `..` segment is never mapped through a link.
export function resolveRepoPath(path: string, home: string): string | undefined {
  const root = `${home}/dotfiles/`
  if (path.startsWith(root)) return path
  if (!home || path.split('/').includes('..')) return undefined
  for (const [link, target] of SYMLINKED) {
    const from = `${home}/${link}`
    if (path === from || path.startsWith(`${from}/`)) return `${root}${target}${path.slice(from.length)}`
  }
  return undefined
}

export function isLivePath(path: string, home: string): boolean {
  const repoPath = resolveRepoPath(path, home)
  if (repoPath === undefined) return false
  const rel = repoPath.slice(`${home}/dotfiles/`.length)
  return !NOT_LIVE.some(prefix => rel.startsWith(prefix))
}

// Mirrors lib/home-path.ts abbreviateHome; the plugin cannot import outside mod/.
function abbreviateHome(path: string, home: string): string {
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

async function statusOf($: EngineInterface, gitPath: string): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(
      ['git', 'status', '--porcelain=v1', '--', gitPath],
      { cwd: dirname(gitPath), timeoutMs: 5000 },
    )
    if (exitCode !== 0) return '-'
    const line = stdout.split('\n').find(l => l.length > 0)
    return line === undefined ? 'ok' : line.slice(0, 2).trim()
  } catch {
    return '-'
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const list = await read($, edits)
  const next: Record<string, string> = {}
  for (const { gitPath } of list) next[gitPath] = await statusOf($, gitPath)
  await update($, status, () => next)
}

export function registerSessionEdits(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the files this session edited and whether they are committed',
    })
    void $.ui.open({ id: PANE, title: 'Session edits' })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Session edits' })
    return { text: 'Session edits pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    let path: string | undefined
    if (e.tool === 'Edit' || e.tool === 'Write') path = e.file_path
    else if (e.tool === 'NotebookEdit') path = e.notebook_path
    if (path === undefined || ran.deny !== undefined || ran.isError === true) return ran

    const home = (await $.env.get('HOME')) ?? ''
    const gitPath = resolveRepoPath(path, home) ?? path
    const entry: EditEntry = { path, gitPath, isLive: isLivePath(path, home) }
    await update($, edits, list => [...list.filter(x => x.gitPath !== gitPath), entry])
    return ran
  })

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, edits)
    const codes = await read($, status)
    const cwd = await $.session.cwd()
    const home = (await $.env.get('HOME')) ?? ''
    const show = (p: string) =>
      p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : abbreviateHome(p, home)

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No edits yet.</Text>}
        {list.map(({ path, gitPath, isLive }) => {
          const code = codes[gitPath] ?? '…'
          const isDirty = code !== 'ok' && code !== '-' && code !== '…'
          return (
            <Box key={gitPath}>
              <Text color={isDirty ? 'warning' : undefined} dimColor={!isDirty}>
                {code.padEnd(3)}
              </Text>
              <Text dimColor={!isDirty}>{show(path)}</Text>
              {isLive && isDirty && (
                <Text color="error" bold>
                  {' '}LIVE
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
