---
name: failure-archaeology
description: >
  Mine a repo's git history into a decision ledger / handover document: extract
  Contextual Commit body lines (intent/decision/rejected/constraint/learned), detect
  true reverts, and cluster repeated fixes on the same area. Use when: writing a
  handover doc, 過去の経緯調査 (investigating why code got this way), before
  refactoring an area you don't own the history of, "why is this code like this",
  or reconstructing a decision ledger / ADR set from commit history. NOT for:
  routine commit-message writing, or periodic cross-repo digests — that's the
  `weekly-digest` skill.
allowed-tools: Bash, Read, Grep, Glob
disable-model-invocation: true
---

# /failure-archaeology — mine git history into a decision ledger

## 目的 / Purpose

Turn a repo's (or one area's) commit history into a structured ledger: what was
intended, what was decided, what was rejected and why, what broke and had to be
reverted, and which areas keep getting re-fixed. This is on-demand archaeology for
one investigation, not a recurring report.

## When NOT to use

- Periodic, cross-repo activity summaries → `weekly-digest` (uses `harvest.ts
  --mode=weekly`, posts to the ops retro issue).
- Saving one finding from this conversation to the vault → `note`.
- Writing a commit message for work you just did → just follow the Contextual
  Commits convention in `~/.claude/CLAUDE.md` (Workflow section, SSoT — don't
  restate the format here).

## Procedure

### Step 0: scope the investigation

Ask (or infer from the request): which repo, which path/area (e.g. a directory or
file), and how far back. Default to the whole repo history if no area is given.

*Done:* repo, path (or "all"), and time range confirmed.

### Step 1: extract contextual lines for the area

```
git log --format='%H%n%B%n===END===' -- <path> | rg -B3 '^(intent|decision|rejected|constraint|learned)\('
```

For SHA + date alongside each line, pair with:

```
git log --format='%h %ad %s' --date=short -- <path>
```

This is the same `intent|decision|rejected|constraint|learned` grammar
`claude-code/skills/_shared/harvest.ts` parses via its `CONTEXT_RE` regex — reuse
that regex as the canonical definition, don't restate it as prose elsewhere.

**Do not reuse harvest.ts's CLI for this skill.** It only supports
`--mode=weekly|candidates`, discovers *all* repos under `~/engineer` (no
single-repo/path scoping), and has no revert-detection or clustering logic — it's
built for the cross-repo weekly/candidates use case, not single-area archaeology.
If the investigation later needs a cross-repo pass, hand off to `weekly-digest`
instead of reimplementing that here.

*Done:* contextual lines collected with SHA+date (or confirmed empty — itself a finding).

### Step 2: detect true reverts (not just grep hits)

```
git log --grep=revert -i --format='%H %s'
```

This over-matches — commits that merely *mention* "revert" in prose show up too.
Confirm each hit actually reverts something by checking the subject prefix or
`git revert` trailer:

```
git show -s --format='%s%n%b' <hash> | head -5
```

A true revert has subject `revert(<scope>): ...` (Contextual Commits convention)
or a `This reverts commit <sha>` trailer. Verified in this repo's own history: of
4 grep hits, only 1 (`revert(claude-code): drop CLAUDE_CODE_DISABLE_MOUSE_CLICKS`)
was a true revert — the other 3 just used the word "revert" in a decision/intent
line.

*Done:* all grep hits classified as true revert or false positive.

### Step 3: cluster repeated fixes on the same area

Scope frequency across an area (which files/scopes get touched most):

```
git log --format='%s' --no-merges -- <path> | rg -o '^\w+\(([^)]+)\)' -r '$1' | sort | uniq -c | sort -rn
```

Fix-only frequency (candidate "kept breaking" clusters):

```
git log --format='%s' --no-merges -- <path> | rg '^fix' | rg -o '\(([^)]+)\)' -r '$1' | sort | uniq -c | sort -rn
```

A scope with 3+ `fix(...)` commits against one area is a cluster worth a ledger
entry — pull its commits' full contextual lines (Step 1, scoped to that path) to
see whether each fix recorded a `learned()`/`decision()`, or whether it's a case
like `tsukasaI/dotfiles#16` (a regression with no `decision()`/`learned()` at
all — nothing to mine, which is itself a finding worth flagging).

*Done:* clusters with ≥3 fix() commits identified; their contextual lines pulled.

### Step 4: assemble the ledger

Group Steps 1–3's output by area, in the output format below. Cite every claim
with a commit SHA — no paraphrasing an intent/decision/learned line without its
hash attached.

*Done:* ledger rendered in output format with SHA citations for every claim.

## Output format template

```markdown
# Decision ledger: <repo>[/<area>]

## <area 1>

| kind | scope | text | sha | date |
|---|---|---|---|---|
| decision | hooks | kept $CB untouched for all existing entries... | 3962cf5 | 2026-xx-xx |
| learned | hooks | git tag -a / -s create rather than destroy... | 716125b | 2026-xx-xx |

### Reverts
- `065bc5d` `revert(claude-code): drop CLAUDE_CODE_DISABLE_MOUSE_CLICKS` —
  reverted `<original sha>`; reason: <learned/rejected line, verbatim>.

### Repeated-fix clusters
- `hooks`: 5 fix() commits (`<sha1>`, `<sha2>`, ...) — pattern: <what kept breaking,
  from the learned()/decision() lines, or "no records found" if the cluster has none>.

## <area 2>
...
```

Precedent for the shape of this output (external repos, cite as prior art, not
re-verified here): ops repo `memory/` ledger (14 files mined 2026-07-05 from 189
commits / 355 contextual lines); staygreen `docs/adr/` (23 ADRs rebuilt from
commit lines with SHA evidence and supersession chains).

Refs: tsukasaI/dotfiles#16

## Red flags

| Rationalization | Reality |
|---|---|
| "harvest.ts を流用すればスコープ指定も効くはず" | 効かない。harvest.ts は --mode=weekly\|candidates のみ、全リポ走査、パス指定不可。git log を直接叩く。 |
| "revert という語を含むコミット = true revert" | ではない。subject prefix か trailer で確認。grep hit の 75% は false positive（このリポの実績）。 |
| "contextual lines が無いエリアはスキップ" | スキップしない。lines が無いこと自体が finding（記録なし = 意図不明の変更群）。 |
| "コミットメッセージを要約して読みやすくする" | しない。intent/decision/learned 行は verbatim + SHA で引用。パラフレーズは証拠能力を消す。 |

## 再検証 / Re-verify

Facts here rot. Before relying on this skill again, re-check:

- Contextual Commits convention still documented: `rg -n 'intent\(scope\)' ~/.claude/CLAUDE.md`
- `harvest.ts`'s CLI interface / `CONTEXT_RE` still matches what's described above —
  re-read `claude-code/skills/_shared/harvest.ts` (usage comment, `CONTEXT_RE`).
- Revert-detection false-positive rate in the target repo — re-run Step 2's two
  commands fresh; "4 hits, 1 true revert" is this repo's history as of 2026-07-07,
  not a general ratio.
