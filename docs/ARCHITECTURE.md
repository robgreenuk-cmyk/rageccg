 
# ARCHITECTURE.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition  
**Status:** Active  
**Version:** 1.0  
**Owner:** Project Lead

---

# Purpose

This document describes the software architecture of the project.

It records both:

- the current repository structure
- the intended long-term architecture

When these differ, the current repository should always be considered authoritative until code has been migrated.

---

# Architectural Principles

The following principles guide all development.

## Separation of Concerns

Rendering, game rules, data and AI should remain separate wherever practical.

---

## Modular Design

New systems should normally be implemented in dedicated modules rather than increasing the responsibilities of `main.js`.

---

## Declarative Behaviour

Individual cards should eventually become data-driven rather than implemented through hard-coded JavaScript.

---

## Single Responsibility

Each module should have one clearly defined purpose.

---

# Current Repository

Current key files include:

## index.html

Application entry point.

Responsible for loading the application and creating the root HTML containers.

---

## main.js

Currently acts as the primary application controller.

Responsibilities include:

- application startup
- screen navigation
- card loading
- board rendering
- user interaction
- fullscreen card viewer

This file is gradually being reduced in responsibility.

---

## game.js

Central game state.

Long-term owner of:

- players
- zones
- turn number
- current phase
- overall game state

---

## turnManager.js

Responsible for implementing the Rage turn sequence.

Expected responsibilities:

- phase transitions
- event emission
- timing

---

## combat.js

Responsible for combat resolution.

Expected responsibilities:

- combat rounds
- attacks
- damage
- regeneration
- victory resolution

---

## style.css

Application styling.

Responsible for:

- board layout
- card sizing
- responsive behaviour
- fullscreen viewer

---

## public/

Contains artwork and static assets.

---

# Target Architecture

As the project grows, responsibilities should migrate toward a structure similar to:

src/

engine/
game.js
turnManager.js
combat.js
cardEngine.js
ai.js

ui/
renderer.js
cards.js
overlays.js

data/
cards.json

This is a long-term direction rather than a mandatory short-term goal.

---

# Dependency Direction

The intended dependency flow is:

Card Data

↓

Game Engine

↓

Renderer

↓

Browser

Rendering code should not implement game rules.

Game rules should not depend upon rendering.

---

# Current Priorities

Current architectural priorities are:

1. Declarative card scripting.
2. Turn engine.
3. Combat engine.
4. Continued modularisation.

---

# Future Refactoring

Large rewrites should be avoided.

Instead:

- move responsibilities gradually
- preserve working functionality
- minimise regression risk

---

# Architectural Success

The architecture should remain:

- modular
- maintainable
- extensible
- faithful to the Rage rules
- understandable by new contributors