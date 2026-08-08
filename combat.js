// ═══════════════════════════════════════════════════════════════
// combat.js — Public API barrel for the combat/ subsystem split.
//
// This file exists so nothing outside combat/ (main.js, turnManager.js,
// run_tests.mjs) needs to know or care that combat logic now lives
// across several files instead of one — the import path and export
// surface are UNCHANGED from before the split. All actual logic lives
// in combat/*.js:
//   combatState.js      — step names, primaryParticipant, cardName
//   combatPackJoin.js    — Hunting Party/Pack Defense/Surprise Ally/
//                          Bum Rush/Shieldmate-join/Mindspeak-link
//   combatLifecycle.js   — declareAttack, round progression, the
//                          pausable declaration/preCombat/beginCombat/
//                          betweenRounds step machine, combat end
//   combatTargeting.js   — target assignment (rule 6.7), Shieldmate's
//                          redirect inversion
//   combatCards.js       — Play-card step, Feint, bluff-step legality
//   combatResolution.js  — speed tiers, rule 6.6.1 blow-order choice,
//                          damage, killing blows, Taking the Death
//                          Blow, death/combat outcome
//   combatActions.js     — getCombatRoundActions()/performCombatAction(),
//                          the only two functions anything outside
//                          combat/ ever actually calls
// ═══════════════════════════════════════════════════════════════

export { COMBAT_STEPS } from './combat/combatState.js';
export { declareAttack, endCombat } from './combat/combatLifecycle.js';
export { getCombatRoundActions, performCombatAction } from './combat/combatActions.js';
