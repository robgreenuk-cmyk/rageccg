// ═══════════════════════════════════════════════════════════════
// combatLifecycle.js — declareAttack, round progression, withdrawal,
// combat start/end, and the pausable-step machine that drives
// Declaration → Pre-Combat → Begin-of-Combat → Play Card and
// Between-rounds → next round (rule 6.1).
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog, getPlayer, opponent, pruneExpiredRoundMods, clearEndOfCombatMods,
} from '../game.js';
import { primaryParticipant } from './combatState.js';
import { sideHasEligiblePackJoin, resolveExpiredPackActions } from './combatPackJoin.js';

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
    // Rule 6.6.1 blow-order choice — see resolveTier()/advanceDamageOrder().
    damageOrderContext: null,
    // Reactive Taking the Death Blow queue — see checkForDeathBlowOpportunities().
    deathBlowQueue: null,
    pendingDeathBlowContext: null,
    // Shieldmate-created groups — see finishPackJoin()/findShieldmateGroup()
    // in the targeting step. Empty for every combat that doesn't involve it.
    shieldmateGroups: [],
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

export {
  declareAttack, beginPausableStep, autoAdvanceIfNothingToDecide, advanceToNextRealStep, advancePausableStep, startNextRound, endCombat,
};
