// ═══════════════════════════════════════════════════════════════
// turnManager.js — Phase sequencing and legal action queries.
// No DOM. The renderer calls getLegalActions() to build buttons,
// and calls performAction() to execute a player's choice.
// ═══════════════════════════════════════════════════════════════

import {
  GameState, EventLog, getPlayer, opponent,
  drawSept, drawCombat, discardSept, discardCombat,
  effectiveRenown, effectiveRage, effectiveGnosis, effectiveHealth,
  totalDamage, isDead, regenerate, checkFlipFromDamage,
  moveToVictoryPile, removeFrom, checkWinCondition, num, shuffle,
} from './game.js';

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
      target.attachments.push(cardInstance);
      EventLog.record('EQUIP', { who, card: cardInstance.name, target: target.name });
    }

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
  // Simplified V1: no automatic Junta resolution yet.
  // Calling/voting handled via legal actions.
}

function doCallMoot(who, cardInstance) {
  const ps = getPlayer(who);
  removeFrom(ps.septHand, cardInstance);
  cardInstance.zone = 'activeJunta';
  GameState.globalEffects.push(cardInstance);
  EventLog.record('CALL_MOOT', { who, card: cardInstance.name });
}

// ── COMBAT ────────────────────────────────────────────────────
function enterCombat() {
  // Auto-select highest-renown character as alpha for both sides
  GameState.player.alpha   = selectBestAlpha(GameState.player.pack);
  GameState.opponent.alpha = selectBestAlpha(GameState.opponent.pack);

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
        }
      });
      actions.push({ type: 'ADVANCE_PHASE', label: 'End Moot Phase' });
      break;

    case 'combat':
      actions.push(...getCombatActions(who));
      break;
  }

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
    return [{ type: 'ADVANCE_PHASE', label: 'No alpha available — end turn' }];
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
      break;
    case 'PLAY_RESOURCE':
      doPlayResource(who, action.card);
      break;
    case 'PLAY_EQUIPMENT':
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
    case 'DECLARE_ATTACK':
      // Defer to combat.js — exported separately
      return { deferToCombat: true, attacker: action.attacker, target: action.target };
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
