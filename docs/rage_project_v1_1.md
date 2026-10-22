**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition  
**Status:** Active  
**Version:** 1.1  
**Owner:** Project Lead

---

# Purpose

This document is the master project charter for the Rage CCG implementation.

It provides the objectives, development philosophy, current state and agreed direction of the project.

Every human or AI contributor should read this document before making significant contributions.

This document intentionally contains high-level project information. Technical implementation details belong in the other documents within the `docs/` folder.

---

# Project Objective

Build a faithful browser-based implementation of the **1995 Rage: Werewolf: The Apocalypse Collectible Card Game**, using the **2018 Comprehensive Rules** (`docs/ragerules2018.pdf`) as the authoritative implementation reference.

Primary objectives are:

- faithfully reproduce the original gameplay
- preserve the visual feel of the original cards
- support the complete published card pool
- build a maintainable modular codebase
- initially support Human vs Computer (1v1)

---

# Development Philosophy

The following principles have been agreed for the project.

## Accuracy over simplification

The goal is to recreate Rage, not merely produce a game inspired by Rage.

Where practical, original mechanics should always be preserved.

---

## Data before code

Card behaviour should be declarative wherever practical.

Avoid hard-coding individual cards.

Prefer extending card data rather than adding special-case JavaScript.

---

## UI renders game state

Rendering belongs in the UI.

Rules belong in the game engine.

---

## Architecture before polish

Gameplay systems take priority over:

- animations
- cosmetic effects
- visual polish

---

## Incremental refactoring

Avoid large rewrites.

Responsibilities should gradually migrate into dedicated modules.

---

## The card is the interface

Digital card games are driven by interacting with the cards. Selecting a card should offer the choices available on that card (make alpha, attack, play, bring in…). Summary lists of every legal action exist to help new players, not to be the primary way of playing. Where a creature will die, the Victory Point cost should be visible before the choice is made.

---

# Current Project Status

Completed:

- Card database, artwork, pack generation, manual pack selection and draft.
- Universal fullscreen card inspection, unified card rendering, CSS Grid board.
- Modular architecture (`game.js`, `turnManager.js`, `cardEngine.js`, `combat/*`).
- Declarative card scripting (69 cards, 76 abilities).
- Turn engine: all six phases, Resource-phase plays, Umbra stepping, Moots and Juntas, win check.
- Combat engine, including pack combat, Taking the Death Blow, death, Victory Points and a strict card-lifecycle contract.
- Card-driven combat UI: action sheet, combat halos, `HP x/y` readout, dying marker.
- A scripted Pack Combat Tracer for demonstrating and testing combat live.
- A 504-check automated test suite, including randomized full-game stress tests.

In progress / next:

- **CPU opponent.** Today the CPU only defends: it never declares an attack, plays sept cards or calls Moots, so a game cannot yet be won or lost against it.

Planned:

- UI refinement, advanced rules (challenges, frenzy, Umbra combat, Territories and Battlefields, Rivalry/Loyalty, allegiance), broader card scripting.

See `ROADMAP.md` for detail and the rules-coverage table.

---

# Card Data

The project contains a machine-readable JSON database of approximately **1,376 cards** (`public/rage_cards.json`).

This database is treated as the project's canonical machine-readable card source.

The card text should be regarded as a **reasonable transcription of the published cards**, but **not necessarily a verified OCR extraction**. In particular the `Errata` field is truncated in many entries. The full text of the 38 cards whose main text was truncated is in `docs/RageUnlimitedTruncated.txt`; full card text and errata can be checked at `https://rageccg.weebly.com/spoilers.html`.

Any errors discovered during implementation should be corrected individually, as they are found.

A complete OCR verification project may be undertaken in future if required, but it is **not** currently part of the project roadmap.

---

# Repository Direction

The repository has completed its transition from a prototype centred on `main.js` to a modular architecture:

- engine: `game.js`, `cardEngine.js`, `turnManager.js`, `combat.js`, `combat/*`
- pure presentation logic: `combatView.js`
- scenarios and CPU turn driving: `tracerScenarios.js`
- UI: `main.js`, `style.css`, `index.html`

New systems belong in dedicated modules, not in `main.js`. See `ARCHITECTURE.md`.

---

# AI Collaboration

AI collaboration is defined in:

`docs/AI_COLLABORATION.md`

Roles:

**Project Lead**

- prioritises work
- approves architecture
- is the arbiter of rules questions
- integrates changes

**Claude**

Primary implementation engineer.

Responsible for production code, testing and repository integration.

**ChatGPT and Gemini**

Architecture review, debugging, rules verification, documentation and technical planning.

Production implementation should normally remain Claude's responsibility unless explicitly requested otherwise.

---

# Current Priorities

The agreed implementation order is:

1. Declarative card scripting — *core done; breadth ongoing*
2. Turn / phase engine — *done*
3. Combat engine — *done for the core and pack combat*
4. Legal action generation — *done (engine-side)*
5. **AI opponent — next**
6. Advanced mechanics
7. Future enhancements

---

# Constraints

The following project constraints have been agreed.

- Preserve original Rage behaviour wherever practical.
- Prefer declarative implementations.
- Avoid duplicated logic.
- Maintain consistent UI behaviour.
- Keep documentation aligned with implementation.
- Refactor incrementally.
- Optimise for long-term maintainability.
- Cite the rules (section numbers) when a rules question arises; the Project Lead checks the rules document each time and should not be expected to recall rulings.

---

# Success Criteria

The project will be considered successful when it provides:

- a faithful implementation of the Rage CCG
- a maintainable modular architecture
- declarative card scripting
- complete turn and combat engines
- a competent AI opponent
- comprehensive project documentation suitable for both human and AI contributors.

---

# Relationship to Other Documentation

This document defines **what** the project is.

Supporting documents define:

- `AI_COLLABORATION.md` — how AI contributors work together.
- `ARCHITECTURE.md` — where code belongs and how it fits together.
- `ROADMAP.md` — implementation progress and rules coverage.
- `CHANGELOG.md` — significant completed milestones.
- `HANDOVER.md` — everything a new contributor needs to continue the work.

Together these documents form the project's primary governance documentation.
