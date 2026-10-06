import type { Register } from 'claude-code'

import { registerBand, registerDenyNote } from './blocked-band'
import { registerReviewState } from './review-state'
import { registerRuleGuards } from './rule-guards'
import { registerSessionEdits } from './session-edits'
import { registerShellCanon } from './shell-canon'

// Registration order is hook nesting order: an earlier registration is the
// outer hook, so it sees what the later ones (and shguard beneath all of
// them) finally answered. The deny note goes first to see shguard's deny;
// shell canonicalization goes last so shguard sees the rewritten command.
export const register: Register = on => {
  registerDenyNote(on)
  registerBand(on)
  registerReviewState(on)
  registerRuleGuards(on)
  registerSessionEdits(on)
  registerShellCanon(on)
}
