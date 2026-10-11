// ═══════════════════════════════════════════════════════════════
// tracerScenarios.js — Pack Combat Tracer scenario + the CPU's turn
// driver. Pure game-state code, no DOM, so run_tests.mjs can exercise
// exactly what main.js runs live (Test 60).
//
// WHY THIS IS A SEPARATE FILE
//   The Pack Combat Tracer needs three things that are easy to get
//   subtly wrong and impossible to check from a phone browser, so they
//   live here where the headless test suite can drive them:
//     1. setupPackCombatTracer() — rosters + hands, with the opening
//        hand and draw pile stacked deterministically (initGame()
//        shuffles every combat deck, so a plain `combat:` list cannot
//        promise which cards land in hand).
//     2. pickOpponentCombatAction() — when the tracer asks for it, the
//        CPU reliably takes any pack-join it is offered, instead of
//        leaving it to the random pick.
//     3. runOpponentCombatTurn() — the CPU's turn driver (moved here
//        unchanged from main.js's runOpponentTurnIfNeeded()).
// ═══════════════════════════════════════════════════════════════
import { GameState, initGame } from './game.js';
import { getCombatRoundActions, performCombatAction } from './combat.js';

// ── Roster ───────────────────────────────────────────────────────
// Player: Cernonous (Renown 6) + Tim Rowantree (3) + Passer (1).
//   Hunting Party's 15-Renown cap (alpha included) fits all three.
// Opponent: Shakar (Renown 4) + Jubati (3) + Running Creek (3).
//   The CPU's alpha is auto-picked as the HIGHEST-Renown pack member
//   (turnManager.js selectBestAlpha), and it is the only character the
//   human can attack — so Shakar's packmates must stay strictly below
//   Renown 4 or he stops being the defender. Pack Defense's cap also
//   fits all three (4 + 3 + 3 = 10 of 15).
const PLAYER_CHARACTERS   = ['Cernonous', 'Tim Rowantree', 'Passer'];
const OPPONENT_CHARACTERS = ['Shakar', 'Jubati', 'Running Creek'];

// ── Combat cards ─────────────────────────────────────────────────
// `hand` is the opening hand (5 = combatHandSize); `draw` is the draw
// pile in order. The two pack-join cards bring in 2 extra members each,
// so each side's first two `draw` cards are exactly its bonus draws.
// Rage requirements (Fur Gnarl = 4, the rest = 1) mean only Cernonous
// can legally play Fur Gnarl — a packmate trying it is a bluff.
const PLAYER_CARDS = {
  hand: ['Hunting Party', 'Glancing Blow', 'Grazing Wound', 'Flesh Wound', 'Fur Gnarl'],
  draw: ['Glancing Blow', 'Grazing Wound', 'Flesh Wound', 'Fur Gnarl', 'Glancing Blow', 'Grazing Wound'],
};
const OPPONENT_CARDS = {
  hand: ['Pack Defense', 'Grazing Wound', 'Flesh Wound', 'Glancing Blow', 'Grazing Wound'],
  draw: ['Glancing Blow', 'Flesh Wound', 'Grazing Wound', 'Glancing Blow', 'Flesh Wound'],
};

// initGame() shuffles combatDeck and then deals combatHandSize cards
// off the top, so list order means nothing. This re-sorts the whole
// combat card pool into the exact hand + draw order wanted. Cards are
// matched by name; any card not named (there shouldn't be any) stays
// at the bottom of the deck.
function stackCombatCards(ps, handNames, drawNames) {
  const pool = [...ps.combatHand, ...ps.combatDeck, ...ps.combatDiscard];
  const take = name => {
    const i = pool.findIndex(c => c.name === name);
    return i === -1 ? null : pool.splice(i, 1)[0];
  };
  const hand = handNames.map(take).filter(Boolean);
  const draw = drawNames.map(take).filter(Boolean);
  ps.combatHand    = hand;
  ps.combatDeck    = [...draw, ...pool];
  ps.combatDiscard = [];
  hand.forEach(c => { c.zone = 'combatHand'; });
  ps.combatDeck.forEach(c => { c.zone = 'combatDeck'; });
}

// Builds and starts the Pack Combat Tracer game. `byName` looks a card
// definition up by its Name (main.js: cardDatabase; tests: allCards).
// Returns { ok: true } or { ok: false, missing: [names] } — in the
// missing case NOTHING is started.
function setupPackCombatTracer(byName, renownLevel = 20) {
  const allNames = [
    ...PLAYER_CHARACTERS, ...OPPONENT_CHARACTERS,
    ...PLAYER_CARDS.hand, ...PLAYER_CARDS.draw,
    ...OPPONENT_CARDS.hand, ...OPPONENT_CARDS.draw,
  ];
  const missing = [...new Set(allNames)].filter(n => !byName(n));
  if (missing.length) return { ok: false, missing };

  const defs = names => names.map(byName);
  initGame(
    { characters: defs(PLAYER_CHARACTERS), sept: [],
      combat: defs([...PLAYER_CARDS.hand, ...PLAYER_CARDS.draw]) },
    { characters: defs(OPPONENT_CHARACTERS), sept: [],
      combat: defs([...OPPONENT_CARDS.hand, ...OPPONENT_CARDS.draw]) },
    renownLevel
  );
  stackCombatCards(GameState.player,   PLAYER_CARDS.hand,   PLAYER_CARDS.draw);
  stackCombatCards(GameState.opponent, OPPONENT_CARDS.hand, OPPONENT_CARDS.draw);
  return { ok: true };
}

// ── CPU policy ───────────────────────────────────────────────────
// Default is the project's existing behavior: a uniformly random legal
// action. With prefersPackJoin, a pack-join the CPU is offered is
// always taken first (play the card, then bring in every member it is
// allowed) so the tracer's pack defense happens every run. Everything
// else — which cards it plays, who it targets, blow order — stays
// random either way.
function pickOpponentCombatAction(actions, prefersPackJoin = false) {
  if (prefersPackJoin) {
    const join = actions.find(a => a.type === 'PLAY_PACK_ACTION')
              || actions.find(a => a.type === 'JOIN_PACK_MEMBER');
    if (join) return join;
  }
  return actions[Math.floor(Math.random() * actions.length)];
}

// ── CPU turn driver ──────────────────────────────────────────────
// Moved unchanged (apart from the policy hook) from main.js's
// runOpponentTurnIfNeeded().
// Pack Combat: a CPU side with several participants needs several
// consecutive actions (one card per participant, one target per
// participant, etc). Previously this made exactly ONE action per human
// click, so the human was left staring at a dead "Waiting for
// opponent…" button and had to tap it repeatedly to push the CPU along.
// Behavior is otherwise unchanged: the CPU always takes one action, and
// keeps going only while the human has nothing to do except wait.
// The guard cap is a safety net against any unforeseen infinite loop.
// Returns how many actions the CPU took.
function runOpponentCombatTurn(prefersPackJoin = false) {
  let taken = 0;
  if (!GameState.combat) return taken;
  for (let guard = 0; guard < 25 && GameState.combat; guard++) {
    const oppActions = getCombatRoundActions('opponent').filter(a => a.type !== 'WAITING');
    if (oppActions.length === 0) break;
    performCombatAction('opponent', pickOpponentCombatAction(oppActions, prefersPackJoin));
    taken++;
    if (!GameState.combat) break;
    if (!getCombatRoundActions('player').every(a => a.type === 'WAITING')) break;
  }
  return taken;
}

export {
  setupPackCombatTracer, pickOpponentCombatAction, runOpponentCombatTurn,
  PLAYER_CHARACTERS, OPPONENT_CHARACTERS, PLAYER_CARDS, OPPONENT_CARDS,
};
