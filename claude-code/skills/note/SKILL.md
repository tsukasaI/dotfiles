---
name: note
description: >
  Save knowledge into the Obsidian vault (~/engineer/vault/notes). Use when the user says
  メモして / ノートに保存 / vaultに入れて / TIL / 調査結果を保存して, when they want a finding
  from the current conversation recorded for later reuse, or /note <topic> to research a
  topic and save the result. Appends to an existing topic note when one matches instead of
  creating duplicates.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, WebSearch, WebFetch
---

# /note — capture knowledge into the vault

Persist research findings, TILs, and learnings into the knowledge vault so they are
retrievable later via `/kb`. The vault conventions are defined in the vault's own
`README.md` — that file is the SSoT; this skill summarizes it but defers to it.

## Step 0: load config

Read `${CLAUDE_SKILL_DIR}/../_shared/kb.json`. `notes_dir` is where notes live
(`~` = home). If `notes_dir` does not exist, ask the user before creating anything —
never silently create the vault.

## Step 1: classify the input

- **(a) Conversation capture** — the user points at something already discussed
  ("さっきの調査結果を保存"). Source = this conversation. If there is nothing concrete
  to capture, say so and ask what to save. Never fabricate a finding.
- **(b) TIL** — a short standalone fact or gotcha the user states.
- **(c) Topic research** — `/note <topic>` with no prior discussion: research first
  (WebSearch/WebFetch/code reading), then save. Every claim needs a source.

## Step 2: search before writing (mandatory)

Derive 2-4 keywords (Japanese AND English variants). Search existing notes:

```
rg -il '<kw1>|<kw2>' <notes_dir>
rg -N '^tags:' <notes_dir> --no-filename   # existing tags, for reuse
```

Also check the legacy location `legacy_notes` from kb.json (read-only; new notes never
go there).

- **Clear topic match** → Read the whole existing note first (house rule), then append.
- **No match** → new file.
- **Partial overlap** (could fit 2+ notes, or unclear whether to split a topic) →
  AskUserQuestion with the concrete choices.

## Step 3: write

Format (SSoT: `<vault_root>/README.md`):

- Filename: lowercase-kebab English slug, e.g. `go-context-cancellation.md`. One topic
  = one file; entries accrete inside it.
- Frontmatter keys, fixed set: `tags` (reuse existing tags before minting new ones),
  `created`, `updated`, `sources` (URLs or `repo@shorthash`).
- Body: `# Title`, then dated entry sections `## YYYY-MM-DD: <entry title>`, newest
  last. Wikilinks `[[other-slug]]` to related notes are encouraged.
- Language: match the conversation language.
- Mark every unverified claim inline with `**（推測）**` / `**(unverified)**`.

When appending to an existing note:
- Add a new `## <today>: ...` section; do not rewrite old entries.
- Update `updated:` in the frontmatter; merge (never remove) `tags`/`sources`.
- If the new content contradicts an existing entry, surface the contradiction to the
  user BEFORE writing; record the resolution explicitly in the new entry.

If the file already exists but is not a match for appending (name collision), ask.

## Step 4: report

Reply with the file path, a one-line summary of what was saved, and — when relevant —
which existing note it was merged into.

## Hard limits

- Do NOT `git commit`, push, or publish anything. The user commits when they choose.
- Do NOT edit or move existing notes beyond the append/merge described above.
- Do NOT write outside `notes_dir` (and never into `legacy_notes`).
