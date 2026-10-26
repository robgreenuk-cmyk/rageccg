# HANDOVER.md

**Project:** Rage: Werewolf: The Apocalypse Collectible Card Game (1995) – Digital Edition
**For:** the next Claude context window
**Written:** October 2026, at the end of a long working session
**Replaces:** `MAKE_PACK_COMBAT_WORK_HANDOVER.md` (that task is complete — see §8)
**State at handover:** `node run_tests.mjs` → **504 passed, 0 failed**; the live repository matched the delivered files byte-for-byte (HEAD was `05e719c` before these docs were uploaded)

---

# 0. Start here

1. Read this file, then `rage_project_v1_1.md` (the project charter: goals), `ARCHITECTURE.md` (how the code fits), and the *Rules coverage* table in `ROADMAP.md`.
2. **Make a fresh clone** of `https://github.com/robgreenuk-cmyk/rageccg` (never trust an earlier copy) and run `node run_tests.mjs`. Expect `504 passed, 0 failed`. If not, stop and find out why.
3. **Confirm the open decisions in §5.6 with the Project Lead before building** — your standing instructions require it.
4. The rules are in `docs/ragerules2018.pdf` (Complete Rules, draft March 2018). If you cannot read it, ask Rob to upload it. Cite section numbers when you discuss a rule; Rob checks the document each time.

---

# 1. The project in brief

A faithful browser implementation of the 1995 Rage CCG, playing Human vs Computer. Plain ES modules, no framework; Vite is only the dev server and bundler. Rob is the sole developer and works **from a phone** (StackBlitz), uploading files to GitHub by hand.

**What works:** the full turn loop; a declarative card engine (69 cards scripted); a complete pack-combat engine (Hunting Party, Pack Defense, Surprise Ally, Bum Rush, Shieldmate, Mindspeak, Taking the Death Blow), death, Victory Points and a strict card-lifecycle contract; a card-driven combat UI (action sheet, halos, `HP x/y`, dying marker); a scripted **Pack Combat Tracer** for live demonstration.

**What does not:** **the CPU only defends.** It never declares an attack, plays no sept cards and calls no Moots. Nobody can attack the human, so a real game cannot be won or lost. That is the next task.

---

# 2. Working with Rob

**Environment.** Reads on a phone, so keep replies short and lead with the answer. Uploads files manually, so deliver **complete files**, never diffs. He tests live after uploading and reports what he sees; take those reports seriously (the "negative HP" report this session led to two real bugs).

**Standing agreements** (his own words, in `AI_COLLABORATION.md`):

1. Audit the live GitHub files before proposing changes.
2. Deliver complete, ready-to-commit files.
3. Run the tests immediately after each change.
4. Flag ambiguity rather than extrapolating.
5. Ask for primary card text rather than inferring from truncated data or web searches.
6. Confirm core mechanics before implementing.
7. Surface bugs transparently rather than silently fixing them.
8. On rules questions, cite the rules text; don't assume he remembers rulings.

**His design principle:** *the card is the interface* — selecting a card should offer the choices on that card; the list of all actions is a helper for new players.

**Delivery protocol.** Put changed files in the outputs folder **preserving folder structure** (`combat/` files in a `combat/` subfolder), say which files are new and which replace existing ones, and present them. **Ask Rob to confirm the upload, then verify with a fresh clone**: compare every delivered file byte-for-byte, confirm no other tracked file changed, run the suite. Never claim files are in the repo before that.

---

# 3. Sandbox tooling — read this, it will save you hours

**Run the app.** In a fresh clone: `npm install`, then `node node_modules/vite/bin/vite.js --port 5174 --host 127.0.0.1`. Delete `node_modules`, `dist` and `package-lock.json` before diffing or packaging.

**A real browser works.** A headless Chromium runs in the sandbox, so you can *see and measure* the UI instead of guessing. In a scratch directory: `npm init -y && npm install puppeteer-core @sparticuz/chromium`. Take 390×844 phone-size screenshots at 2× and look at them with the `view` tool. Helper code is in Appendix A.

**Gotchas (each cost real time):**

- **Commands have a time limit (~2 minutes).** A long script gets killed mid-run and prints nothing. Keep scripts short, write output to a file, and read it afterwards.
- **Background servers do not survive between commands.** Start Vite *and* run the browser script **in the same command**, then stop the server by PID (`node … vite.js … & VPID=$!` … `kill $VPID`).
- **Never use `pkill -f` or `pgrep -f` with a pattern that appears in your own command line** — it matches and kills your own shell. Use `$!`.
- The working directory can vanish between turns; **re-clone if it does**.
- Software rendering struggles with the halo `box-shadow` animations. For functional browser runs inject `.card-component .card-img-wrap{animation-play-state:paused!important}` (the glow still shows, without per-frame repaints).
- `initGame` **shuffles each combat deck**, so list order means nothing. Stack hands deliberately (`stackCombatCards` in `tracerScenarios.js`).

**Verification habits that found real bugs this session:**

1. **Randomized full-game stress with invariants checked after every action.** Test 64 is the template (`draft()` builds random packs and decks the way the app does; `placesMap()`/`doubled()` check card zones). Run many games in parallel (for example eight processes of ~700 games) to catch bugs that occur once in thousands of games, and instrument a throwaway copy to capture exactly how it happened.
2. **Mutation testing.** After a fix, revert it and confirm a test fails.
3. **Flakiness.** Run the whole suite ~30 times.
4. **Check claims mechanically** (does this function exist? does this number match?) instead of trusting memory of the code.

---

# 4. Engine invariants — do not break these

(Full detail in `ARCHITECTURE.md`.)

- **A combat card is always in exactly one place.** Worn wounds have `zone === 'damage'` and are in no pile; `discardCombat` files by the card's **`owner`**, not by who played it; a wound is discarded exactly once (regeneration, cancellation, or its wearer's death).
- **A dead creature carries nothing** and goes to the killer's Victory Pile worth its printed Renown.
- **A creature escapes combat only if it was actually saved**; one still at lethal damage stays and dies normally.
- **Each side has exactly one `alpha`-role participant**, and **a round never starts with an empty side** (`endCombat('no_participants')`).
- `sweepDeadOutsideCombat()` is a backstop. **Tests assert it never fires in ordinary combat** — if it does, you have introduced a leak; do not "fix" it by making the net broader.
- UI: `.card-row` padding (24px) exists so halos aren't clipped, and halo glow layers must fade out within it; rows keep their scroll across renders.

---

# 5. The next task: a CPU opponent (v1)

## 5.1 Why this task

It is the project's stated priority #5, every prerequisite is done, and it turns the prototype into a game. It also exercises code that has **never run in a real game**: the human as the *defender* (pre-combat pack defence, reactive Shieldmate, Death Blow decisions with the human's cards, the human's characters being killed and the CPU scoring VP), and the **win condition**, which has no tests.

## 5.2 Definition of done

- In a normal (non-tracer) game, once alphas are selected the **CPU takes its alpha action** in the order rule 2.2.6 requires, and the human can be attacked.
- The human can defend through the real UI: every decision the engine offers a defender is reachable and understandable.
- A game can be **won and lost**, including the tie rule (rule 2.3).
- The CPU's behaviour lives in a **pure, tested module** (`cpuPolicy.js`), generalising the tracer's policy; Tests 60 and 63 still pass unchanged in meaning.
- **Whole randomized games run to completion headlessly** (thousands, invariants checked throughout) with no exceptions and the safety net never firing.
- Verified live in the headless browser, with screenshots.
- Docs updated: `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, and this file.

## 5.3 Scope

**In:** alpha-action order; the CPU's alpha action (attack or pass); CPU decisions *as attacker* (withdraw/continue, pack-join cards, card play) and as defender; defender-side UI checks and fixes; win/tie handling and its tests; headless full-game stress.

**Out (separate slices):** CPU resource-phase play (creatures, equipment, prey), CPU Moots, CPU Umbra use, challenges, frenzy, Territories/Battlefields, stepping in, binding, Umbra combat. Do not let the task grow into these.

## 5.4 What exists today (verified)

- `turnManager.js`: the combat phase's setup auto-selects the CPU's alpha as its highest-Renown pack member (`selectBestAlpha`) and clears `alphaActedThisCombatPhase`. The human then gets `SELECT_ALPHA`, `DECLARE_ATTACK` or `PASS_ALPHA`, and `ADVANCE_PHASE`. **Nothing ever lets the CPU's alpha act, and there is no alpha-action order.**
- `getLegalActions('opponent')` can already list `DECLARE_ATTACK` for the CPU (the tests use it); nothing in the app calls it. `main.js` only ever calls `declareAttack('player', …)`.
- During combat the CPU acts through `runOpponentTurnIfNeeded()` → `runOpponentCombatTurn(cpuTracerPolicy)` in `tracerScenarios.js`: it picks randomly among `getCombatRoundActions('opponent')` and keeps acting while the human has only `WAITING`. The "prefer a pack join / opening-round script" policy is **only** active for the tracer.
- The end of the Combat phase calls `checkWinCondition()` (in `game.js`). **It has no tests.** On equal totals it declares `'tie'` and ends the game; rule 2.3 says play continues for another turn.
- Defender-side engine paths (the human defending) are tested headlessly (Tests 57, 62, 65 and 66) but have never been driven through the real UI as a defender.

## 5.5 Rules to read first (`docs/ragerules2018.pdf`)

2.2.6 (alpha selection and **alpha-action order**), 2.3 (winning, ties, a player with no Characters), 6.1–6.3 (declaration, rounds, ending combat), 6.5.1 (what an alpha may attack), 6.5.8 (pack combat), 6.4.3 (VP for prey).

## 5.6 Decisions to confirm with Rob first (proposed defaults)

1. **Alpha-action order (2.2.6).** Highest effective Renown acts first; ties random, decided once after both alphas are chosen. The second alpha still gets its own action afterwards unless it was killed or lost. *Default: implement exactly this; show a banner such as "Opponent's alpha acts first".*
2. **Does the CPU attack or pass?** *Default: attack the human's alpha whenever legal; a small chance to pass is a later tuning knob.* Attacking prey is out of scope for v1.
3. **CPU as attacker: withdraw or continue?** *Default: continue while its participants are healthy; withdraw when its alpha's remaining health is at most a third of its maximum.* (Use the `HP` readout helpers.)
4. **Pack-join cards.** *Default: reuse the tracer's rule — a pack join the CPU is offered is always taken.*
5. **Tie rule.** Rule 2.3: another turn until there is a clear winner. *Default: implement that; add tests for the whole of 2.3.*
6. **Game-over screen.** What should the player see and be able to do (restart, back to setup)? Ask; do not invent.

## 5.7 Suggested plan

1. Fresh clone; baseline 504; read the code paths in §5.4.
2. **Tests first for 2.3** (win threshold, higher total wins, tie, no Characters left, "still wins the turn they were taken out"), then fix the tie rule once Rob confirms.
3. **Alpha-action order** in `turnManager.js`, gating who may act, with unit tests (order, ties, killed alpha loses its action).
4. **`cpuPolicy.js`** (pure): choose the alpha action, and the combat actions as attacker and defender; fold the tracer's policy into it without changing the tracer's behaviour.
5. **UI wiring** in `main.js`: run the CPU's alpha action when it is its turn; banner; confirm the defender flows are usable (and make the active decision obvious); screenshots in the headless browser.
6. **Headless full-game stress:** loop whole games (turns, phases, both sides acting) to completion with a turn cap; assert the invariants of §4 after every action; run thousands in parallel; instrument and fix whatever turns up. Expect to find bugs — that is how the last four were found.
7. Mutation-test each fix, run the suite ~30 times, verify with a fresh clone after Rob uploads, update the docs.

## 5.8 Risks

- The CPU as *attacker* has never been exercised: expect edge cases in `declaration`/`preCombat` steps, forced restrictions on withdrawal, and `PASS_ALPHA`.
- Whole-game loops can hang: always cap turns and detect "no legal action for anyone".
- Alpha order interacts with the defender: a defender-alpha that was attacked still acts later. Don't treat "attacked" as "acted".
- Keep `main.js` thin; put decisions in the pure module so they are testable.

---

# 6. Known gaps and open observations (not the next task)

- **UI (M6):** shrink the bottom action bar into a small helper plus one primary Continue/Done button (needs Rob's design input); a cue for *which participant is up to act*; a scroll hint for rows wider than the screen. The red `−N` badge is damage *taken*; the `HP x/y` pill is health *left*.
- **Death Blow limits:** no repeat redirection of the same damage (6.10.3); damage-card side effects fire on the original target before the redirect; ordering against other damage-affecting cards is not modelled. Rivalry and "in the Hunting Grounds" limits on who can be a substitute are not enforced (the engine has no data for them).
- **Bonus-VP demonstration:** Scar Throat Leech-Killer (the rules' example) is not in the Unlimited data or `cardEffects.json`.
- **Card data:** many `Errata` fields in `public/rage_cards.json` are truncated. Agreed approach: patch as discrepancies appear. Reference text for **Taking the Death Blow's errata** (from `rageccg.weebly.com/spoilers.html`): *"Taking the Death Blow can only be used if both creatures could be in a pack action. This effect will not cross the Gauntlet. The original target of the attack escapes combat if able. If not, it creates a pack action. The creature using Taking the Death Blow always becomes Alpha if used during the combat phase. TtDB can only redirect damage cards: it cannot be played in response to effects which lower health or force a shapeshift. See rules on Redirecting Attacks."*
- **Rules breadth:** see the coverage table in `ROADMAP.md`.

---

# 7. What the last window learned

**Bugs found only by stress testing** (all fixed and covered by tests): (1) a creature saved from its fatal card but still lethally wounded "escaped" combat alive at negative health; (2) every wound was also in its owner's discard pile while attached, and regeneration never filed a healed wound — the two bugs hid each other; (3) cards played for prey were filed by the prey's owner, so they could be played twice and attached twice; (4) Bum Rush's escaping joiners could leave a side empty and crash the next round. None showed up in hand-written tests; all showed up within thousands of random games.

**Method.** Reproduce deterministically first; fix at the root; prove the test can fail (mutation); then re-run the same sampler that found it. When a failure is rare, make the test print exactly what failed so it explains itself next time.

**Process.** Verify claims mechanically before writing them into docs — an accuracy check found a function documented in the wrong file and a wrong test count. Long sessions slow down: write the handover earlier than feels necessary.

---

# 8. Documents and housekeeping

- `docs/` now holds: `rage_project_v1_1.md` (the charter), `AI_COLLABORATION.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, this file, the rules PDF, the card data files, `RageUnlimitedTruncated.txt` and `rage_cards_v2_changelog.md`. Superseded documents are archived in `docs/Old documents/` (the previous versions of the five main documents are in `Replaced 2026 Oct/`).
- **`docs/MAKE_PACK_COMBAT_WORK_HANDOVER.md` is obsolete — archive it under `Old documents/` (or delete it).** Its task is complete: the reveal overlay, contextual actions, participant markers and the tracer are all done. Its one open item (a cue for which participant is up to act) is carried into `ROADMAP.md` (M6) and §6 above. Its history is in `CHANGELOG.md`.
- At the end of your window, update `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md` and this file, and tell Rob which documents are obsolete.

---

# Appendix A — headless browser helper

Save as `lib.mjs` in a scratch directory that has `puppeteer-core` and `@sparticuz/chromium` installed.

```js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch() {
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox'],
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERR:', m.text().slice(0, 200)); });
  return { browser, page };
}

// click the first element matching `selector` whose text contains `text`
export async function clickText(page, selector, text) {
  const ok = await page.evaluate((sel, t) => {
    const b = [...document.querySelectorAll(sel)].find(x => x.textContent.includes(t));
    if (!b) return false; b.click(); return true;
  }, selector, text);
  if (!ok) throw new Error(`no ${selector} containing "${text}"`);
  await sleep(150);
}

export const actionLabels = page =>
  page.evaluate(() => [...document.querySelectorAll('#action-bar .action-btn')].map(b => b.textContent));
export const pressBar = (page, text) => clickText(page, '#action-bar .action-btn', text);

// open the app, load the Pack Combat Tracer, and click through to the Combat phase
export async function startTracer(page, url = 'http://127.0.0.1:5174/') {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await sleep(900);
  await clickText(page, 'button', 'Pack Combat Tracer');
  await sleep(400);
  for (let i = 0; i < 14; i++) {
    const labels = await actionLabels(page);
    if (labels.some(l => l.includes('your alpha'))) return labels;
    const next = labels.find(l => /^(Keep|Continue|End )/.test(l));
    if (!next) throw new Error('stuck at: ' + labels.join(' | '));
    await pressBar(page, next);
  }
  throw new Error('never reached combat');
}
```

Typical use: start Vite and run a script that imports this file **in one command**; tap cards with `page.evaluate(() => document.querySelector('#player-row .card-component').click())`; read state from the DOM (`.hp-pill`, `.is-dying`, `.is-attacking`, `.actionsheet-action`); screenshot with `page.screenshot({ path })` and view it.
