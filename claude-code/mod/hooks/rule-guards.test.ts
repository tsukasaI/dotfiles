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
  ['-am combined flag', "git commit -am 'wip stuff'", 'wip stuff'],
  ['-m"msg" attached', 'git commit -m"wip stuff"', 'wip stuff'],
  ['--message=msg', 'git commit --message=\'wip stuff\'', 'wip stuff'],
  ['&& chain', "git add x && git commit -m 'wip'", 'wip'],
]

for (const [name, command, message] of COMMIT_FORMS) {
  test(`commit form: ${name}`, async ($, on) => {
    expect(commitMessage(command)).toBe(message)
    stubGit(on, 'feat/x', 'git@github.com:tsukasaI/app.git')
    const ran = await $.tool.call({ tool: 'Bash', command })
    expect(ran.deny).toMatch(/Conventional/)
  })
}

test('newline-separated cd and git -c commits skip the branch check, plain ones do not', async ($, on) => {
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
