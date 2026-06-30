import './style.css';
import {
  GameState, EventLog, makeCardInstance, isDualFormChar,
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
// ═══════════════════════════════════════════════════════════════

let cardDatabase = [];
let renownLevel  = 20;

// Setup-screen scratch state (not part of GameState until game starts)
let draftPack        = [];
let draftSeptDeck     = [];
let draftCombatDeck   = [];

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

// ═══════════════════════════════════════════════════════════════
// SETUP SCREEN
// ═══════════════════════════════════════════════════════════════
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
      </div>
      <button class="btn-start hidden" id="btn-start-game">▶ Start Game</button>
    </div>
  `;
  on('btn-renown-down', () => changeRenown(-5));
  on('btn-renown-up',   () => changeRenown(+5));
  on('btn-random-deck', randomDraft);
  on('btn-pick-own',    renderPickerScreen);
  on('btn-start-game',  startGame);
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
    const mini = buildMiniCard(def);
    const rm = document.createElement('button');
    rm.className = 'mini-remove'; rm.textContent = '✕';
    rm.onclick = () => { draftPack.splice(i, 1); refreshChosenPackDisplay(); };
    mini.appendChild(rm);
    container.appendChild(mini);
  });

  const errEl = el('setup-error');
  if (total > renownLevel) {
    setText('setup-error', `Pack renown (${total}) exceeds level (${renownLevel}).`);
    errEl.style.color = '#ff6666'; errEl.classList.remove('hidden');
    el('btn-start-game')?.classList.add('hidden');
  } else {
    errEl.classList.add('hidden');
    el('btn-start-game')?.classList.remove('hidden');
  }
}

// ── Random draft (for playtesting) ────────────────────────────
function randomDraft() {
  const chars = cardDatabase.filter(c => (c.Type||'').startsWith('Character'));
  draftPack = [];
  let used = 0;
  for (const c of shuffle(chars)) {
    const r = num(c.Renown);
    if (r > 0 && used + r <= renownLevel) { draftPack.push(c); used += r; }
    if (draftPack.length >= 5) break;
  }
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

  refreshChosenPackDisplay();
  setText('setup-error',
    `Random pack: ${draftPack.length} characters (${used} renown) | Sept: ${draftSeptDeck.length} | Combat: ${draftCombatDeck.length}`);
  const errEl = el('setup-error');
  errEl.style.color = '#66cc66'; errEl.classList.remove('hidden');
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
  chars.forEach(def => {
    const card = buildBrowserCard(def);
    // Mark as selected if already in draftPack (e.g. user came from Random Pack)
    if (draftPack.some(c => c.Name === def.Name)) {
      card.classList.add('picker-selected');
    }
    card.addEventListener('click', () => togglePick(def, card));
    grid.appendChild(card);
  });

  // Initialise the used-renown counter and mini pack row to match current draftPack
  setText('picker-used', draftPack.reduce((s,c) => s + num(c.Renown), 0));
  const row = el('picker-pack');
  draftPack.forEach(c => row.appendChild(buildMiniCard(c)));
}

function togglePick(def, cardEl) {
  const name = def.Name;
  const idx  = draftPack.findIndex(c => c.Name === name);
  if (idx >= 0) {
    draftPack.splice(idx, 1); cardEl.classList.remove('picker-selected');
  } else {
    const used = draftPack.reduce((s,c) => s + num(c.Renown), 0);
    const r    = num(def.Renown);
    if (used + r > renownLevel) {
      flashPickerError(`Adding ${name} (renown ${r}) would exceed the renown level of ${renownLevel}.`);
      return;
    }
    draftPack.push(def); cardEl.classList.add('picker-selected');
  }
  setText('picker-used', draftPack.reduce((s,c) => s + num(c.Renown), 0));
  const row = el('picker-pack');
  row.innerHTML = '';
  draftPack.forEach(c => row.appendChild(buildMiniCard(c)));
}

function flashPickerError(msg) {
  const e = el('picker-error');
  e.textContent = msg; e.style.color = '#ff6666'; e.classList.remove('hidden');
  setTimeout(() => e.classList.add('hidden'), 3000);
}

function confirmPicker() {
  if (draftPack.length === 0) { flashPickerError('Choose at least one character.'); return; }
  const kept = [...draftPack];
  randomDraft();          // builds sept/combat decks
  draftPack = kept;        // keep the manually chosen pack
  renderSetupScreen(); showScreen('screen-setup');
  setTimeout(refreshChosenPackDisplay, 50);
}

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

  // Build opponent draft independently
  const savedPack = draftPack, savedSept = draftSeptDeck, savedCombat = draftCombatDeck;
  randomDraft();
  const opponentData = {
    characters: draftPack,
    sept:       draftSeptDeck,
    combat:     draftCombatDeck,
  };
  draftPack = savedPack; draftSeptDeck = savedSept; draftCombatDeck = savedCombat;

  // NB: initGame is imported lazily here to avoid circular import issues
  import('./game.js').then(({ initGame }) => {
    initGame(playerData, opponentData, renownLevel);
    showScreen('screen-game');
    renderGameBoard();
  });
}

// ═══════════════════════════════════════════════════════════════
// GAME BOARD — reads GameState, never mutates it directly
// ═══════════════════════════════════════════════════════════════
function renderGameBoard() {
  renderPhaseBar();
  renderZone('.cpu-zone .characters',    GameState.opponent.pack, true);
  renderZone('.hunting-grounds .shared-cards', GameState.huntingGrounds, false);
  renderZone('.player-zone .characters', GameState.player.pack,  false);
  renderHand();
  renderActionBar();
}

function renderPhaseBar() {
  let bar = el('phase-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'phase-bar';
    el('screen-game').insertBefore(bar, el('screen-game').firstChild);
  }
  bar.innerHTML = `
    <span class="phase-turn title-font">Turn ${GameState.turn}</span>
    <span class="phase-list">
      ${PHASES.map(p => `<span class="phase-pill ${p===GameState.phase?'phase-active':''}">${p}</span>`).join('')}
    </span>
    <span class="phase-vp">You ${countVP(GameState.player)} — Opp ${countVP(GameState.opponent)} (target ${GameState.renownLevel})</span>
  `;
}

function renderZone(selector, instances, isOpponent) {
  const zone = document.querySelector(selector);
  if (!zone) return;
  zone.innerHTML = '';
  instances.forEach(inst => zone.appendChild(buildBoardCard(inst, isOpponent)));
}

function renderHand() {
  let container = document.querySelector('.player-hand-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'player-hand-container';
    container.innerHTML = `<div class="zone-label title-font">Your Sept Hand</div><div class="player-hand-scroll"></div>`;
    document.querySelector('.player-zone')?.appendChild(container);
  }
  const scroll = container.querySelector('.player-hand-scroll');
  scroll.innerHTML = '';
  GameState.player.septHand.forEach(inst => scroll.appendChild(buildBoardCard(inst, false)));
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
    ? getCombatRoundActions('player')
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
  let result;
  if (GameState.combat) {
    performCombatAction('player', action);
  } else if (action.type === 'DECLARE_ATTACK') {
    declareAttack('player', action.attacker, action.target);
  } else {
    result = performAction('player', action);
  }
  runOpponentTurnIfNeeded();
  renderGameBoard();
  checkGameOverUI();
}

// Extremely simple AI for V1: random legal action each time it's
// the opponent's turn to act in combat or phases that need input.
function runOpponentTurnIfNeeded() {
  // V1: opponent auto-passes through non-combat phases instantly,
  // and plays a random legal combat card when in combat.
  if (GameState.combat) {
    const oppActions = getCombatRoundActions('opponent')
      .filter(a => a.type !== 'WAITING');
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
// CARD BUILDERS (shared visual logic — unchanged from prior version)
// ═══════════════════════════════════════════════════════════════
function buildBoardCard(inst, isOpponent) {
  const wrap = document.createElement('div');
  wrap.className = 'card-wrap';
  const def      = inst.def;
  const cardName = def.Name || 'Unknown';
  const isChar   = (def.Type || '').startsWith('Character');
  const isDual   = inst.isDualForm;

  function render() {
    const imgPath = getImagePath(def, inst.isCrinos);
    let statsHtml = '';
    if (isChar) {
      const r  = effectiveRage(inst),   g  = effectiveGnosis(inst), h = effectiveHealth(inst);
      const dmg = totalDamage(inst);
      statsHtml = `
        <div class="stat-row stat-active">
          <span class="stat-r">R${r}</span><span class="stat-g">G${g}</span><span class="stat-h">H${h}</span>
          ${dmg ? `<span class="stat-dmg">−${dmg}</span>` : ''}
        </div>
        <div class="stat-row stat-dim">${inst.isCrinos ? 'Crinos' : 'Breed'} form</div>`;
      wrap.classList.toggle('is-crinos', inst.isCrinos);
    } else {
      statsHtml = `<div class="stat-row stat-active"><span class="stat-type">${(def.Type||'').split(' - ')[0]}</span></div>`;
    }

    wrap.innerHTML = `
      <div class="card-img-wrap">
        ${isDual ? `<button class="flip-btn flip-left" title="Flip card">⇄</button>` : ''}
        <img class="card-img" src="${imgPath}" alt="${cardName}"
          onerror="this.onerror=null;this.src='${placeholderUrl(cardName)}'">
        ${isDual ? `<button class="flip-btn flip-right" title="Flip card">⇄</button>` : ''}
      </div>
      <div class="card-label title-font">${isOpponent && false ? '???' : cardName}</div>
      <div class="card-stat-block">${statsHtml}</div>
    `;

    wrap.querySelectorAll('.flip-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (isDual) { inst.isCrinos = !inst.isCrinos; render(); }
      });
    });
    const img = wrap.querySelector('.card-img');
    img?.addEventListener('click', e => {
      e.stopPropagation();
      openFullCard(def, inst.isCrinos, isDual, newForm => { inst.isCrinos = newForm; render(); });
    });
  }

  render();
  return wrap;
}

function buildBrowserCard(def) {
  const div = document.createElement('div');
  div.className = 'browser-card';
  const name = def.Name || 'Unknown';
  div.innerHTML = `
    <div class="browser-img-wrap">
      <img class="browser-img" src="${getImagePath(def,false)}" alt="${name}"
        onerror="this.onerror=null;this.src='${placeholderUrl(name)}'">
    </div>
    <div class="browser-name title-font">${name}</div>
    <div class="browser-meta">${def.Renown ? `<span class="meta-renown">⭐${def.Renown}</span>` : ''}</div>
    ${def.Keywords ? `<div class="browser-kw">${def.Keywords}</div>` : ''}
  `;
  return div;
}

function buildMiniCard(def) {
  const div = document.createElement('div');
  div.className = 'mini-card';
  const name = def.Name || '?';
  div.innerHTML = `
    <img class="mini-img" src="${getImagePath(def,false)}" alt="${name}"
      onerror="this.onerror=null;this.src='${placeholderUrl(name)}'">
    <div class="mini-name title-font">${name}</div>
    ${def.Renown ? `<div class="mini-renown">⭐${def.Renown}</div>` : ''}
  `;
  return div;
}

// ═══════════════════════════════════════════════════════════════
// FULL-SCREEN CARD VIEW (unchanged behaviour from prior version)
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
      <section class="zone cpu-zone">
        <div class="zone-label title-font">Opponent Pack</div>
        <div class="card-row characters"></div>
      </section>
      <section class="zone hunting-grounds">
        <div class="zone-label title-font">Hunting Grounds</div>
        <div class="card-row shared-cards"></div>
      </section>
      <section class="zone player-zone">
        <div class="zone-label title-font">Your Pack</div>
        <div class="card-row characters"></div>
      </section>
    </div>
  `;
  loadCards();
});
