// ═══════════════════════════════════════════════════════════════
// combatView.js — which cards are "involved in combat" right now.
// Pure game-state code, no DOM, so run_tests.mjs can test exactly what
// main.js paints (Test 61). main.js turns the three sets into halo
// classes on the cards (style.css):
//
//   attacking  → red smoky halo      (is-attacking)
//   defending  → blue/white halo     (is-defending)
//   selectable → pulsing white-blue  (is-selectable): a card the human
//                is currently being asked to choose among
//
// "Attacking"/"defending" follow the combat's own sides, not who owns
// the cards: if the CPU ever attacks, the CPU's cards are the red ones.
// Members picked during a pack join (Hunting Party, Pack Defense, …)
// already show on their side while the selection is still open, so the
// player can see who has been chosen before pressing Done.
// ═══════════════════════════════════════════════════════════════
import { GameState } from './game.js';
import { getCombatRoundActions } from './combat.js';
import { getLegalActions } from './turnManager.js';

// Which field of each "choose a card" action holds the card being
// chosen. Anything not listed here is not a card-selection action.
const SELECTION_FIELD = {
  SELECT_ALPHA:         'card',          // choosing who leads the pack
  DECLARE_ATTACK:       'target',        // choosing who to attack
  JOIN_PACK_MEMBER:     'inst',          // choosing packmates to bring in
  JOIN_LINKED_PACKMATE: 'partner',       // choosing a linked packmate to join
  ASSIGN_TARGET:        'target',        // choosing who a played card hits
  PLAY_DEATH_BLOW:      'substituteInst' // choosing who takes the death blow
};

function getCombatHighlights() {
  const attacking = new Set(), defending = new Set(), selectable = new Set();
  const c = GameState.combat;

  if (c) {
    (c.attackerParticipants || []).forEach(p => attacking.add(p.inst));
    (c.defenderParticipants || []).forEach(p => defending.add(p.inst));
    const sel = c.packJoinSelection;
    if (sel && Array.isArray(sel.joined)) {
      const side = sel.side === 'attacker' ? attacking : defending;
      sel.joined.forEach(inst => side.add(inst));
    }
  }

  const pool = c ? getCombatRoundActions('player') : getLegalActions('player');
  for (const a of pool) {
    const field = SELECTION_FIELD[a.type];
    if (field && a[field]) selectable.add(a[field]);
  }
  return { attacking, defending, selectable };
}

// The creature the human is being asked to save with Taking the Death
// Blow right now, or null. The decision is about ONE creature, so the UI
// scrolls it into view (a row widened by damage cards can push it off
// the edge of a phone screen).
function getPendingDeathBlowInst() {
  const c = GameState.combat;
  const entry = c && c.step === 'deathBlow' && c.deathBlowQueue ? c.deathBlowQueue[0] : null;
  return entry && entry.who === 'player' ? entry.participant.inst : null;
}

export { getCombatHighlights, getPendingDeathBlowInst };
