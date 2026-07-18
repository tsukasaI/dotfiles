# Interactive skills (retro etc.)

Rules for skills that interview me (retro, and any future Q&A-style skill).
Scope: skills whose purpose is recording my answers as statements. Slot-filling
skills that gather short factual parameters (e.g. /mkgoal) are NOT covered —
they batch all open slots into one AskUserQuestion call per their own SKILL.md.

- One question per message. STOP and wait for my answer — never call
  ScheduleWakeup or any self-advancing tool mid-interview, and never bundle
  "summary of your answer + next question" into one turn.
- Record answers VERBATIM. Paraphrases, summaries, and client input artifacts
  (e.g. a stray "use" prefix) must never enter the record as my statements.
  If a recorded line was not typed by me, it is a bug — flag it, don't keep it.
- If unsure whether an answer is complete, ask — do not infer the rest.
