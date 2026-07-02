 
# ROADMAP.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition  
**Status:** Active  
**Version:** 1.0  
**Owner:** Project Lead

---

# Purpose

This document records the agreed development roadmap for the project.

Unlike the project charter, this document is expected to change frequently as milestones are completed and priorities evolve.

Only major milestones should be tracked here.

---

# Overall Goal

Create a faithful browser implementation of the original Rage CCG with a modular architecture capable of supporting the complete published card set and a competent computer opponent.

---

# Current Phase

## Phase 1 – Core Game Engine

Current focus:

- Declarative card scripting
- Turn engine
- Combat engine

---

# Milestones

## Project Foundation

- [x] Repository established
- [x] Card artwork integrated
- [x] Card database integrated
- [x] Pack builder implemented
- [x] Random pack generation
- [x] Manual pack selection
- [x] Universal fullscreen card viewer
- [x] CSS Grid board layout
- [x] Unified card rendering component
- [x] Initial modularisation (`game.js`, `turnManager.js`, `combat.js`)

---

## Declarative Card System

- [ ] Define effect schema
- [ ] Implement card event system
- [ ] Implement trigger evaluation
- [ ] Implement condition evaluation
- [ ] Implement action resolution
- [ ] Create first scripted cards
- [ ] Validate end-to-end trigger execution

---

## Turn Engine

- [ ] Redraw Phase
- [ ] Regeneration Phase
- [ ] Resource Phase
- [ ] Umbra Phase
- [ ] Moot Phase
- [ ] Combat Phase
- [ ] Turn sequencing
- [ ] Event emission

---

## Combat Engine

- [ ] Combat initiation
- [ ] Attack declaration
- [ ] Combat card resolution
- [ ] Damage assignment
- [ ] Regeneration
- [ ] Death handling
- [ ] Victory resolution

---

## Game Rules

- [ ] Legal action generation
- [ ] Timing windows
- [ ] Replacement effects
- [ ] Continuous effects
- [ ] Triggered effects
- [ ] Activated abilities

---

## Artificial Intelligence

### Foundation

- [ ] Legal move generation
- [ ] Random legal player

### Basic AI

- [ ] Card valuation
- [ ] Board evaluation
- [ ] Target selection
- [ ] Combat decisions

### Advanced AI

- [ ] Tactical planning
- [ ] Threat assessment
- [ ] Multi-turn planning
- [ ] Difficulty levels

---

## User Interface

Completed

- [x] Fullscreen card viewer
- [x] Consistent card rendering
- [x] Responsive board layout

Future improvements

- [ ] Card animations
- [ ] Optional card fanning
- [ ] Mobile gesture support
- [ ] Accessibility improvements

---

## Data

- [ ] Validate card database
- [ ] Correct discovered transcription errors
- [ ] Add scripting metadata
- [ ] Add automated validation tools

---

## Testing

- [ ] Turn engine verification
- [ ] Combat verification
- [ ] Card scripting verification
- [ ] Regression test suite

---

# Future Enhancements

Not currently planned for the initial release.

- [ ] Multiplayer
- [ ] Campaign mode
- [ ] Deck editor
- [ ] Replay viewer
- [ ] Tournament tools

---

# Updating This Document

When a significant milestone is completed:

1. Mark the milestone complete.
2. Add any new agreed milestones.
3. Remove obsolete items.
4. Keep this document concise.

This roadmap should remain a practical overview rather than a detailed design specification.