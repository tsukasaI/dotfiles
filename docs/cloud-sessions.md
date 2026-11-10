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
- Any fetch or digest failure installs nothing and exits 1; a failure to turn
  signing off or to install a tool is a warning with exit 0 (reasons in
  `setup.sh`'s header).
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

The environment was later renamed `personal-dev` (see `claude-code/cloud/CLAUDE.md`).

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

## Other repositories (2026-11-04, shguard and staygreen sessions)

Both ran the bootstrap and reached raw.githubusercontent.com (200):
`~/.claude/.dotfiles-cloud-files` had 31 lines and `git var GIT_AUTHOR_IDENT`
gave the owner's identity. Other results:

- shguard: `cargo test --workspace` passed in 29 s with the pinned Rust 1.96.1.
  The submodule was uninitialised at start; `git submodule update --init
  --depth 1` cloned it, though `gh api` for that repository returned 403
  because it wasn't attached to the session.
- staygreen: corepack resolved `pnpm@11.9.0`; `pnpm install --frozen-lockfile`
  took 9 s, and typecheck and 588 tests passed. `prepare` installed lefthook's
  git hooks, whose pre-commit needs gitleaks and pre-push needs gitleaks and
  atlas, none of them in the image. Hence setup.sh installs them.
- `github.com/NixOS/nixpkgs/archive/...` returned 403 and `cache.nixos.org` 200.
  The nix CLI is present, but flake inputs are not expected to resolve
  (`nix develop` itself was not run), so proofs stay in CI.

Pins in setup.sh are renewed by hand when the bootstrap is renewed; nothing
watches them. The atlas digest came from the publisher's `.sha256` next to the
binary, the non-community build, which is what `ariga/tap/atlas` installs on
the Mac (the last part is unverified).

## Tool installs, first real run (2026-11-04, staygreen session)

With `atlasbinaries.com` allowed and the tool-installing setup.sh in the box, a
new session had all three tools, with mtimes at session start, and no
`/root/.claude/environment-manager/setup-script-failed`. The script's stderr
isn't kept, so a WARN can't be read back; the signing step wasn't checked.

- `atlas version`: v1.3.0. Its update check to `vercheck.ariga.io` was denied by
  the proxy, with no effect on the result.
- `gitleaks version` prints `version is set by build process`, because
  `go install` doesn't embed one. `go version -m` shows v8.30.1.
- `sqlite3 --version`: 3.45.1.
- `pnpm install --frozen-lockfile` (11 s, run by hand) then `pnpm verify` passed
  in about 41 s, including `db:check` (atlas validate and diff dry-run) and
  gitleaks. Its dependency audit doesn't fail the run.

## shguard and fini without any preparation (2026-11-04)

- shguard: fmt, clippy, test (262 passed, 3 ignored) and the spike lockfile check
  passed with the submodule uninitialised, so shguard needs no hook.
  `cargo deny check` failed because the tool was missing.
- fini: fmt, clippy and the scripts test passed. `cargo audit` failed because the
  tool was missing. `cargo test` failed in `test_per_entry_walk_error_does_not_abort_walk`
  and `test_issue_87_walk_error_message`, because root ignores mode `000`.

Hence setup.sh installs cargo-deny and cargo-audit. Their digests are the ones the
GitHub release API reports for the x86_64 musl archives. CI gets its own versions
from its actions, which may differ from these pins.

In the next real setup-script run, both tools were at their pinned versions in
`/usr/local/bin`. In shguard, `cargo deny check` passed in about 2 s, fetching the
advisory database through the proxy. In fini, `cargo audit` found nothing in 81
crates.

## SessionStart hooks, first real run (2026-11-05)

New sessions after the hooks merged had `done` at the end of
`.tmp/session-start.log`, with dependencies and `.dev.vars` in place.

- staygreen: `pnpm verify` passed in about 42 s with no preparation.
- cc-memory: `pnpm typecheck` passed with no preparation. `pnpm smoke` passed
  after `pnpm db:reset:local` and `pnpm dev`, which the hook leaves out because
  the reset drops every local table.

## Not verified here

- triage/mkgoal/maintain-sweep running end to end with REST in place of
  `gh issue`.
