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
import { initCardEngine } from './cardEngine.js';
import { setupPackCombatTracer, runOpponentCombatTurn } from './tracerScenarios.js';
import { getCombatHighlights, getPendingDeathBlowInst, getHealthReadout } from './combatView.js';
import cardEffectsData from './cardEffects.json';

// Populates cardEngine's internal EFFECTS lookup from cardEffects.json.
// MUST run before any combat/game logic — in particular before
// applyDamage()'s onDamageResolved() call ever fires, or every
// abilitiesFor() lookup silently returns [] and no scripted card
// ability (Fur Gnarl included) does anything. Static import, not a
// fetch: cardEffects.json lives in the repo root alongside the other
// engine files, not under public/, so it's bundled by Vite rather
// than served as a runtime asset — no separate load/caching step.
initCardEngine(cardEffectsData);

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

// True only for a game started from the Pack Combat Tracer button: puts
// the CPU on the tracer's policy — always take a pack-join it is offered,
// and follow a short script in the opening round (see tracerScenarios.js).
// Every other way of starting a game sets it false.
let cpuTracerPolicy = false;

// Which cards are attacking / defending / selectable right now, worked
// out once per renderGameBoard() (see combatView.js) and read by
// renderZone() to paint the halos and by the action sheet for its
// "Attacking"/"Defending" line.
let combatHighlights = { attacking: new Set(), defending: new Set(), selectable: new Set() };

// The creature a Taking the Death Blow decision is about (or null) —
// renderZone() scrolls it into view so it can't sit half off-screen.
let pendingDyingInst = null;

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
        <button class="btn-secondary" id="btn-pack-combat-tracer">🧪 Load Pack Combat Tracer</button>
      </div>
      <button class="btn-start hidden" id="btn-start-game">▶ Start Game</button>
    </div>
  `;
  on('btn-renown-down', () => changeRenown(-5));
  on('btn-renown-up',   () => changeRenown(+5));
  on('btn-random-deck', randomDraft);
  on('btn-pick-own',    renderPickerScreen);
  on('btn-start-game',  startGame);
  on('btn-pack-combat-tracer', startPackCombatTracer);
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

  cpuTracerPolicy = false;
  initGame(playerData, opponentData, renownLevel);
  showScreen('screen-game');
  renderGameBoard();
}

// ═══════════════════════════════════════════════════════════════
// PACK COMBAT TRACER — debug entry point.
// Skips the picker/draft flow and seeds a deterministic pack-vs-pack
// scenario (all setup logic lives in tracerScenarios.js so
// run_tests.mjs Test 60 can exercise it headlessly):
//   - You: Cernonous + Tim Rowantree + Passer, with Hunting Party in
//     your opening hand. Make Cernonous your alpha, attack Shakar,
//     then play Hunting Party to bring in your packmates live.
//   - Opponent: Shakar (its alpha) + Jubati + Running Creek, holding
//     Pack Defense. In this tracer the CPU always plays it, so you
//     face a 3-person defense every run.
//   - Shakar is still dual-form (one hit forces a Crinos flip you can
//     watch live) and Fur Gnarl is still in your hand (aggravated
//     wound against a Crinos target) — both carried over from the old
//     single-character tracer. Only Cernonous has the Rage (4) to play
//     Fur Gnarl legally; a packmate trying it is a bluff.
//   - With 3 attackers vs 3 defenders you get real targeting choices
//     (rule 6.7) and the blow-order choice (rule 6.6.1) when several
//     cards land on one target.
// ═══════════════════════════════════════════════════════════════
function startPackCombatTracer() {
  const result = setupPackCombatTracer(
    n => cardDatabase.find(c => c.Name === n),
    renownLevel
  );
  if (!result.ok) {
    const errEl = el('setup-error');
    if (errEl) {
      setText('setup-error',
        `Pack Combat Tracer cards/characters not found in card database: ${result.missing.join(', ')}`);
      errEl.style.color = '#ff6666'; errEl.classList.remove('hidden');
    }
    return;
  }
  cpuTracerPolicy = true;
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
  combatHighlights = getCombatHighlights();
  pendingDyingInst = getPendingDeathBlowInst();
  renderPhaseBar();
  renderVPScoreboard();
  renderStatusList();
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
    </div>
  `;
}

// ── VP scoreboard — clearly visible running score for both sides,
// with a progress bar toward the target (renownLevel) each needs to
// win. Deliberately its own row (not squeezed into the phase-sub-row
// alongside turn/phase pills, which is where it used to live and was
// easy to miss). ─────────────────────────────────────────────────
function renderVPScoreboard() {
  let bar = el('vp-scoreboard');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'vp-scoreboard';
    ensureBoardHeader().appendChild(bar);
  }
  const target = GameState.renownLevel;
  const youVP  = countVP(GameState.player);
  const oppVP  = countVP(GameState.opponent);
  const pct = vp => Math.max(0, Math.min(100, target > 0 ? (vp / target) * 100 : 0));
  bar.innerHTML = `
    <div class="vp-side vp-you">
      <div class="vp-label">YOU</div>
      <div class="vp-value">${youVP}</div>
      <div class="vp-bar"><div class="vp-bar-fill" style="width:${pct(youVP)}%"></div></div>
    </div>
    <div class="vp-target title-font">${target}<span class="vp-target-label">to win</span></div>
    <div class="vp-side vp-opp">
      <div class="vp-label">OPP</div>
      <div class="vp-value">${oppVP}</div>
      <div class="vp-bar"><div class="vp-bar-fill" style="width:${pct(oppVP)}%"></div></div>
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
        return `<li>${c.name} — R${r} G${g} ${getHealthReadout(c).text}${dmg ? ` (wounds: ${wounds})` : ''} [${flags}]</li>`;
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
function renderZone(rowId, instances, isOpponent) {
  const row = el(rowId);
  if (!row) return;
  row.closest('.zone')?.classList.toggle('zone-empty', instances.length === 0);
  // Clearing and rebuilding the row resets its horizontal scroll to the
  // left edge, so with wounds widening a row every action used to snap it
  // back and hide whatever you had scrolled to. Remember and restore it.
  const keepScroll = row.scrollLeft;
  row.innerHTML = '';
  let dyingCard = null;
  instances.forEach(inst => {
    const card = buildCard(inst.def, {
      mode:        'board',
      instance:    inst,
      isOpponent,
    });
    // Combat halos (style.css): red = attacking, blue/white = defending,
    // pulsing white-blue = a card you're being asked to choose.
    card.classList.toggle('is-attacking',  combatHighlights.attacking.has(inst));
    card.classList.toggle('is-defending',  combatHighlights.defending.has(inst));
    card.classList.toggle('is-selectable', combatHighlights.selectable.has(inst));
    row.appendChild(card);
    if (inst === pendingDyingInst) dyingCard = card;
  });
  row.scrollLeft = keepScroll;
  // A death-blow decision is about ONE creature: centre it in the row.
  // Horizontal only, set by hand — scrollIntoView() would also scroll the
  // row VERTICALLY (it is overflow-y:hidden but still scrollable from
  // script), sliding every card up under the zone label.
  if (dyingCard) {
    row.scrollLeft = Math.max(0, dyingCard.offsetLeft - (row.clientWidth - dyingCard.offsetWidth) / 2);
  }
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

  // Every "play this card from your hand" action makes its card glow:
  // a combat card, a pack-join Combat Event (Hunting Party, Pack
  // Defense…), Taking the Death Blow, or a Feint follow-up.
  const PLAY_FROM_HAND = ['PLAY_COMBAT_CARD', 'PLAY_PACK_ACTION', 'PLAY_DEATH_BLOW', 'PLAY_FEINT_FOLLOWUP'];
  const playableCards = GameState.combat
    ? getCombatRoundActions('player')
        .filter(a => PLAY_FROM_HAND.includes(a.type))
        .map(a => a.card)
    : [];

  hand.forEach(inst => {
    const canPlay = playableCards.includes(inst);
    // No onSelect here — tapping the card (anywhere on it) opens the
    // unified card viewer, which lists "Play this card" as one of its
    // contextual actions whenever canPlay is true. is-playable is now
    // purely a passive glow: a heads-up that something's available.
    const card = buildCard(inst.def, {
      mode:     'board',
      instance: inst,
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

  // Pack Combat: show every participant's card, not just the alpha's.
  // (c.attacker/c.attackerCard etc. are legacy single-creature accessors
  // that only ever reflect one participant per side.)
  const buildGroup = (groupLabel, participants) => {
    const group = document.createElement('div');
    group.className = 'reveal-group';
    group.innerHTML = `<div class="reveal-group-label title-font">${groupLabel}</div>`;
    const cardsRow = document.createElement('div');
    cardsRow.className = 'reveal-group-cards';
    for (const p of participants) {
      cardsRow.appendChild(buildSide(p.inst.name, p.card));
    }
    group.appendChild(cardsRow);
    return group;
  };

  const row = document.createElement('div');
  row.className = 'reveal-row';
  row.appendChild(buildGroup('Attacker', c.attackerParticipants));
  const vs = document.createElement('div');
  vs.className = 'reveal-vs title-font';
  vs.textContent = 'VS';
  row.appendChild(vs);
  row.appendChild(buildGroup('Defender', c.defenderParticipants));
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
    ? getCombatRoundActions('player').filter(a => a.type !== 'CONTINUE_REVEAL')
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
  // The turn driver (and the reasoning behind it) lives in
  // tracerScenarios.js so run_tests.mjs can test it.
  runOpponentCombatTurn(cpuTracerPolicy);
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

    const wounds       = instance ? (instance.damageCards || []) : [];
    const nonAggWounds = instance ? wounds.filter(c => !instance.aggravated.includes(c.instanceId)) : [];
    const aggWounds    = instance ? wounds.filter(c =>  instance.aggravated.includes(c.instanceId)) : [];
    const dmg          = instance ? totalDamage(instance) : 0;

    // Gift/Equipment attach left (rule: "Gifts... attach under the left of
    // their target"); Equipment's exact placement isn't confirmed by the
    // rule text we have, so it's grouped here provisionally, alongside
    // Gifts, pending confirmation. Damage stays right, split top/bottom
    // into non-aggravated vs aggravated.
    const attachments = instance ? (instance.attachments || []) : [];
    const gifts        = attachments.filter(a => (a.def.Type || '').startsWith('Gift'));
    const equipment     = attachments.filter(a => (a.def.Type || '').startsWith('Equipment'));

    const hasLeft  = gifts.length > 0 || equipment.length > 0;
    const hasRight = nonAggWounds.length > 0 || aggWounds.length > 0;
    wrap.classList.toggle('has-cascade', hasLeft || hasRight);

    // "HP 2/5" on every creature in play (never on browser/mini picker cards)
    const hp = (instance && mode === 'board' && /^(Character|Ally|Enemy|Victim)/.test(def.Type || ''))
      ? getHealthReadout(instance) : null;
    wrap.classList.toggle('is-dying', !!hp && hp.level === 'dying');

    wrap.innerHTML = `
      <div class="card-top-row">
        ${hasLeft ? `
          <div class="attach-column">
            <div class="attach-slot">${gifts.length ? buildTuckCascade(gifts, 'tuck-attach') : ''}</div>
            <div class="attach-slot">${equipment.length ? buildTuckCascade(equipment, 'tuck-attach') : ''}</div>
          </div>
        ` : ''}
        <div class="card-img-wrap">
          ${isDual ? `<button class="flip-btn flip-left" title="Flip card">⇄</button>` : ''}
          <img class="card-img" src="${imgPath}" alt="${cardName}"
            onerror="this.onerror=null;this.src='${placeholderUrl(cardName)}'">
          ${isDual ? `<button class="flip-btn flip-right" title="Flip card">⇄</button>` : ''}
          ${mode === 'browser' && selected ? `<div class="picker-tick">✓</div>` : ''}
          ${mode === 'mini' ? `<button class="mini-remove">✕</button>` : ''}
          ${dmg > 0 ? `<div class="wound-badge" title="${dmg} damage — tap to view">−${dmg}</div>` : ''}
          ${hp ? `<div class="hp-pill hp-${hp.level}" title="Health left in this form / this form's Health">${hp.text}</div>` : ''}
        </div>
        ${hasRight ? `
          <div class="attach-column">
            <div class="attach-slot">${nonAggWounds.length ? buildTuckCascade(nonAggWounds) : ''}</div>
            <div class="attach-slot">${aggWounds.length ? buildTuckCascade(aggWounds, 'tuck-aggravated') : ''}</div>
          </div>
        ` : ''}
      </div>
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

    function openThisCard(startPage) {
      openFullCard(def, instance, isDual, getCrinos(), newForm => { setCrinos(newForm); render(); }, startPage);
    }

    // The wound badge jumps straight to the wounds page of the viewer
    // (the horizontal swipe-through of attached injury cards), rather
    // than a separate on-board tap target — small board cards are too
    // small a target for that to work reliably on a phone.
    const badgeEl = wrap.querySelector('.wound-badge');
    badgeEl?.addEventListener('click', e => {
      e.stopPropagation();
      openThisCard('wounds');
    });

    if (onSelect) {
      // Picker-style split (setup screen only): the image previews the
      // card, tapping the rest of the card body adds/removes it from
      // the draft pack.
      const img = wrap.querySelector('.card-img');
      img?.addEventListener('click', e => {
        e.stopPropagation();
        openThisCard('info');
      });
      wrap.addEventListener('click', onSelect);
    } else {
      // In play: the card is the interface. Tapping it opens a compact
      // action sheet listing only what this card can do right now
      // ("Make alpha", "Attack this", "Play this card", "Bring in…"),
      // with a "View card" button for the full-screen viewer. A card
      // with nothing to do skips the sheet and opens the viewer, as
      // it always did.
      wrap.addEventListener('click', () => {
        const actions = instance ? getContextualActions(instance) : [];
        if (actions.length === 0) { openThisCard('info'); return; }
        openCardActionSheet({
          def, instance, actions, cardEl: wrap,
          onViewCard: () => openThisCard('info'),
        });
      });
    }
  }

  render();
  return wrap;
}

// Passive visual cascade of tucked damage cards, extending sideways
// from the image (not vertically — the card row scrolls horizontally
// but has a fixed height, so a vertical addition gets silently
// clipped; sideways fits the row's native scroll direction instead).
// Purely decorative: the wound-badge is the only tap target for
// actually inspecting these cards (see openFullCard's wounds page).
// Compressed overlap for 4+ wounds keeps long stacks from pushing
// too much extra width into the row (mirrors the tabletop's own
// fanned-hand look, just sideways instead of vertically).
function buildTuckCascade(cards, categoryClass = '') {
  const sliverWidthFrac = 0.38; // each sliver's width, as a fraction of --card-w
  const slivers = cards.map((d, i) => {
    const marginFrac = i === 0 ? 0.05 : (i < 3 ? -0.20 : -0.28);
    return `
      <div class="tuck-sliver" style="width:calc(var(--card-w) * ${sliverWidthFrac}); margin-left:calc(var(--card-w) * ${marginFrac});">
        <img src="${getImagePath(d.def, false)}" alt="${d.name}"
          onerror="this.onerror=null;this.src='${placeholderUrl(d.name)}'">
      </div>
    `;
  }).join('');
  return `<div class="tuck-cascade ${categoryClass}">${slivers}</div>`;
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
// CARD ACTION SHEET — tap a card, choose what to do with it
// ═══════════════════════════════════════════════════════════════
// The compact counterpart to the full-screen viewer: a small sheet
// that slides up from the bottom with just this card's available
// actions. The tapped card stays visible above it, ringed in white.
// Tapping outside the sheet closes it; "View card" opens the viewer.
let closeActiveActionSheet = null;

function openCardActionSheet({ def, instance, actions, cardEl, onViewCard }) {
  closeActiveActionSheet?.();

  const backdrop = document.createElement('div');
  backdrop.className = 'actionsheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'actionsheet';
  backdrop.appendChild(sheet);

  const role = combatHighlights.attacking.has(instance) ? 'attacking'
             : combatHighlights.defending.has(instance) ? 'defending' : null;
  const roleText = role === 'attacking' ? '⚔ Attacking'
                 : role === 'defending' ? '🛡 Defending' : '';

  const head = document.createElement('div');
  head.className = 'actionsheet-head';
  const thumb = document.createElement('img');
  thumb.className = 'actionsheet-thumb';
  thumb.alt = def.Name || '';
  thumb.src = getImagePath(def, instance ? instance.isCrinos : false);
  thumb.onerror = function() { this.onerror = null; this.src = placeholderUrl(def.Name || 'Unknown'); };
  const titles = document.createElement('div');
  titles.className = 'actionsheet-titles';
  const nameEl = document.createElement('div');
  nameEl.className = 'actionsheet-name title-font';
  nameEl.textContent = def.Name || 'Unknown';
  const subEl = document.createElement('div');
  subEl.className = 'actionsheet-sub';
  const typeLabel = (def.Type || '').split(' - ')[0];
  subEl.textContent = typeLabel;
  if (roleText) {
    const roleEl = document.createElement('span');
    roleEl.className = `actionsheet-role actionsheet-role-${role}`;
    roleEl.textContent = roleText;
    subEl.append(' · ', roleEl);
  }
  if (instance && /^(Character|Ally|Enemy|Victim)/.test(def.Type || '')) {
    const hp = getHealthReadout(instance);
    const hpEl = document.createElement('span');
    hpEl.className = `actionsheet-hp hp-${hp.level}`;
    hpEl.textContent = hp.level === 'dying' ? `${hp.text} — dying` : hp.text;
    subEl.append(' · ', hpEl);
  }
  titles.append(nameEl, subEl);
  const viewBtn = document.createElement('button');
  viewBtn.className = 'actionsheet-view';
  viewBtn.textContent = '🔍 View card';
  head.append(thumb, titles, viewBtn);
  sheet.appendChild(head);

  const list = document.createElement('div');
  list.className = 'actionsheet-actions';
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.className = 'actionsheet-action';
    btn.textContent = action.label;
    btn.addEventListener('click', e => {
      e.stopPropagation();
      close();
      handlePlayerAction(action);
    });
    list.appendChild(btn);
  });
  sheet.appendChild(list);

  function close() {
    backdrop.remove();
    cardEl?.classList.remove('is-selected');
    if (closeActiveActionSheet === close) closeActiveActionSheet = null;
  }
  closeActiveActionSheet = close;

  backdrop.addEventListener('click', close);
  sheet.addEventListener('click', e => e.stopPropagation());
  viewBtn.addEventListener('click', e => { e.stopPropagation(); close(); onViewCard?.(); });

  cardEl?.classList.add('is-selected');
  document.body.appendChild(backdrop);
}

// ═══════════════════════════════════════════════════════════════
// FULL-SCREEN CARD VIEW — universal, used by every card everywhere
// ═══════════════════════════════════════════════════════════════
// Legal actions that specifically involve this card instance — as
// attacker, target, or the card itself — filtered from the same
// action data the fallback action bar already uses. This is what
// powers "tap a card, scroll down to what you can do with it."
function getContextualActions(inst) {
  const pool = GameState.combat
    ? getCombatRoundActions('player')
    : getLegalActions('player');
  // Pack Combat action shapes use extra field names for "the card/creature
  // this action is about": JOIN_PACK_MEMBER (.inst), JOIN_LINKED_PACKMATE
  // (.partner), PLAY_DEATH_BLOW (.dyingInst/.substituteInst), and
  // CHOOSE_DAMAGE_ORDER (nested in .play.card/.play.owner). Purely additive
  // — can only add matches, never remove ones that already worked.
  return pool.filter(a =>
    a.card === inst || a.attacker === inst || a.target === inst
    || a.inst === inst || a.partner === inst
    || a.dyingInst === inst || a.substituteInst === inst
    || a.play?.card === inst || a.play?.owner === inst
  );
}

// Unified card viewer. Two pages, both inside the same overlay:
//  - 'info'   image, flip button (dual-form), stats/text, and a
//             scrollable list of contextual actions for this card.
//  - 'wounds' horizontal swipe-through of attached injury cards,
//             reached via a marker on the image (like the flip
//             marker) or directly if opened with startPage='wounds'.
function openFullCard(def, instance, isDual, startCrinos, onClose, startPage = 'info') {
  let isCrinos = startCrinos;
  let page = startPage;
  const name   = def.Name || 'Unknown';
  const type   = def.Type || '';
  const isChar = type.startsWith('Character');
  const wounds = instance ? (instance.damageCards || []) : [];
  const contextualActions = instance ? getContextualActions(instance) : [];

  const overlay = document.createElement('div');
  overlay.className = 'fullcard-overlay';
  overlay.addEventListener('click', closeOverlay);

  const closeStrip = document.createElement('div');
  closeStrip.className = 'fullcard-close-strip';
  closeStrip.innerHTML = `<button class="fullcard-close-btn">✕ Close</button>`;
  closeStrip.addEventListener('click', e => { e.stopPropagation(); closeOverlay(); });
  overlay.appendChild(closeStrip);

  const inner = document.createElement('div');
  inner.className = 'fullcard-inner';
  inner.addEventListener('click', e => e.stopPropagation());
  overlay.appendChild(inner);

  function closeOverlay() { overlay.remove(); onClose?.(isCrinos); }

  function renderPage() {
    inner.innerHTML = '';
    if (page === 'wounds' && wounds.length) renderWoundsPage();
    else renderInfoPage();
  }

  function renderInfoPage() {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'fullcard-img-wrap';
    const cardImg = document.createElement('img');
    cardImg.className = 'fullcard-img';
    cardImg.alt = name;
    cardImg.src = getImagePath(def, isCrinos);
    cardImg.onerror = function() { this.onerror = null; this.src = placeholderUrl(name); };

    if (isDual) {
      const fl = document.createElement('button');
      fl.className = 'fullcard-flip-btn fullcard-flip-left'; fl.textContent = '⇄';
      fl.title = 'Flip to ' + (isCrinos ? 'breed' : 'crinos') + ' form';
      fl.addEventListener('click', e => { e.stopPropagation(); isCrinos = !isCrinos; renderPage(); });
      imgWrap.appendChild(fl);
    }
    imgWrap.appendChild(cardImg);
    if (isDual) {
      const fr = document.createElement('button');
      fr.className = 'fullcard-flip-btn fullcard-flip-right'; fr.textContent = '⇄';
      fr.addEventListener('click', e => { e.stopPropagation(); isCrinos = !isCrinos; renderPage(); });
      imgWrap.appendChild(fr);
    }
    if (wounds.length > 0) {
      const woundMarker = document.createElement('button');
      woundMarker.className = 'fullcard-wound-marker';
      woundMarker.textContent = `🩹 ${wounds.length}`;
      woundMarker.title = 'View attached injury cards';
      woundMarker.addEventListener('click', e => { e.stopPropagation(); page = 'wounds'; renderPage(); });
      imgWrap.appendChild(woundMarker);
    }
    inner.appendChild(imgWrap);

    const info = document.createElement('div');
    info.className = 'fullcard-info';
    info.innerHTML = `
      <div class="fullcard-name title-font">${name}</div>
      <div class="fullcard-type">${type}</div>
      ${def.Keywords ? `<div class="fullcard-kw">${def.Keywords}</div>` : ''}
      ${def.Requires ? `<div class="fullcard-req">Requires: ${def.Requires}</div>` : ''}
    `;
    const statsBlock = document.createElement('div');
    statsBlock.className = 'full-stats';
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
    info.appendChild(statsBlock);
    if (def.Text)   info.insertAdjacentHTML('beforeend', `<div class="fullcard-text">${def.Text}</div>`);
    if (def.Errata) info.insertAdjacentHTML('beforeend', `<div class="fullcard-errata">Errata: ${def.Errata}</div>`);
    inner.appendChild(info);

    // Contextual actions — scroll down to see what's actually legal
    // to do with THIS card right now. Same action data as the
    // fallback action bar, just filtered to this one card.
    if (contextualActions.length > 0) {
      const actionsBlock = document.createElement('div');
      actionsBlock.className = 'fullcard-actions';
      actionsBlock.innerHTML = `<div class="fullcard-actions-heading title-font">Actions</div>`;
      contextualActions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'fullcard-action-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', e => {
          e.stopPropagation();
          closeOverlay();
          handlePlayerAction(action);
        });
        actionsBlock.appendChild(btn);
      });
      inner.appendChild(actionsBlock);
    }
  }

  function renderWoundsPage() {
    const backBtn = document.createElement('button');
    backBtn.className = 'fullcard-close-btn fullcard-back-btn';
    backBtn.textContent = '‹ Back to card';
    backBtn.addEventListener('click', e => { e.stopPropagation(); page = 'info'; renderPage(); });
    inner.appendChild(backBtn);

    const title = document.createElement('div');
    title.className = 'swipe-title title-font';
    title.textContent = `${name} — ${wounds.length} wound${wounds.length > 1 ? 's' : ''}`;
    inner.appendChild(title);

    const track = document.createElement('div');
    track.className = 'swipe-track';
    wounds.forEach(card => {
      const p = document.createElement('div');
      p.className = 'swipe-page';
      p.innerHTML = `
        <img class="swipe-img" src="${getImagePath(card.def, false)}" alt="${card.name}"
          onerror="this.onerror=null;this.src='${placeholderUrl(card.name)}'">
        <div class="swipe-name title-font">${card.name}</div>
        ${card.def.Damage ? `<div class="swipe-dmg">Damage ${card.def.Damage}</div>` : ''}
        ${card.def.Text   ? `<div class="swipe-text">${card.def.Text}</div>` : ''}
      `;
      track.appendChild(p);
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
  }

  renderPage();
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
