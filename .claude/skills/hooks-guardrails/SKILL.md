---
name: hooks-guardrails
description: >
  Safe-change procedure for the dotfiles PreToolUse guardrail
  (claude-code/shguard/config.toml, the inline shguard command in
  claude-code/settings.json, block-config-edit.sh). Use when: adding or
  narrowing a rule in config.toml, fixing a false positive ("hookがブロック
  した" / a legitimate command got blocked), or config.tomlへのルール追加.
  NOT for: hooks in other repos, settings.json permission changes (see
  update-config skill instead), or changes unrelated to these files.
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# hooks-guardrails

This guardrail is **live**: `shguard` runs on the very session editing it,
gating every Bash call system-wide, so a mistake here is not contained to
this repo. `claude-code/shguard/config.toml` is Claude-edit-blocked (see
`block-config-edit.sh`'s self-protection list); Claude can propose a diff
but the user must apply it. Treat every change as security-rule surgery:
narrow first, widen only on evidence.

## When NOT to use

- Hooks or settings in a different repo.
- `settings.json` permission grants/denials, that's the `update-config` skill.
- Anything that isn't `claude-code/shguard/config.toml`, the inline shguard
  command in `claude-code/settings.json`, or `block-config-edit.sh`.

## Procedure

1. **Classify the change**: new rule / narrowing a false positive / target
   matcher change / edit to the inline settings.json command itself. Each
   has a different blast radius, the inline command wraps every rule at
   once (PATH-miss/crash handling, `SHGUARD_STRICT_CONFIG`).

2. **Read before writing.** Open `config.toml` and its neighboring rules
   first (`Read`). Each `[[deny]]`/`[[ask]]`/`[[allow]]` block has `id`,
   `reason`, `command`, and `targets` (one of `exact`/`prefix`/`normalized`/
   `normalized_prefix`/`normalized_basename` per entry, optionally
   `except_targets` and `value_flags`/`attached_value_flags` for flags whose
   value should or shouldn't count as a candidate target). Match existing
   formatting and comments in the surrounding `# ─────` section.

3. **Write the rule narrowly.** Prefer `exact`/`prefix` over a broad
   substring match. `normalized_basename` widens by design (matches a
   dotenv-style suffix family, e.g. `.env` also matches `.env.local`
   anywhere in the path); only use it where that widening is the intent.

4. **Present the diff, don't try to apply it.** `config.toml` refuses
   Claude's own Edit/Write. Show the exact before/after and let the user
   apply it (a small `sed`/manual edit, confirmed with them first).

5. **Run the test matrix** with the synthetic-payload one-liner (safe:
   stdin/stdout only, no real command executes):
   ```
   echo '{"tool_input":{"command":"<CMD>"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard
   ```
   - (a) The command you intend to deny -> expect `permissionDecision: "deny"`.
   - (b) At least 2 nearby *legitimate* commands that share a substring or
     prefix with the denied pattern -> expect `"allow"`.
   - (c) A quoted variant of the denied string (e.g. inside a
     `git commit -m "..."`) -> expect `"allow"`, quoted text must not
     false-positive.

   Verified working examples (re-run these, don't take them on faith):
   ```
   echo '{"tool_input":{"command":"rm -rf foo"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard        # deny
   echo '{"tool_input":{"command":"rg foo"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard            # allow
   echo '{"tool_input":{"command":"git commit -m \"fix secret handling\""},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard  # allow (quoted "secret")
   echo '{"tool_input":{"command":"cat foo/.env.local"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard  # deny (normalized_basename)
   ```

6. **Run the full regression suite** before considering the change done:
   ```
   tests/shguard-parity-check.sh
   ```
   This pins the expected decision for every historically-tricky case
   (quote/backslash bypass closures, curl localhost exemption, credential
   reads, false-positive regressions, privilege escalation, `/dev/tcp`,
   pre-commit bypass flags, and more). A new failure here means your change
   regressed a previously-fixed case, not just a new-rule sanity check.

7. **`block-config-edit.sh` changes**: same discipline, but it gates
   `Edit`/`Write` tool_input.file_path instead of Bash commands. Test with
   `{"tool_input":{"file_path":"..."}}` piped the same way. It self-protects
   (Claude can't edit it either) and separately protects `config.toml` by
   path, both entries must stay in sync if either file moves.

8. **Record rationale as Contextual Commit body lines** when committing
   (`intent`/`decision`/`rejected`/`constraint`/`learned`, see repo
   CLAUDE.md). `learned` is usually the most valuable line for the next
   person hitting the same false positive.

## bypassPermissions caveat

An `ask` verdict from shguard is not a reliable control once this session
runs under `bypassPermissions` mode (Claude Code's own docs: `ask` is no
longer a documented `PreToolUse` value, only `allow`/`deny`; two real
upstream bugs document the ambiguity). If a rule you're writing matters
under `bypassPermissions`, it must resolve to `deny`, not `ask`. See
`docs/shguard-migration-deltas.md`'s "Cutover caveat" section for the
current list of `ask`-only rules that need re-auditing before that switch.

## History (why this is narrow-first, not a design opinion)

This guardrail replaced a hand-written bash script (`block-dangerous.sh`,
deleted 2026-09-06) that accumulated years of false-positive fixes: quoted-
heredoc bodies scanned raw, unnormalized command boundaries letting
`rm;ls`/`bash;ls` bypass word-boundary checks, bare-interpreter detection
false-positiving on flag values like `fd -e sh`, and more. shguard's own
parser-based approach closes most of that class structurally (see
`docs/shguard-migration-deltas.md` for the full list of behavior deltas
found and resolved during the migration), but re-verify with the parity
suite before trusting a change, the lesson (narrow rules, real regression
tests, don't relitigate a fixed case) still applies.

## Re-verify (run before trusting this file, and before/after any edit)

```
tests/shguard-parity-check.sh
echo '{"tool_input":{"command":"rm -rf foo"},"tool_name":"Bash","hook_event_name":"PreToolUse"}' | shguard
```
If the parity suite fails, or the `rm` case doesn't deny, stop, the
guardrail itself is broken and every subsequent Bash call in the session is
affected.
