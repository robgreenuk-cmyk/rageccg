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
function effectiveRage(inst) {
  const base = inst.isCrinos ? num(inst.def.CRage)   || num(inst.def.Rage)
                             : num(inst.def.Rage);
  return Math.max(0, base + inst.rageMod);
}
function effectiveGnosis(inst) {
  const base = inst.isCrinos ? num(inst.def.CGnosis) || num(inst.def.Gnosis)
                             : num(inst.def.Gnosis);
  return Math.max(0, base + inst.gnosisMod);
}
function effectiveHealth(inst) {
  const base = inst.isCrinos ? num(inst.def.CHealth) || num(inst.def.Health)
                             : num(inst.def.Health);
  return Math.max(1, base + inst.healthMod);
}
function effectiveRenown(inst) {
  return Math.max(0, num(inst.def.Renown) + inst.renownMod);
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
    },
    umbra:         [],                // characters currently in umbra

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
  // Remove the lowest non-aggravated damage card
  const nonAgg = inst.damageCards
    .filter((_, i) => !inst.aggravated.includes(i))
    .sort((a, b) => (num(a.def.Damage)||1) - (num(b.def.Damage)||1));
  if (nonAgg.length === 0) return null;
  const healed = nonAgg[0];
  removeFrom(inst.damageCards, healed);
  EventLog.record('REGENERATE', { card: inst.name, healed: healed.name });
  return healed;
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
  totalDamage, isDead,
  flipToCrinos, flipToBreed, checkFlipFromDamage,
  regenerate,
  moveToVictoryPile, removeFrom, removeFromPlay,
  countVP, checkWinCondition,
  shuffle, num, getPlayer, opponent,
};
