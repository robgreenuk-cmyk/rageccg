# ROADMAP.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition
**Status:** Active
**Version:** 2.0
**Last verified:** October 2026 (504 checks passing)

---

# Purpose

The agreed development roadmap: what is done, what is next, and what is known to be missing. This document is expected to change often. Keep it a practical overview, not a design specification — design detail belongs in `ARCHITECTURE.md`.

---

# Where the project is

The **rules engine is largely built and heavily tested**: the full turn loop, a declarative card engine (69 scripted cards), and a complete pack-combat engine including Taking the Death Blow, death, Victory Points and the card lifecycle. The **combat UI is card-driven** (action sheet, combat halos, HP readout, dying marker).

The game is **not yet a game you can lose**: the CPU opponent only *defends*. It never declares an attack, plays no sept cards, and calls no Moots. A human can attack the CPU, but nobody can attack the human. That is the next milestone.

---

# Milestones

## M0 – Project foundation — done

- [x] Repository, card artwork, ~1,376-card database
- [x] Pack builder: random packs, manual selection, draft
- [x] Universal full-screen card viewer, unified card component, CSS Grid board
- [x] Modular layout (`game.js`, `turnManager.js`, `combat.js`, later `combat/*`)

## M1 – Turn engine — done

- [x] Redraw, Regeneration, Resource, Umbra, Moot and Combat phases; turn sequencing
- [x] Resource phase plays: resources, equipment, allies, prey, events, Gifts, Rites, Past Lives
- [x] Umbra: stepping sideways through a Caern
- [x] Moots/Juntas: calling and voting
- [x] Win check at the end of each Combat phase

## M2 – Declarative card engine — done (breadth ongoing)

- [x] Effect schema, trigger evaluation, conditions, effect resolution (`cardEngine.js`)
- [x] 69 cards / 76 abilities scripted, end-to-end tested
- [ ] Script the remaining cards (see *Content breadth*)

## M3 – Combat engine — done for the core and for pack combat

- [x] Attack declaration, rounds, play-card / targeting / reveal / bluff / resolution / withdrawal steps
- [x] Speed tiers, dodges and blocks, forced and restricted play, Feint, Surprise Attack, Telling Blow
- [x] Damage, Crinos flip, regeneration, aggravated damage, death, Victory Pile, VP
- [x] Pack combat: participants, alternating targeting, blow-order choice, Hunting Party, Pack Defense, Surprise Ally, Bum Rush, Shieldmate, Mindspeak, Taking the Death Blow
- [x] Card lifecycle contract (a card is always in exactly one place) and the death safety net
- [x] Randomized full-game stress tests with invariant checks

## M4 – Card-driven combat UI — done for the first pass

- [x] Action sheet: tap a card to see and choose what it can do
- [x] Combat halos (red attacking, blue/white defending, pulsing = choose)
- [x] `HP x/y` readout, ☠ DYING marker, VP cost shown on Death Blow choices
- [x] Pack Combat Tracer: a scripted 3-vs-3 scenario for demonstrating and testing the system live

## M5 – CPU opponent (v1) — **next**

Make the CPU a real participant so a game can be won and lost.

- [ ] Alpha-action order (rule 2.2.6: highest Renown acts first, ties random)
- [ ] The CPU takes its alpha action: attack, or pass
- [ ] The human as *defender* in the live UI (pre-combat pack defence, reactive Shieldmate, Death Blow decisions, being killed)
- [ ] A general CPU policy module (generalising the tracer's policy)
- [ ] **Winning the game (rule 2.3):** the win check has no tests and ends the game on a tie where the rules say play another turn — cover it and fix it, because the CPU opponent is what makes games end
- [ ] Full-game headless stress tests: whole games to completion, invariants checked throughout

Then, as separate slices: CPU resource-phase play (creatures, equipment, prey), CPU Moots, CPU Umbra use.

## M6 – UI refinement

- [ ] Shrink the bottom action bar into a small "what can I do?" helper plus one primary Continue/Done button
- [ ] A cue for *which participant is up to act*
- [ ] Scroll hint for card rows wider than the screen
- [ ] Victory Pile and discard viewers
- [ ] Cosmetic: animations, accessibility

## M7 – Rules breadth

See the coverage table. Roughly in priority order: challenges, frenzy, stepping in for prey, Territory and Battlefield attacks, binding, Umbra combat, Rivalry/Loyalty and attack restrictions, allegiance and VP complications, Quests, instinctive and alternative combat actions.

## M8 – Content breadth

- [ ] Script the remaining Unlimited cards
- [ ] Repair truncated `Errata` fields in `public/rage_cards.json` as discrepancies are found (agreed approach: patch as we go)
- [ ] Other expansions

## M9 – Not planned for the initial release

Multiplayer, campaign mode, deck editor, replay viewer, tournament tools, saved games.

---

# Rules coverage

Status of rules from `docs/ragerules2018.pdf`. ✅ implemented and tested · 🟡 partial / simplified · ❌ not implemented.

| Rule | Topic | Status | Notes |
|---|---|---|---|
| 2.2 | Phases and turn loop | ✅ | |
| 2.2.2 | Regeneration | ✅ | Healed wound goes to its owner's discard |
| 2.2.5 / 4.7 | Moots and Juntas | ✅ | Calling and voting |
| 2.2.6 | Alpha selection | 🟡 | Human chooses; CPU auto-picks highest Renown |
| 2.3 | Winning the game | 🟡 | Threshold win works but is **untested**; a tie ends the game (rules: play another turn); a pack with no characters loses at once |
| 2.2.6 | **Alpha-action order** | ❌ | Highest Renown first, ties random — **M5** |
| 2.2.6 | **CPU alpha action** | ❌ | The CPU never attacks — **M5** |
| 4.5.4 | Quests | ❌ | Past Lives only |
| 6.1–6.3 | Declaration, pre-combat, rounds, combat ending | ✅ | End reasons: withdrawn, death, no cards played, card effect, no participants |
| 6.4 | Damage, Crinos flip, death | ✅ | |
| 6.4.1 | Healing, aggravated damage | ✅ | |
| 6.4.2 | Death: attached cards discarded, VP to killer | ✅ | |
| 6.4.3 | VP complications (Wyrm/Enemies, Gaia/Victims) | ❌ | Cannot occur yet: all Unlimited characters are Gaia, all prey are Enemies |
| 6.4.4 | Death outside combat | 🟡 | Safety net only |
| 6.5.1 | Attack an alpha or prey | ✅ | |
| 6.5.2 | Challenges | ❌ | Only alphas and prey can be attacked |
| 6.5.3 / 6.5.4 | Battlefields, Territory attacks | ❌ | |
| 6.5.5 | Attack to bind | ❌ | |
| 6.5.6 / 6.5.7 | Forced attacks, attack restrictions (Rivalry/Loyalty) | ❌ | Mentioned in comments only |
| 6.5.8 | Pack combat | 🟡 | Rivalry and "in the Hunting Grounds" limits not enforced |
| 6.5.9 | Stepping in | ❌ | |
| 6.6.1 | Multiple cards, blow order | ✅ | |
| 6.6.2 | Pack actions | ✅ | |
| 6.6.3 | Playing for prey | 🟡 | The other player plays from their own hand |
| 6.6.4 / 6.6.5 | Umbra-only and alternative combat actions | ❌ | |
| 6.6.6 | Restricted, forced and random play | ✅ | |
| 6.7 | Targeting | ✅ | Alternating assignment |
| 6.8 | Reveal step: Feint | ✅ | |
| 6.8.2 | Instinctive combat actions | ❌ | |
| 6.9 | Bluffs and illegal cards | ✅ | |
| 6.10.1 / 6.10.2 | Speed tiers, dodges and blocks | ✅ | |
| 6.10.3 | Redirection | 🟡 | Via Taking the Death Blow; no repeat redirection; damage-card side effects fire on the original target; ordering against other damage-affecting cards not modelled |
| 6.10.4 | Parting shots | ❌ | |
| 6.11 | Frenzy | ❌ | A flag and one effect verb only |
| 5 | The Umbra: stepping sideways | ✅ | |
| 5.2 | Umbral combat | ❌ | |
| 4.1.5 | Allegiance | ❌ | |
| A1.6 | Rivalry and Loyalty | ❌ | |

---

# Updating this document

When a milestone is completed: tick it, add any newly agreed work, remove what is obsolete, and update the coverage table. Verify a claim before changing a ✅ — run the tests or search the code.
