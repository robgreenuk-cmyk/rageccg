// ═══════════════════════════════════════════════════════════════
// combatPackJoin.js — Hunting Party / Pack Defense / Surprise Ally /
// Bum Rush / Shieldmate's join half / Mindspeak's link half. Driven
// generically off each card's packJoin trigger data in cardEffects.json
// rather than hardcoded per-card logic (see finishPackJoin()).
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog, getPlayer, opponent, drawCombat, removeFrom, num,
} from '../game.js';
import { getTrigger } from '../cardEngine.js';
import { stepMatches, isGeneralPackActionStep } from './combatState.js';

// Mindspeak-style links (ps.packLinks — see turnManager.js's
// doPlayGiftPackLink): a link is eligible to actually join THIS
// combat once one of its two creatures is already a participant on a
// side and the other isn't yet. Returns {link, partner} pairs — the
// partner is whichever of the two ISN'T already in combat.
function eligiblePackLinks(who, side) {
  const c = GameState.combat;
  const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
  const inCombatIds = new Set(participants.map(p => p.inst.instanceId));
  const links = getPlayer(who).packLinks || [];
  const eligible = [];
  for (const link of links) {
    const aIn = inCombatIds.has(link.a.instanceId);
    const bIn = inCombatIds.has(link.b.instanceId);
    if (aIn && !bIn) eligible.push({ link, partner: link.b });
    else if (bIn && !aIn) eligible.push({ link, partner: link.a });
    // neither in combat yet, or both already are — nothing to offer
  }
  return eligible;
}

function sideHasEligiblePackJoin(who) {
  const c = GameState.combat;
  const side = who === c.attackerWho ? 'attacker' : 'defender';
  const hasCard = getPlayer(who).combatHand.some(card => {
    const trig = getTrigger(card, 'packJoin');
    if (!trig) return false;
    if (!stepMatches(trig.step, c.step)) return false;
    if (trig.side !== 'either' && trig.side !== side) return false;
    // Combat Restricted (rule 4.8.2: "all Combat Events are Combat
    // Restricted") — read here as one play of this NAMED card per
    // combat, not a hard cap of one combat event total; if that's
    // wrong, this is the one place to tighten it.
    if (c.packActions.some(pa => pa.card.name === card.name)) return false;
    return true;
  });
  if (hasCard) return true;
  if (isGeneralPackActionStep(c.step) && eligiblePackLinks(who, side).length > 0) return true;
  return false;
}

// ── Pack-join engine (rule 6.5.8/6.6.2, Phase 4) ────────────────
// Drives Hunting Party / Pack Defense / Surprise Ally / Bum Rush
// generically off each card's packJoin trigger data (see
// cardEffects.json) rather than hardcoding per-card logic here.
function currentSideRenown(side) {
  const c = GameState.combat;
  const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
  return participants.reduce((sum, p) => sum + num(p.inst.def.Renown), 0);
}

function eligiblePackMembers(who, side) {
  const c = GameState.combat;
  const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
  const alreadyIn = new Set(participants.map(p => p.inst.instanceId));
  return getPlayer(who).pack.filter(inst => !alreadyIn.has(inst.instanceId));
}

// Actually commits N creatures into a side's participants array —
// shared by every packJoin mode once the "who's joining" list is
// final (immediately, for wholePack; after a selection flow, for
// renownCap/fixedCount).
function finishPackJoin(who, card, side, trig, joinedInsts) {
  const c = GameState.combat;
  const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
  const ps = getPlayer(who);

  for (const inst of joinedInsts) {
    participants.push({
      inst, ownerWho: who, role: 'packmember',
      card: null, feintCard: null, feintDecided: false, targetInst: null,
    });
  }

  let bonusCards = 0;
  if (trig.mode === 'renownCap') bonusCards = joinedInsts.length * (trig.bonusCardsPerMember || 0);
  else if (trig.mode === 'fixedCount') bonusCards = trig.bonusCards || 0;
  if (bonusCards > 0) drawCombat(ps, bonusCards);

  c.packActions.push({
    card, side, who, duration: trig.duration,
    joinedInstanceIds: joinedInsts.map(i => i.instanceId),
    bonusCards,
  });

  EventLog.record('PACK_ACTION', {
    who, card: card.name, side,
    joined: joinedInsts.map(i => i.name), bonusCards,
  });

  // Shieldmate: registers the WHOLE side (original defender + the
  // shieldmate who just joined) as a group whose targeting decisions
  // route to the defender instead of the attacker — see
  // findShieldmateGroup()/beginTargetingStep(). Keyed off the side's
  // full membership at the moment Shieldmate resolves, which in the
  // ordinary case (Shieldmate played for a lone defender) is exactly
  // the {defender, shieldmate} pair the card's own text describes.
  if (trig.createsShieldmateGroup) {
    c.shieldmateGroups = c.shieldmateGroups || [];
    c.shieldmateGroups.push({
      memberInstanceIds: participants.map(p => p.inst.instanceId),
      controllerWho: who,
    });
  }
}

// PLAY_PACK_ACTION: pulls the card from hand and marks it "in play"
// (not yet discarded — see resolveExpiredPackActions) rather than
// routing it through the normal Combat Action discard pipeline, so it
// stays visibly attributable to its ongoing effect for as long as that
// effect lasts, letting a UI keep showing it (and which members it
// brought in) rather than it vanishing into the discard pile the
// instant it's played.
function playPackActionCard(who, card) {
  const c = GameState.combat;
  const trig = getTrigger(card, 'packJoin');
  const side = who === c.attackerWho ? 'attacker' : 'defender';
  const ps = getPlayer(who);

  removeFrom(ps.combatHand, card);
  card.zone = 'packActionInPlay';

  if (trig.mode === 'wholePack') {
    // Bum Rush: no selection needed, the whole remaining pack joins at once.
    finishPackJoin(who, card, side, trig, eligiblePackMembers(who, side));
    return;
  }

  c.packJoinSelection = {
    who, card, side, mode: trig.mode,
    renownCap: trig.mode === 'renownCap' ? (trig.renownCap - currentSideRenown(side)) : null,
    remainingCount: trig.mode === 'fixedCount' ? trig.count : null,
    joined: [],
  };
}

function getPackJoinSelectionActions(who) {
  const c = GameState.combat;
  const sel = c.packJoinSelection;
  if (who !== sel.who) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];

  const actions = [];
  const eligible = eligiblePackMembers(sel.who, sel.side)
    .filter(inst => !sel.joined.includes(inst));

  if (sel.mode === 'renownCap') {
    eligible
      .filter(inst => num(inst.def.Renown) <= sel.renownCap)
      .forEach(inst => actions.push({
        type: 'JOIN_PACK_MEMBER', inst,
        label: `Bring in ${inst.name} (Renown ${num(inst.def.Renown)})`,
      }));
    actions.push({ type: 'FINISH_PACK_JOIN', label: 'Done selecting pack members' });
  } else if (sel.mode === 'fixedCount') {
    eligible.forEach(inst => actions.push({
      type: 'JOIN_PACK_MEMBER', inst, label: `Bring in ${inst.name}`,
    }));
  }
  return actions;
}

function finalizePackJoinSelection() {
  const c = GameState.combat;
  const sel = c.packJoinSelection;
  const trig = getTrigger(sel.card, 'packJoin');
  finishPackJoin(sel.who, sel.card, sel.side, trig, sel.joined);
  c.packJoinSelection = null;
}

// Called from startNextRound() (scope 'round') and endCombat() (scope
// 'combat'). A pack-join card's effect ends either when its own
// duration says so (Bum Rush, after the one round it was played for)
// or unconditionally once combat itself is over. Only THEN does the
// card actually move to the real combat discard pile — see
// playPackActionCard() for why it doesn't discard immediately.
function resolveExpiredPackActions(scope) {
  const c = GameState.combat;
  const stillActive = [];
  for (const pa of c.packActions) {
    const expires = scope === 'combat' || pa.duration === scope;
    if (!expires) { stillActive.push(pa); continue; }

    const ps = getPlayer(pa.who);
    pa.card.zone = 'combatDiscard';
    ps.combatDiscard.push(pa.card);

    // Errata: "Creatures that came forward for a Bum Rush ESCAPE at
    // the end of round rather than withdraw" — not death: no VP, no
    // killing-blow bookkeeping, no Victory Pile.
    if (pa.duration === 'round') {
      c.attackerParticipants = c.attackerParticipants.filter(p => !pa.joinedInstanceIds.includes(p.inst.instanceId));
      c.defenderParticipants = c.defenderParticipants.filter(p => !pa.joinedInstanceIds.includes(p.inst.instanceId));
      EventLog.record('PACK_ACTION_ESCAPE', { who: pa.who, card: pa.card.name });
    }
  }
  c.packActions = stillActive;
}

export {
  eligiblePackLinks, sideHasEligiblePackJoin, currentSideRenown, eligiblePackMembers, finishPackJoin, playPackActionCard, getPackJoinSelectionActions, finalizePackJoinSelection, resolveExpiredPackActions,
};
