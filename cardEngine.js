// ═══════════════════════════════════════════════════════════════
// cardEngine.js — Declarative card-effect interpreter.
//
// Card abilities live as DATA in cardEffects.json, not as JS
// special-cases. This is the one file that reads that data and
// knows how to act on it — nothing elsewhere should ever branch on
// a card's name. New abilities are added by extending the JSON;
// only a genuinely new verb/condition needs a new case added below.
//
// Three trigger kinds, each with exactly one integration point:
//
//   phaseAction — turnManager.getLegalActions() merges in extra
//                 choices during a specific phase (getGrantedActions);
//                 performAction() routes CARD_EFFECT actions back
//                 here to resolve (performCardEffectAction).
//
//   onPlay      — turnManager calls onCardEnteredPlay() the moment
//                 a card enters play. (Wired into the engine and
//                 tested, but no shipped card uses it yet — see
//                 handoff notes.)
//
//   static      — game.js's effectiveRage/Gnosis/Health/Renown call
//                 a hook registered here (getStaticModifier).
//                 Nothing is "executed" — the modifier is just read
//                 live, every time a stat is computed.
//
// Dependency direction is one-way: cardEngine imports game.js.
// game.js never imports cardEngine — it exposes registerStatHook()
// so this module can plug in without a circular import.
// ═══════════════════════════════════════════════════════════════

import {
  EventLog, getPlayer, opponent, num,
  discardSept, drawSept, regenerate, registerStatHook, flipToBreed, flipToCrinos,
} from './game.js';

let EFFECTS = {};        // cardName -> { abilities: [...] }
let byId    = new Map(); // ability.id -> { ability, cardName }
let pendingReturns = []; // [{ instance, returnPhase }] — characters removed from play by
                         // removeFromPlayUntilPhase, tracked here rather than in
                         // GameState.huntingGrounds (which getCombatActions() already
                         // treats as attackable prey — reusing it would let the
                         // opponent attack a character that's supposed to be unreachable)

function initCardEngine(effectsData) {
  EFFECTS = effectsData || {};
  byId.clear();
  for (const [cardName, entry] of Object.entries(EFFECTS)) {
    (entry.abilities || []).forEach(ab => byId.set(ab.id, { ability: ab, cardName }));
  }
  registerStatHook(getStaticModifier);
  console.log(`🃏 cardEngine: ${byId.size} abilities loaded for ${Object.keys(EFFECTS).length} cards`);
}

function abilitiesFor(name) {
  return EFFECTS[name]?.abilities || [];
}

// Called by turnManager's doCallMoot right after the vote tally — fires
// for any ability on a member of the CALLING player's pack matching the
// outcome. Pack-scoped (matches "a moot called by X's pack" phrasing),
// not attributed to whichever specific card was played to call it.
function onMootResolved(who, passed) {
  const outcome = passed ? 'pass' : 'fail';
  for (const inst of getPlayer(who).pack) {
    for (const ab of abilitiesFor(inst.name)) {
      if (ab.trigger?.type !== 'onMootOutcome' || ab.trigger.outcome !== outcome) continue;
      applyEffect(who, inst, ab.effect);
      EventLog.record('CARD_EFFECT', { who, ability: ab.id, card: inst.name });
    }
  }
}

// Shared by discardSelf (a card detaching itself) and removeAttachedCard
// (one card removing a different attached card) — same bookkeeping either way.
function detachFromHolder(inst) {
  if (!inst.attachedTo) return;
  const i = inst.attachedTo.attachments.findIndex(a => a.instanceId === inst.instanceId);
  if (i !== -1) inst.attachedTo.attachments.splice(i, 1);
  inst.attachedTo = null;
}

function bothPacksMatchingKeyword(keyword) {
  return [...getPlayer('player').pack, ...getPlayer('opponent').pack]
    .filter(c => (c.def.Keywords || '').includes(keyword));
}

// Called by turnManager at the start of redraw/regen — returns anyone
// whose removeFromPlayUntilPhase matches the phase just entered.
function processPhaseReturns(phase) {
  const returning = pendingReturns.filter(r => r.returnPhase === phase);
  pendingReturns = pendingReturns.filter(r => r.returnPhase !== phase);
  returning.forEach(({ instance }) => {
    instance.zone = 'pack';
    getPlayer(instance.owner).pack.push(instance);
    EventLog.record('RETURNED_TO_PLAY', { who: instance.owner, card: instance.name });
  });
}

// ── targeting: which characters can be chosen when playing a card ──
// A card-level (not ability-level) field, since it's about who's
// eligible to be chosen at play-time, not about resolving an effect.
function getTargetRequirement(cardName) {
  return EFFECTS[cardName]?.targetRequirement || null;
}

// The only place in the engine allowed to look at BOTH players' packs
// at once — everything else stays within getPlayer(who).
function getTargetCandidates(who, req) {
  if (req.scope === 'anyAttachment') {
    let pool = [...getPlayer('player').pack, ...getPlayer('opponent').pack]
      .flatMap(c => c.attachments || []);
    if (req.cardType) pool = pool.filter(a => (a.def.Type || '').startsWith(req.cardType));
    if (req.maxGnosis != null) pool = pool.filter(a => num(a.def.Gnosis) <= req.maxGnosis);
    return pool;
  }
  if (req.scope === 'ownAllies') return getPlayer(who).allies;
  const pool = req.scope === 'anyCharacter'
    ? [...getPlayer(who).pack, ...getPlayer(opponent(who)).pack]
    : getPlayer(who).pack;
  return req.keyword ? pool.filter(c => (c.def.Keywords || '').includes(req.keyword)) : pool;
}

// A card-level gate on whether it can be played at all right now, distinct
// from targetRequirement (which decides *who* it can target once playable).
function checkPlayCondition(cardName, who) {
  const cond = EFFECTS[cardName]?.playCondition;
  if (!cond) return true;
  if (cond.type === 'hadSuccessfulMootThisPhase') return getPlayer(who).hadSuccessfulMootThisPhase;
  return true;
}

// "In play" for this engine: a player's pack, their allies, and
// anything (equipment/gifts) attached to a pack member.
function inPlayInstances(who) {
  const ps = getPlayer(who);
  const attached = ps.pack.flatMap(c => c.attachments || []);
  return [...ps.pack, ...ps.allies, ...attached, ...ps.resources.events];
}

// ── phaseAction: contribute extra legal actions ────────────────────
function getGrantedActions(who, phase) {
  const actions = [];
  for (const inst of inPlayInstances(who)) {
    for (const ab of abilitiesFor(inst.name)) {
      if (ab.trigger?.type !== 'phaseAction' || ab.trigger.phase !== phase) continue;
      actions.push(...buildActionsForAbility(who, inst, ab));
    }
  }
  return actions;
}

function buildActionsForAbility(who, sourceInst, ab) {
  const ps  = getPlayer(who);
  const eff = ab.effect || {};

  if (eff.type === 'discardAndRedrawFromZone') {
    const zoneCards = ps[eff.zone] || [];
    return zoneCards.map(card => ({
      type: 'CARD_EFFECT',
      abilityId: ab.id,
      who,
      sourceInstanceId: sourceInst.instanceId,
      targetInstanceId: card.instanceId,
      label: `${sourceInst.name}: discard & redraw ${card.name}`,
    }));
  }

  if (eff.type === 'healChosenPackMember') {
    const candidates = eff.targetScope === 'holder'
      ? [sourceInst.attachedTo].filter(Boolean)
      : ps.pack;
    return candidates
      .filter(c => (c.damageCards || []).length > 0)
      .map(c => ({
        type: 'CARD_EFFECT',
        abilityId: ab.id,
        who,
        sourceInstanceId: sourceInst.instanceId,
        targetInstanceId: c.instanceId,
        label: `${sourceInst.name}: heal ${c.name}`,
      }));
  }

  return [];
}

// ── phaseAction: resolve a chosen CARD_EFFECT action ────────────────
function performCardEffectAction(action) {
  const entry = byId.get(action.abilityId);
  if (!entry) return;
  const { ability } = entry;
  const ps  = getPlayer(action.who);
  const eff = ability.effect || {};

  if (eff.type === 'discardAndRedrawFromZone') {
    const card = (ps[eff.zone] || []).find(c => c.instanceId === action.targetInstanceId);
    if (!card) return;
    discardSept(ps, card);
    drawSept(ps, eff.count || 1);
    EventLog.record('CARD_EFFECT', { who: action.who, ability: ability.id, target: card.name });
    return;
  }

  if (eff.type === 'healChosenPackMember') {
    const target = ps.pack.find(c => c.instanceId === action.targetInstanceId);
    if (!target) return;
    regenerate(target);
    EventLog.record('CARD_EFFECT', { who: action.who, ability: ability.id, target: target.name });
  }
}

// ── onPlay: fired the instant a card enters play ────────────────────
// Wired into turnManager's doPlayResource(); no shipped card uses
// this yet (see handoff notes), but it's exercised by a synthetic
// ability in the test script.
// Wired into turnManager's doPlayResource(); target is undefined for
// cards that don't need one (e.g. Battle Song) and the character
// chosen at play-time for cards that do (e.g. Mother's Touch).
function onCardEnteredPlay(who, cardInstance, target) {
  for (const ab of abilitiesFor(cardInstance.name)) {
    if (ab.trigger?.type !== 'onPlay') continue;
    if (ab.condition && !evaluateCondition(ab.condition, { who, inst: cardInstance })) continue;
    applyEffect(who, cardInstance, ab.effect, undefined, target);
    if (ab.then) applyEffect(who, cardInstance, ab.then, cardInstance, target);
    EventLog.record('CARD_EFFECT', { who, ability: ab.id, card: cardInstance.name });
  }
}

function applyEffect(who, sourceInst, eff, selfInst, target) {
  if (!eff) return;
  const ps = getPlayer(who);

  if (eff.type === 'modifyPackStat') {
    ps.pack.forEach(c => { c[eff.stat] = (c[eff.stat] || 0) + eff.amount; });
  }
  if (eff.type === 'modifyTargetStat' && target) {
    target[eff.stat] = (target[eff.stat] || 0) + eff.amount;
  }
  if (eff.type === 'healTarget' && target) {
    regenerate(target); // heals the lowest damage card, same as the Vet's verb — the "up to damage N" cap on some cards isn't enforced
  }
  if (eff.type === 'forceBreedForm' && target) {
    flipToBreed(target);
  }
  if (eff.type === 'setFrenzied' && target) {
    target.frenzied = eff.value;
  }
  if (eff.type === 'flipToCrinos' && sourceInst) {
    flipToCrinos(sourceInst);
  }
  if (eff.type === 'forceAlpha' && sourceInst) {
    sourceInst.forcedAlpha = true;
  }
  if (eff.type === 'increasePlayerStat') {
    ps[eff.stat] = (ps[eff.stat] || 0) + eff.amount;
  }
  if (eff.type === 'promoteAllyToPack' && target) {
    const idx = ps.allies.findIndex(a => a.instanceId === target.instanceId);
    if (idx !== -1) {
      ps.allies.splice(idx, 1);
      target.zone = 'pack';
      ps.pack.push(target);
      EventLog.record('PROMOTE_ALLY', { who, card: target.name });
    }
  }
  if (eff.type === 'removeFromPlayUntilPhase') {
    const movers = eff.scope === 'target'
      ? (target ? [target] : [])
      : bothPacksMatchingKeyword(eff.keyword);
    movers.forEach(inst => {
      const movePs = getPlayer(inst.owner);
      const idx = movePs.pack.findIndex(c => c.instanceId === inst.instanceId);
      if (idx !== -1) movePs.pack.splice(idx, 1);
      inst.zone = 'removedFromPlay';
      pendingReturns.push({ instance: inst, returnPhase: eff.returnPhase });
      EventLog.record('REMOVED_FROM_PLAY', { who: inst.owner, card: inst.name, returnPhase: eff.returnPhase });
    });
  }
  if (eff.type === 'discardSelf') {
    const inst = selfInst || sourceInst;
    detachFromHolder(inst);
    discardSept(ps, inst);
  }
  if (eff.type === 'removeAttachedCard' && target) {
    detachFromHolder(target);
    discardSept(getPlayer(target.owner), target);
  }
}

// ── conditions ──────────────────────────────────────────────────────
function evaluateCondition(cond, ctx) {
  if (cond.type === 'packHasKeyword') {
    const ps = getPlayer(ctx.who);
    return ps.pack.some(c => (c.def.Keywords || '').includes(cond.keyword));
  }
  if (cond.type === 'holderIsCrinos') {
    return !!ctx.inst?.isCrinos;
  }
  if (cond.type === 'packHasCaern') {
    const ps = getPlayer(ctx.who || ctx.inst?.owner);
    return ps.resources.caerns.length > 0;
  }
  return true;
}

// ── static: queried live by game.js's effective*() functions ────────
// Checks the card's own static abilities, plus anything attached to
// it (equipment/gifts), evaluating conditions against the holder.
function getStaticModifier(inst, stat) {
  let total = ownStaticBonus(inst, stat, inst);
  (inst.attachments || []).forEach(att => {
    total += ownStaticBonus(att, stat, inst); // condition context = holder
  });
  total += packWideBonus(inst, stat);
  return total;
}

// Abilities with a "scope" (rather than applying to their own card / its
// holder) are sourced from any pack member and apply to every OTHER pack
// member matching the scope filter — e.g. "all Wendigo in this pack".
function packWideBonus(inst, stat) {
  let total = 0;
  const ps = getPlayer(inst.owner);
  const sources = [...ps.pack, ...ps.allies, ...ps.resources.events];
  for (const source of sources) {
    for (const ab of abilitiesFor(source.name)) {
      if (ab.trigger?.type !== 'static' || ab.scope?.type !== 'packKeyword') continue;
      if (ab.effect?.type !== 'statBonus' || ab.effect.stat !== stat) continue;
      if (ab.scope.keyword && !(inst.def.Keywords || '').includes(ab.scope.keyword)) continue;
      if (ab.condition && !evaluateCondition(ab.condition, { inst })) continue;
      total += ab.effect.amount;
    }
  }
  return total;
}

function ownStaticBonus(sourceInst, stat, holderInst) {
  let total = 0;
  for (const ab of abilitiesFor(sourceInst.name)) {
    if (ab.trigger?.type !== 'static') continue;
    if (ab.scope) continue; // scoped abilities are handled exclusively by packWideBonus
    if (ab.effect?.type !== 'statBonus' || ab.effect.stat !== stat) continue;
    if (ab.condition && !evaluateCondition(ab.condition, { inst: holderInst })) continue;
    total += ab.effect.amount;
  }
  return total;
}

export {
  initCardEngine,
  getGrantedActions, performCardEffectAction,
  onCardEnteredPlay,
  getStaticModifier,
  getTargetRequirement, getTargetCandidates, checkPlayCondition,
  processPhaseReturns,
  onMootResolved,
};
