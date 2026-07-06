---
name: weekly-digest
description: >
  Weekly cross-repo activity digest: gathers this week's commits across ~/engineer,
  Contextual Commit learned/decision/rejected lines, new vault notes, and article-draft
  movement, then posts the digest as a comment on this week's retro issue in the ops
  repo (with confirmation). Use for /weekly-digest or 週次ダイジェスト. Feeds the existing
  /retro workflow — it gathers material, it does not do the reflection.
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
disable-model-invocation: true
---

# /weekly-digest — cross-repo weekly activity digest

Role split with the ops `/retro` skill: **this skill collects facts; the human (guided
by `/retro`) does the reflection.** Numbers come from the harvester, never from memory.

## Step 1: gather

Read `${CLAUDE_SKILL_DIR}/../_shared/kb.json` (→ `ops_repo`, `ideas_file`). Then:

```
bun ${CLAUDE_SKILL_DIR}/../_shared/harvest.ts --mode=weekly
```

Default window = last Monday. `/weekly-digest YYYY-MM-DD` backfills a past week via
`--since=`. If the script fails, show its stderr and stop — do not reconstruct
numbers by hand.

## Step 2: synthesize the digest (English — ops issue convention)

Sections, in order; omit a section only by stating it is empty:

1. `### Activity` — table: repo | commits | one-line theme. Derive the theme
   mechanically: take the most frequent Conventional Commit `type(scope)` pair across
   the week's commits for that repo (e.g. 3× `feat(auth)` + 1× `fix(auth)` → "auth
   features"); if types split evenly, use the scope alone ("auth work"). Add
   sessions-per-project from `sessions` as a secondary column when available.
2. `### Learned / decisions digest` — every `learned`/`decision`/`rejected` line
   **verbatim** with `repo@hash`, grouped by repo. Do not paraphrase (ops house rule:
   record verbatim). If there are more than ~30 lines, keep all `learned`/`rejected`
   verbatim and summarize `decision` counts per repo instead — say you did so.
3. `### Article candidates` — at most 3, only with verbatim evidence, cross-checked
   against `ideas_file` (skip ones already listed; reference them instead). None →
   "No new candidates this week."
4. `### Open threads` — rejected() lines with no follow-up commit, WIP drafts touched
   then abandoned, notes created but marked 推測/unverified. Phrase as questions
   ("Is X still worth pursuing?") — prompts for the retro, not assignments.

## Step 3: deliver

1. Find this week's retro issue:
   ```
   gh issue list -R <ops_repo> --label retro --state open --limit 5
   ```
   Match by date, not by eyeballing which "looks right": compute this week's Monday
   (the same window start used in Step 1) and pick the issue whose title contains that
   ISO date (`YYYY-MM-DD`) or the corresponding week number. If more than one issue
   matches, or none does, print the digest in the conversation and stop — do not
   create an issue, do not guess between candidates.
2. **Show the full comment body to the user and ask for confirmation before posting.**
   This gate is mandatory on every run.
3. On yes: `gh issue comment <number> -R <ops_repo> --body-file <tempfile>` (write the
   body to the session scratchpad first; heredocs mangle backticks). On no: leave the
   digest in the conversation.

## Hard limits

- Read-only against every repo: no commits, no file writes outside the scratchpad.
- Never create/close/edit issues — comment on the existing retro issue only, and only
  after explicit confirmation in Step 3.
- Never post anywhere other than `ops_repo`.
