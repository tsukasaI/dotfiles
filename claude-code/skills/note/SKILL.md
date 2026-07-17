---
name: note
description: >
  Save knowledge into the Obsidian vault (~/engineer/vault/notes). Use when the user wants
  to persist a finding or TIL (メモして / "save to notes"), or /note <topic> to research
  and save. Appends to existing topic notes rather than creating duplicates. Write-side of
  the vault (to search existing → /kb).
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

*Done:* kb.json read; notes_dir confirmed to exist (or user asked).

## Step 1: classify the input

- **(a) Conversation capture** — the user points at something already discussed
  ("さっきの調査結果を保存"). Source = this conversation. If there is nothing concrete
  to capture, say so and ask what to save. Never fabricate a finding.
- **(b) TIL** — a short standalone fact or gotcha the user states.
- **(c) Topic research** — `/note <topic>` with no prior discussion: research first
  (WebSearch/WebFetch/code reading), then save. Every claim needs a source.

*Done:* input classified as (a), (b), or (c).

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

*Done:* decision made — append to existing, create new, or user chose from options.

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
- **Concurrency guard (optimistic check):** another session may append to the same
  note between your Step 2 Read and this Write. Right after the Read, capture a
  fingerprint (`shasum -a 256 <file>` or `stat -f %m <file>`). Immediately before
  Write/Edit — as the last action, not earlier — re-run the same fingerprint check.
  If it changed, STOP: do not write. Re-read the file, re-merge your new section
  against the current content, and re-check the fingerprint again before writing.
  Since each entry lives under its own dated `## YYYY-MM-DD: <entry title>` heading,
  a retried merge is naturally idempotent — it cannot clobber a section another
  session already added.

If the file already exists but is not a match for appending (name collision), ask.

*Done:* file written with correct frontmatter and formatted entry.

## Step 4: report

Reply with the file path, a one-line summary of what was saved, and — when relevant —
which existing note it was merged into.

*Done:* path + summary reported to user.

## Red flags

| Rationalization | Reality |
|---|---|
| "検索したが似たものが無さそうなので新規作成" | 1パスで miss を断定しない。日英・略称バリアントを全部試したか確認。 |
| "追記より書き直した方が分かりやすい" | 書き直さない。既存エントリは歴史。新しい `##` セクションを追加する。 |
| "このくらいの内容なら frontmatter は省略してよい" | 省略不可。tags/created/updated/sources は全ファイル必須。 |
| "矛盾しているが最新の方が正しいはずなので上書き" | 上書きしない。矛盾をユーザーに提示し、解決を記録してから書く。 |

## Hard limits

- Do NOT `git commit`, push, or publish anything. The user commits when they choose.
- Do NOT edit or move existing notes beyond the append/merge described above.
- Do NOT write outside `notes_dir` (and never into `legacy_notes`).
