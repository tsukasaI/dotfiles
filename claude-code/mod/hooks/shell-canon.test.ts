import { expect, mock, test } from 'claude-code/testing'

import { canonicalize } from './shell-canon'

const VARS = { TMPDIR: '/private/tmp/claude-501', HOME: '/Users/me' }

test('rewrites unquoted and double-quoted variables', async () => {
  const cases: [string, string][] = [
    ['ls $TMPDIR/x', 'ls /private/tmp/claude-501/x'],
    ['cat "${TMPDIR}/a b"', 'cat "/private/tmp/claude-501/a b"'],
    ['cd $HOME && ls', 'cd /Users/me && ls'],
    ['gh pr create --body-file $TMPDIR/body.md', 'gh pr create --body-file /private/tmp/claude-501/body.md'],
  ]
  for (const [input, want] of cases) expect(canonicalize(input, VARS)).toBe(want)
})

test('leaves the command alone where the rewrite could change meaning', async () => {
  const unchanged = [
    "echo '$HOME'",
    'echo \\$HOME',
    'echo $HOMEDIR',
    'echo $TMPDIR_X',
    "cat <<'EOF'\n$HOME\nEOF",
    "echo \"$(printf '%s' '$HOME')\"",
    'echo `echo $HOME`',
    'echo $USER',
  ]
  for (const input of unchanged) expect(canonicalize(input, VARS)).toBe(input)
})

test('skips the rewrite when a value is not shell-safe', async () => {
  expect(canonicalize('ls $HOME', { HOME: '/Users/a b' })).toBe('ls $HOME')
  expect(canonicalize('ls $HOME', { HOME: '/x;rm' })).toBe('ls $HOME')
})

test('rewrites only the variables it knows', async () => {
  expect(canonicalize('ls $TMPDIR $HOME', { HOME: '/Users/me' })).toBe('ls $TMPDIR /Users/me')
})

test('reaches shguard (beneath the plugin) rewritten', async ($, on) => {
  mock.env(on, { HOME: '/Users/me' })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '501\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.exists', () => ({ value: true }))
  const seen: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    seen.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  await $.tool.call({ tool: 'Bash', command: "echo '$HOME' $HOME $TMPDIR/x" })
  expect(seen).toEqual(["echo '$HOME' /Users/me /private/tmp/claude-501/x"])
})
