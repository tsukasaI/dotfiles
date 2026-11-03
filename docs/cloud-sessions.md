# Claude Code cloud sessions: shared config setup

Verified on 2026-11-03 in a Claude Code on the web session attached only to
`tsukasaI/dotfiles` (container user `root`, `HOME=/root`). How it's wired:
`claude-code/cloud/` and the "Cloud sessions" section of `CLAUDE.md`.

## Design

- The environment's setup-script box holds a bootstrap printed by
  `claude-code/cloud/pin.sh <commit>`: a commit SHA plus the sha256 of
  `cloud/setup.sh` and of `cloud/manifest.sha256` at that commit.
- `setup.sh` fetches the manifest and every file it lists from
  `raw.githubusercontent.com/tsukasaI/dotfiles/<sha>/claude-code/...`,
  verifies all digests, then installs into `~/.claude/`: `rules/`, `skills/`,
  `agents/`, and `CLAUDE.md` = `claude-code/CLAUDE.md` + `cloud/CLAUDE.cloud.md`.
  It also turns commit/tag signing off. The git identity comes from
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` in the environment's variables (see
  "Setup-script box, first real run" below for why not `~/.gitconfig`).
- Any fetch or digest failure installs nothing and exits 1; only a failure
  to turn signing off is a warning with exit 0 (reasons in `setup.sh`'s header).
- `tests/cloud-manifest-sync.sh` (CI job `cloud-manifest-sync`) fails when
  the manifest drifts from the tracked files; `--write` regenerates it.

## Skill and agent audit

| Item | Cloud | Why |
|---|---|---|
| skills/browser-test | excluded | needs the agent-browser MCP server (Mac only) |
| skills/diagram-explain | excluded | runs `diagram-render`, built by nix-darwin |
| skills/explain-plan | excluded | runs `explain-plan-render` (nix-darwin), builds on diagram-explain |
| skills/grill, handover, ja-lint | installed | no Mac-only dependency (ja-lint needs `python3`, present) |
| skills/triage, mkgoal, maintain-sweep | installed | their `gh issue ...` steps hit the GraphQL block; the overlay redirects to the GitHub tools / REST. Not exercised end to end |
| skills/review-gate | installed | its `gh pr merge` step is cancelled by the overlay |
| agents/* (7) | installed | Read/Grep/Glob/Bash/Web tools only; code-reviewer reads `~/.claude/skills/review-gate`, which is installed |

The list of exclusions lives in `claude-code/cloud/exclude.txt`.

## Verified in the VM

raw.githubusercontent.com serves a pinned commit, byte-identical to git:

```
$ curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' https://raw.githubusercontent.com/tsukasaI/dotfiles/82955217cd5e45dcb30b7015c7b5d3709ddbad7f/claude-code/rules/security.md
200 2240
$ curl -sS <same URL> | sha256sum; sha256sum claude-code/rules/security.md
0078a55675f0153e351b86d8bc160011b76db0f2a5f1e551d68f62c0e2b9d822  -
0078a55675f0153e351b86d8bc160011b76db0f2a5f1e551d68f62c0e2b9d822  claude-code/rules/security.md
```

Before setup, `~/.claude` already holds platform files, including
`skills/session-start-hook/` and `skills/synced/`; no `CLAUDE.md`, `rules/`
or `agents/`. `~/.gitconfig` comes from the image: `user.name=Claude`,
`user.email=noreply@anthropic.com`, `commit.gpgsign=true` with
`gpg.format=ssh`, `gpg.ssh.program=/tmp/code-sign`.

setup.sh runs (bootstrap pinned to branch commits 45eb390 and 5e393a0, with a
throwaway `HOME` first):

```
# first run and re-run: same file digests under ~/.claude both times
dotfiles-cloud: installed 43 files + CLAUDE.md from tsukasaI/dotfiles@45eb390... into .../h/.claude
exit 0
IDENTICAL
# wrong MANIFEST_SHA256 in the box: nothing installed
dotfiles-cloud: FAILED: manifest digest mismatch at 45eb390...
exit 1
# wrong SETUP_SHA256: setup.sh never runs
exit 1
# a branch name instead of a SHA
dotfiles-cloud: FAILED: arg 1 must be a full 40-hex commit SHA, got 'main'
exit 1
# a curl shim appending to rules/security.md after download: ~/.claude not created
rules/security.md: FAILED
dotfiles-cloud: FAILED: file digest mismatch at 45eb390...
exit 1
# re-run pinned to 5e393a0 (3 skills excluded): they are removed, a
# pre-existing skills/session-start-hook is left alone
installed 31 files + CLAUDE.md ...
grill handover ja-lint maintain-sweep mkgoal review-gate session-start-hook triage
```

Real run into `/root/.claude` (pinned to 5e393a0): exit 0, `CLAUDE.md`,
`rules/` (10), `agents/` (7) and 6 skills present next to the platform's
skills; `git config --global` shows `user.name tsukasa inoue`,
`user.email inoue.tsukasa.4@gmail.com`, `commit.gpgsign false`.
`python3 -I ~/.claude/skills/ja-lint/scripts/yomiyasu_lint.py <file>` runs
(exit 0).

The running session picked up the new skills without a restart: invoking
`ja-lint` right after setup returned `Unknown skill`; shortly after, the
session's skill list was refreshed with handover, ja-lint, mkgoal and
review-gate (the model-invocable ones), and the same invocation loaded
`/root/.claude/skills/ja-lint`. Path-scoped rules load too: editing
`CLAUDE.md` after setup attached `/root/.claude/rules/prompt-style.md`
(`paths: **/CLAUDE.md`) to the session. Unconditional rules and `CLAUDE.md`
are read at session start, so they can't be checked from this session.

GitHub from the VM:

```
$ gh api user --jq '{login,type}'
{"login":"tsukasaI","type":"User"}
$ gh api repos/tsukasaI/dotfiles --jq .permissions
{"admin":true,"maintain":true,"pull":true,"push":true,"triage":true}
$ gh pr list -R tsukasaI/dotfiles
HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API (gh api repos/{owner}/{repo}/...). ...
```

Opening a PR over REST works (it created tsukasaI/dotfiles#106):

```
$ gh api repos/tsukasaI/dotfiles/pulls -f title=... -f head=feat/cloud-session-config -f base=main -F body=@<file> --jq '.html_url,.number'
https://github.com/tsukasaI/dotfiles/pull/106
106
```

The session's GitHub credential acts as `tsukasaI` with admin rights, so a
ruleset that lets repository admins bypass also lets cloud sessions push to
main.

Commits pushed after setup carry the new identity and no signature, and the
proxy accepted the push:

```
$ git log -1 --format='%H %an <%ae> sig=%G?'
f974911ac917c739017107dbc62f8842e787dcab tsukasa inoue <inoue.tsukasa.4@gmail.com> sig=N
```

## Setup-script box, first real run (2026-11-03, environment `dotfiles-cloud`)

- Loading: after the manual run above, `/context` in the resumed session
  listed `/root/.claude/CLAUDE.md` and the five unconditional rules
  (`security`, `surgical-changes`, `user-handoff`, `git-sandbox`,
  `shell-tools`) as User memory files, the 7 agents as User agents, and
  handover/ja-lint/mkgoal/review-gate as User skills.
- With the box still empty, a new session's `~/.claude` had none of it and
  no `setup-script-failed` note. `~/.claude/skills/session-start-hook` kept
  the 00:28 mtime of the environment's first build while the other entries
  were 01:21, so the container came from that build's snapshot.
- With the bootstrap pasted into the box, a new session showed "Ran setup
  script" and `dotfiles-cloud: installed 31 files + CLAUDE.md from
  tsukasaI/dotfiles@78e4c21...`; `~/.claude/.dotfiles-cloud-files` had 31
  lines and `CLAUDE.md` ended with the cloud overlay.
- In that session `~/.gitconfig` (mtime 01:29) had `user.name Claude`,
  `user.email noreply@anthropic.com`, `user.signingkey` for the platform
  key, but `commit.gpgsign false` and `tag.gpgsign false`. setup.sh then set
  `user.name` first in one `&&` chain ahead of the gpgsign lines, so the
  platform rewrote `user.*` after the script and left `gpgsign` alone.
  Hence the identity moved to `GIT_AUTHOR_*`/`GIT_COMMITTER_*` environment
  variables, which git ranks above `~/.gitconfig`. Checked with a throwaway
  `HOME` whose `.gitconfig` says `Claude`: a commit made with those four
  variables set gave `author=tsukasa inoue <inoue.tsukasa.4@gmail.com>
  committer=tsukasa inoue <inoue.tsukasa.4@gmail.com> sig=N`.

## Setup-script box, `syntax error: unexpected end of file`

After pasting the `dd14f27` bootstrap (10 lines, byte-identical to
`pin.sh`'s output, `bash -n` clean), new sessions failed with
`/tmp/init-script-<n>.sh: line 20: syntax error: unexpected end of file`
(exit 2); the platform's SessionStart hook reported it and the session
still started. The temp script is deleted afterwards, so its bytes were not
seen. Converting the same 10 lines to CRLF reproduces the error
(`line 11`); line 20 would fit CRLF plus a prefix the platform adds, which
is unconfirmed. `pin.sh` now prints one-line commands that each end in
` #`, which ran to completion here with LF, with CRLF, and with CRLF after
nine extra lines; a wrong `SETUP_SHA256` under CRLF still exits 1 with
nothing installed. With that output pasted into the box, a new session's
`/context` listed `/root/.claude/CLAUDE.md` and the five unconditional rules
as memory files and all 7 agents, so the box path works end to end.
`/grill` (user-invoked only, so absent from `/context`) ran there too, and
an earlier box-built session's `git var GIT_AUTHOR_IDENT` and
`GIT_COMMITTER_IDENT` both started with
`tsukasa inoue <inoue.tsukasa.4@gmail.com>`.

## Not verified here

- raw.githubusercontent.com from a session whose repo is not dotfiles.
- triage/mkgoal/maintain-sweep running end to end with REST in place of
  `gh issue`.
