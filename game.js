// ═══════════════════════════════════════════════════════════════
// game.js — Pure game state. No DOM, no HTML.
// The renderer reads this; the engine writes it.
// ═══════════════════════════════════════════════════════════════

// ── Event log ─────────────────────────────────────────────────
// Every state change is recorded here for debugging / replay.
const EventLog = (() => {
  const _entries = [];

  function record(type, data = {}) {
    const entry = {
      id:    _entries.length,
      type,
      turn:  GameState.turn,
      phase: GameState.phase,
      ...data,
      ts: Date.now(),
    };
    _entries.push(entry);
    console.log(`[${entry.turn}.${entry.phase}] ${type}`, data);
    return entry;
  }

  function all()              { return [..._entries]; }
  function since(id)          { return _entries.slice(id); }
  function ofType(type)       { return _entries.filter(e => e.type === type); }
  function lastOfType(type)   { return [..._entries].reverse().find(e => e.type === type); }

  return { record, all, since, ofType, lastOfType };
})();

// ── Card instance factory ─────────────────────────────────────
// A card instance wraps a card definition with runtime state.
function makeCardInstance(def, owner) {
  return {
    // Identity
    instanceId: Math.random().toString(36).slice(2, 9),
    def,                          // reference to JSON card data
    name:       def.Name || def.name || 'Unknown',
    owner,                        // 'player' | 'opponent'

    // Zone tracking
    zone: null,                   // set when placed

    // Character runtime state
    isCrinos:   false,            // starts in breed form
    isDualForm:  isDualFormChar(def),

    // Damage
    damageCards: [],              // array of card instances on this creature
    aggravated:  [],              // indices into damageCards that are aggravated

    // Modifiers (cleared each turn)
    rageMod:    0,
    gnosisMod:  0,
    healthMod:  0,
    renownMod:  0,

    // Scoped temporary stat modifiers from combat cards (e.g. Broken
    // Limb, Nerve Cluster) — distinct from rageMod/staticMod above,
    // which have no expiry of their own. See applyTempStatMod().
    tempMods:   [],

    // Status flags
    tapped:     false,
    frenzied:   false,
    inUmbra:    false,

    // Attached cards (equipment, gifts etc.)
    attachments: [],
  };
}

function isDualFormChar(def) {
  // Single-form if: Metis breed, or only one ImageFile entry,
  // or breed Health === crinos Health with no CHealth override
  if (!def.Type?.startsWith('Character')) return false;
  const kw = def.Keywords || '';
  if (kw.includes('Metis')) return false;
  const img   = def.ImageFile || def.imageFile || '';
  const parts = img.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  // Both parts must be valid image paths
  return parts[1].startsWith('rage.image.');
}

// ── Stat helpers ──────────────────────────────────────────────
// Card-effect static modifiers (e.g. equipment that grants +1 Rage
// while its holder is in Crinos form) plug in here without game.js
// importing cardEngine.js — cardEngine calls registerStatHook() once
// at startup instead. Keeps the dependency one-directional.
let _statHook = null;
function registerStatHook(fn) { _statHook = fn; }
function staticMod(inst, stat) { return _statHook ? _statHook(inst, stat) : 0; }

function effectiveRage(inst) {
  const base = inst.isCrinos ? num(inst.def.CRage)   || num(inst.def.Rage)
                             : num(inst.def.Rage);
  const active = activeTempMods(inst, 'rage');
  const sets = active.filter(m => m.mode === 'set');
  // "Considered to have a Rage of X" (Nerve Cluster, Vital Blow) is a
  // full override, not a further addition — printed Rage, rageMod and
  // staticMod are all superseded for this computation. If more than one
  // set-mod is somehow active at once, take the lowest: these are all
  // debuffs in the current card set, so the most restrictive one wins
  // rather than one silently masking the other.
  if (sets.length) return Math.max(0, Math.min(...sets.map(m => m.amount)));
  const delta = active.filter(m => m.mode === 'delta')
                       .reduce((sum, m) => sum + m.amount, 0);
  return Math.max(0, base + inst.rageMod + staticMod(inst, 'Rage') + delta);
}
function effectiveGnosis(inst) {
  const base = inst.isCrinos ? num(inst.def.CGnosis) || num(inst.def.Gnosis)
                             : num(inst.def.Gnosis);
  return Math.max(0, base + inst.gnosisMod + staticMod(inst, 'Gnosis'));
}
function effectiveHealth(inst) {
  const base = inst.isCrinos ? num(inst.def.CHealth) || num(inst.def.Health)
                             : num(inst.def.Health);
  return Math.max(1, base + inst.healthMod + staticMod(inst, 'Health'));
}
function effectiveRenown(inst) {
  return Math.max(0, num(inst.def.Renown) + inst.renownMod + staticMod(inst, 'Renown'));
}
// Separate from effectiveRenown — a character's standing in combat/VP terms
// isn't necessarily their standing in a moot vote. Reuses the same generic
// static-modifier dispatch with a different stat key; no engine changes
// needed for new VotingRenown cards, only cardEffects.json entries.
function effectiveVotingRenown(inst) {
  return Math.max(0, effectiveRenown(inst) + staticMod(inst, 'VotingRenown'));
}
function totalDamage(inst) {
  return inst.damageCards.reduce((s, d) => s + (num(d.def.Damage) || 1), 0);
}
function isDead(inst) {
  return totalDamage(inst) >= effectiveHealth(inst);
}

// ── GameState ─────────────────────────────────────────────────
const GameState = {
  // Turn / phase
  turn:   1,
  phase:  'redraw',   // redraw | regen | resource | umbra | moot | combat
  isClosedPlay: true, // true during the automatic portion of each phase

  // Players
  player:   null,     // PlayerState
  opponent: null,     // PlayerState

  // Shared zones
  huntingGrounds: [],   // prey in the shared area
  globalEffects:  [],   // events / totems in play globally

  // Active combat (null when not in combat)
  combat: null,

  // Game over
  winner:   null,     // 'player' | 'opponent' | 'tie' | null
  gameOver: false,

  // Renown level (victory target)
  renownLevel: 20,
};

// ── PlayerState factory ───────────────────────────────────────
function makePlayerState(who, characterDefs, septDefs, combatDefs) {
  const toInstances = defs => defs.map(d => makeCardInstance(d, who));
  return {
    who,                              // 'player' | 'opponent'

    // Zones
    pack:          toInstances(characterDefs),  // characters in play
    allies:        [],
    resources: {
      caerns:      [],
      territories: [],
      totems:      [],
      events:      [],
    },
    umbra:         [],                // characters currently in umbra
    hadSuccessfulMootThisPhase: false, // reset each time the Moot Phase is entered

    // Decks and hands
    septDeck:      shuffle(toInstances(septDefs)),
    combatDeck:    shuffle(toInstances(combatDefs)),
    septHand:      [],
    combatHand:    [],
    septDiscard:   [],
    combatDiscard: [],

    // Victory
    victoryPile:   [],

    // Current alpha (set at start of combat phase)
    alpha:         null,
    // True once this alpha has taken its alpha action this Combat
    // Phase. Rule 2.2.6: "As its alpha action, an alpha may do ONE
    // of the following" (attack, challenge, etc., or pass) — not a
    // repeatable loop. Reset to false each time Combat Phase begins.
    alphaActedThisCombatPhase: false,

    // Hand sizes (can be modified by cards)
    septHandSize:   5,
    combatHandSize: 5,
  };
}

// ── Initialise a new game ─────────────────────────────────────
function initGame(playerData, opponentData, renownLevel = 20) {
  GameState.turn          = 1;
  GameState.phase         = 'redraw';
  GameState.isClosedPlay  = true;
  GameState.huntingGrounds= [];
  GameState.globalEffects = [];
  GameState.combat        = null;
  GameState.winner        = null;
  GameState.gameOver      = false;
  GameState.renownLevel   = renownLevel;

  GameState.player   = makePlayerState('player',
    playerData.characters, playerData.sept, playerData.combat);
  GameState.opponent = makePlayerState('opponent',
    opponentData.characters, opponentData.sept, opponentData.combat);

  // Set zones on all instances
  setZones(GameState.player);
  setZones(GameState.opponent);

  // Draw initial hands
  drawSept(GameState.player,   GameState.player.septHandSize);
  drawSept(GameState.opponent, GameState.opponent.septHandSize);
  drawCombat(GameState.player,   GameState.player.combatHandSize);
  drawCombat(GameState.opponent, GameState.opponent.combatHandSize);

  EventLog.record('GAME_START', { renownLevel });
  return GameState;
}

function setZones(playerState) {
  playerState.pack.forEach(c       => { c.zone = 'pack'; });
  playerState.septDeck.forEach(c   => { c.zone = 'septDeck'; });
  playerState.combatDeck.forEach(c => { c.zone = 'combatDeck'; });
}

// ── Deck operations ───────────────────────────────────────────
function drawSept(playerState, count) {
  const toDraw = count ?? Math.max(0,
    playerState.septHandSize - playerState.septHand.length);
  for (let i = 0; i < toDraw; i++) {
    if (playerState.septDeck.length === 0) break;
    const card = playerState.septDeck.shift();
    card.zone  = 'septHand';
    playerState.septHand.push(card);
  }
}

function drawCombat(playerState, count) {
  const toDraw = count ?? Math.max(0,
    playerState.combatHandSize - playerState.combatHand.length);
  for (let i = 0; i < toDraw; i++) {
    if (playerState.combatDeck.length === 0) {
      if (playerState.combatDiscard.length === 0) break;
      playerState.combatDeck = shuffle(playerState.combatDiscard);
      playerState.combatDiscard = [];
    }
    const card = playerState.combatDeck.shift();
    card.zone  = 'combatHand';
    playerState.combatHand.push(card);
  }
}

function discardSept(playerState, cardInstance) {
  removeFrom(playerState.septHand, cardInstance);
  cardInstance.zone = 'septDiscard';
  playerState.septDiscard.push(cardInstance);
  EventLog.record('DISCARD_SEPT', { who: playerState.who, card: cardInstance.name });
}

function discardCombat(playerState, cardInstance) {
  removeFrom(playerState.combatHand, cardInstance);
  cardInstance.zone = 'combatDiscard';
  playerState.combatDiscard.push(cardInstance);
}

// ── Victory points ────────────────────────────────────────────
function countVP(playerState) {
  return playerState.victoryPile.reduce((sum, card) => {
    if (card.sideways) return sum;            // 0 VP
    if (card.faceDown) return sum + 1;        // face down = 1 VP
    return sum + num(card.def.Renown);
  }, 0);
}

function checkWinCondition() {
  const pvp = countVP(GameState.player);
  const ovp = countVP(GameState.opponent);
  const lvl = GameState.renownLevel;

  if (pvp >= lvl || ovp >= lvl) {
    if      (pvp > ovp) GameState.winner = 'player';
    else if (ovp > pvp) GameState.winner = 'opponent';
    else                GameState.winner = 'tie';
    GameState.gameOver = true;
    EventLog.record('GAME_OVER', { winner: GameState.winner, pvp, ovp });
  }
  // Also check: player has no characters left
  if (!GameState.gameOver && GameState.player.pack.length === 0) {
    GameState.winner   = 'opponent';
    GameState.gameOver = true;
    EventLog.record('GAME_OVER', { winner: 'opponent', reason: 'no_characters' });
  }
  if (!GameState.gameOver && GameState.opponent.pack.length === 0) {
    GameState.winner   = 'player';
    GameState.gameOver = true;
    EventLog.record('GAME_OVER', { winner: 'player', reason: 'no_characters' });
  }
  return GameState.gameOver;
}

// ── Form flipping ─────────────────────────────────────────────
function flipToCrinos(inst) {
  if (!inst.isDualForm || inst.isCrinos) return false;
  inst.isCrinos = true;
  EventLog.record('FLIP_CRINOS', { who: inst.owner, card: inst.name });
  return true;
}

function flipToBreed(inst) {
  if (!inst.isDualForm || !inst.isCrinos) return false;
  inst.isCrinos = false;
  EventLog.record('FLIP_BREED', { who: inst.owner, card: inst.name });
  return true;
}

// Flip to crinos if damage >= printed Rage OR >= breed Health
function checkFlipFromDamage(inst) {
  if (!inst.isDualForm || inst.isCrinos) return false;
  const dmg = totalDamage(inst);
  if (dmg >= num(inst.def.Rage) || dmg >= num(inst.def.Health)) {
    flipToCrinos(inst);
    return true;
  }
  return false;
}

// ── Regeneration ──────────────────────────────────────────────
function regenerate(inst) {
  // Remove the lowest non-aggravated damage card. `aggravated` holds the
  // instanceId of each aggravated damage card, NOT its position in
  // damageCards — positions shift every time an earlier card is healed
  // or removed, so an index-based record would silently end up pointing
  // at the wrong wound after any heal. See markLastDamageAggravated().
  const nonAgg = inst.damageCards
    .filter(c => !inst.aggravated.includes(c.instanceId))
    .sort((a, b) => (num(a.def.Damage)||1) - (num(b.def.Damage)||1));
  if (nonAgg.length === 0) return null;
  const healed = nonAgg[0];
  removeFrom(inst.damageCards, healed);
  if (inst.tempMods?.length) {
    inst.tempMods = inst.tempMods.filter(m =>
      !(m.expiry.type === 'untilThisWoundHealed' && m.expiry.woundId === healed.instanceId)
    );
  }
  EventLog.record('REGENERATE', { card: inst.name, healed: healed.name });
  return healed;
}

// Called by cardEngine's onDamageResolved() when a card's scripted
// ability (e.g. Fur Gnarl) determines the wound it just dealt should be
// aggravated. Marks the most recently pushed damage card, tracked by
// instanceId so the mark stays correctly attached even after other
// damage cards on this creature are later healed or removed.
function markLastDamageAggravated(inst) {
  const last = inst.damageCards[inst.damageCards.length - 1];
  if (!last) return;
  if (!inst.aggravated.includes(last.instanceId)) {
    inst.aggravated.push(last.instanceId);
    EventLog.record('MARK_AGGRAVATED', { card: inst.name, wound: last.name });
  }
}

// ── Scoped temporary stat modifiers ───────────────────────────
// For combat cards like Broken Limb ("-2 Rage for the duration of the
// combat") or Vital Blow ("Rage of 1 for the next round"): unlike
// rageMod/staticMod above, these carry their OWN expiry and are meant
// to be short-lived. `who` is whichever instance (self or victim) the
// scripted effect resolved; `stat` is currently always 'rage', but the
// shape doesn't assume that.
//
// expiry is one of:
//   'nextRound'            — valid only during the single combat round
//                             immediately following the one it was
//                             applied in; pruned by pruneExpiredRoundMods().
//   'endOfCombat'          — valid until the current combat ends; has
//                             no other expiry check of its own, so it
//                             MUST be swept by clearEndOfCombatMods()
//                             or it would never go away on its own.
//   'untilThisWoundHealed' — tied to the specific damage card that was
//                             just dealt; valid for exactly as long as
//                             that card instance remains in damageCards.
//                             No separate pruning needed — validity is
//                             just "is the wound still there" — though
//                             regenerate() also drops the record itself
//                             for hygiene once the wound is healed.
function applyTempStatMod(inst, { stat, mode, amount, expiry }) {
  let expiryDescriptor;
  if (expiry === 'nextRound') {
    expiryDescriptor = { type: 'nextRound',
                          expiresAfterRound: (GameState.combat?.round ?? 0) + 1 };
  } else if (expiry === 'endOfCombat') {
    expiryDescriptor = { type: 'endOfCombat' };
  } else if (expiry === 'untilThisWoundHealed') {
    const wound = inst.damageCards[inst.damageCards.length - 1];
    if (!wound) return; // nothing to tie the modifier to — refuse silently
    expiryDescriptor = { type: 'untilThisWoundHealed', woundId: wound.instanceId };
  } else {
    return; // unknown expiry type in cardEffects.json — refuse rather than guess
  }
  inst.tempMods.push({ stat, mode, amount, expiry: expiryDescriptor });
  EventLog.record('TEMP_STAT_MOD', { card: inst.name, stat, mode, amount, expiry: expiryDescriptor.type });
}

function isTempModActive(mod, inst) {
  if (mod.expiry.type === 'nextRound') {
    return !!(GameState.combat && GameState.combat.round === mod.expiry.expiresAfterRound);
  }
  if (mod.expiry.type === 'endOfCombat') {
    return true; // presence alone means active — see clearEndOfCombatMods()
  }
  if (mod.expiry.type === 'untilThisWoundHealed') {
    return inst.damageCards.some(c => c.instanceId === mod.expiry.woundId);
  }
  return false;
}

function activeTempMods(inst, stat) {
  return (inst.tempMods || []).filter(m => m.stat === stat && isTempModActive(m, inst));
}

// Called once per new combat round (see combat.js's startNextRound()).
// 'nextRound' mods are only ever meant to last through the exact round
// number they name — once GameState.combat.round has moved past that,
// drop them so the array doesn't grow for the rest of the game.
function pruneExpiredRoundMods(inst) {
  if (!inst?.tempMods?.length) return;
  const round = GameState.combat?.round;
  inst.tempMods = inst.tempMods.filter(m =>
    m.expiry.type !== 'nextRound' || round == null || round <= m.expiry.expiresAfterRound
  );
}

// Called once per participant when a combat ends (see combat.js's
// endCombat()). 'endOfCombat' mods have no other expiry check — see
// isTempModActive() above — so this is the ONLY thing that ever clears
// them; skipping it would let a debuff silently bleed into whatever
// combat that creature is in next.
function clearEndOfCombatMods(inst) {
  if (!inst?.tempMods?.length) return;
  inst.tempMods = inst.tempMods.filter(m => m.expiry.type !== 'endOfCombat');
}

// ── Zone moves ────────────────────────────────────────────────
function moveToVictoryPile(killerState, inst) {
  removeFromPlay(inst);
  inst.zone = 'victoryPile';
  killerState.victoryPile.push(inst);
  EventLog.record('KILL', { killer: killerState.who, victim: inst.name,
                             vp: num(inst.def.Renown) });
}

function removeFromPlay(inst) {
  const ps = inst.owner === 'player' ? GameState.player : GameState.opponent;
  removeFrom(ps.pack,   inst);
  removeFrom(ps.allies, inst);
  removeFrom(GameState.huntingGrounds, inst);
}

// ── Helpers ───────────────────────────────────────────────────
function removeFrom(arr, inst) {
  const i = arr.findIndex(c => c.instanceId === inst.instanceId);
  if (i !== -1) arr.splice(i, 1);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function num(v) { const n = parseInt(v); return isNaN(n) ? 0 : n; }

function getPlayer(who) {
  return who === 'player' ? GameState.player : GameState.opponent;
}
function opponent(who) { return who === 'player' ? 'opponent' : 'player'; }

// ── Public API ────────────────────────────────────────────────
export {
  GameState, EventLog,
  makeCardInstance, isDualFormChar,
  makePlayerState, initGame,
  drawSept, drawCombat, discardSept, discardCombat,
  effectiveRage, effectiveGnosis, effectiveHealth, effectiveRenown,
  effectiveVotingRenown,
  registerStatHook,
  totalDamage, isDead,
  flipToCrinos, flipToBreed, checkFlipFromDamage,
  regenerate, markLastDamageAggravated,
  applyTempStatMod, pruneExpiredRoundMods, clearEndOfCombatMods,
  moveToVictoryPile, removeFrom, removeFromPlay,
  countVP, checkWinCondition,
  shuffle, num, getPlayer, opponent,
};
