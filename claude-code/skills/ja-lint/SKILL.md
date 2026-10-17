---
name: ja-lint
description: Lints Japanese prose for AI-slop patterns (metaphor verbs, filler openers, slop vocabulary, emoji, excess or unrendered bold, excess bullets, repeated sentence endings, trailing or heading colons, redundant brackets, translated terms, leftover prompt instructions) with a deterministic script, and reports findings without editing anything. Use after writing or changing Japanese documents such as 職務経歴書, 自己PR, README, blog posts or specs, and when the user asks to check, lint or de-slop (AI臭さを確認して) Japanese text. Never rewrites; the user decides every fix.
argument-hint: <file path>
allowed-tools: Bash(python3 *), Read
---

# /ja-lint: report AI-slop in Japanese text, never fix it

Run the linter on the target file and report. This skill is read-only on the
target: do not use Edit/Write on it, do not offer rewritten text unless the
user asks for a specific line, and do not re-run to chase a score. The user
decides every fix; hits are suggestions, and a hit that carries literal
meaning (e.g. 体温 in a medical context, 解像度 in imaging) is a false
positive, so say so instead of recommending a change.

Résumé-type documents (職務経歴書, 自己PR, 履歴書): a changed word can change
a factual claim or its strength. Never propose a replacement that adds,
removes or softens a number, role, scope or outcome.

## Run

```
python3 ~/.claude/skills/ja-lint/scripts/yomiyasu_lint.py <file>
```

Stdin works when there is no file. Use `--json` if you need to post-process.
Do not pass `--strict` or `--fail-on` (they only change the exit code).
When the document type is unambiguous, add `--doc-type <type>` (`pr`,
`article`, `incident`, `proposal`, `minutes`, `manual`, `slides`, `essay`,
`formal`, `promo`, `mail`, `paper`; see `--help`). It drops rules that are
normal for that type, and reports how many hits it dropped.

## Report

Group findings by rule, keep line numbers, quote the matching line, and mark
each as likely real or likely false positive in one short clause. End by
asking which ones the user wants to address. Lint only reads from
the file, so an empty result means "no pattern hit", not "no AI slop".

## Provenance

`scripts/yomiyasu_lint.py` and `scripts/markdown_visibility.py` (which the
linter imports) are vendored unmodified from
https://github.com/nanaism/yomiyasu (MIT, see `LICENSE`; Unicode-derived
emoji data, see `UNICODE-LICENSE.txt`) at release `v2.0.1`, commit
`1bc21f9c8e6a55fc4ccd5a2c7dfe78a7b0d814c5`. Standard library only, no
network or subprocess use. Blob pins (`git hash-object <file>`):

- `scripts/yomiyasu_lint.py`: `1ed31d3b200423872c3c539d30f250e694b49bde`
- `scripts/markdown_visibility.py`: `0e85b119b2a8231e23a0fa0c5e8a68a68b1fc40b`

`scripts/test_yomiyasu_lint.py` pins the fence/frontmatter behavior this
skill relies on (`python3 -I` it). Renewal: when bumping, read the upstream
diff, copy both files unmodified, run the test, and update the release,
commit and blob SHAs above.
