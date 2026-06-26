import './style.css';

// ── Load card database from public/rage_cards.json ───────────────
// rage_cards.json is a plain object keyed by card name:
// { "Sneak Attack": { "Name": "Sneak Attack", "Type": "Action",
//                     "ImageFile": "rage.image.action.sneak.attack", ... }, ... }

let cardDatabase = [];

async function loadCards() {
  try {
    const response = await fetch('/rage_cards.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();

    // rage_cards.json is an object keyed by card name — convert to array
    cardDatabase = Object.values(raw)
      .filter(c => c && (c.Name || c.name))   // skip empty entries
      .filter(c => {
        // Only load Unlimited set for now
        const exp = c.Expansion || c.expansion || '';
        return exp === 'Unlimited' || exp === '';
      });

    console.log(`✅ Loaded ${cardDatabase.length} cards`);
    setupInitialBoard();
  } catch (err) {
    console.error('❌ Failed to load rage_cards.json:', err);
    document.body.innerHTML =
      `<p style="color:red;padding:20px">Failed to load card data: ${err.message}</p>`;
  }
}

// ── Image path builder ────────────────────────────────────────────
// rage_cards.json stores ImageFile WITHOUT the .jpg extension, e.g.:
//   "rage.image.action.sneak.attack"
//   "rage.image.garou.allison.kachina,rage.image.crinos.allison.kachina"
// Images live at: /unlimited/{imageFile}.jpg
//
// For character cards, ImageFile may contain two comma-separated values:
//   index 0 = breed/homid form
//   index 1 = crinos/battle form

function getImagePath(card, isCrinos = false) {
  const imageFile = card.ImageFile || card.imageFile || card.Imagefile || '';

  if (imageFile) {
    const parts = imageFile.split(',').map(s => s.trim()).filter(Boolean);
    const chosen = (isCrinos && parts.length > 1) ? parts[1] : parts[0];
    if (chosen) {
      return `/unlimited/${chosen}.jpg`;
    }
  }

  // Fallback: build path algorithmically from card name + type
  return buildFallbackPath(card, isCrinos);
}

function buildFallbackPath(card, isCrinos) {
  const rawName = card.Name || card.name || '';
  const rawType = (card.Type || card.type || '').toLowerCase();

  // Normalise name: lowercase, remove punctuation, spaces → dots
  const cleanName = rawName
    .toLowerCase()
    .replace(/['']/g, '')          // remove apostrophes
    .replace(/[^a-z0-9\s]/g, ' ') // other punctuation → space
    .trim()
    .replace(/\s+/g, '.');         // spaces → dots

  let segment = 'action';
  if (rawType.startsWith('character')) {
    segment = isCrinos ? 'crinos' : 'garou';
  } else if (rawType.startsWith('combat action')) {
    segment = 'combat.action';
  } else if (rawType.startsWith('combat event')) {
    segment = 'combat.event';
  } else if (rawType.startsWith('gift')) {
    segment = 'gift';
  } else if (rawType.startsWith('equipment')) {
    segment = 'equipment';
  } else if (rawType.startsWith('moot')) {
    segment = 'moot';
  } else if (rawType.startsWith('ally')) {
    segment = 'ally';
  } else if (rawType.startsWith('enemy')) {
    segment = 'enemy';
  } else if (rawType.startsWith('past life')) {
    segment = 'past.life';
  } else if (rawType.startsWith('rite')) {
    segment = 'rite';
  } else if (rawType.startsWith('quest')) {
    segment = 'quest';
  } else if (rawType.startsWith('event')) {
    segment = 'event';
  }

  const path = `/unlimited/rage.image.${segment}.${cleanName}.jpg`;
  console.warn(`⚠️  No ImageFile for "${rawName}" — using fallback: ${path}`);
  return path;
}

// ── Board setup ───────────────────────────────────────────────────
function setupInitialBoard() {
  const characters = cardDatabase.filter(c =>
    (c.Type || c.type || '').startsWith('Character')
  );
  const enemies = cardDatabase.filter(c =>
    (c.Type || c.type || '').startsWith('Enemy')
  );
  const handPool = cardDatabase.filter(c => {
    const t = c.Type || c.type || '';
    return !t.startsWith('Character') &&
           !t.startsWith('Enemy') &&
           !t.startsWith('Victim');
  });

  // ── Player pack ────────────────────────────────────────────────
  const pCharZone = document.querySelector('.player-zone .characters');
  if (pCharZone) {
    pCharZone.innerHTML = '';
    characters.slice(0, 2).forEach(card => {
      pCharZone.appendChild(createCardElement(card));
    });
  }

  // ── Hunting grounds ────────────────────────────────────────────
  const hgZone = document.querySelector('.hunting-grounds .shared-cards');
  if (hgZone) {
    hgZone.innerHTML = '';
    enemies.slice(0, 2).forEach(card => {
      hgZone.appendChild(createCardElement(card));
    });
  }

  // ── Player hand ────────────────────────────────────────────────
  let handContainer = document.querySelector('.player-hand-container');
  if (!handContainer) {
    const appWrapper = document.querySelector('#app') || document.body;
    handContainer = document.createElement('div');
    handContainer.className = 'player-hand-container';
    handContainer.innerHTML = `
      <div class="zone-title">Your Hand</div>
      <div class="player-hand-scroll"></div>
    `;
    appWrapper.appendChild(handContainer);
  }

  const handScrollZone = handContainer.querySelector('.player-hand-scroll');
  if (handScrollZone) {
    handScrollZone.innerHTML = '';
    const shuffled = [...handPool].sort(() => Math.random() - 0.5);
    shuffled.slice(0, 5).forEach(card => {
      handScrollZone.appendChild(createCardElement(card));
    });
  }
}

// ── Card element builder ──────────────────────────────────────────
function createCardElement(card) {
  const div = document.createElement('div');
  div.className = 'card-slot';

  const cardName = card.Name  || card.name  || 'Unknown';
  const cardType = card.Type  || card.type  || '';
  const isChar   = cardType.startsWith('Character');
  let   isCrinos = false;

  function render() {
    const imagePath = getImagePath(card, isCrinos);
    console.log(`🖼️  ${cardName} [${isCrinos ? 'Crinos' : 'Breed'}] → ${imagePath}`);

    // Stats block
    let statsHtml = '';
    if (isChar) {
      const r  = card.Rage    || card.rage    || 0;
      const g  = card.Gnosis  || card.gnosis  || 0;
      const h  = card.Health  || card.health  || 0;
      const cr = card.CRage   || card.crage   || r;
      const cg = card.CGnosis || card.cgnosis || g;
      const ch = card.CHealth || card.chealth || h;
      statsHtml = `
        <div class="stat-line ${!isCrinos ? 'active-stat' : 'dimmed-stat'}">
          Breed — R:${r} G:${g} H:${h}
        </div>
        <div class="stat-line crinos-text ${isCrinos ? 'active-stat' : 'dimmed-stat'}">
          Crinos — R:${cr} G:${cg} H:${ch}
        </div>
      `;
      div.classList.toggle('crinos-form', isCrinos);
    } else {
      const typeLabel = cardType.split(' - ')[0] || 'Card';
      statsHtml = `<div class="stat-line active-stat">${typeLabel}</div>`;
    }

    div.innerHTML = `
      <div class="card-image-container">
        <img
          class="card-art"
          src="${imagePath}"
          alt="${cardName}"
          onerror="this.onerror=null; this.src='https://placehold.co/120x150/1a1a1a/ff4444?text=${encodeURIComponent(cardName)}';"
        />
      </div>
      <div class="card-name">${cardName}</div>
      <div class="card-stats">${statsHtml}</div>
    `;
  }

  // Click character cards to flip form
  if (isChar) {
    div.addEventListener('click', () => {
      isCrinos = !isCrinos;
      render();
    });
  }

  render();
  return div;
}

// ── Bootstrap ─────────────────────────────────────────────────────
loadCards();
