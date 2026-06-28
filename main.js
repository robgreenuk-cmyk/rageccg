import './style.css';

// ═══════════════════════════════════════════════════════════════
// Rage CCG — main.js
// ═══════════════════════════════════════════════════════════════

let cardDatabase     = [];
let playerPack       = [];
let playerSeptDeck   = [];
let playerCombatDeck = [];
let renownLevel      = 20;

// ── 1. LOAD CARDS ─────────────────────────────────────────────
async function loadCards() {
  try {
    const res = await fetch('/rage_cards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const all = Array.isArray(raw) ? raw : Object.values(raw);
    cardDatabase = all.filter(c => (c.Expansion || c.expansion || '') === 'Unlimited');
    console.log(`✅ Loaded ${cardDatabase.length} Unlimited cards`);
    buildSetupScreen();
    showScreen('screen-setup');
  } catch (err) {
    console.error('❌', err);
    document.body.innerHTML = `<p style="color:red;padding:20px">Failed to load rage_cards.json: ${err.message}</p>`;
  }
}

// ── 2. IMAGE PATH ─────────────────────────────────────────────
function getImagePath(card, isCrinos = false) {
  const raw = card.ImageFile || card.imageFile || card.Imagefile || '';
  if (raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const file  = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (file) return `/unlimited/${file}.jpg`;
  }
  const name = (card.Name || card.name || '')
    .toLowerCase().replace(/['']/g,'').replace(/[^a-z0-9\s]/g,' ').trim().replace(/\s+/g,'.');
  const t = (card.Type || card.type || '').toLowerCase();
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
  return `/unlimited/rage.image.${seg}.${name}.jpg`;
}

// ── 3. SCREEN MANAGER ─────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ── 4. SETUP SCREEN ───────────────────────────────────────────
function buildSetupScreen() {
  const screen = document.getElementById('screen-setup');
  if (!screen) return;
  screen.innerHTML = `
    <div class="setup-header">
      <h1 class="game-title">RAGE</h1>
      <p class="game-subtitle">Werewolf: The Apocalypse CCG — Unlimited Edition</p>
    </div>
    <div class="setup-body">
      <div class="setup-section">
        <label class="setup-label">Renown Level</label>
        <div class="renown-picker">
          <button class="btn-sm" id="btn-renown-down">−5</button>
          <span id="renown-display">${renownLevel}</span>
          <button class="btn-sm" id="btn-renown-up">+5</button>
        </div>
        <p class="setup-hint">Characters' combined renown must not exceed this. First player to reach it in VP wins.</p>
      </div>
      <div class="setup-section">
        <label class="setup-label">Your Pack</label>
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

  document.getElementById('btn-renown-down').onclick = () => changeRenown(-5);
  document.getElementById('btn-renown-up').onclick   = () => changeRenown(+5);
  document.getElementById('btn-random-deck').onclick = randomDeck;
  document.getElementById('btn-pick-own').onclick    = buildPickerScreen;
  document.getElementById('btn-start-game').onclick  = startGame;
}

function changeRenown(delta) {
  renownLevel = Math.max(10, Math.min(50, renownLevel + delta));
  const d = document.getElementById('renown-display');
  const l = document.getElementById('pack-limit');
  if (d) d.textContent = renownLevel;
  if (l) l.textContent = renownLevel;
  updateChosenPackDisplay();
}

function updateChosenPackDisplay() {
  const container = document.getElementById('chosen-pack');
  const renownEl  = document.getElementById('pack-renown');
  const startBtn  = document.getElementById('btn-start-game');
  const errEl     = document.getElementById('setup-error');
  if (!container) return;

  const totalRenown = playerPack.reduce((s, c) => s + num(c.Renown), 0);
  if (renownEl) renownEl.textContent = totalRenown;

  if (playerPack.length === 0) {
    container.innerHTML = '<p class="empty-hint">No characters chosen yet</p>';
    if (startBtn) startBtn.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  playerPack.forEach((card, i) => {
    const el = createMiniCard(card);
    const rm = document.createElement('button');
    rm.className   = 'mini-remove';
    rm.textContent = '✕';
    rm.onclick     = () => { playerPack.splice(i, 1); updateChosenPackDisplay(); };
    el.appendChild(rm);
    container.appendChild(el);
  });

  const errors = [];
  if (totalRenown > renownLevel)
    errors.push(`Pack renown (${totalRenown}) exceeds level (${renownLevel}).`);

  if (errors.length && errEl) {
    errEl.textContent = errors.join(' ');
    errEl.style.color = '#ff6666';
    errEl.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
  } else {
    if (errEl) errEl.classList.add('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
  }
}

// ── 5. RANDOM DECK ────────────────────────────────────────────
function randomDeck() {
  const chars = cardDatabase.filter(c => (c.Type || c.type || '').startsWith('Character'));
  const shuffled = shuffle(chars);
  playerPack = [];
  let used = 0;
  for (const c of shuffled) {
    const r = num(c.Renown);
    if (r > 0 && used + r <= renownLevel) {
      playerPack.push(c);
      used += r;
      if (playerPack.length >= 5) break;
    }
  }

  const septPool = cardDatabase.filter(c => {
    const t = (c.Type || c.type || '').toLowerCase();
    return !t.startsWith('character') && !t.startsWith('enemy') &&
           !t.startsWith('victim')    && !t.startsWith('combat');
  });
  playerSeptDeck = buildRandomDeck(septPool, 30, 3);

  const combatPool = cardDatabase.filter(c => {
    const t = (c.Type || c.type || '').toLowerCase();
    return t.startsWith('combat action') || t.startsWith('combat event');
  });
  playerCombatDeck = buildRandomDeck(combatPool, 20, 2);

  updateChosenPackDisplay();

  const errEl = document.getElementById('setup-error');
  if (errEl) {
    errEl.textContent = `Random pack: ${playerPack.length} characters (${used} renown) | Sept: ${playerSeptDeck.length} cards | Combat: ${playerCombatDeck.length} cards`;
    errEl.style.color = '#66cc66';
    errEl.classList.remove('hidden');
  }
}

function buildRandomDeck(pool, minSize, maxCopies) {
  const shuffled = shuffle(pool);
  const counts = {};
  const deck   = [];
  for (const card of shuffled) {
    const n = card.Name || card.name || '';
    counts[n] = (counts[n] || 0) + 1;
    if (counts[n] <= maxCopies) deck.push(card);
    if (deck.length >= minSize * 2) break;
  }
  return deck;
}

// ── 6. PICKER SCREEN ──────────────────────────────────────────
function buildPickerScreen() {
  const screen = document.getElementById('screen-setup');
  const chars  = cardDatabase.filter(c => (c.Type || c.type || '').startsWith('Character'));

  screen.innerHTML = `
    <div class="picker-header">
      <button class="btn-back" id="picker-back">← Back</button>
      <h2 class="picker-title">Choose Your Pack</h2>
      <div class="picker-renown">Renown: <span id="picker-used">0</span> / ${renownLevel}</div>
    </div>
    <p class="picker-hint">Tap a character card to add to your pack. Tap ✕ to remove.</p>
    <div id="picker-pack" class="chosen-pack-row"></div>
    <div id="picker-error" class="setup-error hidden"></div>
    <div id="picker-grid" class="picker-grid"></div>
    <div class="picker-footer">
      <button class="btn-primary" id="picker-confirm">Confirm Pack →</button>
    </div>
  `;

  document.getElementById('picker-back').onclick    = () => { buildSetupScreen(); showScreen('screen-setup'); };
  document.getElementById('picker-confirm').onclick = confirmPicker;

  const grid = document.getElementById('picker-grid');
  chars.forEach(card => {
    const el = createBrowserCard(card);
    el.addEventListener('click', () => pickerToggle(card, el));
    grid.appendChild(el);
  });
}

function pickerToggle(card, el) {
  const name = card.Name || card.name;
  const idx  = playerPack.findIndex(c => (c.Name || c.name) === name);
  if (idx >= 0) {
    playerPack.splice(idx, 1);
    el.classList.remove('picker-selected');
  } else {
    const used = playerPack.reduce((s, c) => s + num(c.Renown), 0);
    const r    = num(card.Renown);
    if (used + r > renownLevel) {
      const errEl = document.getElementById('picker-error');
      if (errEl) {
        errEl.textContent = `Adding ${name} (renown ${r}) would exceed the renown level of ${renownLevel}.`;
        errEl.style.color = '#ff6666';
        errEl.classList.remove('hidden');
        setTimeout(() => errEl.classList.add('hidden'), 3000);
      }
      return;
    }
    playerPack.push(card);
    el.classList.add('picker-selected');
  }
  const used   = playerPack.reduce((s, c) => s + num(c.Renown), 0);
  const usedEl = document.getElementById('picker-used');
  if (usedEl) usedEl.textContent = used;
  const packRow = document.getElementById('picker-pack');
  if (packRow) {
    packRow.innerHTML = '';
    playerPack.forEach(c => packRow.appendChild(createMiniCard(c)));
  }
}

function confirmPicker() {
  if (playerPack.length === 0) {
    const errEl = document.getElementById('picker-error');
    if (errEl) {
      errEl.textContent = 'Choose at least one character.';
      errEl.style.color = '#ff6666';
      errEl.classList.remove('hidden');
    }
    return;
  }
  const savedPack = [...playerPack];
  // Generate decks, then restore chosen pack
  randomDeck();
  playerPack = savedPack;
  buildSetupScreen();
  showScreen('screen-setup');
  setTimeout(() => updateChosenPackDisplay(), 50);
}

// ── 7. START GAME ─────────────────────────────────────────────
function startGame() {
  if (playerPack.length === 0) return;
  // Save player pack, build opponent pack via randomDeck, restore
  const savedPack  = [...playerPack];
  const savedSept  = [...playerSeptDeck];
  const savedCombat= [...playerCombatDeck];
  randomDeck();
  const oppPack    = [...playerPack];
  playerPack       = savedPack;
  playerSeptDeck   = savedSept;
  playerCombatDeck = savedCombat;

  showScreen('screen-game');
  setupGameBoard(playerPack, oppPack);
}

// ── 8. GAME BOARD ─────────────────────────────────────────────
function setupGameBoard(pPack, oPack) {
  const oppZone = document.querySelector('.cpu-zone .characters');
  if (oppZone) {
    oppZone.innerHTML = '';
    oPack.forEach(c => oppZone.appendChild(createCardElement(c, false, true)));
  }

  const enemies = shuffle(cardDatabase.filter(c =>
    (c.Type || c.type || '').startsWith('Enemy')
  )).slice(0, 3);
  const hgZone = document.querySelector('.hunting-grounds .shared-cards');
  if (hgZone) {
    hgZone.innerHTML = '';
    enemies.forEach(c => hgZone.appendChild(createCardElement(c)));
  }

  const pCharZone = document.querySelector('.player-zone .characters');
  if (pCharZone) {
    pCharZone.innerHTML = '';
    pPack.forEach(c => pCharZone.appendChild(createCardElement(c)));
  }

  // Player sept hand
  let handContainer = document.querySelector('.player-hand-container');
  if (!handContainer) {
    handContainer = document.createElement('div');
    handContainer.className = 'player-hand-container';
    handContainer.innerHTML = `
      <div class="zone-label">Your Sept Hand</div>
      <div class="player-hand-scroll"></div>`;
    const pz = document.querySelector('.player-zone');
    if (pz) pz.appendChild(handContainer);
  }
  const scroll = handContainer.querySelector('.player-hand-scroll');
  if (scroll) {
    scroll.innerHTML = '';
    shuffle(playerSeptDeck).slice(0, 5).forEach(c =>
      scroll.appendChild(createCardElement(c))
    );
  }
}

// ── 9. CARD ELEMENT (board) ───────────────────────────────────
function createCardElement(card, faceDown = false, isOpponent = false) {
  const div      = document.createElement('div');
  div.className  = 'card-slot';
  if (isOpponent) div.classList.add('opponent-card');
  let isCrinos   = false;
  const cardName = card.Name || card.name || 'Unknown';
  const cardType = card.Type || card.type || '';
  const isChar   = cardType.startsWith('Character');

  function render() {
    const imgPath = faceDown ? '' : getImagePath(card, isCrinos);
    let statsHtml = '';
    if (isChar) {
      const r  = num(card.Rage);               const g  = num(card.Gnosis);             const h  = num(card.Health);
      const cr = num(card.CRage)  || r;         const cg = num(card.CGnosis) || g;        const ch = num(card.CHealth) || h;
      statsHtml = `
        <div class="stat-line ${!isCrinos?'active-stat':'dimmed-stat'}">R${r} G${g} H${h}</div>
        <div class="stat-line crinos-text ${isCrinos?'active-stat':'dimmed-stat'}">R${cr} G${cg} H${ch}</div>`;
      div.classList.toggle('crinos-form', isCrinos);
    } else {
      statsHtml = `<div class="stat-line active-stat">${cardType.split(' - ')[0]}</div>`;
    }
    div.innerHTML = faceDown
      ? `<div class="card-face-down"></div><div class="card-name">${isOpponent ? '???' : cardName}</div>`
      : `
        <div class="card-image-container">
          <img class="card-art" src="${imgPath}" alt="${cardName}"
            onerror="this.onerror=null;this.src='https://placehold.co/120x150/1a1a1a/ff4444?text=${encodeURIComponent(cardName)}'">
        </div>
        <div class="card-name">${cardName}</div>
        <div class="card-stats">${statsHtml}</div>`;
  }

  div.addEventListener('click', (e) => {
    if (!faceDown) {
      if (isChar) { isCrinos = !isCrinos; render(); }
      showCardDetail(card, isCrinos);
    }
    e.stopPropagation();
  });

  render();
  return div;
}

// ── 10. CARD DETAIL PANEL ─────────────────────────────────────
function showCardDetail(card, isCrinos = false) {
  let panel = document.getElementById('card-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'card-detail-panel';
    document.body.appendChild(panel);
  }

  const name   = card.Name     || card.name     || 'Unknown';
  const type   = card.Type     || card.type     || '';
  const kw     = card.Keywords || card.keywords || '';
  const text   = card.Text     || card.text     || '';
  const errata = card.Errata   || card.errata   || '';
  const renown = card.Renown   || card.renown   || '';
  const req    = card.Requires || card.requires || '';
  const isChar = type.startsWith('Character');
  const img    = getImagePath(card, isCrinos);

  let statsBlock = '';
  if (isChar) {
    const r  = num(card.Rage);    const g  = num(card.Gnosis);   const h  = num(card.Health);
    const cr = num(card.CRage)||r; const cg = num(card.CGnosis)||g; const ch = num(card.CHealth)||h;
    statsBlock = `
      <div class="detail-stats">
        <div class="detail-form-label">Breed form</div>
        <div class="detail-stat-row">
          <span class="stat-rage">Rage ${r}</span>
          <span class="stat-gnosis">Gnosis ${g}</span>
          <span class="stat-health">Health ${h}</span>
        </div>
        <div class="detail-form-label crinos-text">Crinos form</div>
        <div class="detail-stat-row">
          <span class="stat-rage">Rage ${cr}</span>
          <span class="stat-gnosis">Gnosis ${cg}</span>
          <span class="stat-health">Health ${ch}</span>
        </div>
        <div class="detail-renown">Renown: ${renown}</div>
      </div>`;
  } else {
    const dmg  = card.Damage || card.damage || '';
    const rage = card.Rage   || card.rage   || '';
    statsBlock = `
      <div class="detail-stats">
        ${rage   ? `<div class="detail-stat-row"><span class="stat-rage">Rage ${rage}</span></div>` : ''}
        ${dmg    ? `<div class="detail-stat-row"><span class="stat-damage">Damage ${dmg}</span></div>` : ''}
        ${renown ? `<div class="detail-renown">Renown: ${renown}</div>` : ''}
      </div>`;
  }

  panel.innerHTML = `
    <button class="btn-close-detail" id="btn-close-detail">✕</button>
    <div class="detail-image-wrap">
      <img class="detail-img" src="${img}" alt="${name}"
        onerror="this.onerror=null;this.src='https://placehold.co/200x280/1a1a1a/ff4444?text=${encodeURIComponent(name)}'">
    </div>
    <div class="detail-name">${name}</div>
    <div class="detail-type">${type}</div>
    ${kw     ? `<div class="detail-keywords">${kw}</div>`       : ''}
    ${statsBlock}
    ${req    ? `<div class="detail-requires">Requires: ${req}</div>` : ''}
    ${text   ? `<div class="detail-text">${text}</div>`         : ''}
    ${errata ? `<div class="detail-errata">Errata: ${errata}</div>` : ''}
  `;

  panel.classList.add('active');

  document.getElementById('btn-close-detail').onclick = () =>
    panel.classList.remove('active');

  setTimeout(() => {
    function outside(e) {
      if (!panel.contains(e.target)) {
        panel.classList.remove('active');
        document.removeEventListener('click', outside);
      }
    }
    document.addEventListener('click', outside);
  }, 50);
}

// ── 11. BROWSER CARD (picker) ─────────────────────────────────
function createBrowserCard(card) {
  const div     = document.createElement('div');
  div.className = 'browser-card';
  const name    = card.Name    || card.name    || 'Unknown';
  const renown  = card.Renown  || card.renown  || '';
  const kw      = card.Keywords|| card.keywords|| '';
  const img     = getImagePath(card, false);
  div.innerHTML = `
    <div class="browser-img-wrap">
      <img class="browser-img" src="${img}" alt="${name}"
        onerror="this.onerror=null;this.src='https://placehold.co/120x80/1a1a1a/ff4444?text=${encodeURIComponent(name)}'">
    </div>
    <div class="browser-name">${name}</div>
    <div class="browser-meta">
      ${renown ? `<span class="meta-renown">⭐${renown}</span>` : ''}
    </div>
    ${kw ? `<div class="browser-kw">${kw}</div>` : ''}
  `;
  return div;
}

// ── 12. MINI CARD (setup summary) ────────────────────────────
function createMiniCard(card) {
  const div     = document.createElement('div');
  div.className = 'mini-card';
  const name    = card.Name   || card.name   || '?';
  const renown  = card.Renown || card.renown || '';
  const img     = getImagePath(card, false);
  div.innerHTML = `
    <img class="mini-img" src="${img}" alt="${name}"
      onerror="this.onerror=null;this.src='https://placehold.co/60x84/1a1a1a/ff4444?text=${encodeURIComponent(name)}'">
    <div class="mini-name">${name}</div>
    ${renown ? `<div class="mini-renown">⭐${renown}</div>` : ''}
  `;
  return div;
}

// ── 13. UTILITIES ─────────────────────────────────────────────
function num(val) { const n = parseInt(val); return isNaN(n) ? 0 : n; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── BOOTSTRAP ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app') || document.body;
  // Inject all screen scaffolding
  app.innerHTML = `
    <div id="screen-loading" class="screen active">
      <div class="loading-content">
        <div class="game-title">RAGE</div>
        <div class="loading-text">Loading cards…</div>
      </div>
    </div>
    <div id="screen-setup" class="screen"></div>
    <div id="screen-game" class="screen">
      <section class="zone cpu-zone">
        <div class="zone-label">Opponent Pack</div>
        <div class="card-row characters"></div>
      </section>
      <section class="zone hunting-grounds">
        <div class="zone-label">Hunting Grounds</div>
        <div class="card-row shared-cards"></div>
      </section>
      <section class="zone player-zone">
        <div class="zone-label">Your Pack</div>
        <div class="card-row characters"></div>
      </section>
    </div>
  `;
  loadCards();
});
