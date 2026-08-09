// ═══════════════════════════════════════════════════════════════
// combatResolution.js — Speed-tier ordering and the rule 6.6.1
// blow-order choice, damage application, Surprise Attack cancellation,
// killing-blow attribution, Taking the Death Blow, and death/combat
// outcome.
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog, getPlayer, opponent, isDead, checkFlipFromDamage, moveToVictoryPile, removeFrom, num, hasKeyword, cardSpeed, removeDamageCard,
} from '../game.js';
import { onDamageResolved, cardHasTriggerType } from '../cardEngine.js';
import { cardName } from './combatState.js';
import { eligiblePackMembers } from './combatPackJoin.js';
import { endCombat } from './combatLifecycle.js';
import { isLegalCombatCard, discardPlayedCard } from './combatCards.js';

// ── Bluff check + resolution ──────────────────────────────────
function resolveBluffAndDamage() {
  const c = GameState.combat;
  c.step = 'bluff';

  // Rule 6.3: "no creature played a Combat Action during the current
  // combat round" ends combat on its own — a separate condition from
  // the attacker choosing to withdraw. Captured BEFORE the bluff
  // check below, since a played-but-illegal card still counts as
  // having been played (it just fails); only an actual pass from EVERY
  // participant on both sides counts as nobody playing anything.
  const allParticipants = [...c.attackerParticipants, ...c.defenderParticipants];
  const nobodyPlayedAnything = allParticipants.every(p => !p.card || p.card === 'pass');

  // Legality (rule 6.9.1) — checked per participant, not just the two
  // alphas, since Phase 4 lets more than one creature per side play a
  // card. A Feint follow-up is a brand new Combat Action in its own
  // right — it can still turn out to be a bluff even though Feint
  // itself already passed its own, stricter legality check in
  // canFeint().
  for (const p of allParticipants) {
    if (p.card && p.card !== 'pass' && !isLegalCombatCard(p.inst, p.card)) {
      EventLog.record('ILLEGAL_CARD_DISCARDED', { who: p.ownerWho, card: cardName(p.card) });
      p.card = 'pass';
    }
    if (p.feintCard && !isLegalCombatCard(p.inst, p.feintCard)) {
      EventLog.record('ILLEGAL_CARD_DISCARDED', { who: p.ownerWho, card: cardName(p.feintCard) });
      p.feintCard = null;
    }
  }

  EventLog.record('COMBAT_STEP', { step: 'resolution' });
  c.step = 'resolution';

  // Every card actually landing this round — normally one per side,
  // or two for a side that played Feint and followed up, or more once
  // a pack has multiple participants. Modeled as a flat list rather
  // than fixed attacker/defender slots so Feint's extra card (and,
  // eventually, every pack member's own card) flows through the SAME
  // speed-tier/dodge/death logic as everything else, with no separate
  // code path of its own. Built by iterating the participant arrays
  // (source of truth) rather than the four legacy fixed fields —
  // Phase 1 has exactly one participant per side, so this produces
  // the identical four-call order the old code did by hand: attacker
  // card, attacker feint, defender card, defender feint.
  const plays = [];
  const addPlay = (ownerWho, owner, target, card) => {
    if (!card || card === 'pass') return;
    plays.push({ ownerWho, owner, opponent: target, card, speed: cardSpeed(card) });
  };
  for (const p of [...c.attackerParticipants, ...c.defenderParticipants]) {
    addPlay(p.ownerWho, p.inst, p.targetInst, p.card);
    addPlay(p.ownerWho, p.inst, p.targetInst, p.feintCard);
  }

  // Fast/Slow Striking (rule 6.10.1): resolution happens in three
  // ordered passes — Fast, then Normal, then Slow — not simultaneously.
  // This affects two things:
  //  - Dodges/Block (rule 6.10.2) only stop an attack at an equal or
  //    SLOWER speed than the dodge itself — a Normal-speed Dodge has
  //    no effect on a Fast Striking attack, since the attack has
  //    already landed by the time the dodge would resolve. A side
  //    dodges this round if ANY of its plays grants it (e.g. a Dodge
  //    played as a Feint follow-up), using that specific card's speed.
  //  - If a creature dies in an earlier pass, ALL of their own
  //    still-pending cards (their normal card and/or Feint follow-up)
  //    are discarded unresolved, never dealing damage (checked fresh
  //    at the top of each pass, so two SAME-speed cards still land
  //    together even if one would be lethal to the other — only an
  //    earlier, FASTER pass can pre-empt a later one).
  const SPEED_RANK = { fast: 0, normal: 1, slow: 2 };
  const dodgeInfo = (ownerWho) => {
    const grant = plays.find(p => p.ownerWho === ownerWho && cardHasTriggerType(p.card, 'dodgesRound'));
    return grant ? { active: true, speed: grant.speed } : { active: false };
  };
  const attackerDodge = dodgeInfo(c.attackerWho);
  const defenderDodge = dodgeInfo(c.defenderWho);

  for (const play of plays) {
    const incomingDodge = play.ownerWho === c.attackerWho ? defenderDodge : attackerDodge;
    play.dodged = incomingDodge.active
      && !hasKeyword(play.card, 'Undodgeable')
      && SPEED_RANK[incomingDodge.speed] <= SPEED_RANK[play.speed];
  }

  // Telling Blow: tracks the FIRST card, in resolution order, whose
  // damage pushes a given creature from alive to dead — "the killing
  // blow" specifically, not just any card played by the killer this
  // round. Checked below in checkCombatDeaths()/awardKillingBlowBonus().
  const killingBlowFor = new Map();

  resolveTier(plays, killingBlowFor, 0, allParticipants, nobodyPlayedAnything);
}

const RESOLUTION_TIERS = ['fast', 'normal', 'slow'];

// Rule 6.10.1: Fast, then Normal, then Slow — three ordered passes,
// not simultaneous.
//
// Rule 6.6.1: "When one side has multiple combat cards played at the
// same time, the controlling player may determine the order that the
// blows land when they damage their targets... A creature is
// considered killed by the creature who played the fatal damage card."
// Only matters when 2+ plays land on the SAME target within the SAME
// tier — and since a creature's target is always someone on the
// OPPOSING side, any two plays sharing a target necessarily come from
// the same controlling player, so "multiple cards hitting one target"
// and "multiple cards from one side" are the same condition here. The
// TOTAL damage dealt never depends on this choice (every contested
// card still connects regardless of order) — only which SPECIFIC card
// gets credited with the kill (killingBlowFor) does, which is what
// actually matters for VP/Telling Blow/Taking the Death Blow.
//
// Auto-resolves a tier immediately, with no pause, whenever nothing is
// actually contested — true for every single-participant combat and
// the large majority of pack-combat rounds too.
function resolveTier(plays, killingBlowFor, tierIndex, allParticipants, nobodyPlayedAnything) {
  const c = GameState.combat;
  if (tierIndex >= RESOLUTION_TIERS.length) {
    afterAllTiersResolved(plays, killingBlowFor, allParticipants, nobodyPlayedAnything);
    return;
  }
  const tier = RESOLUTION_TIERS[tierIndex];

  // Per-owner death snapshot BEFORE this tier's plays resolve, so
  // same-tier cards still land together regardless of what else
  // resolves in the same tier.
  const deadAtStart = new Map();
  for (const play of plays) {
    if (!deadAtStart.has(play.owner)) deadAtStart.set(play.owner, isDead(play.owner));
  }

  const tierPlays = plays.filter(p => p.speed === tier);
  const willConnect = tierPlays.filter(p => !deadAtStart.get(p.owner) && !p.dodged);
  const groups = new Map(); // target -> plays landing on it this tier
  for (const play of willConnect) {
    if (!groups.has(play.opponent)) groups.set(play.opponent, []);
    groups.get(play.opponent).push(play);
  }
  const contestedGroups = [...groups.values()].filter(g => g.length >= 2);

  if (contestedGroups.length === 0) {
    applyTierDamage(tierPlays, deadAtStart, killingBlowFor);
    resolveTier(plays, killingBlowFor, tierIndex + 1, allParticipants, nobodyPlayedAnything);
    return;
  }

  c.damageOrderContext = {
    plays, killingBlowFor, tierIndex, deadAtStart, tierPlays,
    allParticipants, nobodyPlayedAnything,
    pendingGroups: contestedGroups, orderedSoFar: [],
  };
  c.step = 'damageOrder';
  EventLog.record('COMBAT_STEP', { step: c.step, tier });
}

// The actual per-play application — unchanged from before Phase 4's
// order-choice feature, just extracted so both the trivial
// (auto-resolved) and contested (order-chosen) paths share it.
function applyTierDamage(orderedPlays, deadAtStart, killingBlowFor) {
  const c = GameState.combat;
  for (const play of orderedPlays) {
    if (deadAtStart.get(play.owner)) {
      EventLog.record('CARD_DISCARDED_UNRESOLVED', { who: play.ownerWho, card: play.card.name });
    } else if (play.dodged) {
      const dodgerWho = play.ownerWho === c.attackerWho ? c.defenderWho : c.attackerWho;
      EventLog.record('DODGED', { dodger: dodgerWho, avoided: play.card.name });
    } else {
      const targetAlreadyDead = isDead(play.opponent);
      applyDamage(play.owner, play.card, play.opponent);
      if (!targetAlreadyDead && isDead(play.opponent) && !killingBlowFor.has(play.opponent)) {
        killingBlowFor.set(play.opponent, play.card);
      }
    }
  }
}

// A contested group's controlling player just picked which of their
// tied cards resolves next. Once every card in the CURRENT group has
// an explicit order, move to the next contested group in this tier (if
// any); once every group is done, apply the whole tier (contested
// plays in the chosen order, everything else keeping its natural order
// — cross-target ordering never affects any single target's outcome,
// only intra-group order does) and move to the next tier.
function advanceDamageOrder() {
  const c = GameState.combat;
  const ctx = c.damageOrderContext;
  const group = ctx.pendingGroups[0];
  const stillRemaining = group.filter(p => !ctx.orderedSoFar.includes(p));
  if (stillRemaining.length === 0) ctx.pendingGroups.shift();
  if (ctx.pendingGroups.length > 0) return; // next group's options come from getCombatRoundActions

  const contestedSet = new Set(ctx.orderedSoFar);
  const uncontested = ctx.tierPlays.filter(p => !contestedSet.has(p));
  const finalOrder = [...ctx.orderedSoFar, ...uncontested];
  applyTierDamage(finalOrder, ctx.deadAtStart, ctx.killingBlowFor);

  const { plays, killingBlowFor, tierIndex, allParticipants, nobodyPlayedAnything } = ctx;
  c.damageOrderContext = null;
  resolveTier(plays, killingBlowFor, tierIndex + 1, allParticipants, nobodyPlayedAnything);
}

// Reached once all three tiers have fully resolved (with whatever
// blow-order choices were made along the way already applied).
function afterAllTiersResolved(plays, killingBlowFor, allParticipants, nobodyPlayedAnything) {
  const c = GameState.combat;

  // Surprise Attack (round 1 only): if this card's own damage actually
  // connected, the OPPONENT's damage this round is retroactively
  // undone — including anything conditionally scripted off it (an
  // aggravated mark, a tempMod/tempFlag) — via the same removeDamageCard()
  // helper regenerate() uses, since a "prevented" wound should leave no
  // partial trace. Must run BEFORE checkCombatDeaths() below, so a
  // cancelled hit can't still kill someone. Same speed rule as Dodge
  // (errata): can't cancel a Fast Striking opponent's damage unless
  // Surprise Attack was also Fast Striking — it's already resolved by
  // the time Surprise Attack's own (Normal or slower) tier runs.
  // Checking each side's own connection independently against the
  // round's original outcome (not against each other's cancellations)
  // is what makes two mutual Surprise Attacks correctly cancel each
  // other (per its own errata), regardless of array order.
  const SPEED_RANK = { fast: 0, normal: 1, slow: 2 };
  if (c.round === 1) {
    // Determined from the round's ORIGINAL, untouched resolution before
    // any removal happens — otherwise cancelling one side's damage
    // first would make the other side's own "did I connect" check read
    // already-mutated state, silently breaking mutual cancellation
    // (two Surprise Attacks played against each other must each cancel
    // independently, not have the second one's card vanish before its
    // own check even runs).
    const toCancel = [];
    for (const play of plays) {
      if (!cardHasTriggerType(play.card, 'cancelsOpponentDamageRound1')) continue;
      if (!play.opponent.damageCards.includes(play.card)) continue; // didn't actually connect — nothing to trigger
      for (const oppPlay of plays.filter(p => p.owner === play.opponent)) {
        if (SPEED_RANK[oppPlay.speed] < SPEED_RANK[play.speed]) continue;    // already resolved faster
        if (!play.owner.damageCards.includes(oppPlay.card)) continue;       // never landed anyway (dodged/discarded)
        toCancel.push({ victim: play.owner, card: oppPlay.card, by: play.card.name });
      }
    }
    for (const { victim, card, by } of toCancel) {
      removeDamageCard(victim, card);
      EventLog.record('DAMAGE_CANCELLED', { by, cancelled: card.name });
    }
  }

  // Check deaths — must run BEFORE discarding played cards, so Telling
  // Blow's bonus (below) can redirect its own card to the Victory Pile
  // instead of the normal combat discard pile. But FIRST, give Taking
  // the Death Blow a chance to redirect a fatal card away from whoever
  // it would kill — see checkForDeathBlowOpportunities()/finishResolution().
  checkForDeathBlowOpportunities(plays, allParticipants, nobodyPlayedAnything, killingBlowFor);
}

// Taking the Death Blow (reactive): "Play this card when 1 of your
// characters receives a mortal wound." Must run after all this
// round's damage (including Surprise Attack's retroactive cancellation
// above) is settled, but BEFORE checkCombatDeaths() actually finalizes
// any death — this is the one point a controller can still save a
// creature that's about to die, by redirecting the SPECIFIC fatal
// damage card onto a substitute packmate instead. Phase 3's
// killingBlowFor already identifies exactly which card that is (the
// same attribution Telling Blow's bonus relies on), so no new
// attribution logic is needed here.
//
// Auto-skips straight to finishResolution() (synchronously, no pause)
// if nobody who's about to lose a creature actually has both the card
// and an eligible substitute — same "only pause for a genuine
// decision" pattern as every other Phase 4 step.
function checkForDeathBlowOpportunities(plays, allParticipants, nobodyPlayedAnything, killingBlowFor) {
  const c = GameState.combat;

  const pending = [];
  for (const p of [...c.attackerParticipants, ...c.defenderParticipants]) {
    if (!isDead(p.inst)) continue;
    if (!killingBlowFor.has(p.inst)) continue; // not killed by a damage card this round — nothing to redirect
    const side = c.attackerParticipants.includes(p) ? 'attacker' : 'defender';
    const hasCard = getPlayer(p.ownerWho).combatHand.some(card => cardHasTriggerType(card, 'deathBlowRedirect'));
    const hasSubstitute = eligiblePackMembers(p.ownerWho, side).length > 0;
    if (hasCard && hasSubstitute) pending.push({ who: p.ownerWho, participant: p, side });
  }

  if (pending.length === 0) {
    finishResolution(plays, allParticipants, nobodyPlayedAnything, killingBlowFor);
    return;
  }

  c.deathBlowQueue = pending;
  c.pendingDeathBlowContext = { plays, allParticipants, nobodyPlayedAnything, killingBlowFor };
  c.step = 'deathBlow';
  EventLog.record('COMBAT_STEP', { step: c.step });
}

// A dying creature's controller declined (or had nothing to decide),
// or just finished redirecting — move to whoever's next in the queue,
// or finish the round's resolution once it's empty.
function advanceDeathBlowQueue() {
  const c = GameState.combat;
  c.deathBlowQueue.shift();
  if (c.deathBlowQueue.length === 0) {
    const ctx = c.pendingDeathBlowContext;
    c.deathBlowQueue = null;
    c.pendingDeathBlowContext = null;
    finishResolution(ctx.plays, ctx.allParticipants, ctx.nobodyPlayedAnything, ctx.killingBlowFor);
  }
}

// Rule 6.10.3 Redirection: moves the SPECIFIC fatal damage card from
// the original target to the substitute — nothing else about either
// creature's other wounds changes. The substitute takes over the
// dying creature's spot in combat and becomes alpha for the rest of
// the Combat Phase (errata). "The original target of the attack
// escapes combat if able" — no card anywhere in the engine yet grants
// a "cannot escape" flag, so escape always succeeds today; the "stays
// and creates a pack action instead" branch is here for when one
// eventually does, but is unreachable until then.
function playDeathBlowRedirect(who, card, dyingInst, substituteInst) {
  const c = GameState.combat;
  const entry = c.deathBlowQueue[0];
  const killingBlowFor = c.pendingDeathBlowContext.killingBlowFor;
  const killingCard = killingBlowFor.get(dyingInst);
  const side = entry.side;
  const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
  const dyingParticipant = participants.find(p => p.inst === dyingInst);

  const ps = getPlayer(who);
  removeFrom(ps.combatHand, card);
  card.zone = 'combatDiscard';
  ps.combatDiscard.push(card);

  removeFrom(dyingInst.damageCards, killingCard);
  substituteInst.damageCards.push(killingCard);
  killingBlowFor.delete(dyingInst);
  killingBlowFor.set(substituteInst, killingCard);

  const canEscape = true; // see comment above — always true until some card says otherwise
  if (canEscape) {
    const filtered = participants.filter(p => p !== dyingParticipant);
    if (side === 'attacker') c.attackerParticipants = filtered; else c.defenderParticipants = filtered;
    EventLog.record('DEATH_BLOW_ESCAPE', { who, escaped: dyingInst.name });
  }
  // else: "it creates a pack action" — dyingParticipant simply remains
  // in the array, now fighting alongside the substitute.

  const subParticipant = {
    inst: substituteInst, ownerWho: who, role: 'alpha',
    card: null, feintCard: null, feintDecided: false, targetInst: null,
  };
  (side === 'attacker' ? c.attackerParticipants : c.defenderParticipants).push(subParticipant);

  ps.alpha = substituteInst; // "considered to be alpha for the remainder of the Combat Phase"

  EventLog.record('DEATH_BLOW_REDIRECT', {
    who, card: card.name, saved: dyingInst.name, substitute: substituteInst.name,
  });
}

// The rest of what resolveBluffAndDamage used to do unconditionally,
// now reached either immediately (nobody had a death-blow decision to
// make) or after the death-blow queue above has been fully resolved.
function finishResolution(plays, allParticipants, nobodyPlayedAnything, killingBlowFor) {
  const c = GameState.combat;

  // Check deaths — must run BEFORE discarding played cards, so Telling
  // Blow's bonus can redirect its own card to the Victory Pile instead
  // of the normal combat discard pile.
  checkCombatDeaths(killingBlowFor);

  // Discard played cards. Iterates plays[] — captured before any
  // deaths (or death-blow redirects) could have changed the
  // participants arrays — so every card actually played this round
  // gets discarded (unless redirected to a Victory Pile by Telling
  // Blow, or already attached to a target as a damage card),
  // regardless of whether the creature that played it is now dead.
  for (const play of plays) {
    discardPlayedCard(play.ownerWho, play.card);
  }

  if (c.ended) return;

  // Run Like Hell / Forceful Wind: both force combat to end right
  // here, bypassing the normal withdrawal step entirely — checked
  // directly via the marker tag (not onDamageDealt, since Run Like
  // Hell has no Damage value and would never reach applyDamage() at
  // all). Checked across every participant's card played this round
  // (including a Feint follow-up), not just the two legacy fields —
  // uses allParticipants captured above, before checkCombatDeaths()
  // could have removed anyone from the live arrays.
  const endsCombatCard = allParticipants.flatMap(p => [p.card, p.feintCard])
    .find(card => cardHasTriggerType(card, 'endsCombatAfterRound'));
  if (endsCombatCard) {
    EventLog.record('COMBAT_FORCED_END', { card: endsCombatCard.name });
    endCombat('card_effect');
    return;
  }

  if (nobodyPlayedAnything) {
    endCombat('no_cards_played');
    return;
  }

  c.step = 'withdrawal';
  EventLog.record('COMBAT_STEP', { step: c.step });
}

function applyDamage(source, card, target) {
  if (!card || card === 'pass') return;
  const dmgValue = num(card.def.Damage);
  if (dmgValue <= 0) return;   // non-damaging card (block/dodge/utility)

  target.damageCards.push(card);
  EventLog.record('DAMAGE_DEALT', {
    source: source.name, target: target.name, amount: dmgValue
  });

  // Scripted onDamageDealt abilities (e.g. Fur Gnarl) run BEFORE the
  // flip check below — a card's own condition must read the victim's
  // form as it was when the wound landed, not after a flip this same
  // wound might have just caused.
  onDamageResolved(card, source, target);
  checkFlipFromDamage(target);
}

// ── Death check ────────────────────────────────────────────────
// Rule 6.3/6.4.2/6.6.1: any participant on either side can die without
// ending combat by itself — combat only ends once a WHOLE side has no
// participants left ("there are no attackers or no defenders in the
// combat"). The killer, for VP purposes, is simply the OTHER side's
// player: rule 6.5.8 forbids pulling creatures from outside your own
// pack into pack combat, so every participant on a side always
// belongs to that side's controlling player — no need to track a
// killer any more granular than that. The SPECIFIC card that dealt
// the killing blow (for Telling Blow) is already tracked per-creature
// via killingBlowFor, keyed by creature instance rather than by
// attacker/defender role, so that part needed no change at all.
function checkCombatDeaths(killingBlowFor) {
  const c = GameState.combat;

  const deadAttackers = c.attackerParticipants.filter(p => isDead(p.inst));
  const deadDefenders = c.defenderParticipants.filter(p => isDead(p.inst));

  for (const p of deadDefenders) {
    const killer = getPlayer(c.attackerWho);
    moveToVictoryPile(killer, p.inst);
    EventLog.record('COMBAT_KILL', { killer: c.attackerWho, victim: p.inst.name });
    awardKillingBlowBonus(killer, killingBlowFor?.get(p.inst));
  }
  for (const p of deadAttackers) {
    const killer = getPlayer(c.defenderWho);
    moveToVictoryPile(killer, p.inst);
    EventLog.record('COMBAT_KILL', { killer: c.defenderWho, victim: p.inst.name });
    awardKillingBlowBonus(killer, killingBlowFor?.get(p.inst));
  }

  // Remove the dead from combat — this is what actually implements
  // "no longer ends combat by itself." Reassigning (not mutating in
  // place) is safe: every getter reads `this.attackerParticipants`
  // fresh, and plays[]/targetingQueue this round hold direct
  // participant-object references, not the array itself.
  if (deadAttackers.length) {
    c.attackerParticipants = c.attackerParticipants.filter(p => !deadAttackers.includes(p));
  }
  if (deadDefenders.length) {
    c.defenderParticipants = c.defenderParticipants.filter(p => !deadDefenders.includes(p));
  }

  // Rule 6.3: "there are no attackers or no defenders in the combat"
  if (c.attackerParticipants.length === 0 || c.defenderParticipants.length === 0) {
    endCombat('death');
  }
}

// Telling Blow: "If the damage from this card immediately kills your
// opponent, place Telling Blow in your victory pile for an additional
// 3 victory points." Only fires for the SPECIFIC card that was the
// killing blow (see killingBlowFor, tracked during the tiered
// resolution loop above), not just any card the killer happened to
// play this round. Redirects the card to the Victory Pile in place of
// the normal combat discard — discardPlayedCard() guards against then
// re-discarding it.
function awardKillingBlowBonus(killerState, killingCard) {
  if (!killingCard || !cardHasTriggerType(killingCard, 'awardsBonusVPOnKill')) return;
  killingCard.vpOverride = 3; // Combat Actions have no printed Renown for countVP() to read otherwise
  killingCard.zone = 'victoryPile';
  killerState.victoryPile.push(killingCard);
  EventLog.record('BONUS_VP', { who: killerState.who, card: killingCard.name, vp: killingCard.vpOverride });
}

export {
  resolveBluffAndDamage, RESOLUTION_TIERS, resolveTier, applyTierDamage, advanceDamageOrder, afterAllTiersResolved, checkForDeathBlowOpportunities, advanceDeathBlowQueue, playDeathBlowRedirect, finishResolution, applyDamage, checkCombatDeaths, awardKillingBlowBonus,
};
