---
name: self-document
description: Detect repeated correction patterns by scanning ~/.claude/projects/*.jsonl ([Request interrupted ...] and explicit correction phrases). Propose minimum-scope additions to CLAUDE.md or .claude/rules/. User-invoked only, always dry-run, one suggestion at a time. Use when the user wants to consolidate recurring corrections into persistent rules.
allowed-tools: Bash, Read, Edit, Write, Glob
disable-model-invocation: true
---

# Self-Document

Surfaces patterns where the user has corrected or interrupted Claude repeatedly, and proposes additions to CLAUDE.md or `.claude/rules/` so the correction does not need to be repeated.

The skill never edits without per-item approval. The signals it uses (Esc-interrupt and explicit correction phrases) are noisy by nature — the user always decides whether a candidate is real and worth codifying.

## Run

```!
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts
```

The analyzer is read-only. It walks `~/.claude/projects/<encoded-cwd>/*.jsonl` and emits a JSON report. Key sections:

- `meta` — `sessions_scanned`, `oldest_session`, `data_window_days`, `pairs_by_kind`
- `correction_pairs[]` — clustered `(kind, tool_name, excerpt)` with sample contexts and `scope_hint`. Sorted: `failure_loop` first, then `interrupt`, then `correction`; by count within each kind.

`kind` is one of:
- `failure_loop` — same `(tool_name, excerpt)` failed (`tool_result.is_error: true`) ≥ 3 times back-to-back in one session. **Strongest signal** — Claude was stuck in a loop. Carries `max_chain_length` and `total_chain_length`.
- `interrupt` — user pressed Esc on a tool call. Strong signal.
- `correction` — user followed an assistant turn with a phrase like "no", "actually", "違う", "やめて". Weaker; relies on phrase match.

## Procedure

1. If `meta.sessions_scanned` is 0 or the candidate list is empty, tell the user and stop. Do not invent suggestions.

2. **Present all candidates in one batch**, then collect decisions. Do not interleave proposals and questions. Order: failure_loop > interrupt > correction (analyzer already sorts).

   Before rendering, for each candidate **Read the target file** (`scope_target` and related `rules/*.md`) so the proposal text reflects what's actually there. If a similar rule exists, mark the proposal as `strengthen` instead of `append`. If it's a clear duplicate, mark as `skip — duplicate` and omit a proposal line.

   **Draft 1–3 lines of rule text** grounded in the samples. Do not paraphrase beyond what the samples show. Examples:
   - Multiple `interrupt` on `Bash: git push origin main` → `- Never push to main directly; open a PR.`
   - `correction` after `Edit` on `*.go` files with phrase "違う" → `- Run \`go vet\` and \`golangci-lint\` before reporting an edit as done.` (Likely a candidate to add to `rules/go.md` instead of CLAUDE.md.)

   Render each candidate block back-to-back:

   ```
   [CANDIDATE i/N] kind: <failure_loop|interrupt|correction> | count: <n> | scope: <user|project>
     trigger: <tool_name> "<excerpt>"
     chain_length (failure_loop only): max=<n> total=<n>
     cwds: <list>
     samples:
       - <ts> <assistant_action> → <user_response>
       - ...
     existing rules check:
       - <path>: <yes/no/similar>
     proposal: <append / strengthen / skip — duplicate> at <resolved absolute path>
       > <rule text>
   ```

   After listing all N candidates, ask **one** prompt that accepts any of:
   - `all skip` / `skip all` — skip everything
   - `all n` — same as above
   - per-item answers like `1:y, 2:skip, 3:n`
   - free-form ("only #2", "skip 1 and 3")

   **Only on `y`** perform `Edit` (or `Write` if creating a new rules file). Use the resolved real path (see Symlinks below). Apply changes one item at a time — never bulk Edit.

3. **Final summary**: applied N, skipped M, files touched. If any change landed under `~/.claude/CLAUDE.md` or `~/.claude/rules/...`, end with `Changes landed in /Users/inouetsukasa/dotfiles/claude-code/...; run \`git status\` to review.` Do not commit automatically.

## Scope rules (minimum scope)

Use `scope_hint` from the analyzer as the default. Adjust only when reading the existing files reveals a better match.

- **`scope: "project"`**: write to `<cwd>/.claude/CLAUDE.md`, or `<cwd>/.claude/rules/<topic>.md` if the project's CLAUDE.md already exceeds ~180 lines.
- **`scope: "user"`**: write to `~/.claude/CLAUDE.md`, or `~/.claude/rules/<topic>.md` if either: (a) the user CLAUDE.md exceeds ~180 lines, or (b) the correction is language- or path-specific.
- **Path-specific candidates** (`path_hint` set, e.g. `.ts`, `.go`): prefer `~/.claude/rules/<lang>.md` with a `paths:` frontmatter field, since these load only when relevant files are open. If such a file already exists, append into it; do not create parallel files.

### failure_loop-specific routing

`failure_loop` typically points to one of three patterns. Inspect `user_response` (the captured error text) to pick the right target:

- **PreToolUse hook block** (`user_response` contains `PreToolUse:...hook error`): the block ruleset is already enforcing something but the assistant kept retrying. Either the existing rule in `~/.claude/rules/shell-tools.md` is insufficient (re-phrase to be clearer), or add a positive guidance line to `~/.claude/CLAUDE.md` (e.g. `- Use rg/fd, not grep/find — the latter are blocked.`).
- **Missing toolchain** (errors like `command not found`, `No such file or directory`, lint binary missing): add the prerequisite to the language `rules/<lang>.md` (e.g. `rules/go.md`: `- golangci-lint must be installed; check with \`which golangci-lint\` first.`).
- **Repeated edit / write failure** on the same file: the file likely has a constraint Claude didn't know (codegen target, generated file, format-on-write hook). Add a project rule under `<cwd>/.claude/rules/` naming the file and the constraint.

When in doubt, ask the user which file to target before drafting the text.

## Behavior rules

- Always `Read` the target file before proposing edits. Never add without checking duplicates.
- Never silently strengthen an existing rule into a contradiction — surface the conflict to the user.
- Never auto-create a new `rules/<topic>.md` without telling the user which topic name you picked and why.
- Present candidates as a batch, but apply changes one item at a time (no bulk Edit/Write).
- If the sample text would expose secrets (paths inside `~/.claude/...`, environment variable names with values, hostnames in URLs), redact them in the rule text. The user's `security.md` rule applies here too.
- If the user says `n`, move on. Do not press, do not record the rejection.

## Symlinks

`~/.claude/CLAUDE.md` and `~/.claude/rules/` are symlinks into the dotfiles repo. Before writing, use `realpath` to show the resolved path (e.g. `/Users/inouetsukasa/dotfiles/claude-code/CLAUDE.md`). Write to the real path so the dotfiles git diff is clean.

## Out of scope

- Cross-session "user repeated the same instruction" detection — that overlaps `self-improve`'s `prompt_clusters`. Use that skill instead for skill-level proposals.
- Auto-apply. Even low-risk single-line additions go through y/n.
- Persisting rejections. If you skip a candidate today, it can resurface tomorrow.
- Loose failure clustering: only **back-to-back** same-input failures (≥ 3) count as a loop. A failure interleaved with other tool calls is not picked up — that case may surface in v3 if needed.
