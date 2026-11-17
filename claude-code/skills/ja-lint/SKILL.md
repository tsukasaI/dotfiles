---
name: ja-lint
description: Lints Japanese prose for AI-slop patterns with a deterministic script and reports findings without editing anything. Use after writing or changing Japanese documents (職務経歴書, 自己PR, README, blog posts, specs), and when the user asks to check, lint or de-slop (AI臭さを確認して) Japanese text. Never rewrites; the user decides every fix.
argument-hint: <file path>
allowed-tools: Bash(ja-lint *), Bash(python3 -I *), Read
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
ja-lint <file>
```

`ja-lint` is built by `nix-darwin/ja-lint.nix` and is the only form shguard
allows on the Mac. It feeds the file to the script on stdin, so any path
works. Where it isn't on PATH (cloud sessions, pi), run
`python3 -I ~/.claude/skills/ja-lint/scripts/yomiyasu_lint.py - < <file>`:
the script refuses a file operand outside the cwd or under a dot directory
(exit 2).

Use `--json` if you need to post-process.
Do not pass `--strict` or `--fail-on` (they only change the exit code).
When the document type is unambiguous, add `--doc-type <type>` (`pr`,
`article`, `incident`, `proposal`, `minutes`, `manual`, `slides`, `essay`,
`formal`, `promo`, `mail`, `paper`, `script`; see `--help`). It drops rules that are
normal for that type, and reports how many hits it dropped.

## Report

Group findings by rule, keep line numbers, quote the matching line, and mark
each as likely real or likely false positive in one short clause. End by
asking which ones the user wants to address. Lint only reads from
the file, so an empty result means "no pattern hit", not "no AI slop".

## Provenance

The scripts are vendored from upstream yomiyasu; the pins and the renewal
procedure are in `PROVENANCE.md` next to this file.
