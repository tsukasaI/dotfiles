Monthly harness review. Procedure and rationale: `docs/harness-evaluation.md`. Write only aggregate numbers and hypotheses here (public repo).

- [ ] Run the aggregation script locally and paste the table (each axis, top handoffs, hypotheses past their review date, watchdogs)
- [ ] Have a light model (haiku/sonnet) summarize denial trends; classify 5 sampled sessions by hand (interventions needed/unneeded, and whether the session started because a human noticed something merged was broken)
- [ ] Judge each `harness-hypothesis` issue past its review date: keep / extend once / revert
- [ ] Approve or reject each proposed allow rule (ship approved ones via the hooks-guardrails procedure)
- [ ] Watchdogs: guard-file commits without an issue ref, `harness-urgent` count, harness commits clustered when weekly quota was high
- [ ] Understanding check: pick one merged PR and explain it yourself (5 min)
- [ ] Propose career material candidates (owner decides whether they go to ops)
- [ ] One line: where the freed time went
- [ ] Record the results here and close this issue
