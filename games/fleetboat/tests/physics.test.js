// The physics against the books: the sea (UNESCO, Mackenzie), the gas laws, the hull's
// hydrostatics (General Information Book), the speeds (Fleet Type Submarine 1D4), the dive.
// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rhoEOS80, soundSpeed, WaterColumn } from '../src/physics/seawater.js';
import { molesReal, zAir } from '../src/physics/gas.js';
import { Plant } from '../src/physics/plant.js';
import { Sea } from '../src/world/sea.js';
import { Tank } from '../src/physics/tanks.js';
import { TANKS, FT, LONG_TON, ATMOSPHERE } from '../src/data/boat.js';
import { ATM, G, R_GAS } from '../src/physics/units.js';
import { Atmosphere } from '../src/physics/atmosphere.js';
import { Battery } from '../src/physics/electric.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('sea water: UNESCO 1981 density, Mackenzie sound speed', () => {
  // the UNESCO check values: S 35, 25 C, 0 bar: 1023.343 kg/m^3; S 35, 5 C, 1000 bar (1 bar = 1e5 Pa): 1069.488
  near(rhoEOS80(35, 25, 0), 1023.343, 0.01, 'density at 35, 25 C');
  near(rhoEOS80(35, 5, 1000), 1069.488, 0.05, 'density at 35, 5 C, 1000 bar');
  // Mackenzie (1981) check value: 1550.744 m/s at 25 C, 35, 1000 m
  near(soundSpeed(25, 35, 1000), 1550.744, 0.05, 'sound speed');
  const col = new WaterColumn({ tSurf: 15, tDeep: 15, tAbyss: 15, sSurf: 35, sDeep: 35, mixed: 50, layer: 50, deepScale: 400, bottom: 4000, lat: 21 });
  // P = rho g h: 100 m of sea water is about 10.06 bar over the atmosphere
  near((col.pressureAt(100) - ATM) / 1e5, 10.06, 0.06, 'pressure at 100 m');
});

test('Boyle in a main ballast tank: going deeper the sea squeezes the air and floods the tank', () => {
  const def = TANKS.find((t) => t.id === 'mbt4a');
  const tk = new Tank(def);
  const col = new WaterColumn({ tSurf: 15, tDeep: 15, tAbyss: 15, sSurf: 35, sDeep: 35, mixed: 50, layer: 50, deepScale: 400, bottom: 4000, lat: 21 });
  // dry at the surface (air at the flood ports' pressure, 15 ft down), vents shut
  const p0 = col.pressureAt(15 * FT);
  tk.set(0, p0);
  const n = tk.n;
  // at 100 ft the ports see more pressure; the bubble shrinks as p V = n R T and the water rises
  const p1 = col.pressureAt(100 * FT);
  for (let i = 0; i < 20; i++) tk.step(0.1, { pPort: p1, rho: 1026, T: 288.15, ventOutlet: p1, pBoat: ATM });
  const Va = tk.airVolume;
  const pa = n * R_GAS * 288.15 / Va;
  near(tk.n, n, 1e-6, 'no air lost');
  // the air's pressure plus the water inside balances the sea at the ports
  near(pa + 1026 * G * tk.level, p1, 500, 'pressure balance at the ports');
  assert.ok(tk.fill > 0.3, `the tank took water (${(tk.fill * 100).toFixed(0)} %)`);
});

test('real gas: air at 3000 psi is a little stiffer than ideal (Z > 1)', () => {
  const p = 3000 * 6894.757 + ATM;
  assert.ok(zAir(p, 288) > 1.0 && zAir(p, 288) < 1.1, `Z = ${zAir(p, 288)}`);
  assert.ok(molesReal(p, 1, 288) < p / (R_GAS * 288));
});

function plant(opts = {}) {
  const sea = new Sea({ wind: 0 });
  const P = new Plant({ sea, refit: opts.refit ?? true });
  P.people = [{ kg: 7.8 * LONG_TON, x: 5 * FT, y: 14 * FT, work: 0.2 }];
  return P;
}

test('hydrostatics: surfaced at about 15 ft 3 in, submerged displacement 2,419 tons', () => {
  const P = plant({ refit: false });
  P.boat.setBallast({});
  P.boat.place({ keelDepth: 4.0 });
  P.boat.initTanks(P.sea);
  for (let i = 0; i < 60 * 90; i++) P.step(1 / 60);
  near(P.dyn.out.keelDepth / FT, 15.25, 0.9, 'mean draft (ft)');
  const sub = plant({ refit: false });
  let V = 0;
  for (const s of sub.dyn.slices) V += s.area * s.dx;
  near((V * 1025.2) / LONG_TON, 2419, 60, 'submerged displacement (tons)');
});

test('speeds: 20 1/4 knots surfaced on four engines (5,400 shp), 8 3/4 submerged on the battery', () => {
  const P = plant();
  P.boat.setBallast({});
  P.boat.place({ keelDepth: 4.65 });
  P.boat.initTanks(P.sea);
  P.setAll({ 'hatch.ctUpper': 1, 'hatch.ctLower': 1, 'hm.induction': 'open', 'fer.induction': 1, 'aer.induction': 1, 'pr.imo1': 1, 'man.busSel': 'tieOpen' });
  for (const n of [1, 2, 3, 4]) {
    P.setAll({ [`eng${n}.seaSuction`]: 1, [`eng${n}.exhaustIn`]: 1, [`eng${n}.exhaustOut`]: 1, [`eng${n}.lever`]: 'run', [`man.gen.${n}`]: 'motorBus', [`man.genField.${n}`]: 1, [`man.engSpeed.${n}`]: 1 });
    Object.assign(P.engines[n - 1], { omega: 700 * Math.PI / 30, state: 'running', primed: 1, tJacket: 150 });
  }
  P.setAll({ 'man.reverse.port': 'ahead', 'man.reverse.stbd': 'ahead', 'man.starter.port': 'par2', 'man.starter.stbd': 'par2' });
  for (let i = 0; i < 60 * 600; i++) P.step(1 / 60);
  near(P.g.speed, 20.25, 0.7, 'surfaced full power (knots)');
  const S = plant();
  S.boat.setBallast({ mbt: 'flooded', safety: 1, negative: 0 });
  S.boat.place({ keelDepth: 100 * FT });
  S.boat.initTanks(S.sea);
  S.compensate(100 * FT);
  S.setAll({ 'man.busSel': 'batBus', 'man.reverse.port': 'ahead', 'man.reverse.stbd': 'ahead', 'man.starter.port': 'par2', 'man.starter.stbd': 'par2', 'man.motorField.port': 0.5, 'man.motorField.stbd': 0.5, 'cr.bowPlanesRig': 'out' });
  for (let i = 0; i < 60 * 400; i++) {
    S.set('cr.bowPlanes', Math.max(-25, Math.min(25, ((S.g.depth ?? 100) - 100) * 1.5 + S.dyn.v[1] * -10)));
    S.set('cr.sternPlanes', Math.max(-25, Math.min(25, -(S.g.pitch ?? 0) * 4 - S.dyn.w[2] * 57 * 8)));
    S.step(1 / 60);
  }
  near(S.g.speed, 8.75, 0.5, 'submerged full power (knots)');
});

test('the Squalus: the main induction open on a dive floods the engine rooms', () => {
  const P = plant();
  P.boat.setBallast({ mbt: 'flooded', safety: 1, negative: 0 });
  P.boat.place({ keelDepth: 60 * FT });
  P.boat.initTanks(P.sea);
  P.compensate(60 * FT);
  P.setAll({ 'hm.induction': 'open', 'fer.induction': 1, 'aer.induction': 1, 'pr.imo1': 1 });
  for (let i = 0; i < 60 * 30; i++) P.step(1 / 60);
  // (through the open doors it runs on into the after battery and the maneuvering room)
  const water = P.flood.total;
  assert.ok(water > 20, `the boat took ${water.toFixed(1)} m^3 in 30 s`);
  assert.ok(P.flood.byId.fer.water + P.flood.byId.aer.water > 5, 'the engine rooms flooding');
});

test('the crew\'s air: 77 men at rest take 35,000 cu ft to 3 % CO2 in about 18 hours', () => {
  const A = new Atmosphere();
  const people = Array.from({ length: 77 }, () => ({ work: 0 }));
  let t = 0;
  while (A.out.co2 === undefined || A.out.co2 < 3) { A.step(60, { people, seaT: 295, heat: 0 }); t += 60; if (t > 40 * 3600) break; }
  near(t / 3600, ATMOSPHERE.hoursTo3PctFor77, 4, 'hours to 3 % CO2');
});

test('the battery gives less at high rates (the kinetic battery model)', () => {
  const run = (I) => { const b = new Battery('t', 1); let h = 0; b.I = I; while (b.available > 0.02 && h < 60) { b.step(60); h += 1 / 60; } return h * I; };
  const fast = run(8000), slow = run(400);
  assert.ok(fast < slow * 0.8, `${fast.toFixed(0)} Ah at 8,000 A against ${slow.toFixed(0)} Ah at 400 A`);
});
