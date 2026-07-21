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
| 2 | curl (localhost-only) / rsync (local-only) | gap (pending upstream) | [shguard#48](https://github.com/tsukasaI/shguard/issues/48) |
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
| 19 | `except_targets` treats flag values as candidate targets — 55% over-ask on real local curl usage | gap (pending upstream) — **blocks curl/rsync rules** | [shguard#48](https://github.com/tsukasaI/shguard/issues/48) |

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
usage. That's now the actual blocker
([shguard#48](https://github.com/tsukasaI/shguard/issues/48)), not #30.
Until #48 lands, curl/rsync coverage stays on `block-dangerous.sh`,
which is why full cutover (migration plan's implementation steps) is
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

## 19. `except_targets` treats flag values as candidate targets — blocks curl/rsync rules

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
