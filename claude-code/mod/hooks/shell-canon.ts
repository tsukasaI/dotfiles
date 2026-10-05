import type { EngineInterface, On } from 'claude-code'

// Values safe to splice into a command unquoted or inside double quotes.
const SAFE_VALUE = /^[A-Za-z0-9/._-]+$/
const VAR = /^\$(?:\{(TMPDIR|HOME)\}|(TMPDIR|HOME)(?![A-Za-z0-9_]))/

export type CanonVars = { TMPDIR?: string; HOME?: string }

/**
 * Replaces `$TMPDIR`/`$HOME` (and `${...}`) with literal paths so shguard can
 * check the real target instead of denying an unresolved variable. Returns
 * the command unchanged whenever the rewrite might not be meaning-preserving:
 * a heredoc (its body's quoting rules differ), a command substitution or
 * backquote (quoting restarts inside it, which this linear scan doesn't
 * model), or an unsafe value. A variable inside single quotes or after a
 * backslash is left as written.
 */
export function canonicalize(command: string, vars: CanonVars): string {
  if (command.includes('<<') || command.includes('$(') || command.includes('`')) return command
  for (const value of Object.values(vars)) {
    if (value !== undefined && !SAFE_VALUE.test(value)) return command
  }

  let out = ''
  let quote: "'" | '"' | null = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === '\\' && quote !== "'") {
      out += command.slice(i, i + 2)
      i++
      continue
    }
    if (quote === null && (c === "'" || c === '"')) quote = c
    else if (quote === c) quote = null
    if (c === '$' && quote !== "'") {
      const m = VAR.exec(command.slice(i))
      const name = (m?.[1] ?? m?.[2]) as keyof CanonVars | undefined
      const value = name === undefined ? undefined : vars[name]
      if (m && value !== undefined) {
        out += value
        i += m[0].length - 1
        continue
      }
    }
    out += c
  }
  return out
}

let cachedVars: CanonVars | undefined

// The Bash sandbox's TMPDIR, not this process's: shguard matches the
// scratchpad prefix literally as /private/tmp/claude-<uid>/, so the host's
// /var/folders/... value would still be denied.
async function resolveVars($: EngineInterface): Promise<CanonVars> {
  if (cachedVars !== undefined) return cachedVars
  const found: CanonVars = {}
  const home = await $.env.get('HOME')
  if (home) found.HOME = home
  try {
    const { exitCode, stdout } = await $.process.run(['id', '-u'], { timeoutMs: 5000 })
    const tmp = `/private/tmp/claude-${stdout.trim()}`
    if (exitCode === 0 && (await $.fs.exists(tmp))) found.TMPDIR = tmp
  } catch {
    // No TMPDIR rewrite; shguard keeps denying $TMPDIR as before.
  }
  cachedVars = found
  return found
}

export function registerShellCanon(on: On): void {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = canonicalize(e.command, await resolveVars($))
    return next(command === e.command ? e : { ...e, command })
  })
}
