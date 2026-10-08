# Handover: Make Pack Combat Work (UI Plumbing)

## What this project is

Rob (the project owner) is the sole developer of a browser-based digital
implementation of the 1995 *Rage: Werewolf the Apocalypse* Collectible Card
Game (Unlimited edition). The repo is
[`robgreenuk-cmyk/rageccg`](https://github.com/robgreenuk-cmyk/rageccg) on
GitHub. Rob works primarily from his phone via StackBlitz, and uploads files
to GitHub manually rather than using git from the command line — he cannot
apply a diff/patch, only replace a whole file. That's why every deliverable in
this project is a complete, ready-to-commit file, never a diff.

Rob uses Claude (that's you) as his primary engineering partner, with ChatGPT
and Gemini occasionally consulted for architecture review or rules
cross-checking — their input has been useful but has also been caught
drifting from primary source text at least once, so treat anything from them
as a lead to verify, not a fact to trust.

This document assumes you're starting with **no memory of any prior
conversation about this project**. Everything you need is either in this file
or in the repository itself.

## Getting started

1. **Clone the repo**, into whatever sandbox/working environment you have
   available:
   ```
   git clone https://github.com/robgreenuk-cmyk/rageccg.git
   ```
2. **Confirm the baseline before changing anything**:
   ```
   cd rageccg
   node run_tests.mjs
   ```
   This should print `374 passed, 0 failed`. If it doesn't, stop and
   investigate before doing anything else in this document — it means
   something changed since this handover was written, and the rest of this
   document's claims need re-verifying against whatever you find.
3. It's a Vite project (`package.json`) but you won't need to run the dev
   server to do this specific task — `run_tests.mjs` is a standalone Node
   script that exercises the game engine headlessly and is the fast,
   reliable way to check your work as you go. Rob will separately verify any
   UI changes live, himself, in StackBlitz — he cannot run a browser for you.

## Tools you'll likely have, and what they're for here

- **A bash/shell tool** — for `git clone`, running `node run_tests.mjs`,
  `grep` for auditing (confirm a claim in this document before trusting it —
  e.g. `grep -n "renderRevealOverlay" main.js`), and `node --check <file>`
  for a quick syntax sanity check after editing, separate from running the
  full test suite.
- **A file-viewing tool** — read a file before editing it, always. Line
  numbers drift; don't trust a number quoted in this document without
  confirming it against the live file first.
- **A precise text-replacement tool** (find a unique string, replace it) —
  preferred over rewriting a whole file for small, targeted changes like the
  ones described below.
- **A file-creation tool** — for any genuinely new file.
- **Whatever mechanism your environment uses to hand finished files back to
  Rob** — he can't see your sandbox, only what you explicitly deliver. Use it
  for every file you touch, even ones you're fairly confident about.

## Planning documents already in the repo

Check `docs/` before starting. Several documents already exist; their
usefulness varies:

- **`docs/rage_project_v1.md`** — the master project charter: objectives,
  development philosophy, core principles. States explicitly that *every*
  contributor should read it before making significant contributions. Still
  accurate for its own purpose (philosophy/objectives don't go stale the way
  status reports do), but it predates Pack Combat entirely and never mentions
  it — don't expect it to describe current engine state.
- **`docs/AI_COLLABORATION.md`** — defines how AI contributors (Claude,
  ChatGPT, Gemini) are expected to communicate progress, including a
  "Standard Status Update" format (Current Objective / Completed Since Last
  Report / Current Work / Files Changed / Architectural Decisions / Known
  Risks / Suggested Partner Tasks / Requested Review / Next Implementation
  Step). Worth using if Rob asks for a status update mid-task, or if you want
  to leave a clean report for whoever picks this up next.
- **`docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/ARCHITECTURE.md`** — **all
  confirmed stale** as of this handover: they describe the project from
  before Pack Combat existed at all (no mention of the participant model, the
  `combat/` module split, or any of the six pack-combat cards). Don't trust
  them for current state. Not this task's job to fix, but worth knowing they
  exist and aren't reliable.
- **This file, `MAKE_PACK_COMBAT_WORK_HANDOVER.md`** (repo root) — the
  current, live task description. Everything below this point was verified
  fresh, by cloning the repo and running the actual test suite, immediately
  before this document was finalized. Still: re-verify rather than trust, per
  the lesson in the next section.

## Current Objective

Get pack combat working end-to-end through the actual rendered UI. This is
**not** the Pack Combat Vertical Tracer yet — Rob wants pack combat working
overall first, then a separate context window for the tracer itself. Don't
start on tracer-scenario design (roster, scripted cards, new setup-screen
button) from this document; that's intentionally a later, separate task.

## Read this first: a lesson from the last attempt at this

A prior session did real work on exactly this task — designed and implemented
fixes to `renderRevealOverlay()` and `getContextualActions()` — but the
session's sandbox was lost (2 months of inactivity) before the fixes were ever
delivered as files or uploaded to GitHub. **Neither fix made it into the
repository.** This was confirmed by re-cloning fresh from GitHub and grepping
`main.js` for pack-combat concepts: zero matches, same as before any of that
work happened.

The practical lesson, already a stated project principle
(`docs/AI_COLLABORATION.md`: *"Do not assume unconfirmed changes are in the
repository"*) but worth restating here because it just cost real work: **treat
everything below as a starting point to verify against the live repo, not as
already-true.** Re-grep, re-view, re-confirm before trusting any claim in this
document, including the "already fixed" and "already fine" ones — line numbers
and even function bodies may have drifted.

## Confirmed current state (verified by cloning fresh and running the suite)

- `node run_tests.mjs` → **374 passed, 0 failed**. The engine (Phases 1–4 of
  Pack Combat — participant model, targeting, death/removal, all six
  pack-combat cards, the rule 6.6.1 blow-order choice) is complete, correct,
  and entirely validated through headless engine calls.
- `combat.js` is a thin barrel; the real logic lives in `combat/` (7 files:
  `combatState.js`, `combatPackJoin.js`, `combatLifecycle.js`,
  `combatTargeting.js`, `combatCards.js`, `combatResolution.js`,
  `combatActions.js`). Pure relocation, no behavior change, already verified
  live. See "File structure" below for the dependency graph if useful context.
- A VP scoreboard exists in the header (`main.js`'s `renderVPScoreboard()`,
  styled in `style.css` under `#vp-scoreboard`) and is confirmed present and
  working.
- **The core problem remains unfixed**: `main.js` has no awareness of the
  pack-combat data model. Confirmed by grep, just now, against the live repo:
  `attackerParticipants`, `defenderParticipants`, `PLAY_PACK_ACTION`,
  `JOIN_PACK_MEMBER`, `ASSIGN_TARGET`, `CHOOSE_DAMAGE_ORDER`,
  `PLAY_DEATH_BLOW`, `JOIN_LINKED_PACKMATE`, `packActions`,
  `shieldmateGroups` — all zero matches in `main.js`.

## What's already fine (confirmed, not just assumed)

- **`renderActionBar()`** — builds one button per item from
  `getCombatRoundActions('player')` using `action.label`, dispatches via
  `performCombatAction('player', action)`. Doesn't hardcode any action type.
  Every Phase 1–4 action object already has a `label`. Should already render
  every pack-combat action as a button with no changes — **this has still
  never actually been exercised live**, only reasoned about from reading the
  code. Worth a cheap live sanity check early (see "Suggested approach").
- **`runOpponentTurnIfNeeded()`** — picks a random legal action, also
  action-type-agnostic.
- **`renderCombatHandRow()`** — already reflects whichever specific
  participant is currently up to act.
- **The damage cascade** (`buildCard()`'s wound/attachment rendering,
  `main.js` ~line 787) — newly confirmed this session, was previously an open
  question. It reads `instance.damageCards`/`instance.attachments` entirely
  per-creature-instance, with no attacker/defender role assumption anywhere.
  Already correct for any number of participants. No fix needed here.

## Confirmed gaps — the actual work

### 1. `renderRevealOverlay()` — the clear priority

Current state (`main.js`, confirmed just now, starts at line 637):

```js
function renderRevealOverlay() {
  const c = GameState.combat;
  const inReveal = c && c.step === 'reveal';
  let overlay = el('reveal-overlay');

  if (!inReveal) {
    overlay?.remove();
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reveal-overlay';
    overlay.className = 'reveal-overlay';
    document.body.appendChild(overlay);
  }

  const buildSide = (label, cardOrPass) => {
    const side = document.createElement('div');
    side.className = 'reveal-side';
    side.innerHTML = `<div class="reveal-side-label">${label}</div>`;
    if (cardOrPass === 'pass' || !cardOrPass) {
      const passEl = document.createElement('div');
      passEl.className = 'reveal-pass';
      passEl.textContent = 'Played nothing';
      side.appendChild(passEl);
    } else {
      side.appendChild(buildCard(cardOrPass.def, { mode: 'board' }));
    }
    return side;
  };

  overlay.innerHTML = '<div class="reveal-title title-font">Reveal!</div>';

  const row = document.createElement('div');
  row.className = 'reveal-row';
  row.appendChild(buildSide(`${c.attacker.name} (attacker)`, c.attackerCard));
  const vs = document.createElement('div');
  vs.className = 'reveal-vs title-font';
  vs.textContent = 'VS';
  row.appendChild(vs);
  row.appendChild(buildSide(`${c.defender.name} (defender)`, c.defenderCard));
  overlay.appendChild(row);

  const btn = document.createElement('button');
  btn.className = 'action-btn reveal-continue-btn';
  btn.textContent = 'Continue';
  btn.onclick = () => handlePlayerAction({ type: 'CONTINUE_REVEAL' });
  overlay.appendChild(btn);
}
```

The problem: `c.attacker`/`c.attackerCard`/`c.defender`/`c.defenderCard` are
the legacy singular compatibility accessors from before the Phase 1
participant model existed. They only ever reflect ONE creature per side (the
alpha, or Phase 3's fallback survivor if the alpha died). In real pack combat
this silently omits every other participant's card — a 2-vs-1 fight would only
show 1 of the 2 attacking cards.

The fix designed (and lost) last session — group by side, iterate
`c.attackerParticipants`/`c.defenderParticipants`, one `buildSide` per
participant who actually has a card this round:

```js
  overlay.innerHTML = '<div class="reveal-title title-font">Reveal!</div>';

  // Pack Combat: show every participant's card, not just the alpha's.
  const buildGroup = (groupLabel, participants) => {
    const group = document.createElement('div');
    group.className = 'reveal-group';
    group.innerHTML = `<div class="reveal-group-label title-font">${groupLabel}</div>`;
    const cardsRow = document.createElement('div');
    cardsRow.className = 'reveal-group-cards';
    for (const p of participants) {
      cardsRow.appendChild(buildSide(p.inst.name, p.card));
    }
    group.appendChild(cardsRow);
    return group;
  };

  const row = document.createElement('div');
  row.className = 'reveal-row';
  row.appendChild(buildGroup('Attacker', c.attackerParticipants));
  const vs = document.createElement('div');
  vs.className = 'reveal-vs title-font';
  vs.textContent = 'VS';
  row.appendChild(vs);
  row.appendChild(buildGroup('Defender', c.defenderParticipants));
  overlay.appendChild(row);
```

(Replaces just the two lines building `row` content — `buildSide` itself, the
overlay setup above it, and the Continue button below it are unchanged.)

Needs matching CSS (`style.css` — check current state of `.reveal-row`,
`.reveal-side`, `.reveal-vs` first; last known design added `.reveal-group`,
`.reveal-group-label`, `.reveal-group-cards` with `flex-wrap` so 2–3 cards per
side wrap sensibly on a phone screen, and loosened `.reveal-row`'s max-width
from 480px to 640px for breathing room):

```css
.reveal-group {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; flex: 1; min-width: 0;
}
.reveal-group-label {
  font-size: 13px; color: var(--col-gold);
  text-transform: uppercase; letter-spacing: 1px;
}
.reveal-group-cards {
  display: flex; flex-wrap: wrap; align-items: flex-start;
  justify-content: center; gap: 8px;
}
```
(`.reveal-side` keeps its existing rules; just drop its `flex: 1` since
`.reveal-group` now owns that.)

Treat all of the above as a *strong starting draft to verify*, not something
to paste blindly — confirm current `main.js`/`style.css` state first, since
this is being reconstructed from memory of a lost session, not read fresh off
disk.

### 2. `getContextualActions()` — the "tap a card" shortcut

Current state (`main.js`, confirmed just now):

```js
function getContextualActions(inst) {
  const pool = GameState.combat
    ? getCombatRoundActions('player')
    : getLegalActions('player');
  return pool.filter(a => a.card === inst || a.attacker === inst || a.target === inst);
}
```

This powers "tap a card on the board, see what you can do with it" — called
with either a creature instance or a combat-card instance (via `buildCard`,
used for both). Several Phase 4 action shapes use field names this filter
doesn't check: `JOIN_PACK_MEMBER` (`.inst`), `JOIN_LINKED_PACKMATE`
(`.partner`), `PLAY_DEATH_BLOW` (`.dyingInst`/`.substituteInst`),
`CHOOSE_DAMAGE_ORDER` (nested in `.play.card`/`.play.owner`). Not fatal — the
generic action bar (item 1 under "already fine," above) covers these
regardless — but the tap-shortcut won't surface them, which a player will
naturally try.

The fix designed last session — purely additive, ORs more field checks onto
the existing filter, so it can only add matches, never remove ones that worked
before:

```js
function getContextualActions(inst) {
  const pool = GameState.combat
    ? getCombatRoundActions('player')
    : getLegalActions('player');
  return pool.filter(a =>
    a.card === inst || a.attacker === inst || a.target === inst
    || a.inst === inst || a.partner === inst
    || a.dyingInst === inst || a.substituteInst === inst
    || a.play?.card === inst || a.play?.owner === inst
  );
}
```

### 3. No visual "who's a combat participant" marker — real gap, not yet designed

Nothing in `renderZone()` (`main.js` ~line 584) or `buildCard()` currently
distinguishes "this creature is fighting" from "just sitting in the pack."
Fine when there's only ever one attacker and one defender (obvious from
context); genuinely hard to follow once 2–3 participants per side are
possible. There's an existing, directly reusable pattern to model this on —
`is-playable`:

```js
// main.js, existing pattern:
card.classList.toggle('is-playable', canPlay);
```
```css
/* style.css, existing pattern: */
.card-component.is-playable { ... }
.card-component.is-playable .card-img-wrap { ... }
```

A `toggle('is-combat-participant', ...)` (or similar name) following the same
shape, checked against whether `inst` appears in
`c.attackerParticipants`/`c.defenderParticipants`, is the natural approach.
This one was identified but never designed in detail — more open than items 1
and 2 above. Worth deciding: a border/badge, a small icon, dimming
non-participants, or some combination. Rob's visual judgment matters more here
than an engineering default.

### 4. Not yet checked this session

- Whether there's a way to indicate *which specific participant* is currently
  up to act (vs. just "which side"), once play-card is genuinely multi-turn
  per round. The action button labels already include the acting creature's
  name (e.g. `"${actorInst.name}: play ${card.name}"`), which helps, but
  isn't a substitute for a visual highlight on the board.
- The exact current line numbers/content of the old "Load Combat Tracer"
  button and `startCombatTracer()` — confirmed still present
  (`btn-combat-tracer` / line 155, wiring line 165, function starts line 402)
  but not re-read in full this session. Not today's task (that's the tracer
  work, later) but good to know it's unchanged.

## Suggested approach

1. Fix `renderRevealOverlay()` first (item 1) — highest impact, most clearly
   broken, smallest fix.
2. Before writing anything else, get a cheap live signal on whether the
   "already fine" claims above (particularly the action-bar/dispatch pattern)
   actually hold up — e.g. a temporary debug affordance that hands the
   player's alpha a pack-join card (Hunting Party or Bum Rush are simplest) so
   Rob can click through a real pack-join live in StackBlitz. This validates
   the riskiest assumption in this document cheaply, before investing further.
3. Fix `getContextualActions()` (item 2) — small, low-risk, can happen
   alongside or after step 2's live check.
4. Design and build the participant marker (item 3) once 1–2 are confirmed
   working, since it's the most open-ended of the three and benefits from
   having something real on screen to look at first.
5. Run `node run_tests.mjs` after every change — all 374 should stay green,
   since none of this touches engine logic, only rendering. If the count ever
   changes, something unrelated broke; stop and investigate before continuing.
6. Deliver complete, ready-to-commit files (not diffs) — Rob uploads manually
   to GitHub via StackBlitz on his phone.
7. **Confirm delivery actually happened** before ending the session — this
   document exists because that step was skipped once already. Present the
   files, and if there's any uncertainty about whether Rob has uploaded them,
   say so explicitly rather than assuming.

## When pack combat is confirmed working

Rob's stated intent: once pack combat genuinely works end-to-end through the
UI (not just these 3–4 items — use judgment on when it's solid enough), the
**next, separate** step is a fresh context window for the Pack Combat Vertical
Tracer itself — replacing the old "Load Combat Tracer" button with a
pack-combat scenario, in the same spirit as the old one (deterministic,
skips the picker, demonstrates the system live) but showcasing multiple
participants, a real targeting decision, the blow-order choice, Taking the
Death Blow, and any other card effects that need to visibly resolve correctly
(bonus VP, etc.). That work is intentionally out of scope for this handover —
raised here only so the connection is clear, not as an instruction to start it.

## File structure (for context, unchanged from the split)

```
combat.js                    — thin barrel, re-exports the public API
combat/
  combatState.js             — step names, primaryParticipant, cardName (leaf)
  combatPackJoin.js           — Hunting Party/Pack Defense/Surprise Ally/Bum
                                Rush/Shieldmate-join/Mindspeak-link
  combatLifecycle.js          — declareAttack, round progression, the
                                pausable step machine, combat end
  combatTargeting.js          — target assignment (rule 6.7), Shieldmate's
                                redirect inversion
  combatCards.js              — Play-card step, Feint, bluff legality
  combatResolution.js         — speed tiers, blow-order choice, damage,
                                killing blows, Taking the Death Blow
  combatActions.js            — getCombatRoundActions()/performCombatAction(),
                                the only two functions main.js actually calls
```

`main.js`/`run_tests.mjs` import from `./combat.js` exactly as before the
split — nothing about the split affects this task.

## Project conventions (established, keep following)

- **Audit live files before proposing changes** — re-clone/re-grep/re-view,
  don't trust this document's claims without checking. This isn't boilerplate
  advice here; it's the specific lesson this document exists to encode.
- **Deliver complete, ready-to-commit files**, never diffs.
- **Run the full test suite after every change** — 374 tests, all must stay
  green; `run_tests.mjs` never touches `main.js` so a UI-only change should
  leave the count exactly unchanged.
- **Use only primary source text** for rules/card questions — the actual card
  data (`public/rage_cards.json`) and `rageccg.weebly.com/spoilers.html` for
  errata. Never web-search for rules; ask Rob directly if text looks
  truncated or unclear. Not directly relevant to this specific UI task, but a
  firm project-wide rule.
- **Flag genuine ambiguity rather than extrapolating** — including design
  ambiguity in the participant-marker work (item 3), which is more open than
  items 1–2.
- See "Planning documents already in the repo," above, for which existing
  docs are current vs. stale, and the `AI_COLLABORATION.md` status-update
  format.
