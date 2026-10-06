import type { EngineInterface, On } from 'claude-code'

// Repos where committing straight to main is the workflow (global CLAUDE.md).
const DIRECT_TO_MAIN = /[:/]tsukasaI\/(dotfiles|ops)(\.git)?$/
// Global options between `git` and the subcommand: `-c k=v`, `-C path`, `--no-pager`, `-P`,
// `--git-dir <path>`. Values may be quoted or space-separated.
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|\S+)`
const VALUE_LONG_OPTIONS = 'git-dir|work-tree|namespace|exec-path|config-env|attr-source'
const GIT_GLOBAL_OPTIONS = String.raw`(?:\s+(?:-[cC]\s+${VALUE}|--(?:${VALUE_LONG_OPTIONS})(?:=${VALUE}|\s+${VALUE})|--[\w-]+(?:=${VALUE})?|-\w+))*`
const GIT_COMMIT = new RegExp(String.raw`(^|[;&|(\n]\s*)git${GIT_GLOBAL_OPTIONS}\s+commit(?![\w-])`)
const SUBJECT = /^(feat|fix|refactor|chore|docs|test|perf|build|ci|style|revert)(\([^)]+\))?!?: \S/
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/
const HEREDOC_BODY = /(<<-?\s*['"]?(\w+)['"]?\n)([\s\S]*?)(\n\s*\2\b)/g
// A heredoc only counts as the message when its consumer is `-m "$(cat <<EOF`, or `-F - <<EOF`.
const HEREDOC_M =
  /(?:^|\s)(?:-[a-zA-Z]*m\s*|--m[a-z]*(?:=|\s+))"?\$\(\s*cat\s+<<-?\s*['"]?(?<tag>\w+)['"]?\n(?<body>[\s\S]*?)\n\s*\k<tag>\b(?:\s*\)"?)?/g
const HEREDOC_F =
  /(?:^|\s)(?:-F\s*-|--file(?:=|\s+)-)\s*<<-?\s*['"]?(?<tag>\w+)['"]?\n(?<body>[\s\S]*?)\n\s*\k<tag>\b/g
// `-m`, a combined short flag ending in `m` (`-am`), or `--message` / an abbreviation of it.
const MESSAGE_FLAG = /(?:^|\s)(?:-[a-zA-Z]*m|--m(?:e(?:s(?:s(?:a(?:g(?:e)?)?)?)?)?)?(?=[=\s]|$))/g
const FILE_STDIN = /(?:^|\s)(?:-F\s*-|--file(?:=|\s+)-)(?=\s|$)/g
const MESSAGE_VALUE =
  /(?:^|\s)(?:-[a-zA-Z]*m\s*|--m(?:e(?:s(?:s(?:a(?:g(?:e)?)?)?)?)?)?(?:=|\s+))(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"'`$;&|()<>\\]+))/g

/** Blanks heredoc bodies (same length) so text inside them can't look like commands or flags. */
function blankHeredocBodies(text: string): string {
  return text.replace(HEREDOC_BODY, (_m, head: string, _tag: string, body: string, end: string) =>
    head + body.replace(/[^\n]/g, ' ') + end,
  )
}

interface CommitCommand {
  /** The command with heredoc bodies blanked. */
  stripped: string
  /** The original text from the `git commit` match onward. */
  tail: string
}

function parseCommit(command: string): CommitCommand | undefined {
  const stripped = blankHeredocBodies(command)
  const match = GIT_COMMIT.exec(stripped)
  if (match === null) return undefined
  return { stripped, tail: command.slice(match.index + match[1].length) }
}

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

interface ReadMessage {
  message: string | undefined
  /** A message flag is present but its text can't be read statically. */
  unreadable: boolean
}

function readMessage(tail: string): ReadMessage {
  const parts: string[] = []
  const consume = (pattern: RegExp) => (text: string) =>
    text.replace(pattern, (...args) => {
      parts.push((args[args.length - 1] as { body: string }).body)
      return ' '
    })
  const rest = blankHeredocBodies(consume(HEREDOC_F)(consume(HEREDOC_M)(tail)))

  let expands = false
  let values = 0
  for (const m of rest.matchAll(MESSAGE_VALUE)) {
    values++
    // A double-quoted message with `$`/backquote expands at run time: unreadable here.
    if (m[1] !== undefined && /[$`]/.test(m[1])) expands = true
    else parts.push(m[1] ?? m[2] ?? m[3])
  }
  const flags = count(rest, MESSAGE_FLAG) + count(rest, FILE_STDIN)
  const unreadable = expands || flags > values
  return { message: unreadable || parts.length === 0 ? undefined : parts.join('\n\n'), unreadable }
}

/** The commit message a `git commit` command carries, when it can be read reliably. */
export function commitMessage(command: string): string | undefined {
  const parsed = parseCommit(command)
  return parsed === undefined ? undefined : readMessage(parsed.tail).message
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
    const commit = parseCommit(e.command)
    if (commit === undefined) return next(e)

    const { message, unreadable } = readMessage(commit.tail)
    if (unreadable) return { deny: "dotfiles-mod: commit message not readable; use -m '<msg>'." }
    const badMessage = message === undefined ? undefined : messageProblem(message)
    if (badMessage !== undefined) return { deny: `dotfiles-mod: ${badMessage}.` }

    // Which repo a `cd`/`-C` command, or a subagent (possibly in a worktree),
    // commits in can't be told from the session's cwd.
    if (e.agentId === undefined && !/(^|[;&|\n]\s*)cd\s|\s-C\s/.test(commit.stripped)) {
      const badBranch = await mainCommitProblem($)
      if (badBranch !== undefined) return { deny: `dotfiles-mod: ${badBranch}.` }
    }
    return next(e)
  })
}
