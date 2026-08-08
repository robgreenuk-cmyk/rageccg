// ═══════════════════════════════════════════════════════════════
// combatTargeting.js — Target assignment (rule 6.7), including
// Shieldmate's inversion of the normal "attacker chooses" default.
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog,
} from '../game.js';
import { cardName } from './combatState.js';

// ── Targeting step (rule 6.7) ──────────────────────────────────
// "Each combat card played in the previous step is assigned a target.
// Where one side has pack combat, the opponent of the pack combat
// declares which creature his Combat Action(s) target." Read precisely:
// each side chooses the target for its OWN played card(s), from among
// the OPPOSING side's participants. That choice is trivial — nothing
// to actually decide, auto-assigned here — whenever the opposing side
// has exactly one participant. It only becomes a genuine decision once
// the opposing side has 2+ participants.
//
// "When both sides of combat are using pack actions, targets are
// assigned in order: the attacking pack chooses targets for one of its
// creatures, then the defending pack chooses one of its creature's
// targets, and this repeats" — this alternation only ever matters once
// BOTH sides have real (non-trivial) decisions pending; attacker always
// goes first when both are waiting.
//
// Feint follow-ups are NOT targeted here — per errata they automatically
// target whatever their originating card targeted (see canFeint()'s
// comment), which the plays[] builder already gets for free since both
// a participant's card and feintCard share the same targetInst field.
//
// Queue entries are {participant, enemies} rather than a bare
// participant, so a decision can be routed to someone OTHER than the
// card's own owner — needed for Shieldmate, whose errata inverts the
// normal rule: for cards aimed at a {defender, shieldmate} pair, the
// DEFENDER'S controller chooses which of the two absorbs it, not the
// attacker. See findShieldmateGroup().
function beginTargetingStep() {
  const c = GameState.combat;
  c.step = 'targeting';
  EventLog.record('COMBAT_STEP', { step: c.step });

  const attackerQueue = []; // decisions the ATTACKER'S controller makes
  const defenderQueue = []; // decisions the DEFENDER'S controller makes

  for (const p of c.attackerParticipants) {
    if (!p.card || p.card === 'pass') continue;
    const enemies = c.defenderParticipants;
    if (enemies.length === 1) {
      p.targetInst = enemies[0].inst;
    } else if (findShieldmateGroup(enemies)) {
      defenderQueue.push({ participant: p, enemies });
    } else {
      attackerQueue.push({ participant: p, enemies });
    }
  }
  for (const p of c.defenderParticipants) {
    if (!p.card || p.card === 'pass') continue;
    const enemies = c.attackerParticipants;
    if (enemies.length === 1) p.targetInst = enemies[0].inst;
    else defenderQueue.push({ participant: p, enemies });
  }

  c.targetingQueue = { attackerQueue, defenderQueue, turn: c.attackerWho };
  advanceTargetingQueue();
}

// Shieldmate errata: "Whenever the attacker assigns a Combat Action or
// face-down combat card to the defender or shieldmate, you can choose
// either as the target." Only matches an EXACT pair (both members of a
// registered shieldmate group, no more, no fewer) — if some other card
// ever adds a third defender alongside a shieldmate pairing, that's
// outside what Shieldmate's own text covers, so the normal rule 6.7
// default (attacker decides) is the safer fallback rather than
// extrapolating the redirect to a group it was never written for.
function findShieldmateGroup(enemies) {
  const c = GameState.combat;
  if (!c.shieldmateGroups?.length) return null;
  const ids = new Set(enemies.map(e => e.inst.instanceId));
  return c.shieldmateGroups.find(g =>
    g.memberInstanceIds.length === ids.size && g.memberInstanceIds.every(id => ids.has(id)));
}

// Moves the targeting queue forward: if nobody has a real decision left
// (either because there never was one, or because both queues have just
// been drained), the queue closes and combat proceeds to Reveal. If the
// side whose turn it is has nothing pending (it had fewer decisions than
// the other side), turn passes to whichever side still does — the
// alternation is "attacker, defender, attacker, defender...", but a side
// that runs out early simply stops taking turns rather than blocking the
// other side's remaining decisions.
function advanceTargetingQueue() {
  const c = GameState.combat;
  const q = c.targetingQueue;
  if (!q) return;
  if (q.attackerQueue.length === 0 && q.defenderQueue.length === 0) {
    c.targetingQueue = null;
    advanceToReveal();
    return;
  }
  const isAttackerTurn = q.turn === c.attackerWho;
  const myQueue = isAttackerTurn ? q.attackerQueue : q.defenderQueue;
  if (myQueue.length === 0) {
    q.turn = isAttackerTurn ? c.defenderWho : c.attackerWho;
  }
  // Otherwise: pause here. getCombatRoundActions()/performCombatAction()
  // pick up q.turn's front-of-queue participant via ASSIGN_TARGET.
}

function advanceToReveal() {
  const c = GameState.combat;
  c.step = 'reveal';
  EventLog.record('COMBAT_STEP', { step: c.step,
    attackerCard: cardName(c.attackerCard),
    defenderCard: cardName(c.defenderCard) });
}

export {
  beginTargetingStep, findShieldmateGroup, advanceTargetingQueue, advanceToReveal,
};
