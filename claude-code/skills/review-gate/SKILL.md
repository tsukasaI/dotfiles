---
name: review-gate
description: The code-reviewer gate between `gh pr create` and `gh pr merge` in branch+PR repos. Covers reviewer model choice, what counts as approval, how critical/high and medium/low findings are settled (auto-fix, note, or needs-decision), the decision-note and Not filed formats, re-review, and the docs-only and unverified-check merge rules. Use right after opening a PR for a non-trivial implementation (same bar as plan mode), and whenever settling a code-reviewer's findings or deciding whether a PR may merge. Not for dotfiles/ops (they never get a code-reviewer pass) or mechanical changes (config, dependency/SHA bumps, docs, formatting).
---

# Review gate

- When: run `code-reviewer` once, automatically, right after `gh pr create`.
- Model: `opus`; `fable` only for a security boundary or an architectural
  decision, since Fable's weekly quota is the scarce one.
- Approved = no critical/high finding. A classifier refusal or pause, or a
  pass from a fallback model other than the one requested, is not an
  approval.
- A critical/high finding: fix it in the same PR, sending it back to the
  implementer (global CLAUDE.md, Model behavior), and re-review (below);
  once the re-review reports no critical/high left, it counts as approved.
  If the fix fails or the re-review still flags critical/high, stop and
  wait for the user.
- Before merging, settle every remaining medium/low finding by the tier the
  reviewer gave it. The implementer never assigns a tier: letting it judge
  its own work as minor is the reward-hacking opening.
- Outcome table (provenance and kind as the reviewer reported them):

  | provenance | kind | tier |
  |---|---|---|
  | introduced / worsened | any, all auto-fix criteria hold | `auto-fix` |
  | introduced / worsened | behavior / security / data-loss, a criterion fails | `needs-decision` |
  | introduced / worsened | wording / status-quo / formatting / test-hardening / verify, a criterion fails | `note` |
  | existing | behavior / security / data-loss, medium | `needs-decision` |
  | existing | anything else, all low included | `note` |

  A finding the reviewer marked low-confidence, or one that re-asks a
  decided question ("previously decided #N"), is a `note` unless its kind
  is behavior, security, or data-loss. Those are still filed, with the
  earlier decision quoted, since a re-ask can be the real fix (cc-memory
  #222 re-asked part of #189 and shipped).
  - Auto-fix criteria, all must hold: stays within Scope (the issue's
    triage `Scope`, plus the files the PR touches, plus any doc or comment
    the PR made false); touches no public API/CLI flag, config schema,
    dependency, or security boundary; deletes no test lines; estimated fix
    ≤ 30 lines.
  - `auto-fix`: fix it in the same PR the same way as a critical/high fix,
    re-review (below), and list it under `## Auto-fixed` in the PR body,
    one line per finding (summary, `file:line`, its `git diff --numstat`
    line), so the user can revert it after the fact.
  - `note`: never an issue. List it under `## Not filed` in the PR body,
    with `<!-- not-filed:v1 -->` on the line after the heading, one line
    per note: severity, summary, `file:line`, `A: <recommended>; B:
    <alternative>`. `/triage` picks these up, so keep option B even when
    A is "leave as is".
  - `needs-decision`, and anything the implementer found on its own: file
    a GitHub issue labeled `needs-decision` (`gh label create
    needs-decision` if the label is missing) whose body starts with the
    decision note below, after checking `gh issue list --label
    needs-decision --search "<title>"` for a duplicate. Open issues never
    block the merge.
- Decision note (`/triage` parses this shape; keep the marker and field
  names verbatim; `Severity` was added later, so older notes lack it):
  ```
  <!-- decision-note:v1 -->
  - Decide: <the question, one line>
  - Options: <A (Recommended): ...>; <B: ...>
  - Severity: <critical|high|medium|low>
  - Not auto-fixed because: <the auto-fix criterion it failed, or "found by implementer">
  - Source: <PR URL>, finding <n>
  ```
- Re-review after critical/high or `auto-fix` fixups (always, even when
  small): resume the original reviewer via `SendMessage` (agent id from its
  first `Agent` call) and ask only whether the findings are resolved and
  whether the fixup added any critical/high. A new medium/low it raises
  goes under `## Not filed`, so fixups don't breed follow-ups. Its
  "resolved" verdict is less independent than a first pass, so a fixup well
  outside the original findings may warrant a fresh `code-reviewer`. A
  reviewer run inside a Workflow has no agent id, so it always gets a fresh
  one.
- Docs-only PR: no review when every changed path is `*.md` or under
  `docs/`, excluding instruction files (`CLAUDE.md`, `AGENTS.md`,
  `.claude/**`, `**/SKILL.md`, `rules/**`, `agents/**`). It may merge
  without review; say so in the PR body. A diff that changes only comments
  in code files still gets reviewed.
- A check the loop could not run locally (refused by a hook or the
  sandbox): merge only if `gh pr checks` shows that same check passed in
  CI. "No checks reported" or pending is not a pass; leave the PR open and
  list it for the user.
- Merge via `gh pr merge --squash --delete-branch` once approved and every
  medium/low finding is settled.

## In pi

The gate is the same, including the outcome table and `## Not filed`;
only the mechanics differ.

- Reviewer: `subagent` with agent `reviewer` (Opus, read-only; its prompt
  is `~/.claude/agents/code-reviewer.md`). Put the PR URL or diff range, and
  the issue's Scope if any, in the task. There is no Fable reviewer: for a
  security boundary or an architectural decision, also send the diff to
  `consult_advisor`.
- Fixes go to a `subagent` worker, not the main loop.
- Re-review: pi cannot resume a subagent, so every re-review is a fresh
  `reviewer`. Give it the original findings and the incremental diff
  (`git diff <reviewed-sha>..HEAD`) and ask only whether they are resolved.
- pi's AGENTS.md has no merge exception: confirm with the user before
  `gh pr merge` and before filing `needs-decision` issues.
