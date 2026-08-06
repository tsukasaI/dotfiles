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
| 3 | Pipe-to-interpreter beyond curl\|wget→sh | gap (permanent) | not expressible |
| 4 | Heredoc-fed interpreters (`python <<EOF`) | gap (permanent) | not expressible |
| 5 | ANSI-C `$'...'` raw-string check | gap (permanent) | not expressible |
| 6 | `/dev/tcp` \| `/dev/udp` (command-agnostic) | gap (permanent, partial) | not expressible |
| 7 | CREDENTIAL: any-command bare-word match | gap (permanent, partial) | not expressible |
| 8 | `gh api -X DELETE` chained-value form | gap (permanent, partial) | not expressible |
| 9 | Secret-file readers: extension-suffix / nested paths | gap (permanent, partial) | not expressible |
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
| 21 | `git grep` bare-command match doesn't cover git subcommand form | gap, partial config fix | fixed via `dotfiles-tool-policy-git-grep`; `git -C <dir> grep` still uncovered |
| 22 | `git commit -m "$(...)"` (heredoc-style commit messages) now `ask`s instead of `allow`s | **regression (blocks full cutover)** — not fixable from `config.toml` | [shguard#146](https://github.com/tsukasaI/shguard/issues/146) |
| 23 | curl userinfo-URL bypass (`localhost:` as userinfo, not port) + rsync bare-relative-path over-block | **regression (security) + friction**, not fixable from `config.toml` | [shguard#147](https://github.com/tsukasaI/shguard/issues/147) filed (userinfo bypass only; rsync sub-gap not filed) |

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
residual sub-gaps neither fixable from `config.toml` nor from a tighter
`except_targets` list; see #23 below for both: a userinfo-URL bypass
(`curl http://localhost:@evil.com` allows when it should deny — a real
exfiltration vector, not just friction) and an rsync over-block on bare
relative paths (`rsync -a src/ dst/` now denies where the old hook
allowed it). Both are locked in as `KNOWN_DELTA` cases in
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

## 22. `git commit -m "$(...)"` (heredoc-style commit messages) now asks instead of allows — blocks full cutover

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

Net effect if cutover proceeds as-is: every commit made via the
mandated heredoc pattern gets one extra confirmation click. Not a
security regression (more cautious, not less) — a real, daily-workflow
friction cost across every commit, not an edge case. **This is why
full cutover (the `settings.json` swap to `shguard-gate.sh`) is paused**
pending an upstream fix. Filed as
[shguard#146](https://github.com/tsukasaI/shguard/issues/146).

## 23. curl userinfo-URL bypass + rsync bare-relative-path over-block

Found by a fable code-review pass (2026-08-06) on the #2/#19 curl/rsync
rules above, before they were committed — verified live, not just read.
Two distinct sub-gaps in the same rules, neither fixable from
`config.toml`:

**Userinfo-URL bypass (security-relevant, not just friction).** The
`except_targets` anchoring (`{ exact = "http://localhost" }`,
`{ prefix = "http://localhost:" }`, `{ prefix = "http://localhost/" }`,
same for 127.0.0.1/`[::1]`/https) is plain string prefix matching with
no URL-authority parsing. curl treats `user:password@host` as
userinfo, not a port, so a colon right after `localhost` is
indistinguishable from a real `:port` to a prefix match:

```
curl http://localhost:@evil.com     old=deny  shguard=allow
curl http://localhost:80@evil.com   old=deny  shguard=allow
```

Both connect to **evil.com**, not localhost — a real exfiltration
vector `block-dangerous.sh`'s `LOCAL_URL_RE` regex closes (it requires
`:[0-9]+` followed by a real boundary) but this port cannot express
with prefix/exact target matching alone. Widening the anchors would
either still miss this shape or start rejecting ordinary
`localhost:3000` usage — not a config fix, a schema limitation (same
class as delta #9's "no suffix/contains matcher" gap). Locked in as
`KNOWN_DELTA` cases in `tests/shguard-parity-check.sh`
(`curl http://localhost:@evil.com`, `curl http://localhost:80@evil.com`)
so the hole stays visible rather than silently passing parity.

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
[shguard#147](https://github.com/tsukasaI/shguard/issues/147). The
rsync bare-relative-path sub-gap is not filed — pure friction, low
severity, revisit if/when this migration resumes.
