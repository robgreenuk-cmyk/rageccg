**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition  
**Status:** Active  
**Version:** 1.0  
**Owner:** Project Lead

---

# Purpose

This document is the master project charter for the Rage CCG implementation.

It provides the objectives, development philosophy, current state and agreed direction of the project.

Every human or AI contributor should read this document before making significant contributions.

This document intentionally contains high-level project information. Technical implementation details belong in the other documents within the `docs/` folder.

---

# Project Objective

Build a faithful browser-based implementation of the **1995 Rage: Werewolf: The Apocalypse Collectible Card Game**, using the **2018 Comprehensive Rules** as the authoritative implementation reference.

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

# Current Project Status

Completed:

- Card database integrated.
- Card artwork integrated.
- Pack generation.
- Manual pack selection.
- Board prototype.
- Universal fullscreen card inspection.
- Initial modularisation.
- CSS Grid board layout.
- Unified card rendering.

In progress:

- Declarative card scripting.

Planned:

- Turn engine.
- Combat engine.
- Legal action generation.
- AI opponent.

---

# Card Data

The project currently contains a machine-readable JSON database of approximately **1,376 cards**.

This database is treated as the project's canonical machine-readable card source.

The card text should be regarded as a **reasonable transcription of the published cards**, but **not necessarily a verified OCR extraction**.

Any errors discovered during implementation should be corrected individually.

A complete OCR verification project may be undertaken in future if required, but it is **not** currently part of the project roadmap.

---

# Repository Direction

The current repository is transitioning from a prototype centred around `main.js` toward a modular architecture.

Existing modules include:

- `game.js`
- `turnManager.js`
- `combat.js`

Future systems should normally be implemented in dedicated modules rather than increasing the responsibilities of `main.js`.

---

# AI Collaboration

AI collaboration is defined in:

`docs/AI_COLLABORATION.md`

Roles:

**Project Lead**

- prioritises work
- approves architecture
- integrates changes

**Claude**

Primary implementation engineer.

Responsible for production code and repository integration.

**ChatGPT**

Architecture reviewer, debugger, documentation author and technical planner.

Production implementation should normally remain Claude's responsibility unless explicitly requested otherwise.

---

# Current Priorities

The agreed implementation order is:

1. Declarative card scripting
2. Turn / phase engine
3. Combat engine
4. Legal action generation
5. AI opponent
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
- `ARCHITECTURE.md` — where code belongs.
- `ROADMAP.md` — implementation progress.
- `CHANGELOG.md` — significant completed milestones.

Together these documents form the project's primary governance documentation.