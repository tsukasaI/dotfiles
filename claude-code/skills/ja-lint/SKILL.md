---
name: ja-lint
description: Lints Japanese prose for AI-slop patterns (metaphor verbs, filler openers, slop vocabulary, emoji, excess or unrendered bold, excess bullets, repeated sentence endings, trailing colons, redundant brackets) with a deterministic script, and reports findings without editing anything. Use after writing or changing Japanese documents such as 職務経歴書, 自己PR, README, blog posts or specs, and when the user asks to check, lint or de-slop (AI臭さを確認して) Japanese text. Never rewrites; the user decides every fix.
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
Do not pass `--strict` (it only changes the exit code).

## Report

Group findings by rule, keep line numbers, quote the matching line, and mark
each as likely real or likely false positive in one short clause. End by
asking which ones the user wants to address. Lint only reads from
the file, so an empty result means "no pattern hit", not "no AI slop".

## Provenance

`scripts/yomiyasu_lint.py` and `scripts/markdown_visibility.py` (which the
linter imports) are vendored unmodified from
https://github.com/nanaism/yomiyasu (MIT, see `LICENSE`; Unicode-derived
emoji data, see `UNICODE-LICENSE.txt`) at release `v1.1.0`, commit
`0df47749139dfd64ad3d55e7d53d3839e5874848`. Standard library only, no
network or subprocess use. Blob pins (`git hash-object <file>`):

- `scripts/yomiyasu_lint.py`: `bdd0783b87581a05cc7a4c70f608112438cf320c`
- `scripts/markdown_visibility.py`: `3f355ac66dceb756214e7a0e86bcbbde811a88ac`

`scripts/test_yomiyasu_lint.py` pins the fence/frontmatter behavior this
skill relies on (`python3 -I` it). Renewal: when bumping, read the upstream
diff, copy both files unmodified, run the test, and update the release,
commit and blob SHAs above.
