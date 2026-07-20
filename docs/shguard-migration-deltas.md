# shguard migration: accepted behavior deltas

Tracks every place where `claude-code/shguard/config.toml` (+ shguard's
built-in blocklist) does **not** reproduce `block-dangerous.sh` +
`blocklist.conf` + `allowlist.conf`'s behavior exactly, per
`claude-code/rules/security.md`'s "a weakened control must be visible, not
silent" requirement. Written during the migration plan at
`.claude/plans/https-github-com-tsukasai-shguard-hook-b-stateless-sloth.md`
(step 4); update it whenever a new gap is found or an upstream fix lands.

Status legend: **gap (permanent)** — not expressible in shguard's current
rule schema, no upstream ask filed; **gap (pending upstream)** — tracked as
a filed issue, closes automatically once fixed; **regression (pending
upstream)** — old behavior was strictly safer, also tracked upstream;
**design change (net improvement)** — behavior differs but isn't a
weakening, documented so it isn't mistaken for a bug later.

## Summary table

| # | Area | Status | Tracking |
|---|------|--------|----------|
| 1 | Malformed-input fail-closed mode | regression (minor) | not filed — see below |
| 2 | curl (localhost-only) / rsync (local-only) | gap (pending upstream) | [shguard#30](https://github.com/tsukasaI/shguard/issues/30) |
| 3 | Pipe-to-interpreter beyond curl\|wget→sh | gap (permanent) | not expressible |
| 4 | Heredoc-fed interpreters (`python <<EOF`) | gap (permanent) | not expressible |
| 5 | ANSI-C `$'...'` raw-string check | gap (permanent) | not expressible |
| 6 | `/dev/tcp` \| `/dev/udp` (command-agnostic) | gap (permanent, partial) | not expressible |
| 7 | CREDENTIAL: any-command bare-word match | gap (permanent, partial) | not expressible |
| 8 | `gh api -X DELETE` chained-value form | gap (permanent, partial) | not expressible |
| 9 | Secret-file readers: extension-suffix / nested paths | gap (permanent, partial) | not expressible |
| 10 | `--no-verify` on non-git commands | gap (permanent, minor) | not expressible |
| 11 | `sudo` unwrap-recursion | regression (pending upstream) | [shguard#32](https://github.com/tsukasaI/shguard/issues/32) |
| 12 | `bash`/`sh`/`zsh`/`dash -c` unwrap-recursion | design change (net improvement) | n/a |
| 13 | Symlinked config: Bash-write self-protection | gap (pending upstream) | [shguard#31](https://github.com/tsukasaI/shguard/issues/31) |

## 1. Malformed-input fail-closed mode

`block-dangerous.sh` hard-blocks (exit 2, no override) on malformed JSON,
a non-string `command` field, or any other unhandled parse failure.
shguard's fail-closed path returns `ask` instead — a confirmation dialog a
hurried human can click through, rather than an unconditional block.
Minor, but real: the failure mode went from "cannot proceed" to "can
proceed with one extra click."

## 2. curl (localhost-only) / rsync (local-only)

Not present in `config.toml` at all — deliberately deferred. The old hook
allowed `curl`/`rsync` freely to local targets but asked/blocked for
remote ones; shguard's `[[allow]]` can only downgrade its own structural
`Ask`, never a config-defined `ask`/`deny` match, so a broad-ask + narrow-
allow approximation doesn't work (verified: it would make *every* curl,
including localhost, ask). Tracked as
[shguard#30](https://github.com/tsukasaI/shguard/issues/30) (an
`except_targets` primitive). Until it lands, curl/rsync coverage stays on
`block-dangerous.sh`, which is why full cutover (migration plan step 7) is
gated on this issue.

## 3. Pipe-to-interpreter beyond curl\|wget→sh

`block-dangerous.sh` blocks piping *anything* into
`bash|sh|zsh|dash|fish|ksh|python|python3|node|perl|ruby|php` (e.g.
`cat script.sh | bash`, `echo ... | python3`). shguard's `[[pipeline]]`
rule type (which is how this class of shape is matched) is **built-in
only** — the README states pipeline-shape rules aren't user-configurable —
and the built-in blocklist only ships one pipeline rule:
`curl|wget -> sh|bash|zsh`. Any other source piped into an interpreter is
unblocked. No workaround exists within the current schema.

## 4. Heredoc-fed interpreters

`block-dangerous.sh` blocks `python <<EOF ... EOF` (and the same for
node/perl/ruby/php) — a script body fed via heredoc, bypassing argv
inspection. shguard's rule schema has no redirect-input (`<<`) matcher; a
plain `python <<'EOF'` normalizes to what looks like a bare `python`
invocation to the rule engine, which is intentionally allowed (matches
`python script.py`). Blanket-denying `command = "python"` isn't an option
either — it would also block ordinary script execution the old hook always
allowed.

## 5. ANSI-C `$'...'` raw-string check

`block-dangerous.sh` scans the **raw**, unstripped command string for
`$'...'` sequences (deliberately, since quote-stripping would erase them)
to catch obfuscated payloads like `$'\x72\x6d' -rf /`. shguard has no
raw/decoded-content matcher in its rule schema — its normalization
(handled by real parsing rather than regex) already resolves `$'...'`
content before rule matching runs, but there's no way to write a user rule
that inspects the pre-normalization raw text the way the old hook's
special case did.

## 6. `/dev/tcp` / `/dev/udp` (command-agnostic)

`block-dangerous.sh` blocks any command referencing `/dev/tcp` or
`/dev/udp` (bash's pseudo-device network redirection), regardless of which
command it's attached to (`exec 3<>/dev/tcp/host/port`,
`cat < /dev/tcp/host/port`, etc.) — this is bash redirect syntax, not tied
to one command name. `config.toml` has no rule for this at all: a
command-agnostic "target contains /dev/tcp regardless of command" rule
isn't expressible (every `[[deny]]` requires a `command`/`command_prefix`).
A future partial mitigation would be per-command rules for the most likely
carriers (`exec`, `cat`, `echo`, `printf`) but that's not a full port
either — not yet added.

## 7. CREDENTIAL: any-command bare-word match

The old rule matched a bare `secret`/`secrets`/`credential`/`credentials`
word-boundary token on **any command** (`docker secret ls`,
`kubectl get secrets`, and implicitly anything else — `aws secretsmanager
get-secret-value`, `vault kv get secret/foo`, `op item get`, etc.).
shguard rules require a fixed `command`/`command_prefix`, so only the two
concrete examples the old rule's own comment called out
(`docker secret`, `kubectl secret`/`secrets`) are ported
(`dotfiles-credential-docker-secret`, `dotfiles-credential-kubectl-secret`,
`dotfiles-credential-kubectl-secrets`). Any other CLI's secret-manager
subcommands are now unblocked unless they separately trip a different rule
(e.g. a matching secret-file-reader target).

## 8. `gh api -X DELETE` chained-value form

`dotfiles-github-api-delete-upper`/`-lower` catch the separate-token forms
(`-X DELETE`, `--method DELETE`, case variants) via `required_tokens`. They
do **not** catch the chained forms `--method=DELETE` or `-XDELETE`, since
`required_tokens` matches whole argv tokens exactly and `DELETE` isn't a
standalone token in `--method=DELETE`.

## 9. Secret-file readers: extension-suffix / nested paths

`dotfiles-secret-read-{cat,head,tail,less,more,bat,nano,vim,nvim}` port the
same 9 reader commands the old `SECRET_READ_RE` covered, but only for a
subset of target patterns — common bare filenames/prefixes
(`.env*`, `id_rsa`/`id_ed25519`/`id_ecdsa`/`id_dsa`, `kubeconfig`,
`.npmrc`, `.netrc`, `.pgpass`, `.aws/`, `.docker/config.json`,
`.config/gcloud/`). shguard's `targets` matcher only supports `exact`/
`prefix` on the whole argv token, so two classes of pattern from the old
regex are **not** covered:

- Extension-suffix patterns (`*.pem`, `*.key`, `*.p12`, any-extension
  `secret*`/`credential*` files) — there's no suffix/contains matcher.
- The same filename reached through a directory-prefixed path where the
  prefix isn't already covered (`cat ./nested/dir/.env` still matches via
  the `.env` prefix rule only because `prefix` matches from the start of
  the *token*, which for a relative path starting with `.env` still works;
  but `cat ./nested/dir/id_rsa` does **not** match `exact = "id_rsa"` since
  the full token is `./nested/dir/id_rsa`, not `id_rsa`).

## 10. `--no-verify` on non-git commands

The old rule (`*--no-verify*`) was a command-agnostic substring match —
any command with `--no-verify` anywhere, not just git. shguard's built-in
`git-no-verify-any-subcommand` only fires for `command = "git"`. A
hypothetical non-git CLI accepting a `--no-verify`-style flag is no longer
caught. Low practical impact (no other tool in this workflow is known to
use that flag), but real.

## 11. `sudo` unwrap-recursion (regression)

Confirmed empirically: `sudo <cmd>` is evaluated by shguard recursing into
`<cmd>`'s own safety rather than matching `argv[0] = "sudo"` literally —
`sudo whoami` → allow, `env sudo ls` → allow, even though
`dotfiles-privilege-sudo` (a plain `command = "sudo"` deny rule) exists in
`config.toml`. The old hook blocked **every** `sudo` invocation
unconditionally, since privilege escalation itself was the concern,
independent of the wrapped command's content. `doas`/`su` are **not**
given this unwrap treatment — the equivalent rules for those work exactly
as expected. Filed as
[shguard#32](https://github.com/tsukasaI/shguard/issues/32); the
`dotfiles-privilege-sudo` rule is kept in `config.toml`, currently inert,
so protection activates automatically once that's fixed rather than
requiring anyone to remember to re-add it.

## 12. `bash`/`sh`/`zsh`/`dash -c` unwrap-recursion (net improvement, not a gap)

Same unwrap-recursion mechanism as #11, but here it's a strict improvement
over the old hook, not a regression: the old hook blanket-blocked
**every** `bash -c`/`sh -c`/`zsh -c`/`dash -c` regardless of content
(it had no way to statically verify what was inside). shguard actually
parses and judges the inner command — confirmed `bash -c 'rm -rf /'` →
deny (via the built-in rm-rf rule), `bash -c 'grep foo bar'` → deny (via
`dotfiles-tool-policy-grep`, i.e. **user** rules apply recursively too,
not just built-ins), `bash -c 'echo hi'` → allow. `config.toml`
deliberately has no `dotfiles-code-{bash,sh,zsh,dash}-c` rules — they'd be
unreachable dead code. `ksh -c`/`fish -c` are **not** unwrapped (brush-parser
doesn't parse those dialects), so `dotfiles-code-ksh-c`/`dotfiles-code-fish-c`
still exist as plain rules and work as expected.

## 13. Symlinked config: Bash-write self-protection gap

`claude-code/shguard/config.toml` is deployed via a `setup.sh` symlink to
`~/.config/shguard/config.toml` so the policy stays versioned and
CI-testable (migration plan step 2). shguard's own `self_protection_toml`
matches only the *resolved* path; a Bash write targeting the repo-side
real file directly (`echo ... > claude-code/shguard/config.toml`, `tee`,
`cp`) is caught by neither shguard's self-protection nor
`block-config-edit.sh` (which only gates the Edit/Write tool, not Bash).
Confirmed live during this migration: a `cp` to that path from an agent
session would currently succeed. Filed as
[shguard#31](https://github.com/tsukasaI/shguard/issues/31); this is a
**hard gate** on full cutover (migration plan step 7) — until it lands, an
agent policed solely by shguard (no `block-dangerous.sh` running
alongside) could rewrite its own guard config via Bash.
