 
# CHANGELOG.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition  
**Status:** Active  
**Version:** 1.0  
**Owner:** Project Lead

---

# Purpose

This document records significant milestones in the project's development.

It is **not** intended to replace Git commit history. Instead, it highlights major architectural, gameplay, and project management changes that future contributors should understand.

Only meaningful milestones should be recorded.

---

# Changelog

## Version 1.0 – Project Foundation

### Project Organisation

- Established a formal project documentation structure within the `docs/` directory.
- Introduced a Project Charter (`rage_project_v1.md`) to define the project's objectives, philosophy and current direction.
- Introduced an AI Collaboration guide (`AI_COLLABORATION.md`) to define responsibilities and communication between the Project Lead, Claude and ChatGPT.
- Introduced an Architecture document (`ARCHITECTURE.md`) describing both the current repository structure and the intended long-term architecture.
- Introduced a Roadmap (`ROADMAP.md`) for tracking development milestones.

---

### User Interface

Completed:

- Universal fullscreen card inspection.
- Unified card rendering component.
- CSS Grid board layout.
- Global card sizing using CSS variables.
- Full-card artwork display during pack selection.
- Consistent card interaction behaviour across the application.

---

### Repository

Current repository includes:

- Initial modularisation through:
  - `game.js`
  - `turnManager.js`
  - `combat.js`

The project is transitioning away from a prototype centred around `main.js` toward a modular architecture.

---

### Card Data

- Integrated a machine-readable database containing approximately **1,376 cards**.
- The JSON database is treated as the project's canonical machine-readable card source.
- Card text is considered a reasonable transcription of the published cards and will be corrected incrementally if issues are discovered.

---

### Current Development Focus

Work is currently focused on:

1. Declarative card scripting.
2. Turn / phase engine.
3. Combat engine.
4. Legal action generation.
5. Artificial Intelligence.

---

# Future Entries

Future entries should record milestones such as:

- Major gameplay systems completed.
- Significant architectural refactoring.
- New modules introduced.
- Completion of major rules subsystems.
- AI milestones.
- Documentation milestones.
- Repository reorganisations.

Avoid recording routine bug fixes or minor cosmetic changes unless they significantly affect the project's architecture or gameplay.

---

# Maintenance Guidelines

When adding a new entry:

- Add it to the top of the changelog.
- Group related changes together.
- Explain *why* a significant change was made where appropriate.
- Keep entries concise and factual.
- Refer to other documentation where additional detail is available.