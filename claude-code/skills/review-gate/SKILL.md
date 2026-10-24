---
name: review-gate
description: The code-reviewer gate between `gh pr create` and `gh pr merge` in branch+PR repos. Covers reviewer model choice, what counts as approval, how critical/high and medium/low findings are settled (auto-fix vs needs-decision), the decision-note format, and re-review. Use right after opening a PR for a non-trivial implementation (same bar as plan mode), and whenever settling a code-reviewer's findings or deciding whether a PR may merge. Not for dotfiles/ops (they never get a code-reviewer pass) or mechanical changes (config, dependency/SHA bumps, docs, formatting).
---

# Review gate

Moved out of the global CLAUDE.md so it loads only when a PR is actually
being reviewed. The global CLAUDE.md keeps only the trigger.

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
  - `auto-fix` when all hold: stays within the change's Scope (the issue's
    triage `Scope`, else the files the PR already touches); touches no
    public API/CLI flag, config schema, dependency, or security boundary;
    deletes no test lines; estimated fix ≤ 30 lines. Fix it in the same PR
    the same way as a critical/high fix, re-review (below), and list it
    under `## Auto-fixed` in the PR body, one line per finding (summary,
    `file:line`, its `git diff --numstat` line), so the user can revert it
    after the fact.
  - `needs-decision` otherwise, and for anything the implementer found on
    its own. File a GitHub issue labeled `needs-decision`
    (`gh label create needs-decision` if the label is missing) whose body
    starts with the decision note below, after checking
    `gh issue list --label needs-decision --search "<title>"` for a
    duplicate. Open issues never block the merge.
- Decision note (`/triage` parses this shape; keep the marker and field
  names verbatim):
  ```
  <!-- decision-note:v1 -->
  - Decide: <the question, one line>
  - Options: <A (Recommended): ...>; <B: ...>
  - Not auto-fixed because: <the auto-fix criterion it failed, or "found by implementer">
  - Source: <PR URL>, finding <n>
  ```
- Re-review after critical/high or `auto-fix` fixups (always, even when
  small): resume the original reviewer via `SendMessage` (agent id from its
  first `Agent` call) and ask only about the incremental diff. Its
  "resolved" verdict is less independent than a first pass, so a fixup well
  outside the original findings may warrant a fresh `code-reviewer`. A
  reviewer run inside a Workflow has no agent id, so it always gets a fresh
  one.
- Merge via `gh pr merge --squash --delete-branch` once approved and every
  medium/low finding is settled.
