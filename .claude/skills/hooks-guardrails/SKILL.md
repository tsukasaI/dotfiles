---
name: hooks-guardrails
description: >
  Safe-change procedure for the dotfiles PreToolUse guardrail hooks
  (claude-code/hooks/block-dangerous.sh, blocklist.conf, allowlist.conf,
  block-config-edit.sh). Use when: adding a rule to blocklist.conf, fixing a
  false positive ("hookがブロックした" / a legitimate command got blocked),
  editing block-dangerous.sh or allowlist.conf, or blocklist.confへのルール追加.
  NOT for: hooks in other repos, settings.json permission changes (see
  update-config skill instead), or changes unrelated to these four files.
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# hooks-guardrails

These hooks are **live**: symlinked into `~/.claude/hooks/` and enforced on
the very session editing them. They gate every Bash call system-wide, so a
mistake here is not contained to this repo. The repo's own history shows the
dominant failure mode is **false positives** from regex-based blocking
(narrow patterns catching legitimate commands), fixed repeatedly — not
missing blocks. Treat every change as security-rule surgery: narrow first,
widen only on evidence.

## When NOT to use

- Hooks or settings in a different repo.
- `settings.json` permission grants/denials — that's the `update-config` skill.
- Anything that isn't `block-dangerous.sh`, `blocklist.conf`,
  `allowlist.conf`, or `block-config-edit.sh`.

## Procedure

1. **Classify the change**: new blocklist rule / narrowing a false positive /
   allowlist addition / edit to the script logic itself. Each has a
   different blast radius — script-logic edits affect every rule at once.

2. **Read before writing.** Open the target file and its neighboring rules
   first (`Read`). `blocklist.conf` format is:
   `CATEGORY | command prefix | Block reason | Alternative (optional)`,
   with three prefix styles: `prefix` (word-boundary), `prefix*`
   (starts-with, e.g. `mkfs*`), `*keyword*` (substring anywhere, e.g.
   `*secret*` — the least precise form, and the one that has caused false
   positives, see below).

3. **Write the rule narrowly.** Prefer the word-boundary `prefix` form over
   `*keyword*` substring matches unless the command genuinely has no fixed
   prefix. Put it under the correct `# ──` category section, matching
   existing formatting (`|`-aligned columns).

4. **Sanity-check the script before testing behavior**, since a syntax error
   in `block-dangerous.sh` blocks *every* Bash call, not just the one rule:
   ```
   bash -n claude-code/hooks/block-dangerous.sh
   ```

5. **Run the test matrix** with the synthetic-payload one-liner (safe:
   stdin/stdout only, no real command executes):
   ```
   echo '{"tool_input":{"command":"<CMD>"}}' | claude-code/hooks/block-dangerous.sh; echo "exit=$?"
   ```
   - (a) The command you intend to block → expect `exit=2` + a
     `[BLOCKED: CATEGORY] reason` line on stderr.
   - (b) At least 2 nearby *legitimate* commands that share a substring or
     prefix with the blocked pattern → expect `exit=0`.
   - (c) A quoted/heredoc variant of the blocked string (e.g. inside a
     `git commit -m "..."`) → expect `exit=0` — quoted text must not
     false-positive.

   Verified working examples (re-run these, don't take them on faith):
   ```
   echo '{"tool_input":{"command":"rm -rf foo"}}' | claude-code/hooks/block-dangerous.sh   # exit=2, FILE_DESTRUCTION
   echo '{"tool_input":{"command":"rg foo"}}' | claude-code/hooks/block-dangerous.sh        # exit=0
   echo '{"tool_input":{"command":"git commit -m \"fix secret handling\""}}' | claude-code/hooks/block-dangerous.sh  # exit=0 (quoted "secret" allowed)
   echo '{"tool_input":{"command":"git reset --hard"}}' | claude-code/hooks/block-dangerous.sh  # exit=2, GIT
   echo '{"tool_input":{"command":"git reset HEAD~1"}}' | claude-code/hooks/block-dangerous.sh  # exit=0 (non-destructive reset allowed)
   echo '{"tool_input":{"command":"fd -e sh"}}' | claude-code/hooks/block-dangerous.sh      # exit=0 (bare-sh false positive, fixed 3962cf5)
   ```

6. **`block-config-edit.sh` changes**: same discipline, but it gates
   `Edit`/`Write` tool_input.file_path instead of Bash commands. Test with
   `{"tool_input":{"file_path":"..."}}` piped the same way.

7. **Record rationale as Contextual Commit body lines** when committing
   (`intent`/`decision`/`rejected`/`constraint`/`learned` — see repo
   CLAUDE.md). For hook changes, `learned` is usually the most valuable line
   for the next person hitting the same false positive.

## False-positive history (why this is narrow-first, not a design opinion)

Confirmed via `git log --oneline -- claude-code/hooks/` and reading each
commit body:

- **585626e** — quoted-heredoc bodies were being scanned raw, so a commit
  message written in the harness-mandated heredoc form false-positived on
  words like "secret"/"bash" inside the message text. Fixed by stripping
  quoted-heredoc bodies (POSIX: a quoted delimiter disables expansion, so
  the body is inert literal data) before the blocklist scan runs.
- **edd5c43** — the original scan ran on raw `$CMD`, so `rm;ls`,
  `bash;ls`, `rm>file`, `/usr/bin/rm`, `{rm,echo}` all bypassed the
  word-boundary check. Fixed by widening the command-boundary (`CB`) and
  trailing-boundary (`TB`) character classes and scanning quote-stripped
  `$CMD_NOQUOTES`. 12 bypass paths closed in one pass.
- **3962cf5** — bare `sh`/`bash`/`zsh` detection used the same `$CB` as
  everything else, so `fd -e sh` (a flag *value*, not a command) false-
  positived. Fixed with a separate, stricter boundary (`STRICT_CB`:
  start-of-string or a real shell separator only) used *just* for the bare-
  interpreter case, leaving `bash -c`/`sh -c` on the shared `$CB` so
  wrapper forms like `env bash -c '...'` still get caught.
- **951d24f** — `git reset` was blocked unconditionally, including the safe
  mixed-mode default and unstage form. Narrowed to `git reset --hard` /
  `--merge` only (the irreversible forms).
- **cd4c4bf** — a stray plain `printf` inside `block()` sent output to
  stdout, which PreToolUse discards — the model never saw *why* a command
  was blocked. Fixed by wrapping the whole `block()` function in one `>&2`
  redirect so this can't recur line-by-line.

**Lesson to encode, not relitigate every time**: quote-stripping, heredoc
handling, and the `CB`/`TB`/`STRICT_CB` boundary classes each fix a past
regression (also noted in the repo's top-level CLAUDE.md, Pitfalls section)
— don't simplify them without re-running the fixed case as a regression
test.

## Known open gaps (not this skill's job to fix)

Documented in GitHub issues; this skill covers *procedure*, not remediation:

- **#1** — `block-dangerous.sh` is bypassable via mid-word backslash
  (`r\m -rf`) or split quoting (`cur'l'`), since neither is normalized
  before the regex scan.
- **#7** — Some checks (curl special-case, pipe-injection, `/dev/tcp`,
  `$'...'`) scan raw `$CMD` while others scan quote-stripped
  `$CMD_NOQUOTES`, causing avoidable false positives on fully-quoted text
  for the raw-`$CMD` checks.
- **#20** — `*secret*`/`*credential*` are unbounded substrings (false-
  positive on e.g. `secretary`), local-only `rsync` has no localhost
  exception the way `curl` does, `git tag -d`/`git branch -d` miss their
  `--delete` long-flag spellings, and `block-config-edit.sh`'s ruff
  protection misses `pyproject.toml` (ruff's most common config location).

Refs: tsukasaI/dotfiles#1, tsukasaI/dotfiles#7, tsukasaI/dotfiles#20

## Re-verify (run before trusting this file, and before/after any edit)

```
bash -n claude-code/hooks/block-dangerous.sh
git log --oneline -5 -- claude-code/hooks/
echo '{"tool_input":{"command":"rm -rf foo"}}' | claude-code/hooks/block-dangerous.sh; echo "exit=$?"
```
If `bash -n` fails, or the `rm` case doesn't exit 2, stop — the hook itself
is broken and every subsequent Bash call in the session is affected.
