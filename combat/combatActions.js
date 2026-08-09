// ═══════════════════════════════════════════════════════════════
// combatActions.js — The two public entry points every other file
// actually calls: getCombatRoundActions() (what can whoever act on
// right now do) and performCombatAction() (do it). This is the
// coordination layer — it routes to every other combat/*.js module
// depending on the current step, but contains no game-rule logic of
// its own.
// ═══════════════════════════════════════════════════════════════
import {
  GameState, EventLog, getPlayer, opponent, drawCombat, num, hasActiveFlag,
} from '../game.js';
import { cardHasTriggerType, getTrigger } from '../cardEngine.js';
import { stepMatches, isGeneralPackActionStep } from './combatState.js';
import { eligiblePackLinks, eligiblePackMembers, playPackActionCard, getPackJoinSelectionActions, finalizePackJoinSelection } from './combatPackJoin.js';
import { beginPausableStep, advancePausableStep, endCombat } from './combatLifecycle.js';
import { advanceTargetingQueue } from './combatTargeting.js';
import { recordFeintDecision, checkFeintOpportunity, playCombatCard } from './combatCards.js';
import { resolveBluffAndDamage, advanceDamageOrder, advanceDeathBlowQueue, playDeathBlowRedirect } from './combatResolution.js';

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
    if (isGeneralPackActionStep(c.step)) {
      for (const { link, partner } of eligiblePackLinks(who, side)) {
        actions.push({
          type: 'JOIN_LINKED_PACKMATE', link, partner,
          label: `Bring in ${partner.name} (linked by ${link.grantedBy})`,
        });
      }
    }
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

  if (c.step === 'damageOrder') {
    const ctx = c.damageOrderContext;
    const group = ctx.pendingGroups[0];
    const ownerWho = group[0].ownerWho; // all plays in a group share an owner — see resolveTier()
    if (who !== ownerWho) return [{ type: 'WAITING', label: 'Waiting for opponent to choose blow order…' }];
    const remaining = group.filter(p => !ctx.orderedSoFar.includes(p));
    return remaining.map(p => ({
      type: 'CHOOSE_DAMAGE_ORDER', play: p,
      label: `Resolve ${p.card.name} (${p.owner.name} → ${p.opponent.name}) next`,
    }));
  }

  if (c.step === 'deathBlow') {
    const entry = c.deathBlowQueue[0];
    if (!entry) return [{ type: 'WAITING', label: 'Resolving…' }];
    if (who !== entry.who) return [{ type: 'WAITING', label: 'Waiting for opponent…' }];
    const card = getPlayer(who).combatHand.find(cd => cardHasTriggerType(cd, 'deathBlowRedirect'));
    const actions = [];
    if (card) {
      for (const sub of eligiblePackMembers(entry.who, entry.side)) {
        actions.push({
          type: 'PLAY_DEATH_BLOW', card, dyingInst: entry.participant.inst, substituteInst: sub,
          label: `Play ${card.name}: ${sub.name} takes the mortal wound instead of ${entry.participant.inst.name}`,
        });
      }
    }
    actions.push({ type: 'PASS_STEP', label: `Let ${entry.participant.inst.name} die` });
    return actions;
  }

  if (c.step === 'targeting') {
    const q = c.targetingQueue;
    if (!q) return [{ type: 'WAITING', label: 'Resolving targets…' }];
    if (who !== q.turn) return [{ type: 'WAITING', label: 'Waiting for opponent to assign targets…' }];
    const myQueue = who === c.attackerWho ? q.attackerQueue : q.defenderQueue;
    const entry = myQueue[0];
    if (!entry) return [{ type: 'WAITING', label: 'Waiting for opponent to assign targets…' }];
    return entry.enemies.map(e => ({
      type: 'ASSIGN_TARGET', target: e.inst,
      label: `${entry.participant.inst.name}'s card targets ${e.inst.name}`,
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
    case 'JOIN_LINKED_PACKMATE': {
      const side = who === c.attackerWho ? 'attacker' : 'defender';
      const participants = side === 'attacker' ? c.attackerParticipants : c.defenderParticipants;
      participants.push({
        inst: action.partner, ownerWho: who, role: 'packmember',
        card: null, feintCard: null, feintDecided: false, targetInst: null,
      });
      const ps = getPlayer(who);
      if (action.link.bonusCards > 0) drawCombat(ps, action.link.bonusCards);
      // The Gift itself already discarded when it was played (out of
      // combat, earlier this turn) — this consumes the LINK, since its
      // "if these characters enter combat" condition has now happened.
      ps.packLinks = (ps.packLinks || []).filter(l => l !== action.link);
      EventLog.record('PACK_LINK_JOINED', { who, partner: action.partner.name, grantedBy: action.link.grantedBy });
      break;
    }
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
    case 'CHOOSE_DAMAGE_ORDER':
      c.damageOrderContext.orderedSoFar.push(action.play);
      advanceDamageOrder();
      break;
    case 'PLAY_DEATH_BLOW':
      playDeathBlowRedirect(who, action.card, action.dyingInst, action.substituteInst);
      advanceDeathBlowQueue();
      break;
    case 'PASS_STEP':
      if (c.step === 'deathBlow') advanceDeathBlowQueue();
      else advancePausableStep();
      break;
    case 'ASSIGN_TARGET': {
      const q = c.targetingQueue;
      const isAttacker = who === c.attackerWho;
      const myQueue = isAttacker ? q.attackerQueue : q.defenderQueue;
      const entry = myQueue.shift();
      entry.participant.targetInst = action.target;
      EventLog.record('TARGET_ASSIGNED', { who, participant: entry.participant.inst.name, target: action.target.name });
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

export {
  getCombatRoundActions, performCombatAction,
};
