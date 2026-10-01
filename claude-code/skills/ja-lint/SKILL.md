---
name: ja-lint
description: Lints Japanese prose for AI-slop patterns (metaphor verbs, filler openers, slop vocabulary, emoji, excess bold/bullets, repeated sentence endings) with a deterministic script, and reports findings without editing anything. Use after writing or changing Japanese documents such as 職務経歴書, 自己PR, README, blog posts or specs, and when the user asks to check, lint or de-slop (AI臭さを確認して) Japanese text. Never rewrites; the user decides every fix.
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

`scripts/yomiyasu_lint.py` is vendored unmodified from
https://github.com/nanaism/yomiyasu (MIT, see `LICENSE`), pinned at commit
`b14ee43c9b722cf4fd2bb1e893c6c386f1a362aa` (git blob
`cc3d832d6ca7aba320e05cc1831bbdd7a19201b4`). Standard library only, no
network or subprocess use. Renewal: when bumping, read the upstream diff,
then update this SHA and blob id.
