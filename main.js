import './style.css';
// The '?raw' suffix tells Vite to load this as a plain text string instead of compiling it
import rawCardData from './ragegame.txt?raw';

let cardDatabase = [];

// --- 1. THE AUTOMATIC LACKEY / JSON PARSER ---
function parseCardData() {
  try {
    const trimmedData = rawCardData.trim();

    // Route A: JSON Parsing
    if (trimmedData.startsWith('{') || trimmedData.startsWith('[')) {
      const parsed = JSON.parse(trimmedData);
      cardDatabase = Array.isArray(parsed) ? parsed : Object.values(parsed);
    } 
    // Route B: Lackey Tab-Delimited text parsing
    else {
      const lines = trimmedData.split('\n');
      if (lines.length < 2) throw new Error("File appears to be empty.");

      const headers = lines[0].split('\t').map(h => h.trim());

      for (let i = 1; i < lines.length; i++) {
        const currentLine = lines[i].trim();
        if (!currentLine) continue;

        const columns = lines[i].split('\t');
        const cardObject = {};

        headers.forEach((header, index) => {
          cardObject[header] = columns[index] ? columns[index].trim() : "";
        });

        if (cardObject.Name) cardDatabase.push(cardObject);
      }
    }

    setupInitialBoard();

  } catch (error) {
    console.error("Parsing Failed", error.message);
  }
}

// --- 2. SMART ASSET GENERATOR (FALLBACK) ---
// This function algorithmically builds the exact image path based on your manifest rules
function getAutomaticImagePath(card, isCrinos) {
  // If the database actually has a valid image path column down the line, prioritize it
  const explicitImg = card.ImageFile || card.imagefile || card.image || card.Imagefile || '';
  if (explicitImg) {
    const imageFiles = explicitImg.split(',');
    let activeFile = imageFiles[0] || 'placeholder';
    if (isCrinos && imageFiles[1]) {
      activeFile = imageFiles[1];
    }
    return `/unlimited/${activeFile}.jpg`;
  }

  // Fallback: Generate the filename programmatically from the card name and type
  const rawName = card.Name || card.name || '';
  const rawType = (card.Type || card.type || '').toLowerCase();

  // Clean the card name: lowercase it, strip punctuation, replace spaces with dots
  const cleanName = rawName
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, '') // strip weird punctuation characters
    .trim()
    .replace(/\s+/g, '.');         // convert spaces to dots

  let segment = 'action';
  if (rawType.includes('character')) {
    segment = isCrinos ? 'crinos' : 'garou';
  } else if (rawType.includes('combat')) {
    segment = 'combat.action';
  } else if (rawType.includes('gift')) {
    segment = 'gift';
  } else if (rawType.includes('moot')) {
    segment = 'moot';
  } else if (rawType.includes('equipment')) {
    segment = 'equipment';
  } else if (rawType.includes('ally')) {
    segment = 'ally';
  } else if (rawType.includes('past life')) {
    segment = 'past.life';
  }

  return `/unlimited/rage.image.${segment}.${cleanName}.jpg`;
}

// --- 3. SETUP BOARD STATE ---
function setupInitialBoard() {
  const characters = cardDatabase.filter(card => {
    const typeStr = card.Type || card.type || "";
    return typeStr.includes('Character');
  });
  
  const hgZoneCards = cardDatabase.filter(card => {
    const typeStr = card.Type || card.type || "";
    return typeStr.includes('Enemy') || typeStr.includes('Victim');
  });
  
  const handPool = cardDatabase.filter(card => {
    const typeStr = card.Type || card.type || "";
    return !typeStr.includes('Character') && !typeStr.includes('Enemy') && !typeStr.includes('Victim');
  });

  const pCharZone = document.querySelector('.player-zone .characters');
  const hgZone = document.querySelector('.hunting-grounds .shared-cards');

  if (pCharZone) pCharZone.innerHTML = '';
  if (hgZone) hgZone.innerHTML = '';

  // Render our two active characters
  if (characters.length >= 2) {
    pCharZone.appendChild(createCardElement(characters[0]));
    pCharZone.appendChild(createCardElement(characters[1]));
  } else if (cardDatabase.length > 0) {
    pCharZone.appendChild(createCardElement(cardDatabase[0]));
    if (cardDatabase[1]) pCharZone.appendChild(createCardElement(cardDatabase[1]));
  }

  if (hgZoneCards.length > 0) {
    hgZone.appendChild(createCardElement(hgZoneCards[0]));
  }

  // Build the scrollable player hand zone
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
  handScrollZone.innerHTML = '';

  const shuffledHand = handPool.sort(() => 0.5 - Math.random());
  const startingHand = shuffledHand.slice(0, 5);

  startingHand.forEach(card => {
    handScrollZone.appendChild(createCardElement(card));
  });
}

// --- 4. BUILD CARD VISUALS & HANDLERS ---
function createCardElement(card) {
  const div = document.createElement('div');
  div.className = 'card-slot';
  
  let isCrinos = false;
  const cardName = card.Name || card.name || 'Unknown Card';
  const cardType = card.Type || card.type || '';

  function updateCardUI() {
    let statsHtml = '';

    // Calculate path automatically using our engine rules
    const imagePath = getAutomaticImagePath(card, isCrinos);

    console.log(`🔍 ASSET ENGINE - Requesting URL -> "${imagePath}"`);

    if (cardType.includes("Character")) {
      const rage = card.Rage || card.rage || 0;
      const gnosis = card.Gnosis || card.gnosis || 0;
      const health = card.Health || card.health || 0;
      const crage = card.CRage || card.crage || 0;
      const cgnosis = card.CGnosis || card.cgnosis || 0;
      const chealth = card.CHealth || card.chealth || 0;

      statsHtml = `
        <div class="stat-line ${!isCrinos ? 'active-stat' : 'dimmed-stat'}">B: ${rage}/${gnosis}/${health}</div>
        <div class="stat-line crinos-text ${isCrinos ? 'active-stat' : 'dimmed-stat'}">C: ${crage}/${cgnosis}/${chealth}</div>
      `;
      
      if (isCrinos) div.classList.add('crinos-form');
      else div.classList.remove('crinos-form');
    } else {
      statsHtml = `<div class="stat-line active-stat">${cardType ? cardType.split(' - ')[0] : 'Card'}</div>`;
    }

    div.innerHTML = `
      <div class="card-image-container">
        <img class="card-art" src="${imagePath}" alt="${cardName}" onerror="this.src='https://placehold.co/120x150/1a1a1a/ff4444?text=${encodeURIComponent(cardName)}'"/>
      </div>
      <div class="card-name">${cardName}</div>
      <div class="card-stats">${statsHtml}</div>
    `;
  }

  if (cardType.includes("Character")) {
    div.addEventListener('click', () => {
      isCrinos = !isCrinos;
      updateCardUI();
    });
  }

  updateCardUI();
  return div;
}

parseCardData();