// ═══════════════════════════════════════════════════════════════
// turnManager.js — Phase sequencing and legal action queries.
// No DOM. The renderer calls getLegalActions() to build buttons,
// and calls performAction() to execute a player's choice.
// ═══════════════════════════════════════════════════════════════

import {
  GameState, EventLog, getPlayer, opponent,
  drawSept, drawCombat, discardSept, discardCombat,
  effectiveRenown, effectiveRage, effectiveGnosis, effectiveHealth,
  effectiveVotingRenown,
  totalDamage, isDead, regenerate, checkFlipFromDamage,
  moveToVictoryPile, removeFrom, checkWinCondition, num, shuffle,
} from './game.js';
import {
  getGrantedActions, performCardEffectAction, onCardEnteredPlay,
  getTargetRequirement, getTargetCandidates, processPhaseReturns,
  onMootResolved, checkPlayCondition,
} from './cardEngine.js';

const PHASES = ['redraw', 'regen', 'resource', 'umbra', 'moot', 'combat'];

// ── Phase entry points ────────────────────────────────────────
// Each phase has an automatic (closed play) part that runs
// immediately, then opens up to legal player actions.

function enterPhase(phase) {
  GameState.phase        = phase;
  GameState.isClosedPlay = true;
  EventLog.record('ENTER_PHASE', { phase });

  switch (phase) {
    case 'redraw':   enterRedraw();   break;
    case 'regen':    enterRegen();    break;
    case 'resource': enterResource(); break;
    case 'umbra':    enterUmbra();    break;
    case 'moot':     enterMoot();     break;
    case 'combat':   enterCombat();   break;
  }

  GameState.isClosedPlay = false;  // open play begins after auto steps
}

// ── REDRAW ────────────────────────────────────────────────────
function enterRedraw() {
  processPhaseReturns('redraw');
  // Combat hand auto-refills every redraw phase
  drawCombat(GameState.player,   GameState.player.combatHandSize);
  drawCombat(GameState.opponent, GameState.opponent.combatHandSize);
  // Sept hand: player chooses what to discard via legal actions,
  // then we auto-draw back up to hand size once they pass.
}

// Player explicitly discards 0+ sept cards, then redraws
function doRedrawDiscard(who, cardInstances) {
  const ps = getPlayer(who);
  cardInstances.forEach(c => discardSept(ps, c));
  drawSept(ps, ps.septHandSize);
  EventLog.record('REDRAW_DONE', { who, discarded: cardInstances.length });
}

// ── REGENERATION ──────────────────────────────────────────────
function enterRegen() {
  processPhaseReturns('regen');
  [...GameState.player.pack, ...GameState.opponent.pack].forEach(c => {
    if (c.def.Type?.startsWith('Character')) regenerate(c);
  });
  [...GameState.player.allies, ...GameState.opponent.allies].forEach(a => {
    // Allies regenerate only if their creature class allows it —
    // simplified: assume Keywords contains "(regenerates)" or it's a
    // standard shapeshifter type. Full creature-class table is a v2 task.
    const kw = (a.def.Keywords || '').toLowerCase();
    if (kw.includes('regenerat')) regenerate(a);
  });
}

// ── RESOURCE ──────────────────────────────────────────────────
function enterResource() {
  // No automatic actions — players play resources/allies/equipment
  // during open play. Handled via legal actions below.
}

function doPlayResource(who, cardInstance, target = null) {
  const ps  = getPlayer(who);
  const def = cardInstance.def;
  const t   = (def.Type || '').toLowerCase();

  removeFrom(ps.septHand, cardInstance);

  if (t.startsWith('ally')) {
    cardInstance.zone = 'pack';
    ps.allies.push(cardInstance);
    EventLog.record('PLAY_ALLY', { who, card: cardInstance.name });

  } else if (t.startsWith('equipment')) {
    if (target) {
      cardInstance.zone = 'attached';
      cardInstance.attachedTo = target;
      target.attachments.push(cardInstance);
      EventLog.record('EQUIP', { who, card: cardInstance.name, target: target.name });
    }

  } else if (t.startsWith('gift')) {
    if (target && !target.attachedTo) {
      cardInstance.zone = 'attached';
      cardInstance.attachedTo = target;
      target.attachments.push(cardInstance);
      EventLog.record('LEARN_GIFT', { who, card: cardInstance.name, target: target.name });
    } else if (target) {
      // Target is itself an attached card (e.g. Banishment targeting a Gift
      // in play), not a character — this Gift doesn't attach anywhere; it
      // resolves its onPlay effect against the target and discards itself.
      cardInstance.zone = 'resolving';
      EventLog.record('PLAY_GIFT', { who, card: cardInstance.name, targetCard: target.name });
    }

  } else if (t.startsWith('past life')) {
    if (target) {
      cardInstance.zone = 'attached';
      cardInstance.attachedTo = target;
      target.attachments.push(cardInstance);
      EventLog.record('AWAKEN_PAST_LIFE', { who, card: cardInstance.name, target: target.name });
    }

  } else if (t.startsWith('event')) {
    if (target) {
      cardInstance.zone = 'attached';
      cardInstance.attachedTo = target;
      target.attachments.push(cardInstance);
      EventLog.record('PLAY_EVENT', { who, card: cardInstance.name, target: target.name });
    } else {
      cardInstance.zone = 'event';
      ps.resources.events.push(cardInstance);
      EventLog.record('PLAY_EVENT', { who, card: cardInstance.name });
    }

  } else if (t.startsWith('rite')) {
    // Rites resolve against their target rather than attaching to it — an
    // ally being promoted isn't something to attach onto, unlike Event's
    // character targets.
    cardInstance.zone = 'resolving';
    EventLog.record('PLAY_RITE', { who, card: cardInstance.name, target: target?.name });

  } else if (t.startsWith('caern')) {
    cardInstance.zone = 'caern';
    ps.resources.caerns = [cardInstance]; // only one caern at a time
    EventLog.record('PLAY_CAERN', { who, card: cardInstance.name });

  } else if (t.startsWith('territory') || t.startsWith('realm')) {
    cardInstance.zone = 'territory';
    ps.resources.territories.push(cardInstance);
    EventLog.record('PLAY_TERRITORY', { who, card: cardInstance.name });

  } else {
    // Generic resource fallback
    cardInstance.zone = 'resource';
    ps.resources.caerns.push(cardInstance);
    EventLog.record('PLAY_RESOURCE', { who, card: cardInstance.name });
  }

  onCardEnteredPlay(who, cardInstance, target);
}

// Bring a Prey card (Enemy/Victim) into the Hunting Grounds
function doPlayPrey(who, cardInstance) {
  const ps = getPlayer(who);
  removeFrom(ps.septHand, cardInstance);
  cardInstance.zone = 'huntingGrounds';
  GameState.huntingGrounds.push(cardInstance);
  EventLog.record('PLAY_PREY', { who, card: cardInstance.name });
}

// ── UMBRA ─────────────────────────────────────────────────────
function enterUmbra() {
  // No automatic actions. Stepping sideways handled via legal actions.
}

function doStepSideways(who, cardInstance) {
  cardInstance.inUmbra = !cardInstance.inUmbra;
  EventLog.record('STEP_SIDEWAYS', {
    who, card: cardInstance.name, inUmbra: cardInstance.inUmbra
  });
}

// ── MOOT ──────────────────────────────────────────────────────
function enterMoot() {
  GameState.player.hadSuccessfulMootThisPhase   = false;
  GameState.opponent.hadSuccessfulMootThisPhase = false;
  // Calling/voting handled via legal actions.
}

function doCallMoot(who, cardInstance) {
  const ps = getPlayer(who);
  removeFrom(ps.septHand, cardInstance);
  cardInstance.zone = 'activeJunta';
  GameState.globalEffects.push(cardInstance);

  // Simplified voting model: calling pack's total voting Renown vs the
  // opponent's. The comprehensive rules' actual vote procedure isn't
  // available to check this against — documented simplification, not
  // an oversight (same standing as other V1 simplifications this session).
  const forRenown     = ps.pack.reduce((sum, c) => sum + effectiveVotingRenown(c), 0);
  const oppPs          = getPlayer(opponent(who));
  const againstRenown = oppPs.pack.reduce((sum, c) => sum + effectiveVotingRenown(c), 0);
  const passed          = forRenown > againstRenown;

  cardInstance.mootPassed = passed;
  if (passed) ps.hadSuccessfulMootThisPhase = true;
  onMootResolved(who, passed);
  EventLog.record('CALL_MOOT', { who, card: cardInstance.name, forRenown, againstRenown, passed });
}

// ── COMBAT ────────────────────────────────────────────────────
function enterCombat() {
  // A forced alpha (e.g. Carla Grimsson after a failed moot) overrides
  // normal selection, for this Combat Phase only.
  const forcedPlayer   = GameState.player.pack.find(c => c.forcedAlpha);
  const forcedOpponent = GameState.opponent.pack.find(c => c.forcedAlpha);

  // Per rule 2.2.6, alpha is a real player choice made fresh every Combat
  // Phase (any Character or Ally, not necessarily highest Renown) — so we
  // reset to null here and require an explicit SELECT_ALPHA action via
  // getCombatActions(), unless a card effect has forced a specific alpha.
  GameState.player.alpha = forcedPlayer || null;
  if (forcedPlayer) forcedPlayer.forcedAlpha = false;

  // The CPU opponent keeps the existing highest-Renown auto-selection —
  // documented V1 simplification, unaffected by the player-choice change.
  GameState.opponent.alpha = forcedOpponent || selectBestAlpha(GameState.opponent.pack);
  if (forcedOpponent) forcedOpponent.forcedAlpha = false;

  if (GameState.player.alpha)
    EventLog.record('ALPHA_SELECTED', { who: 'player', card: GameState.player.alpha.name });
  if (GameState.opponent.alpha)
    EventLog.record('ALPHA_SELECTED', { who: 'opponent', card: GameState.opponent.alpha.name });
}

function selectBestAlpha(pack) {
  const eligible = pack.filter(c => !c.inUmbra);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, c) =>
    effectiveRenown(c) > effectiveRenown(best) ? c : best
  );
}

function setAlpha(who, cardInstance) {
  const ps = getPlayer(who);
  if (!ps.pack.includes(cardInstance)) return false;
  ps.alpha = cardInstance;
  EventLog.record('ALPHA_SELECTED', { who, card: cardInstance.name, manual: true });
  return true;
}

// ── LEGAL ACTIONS ──────────────────────────────────────────────
// The single most important function: given the current state,
// what can the active player legally do right now?
// Returns an array of action descriptors the UI can render as buttons.

function getLegalActions(who) {
  const ps    = getPlayer(who);
  const phase = GameState.phase;
  const actions = [];

  switch (phase) {

    case 'redraw':
      ps.septHand.forEach(card => {
        actions.push({ type: 'DISCARD_SEPT', card, label: `Discard ${card.name}` });
      });
      actions.push({ type: 'END_REDRAW', label: 'Keep hand & continue' });
      break;

    case 'regen':
      // Fully automatic — only advance
      actions.push({ type: 'ADVANCE_PHASE', label: 'Continue' });
      break;

    case 'resource':
      ps.septHand.forEach(card => {
        const t = (card.def.Type || '').toLowerCase();
        if (t.startsWith('ally') || t.startsWith('caern') ||
            t.startsWith('territory') || t.startsWith('realm')) {
          actions.push({ type: 'PLAY_RESOURCE', card, label: `Play ${card.name}` });
        } else if (t.startsWith('equipment')) {
          ps.pack.concat(ps.allies).forEach(target => {
            actions.push({
              type: 'PLAY_EQUIPMENT', card, target,
              label: `Equip ${card.name} on ${target.name}`
            });
          });
        } else if (t.startsWith('gift')) {
          const targetReq = getTargetRequirement(card.def.Name);
          const candidates = targetReq ? getTargetCandidates(who, targetReq) : ps.pack.concat(ps.allies);
          candidates.forEach(target => {
            const label = target.attachedTo
              ? `Play ${card.name} on ${target.name} (held by ${target.attachedTo.name})`
              : `Teach ${card.name} to ${target.name}`;
            actions.push({ type: 'PLAY_GIFT', card, target, label });
          });
        } else if (t.startsWith('past life')) {
          const tribe = (card.def.Requires || '').trim();
          ps.pack
            .filter(target => !tribe || (target.def.Keywords || '').includes(tribe))
            .forEach(target => {
              actions.push({
                type: 'PLAY_PAST_LIFE', card, target,
                label: `Awaken ${card.name} in ${target.name}`
              });
            });
        } else if (t.startsWith('event')) {
          const targetReq = getTargetRequirement(card.def.Name);
          if (targetReq) {
            getTargetCandidates(who, targetReq).forEach(target => {
              actions.push({
                type: 'PLAY_EVENT', card, target,
                label: `Play ${card.name} on ${target.name}`
              });
            });
          } else {
            actions.push({ type: 'PLAY_EVENT', card, label: `Play ${card.name}` });
          }
        } else if (t.startsWith('enemy') || t.startsWith('victim')) {
          actions.push({ type: 'PLAY_PREY', card, label: `Bring ${card.name} into play` });
        }
      });
      actions.push({ type: 'ADVANCE_PHASE', label: 'End Resource Phase' });
      break;

    case 'umbra':
      ps.pack.forEach(c => {
        if (canStepSideways(c)) {
          actions.push({
            type: 'STEP_SIDEWAYS', card: c,
            label: `${c.inUmbra ? 'Return' : 'Step'} ${c.name} ${c.inUmbra ? 'from' : 'into'} Umbra`
          });
        }
      });
      actions.push({ type: 'ADVANCE_PHASE', label: 'End Umbra Phase' });
      break;

    case 'moot':
      ps.septHand.forEach(card => {
        const t = (card.def.Type || '').toLowerCase();
        if (t.startsWith('moot') || t.startsWith('board meeting')) {
          actions.push({ type: 'CALL_MOOT', card, label: `Call ${card.name}` });
        } else if (t.startsWith('rite') && checkPlayCondition(card.def.Name, who)) {
          const targetReq = getTargetRequirement(card.def.Name);
          const candidates = targetReq ? getTargetCandidates(who, targetReq) : [];
          candidates.forEach(target => {
            actions.push({ type: 'PLAY_RITE', card, target, label: `Play ${card.name} on ${target.name}` });
          });
        }
      });
      actions.push({ type: 'ADVANCE_PHASE', label: 'End Moot Phase' });
      break;

    case 'combat':
      actions.push(...getCombatActions(who));
      break;
  }

  // Card-granted actions (declarative "phaseAction" abilities, e.g.
  // Buggerhead's extra redraw). No-op for phases where no in-play
  // card has an ability registered — see cardEngine.js.
  actions.push(...getGrantedActions(who, phase));

  return actions;
}

function canStepSideways(cardInstance) {
  // Garou, Bastet, Other Fera can step sideways. Simplified check:
  // assume any Character can unless explicitly restricted (V2 refines this).
  return cardInstance.def.Type?.startsWith('Character');
}

function getCombatActions(who) {
  const ps  = getPlayer(who);
  const opp = getPlayer(opponent(who));
  const actions = [];

  if (GameState.combat) {
    // Already in a combat — defer to combat.js for round-by-round actions
    return [{ type: 'IN_COMBAT', label: 'Combat in progress…' }];
  }

  if (!ps.alpha) {
    const eligible = ps.pack.filter(c => !c.inUmbra);
    if (eligible.length === 0) {
      return [{ type: 'ADVANCE_PHASE', label: 'No alpha available — end turn' }];
    }
    // Rule 2.2.6: alpha is a real choice made fresh every Combat Phase —
    // offer every eligible pack member, don't auto-pick one.
    eligible.forEach(c => {
      actions.push({ type: 'SELECT_ALPHA', card: c, label: `Make ${c.name} your alpha` });
    });
    return actions;
  }

  // Alpha may: attack opponent's alpha, attack prey, pass
  if (opp.alpha) {
    actions.push({
      type: 'DECLARE_ATTACK', attacker: ps.alpha, target: opp.alpha,
      label: `${ps.alpha.name} attacks ${opp.alpha.name}`
    });
  }
  GameState.huntingGrounds.forEach(prey => {
    actions.push({
      type: 'DECLARE_ATTACK', attacker: ps.alpha, target: prey,
      label: `${ps.alpha.name} attacks ${prey.name}`
    });
  });

  actions.push({ type: 'PASS_ALPHA', label: `${ps.alpha.name} passes` });
  actions.push({ type: 'ADVANCE_PHASE', label: 'End Combat Phase' });

  return actions;
}

// ── PERFORM ACTION ────────────────────────────────────────────
// Single entry point — takes an action descriptor (as returned by
// getLegalActions) and applies it to GameState.

function performAction(who, action) {
  switch (action.type) {
    case 'DISCARD_SEPT':
      doRedrawDiscard(who, [action.card]);
      break;
    case 'END_REDRAW':
      doRedrawDiscard(who, []);
      nextPhase(); // "Keep hand & continue" — bug fix: this used to redraw
                   // but never actually advance the phase, so Redraw had no
                   // way forward. Every other phase's own end-action already
                   // calls nextPhase(); this brings Redraw in line with them.
      break;
    case 'PLAY_RESOURCE':
      doPlayResource(who, action.card);
      break;
    case 'PLAY_EQUIPMENT':
      doPlayResource(who, action.card, action.target);
      break;
    case 'PLAY_GIFT':
      doPlayResource(who, action.card, action.target);
      break;
    case 'PLAY_PAST_LIFE':
      doPlayResource(who, action.card, action.target);
      break;
    case 'PLAY_EVENT':
      doPlayResource(who, action.card, action.target);
      break;
    case 'PLAY_RITE':
      doPlayResource(who, action.card, action.target);
      break;
    case 'PLAY_PREY':
      doPlayPrey(who, action.card);
      break;
    case 'STEP_SIDEWAYS':
      doStepSideways(who, action.card);
      break;
    case 'CALL_MOOT':
      doCallMoot(who, action.card);
      break;
    case 'CARD_EFFECT':
      performCardEffectAction(action);
      break;
    case 'DECLARE_ATTACK':
      // Defer to combat.js — exported separately
      return { deferToCombat: true, attacker: action.attacker, target: action.target };
    case 'SELECT_ALPHA':
      setAlpha(who, action.card);
      break;
    case 'PASS_ALPHA':
      EventLog.record('ALPHA_PASS', { who });
      break;
    case 'ADVANCE_PHASE':
      nextPhase();
      break;
  }
  checkWinCondition();
  return { deferToCombat: false };
}

// ── ADVANCE PHASE ──────────────────────────────────────────────
function nextPhase() {
  const idx = PHASES.indexOf(GameState.phase);
  const nextIdx = (idx + 1) % PHASES.length;

  if (nextIdx === 0) {
    GameState.turn++;
    clearTurnModifiers();
    EventLog.record('NEW_TURN', { turn: GameState.turn });
  }

  enterPhase(PHASES[nextIdx]);
  return GameState.phase;
}

function clearTurnModifiers() {
  [...GameState.player.pack, ...GameState.opponent.pack].forEach(c => {
    c.rageMod = 0; c.gnosisMod = 0; c.healthMod = 0; c.renownMod = 0;
    c.tapped  = false;
  });
}

// ── Public API ────────────────────────────────────────────────
export {
  PHASES, enterPhase, nextPhase,
  getLegalActions, performAction,
  setAlpha, selectBestAlpha,
  doRedrawDiscard, doPlayResource, doPlayPrey,
  doStepSideways, doCallMoot,
};
