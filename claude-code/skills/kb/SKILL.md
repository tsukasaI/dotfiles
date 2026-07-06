---
name: kb
description: >
  Search the knowledge vault (~/engineer/vault) and answer from it with file references.
  Use for /kb <query>; when the user asks 前に調べたことあったっけ / ノートにあったはず /
  ノート見て / vaultに何かあったっけ; or in English "did I look into this before" /
  "check my notes for X" / "is this in the vault". Read-only: never writes files.
allowed-tools: Bash, Read, Glob, Grep
---

# /kb — search the knowledge vault

Answer questions from the user's own notes, with sources. This skill is read-only.

## Step 0: load config

Read `${CLAUDE_SKILL_DIR}/../_shared/kb.json`. Search targets, in priority order:
1. `notes_dir` (the vault — primary)
2. `legacy_notes` (ops study notes — transitional)
3. `drafts_repo` `*.md` (article drafts) — include when the user asks broadly
   ("何か書いてたっけ").

If the vault is missing or empty, say exactly that and suggest `/note` to start it.
Do not silently answer from general knowledge as if it came from the notes.

## Step 1: search

Expand the query into search variants before running anything:
1. The query as given.
2. Its Japanese ⇄ English translation (notes mix both languages).
3. 1-2 domain synonyms only if they are near-exact substitutes (an abbreviation and
   its expansion, or a library's old vs. new name) — not broader/related concepts.

Example: "goroutine leak" → `goroutine leak`, `ゴルーチン リーク`. Stop there.
NG: do NOT also add `concurrency bug` / `race condition` for the same query — those
are related topics, not synonyms, and pollute results with false hits.

Then two passes:

```
rg -il '<variant1>|<variant2>' <targets>        # which files
rg -in -C2 '<variant1>|<variant2>' <hit files>  # where inside them
```

If the query looks like a tag, also try `rg -il '^tags:.*<tag>' <notes_dir>`.

## Step 2: answer

- Read the top hits fully (cap ~5 files) and synthesize an answer.
- Every claim from the notes carries its source: `notes/<slug>.md` (+ entry date).
- Keep "what the notes say" strictly separate from "what I additionally know" — label
  the latter explicitly if you include it at all.
- If notes contradict each other, present both entries with dates; do not pick silently.

## Step 3: on a miss

No hits → state "KBには該当なし", list the query variants tried, and offer to research
the topic now and save it via `/note` (that turns the miss into a future hit).

## Hard limits

- Never write, edit, move, or delete any file. If the user wants to save something,
  hand off to `/note`.
