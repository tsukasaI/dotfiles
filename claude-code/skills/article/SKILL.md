---
name: article
description: >
  Tech-article pipeline for ~/engineer/qiita_drafts. Three modes — /article (ネタ出し:
  harvest candidates from Contextual Commit lines, vault notes, and the drafts backlog),
  /article <topic> (骨子: outline only — the human writes the prose), /article review
  <file> (レビュー of a human-written draft). Never publishes, never commits.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, WebSearch, WebFetch
disable-model-invocation: true
---

# /article — article pipeline (ideas → outline → review)

Division of labor (agreed with the user, consistent with the ops `/blog` philosophy):
**AI does ネタ出し and 骨子 (outline). The human writes the body text. AI reviews.**
Do NOT write article prose paragraphs. Do NOT publish. Do NOT commit.

Root quality: **grounded** — every claim traces to a vault note, commit hash, or
code reference. Ungrounded = marked 推測 or not included.

## Step 0: load config

Read `${CLAUDE_SKILL_DIR}/../_shared/kb.json` → `drafts_repo`, `ideas_file`, `notes_dir`.

Mode selection from the invocation:
- bare `/article` or ネタ / ネタ出し → **Mode A**
- `/article review <path>` → **Mode C**
- `/article <topic>` → **Mode B**

*Done:* kb.json parsed; mode (A/B/C) determined from invocation.

## Mode A — ネタ出し (candidate harvesting)

1. Run the harvester and parse its JSON:
   ```
   bun ${CLAUDE_SKILL_DIR}/../_shared/harvest.ts --mode=candidates
   ```
   (Default window 30 days; pass `--since=YYYY-MM-DD` if the user asks for more.)
   *Done:* JSON parsed, non-empty (or "nothing found" with window stated).
2. Cross-reference four evidence pools:
   - `contextual_lines` — especially `learned`/`rejected`/`decision` (non-obvious
     experience = the strongest article material)
   - `kb.notes` — recently updated vault notes
   - `drafts.backlog_ideas` — the README `## future` backlog (prefer reviving an
     existing idea over minting a new one)
   - `drafts.wip` — half-written drafts (finishing these ranks above any new idea)
   *Done:* candidates collected; each is grounded (≥1 verbatim evidence line).
3. Read `ideas_file` (the ledger) BEFORE proposing: skip candidates already listed
   unless there is new evidence; never duplicate entries.
   *Done:* existing ledger loaded; new candidates de-duped against it.
4. Present a ranked list. Every candidate follows the ledger format defined in the
   comment at the top of `ideas_file` (title / evidence verbatim with repo@hash or
   note path / angle / audience / effort: draft-ready | needs-verification |
   needs-research). Ranking: WIP completion first, then evidence density (≥2
   independent sources beats 1), then recency.
   **A candidate without verbatim evidence must not appear.** If harvest yields
   nothing, say so plainly, show the window used, and offer `--since` widening.
   *Done:* ranked list shown to user, or "nothing found" with window stated.
5. After presenting, update `ideas_file`: Read it, merge the new candidates under
   `## candidates` (status: idea, added: today). Do not touch `## archive` except to
   move items the user explicitly drops.
   *Done:* ideas_file updated with new entries under `## candidates`.
6. End by asking which candidate to outline (→ Mode B), or none.
   *Done:* user chose a candidate (→ Mode B) or explicitly declined.

## Mode B — 骨子 (outline only)

1. **Check repo conventions at runtime**: list `drafts_repo`, read 1-2 recent root
   drafts. Current verified convention: plain Markdown, `# Title` H1, no frontmatter,
   Japanese body, root = WIP, `published/` = shipped. Follow whatever is actually
   there — if the user has since adopted qiita-cli or zenn-cli, match that instead.
   - **If conventions are ambiguous** (drafts disagree, `drafts_repo` is empty, or
     fewer than 2 comparable root drafts exist): fall back to the verified convention
     above and say so explicitly ("no clear existing convention found; using plain
     Markdown default") — never guess a new convention silently.
   *Done:* convention identified from ≥2 drafts, or fallback stated explicitly.
2. **Gather grounding**: search the vault (`/kb`-style rg) for the topic; `git -C
   <repo> show <hash>` for evidence commits from Mode A; read the actual code the
   learned-lines refer to. Every section-level claim traces to one of these three
   sources or is marked `**（推測・要検証）**` — there is no third option.
   - Example: a claim about "why we chose X" traces to a `decision()` line at
     `repo@hash` → cite it inline, no mark needed.
   - NG: "X is generally considered best practice" with no source found in
     vault/commits/code → search harder or mark `**（推測・要検証）**`, never state
     it as fact.
   *Done:* every planned section is grounded (source attached) or marked 推測.
3. **Write the outline** to `<drafts_repo>/<topic-slug>.md` (lowercase-kebab English
   slug). If the filename exists → AskUserQuestion (append into it / new name / stop).
   Structure:
   - `# <日本語タイトル>`
   - A pre-publish checklist as an HTML comment (template below)
   - For each section: `## <見出し>` followed by bullet points — each bullet pairs a
     claim with its evidence (`repo@hash`, note path, or URL). Mark anything
     ungrounded `**（推測・要検証）**`.
   - `## まとめ` bullets and `## 参考リンク`.
   - NO prose paragraphs — bullets and headings only. The human writes the text.
   *Done:* file created at `<drafts_repo>/<slug>.md` with checklist + evidence bullets.
4. Run a secrets scan on the created file and report the result:
   ```
   gitleaks detect --no-git --source <file> 2>&1 | tail -5
   ```
   *Done:* gitleaks exit code and output reported to user.
5. Checklist template (embed at the top of the outline):
   ```
   <!-- 公開前チェックリスト (公開前に削除)
   [ ] gitleaks でスキャン済み（骨子生成時: <結果>）
   [ ] コードサンプルを実際に実行して動作確認した
   [ ] （推測・要検証）マークを全て解消した
   [ ] 内部パス・実名リポジトリ・秘密情報が本文とコードに残っていない
   [ ] タイトルが内容を誇張していない
   [ ] 公開後に published/ へ移動する
   -->
   ```

## Mode C — レビュー (human-written draft)

Read the given file and review:
1. Claims: anything not grounded (stated as fact without source or runnable demo) →
   list with line numbers. Verify checkable claims against docs (WebSearch/WebFetch)
   and label each 確認済み / 要出典 / 誤り.
   *Done:* every factual claim labeled grounded or not.
2. Secrets/privacy: run the gitleaks scan (command above) + eyeball for internal
   paths, tokens, real names.
   *Done:* gitleaks run + manual scan complete; findings listed.
3. Structure: hook, one-idea-per-section, title accuracy. Suggest, don't rewrite —
   propose changes as a list; only apply edits the user approves.
   *Done:* suggestions presented as a list; no edits applied without approval.

## Red flags

| Rationalization | Reality |
|---|---|
| "骨子だけでなく本文も少し書いておく" | 書かない。本文は人間の仕事。骨子に散文が混ざると「AI が書いた」事実が消えない。 |
| "エビデンスが見つからないが一般論として書ける" | 書けない。エビデンスなしの claim は **（推測・要検証）** マーク必須。マークなしは嘘。 |
| "ファイルが既にあるので上書きする" | しない。AskUserQuestion で確認。人間の WIP かもしれない。 |
| "このトピックは vault にも commit にも無いが、自分の知識で補える" | 補えない。3つのソース（vault / commit / code）に無ければマークするか、検索範囲を広げる。 |

## Hard limits

- Never publish (no `gh`, no qiita/zenn CLI publish commands, no network posts).
- Never `git commit` or push in any repo.
- Never write prose paragraphs into a draft (Mode B is bullets/headings only).
- Never delete or move existing drafts (moving to `published/` is the human's act,
  after actual publication).
