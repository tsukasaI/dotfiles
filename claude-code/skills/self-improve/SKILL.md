---
name: self-improve
description: Meta-review of the Claude Code setup by scanning ~/.claude/projects/*.jsonl. Skills mode (default) surfaces unused skills, repeated prompts that should become new skills, and SKILL.md drift. Corrections mode detects repeated correction patterns ([Request interrupted ...], failure loops, explicit correction phrases) and proposes minimum-scope additions to CLAUDE.md or .claude/rules/. User-invoked only, always dry-run, per-item approval.
argument-hint: [skills|corrections]
allowed-tools: Bash, Read, Edit, Write, Glob
disable-model-invocation: true
---

# Self-Improve

Scans the user's transcripts and proposes improvements to the Claude Code setup. Two modes, selected by `$ARGUMENTS`:

- **`skills`** (default, no argument) — skill-level changes: dead skills, repeated prompts worth promoting to a skill, SKILL.md drift
- **`corrections`** — rule-level changes: repeated corrections/interrupts that should become CLAUDE.md or `.claude/rules/` entries

Neither mode applies changes without per-item approval.

---

## Skills mode

Proposes skill-level changes:

1. **Dead skills** — installed but unused for ≥ 90 days
2. **Repeated prompts** — recurring inputs that should be promoted to a skill / slash command
3. **SKILL.md drift** — references to files / agents that no longer exist

### Run

Execute the analyzer and capture the JSON:

```!
bun ${CLAUDE_SKILL_DIR}/scripts/skills.ts
```

The analyzer is read-only. It walks `~/.claude/projects/<encoded-cwd>/*.jsonl`, the standard Claude Code transcript store, and emits a JSON report with these sections:

- `meta` — `sessions_scanned`, `oldest_session`, `data_window_days`, `data_sufficient`
- `available_skills` — every SKILL.md visible from the current `cwd` (user-global + cwd + ancestors up to git root). Use this when judging whether a new-skill proposal overlaps something that already exists
- `dead_skills` — skills with no recent invocation
- `meta_clusters` — semantically grouped clusters (currently `meta_kind: "code_paste"` per `(scope_target, language)`). Always present these *before* `prompt_clusters`
- `prompt_clusters` — recurring user inputs grouped by `(cwd, first_5_words)`. Each may carry `overlap_hints` (lexical keyword match against `available_skills`) and `in_meta_cluster: true` when already grouped into a meta cluster
- `slash_command_frequency` — how often each existing `/<name>` was invoked (FYI; do not propose deleting popular ones)
- `skill_review_hints` — mechanical drift detection per `SKILL.md`

### Procedure

1. **Check `meta.data_sufficient`**. If `false`, skip the `dead_skills` section (the analyzer already returns `[]` in that case) and tell the user the dead-skill check needs `data_window_days` of history to be reliable. Continue with `prompt_clusters` and `skill_review_hints` regardless — they don't depend on the window.

2. **Present all candidates in one batch**, then collect decisions. Do not interleave proposals and questions.

   Ordering inside the batch:
   1. `dead_skills` (if any)
   2. `meta_clusters` (each is one candidate; deciding the meta governs its members)
   3. `prompt_clusters` where `in_meta_cluster === false` (the rest)
   4. `skill_review_hints`

   For each candidate, render this block back-to-back:

   ```
   [CANDIDATE i/N] kind: <dead_skill|meta_cluster|new_skill|skill_review> | scope: <user|project>
     evidence: <counts, dates, cwd list, sample prompts>
     ⚠ overlap with existing skills:
       - <skill_name> (<scope>, match=<n>) — <description>
       - ...
       (omit this block if no overlap_hints / code_overlap_hints found)
     target: <resolved absolute path>
     proposal:
       <one of: delete this skill / create new skill / edit existing SKILL.md>
   ```

   After listing all N candidates, ask **one** prompt that accepts any of:
   - `all skip` / `skip all` — skip everything, no further questions
   - `all n` — same as above (rejection without recording)
   - per-item answers like `1:y, 2:skip, 3:n, 4:y`
   - free-form ("only #2", "skip 1 and 3", etc.)

   **Only on `y`** perform the actual Bash / Edit / Write, one item at a time. On `n` / `skip` do nothing for that item.

3. **Overlap check is mandatory before proposing a new skill**:
   - For `meta_clusters`: surface `code_overlap_hints` verbatim. If any hint scores ≥ 2, **Read** that skill's SKILL.md (from `available_skills[].path`) and ask the user: "this existing skill seems to cover the same intent — extend it, or still want a new one?" before drafting a new SKILL.md.
   - For `prompt_clusters`: surface `overlap_hints` similarly.
   - Even when both lists are empty, scan `available_skills` once and apply one test: **would invoking that existing skill on this candidate's sample input produce the output the user is asking for?** If yes for any skill → overlap exists, treat it like an `overlap_hints` hit. Lexical keyword match misses cross-domain cases (e.g. an English skill description vs. user-pasted code).
     - Example: candidate is "search my notes for X" recurring across sessions — `kb`'s description says exactly this; invoking `kb` produces the requested output → overlap; propose extending `kb`, not a new skill.
     - NG: candidate is "summarize this PR's diff and post it to the retro issue" — `weekly-digest` posts to the retro issue but doesn't summarize a single PR's diff; invoking it would not satisfy the request → no overlap, proceed.

4. **Read before suggesting** for `skill_review_hints` and any case where overlap is possible:
   - Open the existing `SKILL.md` with `Read` before proposing edits.
   - If `skills.ts` already flagged the issue mechanically, confirm it on the actual file before showing it to the user.

5. **Meta cluster handling**:
   - When proposing a `meta_cluster`, summarize the metalevel ("Go code paste, 17 cluster, 34 occurrences in `<cwd>`") rather than walking through the 17 members.
   - If the user says `y`, you still create *one* skill (not 17). Use `sample_first_words` + `sample_codes` to draft the SKILL.md.
   - If the user says `n` or `skip`, automatically skip every member listed in `member_indices` — do not re-prompt them individually.
   - If the user says "show me the members", iterate over the `member_indices` in order.

6. **Naming new skills**: when promoting any cluster (meta or single), do not auto-name. Show the user `first_words` / `sample_first_words`, samples, and proposed scope, and ask them for `name` + `description`. Then write `SKILL.md` with that input.

7. **Final summary**: how many were applied, how many skipped, which paths changed. If any change touches a file under `~/.claude/...` (which is a symlink into the dotfiles repo), end with: `Changes landed in /Users/inouetsukasa/dotfiles/claude-code/...; run \`git status\` to review.` Do not commit automatically.

### Scope rules (minimum scope)

Use what the analyzer already computed in `scope_hint`. Don't second-guess unless the user disagrees:

- **`dead_skills`**: delete at the path the skill currently lives at. User-scope skills go to `~/.claude/skills/<name>/` (which resolves into dotfiles). Project-scope skills go to `<cwd>/.claude/skills/<name>/`.
- **`prompt_clusters` with `scope_hint: "project"`**: write to `<cwd>/.claude/skills/<name>/SKILL.md`. Create `<cwd>/.claude/skills/` if it doesn't exist.
- **`prompt_clusters` with `scope_hint: "user"`**: write to `~/.claude/skills/<name>/SKILL.md`.
- **`skill_review_hints`**: edit at the path returned. Never move a skill across scopes as part of a review fix.

### Behavior rules (skills mode)

- Never auto-name a new skill.
- Never delete a skill that has a non-zero invocation count in the data window, even if old.
- Never propose creating a skill without first showing `overlap_hints` / `code_overlap_hints` and scanning `available_skills`. If overlap exists, propose extending the existing skill instead of creating a parallel one.

---

## Corrections mode

Surfaces patterns where the user has corrected or interrupted Claude repeatedly, and proposes additions to CLAUDE.md or `.claude/rules/` so the correction does not need to be repeated. The signals are noisy by nature — the user always decides whether a candidate is real and worth codifying.

### Run

```!
bun ${CLAUDE_SKILL_DIR}/scripts/corrections.ts
```

The analyzer is read-only. It walks `~/.claude/projects/<encoded-cwd>/*.jsonl` and emits a JSON report. Key sections:

- `meta` — `sessions_scanned`, `oldest_session`, `data_window_days`, `pairs_by_kind`
- `correction_pairs[]` — clustered `(kind, tool_name, excerpt)` with sample contexts and `scope_hint`. Sorted: `failure_loop` first, then `interrupt`, then `correction`; by count within each kind.

`kind` is one of:
- `failure_loop` — same `(tool_name, excerpt)` failed (`tool_result.is_error: true`) ≥ 3 times back-to-back in one session. **Strongest signal** — Claude was stuck in a loop. Carries `max_chain_length` and `total_chain_length`.
- `interrupt` — user pressed Esc on a tool call. Strong signal.
- `correction` — user followed an assistant turn with a phrase like "no", "actually", "違う", "やめて". Weaker; relies on phrase match.

### Procedure

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

### Scope rules (minimum scope)

Use `scope_hint` from the analyzer as the default. Adjust only when reading the existing files reveals a better match.

- **`scope: "project"`**: write to `<cwd>/.claude/CLAUDE.md`, or `<cwd>/.claude/rules/<topic>.md` if the project's CLAUDE.md already exceeds ~180 lines.
- **`scope: "user"`**: write to `~/.claude/CLAUDE.md`, or `~/.claude/rules/<topic>.md` if either: (a) the user CLAUDE.md exceeds ~180 lines, or (b) the correction is language- or path-specific.
- **Path-specific candidates** (`path_hint` set, e.g. `.ts`, `.go`): prefer `~/.claude/rules/<lang>.md` with a `paths:` frontmatter field, since these load only when relevant files are open. If such a file already exists, append into it; do not create parallel files.

#### failure_loop-specific routing

`failure_loop` typically points to one of three patterns. Inspect `user_response` (the captured error text) to pick the right target:

- **PreToolUse hook block** (`user_response` contains `PreToolUse:...hook error`): the block ruleset is already enforcing something but the assistant kept retrying. Either the existing rule in `~/.claude/rules/shell-tools.md` is insufficient (re-phrase to be clearer), or add a positive guidance line to `~/.claude/CLAUDE.md` (e.g. `- Use rg/fd, not grep/find — the latter are blocked.`).
- **Missing toolchain** (errors like `command not found`, `No such file or directory`, lint binary missing): add the prerequisite to the language `rules/<lang>.md` (e.g. `rules/go.md`: `- golangci-lint must be installed; check with \`which golangci-lint\` first.`).
- **Repeated edit / write failure** on the same file: the file likely has a constraint Claude didn't know (codegen target, generated file, format-on-write hook). Add a project rule under `<cwd>/.claude/rules/` naming the file and the constraint.

"In doubt" means: the sample doesn't clearly match any of the three patterns above, or plausibly matches two (e.g. it contains both a hook-block phrase and a "command not found" phrase). In either case, ask the user which file to target before drafting the text — do not default to CLAUDE.md as a catch-all.

### Behavior rules (corrections mode)

- Always `Read` the target file before proposing edits. Never add without checking duplicates.
- Never silently strengthen an existing rule into a contradiction — surface the conflict to the user.
- Never auto-create a new `rules/<topic>.md` without telling the user which topic name you picked and why.
- If the sample text would expose secrets (paths inside `~/.claude/...`, environment variable names with values, hostnames in URLs), redact them in the rule text. The user's `security.md` rule applies here too.
- If the user says `n`, move on. Do not press, do not record the rejection.

### Out of scope (corrections mode)

- Cross-session "user repeated the same instruction" detection — that is skills mode's `prompt_clusters`. Run `/self-improve` (no argument) for skill-level proposals.
- Auto-apply. Even low-risk single-line additions go through y/n.
- Persisting rejections. If you skip a candidate today, it can resurface tomorrow.
- Loose failure clustering: only **back-to-back** same-input failures (≥ 3) count as a loop. A failure interleaved with other tool calls is not picked up.

---

## Shared rules (both modes)

- Present candidates as a batch, but apply changes one item at a time (no bulk Edit/Write).
- If the analyzer returns an empty list for a section, just say so — do not invent items.

### Symlinks

`~/.claude/skills`, `~/.claude/agents`, `~/.claude/rules`, `~/.claude/CLAUDE.md` are all symlinks into the dotfiles repo. Before performing any destructive operation (`rm`, `mv`) or write, use `realpath` to show the resolved path, and present that to the user. Operate on the real path, not the symlink, so the dotfiles git status reflects the change cleanly.
