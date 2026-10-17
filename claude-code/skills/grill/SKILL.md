---
name: grill
description: Interviews the user in small rounds (about 3 questions each) to deepen and stress-test their thinking on a decision, plan, or personal topic such as career, surfacing gaps and assumptions, then records the outcome in whatever document format the current repo already uses. User-invoked via /grill only.
argument-hint: [深掘りしたいテーマ]
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion, Write, Edit
---

# /grill: round-based interview, then a repo-native record

Interview the user until the topic reaches a shared understanding, then write
the result down in the form this repo already uses. Match the user's
conversation language in all dialogue.

Topic: $ARGUMENTS (if empty, ask for it in one line before anything else).

Adapted from `grilling` in [mattpocock/skills](https://github.com/mattpocock/skills)
(design tree, frontier, facts-are-mine/decisions-are-yours). Changed here:
round size cap, answer-first for heavy questions, visible progress, gap check,
and a written record.

## Why this shape

- **≤3 questions per round, one theme.** Working memory holds about 4 chunks
  (Cowan 2001); a round on one theme keeps the user from juggling contexts.
- **Answer before recommendation on heavy questions.** A recommendation shown
  first acts as a default/anchor and invites shallow agreement. Asking for the
  user's own answer first, then showing the recommendation with the strongest
  counter-argument ("consider the opposite", Mussweiler et al. 2000), keeps
  the thinking theirs.
- **"約N問", estimated high.** In a meta-analysis of 32 web-survey experiments
  (Villar et al. 2013), constant progress indicators didn't reduce breakoff,
  fast-to-slow reduced it, slow-to-fast increased it. So overestimate early
  and never show the count as a deadline.
- **State on screen, not in the user's head.** Decided items are re-shown
  every round so the user never has to remember earlier answers.

## Step 1: Orient (before the first question)

1. Read the repo's `CLAUDE.md` and any rules it imports or points to for the
   topic's domain (e.g. ops: `.claude/rules/career.md`). These rules govern
   what you may claim and where things are written; they override this skill.
2. Note how the repo records decisions and investigations: `docs/`, ADR
   directories, `memory/`, issue templates, per-domain SSoT files. Don't
   decide the output location yet.
3. Facts are your job, never the user's. Anything answerable from files,
   git, or tools: look it up (dispatch an `Agent` with `model: sonnet` for
   broader searches). Decisions and values are the user's.
4. Build the design tree: decisions, and which decisions hang off which.

## Step 2: Rounds

Each round:

- Pick the frontier: questions whose prerequisites are settled. A question
  depending on another open question in this round goes to a later round.
- Take at most 3, all on one theme. Prefer shallower dependencies first.
- Tag each question:
  - **[重]**: irreversible decisions, values, career direction. Ask for the
    user's own answer first; give no recommendation yet.
  - **[軽]**: naming, format, reversible choices. Recommend up front:
    `➡️ 推奨: X（代替: Y / 外れる条件: Z / 確信度: 高・好み）`.
  - **[掘]**: at most one per round. A why/how follow-up on an earlier
    answer. For career or past-failure topics, phrase as 「どんな場面で」
    「何がきっかけで」, not 「なぜ」.
- Each question body starts with a one-line restatement of the premise it
  rests on, and offers at most 3 choices if it offers choices at all.

Round format:

```
Round N | 残り約M問（決定済みA / 未決定B / 依存待ちC）
決定済み: ① … ② … ③ …
今回のテーマ: …

Q1 [重] … → まずあなたの考えを
Q2 [軽] … ➡️ 推奨: …（代替: … / 外れる条件: …）
Q3 [掘] …

いつでも「ここで要約して止める」を選べます。
```

After the user answers:

1. For each [重] answer, now give your recommendation, the strongest case
   against the user's answer, and the condition under which it would be
   wrong. Let the user keep or revise.
2. If an answer is a generality (「保守性が大事」), ask for one concrete
   example or counterexample before treating it as settled.
3. If an answer is vague, rephrase the same question once rather than
   moving on.
4. Reflect back: one short summary in your own words; the user corrects it.
5. Recompute the tree. When the estimate grows, say why in one line
   (「Q2 の答えで依存する問が2つ増えたため」). When a decision is revised,
   mark the decisions downstream of it 「要再確認」.
6. If the user accepts the recommendation on 3 questions in a row, the next
   round includes one pre-mortem question on one of those decisions:
   「これが間違っていたとしたら、一番ありそうな原因は？」

## Step 3: Gap check and pre-mortem (final round)

When the frontier is empty, run one last round before declaring done:

- Silently check coverage against a domain list and present only uncovered
  areas as 「抜けているかもしれない領域」. Use the list only to find gaps,
  never to order questions.
  - Repo/design: purpose, constraints, change frequency, operations,
    security, failure/rollback, exit conditions.
  - Career: values, strengths, constraints, market, relationships, what
    energizes vs. drains, timeline.
- One pre-mortem question on the topic as a whole:
  「1年後にこれが失敗していたら、最も可能性の高い理由は？」

The session is done when the frontier is empty, the final round is answered,
and the user confirms the shared understanding.

## Step 4: Record

1. Propose where and in what form to write, based on Step 1: an existing SSoT
   file to update, a new note under the repo's investigation/notes directory,
   an ADR if the repo already keeps ADRs, or an issue. Show the path and an
   outline, confirm with the user, then write. Never invent a new directory
   convention when an existing one fits.
2. Content: decisions with their reasons, rejected alternatives, open
   questions, uncovered gaps, and the pre-mortem answer. Quote the user's own
   words where the repo's rules treat them as source material.
3. Follow the repo's truthfulness and language rules (e.g. ops career content
   must be grounded in its SSoT; mark anything else 「推測」).
4. Don't commit from this skill; the repo's normal commit workflow applies.

## Red flags

| Rationalization | Reality |
|---|---|
| 「全部の論点を1ラウンドで出せば速い」 | 3問・1テーマまで。残りは次ラウンドへ。 |
| 「[重] の問も推奨を先に見せたほうが親切」 | 先に見せると同意だけで終わる。本人の答えが先。 |
| 「ファイルを見れば分かることも聞いて確認しよう」 | 事実は自分で調べる。ユーザーに聞くのは決定だけ。 |
| 「残り数は正確に出すべき」 | 総数は動く。多めの「約」で出し、増えたら理由を書く。 |
| 「記録は ADR 形式で書けばいい」 | そのリポジトリの既存の形式に合わせる。ADR はあるときだけ。 |
