// ═══════════════════════════════════════════════════════════════
// combat.js — Alpha vs alpha combat state machine.
// No DOM. Implements the round structure from the rulebook:
//   Declaration → Pre-Combat → Begin-of-Combat
//   then rounds of:
//   Play Card → Targeting → Reveal → Bluff → Resolution → Withdrawal → Between-rounds
// V1 scope: single attacker vs single defender, no pack actions yet.
// ═══════════════════════════════════════════════════════════════

import {
  GameState, EventLog, getPlayer, opponent,
  drawCombat, discardCombat,
  effectiveRage, effectiveHealth, totalDamage, isDead,
  checkFlipFromDamage, moveToVictoryPile, removeFrom, num,
} from './game.js';

const COMBAT_STEPS = [
  'declaration', 'preCombat', 'beginCombat',
  'playCard', 'targeting', 'reveal', 'bluff', 'resolution',
  'withdrawal', 'betweenRounds',
];

// ── Start combat ──────────────────────────────────────────────
function declareAttack(attackerWho, attacker, target) {
  const defenderWho = target.owner ?? opponent(attackerWho);

  GameState.combat = {
    round:        1,
    step:         'declaration',
    attackerWho,
    defenderWho,
    attacker,                 // card instance
    defender:     target,     // card instance (alpha or prey)
    // Cards played face-down this round, revealed in Reveal step
    attackerCard: null,
    defenderCard: null,
    // Result of most recent round
    lastResult:   null,
    ended:        false,
  };

  EventLog.record('COMBAT_DECLARED', {
    attacker: attacker.name, defender: target.name
  });

  advanceToBeginCombat();
  return GameState.combat;
}

function advanceToBeginCombat() {
  const c = GameState.combat;
  c.step = 'preCombat';
  EventLog.record('COMBAT_STEP', { step: c.step });
  // V1: no pack actions / redirections — skip straight through
  c.step = 'beginCombat';
  EventLog.record('COMBAT_STEP', { step: c.step });
  c.step = 'playCard';
  EventLog.record('COMBAT_STEP', { step: c.step, round: c.round });
}

// ── Legal combat-round actions for whoever's turn it is to act ─
function getCombatRoundActions(who) {
  const c = GameState.combat;
  if (!c) return [];

  const ps = getPlayer(who);
  const actions = [];

  if (c.step === 'playCard') {
    const isAttacker = who === c.attackerWho;
    const alreadyPlayed = isAttacker ? c.attackerCard : c.defenderCard;
    if (alreadyPlayed) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];

    ps.combatHand.forEach(card => {
      const t = (card.def.Type || '').toLowerCase();
      if (t.startsWith('combat action') || t.startsWith('combat event')) {
        actions.push({ type: 'PLAY_COMBAT_CARD', card, label: `Play ${card.name}` });
      }
    });
    actions.push({ type: 'PASS_COMBAT_CARD', label: 'Play nothing this round' });
  }

  if (c.step === 'reveal' && who === 'player') {
    // Only the human needs a button here — the CPU has nothing to
    // decide at this step, it's purely a paced viewing moment before
    // resolution runs.
    actions.push({ type: 'CONTINUE_REVEAL', label: 'Continue' });
  }

  if (c.step === 'withdrawal' && who === c.attackerWho) {
    actions.push({ type: 'WITHDRAW', label: 'Withdraw from combat' });
    actions.push({ type: 'CONTINUE_COMBAT', label: 'Continue to next round' });
  }

  return actions;
}

// ── Perform a combat action ───────────────────────────────────
function performCombatAction(who, action) {
  const c = GameState.combat;
  if (!c) return;

  switch (action.type) {
    case 'PLAY_COMBAT_CARD':
      playCombatCard(who, action.card);
      break;
    case 'PASS_COMBAT_CARD':
      playCombatCard(who, null);
      break;
    case 'CONTINUE_REVEAL':
      resolveBluffAndDamage();
      break;
    case 'WITHDRAW':
      endCombat('withdrawn');
      break;
    case 'CONTINUE_COMBAT':
      startNextRound();
      break;
  }
}

function playCombatCard(who, cardInstance) {
  const c = GameState.combat;
  if (who === c.attackerWho) c.attackerCard = cardInstance || 'pass';
  else                       c.defenderCard = cardInstance || 'pass';

  EventLog.record('COMBAT_CARD_PLAYED', {
    who, card: cardInstance ? cardInstance.name : '(none)'
  });

  // Both sides played — move to targeting, then reveal both cards
  // simultaneously and PAUSE here. This is the real Reveal Step
  // (rulebook 6.2 step 3): both face-down cards flip together and
  // are shown before anything is computed. Resolution only happens
  // once the player explicitly continues past the reveal — see the
  // CONTINUE_REVEAL case in performCombatAction().
  if (c.attackerCard && c.defenderCard) {
    c.step = 'targeting';
    EventLog.record('COMBAT_STEP', { step: c.step });
    c.step = 'reveal';
    EventLog.record('COMBAT_STEP', { step: c.step,
      attackerCard: cardName(c.attackerCard),
      defenderCard: cardName(c.defenderCard) });
  }
}

function cardName(c) { return c === 'pass' ? '(pass)' : c.name; }

// ── Bluff check + resolution ──────────────────────────────────
function resolveBluffAndDamage() {
  const c = GameState.combat;
  c.step = 'bluff';

  const aLegal = isLegalCombatCard(c.attacker, c.attackerCard);
  const dLegal = isLegalCombatCard(c.defender, c.defenderCard);

  if (!aLegal) {
    EventLog.record('ILLEGAL_CARD_DISCARDED', { who: c.attackerWho, card: cardName(c.attackerCard) });
    c.attackerCard = 'pass';
  }
  if (!dLegal) {
    EventLog.record('ILLEGAL_CARD_DISCARDED', { who: c.defenderWho, card: cardName(c.defenderCard) });
    c.defenderCard = 'pass';
  }

  EventLog.record('COMBAT_STEP', { step: 'resolution' });
  c.step = 'resolution';

  applyDamage(c.attacker, c.attackerCard, c.defender);
  applyDamage(c.defender, c.defenderCard, c.attacker);

  // Discard played cards
  discardPlayedCard(c.attackerWho, c.attackerCard);
  discardPlayedCard(c.defenderWho, c.defenderCard);

  // Check deaths
  checkCombatDeaths();

  if (c.ended) return;

  c.step = 'withdrawal';
  EventLog.record('COMBAT_STEP', { step: c.step });
}

function isLegalCombatCard(actor, card) {
  if (card === 'pass' || !card) return true;
  const rageReq = num(card.def.Rage);
  if (rageReq > 0 && effectiveRage(actor) < rageReq) return false;
  return true;
}

function applyDamage(source, card, target) {
  if (!card || card === 'pass') return;
  const dmgValue = num(card.def.Damage);
  if (dmgValue <= 0) return;   // non-damaging card (block/dodge/utility)

  target.damageCards.push(card);
  EventLog.record('DAMAGE_DEALT', {
    source: source.name, target: target.name, amount: dmgValue
  });

  checkFlipFromDamage(target);
}

function discardPlayedCard(who, card) {
  if (!card || card === 'pass') return;
  discardCombat(getPlayer(who), card);
}

// ── Death check ────────────────────────────────────────────────
function checkCombatDeaths() {
  const c = GameState.combat;

  const attackerDead = isDead(c.attacker);
  const defenderDead = isDead(c.defender);

  if (defenderDead) {
    const killer = getPlayer(c.attackerWho);
    moveToVictoryPile(killer, c.defender);
    EventLog.record('COMBAT_KILL', { killer: c.attackerWho, victim: c.defender.name });
  }
  if (attackerDead) {
    const killer = getPlayer(c.defenderWho);
    moveToVictoryPile(killer, c.attacker);
    EventLog.record('COMBAT_KILL', { killer: c.defenderWho, victim: c.attacker.name });
  }

  if (attackerDead || defenderDead) {
    endCombat('death');
  }
}

// ── Round progression ──────────────────────────────────────────
function startNextRound() {
  const c = GameState.combat;
  c.round++;
  c.attackerCard = null;
  c.defenderCard = null;
  c.step = 'playCard';
  EventLog.record('COMBAT_STEP', { step: c.step, round: c.round });
}

function endCombat(reason) {
  const c = GameState.combat;
  c.ended = true;
  EventLog.record('COMBAT_END', { reason, round: c.round });
  GameState.combat = null;
}

// ── Public API ────────────────────────────────────────────────
export {
  COMBAT_STEPS,
  declareAttack,
  getCombatRoundActions, performCombatAction,
  endCombat,
};
