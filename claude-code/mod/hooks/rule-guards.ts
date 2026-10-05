import type { EngineInterface, On } from 'claude-code'

// Repos where committing straight to main is the workflow (global CLAUDE.md).
const DIRECT_TO_MAIN = /[:/]tsukasaI\/(dotfiles|ops)(\.git)?$/
const GIT_COMMIT = /(^|[;&|(]\s*)git\s+commit\b/
const SUBJECT = /^(feat|fix|refactor|chore|docs|test|perf|build|ci|style|revert)(\([^)]+\))?!?: \S/
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1\b/
const QUOTED_M = /(?:^|\s)(?:-m|--message)(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/

/** The commit message a `git commit` command carries, when it can be read reliably. */
export function commitMessage(command: string): string | undefined {
  if (!/(?:^|\s)(?:-m|--message)\b/.test(command)) return undefined
  const heredoc = HEREDOC.exec(command)
  if (heredoc) return heredoc[2]
  const quoted = QUOTED_M.exec(command)
  if (quoted === null) return undefined
  const text = quoted[1] ?? quoted[2]
  // A double-quoted message with `$`/backquote expands at run time: unreadable here.
  return quoted[1] !== undefined && /[$`]/.test(text) ? undefined : text
}

export function messageProblem(message: string): string | undefined {
  const subject = message.split('\n')[0].trim()
  if (!SUBJECT.test(subject)) {
    return `subject "${subject}" is not Conventional Commits (\`<type>(<scope>): <description>\`)`
  }
  if (JAPANESE.test(message)) return 'the message contains Japanese; commit messages are English only'
  return undefined
}

async function hasModelFrontmatter($: EngineInterface, type: string): Promise<boolean> {
  const home = await $.env.get('HOME')
  if (!home || !/^[A-Za-z0-9_-]+$/.test(type)) return false
  try {
    const text = await $.fs.read(`${home}/.claude/agents/${type}.md`)
    return typeof text === 'string' && /^---\n[\s\S]*?^model:\s*\S/m.test(text)
  } catch {
    return false
  }
}

async function mainCommitProblem($: EngineInterface): Promise<string | undefined> {
  const cwd = await $.session.cwd()
  const branch = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 5000 })
  if (branch.exitCode !== 0) return undefined
  const name = branch.stdout.trim()
  if (name !== 'main' && name !== 'master') return undefined
  const origin = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd, timeoutMs: 5000 })
  if (origin.exitCode === 0 && DIRECT_TO_MAIN.test(origin.stdout.trim())) return undefined
  return `this repo commits through a branch + PR, but HEAD is ${name}: create \`<type>/<short-slug>\` first`
}

export function registerRuleGuards(on: On): void {
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.model !== undefined || e.subagent_type === 'fork') return next(e)
    if (e.subagent_type !== undefined && (await hasModelFrontmatter($, e.subagent_type))) return next(e)
    return {
      deny:
        'dotfiles-mod: pass `model:` explicitly (default `sonnet`; escalate only per the Model behavior ' +
        'rule in CLAUDE.md). Re-issue the same call with `model` set.',
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!GIT_COMMIT.test(e.command)) return next(e)

    const message = commitMessage(e.command)
    const badMessage = message === undefined ? undefined : messageProblem(message)
    if (badMessage !== undefined) return { deny: `dotfiles-mod: ${badMessage}.` }

    // Which repo a `cd`/`-C` command, or a subagent (possibly in a worktree),
    // commits in can't be told from the session's cwd.
    if (e.agentId === undefined && !/(^|[;&|]\s*)cd\s|\s-C\s/.test(e.command)) {
      const badBranch = await mainCommitProblem($)
      if (badBranch !== undefined) return { deny: `dotfiles-mod: ${badBranch}.` }
    }
    return next(e)
  })
}
