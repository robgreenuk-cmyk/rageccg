# CHANGELOG.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition
**Status:** Active
**Version:** 2.0
**Owner:** Project Lead

---

# Purpose

Records significant milestones: major systems completed, architectural changes, new modules, and documentation milestones. It is **not** a replacement for Git history. Routine bug fixes are omitted unless they changed how the architecture works or exposed an important rule.

---

# Maintenance guidelines

When adding an entry: put it at the top; group related changes; explain *why* a significant change was made; keep it concise and factual; link to other documents for detail.

---

# Changelog

## Version 2.0 – Pack combat made playable, a card-driven combat UI, and a hardened engine (October 2026)

Test suite: **374 → 504 checks** (86 sections, numbered 1–67).

### Gameplay and engine

- **Taking the Death Blow** implemented against its full errata. The substitute may be any other pack member, in or out of the combat (rule 6.10.3); the dying creature, the already-dead and anyone across the Gauntlet are excluded. The substitute takes the wound (with the Crinos flip) and becomes the side's alpha. The original escapes combat **only if it was actually saved**. The card is Combat Restricted.
- **Card lifecycle contract.** A combat card is now always in exactly one place. Previously every wound was also put in its owner's discard pile the moment the round ended — while still attached to its target — and regeneration never filed a healed wound anywhere; the two bugs hid each other. Wounds now stay "in play" on their creature and reach their owner's discard exactly once (regeneration, cancellation, or their wearer's death). A dead creature's wounds, equipment and Gifts are discarded (rule 6.4.2). Cards are always filed by **owner**, which fixed a leak when one player plays cards for a prey creature (the same card could be played twice and attached to one creature twice).
- **Creatures can no longer play on at zero or negative health.** A creature saved from its fatal card but still lethally wounded used to "escape" combat alive and was never examined again. It now stays in the fight and dies normally, and a rule 6.4.4 safety net (`sweepDeadOutsideCombat`) removes any creature found at or beyond its Health. A test asserts the safety net never fires in ordinary combat, so it cannot hide future bugs.
- **Bum Rush** no longer crashes combat when the alpha has died and the escaping joiners leave a side empty; combat now ends (rule 6.3).
- Found by running thousands of randomized full games with invariants checked after every action — see *Testing*.

### User interface

- **Card-driven interaction.** Tapping a card opens a compact **action sheet** with only what that card can do (make alpha, attack, play, bring in…); cards with nothing to do open the full viewer as before.
- **Combat halos:** red smoky glow for attackers, blue/white for defenders, pulsing white-blue for "you are being asked to choose this card". Pack members chosen during a join appear on their side before you confirm.
- **`HP 2/5` readout** on every creature (Health left in the current form), a **☠ DYING** marker at 0, and the **Victory Point cost** spelled out on Taking the Death Blow choices ("Let Passer die (opponent scores 1 VP)").
- The reveal overlay shows every participant's card, grouped by side.
- Card rows now keep their horizontal scroll across actions, and a death-blow decision scrolls its creature into view.

### New modules and files

- `combatView.js` — pure presentation logic (halos, HP readout) so it can be tested.
- `tracerScenarios.js` — the **Pack Combat Tracer** (a scripted 3-vs-3 scenario replacing the old single-character tracer) and the CPU's combat turn driver, which now takes several consecutive actions so a multi-participant CPU side no longer stalls.
- `combat/combatPackJoin.js`, `combatLifecycle.js` and friends extended; `game.js` gained the death/VP/health helpers.

### Testing and tooling

- Randomized full-game tests (random packs and decks, prey in the Hunting Grounds, pack-heavy decks) assert after every action that no card is in two places, none is lost, no creature lingers at zero health, and VP always equals the Renown of what entered the Victory Pile. Failures name the exact exception or card.
- Mutation testing adopted as standard practice: revert a fix and confirm a test fails.
- A real headless browser can drive the app in the development sandbox (recipe in `HANDOVER.md`), so UI changes can be seen and measured, not guessed.

### Documentation

- `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, `AI_COLLABORATION.md` and the project charter (now `rage_project_v1_1.md`) rewritten to match the code; `HANDOVER.md` introduced (replacing `MAKE_PACK_COMBAT_WORK_HANDOVER.md`).

---

## Version 1.x – Engine foundations (before October 2026)

Built across earlier working sessions; recorded here from the test suite's history.

- **Turn engine:** all six phases and turn sequencing; Resource-phase plays (resources, equipment, allies, prey, events, Gifts, Rites, Past Lives); Umbra stepping; Moots and Juntas with voting.
- **Declarative card engine** (`cardEngine.js`, `cardEffects.json`): static modifiers, `onPlay`, `onDamageDealt`, `phaseAction`, temporary modifiers and their expiries; 69 cards scripted.
- **Combat engine:** attack declaration, the full round (play card, targeting, reveal, bluff, resolution, withdrawal, between rounds), speed tiers, dodges and blocks, forced and restricted play, Feint, Surprise Attack, Telling Blow, aggravated damage, regeneration, death and Victory Points.
- **Pack combat, in four phases:** participant arrays in place of a single alpha; alternating targeting and the blow-order choice (6.6.1); death handling for packmates and alphas; the pack-join cards Hunting Party, Bum Rush, Pack Defense, Surprise Ally, Shieldmate and Mindspeak.
- **Modular layout:** `game.js`, `turnManager.js`, `combat.js` and the `combat/` modules.

---

## Version 1.0 – Project foundation

### Project organisation

- Established the documentation structure in `docs/`: Project Charter (`rage_project_v1.md`), AI Collaboration guide, Architecture document, Roadmap.

### User interface

- Universal full-screen card inspection; unified card rendering component; CSS Grid board layout; global card sizing through CSS variables; full-card artwork during pack selection; consistent card interaction.

### Repository

- Initial modularisation (`game.js`, `turnManager.js`, `combat.js`), moving away from a prototype centred on `main.js`.

### Card data

- Integrated a machine-readable database of approximately **1,376 cards**, treated as the canonical machine-readable source. The text is a reasonable transcription of the published cards and is corrected incrementally when problems are found.
