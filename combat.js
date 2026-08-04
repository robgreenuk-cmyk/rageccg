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
  pruneExpiredRoundMods, clearEndOfCombatMods, hasKeyword, hasActiveFlag, cardSpeed,
  removeDamageCard,
} from './game.js';
import { onDamageResolved, cardHasTriggerType, getTrigger } from './cardEngine.js';

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

// ── Start combat ──────────────────────────────────────────────
function declareAttack(attackerWho, attacker, target) {
  const defenderWho = target.owner ?? opponent(attackerWho);

  // Declaring an attack IS the alpha's one action for this Combat
  // Phase (rule 2.2.6: an alpha may do ONE of the listed alpha
  // actions, including "attack any other alpha" / "attack any Enemy
  // or Victim"). Set here, the single authoritative place an attack
  // actually starts, regardless of what called it.
  getPlayer(attackerWho).alphaActedThisCombatPhase = true;

  // Pack Combat foundation (rule 6.5.8/6.6.2/6.7): attacker/defender
  // are no longer stored fields — they're the true source of truth,
  // a per-side array of participants. V1/Phase 1: each array starts
  // with exactly one entry (the alpha), matching current single-vs-
  // single behavior exactly. No pack-joining cards wire into this
  // yet — that's Phase 4. targetInst starts null and is populated
  // fresh each round by the real targeting step (rule 6.7, Phase 2)
  // once cards are played — see beginTargetingStep().
  const attackerParticipants = [
    { inst: attacker, ownerWho: attackerWho, role: 'alpha',
      card: null, feintCard: null, feintDecided: false, targetInst: null },
  ];
  const defenderParticipants = [
    { inst: target, ownerWho: defenderWho, role: 'alpha',
      card: null, feintCard: null, feintDecided: false, targetInst: null },
  ];

  GameState.combat = {
    round:        1,
    step:         'declaration',
    attackerWho,
    defenderWho,

    // Source of truth. Order within each array doesn't imply
    // anything; role does.
    attackerParticipants,
    defenderParticipants,

    // Phase 4 (rule 6.5.8/6.6.2): pack-join Combat Events currently in
    // effect — { card, side, who, duration:'round'|'combat',
    // joinedInstanceIds, bonusCards }. See joinPackCombat.js section
    // below for how these are created/expired. packJoinSelection holds
    // an in-progress "which pack members are joining" choice (renownCap/
    // fixedCount modes only — wholePack/Bum Rush needs no selection).
    packActions: [],
    packJoinSelection: null,
    // Whose turn it is to act (or explicitly pass) at the current
    // pausable step — rule 6.1's "first the attacker, then the
    // defender" order, front of the array acts next. Only Declaration/
    // Pre-Combat/Begin-of-Combat/Between-rounds are pausable steps;
    // see beginPausableStep()/autoAdvanceIfNothingToDecide().
    stepWaitingOn: [],

    // ── Compatibility accessors ──────────────────────────────────
    // Every existing call site (combat.js itself, main.js, turnManager.js,
    // the test suite) reads/writes `.attacker`, `.defender`,
    // `.attackerCard`, etc. directly. These proxy onto the alpha
    // participant so none of those call sites need to change while
    // internals move to the array. `attacker`/`defender` are pure
    // getters (never assigned directly anywhere in the codebase) —
    // computed fresh from the participants array every time, so
    // there's no second copy that could desync from it.
    get attacker()  { return primaryParticipant(this.attackerParticipants)?.inst; },
    get defender()  { return primaryParticipant(this.defenderParticipants)?.inst; },

    get attackerCard()  { return primaryParticipant(this.attackerParticipants)?.card; },
    set attackerCard(v) { const p = primaryParticipant(this.attackerParticipants); if (p) p.card = v; },
    get defenderCard()  { return primaryParticipant(this.defenderParticipants)?.card; },
    set defenderCard(v) { const p = primaryParticipant(this.defenderParticipants); if (p) p.card = v; },

    // Feint (rule 6.8.1): an optional follow-up card played face-up
    // during the Reveal step's mini-step, AFTER seeing the opponent's
    // already-revealed card. Only ever set if the side's normal card
    // this round has the feintOnReveal ability — see checkFeintOpportunity().
    get attackerFeintCard()  { return primaryParticipant(this.attackerParticipants)?.feintCard; },
    set attackerFeintCard(v) { const p = primaryParticipant(this.attackerParticipants); if (p) p.feintCard = v; },
    get defenderFeintCard()  { return primaryParticipant(this.defenderParticipants)?.feintCard; },
    set defenderFeintCard(v) { const p = primaryParticipant(this.defenderParticipants); if (p) p.feintCard = v; },

    get attackerFeintDecided()  { return primaryParticipant(this.attackerParticipants)?.feintDecided; },
    set attackerFeintDecided(v) { const p = primaryParticipant(this.attackerParticipants); if (p) p.feintDecided = v; },
    get defenderFeintDecided()  { return primaryParticipant(this.defenderParticipants)?.feintDecided; },
    set defenderFeintDecided(v) { const p = primaryParticipant(this.defenderParticipants); if (p) p.feintDecided = v; },

    feintDeciderWho:      null,
    // Result of most recent round
    lastResult:   null,
    ended:        false,
  };

  EventLog.record('COMBAT_DECLARED', {
    attacker: attacker.name, defender: target.name
  });

  // Rule 6.1: Declaration Step is Closed Play — the attacker (Hunting
  // Party) and then the defender (Shieldmate, not yet wired) each get
  // a real chance to act here before Pre-Combat. beginPausableStep()
  // auto-cascades straight through to the Play-card step with zero
  // pause if nobody actually has an eligible card for these steps —
  // true for every combat that doesn't involve one of these four
  // cards, which is what keeps this 100% behavior-compatible with
  // every existing single-participant combat.
  beginPausableStep('declaration', [attackerWho, defenderWho]);

  return GameState.combat;
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

function sideHasEligiblePackJoin(who) {
  const c = GameState.combat;
  const side = who === c.attackerWho ? 'attacker' : 'defender';
  return getPlayer(who).combatHand.some(card => {
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
}

function beginPausableStep(stepName, waitingOn) {
  const c = GameState.combat;
  c.step = stepName;
  c.stepWaitingOn = waitingOn;
  EventLog.record('COMBAT_STEP', { step: c.step });
  autoAdvanceIfNothingToDecide();
}

// Skips past anyone in the queue who has nothing real to decide at
// this step — the common case for every combat that doesn't involve
// one of the four pack-join cards, which is what keeps this 100%
// behavior-compatible with every single-participant combat that
// existed before Phase 4.
function autoAdvanceIfNothingToDecide() {
  const c = GameState.combat;
  while (c.stepWaitingOn.length > 0 && !sideHasEligiblePackJoin(c.stepWaitingOn[0])) {
    c.stepWaitingOn.shift();
  }
  if (c.stepWaitingOn.length === 0) advanceToNextRealStep();
}

// Called once everyone waiting on the CURRENT step has passed or
// finished acting — moves to the next step in rule 6.1's sequence
// (or, from betweenRounds, actually starts the next round).
function advanceToNextRealStep() {
  const c = GameState.combat;
  switch (c.step) {
    case 'declaration':
      beginPausableStep('preCombat', [c.attackerWho, c.defenderWho]);
      break;
    case 'preCombat':
      beginPausableStep('beginCombat', [c.attackerWho, c.defenderWho]);
      break;
    case 'beginCombat':
      c.step = 'playCard';
      EventLog.record('COMBAT_STEP', { step: c.step, round: c.round });
      break;
    case 'betweenRounds':
      startNextRound();
      break;
  }
}

// The front-of-queue side has explicitly chosen to pass at this step.
function advancePausableStep() {
  const c = GameState.combat;
  c.stepWaitingOn.shift();
  autoAdvanceIfNothingToDecide();
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

// ── Legal combat-round actions for whoever's turn it is to act ─
function getCombatRoundActions(who) {
  const c = GameState.combat;
  if (!c) return [];

  const ps = getPlayer(who);
  const actions = [];

  // Declaration / Pre-Combat / Begin-of-Combat / Between-rounds (rule
  // 6.1): pausable steps where pack-join Combat Events (Hunting Party/
  // Pack Defense/Bum Rush/Surprise Ally) can be played. See
  // beginPausableStep()/autoAdvanceIfNothingToDecide() — this branch is
  // only ever reached when someone genuinely has a decision to make;
  // every other combat skips straight through to 'playCard'.
  if (c.step === 'declaration' || c.step === 'preCombat' || c.step === 'beginCombat' || c.step === 'betweenRounds') {
    if (c.packJoinSelection) return getPackJoinSelectionActions(who);
    if (who !== c.stepWaitingOn[0]) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];

    const side = who === c.attackerWho ? 'attacker' : 'defender';
    ps.combatHand.forEach(card => {
      const trig = getTrigger(card, 'packJoin');
      if (!trig) return;
      if (!stepMatches(trig.step, c.step)) return;
      if (trig.side !== 'either' && trig.side !== side) return;
      if (c.packActions.some(pa => pa.card.name === card.name)) return;
      actions.push({ type: 'PLAY_PACK_ACTION', card, label: `Play ${card.name}` });
    });
    actions.push({ type: 'PASS_STEP', label: 'Continue' });
    return actions;
  }

  if (c.step === 'playCard') {
    const mySide = who === c.attackerWho ? c.attackerParticipants : c.defenderParticipants;
    const pending = mySide.find(p => p.card === null);
    if (!pending) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];

    const actorInst = pending.inst;

    // Forced/restricted play (rule 6.6.6): checked in order of how
    // total the restriction is. cannotPlayCombatAction (Head Wound,
    // Overextended Attack) forbids ANY combat card this round — takes
    // priority over forcedRandomPlay (Eyes Gouged), which still forces
    // a card, just not one the player chooses. Checked against the
    // SPECIFIC participant still waiting to act, not a side-wide flag —
    // each participant plays (or doesn't) independently.
    if (hasActiveFlag(actorInst, 'cannotPlayCombatAction')) {
      actions.push({ type: 'PASS_COMBAT_CARD', label: `${actorInst.name}: play nothing this round (wounded)` });
      return actions;
    }
    if (hasActiveFlag(actorInst, 'forcedRandomPlay')) {
      actions.push({ type: 'FORCED_RANDOM_PLAY', label: `${actorInst.name}: forced random attack (blinded)` });
      return actions;
    }

    // A card instance stays in ps.combatHand until it's actually
    // discarded at resolution — fine when only one participant per
    // side could ever act, but once several can, a card another
    // participant already played this round (still sitting in hand,
    // not yet discarded) must not be offered again to a second one.
    const usedThisRound = new Set(
      [...c.attackerParticipants, ...c.defenderParticipants]
        .flatMap(p => [p.card, p.feintCard])
        .filter(card => card && card !== 'pass')
    );
    ps.combatHand.forEach(card => {
      if (usedThisRound.has(card)) return;
      const t = (card.def.Type || '').toLowerCase();
      if (t.startsWith('combat action') || t.startsWith('combat event')) {
        actions.push({ type: 'PLAY_COMBAT_CARD', card, label: `${actorInst.name}: play ${card.name}` });
      }
    });
    actions.push({ type: 'PASS_COMBAT_CARD', label: `${actorInst.name}: play nothing this round` });
  }

  if (c.step === 'targeting') {
    const q = c.targetingQueue;
    if (!q) return [{ type: 'WAITING', label: 'Resolving targets…' }];
    if (who !== q.turn) return [{ type: 'WAITING', label: 'Waiting for opponent to assign targets…' }];
    const myQueue = who === c.attackerWho ? q.attackerQueue : q.defenderQueue;
    const p = myQueue[0];
    if (!p) return [{ type: 'WAITING', label: 'Waiting for opponent to assign targets…' }];
    const enemies = who === c.attackerWho ? c.defenderParticipants : c.attackerParticipants;
    return enemies.map(e => ({
      type: 'ASSIGN_TARGET', target: e.inst,
      label: `${p.inst.name}'s card targets ${e.inst.name}`,
    }));
  }

  if (c.step === 'reveal' && who === 'player') {
    // Only the human needs a button here — the CPU has nothing to
    // decide at this step, it's purely a paced viewing moment before
    // resolution runs.
    actions.push({ type: 'CONTINUE_REVEAL', label: 'Continue' });
  }

  if (c.step === 'reveal-feint') {
    if (who !== c.feintDeciderWho) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];
    // Feint (rule 6.8.1): having already seen the opponent's revealed
    // card, the feinting side may play ONE additional Combat Action
    // face up, or decline. "Targets the same creature as the Feint"
    // (errata) is automatic here — V1 has only one possible target.
    ps.combatHand.forEach(card => {
      const t = (card.def.Type || '').toLowerCase();
      if (t.startsWith('combat action') || t.startsWith('combat event')) {
        actions.push({ type: 'PLAY_FEINT_FOLLOWUP', card, label: `Feint follow-up: ${card.name}` });
      }
    });
    actions.push({ type: 'DECLINE_FEINT', label: 'Do not play a follow-up' });
  }

  if (c.step === 'withdrawal' && who === c.attackerWho) {
    // Overextended Attack: "may not withdraw before the next round" —
    // only ever offered to the attacker in the first place, so
    // checking the flag generically here already satisfies that
    // card's own "if your character is the attacker" condition.
    //
    // NOTE (Phase 3 scope limit): rule 6.3.1 says withdrawal-preventing
    // effects "affect all attackers, no matter how many attackers
    // there are" (e.g. Maim) — meaning in a real pack, ANY attacking
    // participant with this flag should block the whole side from
    // withdrawing, not just whichever one this check happens to read.
    // This only checks primaryParticipant() (the alpha, or its
    // stand-in) for now. Harmless while every attacking creature has
    // this flag in practice (single-participant sides), but not yet
    // correct for a genuine multi-participant pack — revisit before/
    // during Phase 4 once a real card can actually apply this flag to
    // a non-alpha packmate.
    if (!hasActiveFlag(c.attacker, 'cannotWithdraw')) {
      actions.push({ type: 'WITHDRAW', label: 'Withdraw from combat' });
    }
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
    case 'FORCED_RANDOM_PLAY': {
      // Eyes Gouged (rule 6.6.6c, Random Play): the player doesn't
      // choose — a card is drawn at random from their own combat hand
      // and played exactly as PLAY_COMBAT_CARD would. It can still
      // turn out illegal (e.g. insufficient Rage) and get bluffed out
      // normally in resolveBluffAndDamage() — random play doesn't
      // bypass legality, it only removes the player's choice.
      const ps = getPlayer(who);
      const eligible = ps.combatHand.filter(card => {
        const t = (card.def.Type || '').toLowerCase();
        return t.startsWith('combat action') || t.startsWith('combat event');
      });
      const randomCard = eligible.length
        ? eligible[Math.floor(Math.random() * eligible.length)] : null;
      EventLog.record('FORCED_RANDOM_PLAY', { who, card: randomCard ? randomCard.name : '(none)' });
      playCombatCard(who, randomCard);
      break;
    }
    case 'PLAY_PACK_ACTION':
      playPackActionCard(who, action.card);
      break;
    case 'JOIN_PACK_MEMBER': {
      const sel = c.packJoinSelection;
      sel.joined.push(action.inst);
      if (sel.mode === 'renownCap') sel.renownCap -= num(action.inst.def.Renown);
      if (sel.mode === 'fixedCount') {
        sel.remainingCount--;
        if (sel.remainingCount <= 0) finalizePackJoinSelection();
      }
      break;
    }
    case 'FINISH_PACK_JOIN':
      finalizePackJoinSelection();
      break;
    case 'PASS_STEP':
      advancePausableStep();
      break;
    case 'ASSIGN_TARGET': {
      const q = c.targetingQueue;
      const isAttacker = who === c.attackerWho;
      const myQueue = isAttacker ? q.attackerQueue : q.defenderQueue;
      const p = myQueue.shift();
      p.targetInst = action.target;
      EventLog.record('TARGET_ASSIGNED', { who, participant: p.inst.name, target: action.target.name });
      q.turn = isAttacker ? c.defenderWho : c.attackerWho;
      advanceTargetingQueue();
      break;
    }
    case 'CONTINUE_REVEAL':
      if (!checkFeintOpportunity()) resolveBluffAndDamage();
      break;
    case 'PLAY_FEINT_FOLLOWUP':
      recordFeintDecision(who, action.card);
      if (!checkFeintOpportunity()) resolveBluffAndDamage();
      break;
    case 'DECLINE_FEINT':
      recordFeintDecision(who, null);
      if (!checkFeintOpportunity()) resolveBluffAndDamage();
      break;
    case 'WITHDRAW':
      endCombat('withdrawn');
      break;
    case 'CONTINUE_COMBAT':
      // Between-rounds (rule 6.1/6.5.8): a real pausable step now —
      // Bum Rush/Surprise Ally can be played here before the next
      // round actually starts. Auto-cascades straight to
      // startNextRound() if nobody has one, same as before Phase 4.
      beginPausableStep('betweenRounds', [c.attackerWho, c.defenderWho]);
      break;
  }
}

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

function cardName(c) { return c === 'pass' ? '(pass)' : c.name; }

// ── Targeting step (rule 6.7) ──────────────────────────────────
// "Each combat card played in the previous step is assigned a target.
// Where one side has pack combat, the opponent of the pack combat
// declares which creature his Combat Action(s) target." Read precisely:
// each side chooses the target for its OWN played card(s), from among
// the OPPOSING side's participants. That choice is trivial — nothing
// to actually decide, auto-assigned here — whenever the opposing side
// has exactly one participant (true of every combat that exists today,
// since no pack-joining card is wired in yet — Phase 4). It only
// becomes a genuine decision once the opposing side has 2+ participants.
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
function beginTargetingStep() {
  const c = GameState.combat;
  c.step = 'targeting';
  EventLog.record('COMBAT_STEP', { step: c.step });

  const attackerQueue = [];
  const defenderQueue = [];

  for (const p of c.attackerParticipants) {
    if (!p.card || p.card === 'pass') continue;
    const enemies = c.defenderParticipants;
    if (enemies.length === 1) p.targetInst = enemies[0].inst;
    else attackerQueue.push(p);
  }
  for (const p of c.defenderParticipants) {
    if (!p.card || p.card === 'pass') continue;
    const enemies = c.attackerParticipants;
    if (enemies.length === 1) p.targetInst = enemies[0].inst;
    else defenderQueue.push(p);
  }

  c.targetingQueue = { attackerQueue, defenderQueue, turn: c.attackerWho };
  advanceTargetingQueue();
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

  for (const tier of ['fast', 'normal', 'slow']) {
    // Per-owner death snapshot BEFORE this tier's plays resolve, so
    // same-tier cards still land together regardless of what else
    // resolves in the same tier.
    const deadAtStart = new Map();
    for (const play of plays) {
      if (!deadAtStart.has(play.owner)) deadAtStart.set(play.owner, isDead(play.owner));
    }
    for (const play of plays) {
      if (play.speed !== tier) continue;
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
  // instead of the normal combat discard pile.
  checkCombatDeaths(killingBlowFor);

  // Discard played cards. Iterates plays[] — captured above, before
  // any deaths this round remove participants from the arrays — so
  // every card actually played this round gets discarded (unless
  // redirected to a Victory Pile by Telling Blow, or already attached
  // to a target as a damage card), regardless of whether the creature
  // that played it is now dead. This one loop replaces what used to
  // be four separate calls (attacker/defender card + feint), since
  // plays[] already has every participant's cards, not just the alphas'.
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

function discardPlayedCard(who, card) {
  if (!card || card === 'pass') return;
  if (card.zone === 'victoryPile') return; // Telling Blow's bonus already redirected it here — don't also discard it
  discardCombat(getPlayer(who), card);
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

// ── Round progression ──────────────────────────────────────────
function startNextRound() {
  const c = GameState.combat;

  // Bum Rush's one-round joiners leave here, before the new round's
  // state is set up — see resolveExpiredPackActions().
  resolveExpiredPackActions('round');

  c.round++;
  c.feintDeciderWho = null;
  c.step = 'playCard';

  // Reset every SURVIVING participant's per-round state directly —
  // not via the legacy c.attackerCard=null setters, which only ever
  // touch the primary (alpha-or-stand-in) participant and would
  // silently leave a packmate's stale .card from last round in place,
  // making playCombatCard() wrongly think they'd already acted this
  // round. 'nextRound'-scoped temp mods (e.g. Off-balanced Attack,
  // Vital Blow) are pruned in the same pass.
  for (const p of [...c.attackerParticipants, ...c.defenderParticipants]) {
    p.card = null;
    p.feintCard = null;
    p.feintDecided = false;
    pruneExpiredRoundMods(p.inst);
  }

  EventLog.record('COMBAT_STEP', { step: c.step, round: c.round });
}

function endCombat(reason) {
  const c = GameState.combat;
  c.ended = true;

  // Any pack-join cards still "in play" (Hunting Party/Pack Defense/
  // Surprise Ally — anything permanent for the combat, since Bum Rush
  // already resolved its own round-scoped expiry in startNextRound())
  // finally discard for real now that combat itself is over.
  resolveExpiredPackActions('combat');

  // 'endOfCombat'-scoped temp mods (e.g. Broken Limb, Nerve Cluster)
  // have no other expiry check of their own — this is the only place
  // that ever clears them. Must run for every reason combat can end,
  // not just a clean withdrawal, or a debuff could bleed into whatever
  // combat this creature enters next. Runs over every SURVIVING
  // participant on both sides — dead ones already left the arrays in
  // checkCombatDeaths() and have no future combat for a mod to bleed
  // into anyway.
  for (const p of [...c.attackerParticipants, ...c.defenderParticipants]) {
    clearEndOfCombatMods(p.inst);
  }
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
