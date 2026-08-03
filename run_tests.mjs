// Standalone Node verification for cardEngine.js — no DOM, no Vite,
// just the pure state modules, run directly against real card defs.
import { readFileSync } from 'fs';

import {
  GameState, initGame, makeCardInstance, totalDamage, flipToBreed, isDead,
  effectiveRage, effectiveHealth, effectiveGnosis, effectiveRenown, effectiveVotingRenown,
  applyTempStatMod, countVP,
} from './game.js';
import { getLegalActions, performAction, nextPhase, enterPhase } from './turnManager.js';
import { initCardEngine, onCardEnteredPlay } from './cardEngine.js';
import { declareAttack, getCombatRoundActions, performCombatAction } from './combat.js';

const allCards = Object.values(JSON.parse(readFileSync('./public/rage_cards.json', 'utf8')))
  .filter(c => c.Expansion === 'Unlimited');
const byName = n => allCards.find(c => c.Name === n);
const effects = JSON.parse(readFileSync('./cardEffects.json', 'utf8'));

let pass = 0, fail = 0;
function check(label, cond) {
  console.log(cond ? `  ✅ ${label}` : `  ❌ ${label}`);
  cond ? pass++ : fail++;
}

// ── Set up a minimal game ─────────────────────────────────────────
const buggerhead = byName('Buggerhead');
const vet         = byName('Kinfolk Veterinarian');
const klaive       = byName('Grand Klaive');
const fillerChar   = allCards.find(c => c.Type?.startsWith('Character') && c.Name !== 'Buggerhead');
const galliard      = allCards.find(c => c.Name === 'Dharma Bum');
const battleSong    = byName('Battle Song');
const mokoleHide    = byName('Mokole Hide');
const timRowantree  = byName('Tim Rowantree');
const bloodOnWind   = byName('Blood-on-the-Wind');
const chargingBull  = allCards.find(c => c.Name === 'Charging Bull');   // Wendigo, not Blood-on-the-Wind
const oldRedEagle   = byName('Old Red Eagle');
const guidesToTruth = allCards.find(c => c.Name === 'Guides-to-Truth'); // Uktena, required by Old Red Eagle
const unicorn        = byName('Unicorn');
const wahyaOhni       = byName('War Paint of Wahya Ohni');
const mothersTouch   = byName("Mother's Touch");
const inbredDisorder = byName('Inbred Disorder');
const greyfist        = allCards.find(c => c.Name === 'Greyfist'); // Silver Fangs, opponent side
const curseOfHatred  = byName('Curse of Hatred');
const whelpBody       = byName('Whelp Body');
const trueForm        = byName('Take the True Form');
const serenity         = byName('Serenity');
const alaskanWolfHunt = byName('Alaskan Wolf Hunt');
const ragnarok         = byName('Ragnarok');
const burrow           = byName('Burrow');
const moonBridge       = byName('Moon Bridge Escape');
const growlsAtMoon    = allCards.find(c => c.Name === 'Growls-at-Moon'); // Red Talons, opponent side
const greaterBan      = byName('Greater Banishment');
const lesserBan        = byName('Lesser Banishment');
const removeBlessing  = byName("Remove Gaia's Blessing");
const jamTech          = byName('Jam Technology');
const grimfang          = byName('Grimfang');
const yuriTvarivich   = byName('Yuri Tvarivich');
const caernBuilding    = byName('Caern Building'); // generic Moot-type test vehicle, not itself scripted
const carlaGrimsson   = byName('Carla Grimsson');
const ritualChallenge = byName('Ritual Challenge'); // second Moot-type test vehicle
const falcon           = byName('Falcon');
const fenris            = byName('Fenris');
const pegasus           = byName('Pegasus');
const rat                = byName('Rat');
const chimera           = byName('Chimera');
const elderStone       = byName('Elder Stone');
const tvReporter       = byName('Kinfolk TV Reporter');
const riteOfInvestiture = byName('Rite of Investiture');
const fillerSept   = allCards.filter(c => !c.Type?.startsWith('Character') && !c.Type?.startsWith('Combat')).slice(0, 20);
const fillerCombat = allCards.filter(c => c.Type?.startsWith('Combat')).slice(0, 10);

console.log('Test cards:', { buggerhead: !!buggerhead, vet: !!vet, klaive: !!klaive, fillerChar: fillerChar?.Name });

initCardEngine(effects);
initGame(
  { characters: [buggerhead, fillerChar, galliard, chargingBull, timRowantree, guidesToTruth],
    sept: fillerSept, combat: fillerCombat },
  { characters: [fillerChar, greyfist, growlsAtMoon], sept: fillerSept, combat: fillerCombat },
  20
);

// ═══ TEST 1: Buggerhead — phaseAction/redraw ═══════════════════════
console.log('\n[1] Buggerhead: discard & redraw a chosen sept card');
GameState.phase = 'redraw';
const handBefore = GameState.player.septHand.length;
const deckBefore  = GameState.player.septDeck.length;
const actions1 = getLegalActions('player');
const buggActions = actions1.filter(a => a.abilityId === 'buggerhead_redraw');
check('grants one action per sept-hand card', buggActions.length === handBefore);
check('action label mentions Buggerhead', buggActions[0]?.label.startsWith('Buggerhead:'));

const targetCard = GameState.player.septHand[0];
const chosen = buggActions.find(a => a.targetInstanceId === targetCard.instanceId);
performAction('player', chosen);
check('target card left the hand', !GameState.player.septHand.some(c => c.instanceId === targetCard.instanceId));
check('target card is in sept discard', GameState.player.septDiscard.some(c => c.instanceId === targetCard.instanceId));
check('hand size unchanged (discard + redraw)', GameState.player.septHand.length === handBefore);
check('deck shrank by 1 (the redraw)', GameState.player.septDeck.length === deckBefore - 1);

// ═══ TEST 2: Kinfolk Veterinarian — phaseAction/regen ═════════════
console.log('\n[2] Kinfolk Veterinarian: extra heal in regen phase');
const vetInst = makeCardInstance(vet, 'player');
GameState.player.pack.push(vetInst);
const patient = GameState.player.pack.find(c => c.name === fillerChar.Name);
patient.damageCards = [
  { instanceId: 'dmg1', name: 'Test Wound 1', def: { Damage: '1' } },
  { instanceId: 'dmg2', name: 'Test Wound 2', def: { Damage: '2' } },
];
patient.aggravated = [];
GameState.phase = 'regen';
const actions2 = getLegalActions('player');
const vetActions = actions2.filter(a => a.abilityId === 'vet_extra_heal');
check('grants a heal action for the damaged character', vetActions.some(a => a.targetInstanceId === patient.instanceId));

const dmgBefore = patient.damageCards.length;
performAction('player', vetActions.find(a => a.targetInstanceId === patient.instanceId));
check('damage card count decreased', patient.damageCards.length === dmgBefore - 1);

// ═══ TEST 3: Grand Klaive — static conditional modifier ═══════════
console.log('\n[3] Grand Klaive: +1 Rage only while holder is in Crinos form');
const klaiveInst = makeCardInstance(klaive, 'player');
const wielder = patient; // reuse the same character

wielder.isCrinos = false;
const breedNoKlaive = effectiveRage(wielder);
wielder.attachments.push(klaiveInst);
klaiveInst.attachedTo = wielder;
check('no bonus in breed form', effectiveRage(wielder) === breedNoKlaive);

wielder.isCrinos = true;
wielder.attachments.pop(); // temporarily remove to measure the true Crinos-form baseline
const crinosBaseline = effectiveRage(wielder);
wielder.attachments.push(klaiveInst);
check('+1 Rage once in Crinos form', effectiveRage(wielder) === crinosBaseline + 1);

wielder.isCrinos = false;
check('bonus disappears back in breed form', effectiveRage(wielder) === breedNoKlaive);

// ═══ TEST 4: onPlay hook (synthetic ability — mechanism check) ════
console.log('\n[4] onPlay hook fires and can modify + self-discard (synthetic ability)');
initCardEngine({
  ...effects,
  'Test Totem': { abilities: [{
    id: 'test_onplay', trigger: { type: 'onPlay' },
    effect: { type: 'modifyPackStat', stat: 'rageMod', amount: 3 },
    then:   { type: 'discardSelf' },
  }]},
});
const testDef  = { Name: 'Test Totem', Type: 'Totem', Rage: '0', Gnosis: '0', Health: '0' };
const testInst = makeCardInstance(testDef, 'player');
GameState.player.septHand.push(testInst);
const packRageModBefore = GameState.player.pack.map(c => c.rageMod);
onCardEnteredPlay('player', testInst);
check('pack rageMod increased by 3', GameState.player.pack.every((c, i) => c.rageMod === packRageModBefore[i] + 3));
check('source card moved to sept discard', GameState.player.septDiscard.some(c => c.instanceId === testInst.instanceId));

// ═══ TEST 5: Battle Song — real Gift play pathway (the fix) ═══════
console.log('\n[5] Battle Song: played as a real Gift through getLegalActions/performAction');
GameState.phase = 'resource';
const songInst = makeCardInstance(battleSong, 'player');
GameState.player.septHand.push(songInst);
const dharma = GameState.player.pack.find(c => c.name === 'Dharma Bum');
const packModsBefore = GameState.player.pack.map(c => c.rageMod);

const actions5 = getLegalActions('player');
const giftActions = actions5.filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === songInst.instanceId);
check('Gift branch now offers a PLAY_GIFT action per target', giftActions.length === GameState.player.pack.concat(GameState.player.allies).length);

const castThroughDharma = giftActions.find(a => a.target.instanceId === dharma.instanceId);
performAction('player', castThroughDharma);
check('whole pack got +2 rageMod', GameState.player.pack.every((c, i) => c.rageMod === packModsBefore[i] + 2));
check('Battle Song discarded itself, not stuck in attachments', GameState.player.septDiscard.some(c => c.instanceId === songInst.instanceId));
check("not left dangling on the target's attachments", !dharma.attachments.some(a => a.instanceId === songInst.instanceId));

// ═══ TEST 6: Second batch — 6 more cards, 2 new capabilities ══════
console.log('\n[6a] Mokole Hide: unconditional +2 Health static');
const bull = GameState.player.pack.find(c => c.name === 'Charging Bull');
const bullHealthBefore = effectiveHealth(bull);
const hideInst = makeCardInstance(mokoleHide, 'player');
bull.attachments.push(hideInst);
hideInst.attachedTo = bull;
check('+2 Health with no condition needed', effectiveHealth(bull) === bullHealthBefore + 2);

console.log('\n[6b] Tim Rowantree: static gated on packHasCaern');
const tim = GameState.player.pack.find(c => c.name === 'Tim Rowantree');
const timRageNoCaern = effectiveRage(tim);
GameState.player.resources.caerns.push({ instanceId: 'test-caern', name: 'Test Caern' });
check('+2 Rage once pack has a caern', effectiveRage(tim) === timRageNoCaern + 2);
check('+1 Health once pack has a caern', effectiveHealth(tim) === Number(timRowantree.Health) + 1);
GameState.player.resources.caerns.pop();
check('bonus disappears once the caern is gone', effectiveRage(tim) === timRageNoCaern);

console.log('\n[6c] Blood-on-the-Wind: pack-wide scope, only affects matching keyword');
const bullRageBefore   = effectiveRage(bull);
const dharmaRageBefore = effectiveRage(dharma);
const bowInst = makeCardInstance(bloodOnWind, 'player');
GameState.player.pack.push(bowInst);
check("+1 Rage to Charging Bull (a different Wendigo)", effectiveRage(bull) === bullRageBefore + 1);
check('+1 Rage to Blood-on-the-Wind himself (also Wendigo, counted once)', effectiveRage(bowInst) === Number(bloodOnWind.Rage) + 1);
check('no bonus to a non-Wendigo packmate', effectiveRage(dharma) === dharmaRageBefore);

console.log('\n[6d] Old Red Eagle: 2 static bonuses + phaseAction extra-regen (reused verb)');
const eagleInst = makeCardInstance(oldRedEagle, 'player');
GameState.player.pack.push(eagleInst);
check('+4 Gnosis (Past Life cards have no base Gnosis of their own, so this is 0+4)', effectiveGnosis(eagleInst) === 4);
check('-3 Health, floored at 1 by existing Math.max', effectiveHealth(eagleInst) >= 1);
const guides = GameState.player.pack.find(c => c.name === 'Guides-to-Truth');
guides.damageCards = [{ instanceId: 'dmg3', name: 'Test Wound 3', def: { Damage: '1' } }];
GameState.phase = 'regen';
const eagleActions = getLegalActions('player').filter(a => a.abilityId === 'old_red_eagle_extra_regen');
check('grants an extra-regen choice, same verb as the Vet', eagleActions.some(a => a.targetInstanceId === guides.instanceId));

console.log('\n[6e] Past Life pathway (the new fix): Old Red Eagle only offered onto Uktena');
GameState.phase = 'resource';
const pastLifeCard = makeCardInstance(oldRedEagle, 'player');
GameState.player.septHand.push(pastLifeCard);
const plActions = getLegalActions('player').filter(a => a.type === 'PLAY_PAST_LIFE' && a.card.instanceId === pastLifeCard.instanceId);
check('offered onto Guides-to-Truth (Uktena, matches Requires)', plActions.some(a => a.target.instanceId === guides.instanceId));
check('NOT offered onto Buggerhead (Bone Gnawer, wrong tribe)', !plActions.some(a => a.target.name === 'Buggerhead'));
const awaken = plActions.find(a => a.target.instanceId === guides.instanceId);
performAction('player', awaken);
check('attached to Guides-to-Truth after playing', guides.attachments.some(a => a.instanceId === pastLifeCard.instanceId));
check('removed from sept hand', !GameState.player.septHand.some(c => c.instanceId === pastLifeCard.instanceId));

// ═══ TEST 7: Event pathway (new) + 2 more phaseAction cards ═══════
console.log('\n[7a] Unicorn: Event pathway (new fix) + phaseAction/regen');
GameState.phase = 'resource';
const unicornInst = makeCardInstance(unicorn, 'player');
GameState.player.septHand.push(unicornInst);
const eventActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === unicornInst.instanceId);
check('Event branch offers a PLAY_EVENT action', eventActions.length === 1);
performAction('player', eventActions[0]);
check('Unicorn entered ps.resources.events', GameState.player.resources.events.some(c => c.instanceId === unicornInst.instanceId));
check('removed from sept hand', !GameState.player.septHand.some(c => c.instanceId === unicornInst.instanceId));

const guides2 = GameState.player.pack.find(c => c.name === 'Guides-to-Truth');
guides2.damageCards.push({ instanceId: 'dmg4', name: 'Test Wound 4', def: { Damage: '1' } });
GameState.phase = 'regen';
const unicornActions = getLegalActions('player').filter(a => a.abilityId === 'unicorn_extra_regen');
check('grants an extra-regen choice from an Event card, same verb as the Vet', unicornActions.some(a => a.targetInstanceId === guides2.instanceId));

console.log('\n[7b] War Paint of Wahya Ohni: targetScope:holder restricts choices to the wearer only');
const eagle2 = GameState.player.pack.find(c => c.name === 'Old Red Eagle');
eagle2.damageCards = [{ instanceId: 'dmg5', name: 'Test Wound 5', def: { Damage: '1' } }];
const paintInst = makeCardInstance(wahyaOhni, 'player');
eagle2.attachments.push(paintInst);
paintInst.attachedTo = eagle2;
const paintActions = getLegalActions('player').filter(a => a.abilityId === 'wahya_ohni_extra_regen');
check('offers exactly 1 choice (the wearer)', paintActions.length === 1 && paintActions[0].targetInstanceId === eagle2.instanceId);
check('does NOT offer other damaged pack members', !paintActions.some(a => a.targetInstanceId === guides2.instanceId));

// ═══ TEST 8: Targeting (new capability) ═══════════════════════════
console.log("\n[8a] Mother's Touch: play-time target, own pack only, heals + self-discards");
GameState.phase = 'resource';
const touchInst = makeCardInstance(mothersTouch, 'player');
GameState.player.septHand.push(touchInst);
const guides3 = GameState.player.pack.find(c => c.name === 'Guides-to-Truth');
guides3.damageCards.push({ instanceId: 'dmg6', name: 'Test Wound 6', def: { Damage: '2' } });
const dmgCountBefore = guides3.damageCards.length;
const touchActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === touchInst.instanceId);
check('offered onto own damaged pack member', touchActions.some(a => a.target.instanceId === guides3.instanceId));
check("NOT offered onto any opponent character (Gift keeps its existing own-pack-only pool)", !touchActions.some(a => a.target.owner === 'opponent'));
performAction('player', touchActions.find(a => a.target.instanceId === guides3.instanceId));
check('healed (damage card count decreased)', guides3.damageCards.length === dmgCountBefore - 1);
check('Gift self-discarded after resolving', GameState.player.septDiscard.some(c => c.instanceId === touchInst.instanceId));

console.log('\n[8b] Inbred Disorder: first cross-player target, filtered by keyword');
const disorderInst = makeCardInstance(inbredDisorder, 'player');
GameState.player.septHand.push(disorderInst);
const disorderActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === disorderInst.instanceId);
const grey = GameState.opponent.pack.find(c => c.name === 'Greyfist');
check("offered onto Greyfist (opponent's Silver Fangs)", disorderActions.some(a => a.target.instanceId === grey.instanceId));
check('NOT offered onto Buggerhead (own side, wrong tribe)', !disorderActions.some(a => a.target.name === 'Buggerhead'));

const greyGnosisBefore = effectiveGnosis(grey);
performAction('player', disorderActions.find(a => a.target.instanceId === grey.instanceId));
check("-2 Gnosis applied to the OPPONENT's character", effectiveGnosis(grey) === greyGnosisBefore - 2);
check('attached on the opponent side, not the caster\'s', grey.attachments.some(a => a.instanceId === disorderInst.instanceId));

// ═══ TEST 9: 4 more targeting cards — cross-player Gift targeting ═══
console.log('\n[9a] Curse of Hatred: cross-player Gift target (Gift branch now honors targetRequirement)');
GameState.phase = 'resource';
const hatredInst = makeCardInstance(curseOfHatred, 'player');
GameState.player.septHand.push(hatredInst);
const grey2 = GameState.opponent.pack.find(c => c.name === 'Greyfist');
const grey2RageBefore = effectiveRage(grey2);
const hatredActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === hatredInst.instanceId);
check("Gift now offers the opponent's Greyfist as a target", hatredActions.some(a => a.target.instanceId === grey2.instanceId));
performAction('player', hatredActions.find(a => a.target.instanceId === grey2.instanceId));
check('-2 Rage applied to the opponent (rageMod)', effectiveRage(grey2) === grey2RageBefore - 2);
check('cleared by end-of-turn cleanup, same as Battle Song', (() => {
  GameState.phase = 'combat'; // last phase before wrap
  nextPhase(); // wraps to redraw, calls clearTurnModifiers()
  return effectiveRage(grey2) === grey2RageBefore;
})());

console.log('\n[9b] Whelp Body: cross-player static penalty, permanent');
GameState.phase = 'resource';
const whelpInst = makeCardInstance(whelpBody, 'player');
GameState.player.septHand.push(whelpInst);
const buggRageBefore = effectiveRage(GameState.player.pack.find(c => c.name === 'Buggerhead'));
const whelpActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === whelpInst.instanceId);
const buggerheadTarget = whelpActions.find(a => a.target.name === 'Buggerhead');
check('offered onto own side too (anyCharacter includes own pack)', !!buggerheadTarget);
performAction('player', buggerheadTarget);
const bugg = GameState.player.pack.find(c => c.name === 'Buggerhead');
check('-3 Rage static penalty applied (floored at 0 by the engine\'s existing Math.max, as expected)', effectiveRage(bugg) === Math.max(0, buggRageBefore - 3));

console.log('\n[9c] Take the True Form: forces breed form via existing flipToBreed()');
const dualFormTest = GameState.player.pack.find(c => c.name === 'Dharma Bum');
dualFormTest.isDualForm = true;
dualFormTest.isCrinos = true;
GameState.phase = 'resource';
const formInst = makeCardInstance(trueForm, 'player');
GameState.player.septHand.push(formInst);
const formActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === formInst.instanceId);
performAction('player', formActions.find(a => a.target.instanceId === dualFormTest.instanceId));
check('target flipped out of Crinos form', dualFormTest.isCrinos === false);
check('Gift self-discarded', GameState.player.septDiscard.some(c => c.instanceId === formInst.instanceId));

console.log('\n[9d] Serenity: clears frenzied on a synthetic frenzied instance');
const frenziedTest = GameState.player.pack.find(c => c.name === 'Charging Bull');
frenziedTest.frenzied = true;
GameState.phase = 'resource';
const sereneInst = makeCardInstance(serenity, 'player');
GameState.player.septHand.push(sereneInst);
const sereneActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === sereneInst.instanceId);
performAction('player', sereneActions.find(a => a.target.instanceId === frenziedTest.instanceId));
check('frenzied cleared', frenziedTest.frenzied === false);

// ═══ TEST 10: Delayed zone-return ══════════════════════════════════
console.log('\n[10a] Alaskan Wolf Hunt: mass removal, both sides, keyword-filtered');
GameState.phase = 'resource';
const huntInst = makeCardInstance(alaskanWolfHunt, 'player');
GameState.player.septHand.push(huntInst);
const huntActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === huntInst.instanceId);
performAction('player', huntActions[0]);
// No Red Talons on the player's own side in this setup, so this run
// specifically exercises the "reaches into the opponent's pack too" case.
check("removed Growls-at-Moon from the OPPONENT's pack", !GameState.opponent.pack.some(c => c.name === 'Growls-at-Moon'));
check('non-Red-Talons packmate (Greyfist) untouched', GameState.opponent.pack.some(c => c.name === 'Greyfist'));

console.log('\n[10b] Return processing: entering regen brings Growls-at-Moon back');
enterPhase('regen');
check('Growls-at-Moon back in the opponent\'s pack after regen', GameState.opponent.pack.some(c => c.name === 'Growls-at-Moon'));

console.log('\n[10c] Ragnarok: same mechanism, different tribe (Get of Fenris)');
GameState.phase = 'resource';
const ragnarokInst = makeCardInstance(ragnarok, 'player');
GameState.player.septHand.push(ragnarokInst);
const ragActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === ragnarokInst.instanceId);
performAction('player', ragActions[0]);
check('Carla Grimsson (Get of Fenris, fillerChar) removed from player\'s pack', !GameState.player.pack.some(c => c.name === 'Carla Grimsson'));

console.log('\n[10d] Burrow: self-target via Gift-holder, returns at regen');
GameState.phase = 'resource';
const burrowInst = makeCardInstance(burrow, 'player');
GameState.player.septHand.push(burrowInst);
const buggForBurrow = GameState.player.pack.find(c => c.name === 'Buggerhead');
const burrowActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === burrowInst.instanceId);
performAction('player', burrowActions.find(a => a.target.instanceId === buggForBurrow.instanceId));
check('Buggerhead removed from pack', !GameState.player.pack.some(c => c.name === 'Buggerhead'));
check('not eligible for alpha while removed (physically absent from pack array)', GameState.player.pack.every(c => c.name !== 'Buggerhead'));
enterPhase('regen');
check('Buggerhead back after regen', GameState.player.pack.some(c => c.name === 'Buggerhead'));
check('Carla Grimsson also returned (different removal, same regen return)', GameState.player.pack.some(c => c.name === 'Carla Grimsson'));

console.log('\n[10e] Moon Bridge Escape: single target, returns at redraw (not regen)');
GameState.phase = 'resource';
const bridgeInst = makeCardInstance(moonBridge, 'player');
GameState.player.septHand.push(bridgeInst);
const dharmaForBridge = GameState.player.pack.find(c => c.name === 'Dharma Bum');
const bridgeActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === bridgeInst.instanceId);
performAction('player', bridgeActions.find(a => a.target.instanceId === dharmaForBridge.instanceId));
check('Dharma Bum removed', !GameState.player.pack.some(c => c.name === 'Dharma Bum'));
enterPhase('redraw'); // NOT regen — should NOT bring Dharma back yet if regen were checked first, but redraw is the right one
check('back after REDRAW specifically, not regen', GameState.player.pack.some(c => c.name === 'Dharma Bum'));

// ═══ TEST 11: Attachment targeting (new capability) ════════════════
console.log('\n[11a] Lesser Banishment: Gnosis-ceiling filter excludes a too-expensive Gift');
GameState.phase = 'resource';
const lesserInst = makeCardInstance(lesserBan, 'player');
GameState.player.septHand.push(lesserInst);
const lesserActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === lesserInst.instanceId);
check("Whelp Body (Gnosis 7) NOT offered — exceeds maxGnosis:5", !lesserActions.some(a => a.target.name === 'Whelp Body'));
check('Grand Klaive (Equipment, wrong cardType) NOT offered either', !lesserActions.some(a => a.target.name === 'Grand Klaive'));

console.log("\n[11b] Remove Gaia's Blessing: boundary case, maxGnosis:7 includes a Gnosis-7 Gift");
const blessingInst = makeCardInstance(removeBlessing, 'player');
GameState.player.septHand.push(blessingInst);
const blessingActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === blessingInst.instanceId);
const whelpTarget = blessingActions.find(a => a.target.name === 'Whelp Body');
check('Whelp Body (Gnosis 7) IS offered — exactly at the ceiling', !!whelpTarget);
check('label identifies the holder, not just the Gift name', whelpTarget.label.includes('held by'));
const whelpHolder = whelpTarget.target.attachedTo;
performAction('player', whelpTarget);
check('Whelp Body detached from its holder', !whelpHolder.attachments.some(a => a.name === 'Whelp Body'));
check("Whelp Body in the OWNER's discard, not the caster's septHand debris", GameState.player.septDiscard.some(c => c.name === 'Whelp Body'));
check("Remove Gaia's Blessing discarded itself too", GameState.player.septDiscard.some(c => c.instanceId === blessingInst.instanceId));

console.log('\n[11c] Greater Banishment: no Gnosis ceiling, still only targets Gifts not Equipment');
const greaterInst = makeCardInstance(greaterBan, 'player');
GameState.player.septHand.push(greaterInst);
const greaterActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === greaterInst.instanceId);
check('no Equipment offered (Mokole Hide, Grand Klaive)', !greaterActions.some(a => ['Mokole Hide', 'Grand Klaive'].includes(a.target.name)));
check('no remaining Gifts left to target (Whelp Body already banished)', !greaterActions.some(a => a.target.name === 'Whelp Body'));

console.log('\n[11d] Jam Technology: targets Equipment specifically, not Gifts');
const jamInst = makeCardInstance(jamTech, 'player');
GameState.player.septHand.push(jamInst);
const jamActions = getLegalActions('player').filter(a => a.type === 'PLAY_GIFT' && a.card.instanceId === jamInst.instanceId);
const hideTarget = jamActions.find(a => a.target.name === 'Mokole Hide');
check('Mokole Hide (Equipment) is offered', !!hideTarget);
const hideHolder = hideTarget.target.attachedTo;
const holderHealthBefore = effectiveHealth(hideHolder);
performAction('player', hideTarget);
check("holder's +2 Health bonus is gone now that Mokole Hide is removed", effectiveHealth(hideHolder) === holderHealthBefore - 2);

// ═══ TEST 12: Moot-voting subsystem (first wave) ═══════════════════
console.log('\n[12a] VotingRenown static modifiers — positive and negative');
const dharmaVR = effectiveVotingRenown(GameState.player.pack.find(c => c.name === 'Dharma Bum'));
check('Dharma Bum (unscripted) has no VotingRenown bonus, equals effectiveRenown', dharmaVR === effectiveRenown(GameState.player.pack.find(c => c.name === 'Dharma Bum')));

const grimfangInst = makeCardInstance(grimfang, 'player');
GameState.player.pack.push(grimfangInst);
check('Grimfang: +3 VotingRenown over his effectiveRenown', effectiveVotingRenown(grimfangInst) === effectiveRenown(grimfangInst) + 3);

console.log('\n[12b] Yuri Tvarivich: Past Life pathway + 2 static bonuses (VotingRenown and Health)');
GameState.phase = 'resource';
const yuriInst = makeCardInstance(yuriTvarivich, 'player');
GameState.player.septHand.push(yuriInst);
const yuriActions = getLegalActions('player').filter(a => a.type === 'PLAY_PAST_LIFE' && a.card.instanceId === yuriInst.instanceId);
check("offered onto Grimfang (Silver Fangs, own pack — Past Life targeting is own-side-only by design)", yuriActions.some(a => a.target.instanceId === grimfangInst.instanceId));
const greyVRBefore = effectiveVotingRenown(grimfangInst);
const greyHealthBefore = effectiveHealth(grimfangInst);
performAction('player', yuriActions.find(a => a.target.instanceId === grimfangInst.instanceId));
check('+8 VotingRenown applied', effectiveVotingRenown(grimfangInst) === greyVRBefore + 8);
check('+1 Health applied (second ability on the same card)', effectiveHealth(grimfangInst) === greyHealthBefore + 1);

console.log('\n[12c] doCallMoot: vote tally through the real getLegalActions/performAction pathway');
GameState.phase = 'moot';
const caernInst = makeCardInstance(caernBuilding, 'player');
GameState.player.septHand.push(caernInst);
const mootActions = getLegalActions('player').filter(a => a.type === 'CALL_MOOT' && a.card.instanceId === caernInst.instanceId);
check('CALL_MOOT action generated for a Moot-type card', mootActions.length === 1);
performAction('player', mootActions[0]);
check("moot passes — player's pack (with Grimfang +3, Buggerhead, Carla-replacement, Tim, Dharma) clearly outweighs opponent's", caernInst.mootPassed === true);
check('card moved to activeJunta / globalEffects', GameState.globalEffects.some(c => c.instanceId === caernInst.instanceId));

// ═══ TEST 13: onMootOutcome trigger (Carla Grimsson) ═══════════════
console.log('\n[13] Carla Grimsson: forced Crinos + forced alpha on a failed moot');
const carlaInst = makeCardInstance(carlaGrimsson, 'opponent');
carlaInst.isDualForm = true; // force dual-form for this controlled test
GameState.opponent.pack.push(carlaInst);
check('starts in breed form', carlaInst.isCrinos === false);

GameState.phase = 'moot';
const challengeInst = makeCardInstance(ritualChallenge, 'opponent');
GameState.opponent.septHand.push(challengeInst);
const oppMootActions = getLegalActions('opponent').filter(a => a.type === 'CALL_MOOT' && a.card.instanceId === challengeInst.instanceId);
performAction('opponent', oppMootActions[0]);
check('this moot failed (opponent pack heavily outweighed by player pack\'s accumulated bonuses by this point)', challengeInst.mootPassed === false);
check('Carla flipped to Crinos', carlaInst.isCrinos === true);
check('Carla marked as forced alpha', carlaInst.forcedAlpha === true);

GameState.phase = 'combat';
enterPhase('combat');
check("the opponent's alpha this Combat Phase is a Carla Grimsson in Crinos form (forced, overriding auto-selection)",
  GameState.opponent.alpha?.name === 'Carla Grimsson' && GameState.opponent.alpha?.isCrinos === true);
check('forcedAlpha flag cleared on whichever instance was actually used', GameState.opponent.alpha?.forcedAlpha === false);

// ═══ TEST 14: Pack-wide Events/Allies, and player-level state ══════
console.log('\n[14a] Falcon: pack-wide VotingRenown, own side only');
GameState.phase = 'resource';
const buggForFalcon = GameState.player.pack.find(c => c.name === 'Buggerhead');
const falconVRBefore = effectiveVotingRenown(buggForFalcon);
const oppGreyVRBefore = effectiveVotingRenown(GameState.opponent.pack.find(c => c.name === 'Greyfist'));
const falconInst = makeCardInstance(falcon, 'player');
GameState.player.septHand.push(falconInst);
const falconActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === falconInst.instanceId);
performAction('player', falconActions[0]);
check('+1 VotingRenown to a player-side character', effectiveVotingRenown(buggForFalcon) === falconVRBefore + 1);
check("opponent's side untouched", effectiveVotingRenown(GameState.opponent.pack.find(c => c.name === 'Greyfist')) === oppGreyVRBefore);

console.log('\n[14b] Fenris: pack-wide Rage bonus, only in Crinos form');
const buggRageBeforeFenris = effectiveRage(buggForFalcon);
buggForFalcon.isCrinos = false;
const fenrisInst = makeCardInstance(fenris, 'player');
GameState.player.septHand.push(fenrisInst);
const fenrisActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === fenrisInst.instanceId);
performAction('player', fenrisActions[0]);
check('no Rage bonus in breed form', effectiveRage(buggForFalcon) === buggRageBeforeFenris);
buggForFalcon.isCrinos = true;
check('+1 Rage once in Crinos form', effectiveRage(buggForFalcon) > buggRageBeforeFenris);
buggForFalcon.isCrinos = false;

console.log('\n[14c] Pegasus and Rat: pack-wide Gnosis and Health');
const gnosisBefore = effectiveGnosis(buggForFalcon);
const healthBefore = effectiveHealth(buggForFalcon);
[pegasus, rat].forEach(def => {
  const inst = makeCardInstance(def, 'player');
  GameState.player.septHand.push(inst);
  const actions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === inst.instanceId);
  performAction('player', actions[0]);
});
check('+1 Gnosis from Pegasus', effectiveGnosis(buggForFalcon) === gnosisBefore + 1);
check('+1 Health from Rat', effectiveHealth(buggForFalcon) === healthBefore + 1);

console.log('\n[14d] Chimera: player-level septHandSize increase');
const handSizeBefore = GameState.player.septHandSize;
const chimeraInst = makeCardInstance(chimera, 'player');
GameState.player.septHand.push(chimeraInst);
const chimeraActions = getLegalActions('player').filter(a => a.type === 'PLAY_EVENT' && a.card.instanceId === chimeraInst.instanceId);
performAction('player', chimeraActions[0]);
check('septHandSize increased by 1', GameState.player.septHandSize === handSizeBefore + 1);

console.log('\n[14e] Elder Stone (Equipment) and Kinfolk TV Reporter (Ally): more VotingRenown sources');
const stoneVRBefore = effectiveVotingRenown(buggForFalcon);
const stoneInst = makeCardInstance(elderStone, 'player');
GameState.player.septHand.push(stoneInst);
const stoneActions = getLegalActions('player').filter(a => a.type === 'PLAY_EQUIPMENT' && a.card.instanceId === stoneInst.instanceId);
performAction('player', stoneActions.find(a => a.target.instanceId === buggForFalcon.instanceId));
check('+3 VotingRenown from Elder Stone (holder only)', effectiveVotingRenown(buggForFalcon) === stoneVRBefore + 3);

const reporterVRBefore = effectiveVotingRenown(GameState.player.pack.find(c => c.name === 'Tim Rowantree'));
const reporterInst = makeCardInstance(tvReporter, 'player');
GameState.player.septHand.push(reporterInst);
const reporterActions = getLegalActions('player').filter(a => a.type === 'PLAY_RESOURCE' && a.card.instanceId === reporterInst.instanceId);
performAction('player', reporterActions[0]);
check('+2 VotingRenown pack-wide from an Ally (checked on a different pack member)',
  effectiveVotingRenown(GameState.player.pack.find(c => c.name === 'Tim Rowantree')) === reporterVRBefore + 2);

// ═══ TEST 15: Rite of Investiture — checkPlayCondition + promoteAllyToPack
console.log('\n[15] Rite of Investiture: gated on a successful moot, promotes an ally to the pack');
GameState.phase = 'moot';
GameState.player.hadSuccessfulMootThisPhase = false; // simulate a fresh moot phase, nothing passed yet
const riteInst = makeCardInstance(riteOfInvestiture, 'player');
GameState.player.septHand.push(riteInst);
check('NOT offered before any moot has passed this phase', getLegalActions('player').filter(a => a.card?.instanceId === riteInst.instanceId).length === 0);

const secondCaernInst = makeCardInstance(caernBuilding, 'player');
GameState.player.septHand.push(secondCaernInst);
const secondMootActions = getLegalActions('player').filter(a => a.type === 'CALL_MOOT' && a.card.instanceId === secondCaernInst.instanceId);
performAction('player', secondMootActions[0]);
check('moot passed (player side still heavily favored)', secondCaernInst.mootPassed === true);

const riteActions = getLegalActions('player').filter(a => a.type === 'PLAY_RITE' && a.card.instanceId === riteInst.instanceId);
const reporterAlly = GameState.player.allies.find(c => c.name === 'Kinfolk TV Reporter');
check('now offered, targeting the Kinfolk TV Reporter ally', riteActions.some(a => a.target.instanceId === reporterAlly.instanceId));
performAction('player', riteActions.find(a => a.target.instanceId === reporterAlly.instanceId));
check('ally moved out of allies', !GameState.player.allies.some(c => c.instanceId === reporterAlly.instanceId));
check('ally now a full pack member', GameState.player.pack.some(c => c.instanceId === reporterAlly.instanceId));
check('Rite discarded itself', GameState.player.septDiscard.some(c => c.instanceId === riteInst.instanceId));

enterPhase('moot');
check('flag resets on a new Moot Phase entry', GameState.player.hadSuccessfulMootThisPhase === false);

// ═══ TEST 16: Pass loop / walking skeleton ══════════════════════════
console.log('\n[16] Full phase loop: Redraw advances correctly and the cycle returns to redraw with turn++');
GameState.phase = 'redraw';
const turnBefore = GameState.turn;
const endRedrawActions = getLegalActions('player').filter(a => a.type === 'END_REDRAW');
check('END_REDRAW action is offered in Redraw phase', endRedrawActions.length === 1);
performAction('player', endRedrawActions[0]);
check('END_REDRAW now advances phase to regen (the bug fix)', GameState.phase === 'regen');

// Walk the rest of the loop via nextPhase() directly, verifying every
// remaining phase passes through without throwing, and that the
// sequence returns to redraw with the turn counter incremented.
for (let i = 0; i < 5; i++) nextPhase();
check('phase cycles back to redraw', GameState.phase === 'redraw');
check('turn counter incremented on wraparound', GameState.turn === turnBefore + 1);

// ═══ TEST 17: Combat vertical tracer ════════════════════════════════
// One alpha, one enemy, one card, one reveal, one damage application,
// one heal — proves the existing combat plumbing connects end-to-end.
// Runs in its own fresh initGame() so it's fully isolated from the
// accumulated pack/hand/damage state of Tests 1-16.
console.log('\n[17] Combat vertical tracer: seeded deck → declare attack → play card → reveal → damage attaches → regen heals');

const glancingBlow = byName('Glancing Blow');
const grazingWound  = byName('Grazing Wound');
const fleshWound    = byName('Flesh Wound');
// Both single-form (non-dual) with Rage/Health >= 3, so a single 1-damage
// hit neither kills nor triggers a Crinos flip — keeps this first pass
// as simple as the brief asks for. (Single-form chars can't flip at all.)
const tracerPlayerChar = byName('Cernonous');
const tracerOppChar    = byName('Allamande');
check('tracer combat cards and characters found',
  !!glancingBlow && !!grazingWound && !!fleshWound && !!tracerPlayerChar && !!tracerOppChar);

initGame(
  { characters: [tracerPlayerChar], sept: [],
    combat: [glancingBlow, glancingBlow, grazingWound, grazingWound, fleshWound] },
  { characters: [tracerOppChar], sept: [], combat: [] }, // 0 cards → PASS is CPU's only option
  20
);

check('player combat hand seeded with all 5 vanilla cards', GameState.player.combatHand.length === 5);
check('opponent combat hand is empty', GameState.opponent.combatHand.length === 0);

enterPhase('combat');
check('opponent alpha auto-selected (CPU simplification unchanged)', GameState.opponent.alpha === GameState.opponent.pack[0]);
check('player alpha NOT auto-selected — real choice required (rule 2.2.6)', GameState.player.alpha === null);

const alphaChoices = getLegalActions('player').filter(a => a.type === 'SELECT_ALPHA');
check('player offered exactly one SELECT_ALPHA choice (single pack member)', alphaChoices.length === 1);
check('SELECT_ALPHA offers the player\'s only pack member', alphaChoices[0].card === GameState.player.pack[0]);

performAction('player', { type: 'SELECT_ALPHA', card: alphaChoices[0].card });
check('player alpha set after SELECT_ALPHA', GameState.player.alpha === GameState.player.pack[0]);

const declareActions = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
check('exactly one DECLARE_ATTACK offered (single enemy: opponent alpha)', declareActions.length === 1);
check('DECLARE_ATTACK targets opponent alpha', declareActions[0].target === GameState.opponent.alpha);

declareAttack('player', declareActions[0].attacker, declareActions[0].target);
check('combat state created', !!GameState.combat);
check('combat starts at playCard step', GameState.combat.step === 'playCard');

const playerRoundActions = getCombatRoundActions('player').filter(a => a.type === 'PLAY_COMBAT_CARD');
check('player offered all 5 seeded cards to play', playerRoundActions.length === 5);

const oppRoundActions = getCombatRoundActions('opponent');
check('opponent has only PASS_COMBAT_CARD available (0 cards in hand)',
  oppRoundActions.length === 1 && oppRoundActions[0].type === 'PASS_COMBAT_CARD');

const cardToPlay = playerRoundActions[0].card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: cardToPlay });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });

// Both sides have committed — combat now PAUSES at the reveal step
// (rulebook 6.2 step 3: both cards flip together) rather than
// instantly resolving. Nothing should be computed yet.
check('round pauses at reveal step instead of auto-resolving', GameState.combat.step === 'reveal');
check('damage NOT yet applied while paused at reveal', GameState.opponent.alpha.damageCards.length === 0);
check('player combat hand still at 5 during pause — discard only happens at resolution', GameState.player.combatHand.length === 5);

const revealActionsPlayer = getCombatRoundActions('player');
check('CONTINUE_REVEAL offered to the player at reveal step',
  revealActionsPlayer.some(a => a.type === 'CONTINUE_REVEAL'));
check('CPU has nothing to do at reveal step (pure viewing pause)',
  getCombatRoundActions('opponent').length === 0);

performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('round resolved through reveal/resolution to withdrawal', GameState.combat.step === 'withdrawal');
check('damage card attached directly to target.damageCards',
  GameState.opponent.alpha.damageCards.includes(cardToPlay));
check('totalDamage reflects the attached card', totalDamage(GameState.opponent.alpha) === 1);
check('player combat hand down to 4 (one played)', GameState.player.combatHand.length === 4);
check('played card moved to combat discard', GameState.player.combatDiscard.includes(cardToPlay));

performCombatAction('player', { type: 'WITHDRAW' });
check('combat ended after withdrawal', GameState.combat === null);

// Rule 2.2.6: the alpha's ONE alpha action for this Combat Phase is
// used up — withdrawing doesn't refund it, so no fresh
// SELECT_ALPHA/DECLARE_ATTACK loop should be possible this phase.
check('alpha marked as having acted this Combat Phase', GameState.player.alphaActedThisCombatPhase === true);
const postWithdrawActions = getLegalActions('player');
check('only ADVANCE_PHASE offered after withdrawal — no re-attack loop',
  postWithdrawActions.length === 1 && postWithdrawActions[0].type === 'ADVANCE_PHASE');

// Jump straight to a later Regen Phase and confirm exactly one wound
// heals — regenerate() heals one non-aggravated card per call, not all.
enterPhase('regen');
check('wound healed after one Regen Phase', GameState.opponent.alpha.damageCards.length === 0);
check('totalDamage back to zero after heal', totalDamage(GameState.opponent.alpha) === 0);

// ═══ TEST 18: Combat auto-ends when nobody plays anything ═══════════
// Rule 6.3: "no creature played a Combat Action during the current
// combat round" ends combat on its own — separate from, and not
// requiring, an explicit attacker withdrawal.
console.log('\n[18] Combat auto-ends when both sides pass, without an explicit withdrawal');

initGame(
  { characters: [tracerPlayerChar], sept: [],
    combat: [glancingBlow, grazingWound, fleshWound] }, // hand has cards, but we won't play any
  { characters: [tracerOppChar], sept: [], combat: [] },
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declareActions18 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declareActions18[0].attacker, declareActions18[0].target);

// Player deliberately passes despite having playable cards in hand
// (rule 6.2: "players do not have to play combat cards for all, or
// any, of their creatures") — opponent has none to play either.
performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });

check('round still pauses at reveal even when both passed', GameState.combat.step === 'reveal');
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('combat ended automatically — no WITHDRAW action was ever called', GameState.combat === null);
check('alpha marked as having acted this Combat Phase (auto-end path too)',
  GameState.player.alphaActedThisCombatPhase === true);
const postAutoEndActions = getLegalActions('player');
check('only ADVANCE_PHASE offered after auto-end — no re-attack loop',
  postAutoEndActions.length === 1 && postAutoEndActions[0].type === 'ADVANCE_PHASE');

// ═══ TEST 19: Alpha action resets fresh on the NEXT Combat Phase ═════
// Rule 2.2.6: "A player may select a different alpha every combat
// phase, or use the same one repeatedly" — confirming the lock is
// per-phase, not a permanent one-time restriction.
console.log('\n[19] A new Combat Phase gives the alpha a fresh action, not a permanent lock');

enterPhase('regen');
enterPhase('combat');
check('player alpha reset to null for the new Combat Phase', GameState.player.alpha === null);
check('alphaActedThisCombatPhase reset to false for the new phase',
  GameState.player.alphaActedThisCombatPhase === false);
const freshPhaseActions = getLegalActions('player').filter(a => a.type === 'SELECT_ALPHA');
check('SELECT_ALPHA offered again on the fresh Combat Phase', freshPhaseActions.length === 1);

// ═══ TEST 20: Aggravated damage — Fur Gnarl + Crinos flip ═══════════
// Combines the two remaining tracer items (aggravated damage, breed/
// Crinos flipping) into one scenario, since Fur Gnarl's own condition
// ties them together: "if the victim takes this wound in Crinos form,
// this damage is aggravated" (Errata: checked once, at the moment the
// wound lands — not re-evaluated if the victim later shifts back).
console.log('\n[20] Aggravated damage: Fur Gnarl marks a wound aggravated only if the victim was already in Crinos form');

const furGnarl = byName('Fur Gnarl');
const shakar   = allCards.find(c => c.Name === 'Shakar'); // dual-form, breed Rage 1 / Health 1 — a single hit forces an immediate flip
check('Fur Gnarl and Shakar found', !!furGnarl && !!shakar);

initGame(
  { characters: [tracerPlayerChar], sept: [],
    combat: [furGnarl, furGnarl] },               // 2 copies — deck max per rule 2.1.2
  { characters: [shakar], sept: [], combat: [] },  // 0 cards → PASS is CPU's only option
  20
);

check('Shakar starts in breed form', GameState.opponent.pack[0].isCrinos === false);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declareActions20 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declareActions20[0].attacker, declareActions20[0].target);

const victim = GameState.opponent.alpha; // Shakar

// ── Round 1: Fur Gnarl lands while Shakar is still in breed form ──
const round1Card = getCombatRoundActions('player').find(a => a.type === 'PLAY_COMBAT_CARD').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: round1Card });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('round 1 wound attached', victim.damageCards.length === 1);
check('round 1 wound is NOT aggravated (victim was in breed form when it landed)',
  victim.aggravated.length === 0);
check('taking the wound flipped Shakar to Crinos (breed Health 1 exceeded)',
  victim.isCrinos === true);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// ── Round 2: Fur Gnarl lands while Shakar is now in Crinos form ──
const round2Card = getCombatRoundActions('player').find(a => a.type === 'PLAY_COMBAT_CARD').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: round2Card });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('round 2 wound attached (2 total)', victim.damageCards.length === 2);
check('exactly one wound is aggravated', victim.aggravated.length === 1);
check("the aggravated wound is round 2's card, not round 1's",
  victim.aggravated.includes(round2Card.instanceId) && !victim.aggravated.includes(round1Card.instanceId));
check('Shakar survives both hits (4 damage vs Crinos Health 5)', totalDamage(victim) === 4);

// Errata: the mark must survive a later shift back to breed form.
flipToBreed(victim);
check('Shakar flipped back to breed form', victim.isCrinos === false);
check('round 2 wound is still marked aggravated after the flip back',
  victim.aggravated.includes(round2Card.instanceId));

performCombatAction('player', { type: 'WITHDRAW' });
enterPhase('regen');

check('regeneration healed the non-aggravated wound, leaving the aggravated one attached',
  victim.damageCards.length === 1 && victim.damageCards[0] === round2Card);
check('aggravated record still correctly tracks the surviving wound',
  victim.aggravated.includes(round2Card.instanceId));

// ═══ TEST 21: Opponent playing real combat cards — genuine two-card Reveal ═══
// Tests 17-20 all gave Allamande an empty combat deck so the CPU only
// ever passes — deliberate, to isolate earlier mechanics. This is the
// first test where BOTH sides reveal a real Combat Action in the same
// round, which exercises a path resolveBluffAndDamage() has always had
// but that's never actually run: the attacker taking damage back from
// the defender's own card.
console.log('\n[21] Combat: opponent playing a real combat card produces a genuine two-card Reveal, with damage flowing both ways');

initGame(
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound] },
  { characters: [tracerOppChar],    sept: [], combat: [grazingWound] },
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declareActions21 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declareActions21[0].attacker, declareActions21[0].target);

check('opponent alpha now holds a real combat card (not the usual empty hand)',
  GameState.opponent.combatHand.length === 1);

const oppRoundActions21 = getCombatRoundActions('opponent');
check('opponent now has a genuine PLAY_COMBAT_CARD choice, not just PASS',
  oppRoundActions21.some(a => a.type === 'PLAY_COMBAT_CARD'));

const playerCard21 = getCombatRoundActions('player').find(a => a.type === 'PLAY_COMBAT_CARD').card;
const oppCard21     = oppRoundActions21.find(a => a.type === 'PLAY_COMBAT_CARD').card;

performCombatAction('player',   { type: 'PLAY_COMBAT_CARD', card: playerCard21 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: oppCard21 });

check('round reaches reveal with BOTH cards genuinely played (not a pass)',
  GameState.combat.step === 'reveal' &&
  GameState.combat.attackerCard === playerCard21 &&
  GameState.combat.defenderCard === oppCard21);
check('opponent still has nothing to do at reveal — same pure pause as the pass case',
  getCombatRoundActions('opponent').length === 0);

performCombatAction('player', { type: 'CONTINUE_REVEAL' });

const playerAlpha21 = GameState.player.alpha;
const oppAlpha21    = GameState.opponent.alpha;

check("defender took damage from the player's card (already-exercised path)",
  oppAlpha21.damageCards.includes(playerCard21));
check("attacker took damage back from the OPPONENT'S card — the untested path",
  playerAlpha21.damageCards.includes(oppCard21));
check('combat did NOT auto-end (both sides played real cards — not a mutual pass)',
  GameState.combat !== null && GameState.combat.step === 'withdrawal');
check("both played cards moved to their owners' combat discard piles",
  GameState.player.combatDiscard.includes(playerCard21) &&
  GameState.opponent.combatDiscard.includes(oppCard21));

performCombatAction('player', { type: 'WITHDRAW' });
check('combat ends cleanly after a genuine two-card round', GameState.combat === null);

// ═══ TEST 22: Scoped Rage modifiers — endOfCombat (Broken Limb, Nerve Cluster) ═══
// First two of the "scoped Rage modifier" card family. Both persist
// across multiple combat rounds and are only ever cleared by
// combat.js's endCombat() — there's no other expiry check for them
// (see game.js's isTempModActive()), so this also regression-tests
// that the clearing actually happens.
console.log('\n[22] Rage modifiers: Broken Limb (-2, whole combat) and Nerve Cluster (Rage set to 1, whole combat)');

const brokenLimb   = byName('Broken Limb');
const nerveCluster = byName('Nerve Cluster');
check('Broken Limb and Nerve Cluster found', !!brokenLimb && !!nerveCluster);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [brokenLimb, nerveCluster] }, // Allamande, Rage 6 — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [] },                          // Cernonous, Rage 5 / Health 7 — victim
  20
);

check('Cernonous starts at baseline Rage 5', effectiveRage(GameState.opponent.pack[0]) === 5);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare22 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare22[0].attacker, declare22[0].target);

const victim22 = GameState.combat.defender; // Cernonous

// Round 1: Broken Limb
const bl22 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Broken Limb').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: bl22 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Broken Limb debuff applied: Rage 5 - 2 = 3', effectiveRage(victim22) === 3);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: Nerve Cluster
const nc22 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Nerve Cluster').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: nc22 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Cernonous survives both hits (4 damage vs Health 7)', totalDamage(victim22) === 4);
check('a "set" modifier overrides the still-active "-2 delta" entirely: Rage becomes 1, not 3',
  effectiveRage(victim22) === 1);

performCombatAction('player', { type: 'WITHDRAW' });

check('both endOfCombat modifiers are cleared the instant combat ends', victim22.tempMods.length === 0);
check('Rage is fully restored to baseline once combat has ended', effectiveRage(victim22) === 5);

// ═══ TEST 23: Scoped Rage modifiers — untilThisWoundHealed (Disembowelment) ═══
// This expiry type has no explicit "clear" call anywhere — its
// validity is just "is the specific wound it's tied to still present".
// The interesting case: healing an UNRELATED, lower-damage wound first
// must NOT clear it, only healing the Disembowelment wound itself does.
console.log('\n[23] Rage modifiers: Disembowelment (-1 Rage until THAT wound heals, not any wound)');

const disembowelment = byName('Disembowelment');
check('Disembowelment found', !!disembowelment);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [disembowelment, glancingBlow] },
  { characters: [tracerPlayerChar], sept: [], combat: [] },
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare23 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare23[0].attacker, declare23[0].target);

const victim23 = GameState.combat.defender; // Cernonous

// Round 1: Disembowelment (damage 3)
const db23 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Disembowelment').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: db23 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Disembowelment debuff applied: Rage 5 - 1 = 4', effectiveRage(victim23) === 4);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: an unrelated, smaller wound (Glancing Blow, damage 1) — must not clear the debuff
const gb23 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb23 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Cernonous survives both hits (4 damage vs Health 7)', totalDamage(victim23) === 4);
check('debuff still active — the unrelated Glancing Blow wound has nothing to do with it',
  effectiveRage(victim23) === 4);

performCombatAction('player', { type: 'WITHDRAW' });
enterPhase('regen');

check('first regeneration heals the LOWEST-damage wound (Glancing Blow), not Disembowelment',
  victim23.damageCards.length === 1 && victim23.damageCards[0] === db23);
check('debuff is STILL active — Disembowelment\'s own wound is still attached',
  effectiveRage(victim23) === 4);

enterPhase('regen');

check('second regeneration finally heals the Disembowelment wound itself', victim23.damageCards.length === 0);
check('debuff is gone now that its specific wound is healed', effectiveRage(victim23) === 5);
check('the temp-mod record itself was cleaned up, not just made inactive', victim23.tempMods.length === 0);

// ═══ TEST 24: Scoped Rage modifiers — nextRound, self (Off-balanced Attack) ═══
// "The character playing this card" — a SELF-debuff, not a victim
// debuff, which is why onDamageResolved() needed the attacker (source)
// passed through as well as the victim. Also the first check that a
// 'nextRound' modifier does NOT apply during the round it was created.
console.log('\n[24] Rage modifiers: Off-balanced Attack (-1 Rage to SELF, next round only)');

const offBalanced = byName('Off-balanced Attack');
check('Off-balanced Attack found', !!offBalanced);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [offBalanced, glancingBlow] }, // Allamande — plays it on itself
  { characters: [tracerPlayerChar], sept: [], combat: [] },
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare24 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare24[0].attacker, declare24[0].target);

const attacker24 = GameState.combat.attacker; // Allamande
check('Allamande starts at baseline Rage 6', effectiveRage(attacker24) === 6);

// Round 1: Off-balanced Attack
const oba24 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Off-balanced Attack').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: oba24 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('NOT active yet during the round it was played in — still Rage 6',
  effectiveRage(attacker24) === 6);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

check('active during the very next round: Rage 6 - 1 = 5', effectiveRage(attacker24) === 5);

// Round 2: Glancing Blow, just to keep combat going one more round
const gb24 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb24 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('still active for the whole of that one round', effectiveRage(attacker24) === 5);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

check('expired by the round after that — back to Rage 6', effectiveRage(attacker24) === 6);

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 25: Scoped Rage modifiers — nextRound, victim (Stinging Wound, Vital Blow) ═══
// Stinging Wound is the odd one out in this family: a +1 BUFF to the
// victim, not a debuff. Chaining it into Vital Blow in the same combat
// also checks that an expiring delta and a not-yet-active set don't
// interfere with each other while both sit in tempMods at once.
console.log('\n[25] Rage modifiers: Stinging Wound (+1 to victim, next round) then Vital Blow (victim set to 1, next round)');

const stingingWound = byName('Stinging Wound');
const vitalBlow      = byName('Vital Blow');
check('Stinging Wound and Vital Blow found', !!stingingWound && !!vitalBlow);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [stingingWound, vitalBlow] }, // Allamande, Rage 6 — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [] },                          // Cernonous, Rage 5 / Health 7 — victim
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare25 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare25[0].attacker, declare25[0].target);

const victim25 = GameState.combat.defender; // Cernonous

// Round 1: Stinging Wound (damage 2)
const sw25 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Stinging Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: sw25 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('not active yet the round it landed — still Rage 5', effectiveRage(victim25) === 5);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

check('active next round: Rage 5 + 1 = 6', effectiveRage(victim25) === 6);

// Round 2: Vital Blow (damage 4) — total damage 2+4=6, under Health 7
const vb25 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Vital Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: vb25 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Cernonous survives both hits (6 damage vs Health 7)', totalDamage(victim25) === 6);
check("Vital Blow's set-mod isn't active yet this same round — Stinging Wound's +1 still the only one showing: Rage 6",
  effectiveRage(victim25) === 6);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

check("Stinging Wound's buff has expired AND Vital Blow's set has kicked in: Rage 1, not 6 or 5",
  effectiveRage(victim25) === 1);

performCombatAction('player', { type: 'WITHDRAW' });

check("nextRound mods go inactive the instant combat ends, even without explicit clearing",
  effectiveRage(victim25) === 5);

// ═══ TEST 26: Dodge/Block subsystem ═══════════════════════════
// First live exercise of resolveBluffAndDamage()'s dodge check.
// Morihei High-Mountain (genuinely has Kailindo, unlike our other
// tracer characters) is the player/attacker, so Evade and Strike is
// played legitimately rather than relying on the engine's current gap
// of not yet checking non-Rage requirements like "Requires: Kailindo".
console.log('\n[26] Dodge/Block: Dodge and Evasion avoid a normal attack but not an Undodgeable one; Evade and Strike does both dodge and damage');

const dodge          = byName('Dodge');
const evasion         = byName('Evasion');
const evadeAndStrike  = byName('Evade and Strike');
const carefulStrike   = byName('Careful Strike');
const morihei         = allCards.find(c => c.Name === 'Morihei High-Mountain');
check('Dodge, Evasion, Evade and Strike, Careful Strike, Morihei all found',
  !!dodge && !!evasion && !!evadeAndStrike && !!carefulStrike && !!morihei);

initGame(
  { characters: [morihei],      sept: [], combat: [dodge, evasion, evadeAndStrike] },       // Rage 3 — covers all three
  { characters: [tracerOppChar], sept: [], combat: [grazingWound, carefulStrike, grazingWound] }, // Allamande
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare26 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare26[0].attacker, declare26[0].target);

const dodger26 = GameState.combat.attacker; // Morihei
const foe26    = GameState.combat.defender; // Allamande

// Round 1: Dodge vs. a normal (dodgeable) Grazing Wound
const dodge26 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Dodge').card;
const gw1_26 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Grazing Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: dodge26 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gw1_26 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Dodge avoided the normal attack — no damage at all', dodger26.damageCards.length === 0);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: Evasion vs. Careful Strike (Undodgeable) — the dodge must fail
const evasion26 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Evasion').card;
const cs26 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Careful Strike').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: evasion26 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: cs26 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("Evasion has no effect on an Undodgeable card — Careful Strike's damage lands anyway",
  dodger26.damageCards.length === 1 && dodger26.damageCards[0] === cs26);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 3: Evade and Strike — dodges the incoming Grazing Wound AND deals its own damage
const es26 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Evade and Strike').card;
const gw2_26 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Grazing Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: es26 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gw2_26 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("Evade and Strike's dodge half avoided the incoming Grazing Wound — still just the 1 Careful Strike wound",
  dodger26.damageCards.length === 1);
check("Evade and Strike's own attack half still landed on the opponent", totalDamage(foe26) === 1);
check('Morihei survives (1 damage vs Health 3)', totalDamage(dodger26) === 1);
check('Allamande survives (1 damage vs Health 5)', totalDamage(foe26) === 1);

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 27: Forced/restricted play — Head Wound ═════════════
// Victim may not play a Combat Action next round — but the errata
// confirms that's not the same as being unable to withdraw. Also
// checks the flag doesn't accidentally leak past its one round.
console.log('\n[27] Forced/restricted play: Head Wound (no Combat Action next round, but CAN still withdraw)');

const headWound = byName('Head Wound');
check('Head Wound found', !!headWound);

initGame(
  { characters: [tracerPlayerChar], sept: [], combat: [glancingBlow, fleshWound] }, // Cernonous — attacker, gets wounded
  { characters: [tracerOppChar],    sept: [], combat: [headWound, glancingBlow] },   // Allamande — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare27 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare27[0].attacker, declare27[0].target);

const attacker27 = GameState.combat.attacker; // Cernonous

// Round 1: player plays Glancing Blow, opponent plays Head Wound (hits the attacker)
const gb27a = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
const hw27 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Head Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb27a });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: hw27 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Head Wound landed on the attacker', attacker27.damageCards.includes(hw27));

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: the flag is now active
check('cannotPlayCombatAction active: only PASS offered, even with Flesh Wound still in hand',
  getCombatRoundActions('player').every(a => a.type === 'PASS_COMBAT_CARD'));

const gb27b = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gb27b });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('errata: the wounded attacker can still withdraw despite cannotPlayCombatAction',
  getCombatRoundActions('player').some(a => a.type === 'WITHDRAW'));

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 3: flag has expired
check('cannotPlayCombatAction has expired — Flesh Wound offered again',
  getCombatRoundActions('player').some(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound'));
check('Cernonous survives (3 damage vs Health 7)', totalDamage(attacker27) === 3);

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 28: Forced/restricted play — Organ Puncture ═════════
// "Cannot initiate combat until this wound is healed" — this is the
// one restriction that isn't about a combat ROUND at all, but about
// being allowed to declare an attack in a later Combat Phase. Tests
// blocked-while-wounded, then available-again-once-healed, across
// two entirely separate combats.
console.log('\n[28] Forced/restricted play: Organ Puncture (cannot initiate a NEW combat until healed)');

const organPuncture = byName('Organ Puncture');
check('Organ Puncture found', !!organPuncture);

initGame(
  { characters: [tracerPlayerChar], sept: [], combat: [] },                 // Cernonous — will be wounded
  { characters: [tracerOppChar],    sept: [], combat: [organPuncture] },     // Allamande
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare28 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare28[0].attacker, declare28[0].target);

const wounded28 = GameState.combat.attacker; // Cernonous

const op28 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Organ Puncture').card;
performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: op28 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Organ Puncture landed', wounded28.damageCards.includes(op28));

performCombatAction('player', { type: 'WITHDRAW' });

// A fresh Combat Phase — enterPhase('combat') resets alpha selection
// and alphaActedThisCombatPhase, same as an actual new turn would.
enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: wounded28 });

check('still wounded: DECLARE_ATTACK is not offered at all, even though a valid target exists',
  !getLegalActions('player').some(a => a.type === 'DECLARE_ATTACK'));
check('PASS_ALPHA is still available — the restriction only blocks initiating, not the alpha itself',
  getLegalActions('player').some(a => a.type === 'PASS_ALPHA'));

performAction('player', { type: 'PASS_ALPHA' });
performAction('player', { type: 'ADVANCE_PHASE' });
enterPhase('regen'); // heals the Organ Puncture wound — it's the only one

check('the wound is healed', wounded28.damageCards.length === 0);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: wounded28 });

check('healed: DECLARE_ATTACK is available again',
  getLegalActions('player').some(a => a.type === 'DECLARE_ATTACK'));

// ═══ TEST 29: Forced/restricted play — Overextended Attack ════
// Two flags off ONE card, with two DIFFERENT expiry windows on the
// SAME character: cannotWithdraw is immediate (this round only),
// cannotPlayCombatAction doesn't kick in until the round after.
console.log('\n[29] Forced/restricted play: Overextended Attack (self: no withdrawal this round, no Combat Action next round)');

const overextended = byName('Overextended Attack');
check('Overextended Attack found', !!overextended);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [overextended, fleshWound] }, // Allamande — attacker, debuffs itself
  { characters: [tracerPlayerChar], sept: [], combat: [glancingBlow] },              // Cernonous — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare29 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare29[0].attacker, declare29[0].target);

const self29 = GameState.combat.attacker; // Allamande

// Round 1: Overextended Attack
const oa29 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Overextended Attack').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: oa29 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('cannotWithdraw is active THIS round — WITHDRAW is not offered',
  !getCombatRoundActions('player').some(a => a.type === 'WITHDRAW'));
check('CONTINUE_COMBAT is still available', getCombatRoundActions('player').some(a => a.type === 'CONTINUE_COMBAT'));

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: cannotWithdraw has already expired (it was thisRoundOnly); cannotPlayCombatAction kicks in now
check('cannotPlayCombatAction is active this round: only PASS is offered',
  getCombatRoundActions('player').every(a => a.type === 'PASS_COMBAT_CARD'));

const gb29 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gb29 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("cannotWithdraw did NOT leak into round 2 — WITHDRAW is offered again",
  getCombatRoundActions('player').some(a => a.type === 'WITHDRAW'));

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 3: cannotPlayCombatAction has now expired too
check('cannotPlayCombatAction has expired — Flesh Wound offered again',
  getCombatRoundActions('player').some(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound'));

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 30: Forced/restricted play — Eyes Gouged ═════════════
// Random Play (rule 6.6.6c): the victim doesn't choose next round —
// a card is drawn at random from their own hand and played for them.
// Giving the victim exactly one eligible card keeps this fully
// deterministic despite the engine's Math.random() pick.
console.log('\n[30] Forced/restricted play: Eyes Gouged (victim is forced to play a random card next round)');

const eyesGouged = byName('Eyes Gouged');
check('Eyes Gouged found', !!eyesGouged);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [eyesGouged] },   // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound] },    // Cernonous — victim, exactly one card
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare30 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare30[0].attacker, declare30[0].target);

const blinder30 = GameState.combat.attacker; // Allamande
const blinded30  = GameState.combat.defender; // Cernonous

const eg30 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Eyes Gouged').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: eg30 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Eyes Gouged landed', blinded30.damageCards.includes(eg30));

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

check('forcedRandomPlay active: the victim is offered ONLY FORCED_RANDOM_PLAY, no normal choice',
  getCombatRoundActions('opponent').length === 1 &&
  getCombatRoundActions('opponent')[0].type === 'FORCED_RANDOM_PLAY');

performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'FORCED_RANDOM_PLAY' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("the forced random pick (Cernonous's only card, Flesh Wound) still resolved normally",
  blinder30.damageCards.some(c => c.name === 'Flesh Wound'));

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 31: Fast Striking — kills before a Normal-speed card can resolve ═══
// The marquee behavior of rule 6.10.1: Fast Strike's damage lands in
// its own pass, BEFORE Normal-speed cards. If that alone kills the
// defender, their own (Normal-speed) card is discarded unresolved —
// it never gets the chance to deal its damage back, even though both
// cards were "played" in the same round.
console.log('\n[31] Fast Striking: a lethal Fast Strike prevents the defender\'s own Normal-speed card from ever resolving');

const fastStrike = byName('Fast Strike');
const passer      = allCards.find(c => c.Name === 'Passer'); // Metis (single-form, no flip-to-Crinos escape), Health 2
check('Fast Strike and Passer found', !!fastStrike && !!passer);

initGame(
  { characters: [tracerOppChar], sept: [], combat: [fastStrike] },  // Allamande, Rage 6 — attacker
  { characters: [passer],        sept: [], combat: [fleshWound] },   // Passer, Rage 1 / Health 2 — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare31 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare31[0].attacker, declare31[0].target);

const striker31 = GameState.combat.attacker; // Allamande
const victim31   = GameState.combat.defender; // Passer

const fs31 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Fast Strike').card;
const fw31 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: fs31 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw31 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Fast Strike killed Passer outright (2 damage vs Health 2, no flip to escape it)',
  totalDamage(victim31) === 2 && isDead(victim31));
check("Passer's own Flesh Wound never resolved — the attacker took zero damage",
  striker31.damageCards.length === 0);
check('combat ended immediately from the death', GameState.combat === null);

// ═══ TEST 32: Fast Striking — a Normal-speed Dodge cannot stop it ═══
// Rule 6.10.2: dodges/blocks only stop attacks at an equal or slower
// speed than themselves. A plain Dodge (Normal speed) has already
// missed its chance by the time a Fast Strike lands.
console.log('\n[32] Fast Striking: a Normal-speed Dodge has no effect on a Fast Strike');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [fastStrike] }, // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [dodge] },       // Cernonous — defender, tries to dodge
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare32 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare32[0].attacker, declare32[0].target);

const target32 = GameState.combat.defender; // Cernonous

const fs32 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Fast Strike').card;
const dg32 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Dodge').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: fs32 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: dg32 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("the Normal-speed Dodge failed to stop the Fast Strike — it still landed",
  target32.damageCards.includes(fs32));
check('Cernonous survives (2 damage vs Health 7)', totalDamage(target32) === 2);

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 33: Feint — basic follow-up after seeing the opponent's card ═══
// Rule 6.8.1: after both cards are revealed, the Feint player gets a
// mini-step to play ONE additional Combat Action, having already seen
// what the opponent played. The non-deciding side has nothing to do
// but wait.
console.log('\n[33] Feint: play a follow-up Combat Action after seeing the opponent\'s revealed card');

const feint = byName('Feint');
check('Feint found', !!feint);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [feint, grazingWound] }, // Allamande, Rage 6 — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound] },           // Cernonous — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare33 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare33[0].attacker, declare33[0].target);

const feinter33 = GameState.combat.attacker; // Allamande
const foe33      = GameState.combat.defender; // Cernonous

const ft33 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Feint').card;
const fw33 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: ft33 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw33 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('the round pauses on reveal-feint for the Feint player specifically',
  GameState.combat.step === 'reveal-feint' && GameState.combat.feintDeciderWho === 'player');
check('the non-deciding side has nothing to do but wait',
  getCombatRoundActions('opponent').length === 1 && getCombatRoundActions('opponent')[0].type === 'WAITING');

const gw33 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_FEINT_FOLLOWUP' && a.card.name === 'Grazing Wound').card;
performCombatAction('player', { type: 'PLAY_FEINT_FOLLOWUP', card: gw33 });

check("Feint itself dealt no damage (it has no Damage value)",
  !foe33.damageCards.some(c => c.name === 'Feint'));
check("the follow-up (Grazing Wound) landed on the same target as the Feint",
  foe33.damageCards.some(c => c.name === 'Grazing Wound'));
check("the opponent's own Flesh Wound still landed normally", feinter33.damageCards.some(c => c.name === 'Flesh Wound'));

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 34: Feint — an illegal (bluffed) Feint never gets a follow-up ═══
// Errata: "Feint may not be bluffed." Unlike the general Bluff step,
// which can let a failed card still count as "played", Feint's own
// follow-up opportunity is refused outright if the Rage requirement
// isn't met — checked directly in canFeint(), ahead of the later Bluff
// step in resolveBluffAndDamage().
console.log('\n[34] Feint: an under-Rage (bluffed) Feint never triggers the follow-up mini-step');

initGame(
  { characters: [shakar],        sept: [], combat: [feint] }, // Shakar, breed Rage 1 — cannot legally play Feint (Rage 4)
  { characters: [tracerOppChar], sept: [], combat: [] },       // Allamande — 0 cards, auto-pass
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare34 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare34[0].attacker, declare34[0].target);

const bluffer34 = GameState.combat.attacker; // Shakar

const ft34 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Feint').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: ft34 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('no reveal-feint mini-step occurred — straight through to withdrawal',
  GameState.combat.step === 'withdrawal');
check('the bluffed Feint dealt no damage either way', bluffer34.damageCards.length === 0);

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 35: Feint — a follow-up still respects Fast Striking ═══
// The follow-up isn't a special case with its own resolution logic —
// it flows through the exact same speed-tier/death-gating machinery
// as any other card. Following up Feint with Fast Strike should still
// resolve in the Fast pass, ahead of (and potentially pre-empting) the
// opponent's Normal-speed card, even though both of the feinter's own
// cards were played in the same round.
console.log('\n[35] Feint: a Fast Strike follow-up still resolves in the Fast pass, pre-empting the opponent\'s Normal card');

initGame(
  { characters: [tracerOppChar], sept: [], combat: [feint, fastStrike] }, // Allamande — attacker
  { characters: [passer],        sept: [], combat: [fleshWound] },        // Passer, Rage 1 / Health 2 — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare35 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare35[0].attacker, declare35[0].target);

const feinter35 = GameState.combat.attacker; // Allamande
const victim35   = GameState.combat.defender; // Passer

const ft35 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Feint').card;
const fw35 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: ft35 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw35 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

const fs35 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_FEINT_FOLLOWUP' && a.card.name === 'Fast Strike').card;
performCombatAction('player', { type: 'PLAY_FEINT_FOLLOWUP', card: fs35 });

check('the Fast Strike follow-up killed Passer outright (2 damage vs Health 2)',
  totalDamage(victim35) === 2 && isDead(victim35));
check("Passer's own Flesh Wound never resolved, pre-empted by the faster follow-up",
  feinter35.damageCards.length === 0);
check('combat ended immediately from the death', GameState.combat === null);

// ═══ TEST 36: Run Like Hell — forces combat to end after this round ═══
// The opponent's card must still resolve first ("this effect takes
// place after your opponent's Combat Action is resolved") — Run Like
// Hell has no Damage value of its own, so this can't be checked via
// onDamageDealt at all; it's the endsCombatAfterRound marker, checked
// once the whole round has finished resolving.
console.log('\n[36] Run Like Hell: the opponent\'s damage still lands, then combat ends immediately — no withdrawal step reached');

const runLikeHell = byName('Run Like Hell');
check('Run Like Hell found', !!runLikeHell);

initGame(
  { characters: [tracerPlayerChar], sept: [], combat: [runLikeHell] },  // Cernonous — flees
  { characters: [tracerOppChar],    sept: [], combat: [grazingWound] },  // Allamande
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare36 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare36[0].attacker, declare36[0].target);

const fleeing36 = GameState.combat.attacker; // Cernonous

const rlh36 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Run Like Hell').card;
const gw36 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Grazing Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: rlh36 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gw36 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("the opponent's Grazing Wound still landed before the flee took effect",
  fleeing36.damageCards.some(c => c.name === 'Grazing Wound'));
check('combat ended immediately — the withdrawal step was never reached', GameState.combat === null);

// ═══ TEST 37: Forceful Wind — ends combat after both sides have dealt damage ═══
console.log('\n[37] Forceful Wind: both sides\' damage lands, then combat ends immediately');

const forcefulWind = byName('Forceful Wind');
check('Forceful Wind found', !!forcefulWind);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [forcefulWind] }, // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound] },    // Cernonous — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare37 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare37[0].attacker, declare37[0].target);

const windCaster37 = GameState.combat.attacker; // Allamande
const foe37          = GameState.combat.defender; // Cernonous

const fwind37 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Forceful Wind').card;
const fw37 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: fwind37 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw37 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("Forceful Wind's own damage landed", foe37.damageCards.some(c => c.name === 'Forceful Wind'));
check("the opponent's Flesh Wound also landed before combat ended",
  windCaster37.damageCards.some(c => c.name === 'Flesh Wound'));
check('combat ended immediately — the withdrawal step was never reached', GameState.combat === null);

// ═══ TEST 38: Spine Crushed — legal once forced into Crinos form ═══
// The first card needing a non-Rage play condition at all (rule
// 6.9.1). Anna Kliminski has enough Rage in EITHER form (CRage 9), so
// this specifically isolates "is Crinos required" rather than "is
// Rage enough" — she must actually flip before Spine Crushed becomes
// playable, not just meet its Rage 9 cost.
console.log('\n[38] Spine Crushed: illegal in breed form, legal once forced into Crinos');

const spineCrushed = byName('Spine Crushed');
const anna = allCards.find(c => c.Name === 'Anna Kliminski'); // dual-form, breed Rage 3 / CRage 9
const bodyBlow = byName('Body Blow'); // pure vanilla, Rage 3 / Damage 3 — no side effects to interfere with the Rage 9 check below
check('Spine Crushed, Anna Kliminski and Body Blow found', !!spineCrushed && !!anna && !!bodyBlow);

initGame(
  { characters: [tracerOppChar], sept: [], combat: [bodyBlow] }, // Allamande — attacker
  { characters: [anna],          sept: [], combat: [spineCrushed] },   // Anna — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare38 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare38[0].attacker, declare38[0].target);

const striker38 = GameState.combat.attacker; // Allamande
const anna38     = GameState.combat.defender; // Anna Kliminski

check('Anna starts in breed form', anna38.isCrinos === false);

// Round 1: Body Blow forces the Crinos flip (3 damage >= breed Rage 3), with no side effects of its own that would touch Anna's Rage
const bb38 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Body Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: bb38 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Anna flipped to Crinos', anna38.isCrinos === true);
check('effective Rage is now exactly CRage 9, undisturbed by the flip trigger', effectiveRage(anna38) === 9);

performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: now Crinos, with CRage 9 meeting Spine Crushed's Rage 9 — legal
const sc38 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Spine Crushed').card;
performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: sc38 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Spine Crushed landed for its full 7 damage now that Anna is in Crinos form',
  striker38.damageCards.includes(sc38) && totalDamage(striker38) === 7);
check('Allamande (Health 5) died to it', isDead(striker38));

// ═══ TEST 39: Spine Crushed — still illegal in breed form even with enough Rage ═══
// Isolates the Crinos check from the Rage check directly: artificially
// grants breed-form Anna Rage 9 (via the same tempStatMod machinery
// Nerve Cluster/Vital Blow use) so the ONLY remaining reason Spine
// Crushed could fail is the form requirement itself — no character in
// the Unlimited set has breed Rage 9 naturally, so this is the only
// way to test the two conditions apart from each other.
console.log('\n[39] Spine Crushed: still illegal in breed form even when Rage 9 is artificially met');

initGame(
  { characters: [anna],          sept: [], combat: [spineCrushed] }, // Anna — breed form throughout
  { characters: [tracerOppChar], sept: [], combat: [] },
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare39 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare39[0].attacker, declare39[0].target);

const anna39 = GameState.combat.attacker; // Anna, still in breed form
check('Anna is in breed form for this test', anna39.isCrinos === false);

applyTempStatMod(anna39, { stat: 'rage', mode: 'set', amount: 9, expiry: 'endOfCombat' });
check('Rage 9 requirement is artificially satisfied', effectiveRage(anna39) === 9);

const sc39 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Spine Crushed').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: sc39 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("Spine Crushed was still discarded illegal — Rage alone isn't enough without Crinos form",
  GameState.opponent.pack[0].damageCards.length === 0);

// ═══ TEST 40: Surprise Attack — basic cancellation in round 1 ═══
console.log('\n[40] Surprise Attack: connecting in round 1 cancels the opponent\'s own damage back');

const surpriseAttack = byName('Surprise Attack');
check('Surprise Attack found', !!surpriseAttack);

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [surpriseAttack] }, // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound] },      // Cernonous — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare40 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare40[0].attacker, declare40[0].target);

const striker40 = GameState.combat.attacker; // Allamande
const foe40       = GameState.combat.defender; // Cernonous

const sa40 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Surprise Attack').card;
const fw40 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: sa40 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw40 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Surprise Attack connected', foe40.damageCards.includes(sa40));
check("the opponent's Flesh Wound was retroactively cancelled — zero damage back",
  striker40.damageCards.length === 0);

// ═══ TEST 41: Surprise Attack — mutual cancellation ═══
// Errata: "If 2 Surprise Attacks resolve against each other, neither
// creature will do damage." Each side's own connection is checked
// against the round's ORIGINAL resolution, so the two cancellations
// don't chain or depend on which is processed first.
console.log('\n[41] Surprise Attack: two Surprise Attacks played against each other cancel both');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [surpriseAttack] }, // Allamande
  { characters: [tracerPlayerChar], sept: [], combat: [surpriseAttack] }, // Cernonous
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare41 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare41[0].attacker, declare41[0].target);

const sideA41 = GameState.combat.attacker; // Allamande
const sideB41 = GameState.combat.defender; // Cernonous

const saA41 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Surprise Attack').card;
const saB41 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Surprise Attack').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: saA41 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: saB41 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('neither side ended up with any damage — both cancelled each other',
  sideA41.damageCards.length === 0 && sideB41.damageCards.length === 0);

// ═══ TEST 42: Surprise Attack — cannot cancel a Fast Striking attack ═══
console.log('\n[42] Surprise Attack: cannot cancel damage from a Fast Striking opponent');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [surpriseAttack] }, // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [fastStrike] },      // Cernonous — defender, Rage 5
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare42 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare42[0].attacker, declare42[0].target);

const striker42 = GameState.combat.attacker; // Allamande
const foe42       = GameState.combat.defender; // Cernonous

const sa42 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Surprise Attack').card;
const fs42 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Fast Strike').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: sa42 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fs42 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Surprise Attack still connected on its own', foe42.damageCards.includes(sa42));
check("but Fast Strike's damage was NOT cancelled — it already resolved in an earlier tier",
  striker42.damageCards.includes(fs42));

// ═══ TEST 43: Surprise Attack — no effect outside round 1 ═══
console.log('\n[43] Surprise Attack: has no cancellation effect in round 2 or later');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [glancingBlow, surpriseAttack] }, // Allamande
  { characters: [tracerPlayerChar], sept: [], combat: [fleshWound, grazingWound] },      // Cernonous
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare43 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare43[0].attacker, declare43[0].target);

const striker43 = GameState.combat.attacker; // Allamande
const foe43       = GameState.combat.defender; // Cernonous

// Round 1: plain cards, nothing Surprise-Attack related yet
const gb43 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
const fw43 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Flesh Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb43 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: fw43 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });
performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: Surprise Attack connects, but it's not round 1 anymore
const sa43 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Surprise Attack').card;
const gw43 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Grazing Wound').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: sa43 });
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: gw43 });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Surprise Attack connected in round 2', foe43.damageCards.includes(sa43));
check("the opponent's Grazing Wound was NOT cancelled — Surprise Attack only cancels in round 1",
  striker43.damageCards.includes(gw43));

// ═══ TEST 44: Telling Blow — the killing blow earns +3 VP ═══
console.log('\n[44] Telling Blow: +3 VP when it\'s specifically the card that kills, on top of the victim\'s own Renown');

const tellingBlow = byName('Telling Blow');
const passer44 = allCards.find(c => c.Name === 'Passer'); // Rage 1 / Health 2, Renown 1
check('Telling Blow and Passer found', !!tellingBlow && !!passer44);

initGame(
  { characters: [tracerOppChar], sept: [], combat: [glancingBlow, tellingBlow] }, // Allamande — attacker
  { characters: [passer44],      sept: [], combat: [] },                          // Passer — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare44 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare44[0].attacker, declare44[0].target);

const passerInst44 = GameState.combat.defender; // instance, not the raw card def

// Round 1: Glancing Blow softens Passer up (1 damage, still alive at Health 2)
const gb44 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb44 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });
performCombatAction('player', { type: 'CONTINUE_COMBAT' });

// Round 2: Telling Blow lands the killing blow (total 2 >= Health 2)
const tb44 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Telling Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: tb44 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('combat ended — Passer died to Telling Blow', GameState.combat === null);
check("Telling Blow was redirected to the killer's Victory Pile instead of the normal combat discard",
  GameState.player.victoryPile.includes(tb44) && !GameState.player.combatDiscard.includes(tb44));
check("Passer (the victim) is also in the Victory Pile as normal", GameState.player.victoryPile.includes(passerInst44));
check('total VP is Passer\'s own Renown (1) plus the +3 bonus = 4', countVP(GameState.player) === 4);

// ═══ TEST 45: Telling Blow — no bonus when the victim survives ═══
console.log('\n[45] Telling Blow: no bonus when it deals damage but doesn\'t kill');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [tellingBlow] }, // Allamande — attacker
  { characters: [tracerPlayerChar], sept: [], combat: [] },             // Cernonous, Health 7 — survives easily
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare45 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare45[0].attacker, declare45[0].target);

const foe45 = GameState.combat.defender; // Cernonous

const tb45 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Telling Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: tb45 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('Telling Blow landed normally (1 damage vs Health 7)', foe45.damageCards.includes(tb45));
check('Cernonous survived', !isDead(foe45));

performCombatAction('player', { type: 'WITHDRAW' });

check('Telling Blow went to the normal combat discard pile, not the Victory Pile — no kill, no bonus',
  GameState.player.combatDiscard.includes(tb45) && !GameState.player.victoryPile.includes(tb45));
check('no VP was awarded', countVP(GameState.player) === 0);

// ═══ TEST 46: Pack Combat Phase 1 — plays[] loop reads every participant ═══
console.log('\n[46] Pack Combat Phase 1: resolution loop reads attackerParticipants[], not just the alpha');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [glancingBlow] }, // Allamande — attacker alpha
  { characters: [tracerPlayerChar], sept: [], combat: [] },             // Cernonous, Health 7 — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare46 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare46[0].attacker, declare46[0].target);

const cernonous46 = GameState.combat.defender;

// Directly construct a second attacker participant — NOT through a
// pack-join card (that's Phase 4). This is exactly what the handover
// asked Phase 1 to prove: the plays[] builder reads every entry in
// attackerParticipants[], not just the alpha.
const packMemberInst46 = makeCardInstance(fillerChar, 'player');
const packMemberCard46 = makeCardInstance(glancingBlow, 'player');
GameState.combat.attackerParticipants.push({
  inst: packMemberInst46, ownerWho: 'player', role: 'packmember',
  card: packMemberCard46, feintCard: null, feintDecided: false,
  targetInst: cernonous46,
});
check('alpha getter still resolves correctly with 2 entries in the array',
  GameState.combat.attacker.name === 'Allamande' && GameState.combat.attackerParticipants.length === 2);

const gb46 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb46 });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("both the alpha's card and the synthetic packmember's card dealt damage to the same target",
  cernonous46.damageCards.includes(gb46) && cernonous46.damageCards.includes(packMemberCard46));
check("total damage is 2 (1 from each participant's Glancing Blow), not just the alpha's 1",
  totalDamage(cernonous46) === 2);
check('defender survived (Health 7 vs 2 damage) — combat did not end early', !isDead(cernonous46));

performCombatAction('player', { type: 'WITHDRAW' });
check('combat ended cleanly via withdrawal — the participant model did not break normal single-vs-single flow',
  GameState.combat === null);

// ═══ TEST 47: Targeting (rule 6.7) — pack's own cards auto-target the
// lone defender, but the lone defender must REALLY choose which pack
// member its own card hits ═══
console.log('\n[47] Targeting: pack attacks single defender — pack auto-targets, defender makes a real choice');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [glancingBlow] }, // Allamande — attacker alpha
  { characters: [tracerPlayerChar], sept: [], combat: [glancingBlow] }, // Cernonous, Health 7 — defender
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare47 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare47[0].attacker, declare47[0].target);

const cernonous47 = GameState.combat.defender;
const allamande47 = GameState.combat.attacker;

// Synthetic second attacker participant — direct construction, not
// through a card (Phase 4 territory).
const packMemberInst47 = makeCardInstance(fillerChar, 'player');
const packMemberCard47 = makeCardInstance(glancingBlow, 'player');
GameState.combat.attackerParticipants.push({
  inst: packMemberInst47, ownerWho: 'player', role: 'packmember',
  card: packMemberCard47, feintCard: null, feintDecided: false, targetInst: null,
});

const gb47 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb47 });
const dgb47 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: dgb47 });

check('targeting paused for the defender — attacker\'s pack auto-targeted (only 1 enemy to pick from)',
  GameState.combat.step === 'targeting'
  && GameState.combat.targetingQueue.attackerQueue.length === 0
  && GameState.combat.targetingQueue.defenderQueue.length === 1);
const alphaP47 = GameState.combat.attackerParticipants.find(p => p.role === 'alpha');
const packP47  = GameState.combat.attackerParticipants.find(p => p.role === 'packmember');
check('alpha auto-targeted the lone defender', alphaP47.targetInst === cernonous47);
check('packmember auto-targeted the lone defender', packP47.targetInst === cernonous47);

// Defender gets a REAL choice among 2 attacker participants — deliberately
// pick the non-alpha packmember, to prove it isn't defaulting to the alpha.
const targetOptions47 = getCombatRoundActions('opponent');
check('defender is offered exactly 2 real targeting options (one per attacker participant)',
  targetOptions47.length === 2 && targetOptions47.every(a => a.type === 'ASSIGN_TARGET'));
const chosen47 = targetOptions47.find(a => a.target === packMemberInst47);
performCombatAction('opponent', { type: 'ASSIGN_TARGET', target: chosen47.target });

check('targeting queue closed and combat auto-advanced to reveal', GameState.combat.step === 'reveal');

performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('both attacker cards landed on Cernonous (2 damage)', totalDamage(cernonous47) === 2);
check("defender's card was correctly routed to the CHOSEN packmember, not the alpha",
  packMemberInst47.damageCards.includes(dgb47) && !allamande47.damageCards.includes(dgb47));

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 48: Targeting (rule 6.7) — pack vs pack, alternating queue ═══
console.log('\n[48] Targeting: pack vs pack — alternating assignment, attacker first');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [glancingBlow] }, // Allamande — attacker alpha
  { characters: [tracerPlayerChar], sept: [], combat: [glancingBlow] }, // Cernonous — defender alpha
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare48 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare48[0].attacker, declare48[0].target);

const allianceAlpha48 = GameState.combat.attacker;   // Allamande
const alphaD48         = GameState.combat.defender;   // Cernonous

const packA48Inst = makeCardInstance(fillerChar, 'player');    // Carla Grimsson, Rage 3 / Health 3
const packA48Card = makeCardInstance(glancingBlow, 'player');
GameState.combat.attackerParticipants.push({
  inst: packA48Inst, ownerWho: 'player', role: 'packmember',
  card: packA48Card, feintCard: null, feintDecided: false, targetInst: null,
});

const packD48Inst = makeCardInstance(timRowantree, 'opponent'); // Rage 1 / Health 3
const packD48Card = makeCardInstance(glancingBlow, 'opponent');
GameState.combat.defenderParticipants.push({
  inst: packD48Inst, ownerWho: 'opponent', role: 'packmember',
  card: packD48Card, feintCard: null, feintDecided: false, targetInst: null,
});

const gb48 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb48 });
const dgb48 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: dgb48 });

check('both sides are real pack combats — 2 pending decisions per side, attacker goes first',
  GameState.combat.step === 'targeting'
  && GameState.combat.targetingQueue.attackerQueue.length === 2
  && GameState.combat.targetingQueue.defenderQueue.length === 2
  && GameState.combat.targetingQueue.turn === 'player');

// Decision 1 (attacker, alpha): alliance alpha -> targets packD48 (cross pattern)
performCombatAction('player', { type: 'ASSIGN_TARGET', target: packD48Inst });
check('turn passed to defender after attacker\'s decision', GameState.combat.targetingQueue.turn === 'opponent');

// Decision 2 (defender, alpha): alphaD -> targets packA48 (cross pattern)
performCombatAction('opponent', { type: 'ASSIGN_TARGET', target: packA48Inst });
check('turn passed back to attacker', GameState.combat.targetingQueue.turn === 'player');

// Decision 3 (attacker, packmember): packA48 -> targets alphaD
performCombatAction('player', { type: 'ASSIGN_TARGET', target: alphaD48 });
check('turn passed to defender for its remaining decision', GameState.combat.targetingQueue.turn === 'opponent');

// Decision 4 (defender, packmember): packD48 -> targets allianceAlpha
performCombatAction('opponent', { type: 'ASSIGN_TARGET', target: allianceAlpha48 });

check('all 4 decisions made, queue closed, combat advanced to reveal', GameState.combat.step === 'reveal');

performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('alliance alpha\'s card landed on the chosen target (packD48), not the obvious alphaD',
  packD48Inst.damageCards.includes(gb48) && !alphaD48.damageCards.includes(gb48));
check("alphaD's card landed on the chosen target (packA48), not the obvious alliance alpha",
  packA48Inst.damageCards.includes(dgb48) && !allianceAlpha48.damageCards.includes(dgb48));
check("packA48's card landed on the chosen target (alphaD)",
  alphaD48.damageCards.includes(packA48Card));
check("packD48's card landed on the chosen target (alliance alpha)",
  allianceAlpha48.damageCards.includes(packD48Card));

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 49: Death/removal (rule 6.3/6.4.2) — a packmate dying does
// NOT end combat while the alpha survives; VP goes to the right player
// for that specific creature ═══
console.log('\n[49] Death: packmate dies, alpha survives — combat continues, VP attributed correctly');

initGame(
  { characters: [tracerOppChar],    sept: [], combat: [glancingBlow] },            // Allamande — attacker alpha
  { characters: [tracerPlayerChar], sept: [], combat: [headWound] },               // Cernonous — defender alpha
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare49 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare49[0].attacker, declare49[0].target);

const allamande49 = GameState.combat.attacker;
const cernonous49 = GameState.combat.defender;

// Synthetic doomed packmate: Passer is Metis (single-form — no Crinos
// to flip to and escape death), Health 2. Head Wound (Damage 2) kills
// it outright with no flip-form loophole to worry about.
const passerInst49 = makeCardInstance(passer, 'player');
GameState.player.pack.push(passerInst49);
const passerCard49 = makeCardInstance(glancingBlow, 'player');
GameState.combat.attackerParticipants.push({
  inst: passerInst49, ownerWho: 'player', role: 'packmember',
  card: passerCard49, feintCard: null, feintDecided: false, targetInst: null,
});

const gb49 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb49 });
const hw49 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Head Wound').card;
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: hw49 });

// Defender's real choice — deliberately target the doomed packmate.
const chosen49 = getCombatRoundActions('opponent').find(a => a.target === passerInst49);
performCombatAction('opponent', { type: 'ASSIGN_TARGET', target: chosen49.target });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check("Passer removed from its owner's pack (moveToVictoryPile ran)",
  !GameState.player.pack.some(c => c.instanceId === passerInst49.instanceId));
check("Passer landed in the KILLER's (opponent's) Victory Pile, not its own owner's",
  GameState.opponent.victoryPile.some(c => c.instanceId === passerInst49.instanceId));
check('combat did NOT end — Allamande is still fighting', GameState.combat !== null);
check('the dead packmate was removed from attackerParticipants, the alpha remains',
  GameState.combat.attackerParticipants.length === 1
  && GameState.combat.attackerParticipants[0].inst === allamande49);
check('both attacker cards still landed on Cernonous (2 damage) despite the packmate dying',
  totalDamage(cernonous49) === 2);
check('combat proceeded normally to withdrawal, not cut short', GameState.combat.step === 'withdrawal');

performCombatAction('player', { type: 'WITHDRAW' });

// ═══ TEST 50: Death/removal — the ALPHA dies but a packmate survives.
// Combat continues; the legacy c.attacker getter must fall back to the
// survivor instead of crashing (no role:'alpha' left in the array) ═══
console.log('\n[50] Death: the ALPHA dies, packmate survives — combat continues, getter falls back safely');

initGame(
  { characters: [passer],           sept: [], combat: [glancingBlow] }, // Passer — attacker ALPHA, Rage 1/Health 2, single-form (no flip escape)
  { characters: [tracerPlayerChar], sept: [], combat: [headWound] },    // Cernonous — defender alpha
  20
);

enterPhase('combat');
performAction('player', { type: 'SELECT_ALPHA', card: GameState.player.pack[0] });
const declare50 = getLegalActions('player').filter(a => a.type === 'DECLARE_ATTACK');
declareAttack('player', declare50[0].attacker, declare50[0].target);

const passerAlpha50 = GameState.combat.attacker; // Passer, the alpha this time
const cernonous50    = GameState.combat.defender;

const packInst50 = makeCardInstance(fillerChar, 'player'); // Carla Grimsson, Rage 3/Health 3 — survives
GameState.player.pack.push(packInst50);
const packCard50 = makeCardInstance(glancingBlow, 'player');
GameState.combat.attackerParticipants.push({
  inst: packInst50, ownerWho: 'player', role: 'packmember',
  card: packCard50, feintCard: null, feintDecided: false, targetInst: null,
});

const gb50 = getCombatRoundActions('player')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Glancing Blow').card;
performCombatAction('player', { type: 'PLAY_COMBAT_CARD', card: gb50 });
const hw50 = getCombatRoundActions('opponent')
  .find(a => a.type === 'PLAY_COMBAT_CARD' && a.card.name === 'Head Wound').card;
performCombatAction('opponent', { type: 'PLAY_COMBAT_CARD', card: hw50 });

// Defender deliberately targets the ALPHA specifically.
const chosen50 = getCombatRoundActions('opponent').find(a => a.target === passerAlpha50);
performCombatAction('opponent', { type: 'ASSIGN_TARGET', target: chosen50.target });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });

check('the alpha died and was removed; combat did NOT end (packmate survives)',
  GameState.combat !== null
  && GameState.combat.attackerParticipants.length === 1
  && GameState.combat.attackerParticipants[0].inst === packInst50);
check("c.attacker getter falls back to the surviving packmate — no crash despite no role:'alpha' left",
  GameState.combat.attacker === packInst50);
check('Cernonous still took 2 damage this round (both attacker cards had already been resolved)',
  totalDamage(cernonous50) === 2);

// Prove the side keeps functioning next round with no alpha in the array.
performCombatAction('player', { type: 'CONTINUE_COMBAT' });
check('a new round started cleanly with the survivor standing in as the alpha',
  GameState.combat.round === 2 && GameState.combat.step === 'playCard');

performCombatAction('player', { type: 'PASS_COMBAT_CARD' });
performCombatAction('opponent', { type: 'PASS_COMBAT_CARD' });
performCombatAction('player', { type: 'CONTINUE_REVEAL' });
check('combat closed out normally afterward (no cards played) — no lingering corruption from the alpha\'s death',
  GameState.combat === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
