import './style.css';

// ═══════════════════════════════════════════════════════════════
// Rage CCG — main.js  v2
// ═══════════════════════════════════════════════════════════════

let cardDatabase     = [];
let playerPack       = [];
let playerSeptDeck   = [];
let playerCombatDeck = [];
let renownLevel      = 20;

// Cards whose ImageFile field is corrupt in setinfo.txt
// Key = card name, value = corrected breed,crinos paths
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
    document.body.innerHTML =
      `<p style="color:red;padding:20px">Failed to load rage_cards.json: ${err.message}</p>`;
  }
}

// ── 2. IMAGE PATH ─────────────────────────────────────────────
function getImagePath(card, isCrinos = false) {
  const cardName = card.Name || card.name || '';

  // Use override table for known corrupt entries
  const override = IMAGE_OVERRIDES[cardName];
  if (override) {
    const parts = override.split(',').map(s => s.trim()).filter(Boolean);
    const file  = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (file) return `/unlimited/${file}.jpg`;
  }

  // Use ImageFile field if valid (must start with 'rage.image.')
  const raw = card.ImageFile || card.imageFile || card.Imagefile || '';
  if (raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    const file  = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (file && file.startsWith('rage.image.')) {
      return `/unlimited/${file}.jpg`;
    }
  }

  // Fallback: build path from card name + type
  return buildFallbackPath(cardName, card.Type || card.type || '', isCrinos);
}

function buildFallbackPath(name, type, isCrinos) {
  const clean = name
    .toLowerCase()
    .replace(/['''\u2018\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '.');
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

function hasCrinosForm(card) {
  const name     = card.Name || card.name || '';
  const override = IMAGE_OVERRIDES[name];
  if (override) {
    const parts = override.split(',').map(s => s.trim()).filter(Boolean);
    return parts.length > 1 && parts[1] !== '';
  }
  const raw = card.ImageFile || card.imageFile || card.Imagefile || '';
  if (raw) {
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
    return parts.length > 1 && parts[1].startsWith('rage.image.');
  }
  return (card.Type || card.type || '').startsWith('Character');
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
        <div id="chosen-pack" class="chosen-pack-row">
          <p class="empty-hint">No characters chosen yet</p>
        </div>
        <div class="setup-renown-bar">
          Pack renown: <span id="pack-renown">0</span> / <span id="pack-limit">${renownLevel}</span>
        </div>
      </div>
      <div id="setup-error" class="setup-error hidden"></div>
      <div class="setup-buttons">
        <button class="btn-primary" id="btn-random-deck">🎲 Random Pack &amp; Decks</button>
        <button class="btn-secondary" id="btn-pick-own">✋ Choose My Own</button>
      </div>
      <button class="btn-start hidden" id="btn-start-game">▶ Start Game</button>
    </div>
  `;
  document.getElementById('btn-renown-down').onclick  = () => changeRenown(-5);
  document.getElementById('btn-renown-up').onclick    = () => changeRenown(+5);
  document.getElementById('btn-random-deck').onclick  = randomDeck;
  document.getElementById('btn-pick-own').onclick     = buildPickerScreen;
  document.getElementById('btn-start-game').onclick   = startGame;
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
    rm.className = 'mini-remove'; rm.textContent = '✕';
    rm.onclick = () => { playerPack.splice(i,1); updateChosenPackDisplay(); };
    el.appendChild(rm);
    container.appendChild(el);
  });
  const errors = [];
  if (totalRenown > renownLevel)
    errors.push(`Pack renown (${totalRenown}) exceeds level (${renownLevel}).`);
  if (errors.length && errEl) {
    errEl.textContent = errors.join(' '); errEl.style.color = '#ff6666';
    errEl.classList.remove('hidden');
    if (startBtn) startBtn.classList.add('hidden');
  } else {
    if (errEl) errEl.classList.add('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
  }
}

// ── 5. RANDOM DECK ────────────────────────────────────────────
function randomDeck() {
  const chars = cardDatabase.filter(c => (c.Type||c.type||'').startsWith('Character'));
  playerPack = [];
  let used = 0;
  for (const c of shuffle(chars)) {
    const r = num(c.Renown);
    if (r > 0 && used + r <= renownLevel) {
      playerPack.push(c); used += r;
      if (playerPack.length >= 5) break;
    }
  }
  const septPool = cardDatabase.filter(c => {
    const t = (c.Type||c.type||'').toLowerCase();
    return !t.startsWith('character') && !t.startsWith('enemy') &&
           !t.startsWith('victim')    && !t.startsWith('combat');
  });
  playerSeptDeck   = buildRandomDeck(septPool, 30, 3);
  const combatPool = cardDatabase.filter(c => {
    const t = (c.Type||c.type||'').toLowerCase();
    return t.startsWith('combat action') || t.startsWith('combat event');
  });
  playerCombatDeck = buildRandomDeck(combatPool, 20, 2);
  updateChosenPackDisplay();
  const errEl = document.getElementById('setup-error');
  if (errEl) {
    errEl.textContent = `Random pack: ${playerPack.length} characters (${used} renown) | Sept: ${playerSeptDeck.length} cards | Combat: ${playerCombatDeck.length} cards`;
    errEl.style.color = '#66cc66'; errEl.classList.remove('hidden');
  }
}

function buildRandomDeck(pool, minSize, maxCopies) {
  const counts = {}; const deck = [];
  for (const card of shuffle(pool)) {
    const n = card.Name||card.name||'';
    counts[n] = (counts[n]||0) + 1;
    if (counts[n] <= maxCopies) deck.push(card);
    if (deck.length >= minSize * 2) break;
  }
  return deck;
}

// ── 6. PICKER SCREEN ──────────────────────────────────────────
function buildPickerScreen() {
  const screen = document.getElementById('screen-setup');
  const chars  = cardDatabase.filter(c => (c.Type||c.type||'').startsWith('Character'));
  screen.innerHTML = `
    <div class="picker-header">
      <button class="btn-back" id="picker-back">← Back</button>
      <h2 class="title-font picker-title">Choose Your Pack</h2>
      <div class="picker-renown">Renown: <span id="picker-used">0</span> / ${renownLevel}</div>
    </div>
    <p class="picker-hint">Tap a character to add to your pack.</p>
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
  const name = card.Name||card.name;
  const idx  = playerPack.findIndex(c => (c.Name||c.name) === name);
  if (idx >= 0) {
    playerPack.splice(idx, 1); el.classList.remove('picker-selected');
  } else {
    const used = playerPack.reduce((s,c) => s + num(c.Renown), 0);
    const r    = num(card.Renown);
    if (used + r > renownLevel) {
      const errEl = document.getElementById('picker-error');
      if (errEl) {
        errEl.textContent = `Adding ${name} (renown ${r}) would exceed the renown level of ${renownLevel}.`;
        errEl.style.color = '#ff6666'; errEl.classList.remove('hidden');
        setTimeout(() => errEl.classList.add('hidden'), 3000);
      }
      return;
    }
    playerPack.push(card); el.classList.add('picker-selected');
  }
  const used = playerPack.reduce((s,c) => s + num(c.Renown), 0);
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
    const e = document.getElementById('picker-error');
    if (e) { e.textContent='Choose at least one character.'; e.style.color='#ff6666'; e.classList.remove('hidden'); }
    return;
  }
  const savedPack = [...playerPack];
  randomDeck();
  playerPack = savedPack;
  buildSetupScreen(); showScreen('screen-setup');
  setTimeout(() => updateChosenPackDisplay(), 50);
}

// ── 7. START GAME ─────────────────────────────────────────────
function startGame() {
  if (playerPack.length === 0) return;
  const savedPack   = [...playerPack];
  const savedSept   = [...playerSeptDeck];
  const savedCombat = [...playerCombatDeck];
  randomDeck();
  const oppPack     = [...playerPack];
  playerPack        = savedPack;
  playerSeptDeck    = savedSept;
  playerCombatDeck  = savedCombat;
  showScreen('screen-game');
  setupGameBoard(playerPack, oppPack);
}

// ── 8. GAME BOARD ─────────────────────────────────────────────
function setupGameBoard(pPack, oPack) {
  const oppZone = document.querySelector('.cpu-zone .characters');
  if (oppZone) { oppZone.innerHTML = ''; oPack.forEach(c => oppZone.appendChild(createCardElement(c, false, true))); }
  const enemies = shuffle(cardDatabase.filter(c => (c.Type||c.type||'').startsWith('Enemy'))).slice(0,3);
  const hgZone = document.querySelector('.hunting-grounds .shared-cards');
  if (hgZone) { hgZone.innerHTML = ''; enemies.forEach(c => hgZone.appendChild(createCardElement(c))); }
  const pCharZone = document.querySelector('.player-zone .characters');
  if (pCharZone) { pCharZone.innerHTML = ''; pPack.forEach(c => pCharZone.appendChild(createCardElement(c))); }
  let handContainer = document.querySelector('.player-hand-container');
  if (!handContainer) {
    handContainer = document.createElement('div');
    handContainer.className = 'player-hand-container';
    handContainer.innerHTML = `<div class="zone-label title-font">Your Sept Hand</div><div class="player-hand-scroll"></div>`;
    const pz = document.querySelector('.player-zone');
    if (pz) pz.appendChild(handContainer);
  }
  const scroll = handContainer.querySelector('.player-hand-scroll');
  if (scroll) {
    scroll.innerHTML = '';
    shuffle(playerSeptDeck).slice(0,5).forEach(c => scroll.appendChild(createCardElement(c)));
  }
}

// ── 9. CARD ELEMENT ───────────────────────────────────────────
function createCardElement(card, faceDown = false, isOpponent = false) {
  const wrap     = document.createElement('div');
  wrap.className = 'card-wrap';
  const cardName = card.Name || card.name || 'Unknown';
  const cardType = card.Type || card.type || '';
  const isChar   = cardType.startsWith('Character');
  const isDual   = isChar && hasCrinosForm(card);
  let   isCrinos = false;

  function renderCard() {
    const imgPath = faceDown ? '' : getImagePath(card, isCrinos);
    let statsHtml = '';
    if (isChar) {
      const r  = num(card.Rage);             const g  = num(card.Gnosis);           const h  = num(card.Health);
      const cr = num(card.CRage)  || r;       const cg = num(card.CGnosis) || g;      const ch = num(card.CHealth) || h;
      const active = isCrinos;
      statsHtml = `
        <div class="stat-row ${!active?'stat-active':'stat-dim'}">
          <span class="stat-r">R${r}</span><span class="stat-g">G${g}</span><span class="stat-h">H${h}</span>
        </div>
        <div class="stat-row crinos-row ${active?'stat-active':'stat-dim'}">
          <span class="stat-r">R${cr}</span><span class="stat-g">G${cg}</span><span class="stat-h">H${ch}</span>
        </div>`;
      wrap.classList.toggle('is-crinos', isCrinos);
    } else {
      statsHtml = `<div class="stat-row stat-active"><span class="stat-type">${cardType.split(' - ')[0]}</span></div>`;
    }

    wrap.innerHTML = faceDown
      ? `<div class="card-face-down"></div><div class="card-label title-font">${isOpponent?'???':cardName}</div>`
      : `
        <div class="card-img-wrap">
          ${isDual ? `<button class="flip-btn flip-left" title="Flip card">⇄</button>` : ''}
          <img class="card-img" src="${imgPath}" alt="${cardName}"
            onerror="this.onerror=null;this.src='https://placehold.co/130x182/1a1a1a/ff4444?text=${encodeURIComponent(cardName)}'">
          ${isDual ? `<button class="flip-btn flip-right" title="Flip card">⇄</button>` : ''}
        </div>
        <div class="card-label title-font">${cardName}</div>
        <div class="card-stat-block">${statsHtml}</div>`;

    // Re-attach events after innerHTML wipe
    if (!faceDown) {
      // Flip buttons
      wrap.querySelectorAll('.flip-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          isCrinos = !isCrinos;
          renderCard();
        });
      });
      // Tap image → full screen
      const img = wrap.querySelector('.card-img');
      if (img) img.addEventListener('click', e => { e.stopPropagation(); openFullCard(card, isCrinos, isDual, (newForm) => { isCrinos = newForm; renderCard(); }); });
    }
  }

  renderCard();
  return wrap;
}

// ── 10. FULL-SCREEN CARD VIEW ─────────────────────────────────
function openFullCard(card, startCrinos, isDual, onClose) {
  let isCrinos = startCrinos;
  const overlay = document.createElement('div');
  overlay.className = 'fullcard-overlay';

  function renderOverlay() {
    const name    = card.Name     || card.name     || 'Unknown';
    const type    = card.Type     || card.type     || '';
    const kw      = card.Keywords || card.keywords || '';
    const text    = card.Text     || card.text     || '';
    const errata  = card.Errata   || card.errata   || '';
    const renown  = card.Renown   || card.renown   || '';
    const req     = card.Requires || card.requires || '';
    const isChar  = type.startsWith('Character');
    const imgPath = getImagePath(card, isCrinos);

    let statsHtml = '';
    if (isChar) {
      const r  = num(card.Rage);            const g  = num(card.Gnosis);          const h  = num(card.Health);
      const cr = num(card.CRage)  || r;      const cg = num(card.CGnosis) || g;     const ch = num(card.CHealth) || h;
      statsHtml = `
        <div class="full-stats">
          <div class="full-form-label ${!isCrinos?'form-active':''}">Breed</div>
          <div class="full-stat-row">
            <span class="stat-r">Rage ${r}</span>
            <span class="stat-g">Gnosis ${g}</span>
            <span class="stat-h">Health ${h}</span>
          </div>
          <div class="full-form-label crinos-row ${isCrinos?'form-active':''}">Crinos</div>
          <div class="full-stat-row">
            <span class="stat-r">Rage ${cr}</span>
            <span class="stat-g">Gnosis ${cg}</span>
            <span class="stat-h">Health ${ch}</span>
          </div>
          <div class="full-renown">Renown: ${renown}</div>
        </div>`;
    } else {
      const dmg  = card.Damage || card.damage || '';
      const rage = card.Rage   || card.rage   || '';
      statsHtml = `
        <div class="full-stats">
          ${rage   ? `<div class="full-stat-row"><span class="stat-r">Rage ${rage}</span></div>` : ''}
          ${dmg    ? `<div class="full-stat-row"><span class="stat-dmg">Damage ${dmg}</span></div>` : ''}
          ${renown ? `<div class="full-renown">Renown: ${renown}</div>` : ''}
        </div>`;
    }

    overlay.innerHTML = `
      <div class="fullcard-inner" id="fullcard-inner">
        <div class="fullcard-img-wrap">
          ${isDual ? `<button class="fullcard-flip-btn fullcard-flip-left" id="flip-l">⇄</button>` : ''}
          <img class="fullcard-img" src="${imgPath}" alt="${name}"
            onerror="this.onerror=null;this.src='https://placehold.co/400x560/1a1a1a/ff4444?text=${encodeURIComponent(name)}'">
          ${isDual ? `<button class="fullcard-flip-btn fullcard-flip-right" id="flip-r">⇄</button>` : ''}
        </div>
        <div class="fullcard-info">
          <div class="fullcard-name title-font">${name}</div>
          <div class="fullcard-type">${type}</div>
          ${kw      ? `<div class="fullcard-kw">${kw}</div>`              : ''}
          ${statsHtml}
          ${req     ? `<div class="fullcard-req">Requires: ${req}</div>`  : ''}
          ${text    ? `<div class="fullcard-text">${text}</div>`          : ''}
          ${errata  ? `<div class="fullcard-errata">Errata: ${errata}</div>` : ''}
        </div>
      </div>
    `;

    // Close on tap outside card inner
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { closeOverlay(); }
    });
    document.getElementById('fullcard-inner')?.addEventListener('click', e => e.stopPropagation());

    // Flip buttons
    document.getElementById('flip-l')?.addEventListener('click', e => { e.stopPropagation(); isCrinos = !isCrinos; renderOverlay(); });
    document.getElementById('flip-r')?.addEventListener('click', e => { e.stopPropagation(); isCrinos = !isCrinos; renderOverlay(); });
  }

  function closeOverlay() {
    overlay.remove();
    if (onClose) onClose(isCrinos);
  }

  renderOverlay();
  document.body.appendChild(overlay);
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
    <div class="browser-name title-font">${name}</div>
    <div class="browser-meta">${renown ? `<span class="meta-renown">⭐${renown}</span>` : ''}</div>
    ${kw ? `<div class="browser-kw">${kw}</div>` : ''}
  `;
  return div;
}

// ── 12. MINI CARD ─────────────────────────────────────────────
function createMiniCard(card) {
  const div     = document.createElement('div');
  div.className = 'mini-card';
  const name    = card.Name   || card.name   || '?';
  const renown  = card.Renown || card.renown || '';
  const img     = getImagePath(card, false);
  div.innerHTML = `
    <img class="mini-img" src="${img}" alt="${name}"
      onerror="this.onerror=null;this.src='https://placehold.co/60x84/1a1a1a/ff4444?text=${encodeURIComponent(name)}'">
    <div class="mini-name title-font">${name}</div>
    ${renown ? `<div class="mini-renown">⭐${renown}</div>` : ''}
  `;
  return div;
}

// ── 13. UTILITIES ─────────────────────────────────────────────
function num(val) { const n = parseInt(val); return isNaN(n) ? 0 : n; }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

// ── BOOTSTRAP ─────────────────────────────────────────────────
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
