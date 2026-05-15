---
name: self-improve
description: Review Claude Code skill usage by scanning ~/.claude/projects/*.jsonl. Surface unused skills, repeated prompts that should become new skills, and SKILL.md drift. Propose minimum-scope changes one at a time. User-invoked only, always dry-run.
allowed-tools: Bash, Read, Edit, Write, Glob
disable-model-invocation: true
---

# Self-Improve

Scans the user's transcripts and proposes skill-level changes:

1. **Dead skills** — installed but unused for ≥ 90 days
2. **Repeated prompts** — recurring inputs that should be promoted to a skill / slash command
3. **SKILL.md drift** — references to files / agents that no longer exist

This skill never applies changes without per-item approval.

## Run

Execute the analyzer and capture the JSON:

```!
bun ${CLAUDE_SKILL_DIR}/scripts/analyze.ts
```

The analyzer is read-only. It walks `~/.claude/projects/<encoded-cwd>/*.jsonl`, the standard Claude Code transcript store, and emits a JSON report with these sections:

- `meta` — `sessions_scanned`, `oldest_session`, `data_window_days`, `data_sufficient`
- `available_skills` — every SKILL.md visible from the current `cwd` (user-global + cwd + ancestors up to git root). Use this when judging whether a new-skill proposal overlaps something that already exists
- `dead_skills` — skills with no recent invocation
- `meta_clusters` — semantically grouped clusters (currently `meta_kind: "code_paste"` per `(scope_target, language)`). Always present these *before* `prompt_clusters`
- `prompt_clusters` — recurring user inputs grouped by `(cwd, first_5_words)`. Each may carry `overlap_hints` (lexical keyword match against `available_skills`) and `in_meta_cluster: true` when already grouped into a meta cluster
- `slash_command_frequency` — how often each existing `/<name>` was invoked (FYI; do not propose deleting popular ones)
- `skill_review_hints` — mechanical drift detection per `SKILL.md`

## Procedure

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
   - Even when both lists are empty, scan `available_skills` once and look for any skill whose `description` or `body_first_500_chars` semantically covers the candidate. Lexical keyword match misses cross-domain cases (e.g. an English skill description vs. user-pasted code).

4. **Read before suggesting** for `skill_review_hints` and any case where overlap is possible:
   - Open the existing `SKILL.md` with `Read` before proposing edits.
   - If `analyze.ts` already flagged the issue mechanically, confirm it on the actual file before showing it to the user.

5. **Meta cluster handling**:
   - When proposing a `meta_cluster`, summarize the metalevel ("Go code paste, 17 cluster, 34 occurrences in `<cwd>`") rather than walking through the 17 members.
   - If the user says `y`, you still create *one* skill (not 17). Use `sample_first_words` + `sample_codes` to draft the SKILL.md.
   - If the user says `n` or `skip`, automatically skip every member listed in `member_indices` — do not re-prompt them individually.
   - If the user says "show me the members", iterate over the `member_indices` in order.

6. **Naming new skills**: when promoting any cluster (meta or single), do not auto-name. Show the user `first_words` / `sample_first_words`, samples, and proposed scope, and ask them for `name` + `description`. Then write `SKILL.md` with that input.

7. **Final summary**: how many were applied, how many skipped, which paths changed. If any change touches a file under `~/.claude/...` (which is a symlink into the dotfiles repo), end with: `Changes landed in /Users/inouetsukasa/dotfiles/claude-code/...; run \`git status\` to review.` Do not commit automatically.

## Scope rules (minimum scope)

Use what the analyzer already computed in `scope_hint`. Don't second-guess unless the user disagrees:

- **`dead_skills`**: delete at the path the skill currently lives at. User-scope skills go to `~/.claude/skills/<name>/` (which resolves into dotfiles). Project-scope skills go to `<cwd>/.claude/skills/<name>/`.
- **`prompt_clusters` with `scope_hint: "project"`**: write to `<cwd>/.claude/skills/<name>/SKILL.md`. Create `<cwd>/.claude/skills/` if it doesn't exist.
- **`prompt_clusters` with `scope_hint: "user"`**: write to `~/.claude/skills/<name>/SKILL.md`.
- **`skill_review_hints`**: edit at the path returned. Never move a skill across scopes as part of a review fix.

## Symlinks

`~/.claude/skills`, `~/.claude/agents`, `~/.claude/rules`, `~/.claude/CLAUDE.md` are all symlinks into the dotfiles repo. Before performing any destructive operation (`rm`, `mv`) or write, use `realpath` to show the resolved path, and present that to the user. Operate on the real path, not the symlink, so the dotfiles git status reflects the change cleanly.

## Behavior rules

- Present candidates as a batch, but apply changes one item at a time (no bulk Edit/Write).
- Never auto-name a new skill.
- Never delete a skill that has a non-zero invocation count in the data window, even if old.
- If `analyze.ts` returns an empty list for a section, just say so — do not invent items.
- If the user says `n`, do not ask why. The analyzer does not record rejections.
- Never propose creating a skill without first showing `overlap_hints` / `code_overlap_hints` and scanning `available_skills`. If overlap exists, propose extending the existing skill instead of creating a parallel one.
