/**
 * Ways to start: the boat as the crew would have left her for each condition, every control at
 * the value their hands would have put it (the same values the procedures reach; nothing is set
 * that the controls do not set, except where the boat is in the sea and how full her tanks are).
 */
import { LONG_TON, FT } from '../data/boat.js';
import { GROUPS } from '../data/controls.js';

const ENGINES = [1, 2, 3, 4];

/** Common to every condition at sea: the auxiliaries running, air banks cut in, the doors open. */
function atSea(P) {
  P.setAll({ 'pr.imo1': 1, 'hp.startAir': 1, 'man.batFans.fwd': 1, 'man.batFans.aft': 1, 'man.batSel': 'both' });
  for (let i = 0; i < 7; i++) P.set(`door.${i}`, 1);
  for (let b = 1; b <= 5; b++) P.set(`hp.bank${b}`, 1);
}

/** Motors on the battery: the bus selector to BAT BUS, both sides ahead, the starters in PAR 2. */
function onBattery(P, field = 1) {
  P.setAll({
    'man.busSel': 'batBus', 'man.reverse.port': 'ahead', 'man.reverse.stbd': 'ahead',
    'man.starter.port': 'par2', 'man.starter.stbd': 'par2', 'man.motorField.port': field, 'man.motorField.stbd': field,
  });
  for (const n of ENGINES) P.set(`man.gen.${n}`, 'off');
}

/** Surfaced, rigged for diving, running on the battery: the dive is the next thing (the default start). */
export function surfacedRiggedForDive(P, { keelDepth = 4.65, heading = 0 } = {}) {
  atSea(P);
  onBattery(P, 1);
  P.boat.setBallast({ safety: 1, negative: 0 });
  P.boat.place({ keelDepth, heading });
  P.boat.initTanks(P.sea);
  P.compensate();
  // the hatch open to the bridge, the induction shut (on the battery the engines are secured)
  P.setAll({ 'hatch.ctUpper': 1, 'hatch.ctLower': 1, 'hatch.galley': 1, 'ct.telegraph.port': 'standard', 'ct.telegraph.stbd': 'standard', 'man.answer.port': 'standard', 'man.answer.stbd': 'standard' });
  // negative flooded (rigged for dive)
  P.set('hm.flood.negative', 'open');
  P.boat.tank.negative.set(1, P.boat.tank.negative.pAir);
  P.ram['hm.flood.negative'] = 1;
  P.set('hm.flood.negative', 'shut');
  return P;
}

/** Surfaced on the diesels: two engines on propulsion, the induction open, the bridge manned. */
export function surfacedOnDiesels(P, { keelDepth = 4.65, heading = 0 } = {}) {
  atSea(P);
  P.boat.setBallast({ safety: 1, negative: 0 });
  P.boat.place({ keelDepth, heading });
  P.boat.initTanks(P.sea);
  P.compensate();
  P.setAll({ 'hatch.ctUpper': 1, 'hatch.ctLower': 1, 'hatch.galley': 1, 'hm.induction': 'open', 'fer.induction': 1, 'aer.induction': 1, 'fer.hullSupply': 1, 'hm.hullVent': 'open', 'fer.ventBlowers': 1 });
  P.ram['hm.induction'] = 1; P.ram['hm.hullVent'] = 1;
  for (const n of [1, 2]) {
    P.setAll({ [`eng${n}.seaSuction`]: 1, [`eng${n}.exhaustIn`]: 1, [`eng${n}.exhaustOut`]: 1, [`eng${n}.lever`]: 'run', [`man.gen.${n}`]: 'motorBus', [`man.genField.${n}`]: 0.8, [`man.engSpeed.${n}`]: 0.85 });
    const e = P.engines[n - 1];
    e.omega = 600 * Math.PI / 30; e.state = 'running'; e.primed = 1; e.tJacket = 150; e.tLube = 150; e.pLube = 30;
  }
  P.setAll({ 'man.busSel': 'tieOpen', 'man.reverse.port': 'ahead', 'man.reverse.stbd': 'ahead', 'man.starter.port': 'par2', 'man.starter.stbd': 'par2', 'ct.telegraph.port': 'standard', 'ct.telegraph.stbd': 'standard', 'man.answer.port': 'standard', 'man.answer.stbd': 'standard' });
  return P;
}

/** Submerged at a keel depth, trimmed, on the battery, rigged for red if night. */
export function submerged(P, { keelDepth = 60 * FT, heading = 0, speed = 3.0 } = {}) {
  atSea(P);
  onBattery(P, 1);
  P.boat.setBallast({ mbt: 'flooded', safety: 1, negative: 0 });
  P.boat.place({ keelDepth, heading });
  P.boat.initTanks(P.sea);
  P.compensate(keelDepth);
  P.dyn.v[0] = speed;
  P.setAll({ 'cr.bowPlanesRig': 'out', 'hatch.ctLower': 1, 'hatch.galley': 1, 'ct.telegraph.port': 'ahead1', 'ct.telegraph.stbd': 'ahead1', 'man.answer.port': 'ahead1', 'man.answer.stbd': 'ahead1', 'man.starter.port': 'ser3', 'man.starter.stbd': 'ser3' });
  P.rig = 1;
  return P;
}

/** The crew aboard as weights (until the crew model places them). */
export function crewWeight(P) {
  if (!P.people.length) P.people = [{ kg: 7.8 * LONG_TON, x: 5 * FT, y: 14 * FT, work: 0.2 }];
}

export const CONDITIONS = { dive: surfacedRiggedForDive, diesels: surfacedOnDiesels, submerged };
export { GROUPS };
