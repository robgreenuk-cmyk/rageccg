// ═══════════════════════════════════════════════════════════════
// combatCards.js — The Play-card step, Feint, and Bluff-step legality
// checks (rule 6.9.1).
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog, getPlayer, discardCombat, effectiveRage, num,
} from '../game.js';
import { cardHasTriggerType } from '../cardEngine.js';
import { beginTargetingStep } from './combatTargeting.js';

function recordFeintDecision(who, card) {
  const c = GameState.combat;
  const isAttacker = who === c.attackerWho;
  if (isAttacker) { c.attackerFeintCard = card; c.attackerFeintDecided = true; }
  else            { c.defenderFeintCard = card; c.defenderFeintDecided = true; }
  EventLog.record('FEINT_FOLLOWUP', { who, card: card ? card.name : '(declined)' });
}

// Called after every reveal-step or feint-step action, in place of
// jumping straight to resolveBluffAndDamage(). Checks attacker first,
// then defender — if either still has an undecided, legal Feint in
// play, pause on 'reveal-feint' for them and return true. Once both
// have decided (or neither was eligible), returns false and lets the
// caller proceed to resolution.
function checkFeintOpportunity() {
  const c = GameState.combat;
  if (!c.attackerFeintDecided && canFeint(c.attackerWho)) {
    c.feintDeciderWho = c.attackerWho;
    c.step = 'reveal-feint';
    EventLog.record('COMBAT_STEP', { step: c.step, who: c.feintDeciderWho });
    return true;
  }
  if (!c.defenderFeintDecided && canFeint(c.defenderWho)) {
    c.feintDeciderWho = c.defenderWho;
    c.step = 'reveal-feint';
    EventLog.record('COMBAT_STEP', { step: c.step, who: c.feintDeciderWho });
    return true;
  }
  return false;
}

function canFeint(who) {
  const c = GameState.combat;
  const isAttacker = who === c.attackerWho;
  const card  = isAttacker ? c.attackerCard : c.defenderCard;
  const actor = isAttacker ? c.attacker     : c.defender;
  if (!cardHasTriggerType(card, 'feintOnReveal')) return false;
  // Errata: "Feint may not be bluffed" — the follow-up opportunity
  // requires Feint to have been legally played (enough Rage), not just
  // revealed face down. Checked directly here, ahead of the general
  // Bluff step in resolveBluffAndDamage(), rather than waiting for it.
  return isLegalCombatCard(actor, card);
}

function playCombatCard(who, cardInstance) {
  const c = GameState.combat;
  const side = who === c.attackerWho ? c.attackerParticipants : c.defenderParticipants;
  const p = side.find(pp => pp.card === null);
  if (!p) return; // nothing left to act on this side this round

  p.card = cardInstance || 'pass';

  EventLog.record('COMBAT_CARD_PLAYED', {
    who, participant: p.inst.name, card: cardInstance ? cardInstance.name : '(none)'
  });

  // Move to targeting (rule 6.7) once EVERY participant on both sides
  // has acted (played or passed) — generalizes the old "both legacy
  // fields set" check, which reduces to exactly that in the
  // single-participant case (Phases 1-3 and every combat that doesn't
  // involve a Phase 4 join card).
  const allActed = [...c.attackerParticipants, ...c.defenderParticipants].every(pp => pp.card !== null);
  if (allActed) beginTargetingStep();
}

function isLegalCombatCard(actor, card) {
  if (card === 'pass' || !card) return true;
  const rageReq = num(card.def.Rage);
  if (rageReq > 0 && effectiveRage(actor) < rageReq) return false;
  if (!meetsNonRageRequirement(actor, card)) return false;
  return true;
}

// Rule 6.9.1: "Anything that is NOT Rage and is REQUIRED to play a
// combat action is a non-Rage requirement... If you failed to meet
// [one], that will also make a card illegal" — same bucket as
// insufficient Rage, handled the same way (isLegalCombatCard() above
// returns false either way, so an unmet requirement is bluffed out
// exactly like an under-Rage card already was).
//
// The card database's raw `Requires` field carries a MUCH wider
// vocabulary across the full card pool than combat cards alone need
// (tribe/auspice/breed requirements for Gifts, etc. — see rule 6.9.1's
// sidebar for the general list: Crinos form, Lupus form, Not in Homid
// form, In the Umbra, Not frenzied, Kailindo, Firearm, Iksakku, Klaive,
// Weapon, No Weapon). Only 'Crinos form' is enforced here so far —
// Spine Crushed is the first card that needed ANY non-Rage condition
// checked at all. Cards whose Requires value isn't recognized below
// (Kailindo, Weapon, Umbra, Not Frenzied, etc.) are NOT yet enforced —
// they remain playable by anyone who meets Rage, same as before this
// function existed. Extend the recognized cases here as more of that
// vocabulary needs enforcing; don't assume the rest is already covered.
function meetsNonRageRequirement(actor, card) {
  const req = (card.def.Requires || '').trim();
  if (!req) return true;
  if (/^Crinos form\.?$/i.test(req)) return !!actor.isCrinos;
  return true;
}

function discardPlayedCard(who, card) {
  if (!card || card === 'pass') return;
  if (card.zone === 'victoryPile') return; // Telling Blow's bonus already redirected it here — don't also discard it
  discardCombat(getPlayer(who), card);
}

export {
  recordFeintDecision, checkFeintOpportunity, canFeint, playCombatCard, isLegalCombatCard, meetsNonRageRequirement, discardPlayedCard,
};
