// ═══════════════════════════════════════════════════════════════
// combatState.js — Shared combat primitives: step names, the
// resilient "who represents this side" lookup for the legacy
// singular accessors, and other tiny dependency-free helpers used
// across every other combat/*.js module.
// ═══════════════════════════════════════════════════════════════

const COMBAT_STEPS = [
  'declaration', 'preCombat', 'beginCombat',
  'playCard', 'targeting', 'reveal', 'reveal-feint', 'bluff', 'resolution',
  'withdrawal', 'betweenRounds',
];

// Phase 3 (rule 6.3/6.4.2): a side's participants array can now shrink
// as individual creatures die and are removed from combat — combat
// itself only ends once a side is completely empty, not when any one
// participant (including the alpha) dies. That means the legacy
// singular accessors (attacker/attackerCard/etc, kept for every
// existing call site) can no longer assume a role:'alpha' entry is
// always present. This returns the alpha if it's still around,
// otherwise whichever participant is left — the rulebook's own
// Appendix 2 definition of Attacker is "the creature who made the
// attack, A PACKMATE, or a creature in pack combat with another
// attacker," so any survivor legitimately qualifies as "the attacker"
// once the original alpha is gone — or null if the side has been
// completely wiped out (only possible in the brief window between the
// last participant dying and endCombat() finishing).
function primaryParticipant(participants) {
  return participants.find(p => p.role === 'alpha') ?? participants[0] ?? null;
}

// ── Pausable steps (rule 6.1) ───────────────────────────────────
// Declaration, Pre-Combat, Begin-of-Combat, and Between-rounds were
// previously skipped through synchronously — nothing existed yet that
// needed a real decision there. Phase 4's pack-join Combat Events
// change that (Hunting Party/declaration, Pack Defense/preCombat,
// Bum Rush+Surprise Ally/beginCombat+betweenRounds), so these steps now
// genuinely pause. Rule 6.1's general timing — "first the attacker,
// then the defender... until all players pass" — is simplified to a
// single ordered pass each (attacker's turn, then defender's), since
// nothing in scope needs a second turn at the same step; the side
// whose turn it is may still act (play a pack-join card) any number of
// times before finally choosing to pass.
function stepMatches(triggerStep, currentStep) {
  if (triggerStep === 'beginOrBetween') return currentStep === 'beginCombat' || currentStep === 'betweenRounds';
  return triggerStep === currentStep;
}

// Rule 6.5.8's DEFAULT timing for pack-action abilities (precombat/
// beginCombat/betweenRounds) — everything except the explicitly-named
// declaration-only exceptions (Hunting Party etc.). Mindspeak's own
// text doesn't restrict timing any further than "may join... for the
// remainder of the turn," so a link created by it uses this general
// window rather than a step of its own.
function isGeneralPackActionStep(step) {
  return step === 'preCombat' || step === 'beginCombat' || step === 'betweenRounds';
}

function cardName(c) { return c === 'pass' ? '(pass)' : c.name; }

export {
  COMBAT_STEPS, primaryParticipant, stepMatches, isGeneralPackActionStep, cardName,
};
