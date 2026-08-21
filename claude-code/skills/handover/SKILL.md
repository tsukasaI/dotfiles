---
name: handover
description: Produces a copy-pasteable handover document summarizing this session's goal, progress, decisions, and next step, so a fresh Claude Code session (no memory of this conversation) can resume without re-discovery. Output goes to chat only, as one fenced markdown block — never written to a file. User-invoked via /handover; Claude may also proactively suggest running it when context looks degraded (long session, heavy compaction, many independent subtasks) — surface the suggestion in one line and wait for explicit go-ahead before invoking, never invoke silently.
argument-hint: [追加で残したいメモ (optional)]
allowed-tools: Bash, Read, Grep, Glob
---

# /handover — copy-pasteable session handover

Produce ONE fenced markdown block containing a handover document, then stop.
This skill never writes a file, never commits, never invokes other skills or
subagents. Match the user's conversation language for prose; keep the
document's own section headers in English so they stay greppable across
sessions.

Launch argument (optional extra notes to fold into the doc): $ARGUMENTS

## Why this shape

A handover that dumps the full conversation gets skimmed or ignored — the
next session needs distilled insight, not process. The two things most often
lost when someone reconstructs a session from scratch are the *reasoning*
behind decisions and the *dead ends already ruled out*; both get their own
section below instead of being folded into "progress". Grounding differs by
claim type: tree/branch/commit state must come from a git command run in
*this* invocation, never from memory. A "done" claim about earlier work (a
test that passed, a build that succeeded) cannot be re-grounded that way —
cite the earlier evidence by command + result summary and label it
"verified earlier this session, not re-verified"; don't re-run it just to
satisfy this rule, and don't claim it if you can't point to what you saw.

## Gather (ground everything before writing)

1. `git status` and `git diff --stat` / `git diff --cached --stat` (working
   tree state, staged and unstaged — never assume clean).
2. `git log --oneline -5` (recent commits, so the next session knows what
   already landed).
3. `git branch --show-current`.
4. Re-read this conversation for: the original goal/request, what was tried
   and abandoned (and why), decisions made where alternatives existed, and
   any open question that needs the user's judgment. If the item you need
   only survives inside an already-compacted/summarized part of the
   conversation, mark it "(unverified recall)" in the document rather than
   stating it as fact.

The secret rule applies to anything quoted into the document, not only diff
output: command output, conversation excerpts, file contents. Never paste
raw output that could carry a credential or token — reference it by command
name and a plain-text summary instead. Don't view a full diff or file body
for this at all; `--stat` is enough for tree state.

## Sections (all 8 headers always present, this order)

Every header appears even when a section is empty — write "None" as its
body rather than omitting the header. This keeps the shape predictable for
the next session skimming it.

1. **Goal** — the original task, close to verbatim.
2. **Current state** — what's actually true right now, grounded in step 1-3
   output above (branch, uncommitted changes, last commits) — not a summary
   of intentions.
3. **Done** — what was completed and verified in this session, each with how
   it was verified (test run, command output, manual check) — no unverified
   "should work" claims.
4. **Decisions & why** — choices made where more than one approach existed,
   and the reason picked. "None" if none arose.
5. **Tried and abandoned** — approaches attempted and ruled out, with the
   reason, so the next session doesn't repeat them. "None" if none.
6. **Open questions / blockers** — anything that needs the user's judgment
   before work can continue. "None" if none.
7. **Key files** — paths touched or relevant, one line each on why.
8. **Next step + remaining work** — the single next concrete action, plus the
   command that would verify it succeeded. If more than one subtask is still
   outstanding, list the rest as a short queue below it — don't compress
   multiple remaining subtasks into one line.

If `$ARGUMENTS` was given, fold it in as a short note near Goal or Open
questions, wherever it fits.

*Done:* all 8 headers present in order, each body backed by something read
or run in this invocation (or explicitly "None").

## Output

Emit exactly one fenced markdown code block, using four backticks
(` ```` `) as the outer fence so any inline code inside the document can't
prematurely close it. Any command mentioned inside the document (verification
commands, etc.) must be inline code (single backtick), never its own fenced
block.

The opening line inside the block is a resume instruction the next session
reads before anything else, kept to one line, e.g.:

    Resuming work in <repo/path>. Read this handover fully before taking any action, then continue from "Next step".

Nothing outside the block except a one-line remark ("paste this as your
first message in the new session"). No prose commentary inside the block
beyond the 8 sections plus the resume line.

*Done:* single fenced block emitted, ready to copy-paste as-is.

## Red flags

| Rationalization | Reality |
|---|---|
| "会話の記憶だけで Git 状態を書けばいい" | 書く前に `git status`/`diff --stat`/`log` を実際に実行する。記憶は前のツール実行以降ずれている可能性がある。 |
| "全部 done ってことにしておこう、たぶん動いてる" | 検証コマンドの出力を実際に見ていない完了は書かない。「Done」に入れるのは検証済みのものだけ。 |
| "会話の流れを全部拾えば親切" | 長いほど読まれない。蒸留した意思決定と次の一手だけを残す。 |
| "diff の中身をそのまま貼ればいい" | 秘密情報が混ざる可能性がある。コマンド出力・会話引用も含めて、パスと要約だけにする。 |
| "テストが通った記憶があるから Done に書こう" | このセッション内で実行したコマンド出力に紐づく主張だけ書く。再実行はしない — 「このセッション内で検証済み・再検証はしていない」と明記する。 |

## Hard limits

- Never write, edit, or commit any file — output is chat-only.
- Never invoke other skills or subagents from within this skill.
- Never paste raw command output, conversation excerpts, or file contents
  that could carry a secret — reference by command name and summary.
