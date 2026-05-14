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
- `dead_skills` — skills with no recent invocation
- `prompt_clusters` — recurring user inputs grouped by `(cwd, first_5_words)`
- `slash_command_frequency` — how often each existing `/<name>` was invoked (FYI; do not propose deleting popular ones)
- `skill_review_hints` — mechanical drift detection per `SKILL.md`

## Procedure

1. **Check `meta.data_sufficient`**. If `false`, skip the `dead_skills` section (the analyzer already returns `[]` in that case) and tell the user the dead-skill check needs `data_window_days` of history to be reliable. Continue with `prompt_clusters` and `skill_review_hints` regardless — they don't depend on the window.

2. **Walk through suggestions one at a time**. Maintain a running count (`[CANDIDATE i/N]`). For each, render:

   ```
   [CANDIDATE i/N] kind: <dead_skill|new_skill|skill_review> | scope: <user|project>
     evidence: <counts, dates, cwd list, sample prompts>
     target: <resolved absolute path>
     proposal:
       <one of: delete this skill / create new skill / edit existing SKILL.md>
     apply? [y/n/skip]
   ```

   Ask the user. **Only on `y`** perform the actual Bash / Edit / Write. On `n` or `skip` move to the next candidate.

3. **Read before suggesting** for `skill_review_hints` and any case where overlap is possible:
   - Open the existing `SKILL.md` with `Read` before proposing edits.
   - If `analyze.ts` already flagged the issue mechanically, confirm it on the actual file before showing it to the user.

4. **Naming new skills**: when promoting a `prompt_cluster`, do not auto-name. Show the user the `first_words`, `samples`, and proposed scope, and ask them for `name` + `description`. Then write `SKILL.md` with that input.

5. **Final summary**: how many were applied, how many skipped, which paths changed. If any change touches a file under `~/.claude/...` (which is a symlink into the dotfiles repo), end with: `Changes landed in /Users/inouetsukasa/dotfiles/claude-code/...; run \`git status\` to review.` Do not commit automatically.

## Scope rules (minimum scope)

Use what the analyzer already computed in `scope_hint`. Don't second-guess unless the user disagrees:

- **`dead_skills`**: delete at the path the skill currently lives at. User-scope skills go to `~/.claude/skills/<name>/` (which resolves into dotfiles). Project-scope skills go to `<cwd>/.claude/skills/<name>/`.
- **`prompt_clusters` with `scope_hint: "project"`**: write to `<cwd>/.claude/skills/<name>/SKILL.md`. Create `<cwd>/.claude/skills/` if it doesn't exist.
- **`prompt_clusters` with `scope_hint: "user"`**: write to `~/.claude/skills/<name>/SKILL.md`.
- **`skill_review_hints`**: edit at the path returned. Never move a skill across scopes as part of a review fix.

## Symlinks

`~/.claude/skills`, `~/.claude/agents`, `~/.claude/rules`, `~/.claude/CLAUDE.md` are all symlinks into the dotfiles repo. Before performing any destructive operation (`rm`, `mv`) or write, use `realpath` to show the resolved path, and present that to the user. Operate on the real path, not the symlink, so the dotfiles git status reflects the change cleanly.

## Behavior rules

- Never apply a batch. Always one item at a time.
- Never auto-name a new skill.
- Never delete a skill that has a non-zero invocation count in the data window, even if old.
- If `analyze.ts` returns an empty list for a section, just say so — do not invent items.
- If the user says `n`, do not ask why. The analyzer does not record rejections in v1.
