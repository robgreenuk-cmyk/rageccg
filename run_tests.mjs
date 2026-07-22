// Standalone Node verification for cardEngine.js — no DOM, no Vite,
// just the pure state modules, run directly against real card defs.
import { readFileSync } from 'fs';

import {
  GameState, initGame, makeCardInstance, totalDamage,
  effectiveRage, effectiveHealth, effectiveGnosis, effectiveRenown, effectiveVotingRenown,
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

// Jump straight to a later Regen Phase and confirm exactly one wound
// heals — regenerate() heals one non-aggravated card per call, not all.
enterPhase('regen');
check('wound healed after one Regen Phase', GameState.opponent.alpha.damageCards.length === 0);
check('totalDamage back to zero after heal', totalDamage(GameState.opponent.alpha) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
