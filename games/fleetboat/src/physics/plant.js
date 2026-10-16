/**
 * The whole boat, worked by hand. Every control in data/controls.js has a value here, put there by
 * whoever worked it (a man of the crew, or you); the plant reads them and nothing else, and moves
 * the machinery they drive:
 *
 *   hydraulic manifold levers -> rams on the vents, the flood valves, the main induction (seconds
 *                                each, drawing oil from the accumulator the IMO pumps charge)
 *   plane and helm wheels      -> the planes and the rudder follow at the rams' speed
 *   air manifolds              -> the banks, the 600-lb manifold, the blows, the bleed, the
 *                                starting air, the low-pressure blower
 *   trim manifold, pumps       -> water between the variable tanks and the sea
 *   engine stands              -> the diesels (starting air, fuel, cooling, lube oil, exhaust)
 *   the cubicle                -> the batteries, generators and motors; the shafts and the screws
 *   hatches, doors, hull valves-> what the sea can come in through, and the boat's air
 *
 * Then it steps the hull in the sea (dynamics.js) with the screws' thrust and the planes' angles,
 * and reads its gauges the way the real ones read: a depth gauge is a pressure gauge graduated in
 * feet of sea water at 64 lb a cubic foot; the pit log a pitot tube (Bernoulli); the barometer the
 * boat's air.
 */
import { CONTROLS, CONTROL } from '../data/controls.js';
import { HATCHES, HULL, BOW_PLANES, STERN_PLANES, RHO_FUEL, frameX } from '../data/boat.js';
import { Boat } from './boat.js';
import { YA } from './dynamics.js';
import { Hydraulics, IN3 } from './hydraulics.js';
import { ElectricPlant, RATIO } from './electric.js';
import { Engine, RPM } from './diesel.js';
import { TrimSystem, TRIM_NODES } from './trim.js';
import { Atmosphere } from './atmosphere.js';
import { Flooding } from './flooding.js';
import { propForces, WAKE, THRUST_DEDUCTION } from './propeller.js';
import { airMolarFlow } from './gas.js';
import { BLEED_CdA } from './air.js';
import { ATM, G, KNOT, FT, PSI, INHG, LB, GAL, clamp } from './units.js';

const DEG = Math.PI / 180;
const RHO_GAUGE = 64 * LB / (FT * FT * FT);     // depth gauges are graduated for sea water of 64 lb/ft^3

/** Hydraulic rams: the gear each lever works, its stroke time (s) at full pressure and the oil it takes (in^3). */
const RAMS = {
  'hm.vent.bb': { tanks: ['bowBuoyancy'], what: 'vent', stroke: 2.5, oil: 40 },
  'hm.vent.1': { tanks: ['mbt1'], what: 'vent', stroke: 2.0, oil: 40 },
  'hm.vent.2': { tanks: ['mbt2a', 'mbt2b', 'mbt2c', 'mbt2d'], what: 'vent', stroke: 2.0, oil: 60 },
  'hm.vent.3': { tanks: ['fbt3a', 'fbt3b'], what: 'vent', stroke: 2.0, oil: 40 },
  'hm.vent.4': { tanks: ['mbt4a', 'mbt4b'], what: 'vent', stroke: 2.0, oil: 40 },
  'hm.vent.5': { tanks: ['fbt5a', 'fbt5b'], what: 'vent', stroke: 2.0, oil: 40 },
  'hm.vent.6': { tanks: ['mbt6a', 'mbt6b', 'mbt6c', 'mbt6d'], what: 'vent', stroke: 2.0, oil: 60 },
  'hm.vent.7': { tanks: ['mbt7'], what: 'vent', stroke: 2.0, oil: 40 },
  'hm.vent.safety': { tanks: ['safety'], what: 'vent', stroke: 2.0, oil: 30 },
  'hm.flood.safety': { tanks: ['safety'], what: 'flood', stroke: 3.0, oil: 70 },
  'hm.flood.negative': { tanks: ['negative'], what: 'flood', stroke: 2.5, oil: 50 },
  'hm.induction': { what: 'induction', stroke: 4.0, oil: 120 },
  'hm.hullVent': { what: 'hullVent', stroke: 3.0, oil: 60 },
};
/** The planes and the rudder: degrees a second at full pressure, oil a degree (in^3). */
const SURFACE_GEAR = { bow: { rate: 5, oil: 5 }, stern: { rate: 5, oil: 5 }, rudder: { rate: 2.5, oil: 6 }, rig: { time: 10, oil: 200 } };

/** Hull openings to the sea and the open air (boat coordinates, m; effective areas, m^2). */
const INDUCTION = { x: frameX(60), y: 25.5 * FT, CdA: 0.29 };        // the main induction outboard valve, aft of the fairwater
const HULL_SUPPLY = { x: frameX(59), y: 25.0 * FT, CdA: 0.10 };
const HULL_EXHAUST = { x: frameX(57), y: 24.5 * FT, CdA: 0.08 };
const HATCH_CdA = 0.19;                                               // a 25" hatch, open
const EXHAUST_OUT = { 1: { x: frameX(90), z: 1.6 }, 2: { x: frameX(90), z: -1.6 }, 3: { x: frameX(101), z: 1.5 }, 4: { x: frameX(101), z: -1.5 }, 0: { x: frameX(102), z: -1.4 } };
const EXHAUST_Y = 18.5 * FT, EXHAUST_CdA = 0.05;     // the outlets on the casing's sides aft, above the surfaced waterline

/** What each electrical auxiliary takes from the battery bus (W, estimates from the motors' ratings). */
const LOADS = { hotel: 32e3, lightsWhite: 9e3, lightsRed: 3e3, trimPump: 19e3, drainPump: 7.5e3, imo: 11e3, imoUnloaded: 2e3, compressor: 45e3, lpBlower: 82e3, ventBlowers: 9e3, batFan: 2e3, scope: 12e3, rig: 8e3, obsFlood: 6e3, obsLamps: 0.8e3 };

/** The shafts: propeller, shafting, gears and the two motor armatures, referred to the screw. */
const SHAFT_J = 2900;           // kg m^2 (estimate: two 45 kg m^2 armatures times the gear ratio squared, the screw and its entrained water)

export class Plant {
  constructor({ refit = true, sea } = {}) {
    this.sea = sea;
    this.boat = new Boat({ refit });
    this.dyn = this.boat.dyn;
    this.ctl = {};
    for (const c of CONTROLS) this.ctl[c.id] = c.init;
    this.hyd = new Hydraulics();
    this.elec = new ElectricPlant();
    this.engines = [1, 2, 3, 4].map((n) => new Engine(n));
    this.auxEngine = new Engine(0, { aux: true });
    this.trim = new TrimSystem();
    this.atmo = new Atmosphere();
    this.flood = new Flooding();
    this.shaft = { port: { omega: 0, revs: 0, T: 0, Q: 0 }, stbd: { omega: 0, revs: 0, T: 0, Q: 0 } };
    this.ram = Object.fromEntries(Object.keys(RAMS).map((k) => [k, 0]));
    this.rig = 0;                         // bow planes rigged out 0..1
    this.planes = { bow: 0, stern: 0, rudder: 0 };   // degrees, as the gear has them
    this.fbtAsBallast = true;             // fuel ballast tanks 3 and 5 rigged as main ballast (their flood valves open)
    this.scopes = [0, 0];                 // the periscopes raised (0 down .. 1 up): their hoists take about 14 s
    this.o2Flasks = 40 * 1000 / 32 * 30;  // mol of oxygen in the flasks (estimate: 30 days for the crew)
    this.people = [];                     // { kg, x, y, z, work } from the crew model
    this.time = 0;
    this.power = true;
    this.events = [];                     // things that happened, for the log and the crew to react to
    this.g = {};                          // the gauges
    this._addOpenings();
  }

  /** A control's value, and setting it (hands do this, a little at a time). */
  get(id) { return this.ctl[id]; }
  set(id, v) {
    if (!(id in this.ctl)) throw new Error(`no control ${id}`);
    this.ctl[id] = v;
  }
  /** Sets several controls at once (for setting up a condition, not for play). */
  setAll(map) { for (const [k, v] of Object.entries(map)) this.set(k, v); }

  // ------------------------------------------------------------------------------------------
  /** The ways the sea gets in. */
  _addOpenings() {
    const f = this.flood, c = this.ctl;
    const v = (id) => +c[id] || 0;
    f.openings.push({ id: 'induction.fer', comp: 'fer', x: INDUCTION.x, y: INDUCTION.y, CdA: 0.15, open: () => Math.min(this.ram['hm.induction'], v('fer.induction')) });
    f.openings.push({ id: 'induction.aer', comp: 'aer', x: INDUCTION.x, y: INDUCTION.y, CdA: 0.15, open: () => Math.min(this.ram['hm.induction'], v('aer.induction')) });
    f.openings.push({ id: 'hullSupply', comp: 'fer', x: HULL_SUPPLY.x, y: HULL_SUPPLY.y, CdA: HULL_SUPPLY.CdA, open: () => Math.min(this.ram['hm.induction'], v('fer.hullSupply')) });
    f.openings.push({ id: 'hullExhaust', comp: 'abr', x: HULL_EXHAUST.x, y: HULL_EXHAUST.y, CdA: HULL_EXHAUST.CdA, open: () => this.ram['hm.hullVent'] });
    for (const n of [1, 2, 3, 4, 0]) {
      const e = n ? this.engines[n - 1] : this.auxEngine;
      const comp = n === 1 || n === 2 ? 'fer' : 'aer';
      const k = n ? () => Math.min(v(`eng${n}.exhaustIn`), v(`eng${n}.exhaustOut`)) : () => v('aux.exhaust');
      // a running engine's exhaust pressure (a few psi) keeps the sea out of its own pipe
      f.openings.push({ id: `exhaust.${n}`, comp, x: EXHAUST_OUT[n].x, y: EXHAUST_Y, CdA: EXHAUST_CdA, open: () => (e.firing ? 0 : k()) });
    }
    for (const h of HATCHES) {
      if (h.id === 'galley' || h.id === 'ctLower') continue;       // the galley hatch leads to the observation deck, inside the hull
      const y = h.id === 'ctUpper' ? HULL.ctTop : HULL.innerHullTop;
      const comp = h.id === 'ctUpper' ? 'cr' : this.flood.comps.find((q) => h.x <= q.x0 && h.x >= q.x1)?.id ?? 'cr';
      const open = h.id === 'ctUpper' ? () => v('hatch.ctUpper') * v('hatch.ctLower') : () => v(`hatch.${h.id}`);
      f.openings.push({ id: `hatch.${h.id}`, comp, x: h.x, y, CdA: HATCH_CdA, open });
    }
  }

  /** Sea pressure (Pa) at a body point (boat coordinates, y above the keel). */
  seaP(x, y, z = 0) {
    const w = this.dyn.toWorld([x, y - YA, z]);
    const d = this.sea.eta(w[0], w[2]) - w[1];
    return d > 0 ? this.sea.column.pressureAt(d) : ATM;
  }
  /** Depth of a body point below the surface (m, negative above). */
  depthOf(x, y, z = 0) {
    const w = this.dyn.toWorld([x, y - YA, z]);
    return this.sea.eta(w[0], w[2]) - w[1];
  }

  // ------------------------------------------------------------------------------------------
  /** One step of dt seconds (keep dt at 1/60 s or less: the electric drive is stiff). */
  step(dt) {
    const c = this.ctl, b = this.boat, sea = this.sea, d = this.dyn;
    const v = (id) => +c[id] || 0;
    this.time += dt;
    this.events.length = 0;
    const pBoat = this.atmo.p;
    b.pBoat = pBoat;
    const power = this.power = this.elec.out.VB > 180;
    let auxW = LOADS.hotel + (c['cr.lights'] === 'red' ? LOADS.lightsRed : LOADS.lightsWhite);

    // ---- hydraulics: the IMO pumps, the rams
    this.hyd.pumps[0] = power && v('pr.imo1') > 0.5;
    this.hyd.pumps[1] = power && v('pr.imo2') > 0.5;
    for (const on of this.hyd.pumps) if (on) auxW += this.hyd.unloaded ? LOADS.imoUnloaded : LOADS.imo;
    for (const [id, r] of Object.entries(RAMS)) {
      const want = c[id] === 'open' ? 1 : 0;
      const pos = this.ram[id];
      if (Math.abs(want - pos) < 1e-4) continue;
      const rate = this.hyd.draw(1 / r.stroke, r.oil * IN3, dt);
      this.ram[id] = want > pos ? Math.min(want, pos + rate * dt) : Math.max(want, pos - rate * dt);
    }
    const rigWant = c['cr.bowPlanesRig'] === 'out' ? 1 : 0;
    if (rigWant !== this.rig) {
      const r = this.hyd.draw(1 / SURFACE_GEAR.rig.time, SURFACE_GEAR.rig.oil * IN3, dt);
      this.rig = rigWant > this.rig ? Math.min(1, this.rig + r * dt) : Math.max(0, this.rig - r * dt);
      if (power) auxW += LOADS.rig;
    }
    const follow = (key, cmd, lim) => {
      const g = SURFACE_GEAR[key], now = this.planes[key];
      const target = clamp(cmd, -lim, lim);
      if (Math.abs(target - now) < 0.05) return;
      const r = this.hyd.draw(g.rate, g.oil * IN3, dt);
      this.planes[key] = target > now ? Math.min(target, now + r * dt) : Math.max(target, now - r * dt);
    };
    if (this.rig >= 1) follow('bow', v('cr.bowPlanes'), BOW_PLANES.maxAngle);
    else this.planes.bow += (0 - this.planes.bow) * Math.min(1, dt);
    follow('stern', v('cr.sternPlanes'), STERN_PLANES.maxAngle);
    follow('rudder', c['cr.steerSel'] === 'cr' ? v('cr.helm') : v('ct.helm'), 35);
    this.hyd.step(dt);
    d.bowPlanes.angle = this.planes.bow * DEG;
    d.bowPlanes.out = this.rig >= 1 ? 1 : 0;
    d.sternPlanes.angle = this.planes.stern * DEG;
    d.rudder.angle = this.planes.rudder * DEG;

    // ---- the tanks' valves as the gear has them
    for (const tk of b.tanks) { tk.vent = 0; if (tk.kind !== 'fbt') tk.flood = 0; tk.ventInboard = 0; }
    for (const [id, r] of Object.entries(RAMS)) {
      if (!r.tanks) continue;
      for (const t of r.tanks) b.tank[t][r.what] = Math.max(b.tank[t][r.what], this.ram[id]);
    }
    b.tank.bowBuoyancy.vent = Math.max(b.tank.bowBuoyancy.vent, v('ftr.bbVentHand'));
    b.tank.mbt1.vent = Math.max(b.tank.mbt1.vent, v('ftr.mbt1VentHand'));
    b.tank.negative.flood = Math.max(b.tank.negative.flood, v('pr.negFloodHand'));
    b.tank.negative.ventInboard = v('cr.negVentInboard');
    b.tank.safety.ventInboard = v('abr.safetyVentInboard');
    for (const t of ['fbt3a', 'fbt3b', 'fbt5a', 'fbt5b']) b.tank[t].flood = this.fbtAsBallast ? 1 : 0;

    // ---- compressed air
    const air = this.air = b.air;
    for (let i = 0; i < 5; i++) air.banks[i].stop = v(`hp.bank${i + 1}`);
    air.hammer[0] = v('hp.hammer1'); air.hammer[1] = v('hp.hammer2');
    const pHP = air.pHP;
    const blow = {};
    const hpSupply = { p: pHP, T: air.T };
    if (v('hp.blow.safety') > 0) blow.safety = { supply: hpSupply, open: v('hp.blow.safety'), line: 'hp' };
    if (v('hp.blow.negative') > 0) blow.negative = { supply: hpSupply, open: v('hp.blow.negative'), line: 'hp' };
    if (v('hp.blow.bb') > 0) blow.bowBuoyancy = { supply: hpSupply, open: v('hp.blow.bb'), line: 'hp' };
    // the 600-lb manifold: what the hammer valves let through against what the open blows take
    const outlets = [];
    for (const tk of b.tanks) {
      const g = tk.group;
      if (!g || !/^[1-7]$/.test(g)) continue;
      const k = v(`mbt.blow.${g}`);
      outlets.push({ tk, a: tk.blowCdA * k, p: tk.pAir, k });
    }
    const p600 = air.solve600(pHP, outlets);
    for (const o of outlets) if (o.k > 0) blow[o.tk.id] = { supply: { p: p600, T: air.T }, open: o.k, line: '600' };
    // the low-pressure blower: the boat's own air, into the tanks whose 10-lb valves are open
    air.lpBlower = power && v('lp.blower') > 0.5;
    if (air.lpBlower) auxW += LOADS.lpBlower;
    const lpOpen = b.tanks.filter((tk) => /^[1-7]$/.test(tk.group ?? '') && v(`lp.blow.${tk.group}`) > 0.2);
    let lpMol = 0;
    if (lpOpen.length) {
      const pBack = Math.min(...lpOpen.map((tk) => tk.pAir));
      const q = air.lpFlow(pBoat, pBack) * dt;
      air.p10 = Math.min(pBoat + 13 * PSI, pBack + 0.5 * PSI);
      // into the tanks it can lift: the lowest-pressure tanks take it
      const take = lpOpen.filter((tk) => tk.pAir < pBoat + 13 * PSI);
      for (const tk of take) tk.n += q / take.length;
      lpMol = take.length ? q : 0;
    } else air.p10 = air.lpBlower ? pBoat + 13 * PSI : pBoat;
    // the bleed into the boat; the starting air to the engine rooms (through the 250-lb reducing valve)
    const bleed = v('hp.bleed') > 0 ? airMolarFlow(BLEED_CdA * v('hp.bleed'), pHP, air.T, pBoat, this.atmo.T) * dt : 0;
    const startAirP = Math.min(pHP, ATM + 250 * PSI) * v('hp.startAir');
    // the compressors charge the banks from the boat's air
    air.compressors[0] = power && v('pr.comp1') > 0.5;
    air.compressors[1] = power && v('pr.comp2') > 0.5;
    for (const on of air.compressors) if (on) auxW += LOADS.compressor;
    const compIn = air.step(dt, { pIntake: pBoat });

    // ---- the boat in the sea: the tanks (blown, vented), the trim, then the hull
    // engines and the drive first (their thrust goes into this step)
    const engAir = this._engines(dt, startAirP);
    const thrust = this._drive(dt);
    const out = b.step(dt, sea, { screws: thrust, blow });
    const tf = b.tankFlows;
    // what the banks gave: the blows and the relief, the bleed, the starting air
    const relief = air.relief600 ? airMolarFlow(3e-4 * (air.p600 / (750 * PSI) - 1) * 20, air.p600, air.T, ATM, air.T) * dt : 0;
    air.draw(tf.fromSupply + relief + Math.max(0, bleed) + engAir.start * dt);

    // ---- trim and drain
    this.trim.series = c['pr.series'] === 'series';
    this.trim.priming = power && v('tm.priming') > 0.5;
    this.trim.pump = power && v('tm.pump') > 0.5;
    if (this.trim.pump) auxW += LOADS.trimPump;
    for (const n of TRIM_NODES) { this.trim.suction[n] = v(`tm.suction.${n}`); this.trim.discharge[n] = v(`tm.discharge.${n}`); }
    const rho = sea.column.densityAt(Math.max(1, out.keelDepth));
    const nodes = {};
    for (const n of TRIM_NODES) {
      if (n === 'sea') { nodes.sea = { p: this.seaP(frameX(55), 0.5), water: 1e9, room: 1e9 }; continue; }
      const tk = b.tank[n];
      const pTop = tk.kind === 'variable' ? pBoat : tk.pAir;
      nodes[n] = { p: pTop + rho * G * tk.level, water: Math.max(0, tk.water - 0.02), room: Math.max(0, tk.volume * 0.98 - tk.water) };
    }
    const moved = this.trim.step(dt, nodes, rho);
    for (const n of TRIM_NODES) if (n !== 'sea' && moved[n]) b.tank[n].water = clamp(b.tank[n].water + moved[n], 0, b.tank[n].volume);
    this.trim.drainPump = power && v('pr.drain') > 0.5;
    if (this.trim.drainPump) auxW += LOADS.drainPump;
    const wettest = this.flood.comps.reduce((a, q) => (q.water > a.water ? q : a), this.flood.comps[0]);
    wettest.water -= this.trim.drain(dt, wettest.water, this.seaP(frameX(55), 0.5), pBoat);

    // ---- flooding through whatever is open
    const pitch = d.attitude.pitch;
    this.flood.step(dt, { pBoat, seaP: (x, y) => (this.depthOf(x, y) > 0 ? this.seaP(x, y) : null), rho, doors: (i) => v(`door.${i}`), pitch });
    b.extraMass = this.flood.massItems(pitch);

    // ---- the boat's air
    const open = (k) => k;
    const ctPath = v('hatch.ctUpper') * v('hatch.ctLower');
    let outsideOpen = 0;
    if (ctPath > 0 && this.depthOf(frameX(54), HULL.ctTop) < 0) outsideOpen += HATCH_CdA * ctPath;
    for (const h of HATCHES) {
      if (['ctUpper', 'ctLower', 'galley'].includes(h.id)) continue;
      if (v(`hatch.${h.id}`) > 0 && this.depthOf(h.x, HULL.innerHullTop) < 0) outsideOpen += HATCH_CdA * v(`hatch.${h.id}`);
    }
    const inductionDry = this.depthOf(INDUCTION.x, INDUCTION.y) < -0.3;
    const indPath = this.ram['hm.induction'] * Math.min(1, v('fer.induction') + v('aer.induction'));
    if (inductionDry) outsideOpen += open(0.15 * indPath * 2);
    const blowers = power && v('fer.ventBlowers') > 0.5;
    if (blowers) auxW += LOADS.ventBlowers;
    const ventPath = Math.min(this.ram['hm.induction'], v('fer.hullSupply'), this.ram['hm.hullVent']);
    const ventBlowers = blowers && inductionDry && ventPath > 0.2 ? 3.0 * ventPath : 0;
    const fans = [v('man.batFans.fwd') > 0.5 && power ? 0.6 : 0, v('man.batFans.aft') > 0.5 && power ? 0.6 : 0];
    auxW += (fans[0] ? LOADS.batFan : 0) + (fans[1] ? LOADS.batFan : 0);
    // the oxygen flasks
    const o2 = Math.min(this.o2Flasks, v('cr.o2') * 0.02 * dt);
    this.o2Flasks -= o2; this.atmo.o2Bleed = o2 / dt;
    // what came into or went out of the boat's air: tanks vented inboard, the bleed, the engines,
    // the compressors and the low-pressure blower
    this.atmo.exchange(tf.toBoat + Math.max(0, bleed) - engAir.boat * dt - compIn - lpMol);
    const heat = this.engines.reduce((a, e) => a + e.power * 0.02, 0) + this.auxEngine.power * 0.03
      + Object.values(this.elec.batteries).reduce((a, q) => a + q.I * q.I * q.R, 0) + auxW * 0.6;
    this.atmo.step(dt, {
      people: this.people, outsideOpen, ventBlowers,
      batteryH2: [this.elec.batteries.fwd.h2, this.elec.batteries.aft.h2], batteryFans: fans,
      batteryOverboard: ventBlowers > 0 && this.ram['hm.hullVent'] > 0.5,
      waterVolume: this.flood.total, heat, pOutside: ATM, seaT: 273.15 + sea.column.temperatureAt(Math.max(1, out.keelDepth)),
    });

    // ---- lighting and the observation deck
    if (v('obs.floodlights') > 0.5 && power) auxW += LOADS.obsFlood;
    if (v('obs.lamps') > 0.5 && power) auxW += LOADS.obsLamps;
    // the periscope hoists (electric, from the conning tower): up while the switch is on, down when off
    for (let i = 0; i < 2; i++) {
      const want = v(`ct.scope${i + 1}`) > 0.5 ? 1 : 0, cur = this.scopes[i];
      if (want !== cur && power) { this.scopes[i] = want > cur ? Math.min(1, cur + dt / 14) : Math.max(0, cur - dt / 14); auxW += LOADS.scope; }
    }
    this.elec.auxLoad = auxW;

    // ---- people and their weight
    b.people = this.people;
    this._gauges(out);
    return out;
  }

  // ------------------------------------------------------------------------------------------
  /** The diesels: their stands, their air, their exhaust, their cooling; returns the air they took. */
  _engines(dt, startAirP) {
    const c = this.ctl, v = (id) => +c[id] || 0;
    const seaTempF = this.sea.column.temperatureAt(2) * 9 / 5 + 32;
    const fuelLeft = this.boat.fuel.reduce((a, f) => a + (f.inside ? 0 : f.oil), 0) > 0.05;
    const pAir = this.atmo.p;
    let boat = 0, start = 0, fuel = 0;
    const all = [...this.engines, this.auxEngine];
    for (const e of all) {
      const n = e.id, aux = e.aux;
      const pre = aux ? 'aux' : `eng${n}`;
      e.lever = c[`${pre}.lever`];
      if (!aux) e.setRpm = 300 + 420 * v(`man.engSpeed.${n}`);
      else e.setRpm = 1200;
      const exhaustOpen = aux ? v('aux.exhaust') > 0.5 : v(`${pre}.exhaustIn`) > 0.5 && v(`${pre}.exhaustOut`) > 0.5;
      const exhaustK = aux ? v('aux.exhaust') : Math.min(v(`${pre}.exhaustIn`), v(`${pre}.exhaustOut`));
      const ex = EXHAUST_OUT[n];
      const exDepth = this.depthOf(ex.x, EXHAUST_Y, ex.z);
      // the exhaust's gas pressure against the sea at its outlet (an engine's exhaust manifold
      // runs at about 2 psi; the muffler holds a little water without stopping her)
      const backP = Math.max(0, exDepth) * 1025 * G;
      const exhaustFlooded = !e.firing && exDepth > 0.3 && exhaustK > 0;
      e.step(dt, {
        airP: pAir, airOK: true, exhaustOpen, exhaustFlooded,
        seaSuction: v(`${pre}.seaSuction`) > 0.5, seaTempF, startAirP, fuelOK: fuelLeft,
        loadTorque: aux ? this.elec.out.Tauxgen : this.elec.out.Tgen[n - 1],
        standbyLube: aux ? e.lever !== 'stop' : v(`${pre}.standbyLube`) > 0.5 && this.power,
        backPressure: Math.min(1, backP / (3 * PSI)) + (exhaustOpen ? Math.max(0, 1 - exhaustK) * 0.8 : 0),
      });
      boat += e.airIn;
      start += e.startAir;
      fuel += e.fuel;
      if (aux) this.elec.auxOmega = e.omega; else this.elec.genOmega[n - 1] = e.omega;
    }
    // the fuel burned, from the normal fuel tanks (sea water takes its place)
    let burn = fuel * dt / RHO_FUEL;
    for (const f of this.boat.fuel) {
      if (f.inside || burn <= 0) continue;
      const t = Math.min(f.oil, burn); f.oil -= t; burn -= t;
    }
    return { boat, start };
  }

  /** The cubicle, the motors and the shafts; returns the screws' thrust. */
  _drive(dt) {
    const c = this.ctl, e = this.elec, v = (id) => +c[id] || 0;
    e.c.reverse.port = c['man.reverse.port']; e.c.reverse.stbd = c['man.reverse.stbd'];
    e.c.starter.port = c['man.starter.port']; e.c.starter.stbd = c['man.starter.stbd'];
    for (let g = 0; g < 4; g++) { e.c.gen[g] = c[`man.gen.${g + 1}`]; e.c.genField[g] = v(`man.genField.${g + 1}`); }
    e.c.batSel = c['man.batSel']; e.c.busSel = c['man.busSel'];
    e.c.motorField.port = 0.45 + 0.55 * v('man.motorField.port');
    e.c.motorField.stbd = 0.45 + 0.55 * v('man.motorField.stbd');
    e.c.auxGen = v('man.auxGen') > 0.5;
    const o = e.solve({ port: this.shaft.port.omega, stbd: this.shaft.stbd.omega });
    e.step(dt);
    if (o.trip) { this.events.push(o.trip); o.trip = null; }
    // the shafts: J dw/dt = motor torque - the screw's torque - friction
    const u = this.dyn.v[0];
    const rho = this.sea.column.densityAt(Math.max(1, this.dyn.out.keelDepth || 5));
    const thrust = [];
    for (const side of ['port', 'stbd']) {
      const s = this.shaft[side];
      const n = s.omega / (2 * Math.PI);
      // the screw near the surface draws air and loses its grip (racing in a seaway)
      const sc = this.dyn.screws[side === 'port' ? 0 : 1];
      const imm = clamp((this.depthOf(sc.pos[0], sc.pos[1] + YA, sc.pos[2]) + 0.4) / 1.6, 0, 1);
      const pf = propForces(n, u * (1 - WAKE), rho);
      const Q = pf.Q * imm, T = pf.T * imm;
      const fric = Math.sign(s.omega) * Math.min(Math.abs(s.omega) * 400, 500 + 30 * Math.abs(s.omega));
      s.omega += dt * (o.Tshaft[side] - Q - fric) / SHAFT_J;
      if (Math.abs(s.omega) < 1e-4 && Math.abs(o.Tshaft[side]) < Math.abs(fric) + 1) s.omega = 0;
      s.revs += s.omega * dt / (2 * Math.PI);
      s.T = T; s.Q = Q;
      thrust.push({ T: T * (1 - THRUST_DEDUCTION) });
    }
    return thrust;
  }

  // ------------------------------------------------------------------------------------------
  /** The gauges, as they read (pressures turned into their graduations). */
  _gauges(out) {
    const g = this.g, d = this.dyn, b = this.boat, air = b.air, at = d.attitude;
    const pKeel = this.seaP(frameX(55), 0);
    g.depth = Math.max(0, (pKeel - ATM) / (RHO_GAUGE * G)) / FT;        // feet, keel depth as the gauges read it
    // the fathometer: a sound pulse from the keel to the bottom and back, timed, read at the
    // instrument's 4,800 ft/s (the real sound speed in this warm water is about 5,000: it reads shallow)
    const kw = d.toWorld([frameX(55), -YA, 0]);
    const under = this.sea.floor(kw[0], kw[2]) - (this.sea.eta(kw[0], kw[2]) - kw[1]);
    const c = this.sea.column.soundAt?.(Math.max(1, under / 2)) ?? 1530;
    g.fathometer = Math.max(0, under) * (4800 * FT / c) / FT;            // feet under the keel
    g.pitch = at.pitch / DEG; g.heel = at.heel / DEG; g.heading = ((at.heading / DEG) % 360 + 360) % 360;
    g.bubble = clamp(g.pitch, -15, 15);
    const u = d.v[0];
    const rho = this.sea.column.densityAt(Math.max(1, out.keelDepth));
    const q = 0.5 * rho * u * u;                                          // the pit log's pitot: dynamic pressure
    g.speed = Math.sign(u) * Math.sqrt(2 * q / RHO_GAUGE) / KNOT;
    g.planes = { bow: this.planes.bow, stern: this.planes.stern, rudder: this.planes.rudder, rig: this.rig };
    g.barometer = this.atmo.p / INHG;                                     // inches of mercury
    g.boatPsi = (this.atmo.p - ATM) / PSI;
    g.banks = air.banks.map((k) => (air.bankP(k) - ATM) / PSI);
    g.hpManifold = (air.pHP - ATM) / PSI;
    g.p600 = (air.p600 - ATM) / PSI;
    g.p10 = (air.p10 - ATM) / PSI;
    g.hydraulic = this.hyd.psi;
    g.trimFlow = this.trim.flow / (GAL / 60);
    g.drainFlow = this.trim.drainFlow / (GAL / 60);
    g.tanks = {};
    for (const tk of b.tanks) if (tk.kind === 'variable' || tk.kind === 'negative' || tk.kind === 'safety') g.tanks[tk.id] = tk.water / GAL;    // tank gauges, gallons
    const e = this.elec.out, bat = this.elec.batteries;
    g.volts = { bus: e.VB, port: e.VP, stbd: e.VS };
    g.amps = { port: e.Imotor.port, stbd: e.Imotor.stbd, fwdBat: bat.fwd.I, aftBat: bat.aft.I, gen: [...e.Igen], aux: e.Iaux };
    g.sg = { fwd: bat.fwd.sg, aft: bat.aft.sg };
    g.batTemp = { fwd: bat.fwd.T * 9 / 5 + 32, aft: bat.aft.T * 9 / 5 + 32 };
    g.shaftRpm = { port: this.shaft.port.omega * 60 / (2 * Math.PI), stbd: this.shaft.stbd.omega * 60 / (2 * Math.PI) };
    g.motorRpm = { port: g.shaftRpm.port * RATIO, stbd: g.shaftRpm.stbd * RATIO };
    g.revs = { port: this.shaft.port.revs, stbd: this.shaft.stbd.revs };
    g.engines = [...this.engines, this.auxEngine].map((x) => ({ rpm: x.omega / RPM, lube: x.pLube, jacket: x.tJacket, state: x.state, alarms: [...x.alarms], fuel: x.fuel, power: x.power }));
    g.co2 = this.atmo.out.co2; g.o2 = this.atmo.out.o2; g.h2 = this.atmo.out.h2; g.batteryH2 = this.atmo.out.batteryH2;
    g.airTemp = this.atmo.T * 9 / 5 - 459.67;
    g.fuel = b.fuel.reduce((a, f) => a + f.oil, 0) / GAL;
    g.flood = Object.fromEntries(this.flood.comps.map((q) => [q.id, q.water / GAL]));
    g.power = this.power;
    g.alarm = !!(this.ctl['cr.divingAlarm'] || this.ctl['ct.divingAlarm'] || this.ctl['br.divingAlarm']);
    g.bell = { port: this.ctl['ct.telegraph.port'] !== this.ctl['man.answer.port'], stbd: this.ctl['ct.telegraph.stbd'] !== this.ctl['man.answer.stbd'] };
    g.board = this.christmasTree();
  }

  /**
   * The hull opening indicator panel (the "Christmas tree"): a light for each hull opening, red
   * open, green shut. A "straight board" (all green) is what the diving officer wants to see.
   */
  christmasTree() {
    const c = this.ctl, v = (id) => +c[id] || 0;
    const L = [];
    for (const h of HATCHES) if (h.id !== 'galley' && h.id !== 'ctLower') L.push({ id: `hatch.${h.id}`, name: h.name, open: v(`hatch.${h.id}`) > 0.01 });
    L.push({ id: 'induction', name: 'Main induction', open: this.ram['hm.induction'] > 0.01 });
    L.push({ id: 'hullVent', name: 'Hull ventilation', open: this.ram['hm.hullVent'] > 0.01 });
    for (const n of [1, 2, 3, 4]) L.push({ id: `exhaust.${n}`, name: `No. ${n} engine exhaust`, open: v(`eng${n}.exhaustOut`) > 0.01 });
    L.push({ id: 'exhaust.aux', name: 'Auxiliary engine exhaust', open: v('aux.exhaust') > 0.01 });
    for (const [id, r] of Object.entries(RAMS)) if (r.what === 'vent') L.push({ id, name: `${CONTROL[id].label}`, open: this.ram[id] > 0.01, vent: true });
    return L;
  }

  /** The diving officer's compensation for this sea, with the people where they are now. */
  compensate(depth) {
    this.boat.people = this.people;
    return this.boat.compensate(this.sea, depth);
  }

  /** The truth, for tests and the log (no gauge on the boat reads these). */
  truth() {
    const d = this.dyn, out = d.out, m = this.boat.massProps;
    return {
      keelDepth: out.keelDepth, buoyancy: out.buoyancy, weight: m ? m.m * G : 0,
      excess: m ? out.buoyancy - m.m * G : 0, pitch: d.attitude.pitch, speed: d.v[0],
    };
  }
}

export { RAMS, LOADS, INDUCTION, SHAFT_J };
