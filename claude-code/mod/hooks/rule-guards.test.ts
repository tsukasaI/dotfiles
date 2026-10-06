import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { commitMessage, messageProblem } from './rule-guards'

function stubGit(on: On, branch: string, origin: string): void {
  mock.env(on, { HOME: '/Users/me' })
  on('session.cwd', () => ({ value: '/Users/me/src/app' }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv.includes('rev-parse') ? `${branch}\n` : e.argv.includes('get-url') ? `${origin}\n` : '',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
}

test('commitMessage reads -m, --message= and heredoc forms, and gives up on the rest', async () => {
  expect(commitMessage('git commit -m "feat(x): add y"')).toBe('feat(x): add y')
  expect(commitMessage("git commit --message='fix: z'")).toBe('fix: z')
  expect(commitMessage(`git commit -m "$(cat <<'EOF'\nfeat(mod): a\n\nbody\nEOF\n)"`)).toBe('feat(mod): a\n\nbody')
  expect(commitMessage('git commit -F msg.txt')).toBeUndefined()
  expect(commitMessage('git commit --amend --no-edit')).toBeUndefined()
  expect(commitMessage('git commit -m "$SUBJECT"')).toBeUndefined()
  expect(commitMessage("git commit -m 'fix: cost $5'")).toBe('fix: cost $5')
  expect(commitMessage('git commit -m "$(git log -1 --format=%s)"')).toBeUndefined()
})

test('messageProblem enforces Conventional Commits and English', async () => {
  expect(messageProblem('feat(mod): add pane\n\nintent(mod): x')).toBeUndefined()
  expect(messageProblem('fix!: drop flag')).toBeUndefined()
  expect(messageProblem('Add pane')).toMatch(/Conventional/)
  expect(messageProblem('feat: ペインを追加')).toMatch(/Japanese/)
  expect(messageProblem('feat: add pane\n\n背景: なし')).toMatch(/Japanese/)
})

test('Agent without model is denied; with model or fork it runs', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const denied = await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'Explore' })
  expect(denied.deny).toMatch(/model/)
  const ran = await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', model: 'sonnet' })
  expect(ran.deny).toBeUndefined()
  const fork = await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'fork' })
  expect(fork.deny).toBeUndefined()
})

test('Agent whose definition pins a model runs without one', async ($, on) => {
  mock.env(on, { HOME: '/Users/me' })
  on('fs.read', () => ({ value: '---\nname: code-reviewer\nmodel: fable\n---\nbody' }))
  on('tool.call', () => ({ result: { ok: true } }))
  const ran = await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'code-reviewer' })
  expect(ran.deny).toBeUndefined()
})

test('commit on main outside dotfiles/ops is denied', async ($, on) => {
  stubGit(on, 'main', 'git@github.com:tsukasaI/app.git')
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })
  expect(ran.deny).toMatch(/branch \+ PR/)
})

test('commit on main in dotfiles runs; on a branch elsewhere runs', async ($, on) => {
  stubGit(on, 'main', 'git@github.com:tsukasaI/dotfiles.git')
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' })).deny).toBeUndefined()
})

test('a bad message is denied before anything runs', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "update stuff"' })
  expect(ran.deny).toMatch(/Conventional/)
})

const COMMIT_FORMS: Array<[string, string, string | undefined]> = [
  ['newline-separated', "git add a.ts\ngit commit -m 'wip stuff'", 'wip stuff'],
  ['git -c global option', "git -c a=b commit -m 'bad'", 'bad'],
  ['git -C and --no-pager', "git --no-pager -C ../x commit -m 'bad'", 'bad'],
  ['quoted -C path', `git -C "/p q" commit -m 'bad'`, 'bad'],
  ['quoted -c value', `git -c "user.name=A B" commit -m 'bad'`, 'bad'],
  ['--git-dir with a space', "git --git-dir .git commit -m 'bad'", 'bad'],
  ['--work-tree with a space', "git --work-tree ../x commit -m 'bad'", 'bad'],
  ['--namespace with a space', "git --namespace ns commit -m 'bad'", 'bad'],
  ['-am combined flag', "git commit -am 'wip stuff'", 'wip stuff'],
  ['-m"msg" attached', 'git commit -m"wip stuff"', 'wip stuff'],
  ['-mwip unquoted attached', 'git commit -mwip', 'wip'],
  ['single unquoted token', 'git commit -m wip', 'wip'],
  ['unquoted --message', 'git commit --message wip', 'wip'],
  ['--message=msg', "git commit --message='wip stuff'", 'wip stuff'],
  ['--mess abbreviation', "git commit --mess 'wip stuff'", 'wip stuff'],
  ['&& chain', "git add x && git commit -m 'wip'", 'wip'],
  ['-F - heredoc', "git commit -F - <<'EOF'\nwip stuff\nEOF", 'wip stuff'],
  ['--file=- heredoc', "git commit --file=- <<EOF\nwip stuff\nEOF", 'wip stuff'],
  ['-F /dev/stdin heredoc', "git commit -F /dev/stdin <<'EOF'\nwip stuff\nEOF", 'wip stuff'],
  ['--file=/dev/stdin heredoc', "git commit --file=/dev/stdin <<'EOF'\nwip stuff\nEOF", 'wip stuff'],
  ['-F - with flags before the heredoc', "git commit -F - --signoff <<'EOF'\nwip stuff\nEOF", 'wip stuff'],
  ['repeated -m', "git commit -m 'feat: x' -m 'more'", 'feat: x\n\nmore'],
  ['scoped past an earlier flag', "ls -lm 'x' && git commit -m 'wip'", 'wip'],
  [
    'flag names inside the message',
    'git commit -m "docs: mention -m, -am, --message and -F -"',
    'docs: mention -m, -am, --message and -F -',
  ],
  ['-am inside the message', 'git commit -m "fix(mod): handle -am forms"', 'fix(mod): handle -am forms'],
  ['-F - inside the message', 'git commit -m "feat: read -F - heredoc"', 'feat: read -F - heredoc'],
  [
    'escaped backquotes in the message',
    'git commit -m "fix(mod): drop \\`-C\\` skip"',
    'fix(mod): drop \\`-C\\` skip',
  ],
]

for (const [name, command, message] of COMMIT_FORMS) {
  test(`commit form: ${name}`, async ($, on) => {
    expect(commitMessage(command)).toBe(message)
    stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
    const ran = await $.tool.call({ tool: 'Bash', command })
    if (messageProblem(message ?? '') !== undefined) expect(ran.deny).toMatch(/Conventional/)
    else expect(ran.deny).toBeUndefined()
  })
}

test('every message is checked: a later Japanese -m is denied', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const ran = await $.tool.call({ tool: 'Bash', command: "git commit -m 'feat: x' -m '背景'" })
  expect(ran.deny).toMatch(/Japanese/)
})

test('a heredoc -m "$(cat <<EOF" message is read and checked', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const command = `git commit -m "$(cat <<'EOF'\nupdate stuff\nEOF\n)"`
  expect(commitMessage(command)).toBe('update stuff')
  expect((await $.tool.call({ tool: 'Bash', command })).deny).toMatch(/Conventional/)
})

test('an unreadable message flag is denied (fail closed)', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  for (const command of [
    'git commit -m "$SUBJECT"',
    'git commit -m $SUBJECT',
    'git commit --message',
    'git commit -am "$(date)"',
    'git commit -F -',
    'git commit -F /dev/stdin',
    'cat m | git commit -F -',
  ]) {
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect(ran.deny, command).toMatch(/not readable; use -m/)
  }
})

test('the unreadable-message deny names both readable forms', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "$SUBJECT"' })
  expect(ran.deny).toContain(`use -m '<msg>' or -m "$(cat <<'EOF' ... EOF)"`)
})

test('reusing or editing an existing message is not denied', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  for (const command of [
    'git commit --amend --no-edit',
    'git commit -F msg.txt',
    'git commit -C HEAD',
    'git commit -c HEAD',
  ]) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeUndefined()
  }
})

test('text that only looks like a commit does not trigger the guard', async ($, on) => {
  stubGit(on, 'main', 'git@github.com:tsukasaI/app.git')
  for (const command of [
    `cat > x.md <<'EOF'\nRepro:\ngit commit -m "wip"\nEOF`,
    "git commit-tree -m 'x' abc",
    'git commit-graph write',
  ]) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBeUndefined()
  }
})

test('an earlier -m flag is not read as the commit message', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const command = `ls -lm 'x' && git commit -m "feat: y"`
  expect(commitMessage(command)).toBe('feat: y')
  expect((await $.tool.call({ tool: 'Bash', command })).deny).toBeUndefined()
})

test('a real commit after an unrelated heredoc is still checked', async ($, on) => {
  stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
  const command = `cat > x.md <<'EOF'\ngit commit -m "feat: ok"\nEOF\ngit commit -m "update"`
  expect(commitMessage(command)).toBe('update')
  expect((await $.tool.call({ tool: 'Bash', command })).deny).toMatch(/Conventional/)
})

test('a cd before a newline-separated commit skips the branch check; plain and -c commits do not', async ($, on) => {
  stubGit(on, 'main', 'git@github.com:tsukasaI/app.git')
  const cd = await $.tool.call({ tool: 'Bash', command: 'cd ../other\ngit commit -m "feat: x"' })
  expect(cd.deny).toBeUndefined()
  const newline = await $.tool.call({ tool: 'Bash', command: 'git add a.ts\ngit commit -m "feat: x"' })
  expect(newline.deny).toMatch(/branch \+ PR/)
  const dashC = await $.tool.call({ tool: 'Bash', command: 'git -c a=b commit -m "feat: x"' })
  expect(dashC.deny).toMatch(/branch \+ PR/)
})

test('cd/-C commits skip the branch check', async ($, on) => {
  stubGit(on, 'main', 'git@github.com:tsukasaI/app.git')
  expect((await $.tool.call({ tool: 'Bash', command: 'git -C ../other commit -m "feat: x"' })).deny).toBeUndefined()
})
