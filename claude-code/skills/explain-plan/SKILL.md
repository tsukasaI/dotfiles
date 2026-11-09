---
name: explain-plan
description: Turns the plan or design decision under discussion into a diagram-explain flipbook in plan mode (one frame per plan step, added/changed/removed colored), with every existing element tied to a verified file:line excerpt, and function-level "why it is safe" panels for security-relevant parts. User-invoked via /explain-plan (/skill:explain-plan in pi), before approving a plan or while settling a design in /triage. Not for reviewing a finished diff, and not for explaining a structure without a plan to approve (use diagram-explain).
disable-model-invocation: true
argument-hint: [対象の plan や方針 (省略時は会話中の直近の plan)]
allowed-tools: Read, Grep, Glob, Write, Bash
---

# /explain-plan: understand a plan before it is built

Draw the plan as a flipbook, have the user check it against the code and raise
questions and objections, then fold them into the plan before approval. Match the user's
conversation language in all dialogue and in every string inside
`diagram.json`.

Target plan: $ARGUMENTS

<!-- pi does not substitute $ARGUMENTS; it appends the arguments after the
skill body instead, so the literal fallback below keeps both harnesses working. -->
If the line above shows a literal `$ARGUMENTS`, the target is the text that
follows this skill's instructions instead; if there is none, use the most
recent plan in the conversation. With no plan in the conversation, say so and stop.

Design record: `~/dotfiles/docs/explain-plan-design.md`.

## Why this shape

Approving a plan from prose alone is where understanding gets lost: the user
accepts what was proposed and the intent never reaches their head. The
picture is drawn by a model and can be wrong, so every existing element
carries an excerpt that the renderer checks against the file, which keeps the
picture honest. The diagram is a disposable thinking
aid; only the decisions are recorded.

## 1. Write diagram.json

Read `~/.claude/skills/diagram-explain/SKILL.md` section 1 for the diagram
format and follow it, with these plan-mode rules on top. `example.json` next
to this file is a complete valid plan-mode example; `plan.ts` enforces the
rules below.

- Write to `$TMPDIR/explain-plan/<slug>/diagram.json`, with `"mode": "plan"`
  and a `slug` naming the plan.
- `steps`: one frame per plan step (at least one). Frame 0, the current
  state, is implicit.
- Cards, `recall` and `checks` follow diagram-explain. Aim `checks` at what
  the plan changes (which component now does what, and when), so the user can
  confirm they follow the plan before approving it. They are not a gate.
- Every `existing` node needs a `ref`. Edges take a `ref` when one line shows
  the hand-off.
- Deep dive: mark a node with `deepDive` when it falls in one of these
  categories, and explain at function level why it is safe (or what makes
  it unsafe): `input-validation` (external input), `auth` (authn/authz,
  trust decisions), `secrets`, `process-exec` (shell/process spawning),
  `guard-sandbox` (guards, sandboxes, permission gates), `crypto`,
  `destructive` (deletion, overwrites, force operations). Every boundary
  you considered and judged out of these categories goes in `boundaries`
  with the reason, so an omission is visible rather than silent.

## 2. Render

    explain-plan-render <diagram.json> --root <repo root>

Exit codes, ref lines and the rebuild note are as in diagram-explain's
section 2. The HTML goes
to `$TMPDIR/explain-plan/<slug>/index.html`; don't publish it as an Artifact.

## 3. Hand over and discuss

1. Draw the flipbook and give the user the HTML path.
2. Take the user's questions and objections in chat. Answer against the code
   and the panels.
3. Fold what they raise into the plan, and offer a re-render after a
   revision.
4. Go through the normal plan approval.

The user may skip this by saying so explicitly. Say in one line that
implementation proceeds without the walkthrough, and continue. Keep no record
of the skip.

## 4. Record the decisions

Once the plan is approved, write the decisions, reasons, and rejected
alternatives where the repo already keeps such records (an ADR directory, a
`docs/` convention, `/triage`'s Triage comment). In someone else's repo,
draft them as a "Design notes" section of the PR description instead. When
the repo has no convention, ask where to put them; never invent one. Do not
save the HTML.

## In pi

Same flow. pi has no plan mode: run the skill on the plan as written in the
conversation, before any edit.
