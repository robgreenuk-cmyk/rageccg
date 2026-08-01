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
import { onDamageResolved, cardHasTriggerType } from './cardEngine.js';

const COMBAT_STEPS = [
  'declaration', 'preCombat', 'beginCombat',
  'playCard', 'targeting', 'reveal', 'reveal-feint', 'bluff', 'resolution',
  'withdrawal', 'betweenRounds',
];

// ── Start combat ──────────────────────────────────────────────
function declareAttack(attackerWho, attacker, target) {
  const defenderWho = target.owner ?? opponent(attackerWho);

  // Declaring an attack IS the alpha's one action for this Combat
  // Phase (rule 2.2.6: an alpha may do ONE of the listed alpha
  // actions, including "attack any other alpha" / "attack any Enemy
  // or Victim"). Set here, the single authoritative place an attack
  // actually starts, regardless of what called it.
  getPlayer(attackerWho).alphaActedThisCombatPhase = true;

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
    // Feint (rule 6.8.1): an optional follow-up card played face-up
    // during the Reveal step's mini-step, AFTER seeing the opponent's
    // already-revealed card. Only ever set if the side's normal card
    // this round has the feintOnReveal ability — see checkFeintOpportunity().
    attackerFeintCard:    null,
    defenderFeintCard:    null,
    attackerFeintDecided: false,
    defenderFeintDecided: false,
    feintDeciderWho:      null,
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

    const actorInst = isAttacker ? c.attacker : c.defender;

    // Forced/restricted play (rule 6.6.6): checked in order of how
    // total the restriction is. cannotPlayCombatAction (Head Wound,
    // Overextended Attack) forbids ANY combat card this round — takes
    // priority over forcedRandomPlay (Eyes Gouged), which still forces
    // a card, just not one the player chooses.
    if (hasActiveFlag(actorInst, 'cannotPlayCombatAction')) {
      actions.push({ type: 'PASS_COMBAT_CARD', label: 'Play nothing this round (wounded)' });
      return actions;
    }
    if (hasActiveFlag(actorInst, 'forcedRandomPlay')) {
      actions.push({ type: 'FORCED_RANDOM_PLAY', label: 'Forced random attack (blinded)' });
      return actions;
    }

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
      startNextRound();
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

  // Rule 6.3: "no creature played a Combat Action during the current
  // combat round" ends combat on its own — a separate condition from
  // the attacker choosing to withdraw. Captured BEFORE the bluff
  // check below, since a played-but-illegal card still counts as
  // having been played (it just fails); only an actual pass on both
  // sides counts as nobody playing anything. A Feint follow-up can
  // only exist if its side's normal card was itself Feint (not a
  // pass), so it never affects this check either way.
  const nobodyPlayedAnything = c.attackerCard === 'pass' && c.defenderCard === 'pass';

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
  // A Feint follow-up is a brand new Combat Action in its own right —
  // it can still turn out to be a bluff even though Feint itself
  // already passed its own, stricter legality check in canFeint().
  if (c.attackerFeintCard && !isLegalCombatCard(c.attacker, c.attackerFeintCard)) {
    EventLog.record('ILLEGAL_CARD_DISCARDED', { who: c.attackerWho, card: cardName(c.attackerFeintCard) });
    c.attackerFeintCard = null;
  }
  if (c.defenderFeintCard && !isLegalCombatCard(c.defender, c.defenderFeintCard)) {
    EventLog.record('ILLEGAL_CARD_DISCARDED', { who: c.defenderWho, card: cardName(c.defenderFeintCard) });
    c.defenderFeintCard = null;
  }

  EventLog.record('COMBAT_STEP', { step: 'resolution' });
  c.step = 'resolution';

  // Every card actually landing this round — normally one per side,
  // or two for a side that played Feint and followed up. Modeled as a
  // flat list rather than fixed attacker/defender slots so Feint's
  // extra card flows through the SAME speed-tier/dodge/death logic as
  // everything else, with no separate code path of its own.
  const plays = [];
  const addPlay = (ownerWho, owner, opponent, card) => {
    if (!card || card === 'pass') return;
    plays.push({ ownerWho, owner, opponent, card, speed: cardSpeed(card) });
  };
  addPlay(c.attackerWho, c.attacker, c.defender, c.attackerCard);
  addPlay(c.attackerWho, c.attacker, c.defender, c.attackerFeintCard);
  addPlay(c.defenderWho, c.defender, c.attacker, c.defenderCard);
  addPlay(c.defenderWho, c.defender, c.attacker, c.defenderFeintCard);

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

  // Discard played cards
  discardPlayedCard(c.attackerWho, c.attackerCard);
  discardPlayedCard(c.defenderWho, c.defenderCard);
  if (c.attackerFeintCard) discardPlayedCard(c.attackerWho, c.attackerFeintCard);
  if (c.defenderFeintCard) discardPlayedCard(c.defenderWho, c.defenderFeintCard);

  if (c.ended) return;

  // Run Like Hell / Forceful Wind: both force combat to end right
  // here, bypassing the normal withdrawal step entirely — checked
  // directly via the marker tag (not onDamageDealt, since Run Like
  // Hell has no Damage value and would never reach applyDamage() at
  // all). Checked across every card played this round, including a
  // Feint follow-up, though neither of these cards is a plausible
  // follow-up target in practice.
  const endsCombatCard = [c.attackerCard, c.attackerFeintCard, c.defenderCard, c.defenderFeintCard]
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
function checkCombatDeaths(killingBlowFor) {
  const c = GameState.combat;

  const attackerDead = isDead(c.attacker);
  const defenderDead = isDead(c.defender);

  if (defenderDead) {
    const killer = getPlayer(c.attackerWho);
    moveToVictoryPile(killer, c.defender);
    EventLog.record('COMBAT_KILL', { killer: c.attackerWho, victim: c.defender.name });
    awardKillingBlowBonus(killer, killingBlowFor?.get(c.defender));
  }
  if (attackerDead) {
    const killer = getPlayer(c.defenderWho);
    moveToVictoryPile(killer, c.attacker);
    EventLog.record('COMBAT_KILL', { killer: c.defenderWho, victim: c.attacker.name });
    awardKillingBlowBonus(killer, killingBlowFor?.get(c.attacker));
  }

  if (attackerDead || defenderDead) {
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
  c.round++;
  c.attackerCard = null;
  c.defenderCard = null;
  c.attackerFeintCard    = null;
  c.defenderFeintCard    = null;
  c.attackerFeintDecided = false;
  c.defenderFeintDecided = false;
  c.feintDeciderWho      = null;
  c.step = 'playCard';
  // 'nextRound'-scoped temp mods (e.g. Off-balanced Attack, Vital Blow)
  // were only ever meant to last one round — see game.js's
  // pruneExpiredRoundMods() for exactly which window they're valid in.
  pruneExpiredRoundMods(c.attacker);
  pruneExpiredRoundMods(c.defender);
  EventLog.record('COMBAT_STEP', { step: c.step, round: c.round });
}

function endCombat(reason) {
  const c = GameState.combat;
  c.ended = true;
  // 'endOfCombat'-scoped temp mods (e.g. Broken Limb, Nerve Cluster)
  // have no other expiry check of their own — this is the only place
  // that ever clears them. Must run for every reason combat can end,
  // not just a clean withdrawal, or a debuff could bleed into whatever
  // combat this creature enters next.
  clearEndOfCombatMods(c.attacker);
  clearEndOfCombatMods(c.defender);
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
