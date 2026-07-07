---
name: actions-pin-audit
description: >
  On-demand audit of SHA-pinned GitHub Actions: enumerate pins in a repo's
  workflows, compare each pinned SHA against the upstream action's current
  release, update stale pins while keeping the version comment, and flag
  repos missing a renewal mechanism (Dependabot). Use when: "actionsのpinを
  棚卸し/更新して", "audit GitHub Actions pins", after adding a new workflow,
  or as a periodic supply-chain check. NOT for: debating pinning strategy
  (already settled in dotfiles rules/security.md) or Homebrew taps / plugin
  marketplaces (see dotfiles#25 — different mechanism, out of scope here).
allowed-tools: Bash, Read, Edit, Glob, Grep
disable-model-invocation: true
---

# /actions-pin-audit — GitHub Actions SHA-pin audit

Principle SSoT: `~/dotfiles/claude-code/rules/security.md` — "Pin third-party
actions and container images to content hashes, not tags. Pair each pin with
a renewal mechanism (Dependabot, scheduled audit)" and "Verify external state
at decision time, not from memory." This skill is the scheduled-audit half of
that rule. Don't restate the principle to the user; cite it.

## When NOT to use

- Deciding *whether* to pin — that's already policy, not a question.
- Homebrew taps / Claude plugin marketplaces (`trusted = true`,
  `enabledPlugins` branch-following) — same theme, different mechanism.
  Tracked separately as `tsukasaI/dotfiles#25`; do not fold into this skill.

See also: fini's per-channel pin/release discipline (Homebrew, Nix, VS Code
propagation on top of SHA-pinned Actions) is detailed in fini's local skill
`~/engineer/fini/.claude/skills/release-playbook/SKILL.md` — this skill
covers the generic Actions-pin audit only, not per-channel release mechanics.

## Step 1: enumerate pins

```
rg -n --no-heading 'uses:\s*\S+@[0-9a-f]{40}' <repo>/.github/
```

Verified against `~/engineer/ops` and `~/engineer/fini` — matches every
`uses: owner/action@<40-hex-sha> # <comment>` line. The comment is usually a
version tag (`# v6.0.2`) but can be a floating label instead, e.g.
`dtolnay/rust-toolchain@<sha> # stable @ 2026-04` — that's an intentional
floating pin (tracks a branch, re-pinned by hand periodically), not a stale
version. Skip those in Step 2; note them in the report instead of flagging
"stale."

## Step 2: resolve each comment-tag to its actual current SHA

```
gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq '.object'
```

Returns `{sha, type}`. If `type == "commit"`, `.sha` is the answer (lightweight
tag — confirmed for `actions/checkout`, `actions/upload-artifact`,
`peter-evans/create-issue-from-file`). If `type == "tag"` (annotated tag —
confirmed for `Swatinem/rust-cache@v2.9.1`), deref once more:

```
gh api repos/<owner>/<repo>/git/tags/<object.sha> --jq '.object.sha'
```

That second `.object.sha` is the real commit. Also fetch the latest release
for the "is a newer version available" column:

```
gh api repos/<owner>/<repo>/releases/latest --jq '.tag_name'
```

## Step 3: compare and report

Table per repo: `action | pinned SHA | comment tag | tag's actual SHA (Step 2)
| latest release tag | verdict`. Verdict is one of: match (pin == tag's SHA,
tag == latest), stale (newer release exists), mismatched (pin's SHA doesn't
match its own comment's tag — investigate before touching, don't auto-fix),
floating (branch-style pin, not a version — leave alone).

## Step 4: update stale pins

Edit the pin and its comment together in one change:
`owner/action@<new-sha> # <new-tag>`. Never write a SHA that wasn't just
returned by Step 2's `gh api` call in *this* run — no reusing a SHA from
memory or from an earlier audit.

## Step 5: renewal mechanism

Check `<repo>/.github/dependabot.yml` for a `package-ecosystem:
github-actions` entry. If missing, offer:

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
```

`~/engineer/fini/.github/dependabot.yml` is the house's proven config (groups
all actions into one weekly PR via `groups: actions: patterns: ["*"]`) —
prefer that shape over the bare stanza above when the repo also has other
ecosystems worth grouping.

## Worked example (annotated-tag two-step deref)

`Swatinem/rust-cache@v2.9.1`, pinned in `~/engineer/fini/.github/workflows/ci.yaml`,
is an annotated tag — resolving it needs both Step 2 calls:

```
$ gh api repos/Swatinem/rust-cache/git/ref/tags/v2.9.1 --jq '.object'
{"sha":"23869a5bd66c73db3c0ac40331f3206eb23791dc","type":"tag"}
$ gh api repos/Swatinem/rust-cache/git/tags/23869a5bd66c73db3c0ac40331f3206eb23791dc --jq '.object.sha'
c19371144df3bb44fab255c43d04cbc2ab54d1c4
```

The first response's `.sha` is the *tag object*, not a commit — using it as
the pin would be wrong. The second call's `.object.sha`
(`c19371144d…`) is the real commit, and it matches fini's pin exactly:
verdict `match`.

Renewal mechanism (checked 2026-07-07): fini and ewc already have
`.github/dependabot.yml` with a `github-actions` entry; ops does not
(`tsukasaI/ops#84`, open). Treat this as a dated observation, not a durable
fact — per-repo pin/renewal state must be re-derived at run time via Steps
1–5 above, not read off this file.

## Re-verify (facts here rot)

- Workflow file paths and pin lines above — re-run Step 1 per repo; files get
  added/renamed.
- Whether `ops`/`fini`/`ewc` have `.github/dependabot.yml` — check directly,
  don't trust this file's snapshot.
- `gh api .../releases/latest` and `git/ref/tags/<tag>` response shapes — both
  confirmed live against `actions/checkout`, `Swatinem/rust-cache`,
  `peter-evans/create-issue-from-file` on 2026-07-07; re-check if `gh` errors
  differently than documented here.
- `actions/checkout` latest-release tag (`v7.0.0` as of this writing) — will
  advance; always re-fetch, never cite this file's number as current.
