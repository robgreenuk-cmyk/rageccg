# ARCHITECTURE.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition
**Status:** Active
**Version:** 2.0
**Last verified:** October 2026, against the repository with **504 checks passing** (`node run_tests.mjs`)

---

# Purpose

This document describes **where code belongs and how the pieces fit together**, as the repository actually is today. It replaces the earlier version, which described a prototype built around `main.js`.

It documents the code. For project goals and philosophy see `rage_project_v1_1.md` (the project charter); for progress and gaps see `ROADMAP.md`; for what the next contributor should do, see `HANDOVER.md`.

If this document and the code disagree, **the code is right** — fix this document.

---

# Principles

1. **Rules live in the engine; the UI only renders state.** Nothing in the engine touches the DOM, so the test suite drives exactly the code the UI drives.
2. **Card behaviour is data.** Abilities are declared in `cardEffects.json` and interpreted by `cardEngine.js`. Reuse an existing verb before inventing one; avoid per-card JavaScript.
3. **The rules document is the authority.** `docs/ragerules2018.pdf` (Complete Rules, draft March 2018). Where a card's own text conflicts with a rule, the card wins (rule 3.4), and errata replace or supplement the printed card.
4. **A combat card is always in exactly one place.** See *The card lifecycle contract* below. This is the most important invariant in the engine.
5. **Pure logic goes in DOM-free modules** (`combatView.js`, `tracerScenarios.js`) so it can be unit-tested even when it exists to serve the UI.
6. **Mobile first.** The Project Lead works from a phone and uploads whole files, so files are delivered complete, never as diffs.

---

# Repository layout

```
index.html            App shell (screens are shown/hidden by main.js)
main.js               UI: setup/draft screens, board rendering, card component,
                      full-screen viewer, action sheet, reveal overlay, CPU driver wiring
style.css             All styling (CSS variables, board grid, halos, sheet, HP pill)

game.js               GameState, card instances, stats, damage, death, VP, win check, discard helpers
cardEngine.js         Interpreter for declarative abilities
cardEffects.json      Scripted abilities: 69 cards, 76 abilities
turnManager.js        Phases, non-combat legal actions, alpha selection, win check

combat.js             Facade: the public combat API used by main.js and the tests
combat/               The combat engine (see below)
combatView.js         Pure presentation logic: halos, HP readout, pending death-blow creature
tracerScenarios.js    Pack Combat Tracer scenario + the CPU's combat turn driver and policy

run_tests.mjs         The entire test suite (Node, no dependencies)

public/rage_cards.json   Card database (~1,376 cards; Unlimited edition is what is playable)
public/unlimited/        Card images
docs/                    Documentation, rules PDF, card-data corrections
```

---

# Layering

Dependencies point **downward only**. `game.js` and `combat/combatState.js` import nothing local.

```
main.js
 ├─► combatView.js ─────┐
 ├─► tracerScenarios.js ┤
 ├─► combat.js ─────────┤──► combat/*  ──►  game.js, cardEngine.js
 ├─► turnManager.js ────┘                    (game.js has no local imports)
 └─► cardEngine.js ──► game.js

combat/ internal order (an arrow means "imports"):
  combatActions   ► combatCards, combatLifecycle, combatPackJoin, combatResolution, combatState, combatTargeting
  combatResolution► combatCards, combatLifecycle, combatPackJoin, combatState
  combatLifecycle ► combatPackJoin, combatState
  combatCards     ► combatTargeting
  combatPackJoin  ► combatState
  combatTargeting ► combatState
```

Rules of thumb: new rules go in the engine layer; new presentation logic that needs testing goes in a pure module like `combatView.js`; `main.js` should only gain code that touches the DOM.

---

# State model

## `GameState` (game.js)

`turn`, `phase` (`redraw | regen | resource | umbra | moot | combat`), `isClosedPlay`, `player`, `opponent` (both a *PlayerState*), `huntingGrounds` (prey in the shared area), `globalEffects`, and `combat` (the active combat, or `null`).

## PlayerState

`pack` (characters in play), `allies`, `resources` (`caerns`, `territories`, `totems`, `events`…), `umbra`, `septDeck`, `combatDeck`, `septHand`, `combatHand`, `septDiscard`, `combatDiscard`, `victoryPile`, `alpha`, `alphaActedThisCombatPhase`, `hadSuccessfulMootThisPhase`.

## Card instances (`makeCardInstance(def, owner)`)

An instance wraps a card definition (`def`, straight from the JSON) with runtime state: `instanceId`, `name`, `owner` (`'player' | 'opponent'`), `zone`, `isCrinos`, `isDualForm`, `damageCards[]` (the wounds on this creature), `aggravated[]`, stat modifiers (`rageMod`, `gnosisMod`, `healthMod`, `renownMod`), `tempMods[]`, `tempFlags[]`, `tapped`, `frenzied`, `inUmbra`, `attachments[]`.

**`owner` is who the card belongs to, not who is playing it** — they differ when one player plays cards for a prey creature (rule 6.6.3). Always file a card by `owner`.

## Card definitions (`public/rage_cards.json`)

Fields used by the engine include `Name`, `Type`, `Expansion`, `Renown`, `Rage`, `Gnosis`, `Health`, `CHealth` (Crinos Health), `Damage`, `Keywords`, `Text`, `Errata`. A character is **dual-form** if it has a Crinos side (`isDualFormChar`); Metis and single-form creatures never flip.

**Known data caveat:** the `Errata` field is truncated in many entries (a crude check flags 58 of 113). The complete text of the 38 cards whose main `Text` was truncated is in `docs/RageUnlimitedTruncated.txt`; full card text and errata can be found at `https://rageccg.weebly.com/spoilers.html`. Patch the JSON as discrepancies are discovered — a bulk repair is not planned.

---

# Card engine

`cardEffects.json` maps a card name to `{ abilities: [...] }`. Each ability has `id`, `label`, `sourceText` (the card text it implements), `trigger`, and usually an `effect`, plus optional `then`, `condition`, `scope`, `note`.

**Triggers in use:** `static`, `onPlay`, `onDamageDealt`, `phaseAction` (with a `phase`), `dodgesRound`, `endsCombatAfterRound`, `onMootOutcome`, `cancelsOpponentDamageRound1`, `awardsBonusVPOnKill`, `feintOnReveal`, `deathBlowRedirect`, `packJoin` (modes: renown-capped selection, fixed count, whole pack, reactive Shieldmate group), `packLink`.

**Effect verbs in use:** `statBonus`, `discardSelf`, `tempStatMod`, `packKeyword`, `tempFlag`, `healChosenPackMember`, `healTarget`, `removeFromPlayUntilPhase`, `removeAttachedCard`, `holderIsCrinos`, `packHasCaern`, `packHasKeyword`, `targetIsCrinos`, `markAggravated`, `modifyPackStat`, `modifyTargetStat`, `increasePlayerStat`, `forceBreedForm`, `flipToCrinos`, `setFrenzied`, `forceAlpha`, `promoteAllyToPack`, `discardAndRedrawFromZone`.

**Temporary-modifier expiry values:** `nextRound`, `thisRoundOnly`, `endOfCombat`, `untilThisWoundHealed`.

To script a new card: write its ability in `cardEffects.json` quoting the card text in `sourceText`, reuse existing verbs where possible, and add a test. Prefer extending the interpreter over special-casing a card.

---

# Turn engine (`turnManager.js`)

Phases run in order: redraw → regen → resource → umbra → moot → combat, then the turn counter advances. `enterPhase(phase)` performs each phase's automatic (closed-play) work; `getLegalActions(who)` lists what a player may do; `performAction(who, action)` does it.

Non-combat actions include: `END_REDRAW`, `DISCARD_SEPT`, `PLAY_RESOURCE`, `PLAY_EQUIPMENT`, `PLAY_PREY`, `PLAY_EVENT`, `PLAY_GIFT`, `PLAY_GIFT_PACK_LINK`, `PLAY_RITE`, `PLAY_PAST_LIFE`, `STEP_SIDEWAYS` (Umbra), `CALL_MOOT`, `SELECT_ALPHA`, `DECLARE_ATTACK`, `PASS_ALPHA`, `ADVANCE_PHASE`.

**Combat phase today:** the human selects an alpha (`SELECT_ALPHA`) and then attacks or passes. The CPU's alpha is chosen automatically as its highest-Renown pack member (`selectBestAlpha`). `ADVANCE_PHASE` at the end of the Combat phase calls `checkWinCondition()`.

**The win check** is defined in `game.js` (the turn engine only calls it). If either player's Victory Pile is worth at least `GameState.renownLevel` (default 20) the higher total wins. A pack with no characters left loses immediately. The UI reports it through `checkGameOverUI()`. **Two caveats:** (1) on equal totals it declares a `'tie'` and ends the game, whereas rule 2.3 says play continues for another turn until there is a clear winner; (2) **no test covers the win check at all.**

**Not implemented:** rule 2.2.6's alpha-action *order* (highest Renown first, ties random) and any CPU decision-making outside combat. See `ROADMAP.md`.

---

# Combat engine (`combat/`)

| Module | Responsibility |
|---|---|
| `combatState.js` | Step vocabulary, participant model, `primaryParticipant` and the legacy singular accessors |
| `combatLifecycle.js` | `declareAttack` / starting combat, rounds, `startNextRound`, `endCombat` |
| `combatPackJoin.js` | Pack-join cards (Hunting Party, Pack Defense, Surprise Ally, Bum Rush, Shieldmate, Mindspeak), their expiry, Taking the Death Blow substitute eligibility |
| `combatCards.js` | Playing cards face-down, bluff/legality, `discardPlayedCard` |
| `combatTargeting.js` | The targeting step (rule 6.7) and the move to Reveal |
| `combatResolution.js` | Speed tiers, blow order, damage, Surprise Attack cancellation, killing blows, Taking the Death Blow, deaths, end-of-round cleanup |
| `combatActions.js` | `getCombatRoundActions(who)` (pure query) and `performCombatAction(who, action)` (mutation) |

## The combat object

`GameState.combat` holds `attackerWho`, `defenderWho`, `attackerParticipants[]`, `defenderParticipants[]`, `round`, `step`, `packActions[]` (pack-join cards in play), `packJoinSelection`, `deathBlowQueue`, `pendingDeathBlowContext`, `deathBlowPlays`, and more (see `declareAttack`).

A **participant** is `{ inst, ownerWho, role: 'alpha' | 'packmember', card, feintCard, feintDecided, targetInst }`. `card` is `null` until played, `'pass'` for "played nothing", otherwise the card instance. Each side has **exactly one** `alpha`-role participant while it has participants. Older code reads the singular accessors (`c.attacker`, `c.attackerCard`…), which resolve through `primaryParticipant` (the alpha, else any survivor).

## Steps

`declaration → preCombat → beginCombat → playCard → targeting → reveal → (reveal-feint) → bluff → resolution → withdrawal → betweenRounds`, plus two pauses inside resolution for a human decision: `damageOrder` (rule 6.6.1 blow-order choice) and `deathBlow` (Taking the Death Blow). Only steps where someone genuinely has a decision pause for input.

## Actions

`getCombatRoundActions(who)` returns action objects: `PLAY_PACK_ACTION`, `JOIN_PACK_MEMBER`, `JOIN_LINKED_PACKMATE`, `FINISH_PACK_JOIN`, `PLAY_COMBAT_CARD`, `PASS_COMBAT_CARD`, `FORCED_RANDOM_PLAY`, `ASSIGN_TARGET`, `CONTINUE_REVEAL`, `PLAY_FEINT_FOLLOWUP`, `DECLINE_FEINT`, `CHOOSE_DAMAGE_ORDER`, `PLAY_DEATH_BLOW`, `PASS_STEP`, `WITHDRAW`, `CONTINUE_COMBAT`, and `WAITING` (nothing to do right now). Actions may carry extra fields for the UI and tests: `actor` (which participant the action is for), `playedCard` (on `ASSIGN_TARGET`), and on Death Blow choices `savesDying`, `substituteWouldDie`, `vpCost`.

## A round, in order

Play card (each participant plays face-down or passes) → targeting (attacking pack assigns first, alternating with the defending pack) → reveal (feints) → bluff/legality → resolution by speed tier (fast, normal, slow; a creature dead at the start of a tier discards its unresolved cards, rule 6.10.1; blow order within a tier is the controlling player's choice) → **Death Blow opportunities** → `checkCombatDeaths` → `sweepDeadOutsideCombat` → discard played cards → end-of-combat checks → withdrawal → between rounds.

Combat ends (`endCombat(reason)`) with one of: `withdrawn`, `death`, `no_cards_played`, `card_effect`, `no_participants`.

## Damage, flipping and death

A damaging Combat Action becomes a **wound** on its target (`applyDamage`). A breed-form Character whose total damage reaches its printed Rage or printed Health **flips to Crinos instead of dying** (rule 6.4, `checkFlipFromDamage`); it dies only when damage reaches its Crinos Health. `isDead(inst)` is `totalDamage >= effectiveHealth` in the creature's current form.

`checkCombatDeaths` moves each dead participant to the killer's Victory Pile (`moveToVictoryPile`), which also discards the creature's attached cards (rule 6.4.2). A creature that dies in combat is worth its **printed Renown** in VP (`killVP`, `countVP`).

## Taking the Death Blow

Moves **only the specific fatal damage card** to a substitute. The substitute may be any other pack member, in or out of the combat (rule 6.10.3: the swap "has no effect if both creatures are in combat"), but not the dying creature, anyone already dead, or anyone across the Gauntlet (errata). The substitute takes the wound (including the Crinos flip check) and becomes the side's alpha. The original **escapes combat only if it was actually saved**; one whose other wounds are still lethal stays in the fight and dies normally. The card is Combat Restricted (one per side per combat). Each choice's label states what it costs in VP.

## The card lifecycle contract

A combat card instance is in **exactly one** of these places at any time (a Victory Pile may also hold a Combat Action — Telling Blow's bonus):

| Place | `zone` | How a card gets there |
|---|---|---|
| Owner's hand / deck / discard | `combatHand` / `combatDeck` / `combatDiscard` | Drawing, `discardCombat` |
| Worn as a wound on a creature | `damage` | `applyDamage` (never in any pile while worn) |
| In play as a pack-join event | — (listed in `combat.packActions`) | `PLAY_PACK_ACTION`; discarded when it expires |
| Victory Pile (Telling Blow) | `victoryPile` | `awardKillingBlowBonus` |

Rules that keep this true:

- `discardCombat` files a card in **its owner's** piles regardless of who played it.
- End-of-round cleanup (`discardPlayedCard`) leaves a worn wound on its creature (it only leaves the hand) and skips cards already in a discard or Victory Pile.
- A wound goes to its owner's discard exactly once: when **regenerated** (`regenerate`), **cancelled** (Surprise Attack), or when its wearer **dies** (`discardAttachedCards`).
- A dead creature carries nothing: wounds go to combat discards, equipment and Gifts to the owner's sept discard.

## Safety net

`sweepDeadOutsideCombat()` (rule 6.4.4) removes any creature found at or beyond its Health outside the normal death check — Characters are removed from the game, other creatures go to their owner's sept discard, no VP — and records a `DEATH_OUTSIDE_COMBAT` event. **It exists so a creature can never keep playing at zero health, not to hide bugs:** the test suite asserts it never fires during ordinary combat.

## Pack combat

Pack-join cards are scripted `packJoin` abilities. Hunting Party and Pack Defense choose members up to a Renown cap; Surprise Ally brings exactly one; Bum Rush brings the whole pack for one round and the joiners then **escape** (`resolveExpiredPackActions`); Shieldmate joins reactively and lets the defender choose who absorbs cards; Mindspeak links two pack members so they can join together later. "Combat Restricted" is read as *one play of a named card per side per combat*. When joiners escape and leave a side empty, combat ends (`no_participants`, rule 6.3).

## Playing for prey

Prey (Enemies in the Hunting Grounds) cannot play cards; the other player plays for them from their own hand (rule 6.6.3). Cards played this way still belong to, and return to, their real owner.

---

# UI layer

**`main.js`** owns the DOM. Its main parts: the setup/draft screens and game start (`startGame`, `randomDraft`, `startPackCombatTracer`); `renderGameBoard()` (phase bar, scoreboard, character list, the zone rows via `renderZone`, the combat hand row, the action bar, the reveal overlay); the card component `buildCard()`; the full-screen viewer `openFullCard()`; the action sheet `openCardActionSheet()`; and the CPU driver `runOpponentTurnIfNeeded()`.

**The card is the interface.** Tapping a card with something to do opens a compact **action sheet** listing only that card's available actions (`getContextualActions` matches an action to a card through whichever field names it: `card`, `attacker`, `target`, `inst`, `partner`, `dyingInst`, `substituteInst`, `play.card`/`play.owner`). A card with nothing to do opens the full-screen viewer. The bottom action bar still lists every action and is intended to shrink into a small helper.

**Combat markers** come from `combatView.js`:

- `getCombatHighlights()` → red smoky halo = attacking, blue/white = defending, pulsing white-blue = a card you are being asked to choose (alpha, attack target, pack-join candidate, who a card hits, Death Blow substitute); a white ring marks the card whose sheet is open. Members picked during a pack join show on their side before you press Done.
- `getHealthReadout()` → the `HP 2/5` pill: Health left in the current form over that form's Health, clamped at 0, colour-coded; a creature at 0 shows a greyed art + **☠ DYING** banner. The red `−N` badge is **damage taken**, not health left.
- `getPendingDeathBlowInst()` → the creature a Death Blow decision is about, which `renderZone` scrolls into view.

**CPU driver.** `runOpponentCombatTurn()` (in `tracerScenarios.js`) lets the CPU act repeatedly while the human has nothing to do except wait, so a multi-participant CPU side never stalls. The tracer's CPU policy (always take a pack join; a short script in round 1) is switched on only by the Pack Combat Tracer.

**CSS notes.** Card rows scroll horizontally and clip anything past their edge, so `.card-row` carries 24px/12px of padding cancelled by negative margins to give halos room without moving the layout; the halo glow layers are sized to fade out within that padding (a glow that reaches the clip edge shows as a hard band). Stacking: bars 50, action sheet 1900, full-screen viewer 2000, reveal overlay 2100. Honour `prefers-reduced-motion`. Rows keep their horizontal scroll across renders (`renderZone` restores it).

---

# Testing

`node run_tests.mjs` runs everything: **504 checks across 86 sections** (tests are numbered 1–67 with lettered parts such as 6a–6e; there is no Test 51), Node only, no dependencies. Conventions:

- `check(label, condition)`; `quietly(fn)` silences the engine's logging; `EventLog.ofType()` / `lastOfType()` read what the engine recorded.
- `initGame` **shuffles each combat deck**, so a list order means nothing — stack hands deliberately (see `stackCombatCards` in `tracerScenarios.js`).
- Randomized sections (60, 63 and 64) play dozens of full games and assert invariants after every action; Test 64's checks print the exact exception or card if one fails. Test 66 compares a projection against the real pipeline for every Unlimited character.
- **Mutation testing is standard practice:** after adding a fix, temporarily revert it and confirm a test fails. Also run the suite ~30 times to catch flakiness.
- UI behaviour is verified by driving the real app in a headless browser; the recipe is in `HANDOVER.md`.

---

# Known simplifications

See the *Rules coverage* table in `ROADMAP.md` for the full list. The ones most likely to matter when extending the engine: the CPU takes no turns outside combat; challenges, Territory/Battlefield attacks, stepping in, binding, frenzy (flag only), Umbra combat, Rivalry/Loyalty and allegiance are not implemented; damage-card side effects fire on the original target before a Death Blow redirect; rule 6.4.3's zero-VP cases are not modelled (they cannot occur with Unlimited cards, where every character is Gaia and every prey is an Enemy); the win check ends the game on a tie instead of playing another turn and has no tests.
