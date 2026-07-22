import './style.css';
import {
  GameState, EventLog, makeCardInstance, isDualFormChar, initGame,
  effectiveRage, effectiveGnosis, effectiveHealth, effectiveRenown,
  totalDamage, countVP, num, shuffle, getPlayer,
} from './game.js';
import {
  PHASES, getLegalActions, performAction, nextPhase,
} from './turnManager.js';
import {
  declareAttack, getCombatRoundActions, performCombatAction,
} from './combat.js';

// ═══════════════════════════════════════════════════════════════
// main.js — Thin renderer.
// Reads GameState, draws the screen, sends player choices to the
// engine via performAction() / performCombatAction(). Contains NO
// game rules — only DOM construction and the card image lookup.
//
// ONE card component (buildCard) is used everywhere: the picker,
// the board, hands, and mini summaries. Every card image opens the
// same full-screen viewer. Only layout/size differs by "mode".
// ═══════════════════════════════════════════════════════════════

let cardDatabase = [];
let renownLevel  = 20;

// Setup-screen scratch state (not part of GameState until game starts)
let draftPack       = [];
let draftSeptDeck    = [];
let draftCombatDeck  = [];

const IMAGE_OVERRIDES = {
  "Klaive":               "rage.image.equipment.klaive,",
  "Legendary Leadership": "rage.image.action.legendary.leadership,",
  "Luna's Armor":         "rage.image.equipment.lunas.armor,",
  "Nephthys Mu'at":       "rage.image.garou.nephthys.muat,rage.image.crinos.nephthys.muat",
  "Silver Claws":         "rage.image.combat.action.silver.claws,",
  "Spirit of the Fray":   "rage.image.combat.event.spirit.of.the.fray,",
  "Surprise Attack":      "rage.image.action.surprise.attack,",
  "Taking the Death Blow":"rage.image.combat.event.taking.the.death.blow,",
  "Victory Party":        "rage.image.moot.victory.party,",
};

// ═══════════════════════════════════════════════════════════════
// LOAD
// ═══════════════════════════════════════════════════════════════
async function loadCards() {
  try {
    const res = await fetch('/rage_cards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const all = Array.isArray(raw) ? raw : Object.values(raw);
    cardDatabase = all.filter(c => (c.Expansion || c.expansion || '') === 'Unlimited');
    console.log(`✅ Loaded ${cardDatabase.length} Unlimited cards`);
    renderSetupScreen();
    showScreen('screen-setup');
  } catch (err) {
    console.error('❌', err);
    document.body.innerHTML = `<p style="color:red;padding:20px">Failed to load rage_cards.json: ${err.message}</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// IMAGE PATH
// ═══════════════════════════════════════════════════════════════
function getImagePath(def, isCrinos = false) {
  const name = def.Name || def.name || '';
  const override = IMAGE_OVERRIDES[name];
  if (override) {
    const parts = override.split(',').map(s => s.trim()).filter(Boolean);
    const file  = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (file) return `/unlimited/${file}.jpg`;
  }
  const raw = def.ImageFile || def.imageFile || def.Imagefile || '';
  if (raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const file  = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (file && file.startsWith('rage.image.')) return `/unlimited/${file}.jpg`;
  }
  return buildFallbackPath(name, def.Type || def.type || '', isCrinos);
}

function buildFallbackPath(name, type, isCrinos) {
  const clean = name.toLowerCase()
    .replace(/['''\u2018\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').trim().replace(/\s+/g, '.');
  const t = type.toLowerCase();
  let seg = 'action';
  if      (t.startsWith('character'))     seg = isCrinos ? 'crinos' : 'garou';
  else if (t.startsWith('combat action')) seg = 'combat.action';
  else if (t.startsWith('combat event'))  seg = 'combat.event';
  else if (t.startsWith('gift'))          seg = 'gift';
  else if (t.startsWith('equipment'))     seg = 'equipment';
  else if (t.startsWith('moot'))          seg = 'moot';
  else if (t.startsWith('ally'))          seg = 'ally';
  else if (t.startsWith('enemy'))         seg = 'enemy';
  else if (t.startsWith('past life'))     seg = 'past.life';
  else if (t.startsWith('rite'))          seg = 'rite';
  else if (t.startsWith('quest'))         seg = 'quest';
  else if (t.startsWith('event'))         seg = 'event';
  return `/unlimited/rage.image.${seg}.${clean}.jpg`;
}

function placeholderUrl(name) {
  return `https://placehold.co/300x420/1a1a1a/ff4444?text=${encodeURIComponent(name)}`;
}

// ═══════════════════════════════════════════════════════════════
// SCREEN MANAGER
// ═══════════════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function renderSetupScreen() {
  const screen = el('screen-setup');
  screen.innerHTML = `
    <div class="setup-header">
      <h1 class="title-font">RAGE</h1>
      <p class="game-subtitle">Werewolf: The Apocalypse CCG — Unlimited Edition</p>
    </div>
    <div class="setup-body">
      <div class="setup-section">
        <label class="setup-label title-font">Renown Level</label>
        <div class="renown-picker">
          <button class="btn-sm" id="btn-renown-down">−5</button>
          <span id="renown-display">${renownLevel}</span>
          <button class="btn-sm" id="btn-renown-up">+5</button>
        </div>
        <p class="setup-hint">Characters' combined renown must not exceed this. First to reach it in VP wins.</p>
      </div>
      <div class="setup-section">
        <label class="setup-label title-font">Your Pack</label>
        <div id="chosen-pack" class="chosen-pack-row"><p class="empty-hint">No characters chosen yet</p></div>
        <div class="setup-renown-bar">Pack renown: <span id="pack-renown">0</span> / <span id="pack-limit">${renownLevel}</span></div>
      </div>
      <div id="setup-error" class="setup-error hidden"></div>
      <div class="setup-buttons">
        <button class="btn-primary" id="btn-random-deck">🎲 Random Pack &amp; Decks</button>
        <button class="btn-secondary" id="btn-pick-own">✋ Choose My Own</button>
        <button class="btn-secondary" id="btn-combat-tracer">🧪 Load Combat Tracer</button>
      </div>
      <button class="btn-start hidden" id="btn-start-game">▶ Start Game</button>
    </div>
  `;
  on('btn-renown-down', () => changeRenown(-5));
  on('btn-renown-up',   () => changeRenown(+5));
  on('btn-random-deck', randomDraft);
  on('btn-pick-own',    renderPickerScreen);
  on('btn-start-game',  startGame);
  on('btn-combat-tracer', startCombatTracer);
}

function changeRenown(delta) {
  renownLevel = Math.max(10, Math.min(50, renownLevel + delta));
  setText('renown-display', renownLevel);
  setText('pack-limit', renownLevel);
  refreshChosenPackDisplay();
}

function refreshChosenPackDisplay() {
  const container = el('chosen-pack');
  if (!container) return;
  const total = draftPack.reduce((s, c) => s + num(c.Renown), 0);
  setText('pack-renown', total);

  if (draftPack.length === 0) {
    container.innerHTML = '<p class="empty-hint">No characters chosen yet</p>';
    el('btn-start-game')?.classList.add('hidden');
    return;
  }
  container.innerHTML = '';
  draftPack.forEach((def, i) => {
    const mini = buildCard(def, {
      mode: 'mini',
      onRemove: () => { draftPack.splice(i, 1); refreshChosenPackDisplay(); },
    });
    container.appendChild(mini);
  });

  // Single definition of what makes a pack valid — used everywhere.
  const valid = draftPack.length > 0 && total <= renownLevel;
  const errEl = el('setup-error');
  if (!valid && total > renownLevel) {
    setText('setup-error', `Pack renown (${total}) exceeds level (${renownLevel}).`);
    errEl.style.color = '#ff6666'; errEl.classList.remove('hidden');
  } else {
    errEl.classList.add('hidden');
  }
  el('btn-start-game')?.classList.toggle('hidden', !valid);
}

// ── Random draft (for playtesting) ────────────────────────────
// Generates BOTH a random character pack AND random sept/combat decks.
// Used only by the "Random Pack & Decks" button.
function randomDraft() {
  const chars = cardDatabase.filter(c => (c.Type||'').startsWith('Character'));
  draftPack = [];
  let used = 0;
  for (const c of shuffle(chars)) {
    const r = num(c.Renown);
    if (r > 0 && used + r <= renownLevel) { draftPack.push(c); used += r; }
    if (draftPack.length >= 5) break;
  }

  generateRandomDecks();

  refreshChosenPackDisplay();
  const errEl = el('setup-error');
  if (errEl) {
    setText('setup-error',
      `Random pack: ${draftPack.length} characters (${used} renown) | Sept: ${draftSeptDeck.length} | Combat: ${draftCombatDeck.length}`);
    errEl.style.color = '#66cc66'; errEl.classList.remove('hidden');
  }
}

// Generates ONLY the sept/combat decks — does NOT touch draftPack.
// Used by both randomDraft() and confirmPicker() so deck generation
// is never coupled to (or capable of overwriting) character selection.
function generateRandomDecks() {
  const septPool = cardDatabase.filter(c => {
    const t = (c.Type||'').toLowerCase();
    return !t.startsWith('character') && !t.startsWith('enemy') &&
           !t.startsWith('victim')    && !t.startsWith('combat');
  });
  draftSeptDeck = buildRandomDeckList(septPool, 30, 3);

  const combatPool = cardDatabase.filter(c => {
    const t = (c.Type||'').toLowerCase();
    return t.startsWith('combat action') || t.startsWith('combat event');
  });
  draftCombatDeck = buildRandomDeckList(combatPool, 20, 2);
}

function buildRandomDeckList(pool, minSize, maxCopies) {
  const counts = {}; const deck = [];
  for (const card of shuffle(pool)) {
    const n = card.Name || '';
    counts[n] = (counts[n]||0) + 1;
    if (counts[n] <= maxCopies) deck.push(card);
    if (deck.length >= minSize * 2) break;
  }
  return deck;
}

// ── Manual picker ──────────────────────────────────────────────
function renderPickerScreen() {
  const screen = el('screen-setup');
  const chars  = cardDatabase.filter(c => (c.Type||'').startsWith('Character'));
  screen.innerHTML = `
    <div class="picker-header">
      <button class="btn-back" id="picker-back">← Back</button>
      <h2 class="title-font picker-title">Choose Your Pack</h2>
      <div class="picker-renown">Renown: <span id="picker-used">0</span> / ${renownLevel}</div>
    </div>
    <p class="picker-hint">Tap a character to add to your pack. Tap again to remove.</p>
    <div id="picker-pack" class="chosen-pack-row"></div>
    <div id="picker-error" class="setup-error hidden"></div>
    <div id="picker-grid" class="picker-grid"></div>
    <div class="picker-footer"><button class="btn-primary" id="picker-confirm">Confirm Pack →</button></div>
  `;
  on('picker-back',    () => { renderSetupScreen(); showScreen('screen-setup'); });
  on('picker-confirm', confirmPicker);

  const grid = el('picker-grid');
  grid.innerHTML = '';
  chars.forEach(def => renderPickerCard(def, grid));

  // Initialise the used-renown counter and mini pack row to match current draftPack
  setText('picker-used', draftPack.reduce((s,c) => s + num(c.Renown), 0));
  const row = el('picker-pack');
  draftPack.forEach(c => row.appendChild(buildCard(c, { mode: 'mini' })));
}

// Renders (or re-renders in place) a single picker card so its
// selected/tick state always matches draftPack.
function renderPickerCard(def, grid) {
  const isSelected = draftPack.some(c => c.Name === def.Name);
  const card = buildCard(def, {
    mode:     'browser',
    selected: isSelected,
    onSelect: () => togglePick(def, grid),
  });
  grid.appendChild(card);
}

function togglePick(def, grid) {
  const name = def.Name;
  const idx  = draftPack.findIndex(c => c.Name === name);
  if (idx >= 0) {
    draftPack.splice(idx, 1);
  } else {
    const used = draftPack.reduce((s,c) => s + num(c.Renown), 0);
    const r    = num(def.Renown);
    if (used + r > renownLevel) {
      flashPickerError(`Adding ${name} (renown ${r}) would exceed the renown level of ${renownLevel}.`);
      return;
    }
    draftPack.push(def);
  }
  // Re-render just this card's tick state, plus the summary row.
  // Simplest correct approach: rebuild the whole grid in place.
  grid.innerHTML = '';
  cardDatabase
    .filter(c => (c.Type||'').startsWith('Character'))
    .forEach(d => renderPickerCard(d, grid));

  setText('picker-used', draftPack.reduce((s,c) => s + num(c.Renown), 0));
  const row = el('picker-pack');
  row.innerHTML = '';
  draftPack.forEach(c => row.appendChild(buildCard(c, { mode: 'mini' })));
}

function flashPickerError(msg) {
  const e = el('picker-error');
  e.textContent = msg; e.style.color = '#ff6666'; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 3000);
}

function confirmPicker() {
  const total = draftPack.reduce((s, c) => s + num(c.Renown), 0);

  if (draftPack.length === 0) {
    flashPickerError('Choose at least one character.');
    return;
  }
  if (total > renownLevel) {
    flashPickerError(`Pack renown is ${total}/${renownLevel} — remove a character first.`);
    return;
  }

  // Generate sept/combat decks WITHOUT touching draftPack at all —
  // the manually chosen pack is never copied, replaced, or restored.
  generateRandomDecks();

  renderSetupScreen();
  showScreen('screen-setup');
  refreshChosenPackDisplay();
}

// ═══════════════════════════════════════════════════════════════
// START GAME → hand off to the engine
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// START GAME → hand off to the engine
// ═══════════════════════════════════════════════════════════════
function startGame() {
  if (draftPack.length === 0) return;

  const playerData = {
    characters: draftPack,
    sept:       draftSeptDeck,
    combat:     draftCombatDeck,
  };

  const savedPack = draftPack, savedSept = draftSeptDeck, savedCombat = draftCombatDeck;
  randomDraft();
  const opponentData = {
    characters: draftPack,
    sept:       draftSeptDeck,
    combat:     draftCombatDeck,
  };
  draftPack = savedPack; draftSeptDeck = savedSept; draftCombatDeck = savedCombat;

  initGame(playerData, opponentData, renownLevel);
  showScreen('screen-game');
  renderGameBoard();
}

// ═══════════════════════════════════════════════════════════════
// COMBAT VERTICAL TRACER — debug entry point.
// Skips the picker/draft flow entirely and seeds the exact same
// deterministic scenario proven in run_tests.mjs Test 17: one
// single-form alpha each side, player gets a fixed 5-card vanilla
// combat deck (2x Glancing Blow, 2x Grazing Wound, 1x Flesh Wound),
// opponent gets 0 combat cards so PASS_COMBAT_CARD is its only move.
// Lets you walk the same path live, as a real player, on demand —
// no random draw stands between you and the scenario.
// ═══════════════════════════════════════════════════════════════
function startCombatTracer() {
  const byName = n => cardDatabase.find(c => c.Name === n);

  const glancingBlow    = byName('Glancing Blow');
  const grazingWound    = byName('Grazing Wound');
  const fleshWound      = byName('Flesh Wound');
  const tracerPlayerChar = byName('Cernonous');
  const tracerOppChar    = byName('Allamande');

  if (!glancingBlow || !grazingWound || !fleshWound || !tracerPlayerChar || !tracerOppChar) {
    const errEl = el('setup-error');
    if (errEl) {
      setText('setup-error', 'Tracer cards/characters not found in loaded card database.');
      errEl.style.color = '#ff6666'; errEl.classList.remove('hidden');
    }
    return;
  }

  const playerData = {
    characters: [tracerPlayerChar],
    sept:       [],
    combat:     [glancingBlow, glancingBlow, grazingWound, grazingWound, fleshWound],
  };
  const opponentData = {
    characters: [tracerOppChar],
    sept:       [],
    combat:     [], // empty → PASS_COMBAT_CARD is the CPU's only legal move
  };

  initGame(playerData, opponentData, renownLevel);
  showScreen('screen-game');
  renderGameBoard();
}

// ═══════════════════════════════════════════════════════════════
// GAME BOARD — reads GameState, never mutates it directly.
//
// The board is a scrolling column of four zones (Opponent / Hunting
// Grounds / Player / Hand). Phase bar + status list + pass button
// (board-header) and the action bar are position:fixed, pinned to
// the top/bottom of the actual screen — see style.css.
// ═══════════════════════════════════════════════════════════════
function renderGameBoard() {
  renderPhaseBar();
  renderStatusList();
  renderPassBar();
  renderZone('opponent-row', GameState.opponent.pack, true);
  renderZone('hunting-row',  GameState.huntingGrounds, false);
  renderZone('player-row',   GameState.player.pack,    false);
  renderZone('hand-row',     GameState.player.septHand, false);
  renderCombatHandRow();
  renderRevealOverlay();
  renderActionBar();
  syncFixedBarOffsets();
}

// board-header and action-bar are position:fixed (see style.css — this
// replaced position:sticky, which doesn't reliably track the viewport
// inside a nested preview/webcontainer iframe on mobile). Being fixed
// takes them out of normal flow, so the scrollable zones below need
// matching top/bottom padding reserved, measured for real since hand
// size, action count, and phase-pill wrapping all change these bars'
// heights.
function syncFixedBarOffsets() {
  const screen = el('screen-game');
  const header = el('board-header');
  const footer = el('action-bar');
  if (!screen) return;
  if (header) screen.style.setProperty('--header-h', header.offsetHeight + 'px');
  if (footer) screen.style.setProperty('--footer-h', footer.offsetHeight + 'px');
}

// ── Board header — phase bar, status list, and pass button all
// live inside a single sticky wrapper so they stay pinned to the
// top of the screen while the card zones scroll underneath. ─────
function ensureBoardHeader() {
  let header = el('board-header');
  if (!header) {
    header = document.createElement('div');
    header.id = 'board-header';
    el('screen-game').insertBefore(header, el('screen-game').firstChild);
  }
  return header;
}

function renderPhaseBar() {
  let bar = el('phase-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'phase-bar';
    ensureBoardHeader().appendChild(bar);
  }
  bar.innerHTML = `
    <div class="phase-current title-font">${GameState.phase.toUpperCase()} PHASE</div>
    <div class="phase-sub-row">
      <span class="phase-turn title-font">Turn ${GameState.turn}</span>
      <span class="phase-list">
        ${PHASES.map(p => `<span class="phase-pill ${p===GameState.phase?'phase-active':''}">${p}</span>`).join('')}
      </span>
      <span class="phase-vp">You ${countVP(GameState.player)} — Opp ${countVP(GameState.opponent)} (target ${GameState.renownLevel})</span>
    </div>
  `;
}

// ── Status list — plain-text summary of hand + character status ──
// Deliberately NOT the visual card grid: this is a fast, glanceable
// readout for verifying game state during the pass-loop / walking
// skeleton test, independent of card art loading correctly.
function renderStatusList() {
  let bar = el('status-list');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'status-list';
    ensureBoardHeader().appendChild(bar);
  }

  const hand = GameState.player.septHand;
  const handText = hand.length
    ? hand.map(c => c.name).join(', ')
    : '(empty)';

  const packText = GameState.player.pack.length
    ? GameState.player.pack.map(c => {
        const r = effectiveRage(c), g = effectiveGnosis(c), h = effectiveHealth(c);
        const dmg = totalDamage(c);
        const wounds = c.damageCards.map(d => d.name).join(', ');
        const flags = [
          c.isCrinos ? 'Crinos' : 'Breed',
          c.inUmbra ? 'Umbra' : null,
          GameState.player.alpha?.instanceId === c.instanceId ? 'Alpha' : null,
        ].filter(Boolean).join(', ');
        return `<li>${c.name} — R${r} G${g} H${h}${dmg ? ` (wounds: ${wounds})` : ''} [${flags}]</li>`;
      }).join('')
    : '<li>(no characters in pack)</li>';

  bar.innerHTML = `
    <div class="status-section">
      <span class="status-label">Hand (${hand.length}):</span>
      <span class="status-items">${handText}</span>
    </div>
    <div class="status-section">
      <span class="status-label">Your Characters:</span>
      <ul class="status-char-list">${packText}</ul>
    </div>
  `;
}

// ── Pass bar — always-available, unconditional phase advance ─────
// Calls nextPhase() directly rather than going through getLegalActions(),
// so it works as a guaranteed escape hatch for the pass-loop test even
// if a given phase's own legal-action list has a gap.
function renderPassBar() {
  let bar = el('pass-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'pass-bar';
    ensureBoardHeader().appendChild(bar);
  }
  bar.innerHTML = `
    <button id="btn-pass-phase" class="btn-pass-prominent">⏭ Pass / Play No Cards — End ${GameState.phase} Phase</button>
  `;
  on('btn-pass-phase', handlePass);
}

function handlePass() {
  nextPhase();
  renderGameBoard();
  checkGameOverUI();
}

function renderZone(rowId, instances, isOpponent) {
  const row = el(rowId);
  if (!row) return;
  row.closest('.zone')?.classList.toggle('zone-empty', instances.length === 0);
  row.innerHTML = '';
  instances.forEach(inst => {
    row.appendChild(buildCard(inst.def, {
      mode:        'board',
      instance:    inst,
      isOpponent,
    }));
  });
}

// ── Combat hand — real, visible, tappable cards ────────────────
// Always shows the player's actual combat hand (it's live from the
// Redraw Phase onward). Cards are only tappable when it's actually
// this player's turn to play a card in the current combat round —
// tapping one plays it directly, replacing the old text-only
// "Play <name>" action-bar buttons for this specific action.
function renderCombatHandRow() {
  const row = el('combat-hand-row');
  if (!row) return;
  const hand = GameState.player.combatHand;
  row.closest('.zone')?.classList.toggle('zone-empty', hand.length === 0);
  row.innerHTML = '';

  const playableCards = GameState.combat
    ? getCombatRoundActions('player')
        .filter(a => a.type === 'PLAY_COMBAT_CARD')
        .map(a => a.card)
    : [];

  hand.forEach(inst => {
    const canPlay = playableCards.includes(inst);
    const card = buildCard(inst.def, {
      mode:     'board',
      instance: inst,
      onSelect: canPlay ? () => handlePlayerAction({ type: 'PLAY_COMBAT_CARD', card: inst }) : null,
    });
    card.classList.toggle('is-playable', canPlay);
    row.appendChild(card);
  });
}

// ── Reveal overlay ──────────────────────────────────────────────
// A genuine paused moment for the Reveal Step (rulebook 6.2 step 3):
// both played cards are shown face-up together, side by side, and
// combat.js has already stopped short of computing anything. Nothing
// resolves until the player taps Continue here.
function renderRevealOverlay() {
  const c = GameState.combat;
  const inReveal = c && c.step === 'reveal';
  let overlay = el('reveal-overlay');

  if (!inReveal) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reveal-overlay';
    overlay.className = 'reveal-overlay';
    document.body.appendChild(overlay);
  }

  const buildSide = (label, cardOrPass) => {
    const side = document.createElement('div');
    side.className = 'reveal-side';
    side.innerHTML = `<div class="reveal-side-label">${label}</div>`;
    if (cardOrPass === 'pass' || !cardOrPass) {
      const passEl = document.createElement('div');
      passEl.className = 'reveal-pass';
      passEl.textContent = 'Played nothing';
      side.appendChild(passEl);
    } else {
      side.appendChild(buildCard(cardOrPass.def, { mode: 'board' }));
    }
    return side;
  };

  overlay.innerHTML = '<div class="reveal-title title-font">Reveal!</div>';

  const row = document.createElement('div');
  row.className = 'reveal-row';
  row.appendChild(buildSide(`${c.attacker.name} (attacker)`, c.attackerCard));
  const vs = document.createElement('div');
  vs.className = 'reveal-vs title-font';
  vs.textContent = 'VS';
  row.appendChild(vs);
  row.appendChild(buildSide(`${c.defender.name} (defender)`, c.defenderCard));
  overlay.appendChild(row);

  const btn = document.createElement('button');
  btn.className = 'action-btn reveal-continue-btn';
  btn.textContent = 'Continue';
  btn.onclick = () => handlePlayerAction({ type: 'CONTINUE_REVEAL' });
  overlay.appendChild(btn);
}

// ── Action bar — built from getLegalActions() ─────────────────
function renderActionBar() {
  let bar = el('action-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'action-bar';
    el('screen-game').appendChild(bar);
  }
  const actions = GameState.combat
    ? getCombatRoundActions('player').filter(a => a.type !== 'PLAY_COMBAT_CARD' && a.type !== 'CONTINUE_REVEAL')
    : getLegalActions('player');

  bar.innerHTML = '';
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = action.label;
    btn.onclick = () => handlePlayerAction(action);
    bar.appendChild(btn);
  });
}

function handlePlayerAction(action) {
  if (GameState.combat) {
    performCombatAction('player', action);
  } else if (action.type === 'DECLARE_ATTACK') {
    declareAttack('player', action.attacker, action.target);
  } else {
    performAction('player', action);
  }
  runOpponentTurnIfNeeded();
  renderGameBoard();
  checkGameOverUI();
}

function runOpponentTurnIfNeeded() {
  if (GameState.combat) {
    const oppActions = getCombatRoundActions('opponent').filter(a => a.type !== 'WAITING');
    if (oppActions.length > 0) {
      const choice = oppActions[Math.floor(Math.random() * oppActions.length)];
      performCombatAction('opponent', choice);
    }
  }
}

function checkGameOverUI() {
  if (!GameState.gameOver) return;
  const pvp = countVP(GameState.player);
  const ovp = countVP(GameState.opponent);
  const msg = GameState.winner === 'player'   ? `You win! ${pvp} — ${ovp}`
            : GameState.winner === 'opponent' ? `Opponent wins. ${pvp} — ${ovp}`
            : `Tie game at ${pvp} VP.`;
  alert(msg);
}

// ═══════════════════════════════════════════════════════════════
// THE SINGLE CARD COMPONENT
// Every card anywhere in the app — picker, board, hand, mini
// summary — is built by this one function. Only `mode` changes
// the layout. Every mode opens the SAME full-screen viewer when
// the card art is tapped.
//
// options:
//   mode:       'board' | 'browser' | 'mini'
//   instance:   live card instance (board mode) — has isCrinos, damage etc.
//   isOpponent: hide identity for face-down opponent cards (future use)
//   selectable: browser mode — show picker-selected highlight
//   selected:   browser mode — current selection state
//   onSelect:   browser mode — callback when the body (not image) is tapped
//   onRemove:   mini mode — callback for the ✕ button
// ═══════════════════════════════════════════════════════════════
function buildCard(def, options = {}) {
  const {
    mode       = 'board',
    instance   = null,
    isOpponent = false,
    selected   = false,
    onSelect   = null,
    onRemove   = null,
  } = options;

  const cardName = def.Name || 'Unknown';
  const isChar   = (def.Type || '').startsWith('Character');
  const isDual   = instance ? instance.isDualForm : isDualFormChar(def);

  // Local "which face is showing" state — board cards track this on
  // the instance itself (persists across re-renders); browser/mini
  // cards use a local variable since they have no game-state instance.
  let localCrinos = false;
  const getCrinos = () => instance ? instance.isCrinos : localCrinos;
  const setCrinos = (v) => { if (instance) instance.isCrinos = v; else localCrinos = v; };

  const wrap = document.createElement('div');
  wrap.className = `card-component card-mode-${mode}`;

  function render() {
    const imgPath = getImagePath(def, getCrinos());
    wrap.classList.toggle('is-crinos', getCrinos());
    const wounds = (isChar && instance) ? instance.damageCards : [];

    wrap.innerHTML = `
      <div class="card-img-wrap">
        ${isDual ? `<button class="flip-btn flip-left" title="Flip card">⇄</button>` : ''}
        <img class="card-img" src="${imgPath}" alt="${cardName}"
          onerror="this.onerror=null;this.src='${placeholderUrl(cardName)}'">
        ${isDual ? `<button class="flip-btn flip-right" title="Flip card">⇄</button>` : ''}
        ${mode === 'browser' && selected ? `<div class="picker-tick">✓</div>` : ''}
        ${mode === 'mini' ? `<button class="mini-remove">✕</button>` : ''}
      </div>
      ${wounds.length ? buildTuckedWounds(wounds) : ''}
      <div class="card-name-strip title-font">${cardName}</div>
      ${buildStatsBlock(def, instance, isChar, getCrinos(), mode)}
    `;

    // Flip buttons — never trigger select/open
    wrap.querySelectorAll('.flip-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        setCrinos(!getCrinos());
        render();
      });
    });

    // Mini remove button
    const rmBtn = wrap.querySelector('.mini-remove');
    if (rmBtn && onRemove) {
      rmBtn.addEventListener('click', e => { e.stopPropagation(); onRemove(); });
    }

    // Tucked damage cards — tapping the fanned edges opens a swipeable
    // viewer of the actual cards attached, instead of the character's
    // own full-screen viewer.
    const tuckedEl = wrap.querySelector('.tucked-wounds');
    tuckedEl?.addEventListener('click', e => {
      e.stopPropagation();
      openDamageSwipeView(cardName, wounds);
    });

    // The image ALWAYS opens the universal full-screen viewer
    const img = wrap.querySelector('.card-img');
    img?.addEventListener('click', e => {
      e.stopPropagation();
      openFullCard(def, getCrinos(), isDual, newForm => { setCrinos(newForm); render(); });
    });

    // Tapping the rest of the card body (name/stats) triggers select,
    // wherever an onSelect handler was actually provided (picker
    // browser cards, and now playable combat hand cards).
    if (onSelect) {
      wrap.addEventListener('click', onSelect);
    }
  }

  render();
  return wrap;
}

// Fanned "tucked under the card" strip — real art from each damage
// card, cropped to just its bottom edge via object-position, per the
// physical rule (damage cards are placed under their target so the
// bottom of the picture shows). Later cards sit on top and peek out
// lowest, closest to the character card's bottom edge.
function buildTuckedWounds(wounds) {
  const cards = wounds.map((d, i) => `
    <div class="tucked-card" style="--i:${i}; z-index:${i}">
      <img class="tucked-card-img" src="${getImagePath(d.def, false)}" alt="${d.name}"
        onerror="this.onerror=null;this.src='${placeholderUrl(d.name)}'">
    </div>
  `).join('');
  return `<div class="tucked-wounds" title="${wounds.length} wound${wounds.length > 1 ? 's' : ''} — tap to view">${cards}</div>`;
}

function buildStatsBlock(def, instance, isChar, isCrinos, mode) {
  if (mode === 'mini') {
    return def.Renown ? `<div class="mini-renown">⭐${def.Renown}</div>` : '';
  }

  if (!isChar) {
    const typeLabel = (def.Type || '').split(' - ')[0];
    return `<div class="card-stat-block"><div class="stat-row stat-active"><span class="stat-type">${typeLabel}</span></div></div>`;
  }

  // Character — show both forms, highlight active, show damage if any
  const r  = instance ? effectiveRage(instance)   : num(def.Rage);
  const g  = instance ? effectiveGnosis(instance) : num(def.Gnosis);
  const h  = instance ? effectiveHealth(instance) : num(def.Health);
  const cr = num(def.CRage)   || r;
  const cg = num(def.CGnosis) || g;
  const ch = num(def.CHealth) || h;
  const dmg = instance ? totalDamage(instance) : 0;

  return `
    <div class="card-stat-block">
      <div class="stat-row ${!isCrinos ? 'stat-active' : 'stat-dim'}">
        <span class="stat-r">R${r}</span><span class="stat-g">G${g}</span><span class="stat-h">H${h}</span>
        ${dmg && !isCrinos ? `<span class="stat-dmg">−${dmg}</span>` : ''}
      </div>
      <div class="stat-row ${isCrinos ? 'stat-active' : 'stat-dim'}">
        <span class="stat-r">R${cr}</span><span class="stat-g">G${cg}</span><span class="stat-h">H${ch}</span>
        ${dmg && isCrinos ? `<span class="stat-dmg">−${dmg}</span>` : ''}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// FULL-SCREEN CARD VIEW — universal, used by every card everywhere
// ═══════════════════════════════════════════════════════════════
function openFullCard(def, startCrinos, isDual, onClose) {
  let isCrinos = startCrinos;
  const name   = def.Name || 'Unknown';
  const type   = def.Type || '';
  const isChar = type.startsWith('Character');

  const overlay = document.createElement('div');
  overlay.className = 'fullcard-overlay';

  const closeStrip = document.createElement('div');
  closeStrip.className = 'fullcard-close-strip';
  closeStrip.innerHTML = `<button class="fullcard-close-btn">✕ Close</button>`;
  closeStrip.addEventListener('click', closeOverlay);
  overlay.appendChild(closeStrip);

  const inner = document.createElement('div');
  inner.className = 'fullcard-inner';
  inner.addEventListener('click', e => e.stopPropagation());
  overlay.appendChild(inner);
  overlay.addEventListener('click', closeOverlay);

  const imgWrap = document.createElement('div');
  imgWrap.className = 'fullcard-img-wrap';
  const cardImg = document.createElement('img');
  cardImg.className = 'fullcard-img';
  cardImg.alt = name;
  cardImg.onerror = function() { this.onerror = null; this.src = placeholderUrl(name); };

  if (isDual) {
    const fl = document.createElement('button');
    fl.className = 'fullcard-flip-btn fullcard-flip-left'; fl.textContent = '⇄';
    fl.title = 'Flip to ' + (isCrinos ? 'breed' : 'crinos') + ' form';
    fl.addEventListener('click', e => { e.stopPropagation(); doFlip(); });
    imgWrap.appendChild(fl);
  }
  imgWrap.appendChild(cardImg);
  if (isDual) {
    const fr = document.createElement('button');
    fr.className = 'fullcard-flip-btn fullcard-flip-right'; fr.textContent = '⇄';
    fr.addEventListener('click', e => { e.stopPropagation(); doFlip(); });
    imgWrap.appendChild(fr);
  }
  inner.appendChild(imgWrap);

  const info = document.createElement('div');
  info.className = 'fullcard-info';
  info.innerHTML = `
    <div class="fullcard-name title-font">${name}</div>
    <div class="fullcard-type">${type}</div>
    ${def.Keywords ? `<div class="fullcard-kw">${def.Keywords}</div>` : ''}
    ${def.Requires ? `<div class="fullcard-req">Requires: ${def.Requires}</div>` : ''}
    ${def.Text     ? `<div class="fullcard-text">${def.Text}</div>` : ''}
    ${def.Errata   ? `<div class="fullcard-errata">Errata: ${def.Errata}</div>` : ''}
  `;
  const statsBlock = document.createElement('div');
  statsBlock.className = 'full-stats';
  const anchor = info.querySelector('.fullcard-text') || info.querySelector('.fullcard-errata');
  anchor ? info.insertBefore(statsBlock, anchor) : info.appendChild(statsBlock);
  inner.appendChild(info);

  function updateView() {
    cardImg.src = getImagePath(def, isCrinos);
    if (isChar) {
      const r=num(def.Rage),g=num(def.Gnosis),h=num(def.Health);
      const cr=num(def.CRage)||r, cg=num(def.CGnosis)||g, ch=num(def.CHealth)||h;
      statsBlock.innerHTML = `
        <div class="full-form-label ${!isCrinos?'form-active':''}">Breed form</div>
        <div class="full-stat-row"><span class="stat-r">Rage ${r}</span><span class="stat-g">Gnosis ${g}</span><span class="stat-h">Health ${h}</span></div>
        <div class="full-form-label ${isCrinos?'form-active':''}">Crinos form</div>
        <div class="full-stat-row"><span class="stat-r">Rage ${cr}</span><span class="stat-g">Gnosis ${cg}</span><span class="stat-h">Health ${ch}</span></div>
        <div class="full-renown">Renown: ${def.Renown||''}</div>`;
    } else {
      statsBlock.innerHTML = `
        ${def.Rage   ? `<div class="full-stat-row"><span class="stat-r">Rage ${def.Rage}</span></div>` : ''}
        ${def.Damage ? `<div class="full-stat-row"><span class="stat-dmg">Damage ${def.Damage}</span></div>` : ''}
        ${def.Renown ? `<div class="full-renown">Renown: ${def.Renown}</div>` : ''}`;
    }
  }
  function doFlip() { isCrinos = !isCrinos; updateView(); }
  function closeOverlay() { overlay.remove(); onClose?.(isCrinos); }

  updateView();
  document.body.appendChild(overlay);
}

// ── Damage swipe viewer ──────────────────────────────────────
// Opened by tapping the tucked-wounds strip on a damaged character.
// Native CSS scroll-snap gives real touch-swipe for free; the
// prev/next buttons are a no-touch fallback and a clearer affordance.
function openDamageSwipeView(ownerName, wounds) {
  if (!wounds.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'fullcard-overlay damage-swipe-overlay';
  overlay.addEventListener('click', () => overlay.remove());

  const closeStrip = document.createElement('div');
  closeStrip.className = 'fullcard-close-strip';
  closeStrip.innerHTML = `<button class="fullcard-close-btn">✕ Close</button>`;
  closeStrip.addEventListener('click', e => { e.stopPropagation(); overlay.remove(); });
  overlay.appendChild(closeStrip);

  const title = document.createElement('div');
  title.className = 'swipe-title title-font';
  title.textContent = `${ownerName} — ${wounds.length} wound${wounds.length > 1 ? 's' : ''}`;
  overlay.appendChild(title);

  const inner = document.createElement('div');
  inner.className = 'fullcard-inner';
  inner.addEventListener('click', e => e.stopPropagation());
  overlay.appendChild(inner);

  const track = document.createElement('div');
  track.className = 'swipe-track';
  wounds.forEach(card => {
    const page = document.createElement('div');
    page.className = 'swipe-page';
    page.innerHTML = `
      <img class="swipe-img" src="${getImagePath(card.def, false)}" alt="${card.name}"
        onerror="this.onerror=null;this.src='${placeholderUrl(card.name)}'">
      <div class="swipe-name title-font">${card.name}</div>
      ${card.def.Damage ? `<div class="swipe-dmg">Damage ${card.def.Damage}</div>` : ''}
      ${card.def.Text   ? `<div class="swipe-text">${card.def.Text}</div>` : ''}
    `;
    track.appendChild(page);
  });
  inner.appendChild(track);

  if (wounds.length > 1) {
    const nav = document.createElement('div');
    nav.className = 'swipe-nav';
    const prevBtn = document.createElement('button');
    prevBtn.className = 'swipe-nav-btn'; prevBtn.textContent = '‹';
    prevBtn.addEventListener('click', e => { e.stopPropagation(); track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' }); });
    const nextBtn = document.createElement('button');
    nextBtn.className = 'swipe-nav-btn'; nextBtn.textContent = '›';
    nextBtn.addEventListener('click', e => { e.stopPropagation(); track.scrollBy({ left: track.clientWidth, behavior: 'smooth' }); });
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    inner.appendChild(nav);
  }

  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════════════
// DOM UTILITIES
// ═══════════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }
function on(id, fn) { el(id)?.addEventListener('click', fn); }
function setText(id, val) { const e = el(id); if (e) e.textContent = val; }

// ═══════════════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app') || document.body;
  app.innerHTML = `
    <div id="screen-loading" class="screen active">
      <div class="loading-content">
        <div class="title-font loading-title">RAGE</div>
        <div class="loading-text">Loading cards…</div>
      </div>
    </div>
    <div id="screen-setup" class="screen"></div>
    <div id="screen-game" class="screen">
      <section class="zone zone-opponent">
        <div class="zone-label title-font">Opponent Pack</div>
        <div id="opponent-row" class="card-row"></div>
      </section>
      <section class="zone zone-hunting">
        <div class="zone-label title-font">Hunting Grounds</div>
        <div id="hunting-row" class="card-row"></div>
      </section>
      <section class="zone zone-player">
        <div class="zone-label title-font">Your Pack</div>
        <div id="player-row" class="card-row"></div>
      </section>
      <section class="zone zone-hand">
        <div class="zone-label title-font">Your Sept Hand</div>
        <div id="hand-row" class="card-row"></div>
      </section>
      <section class="zone zone-combat-hand">
        <div class="zone-label title-font">Your Combat Hand</div>
        <div id="combat-hand-row" class="card-row"></div>
      </section>
    </div>
  `;
  loadCards();
});

window.addEventListener('resize', () => {
  if (el('screen-game')?.classList.contains('active')) syncFixedBarOffsets();
});
