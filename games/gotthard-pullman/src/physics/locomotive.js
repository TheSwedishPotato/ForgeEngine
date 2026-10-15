/**
 * SBB C 5/6 2978 "Elefant" (SLM 1917, works no. 2612): a 1'E h4v engine,
 * superheated four-cylinder compound (von Borries arrangement). The inside
 * high-pressure cylinders drive the second coupled axle, the outside
 * low-pressure cylinders the third; HP exhaust goes to a receiver that feeds
 * the LP cylinders, whose exhaust makes the blast that draws the fire.
 *
 * Data (SBB Historic archive RM_T_0005; Dampfteam C 5/6 data sheet for 2978):
 *   HP 2 x 470 mm, LP 2 x 690 mm, stroke 640 mm; drivers 1330 mm, leading wheels 850 mm;
 *   boiler 15 at; grate 3.7 m²; firebox 13.6 m², tubes 260.1 m² (incl. superheater 63.6 m²);
 *   boiler water 8.4 m³; adhesive weight 76.3 t; engine 86.6 t, tender 41.8 t (16.2 t empty),
 *   18 m³ water + 8 t coal; 65 km/h; 1190 kW at the drawbar at 50 km/h.
 * Assumed where no source was found (README lists each): rod length, clearance volumes,
 * port throttling, receiver and steam-chest volumes, valve event law, injector and pump ratings.
 *
 * The physics, in order each step: regulator -> steam chest; cylinders (pressure from
 * the crank angle through admission, cut-off, expansion, release, exhaust and
 * compression) -> piston forces -> crank torque; steam drawn per stroke -> chest and
 * receiver pressures; LP exhaust -> blast -> smokebox vacuum -> air through the fire ->
 * combustion -> heat into the water -> boiler pressure (first law, with the water and
 * steel heat capacity) and water level; the coupled wheels turn under the torque against
 * the rail's adhesion, and slip if it is exceeded.
 */
import { tSat, hf, hfg, hg, dhfdp, rhoSteam, hSteam, hWater, P_ATM, R_STEAM } from './steamtables.js';
import { adhesionForce } from './adhesion.js';

const G = 9.80665;
const TAU = Math.PI * 2;

export const C56 = {
  name: 'C 5/6 2978',
  hp: { bore: 0.470, stroke: 0.640, clearance: 0.11 },
  lp: { bore: 0.690, stroke: 0.640, clearance: 0.09 },
  rod: 2.80,                       // main rod length, m (assumed)
  driver: 1.330,                   // driving wheel diameter, m
  leading: 0.850,
  adhesiveMass: 76300, engineMass: 86600,
  tender: { empty: 16200, water: 18000, coal: 8000 },
  driverInertia: 3800,             // coupled wheelsets + rods, kg m² (estimate)
  pSet: 15 * 0.980665 + P_ATM,     // 15 at gauge -> bar abs (safety valves lift)
  boilerWater: 8.4,                // m³ at working level
  boilerSteel: 30000,              // kg of boiler shell, tubes and firebox taking part in heat storage (estimate)
  grate: 3.7,                      // m²
  regulatorArea: 0.0113,           // m², ~120 mm main valve (estimate)
  chestVolume: 0.55,               // superheater, header, pipes, valve chests (m³, estimate)
  receiverVolume: 0.45,            // m³ (estimate)
  coalLHV: 29.0e6,                 // J/kg, hard coal
  airPerCoal: 14.5,                // kg air per kg coal (stoichiometric ~10.5 with ~40 % excess)
};

/** Valve events for a cut-off c (fraction of stroke): Walschaerts gear, approximate law. */
export function valveEvents(c) {
  c = Math.max(0.05, Math.min(0.85, c));
  return {
    cut: c,
    rel: Math.min(0.97, 0.55 + 0.45 * c),                  // release (exhaust opens)
    comp: 0.04 + 0.32 * Math.pow(1 - c, 1.4),              // fraction of the return stroke left when exhaust closes
    lead: 0.012,                                           // pre-admission before dead centre
  };
}

/** Piston position (0..1 of stroke from the head end) and dx/dphi (m/rad) for crank angle phi. */
function slider(phi, r, l) {
  const s = Math.sin(phi), c = Math.cos(phi);
  const root = Math.sqrt(l * l - r * r * s * s);
  const x = r * (1 - c) + l - root;            // 0 at head-end dead centre, 2r at crank-end dead centre
  const dx = r * s + (r * r * s * c) / root;
  return { f: x / (2 * r), dx };
}

/**
 * Pressure (bar abs) in one end of a cylinder.
 * f: distance from this end's dead centre as a fraction of stroke; outward: piston moving away from this end.
 */
export function endPressure(f, outward, ev, pAdm, pBack, cl, n) {
  if (outward) {
    if (f <= ev.cut) return pAdm;
    const pCut = pAdm;
    if (f <= ev.rel) return pCut * Math.pow((ev.cut + cl) / (f + cl), n);
    const pRel = pCut * Math.pow((ev.cut + cl) / (ev.rel + cl), n);
    return pBack + (pRel - pBack) * Math.exp(-(f - ev.rel) / 0.025);
  }
  if (f > ev.comp) return pBack;
  let p = pBack * Math.pow((ev.comp + cl) / (f + cl), n);
  if (f < ev.lead) p = Math.max(p, pAdm * (1 - f / ev.lead) + p * (f / ev.lead));
  return Math.min(p, Math.max(pAdm, pBack) * 1.15);
}

export class SteamLocomotive {
  constructor(spec = C56, { ambientC = -5 } = {}) {
    this.spec = spec;
    const S = spec;
    this.areaHP = Math.PI * S.hp.bore ** 2 / 4;
    this.areaLP = Math.PI * S.lp.bore ** 2 / 4;
    this.Vhp = this.areaHP * S.hp.stroke;
    this.Vlp = this.areaLP * S.lp.stroke;
    this.r = S.hp.stroke / 2;
    this.R = S.driver / 2;
    // cylinders: HP right leads HP left by 90°; each LP crank opposite its side's HP crank
    this.cyl = [
      { name: 'HP right', group: 'hp', phase: 0 },
      { name: 'HP left', group: 'hp', phase: -Math.PI / 2 },
      { name: 'LP right', group: 'lp', phase: Math.PI },
      { name: 'LP left', group: 'lp', phase: Math.PI / 2 },
    ];
    // ---- state
    this.theta = 0.3;                 // crank angle of the HP right crank, rad
    this.omega = 0;                   // driver angular speed, rad/s
    this.p = S.pSet - 0.4;            // boiler pressure, bar abs
    this.waterMass = S.boilerWater * (1 / 0.001154) ;   // kg at working level (v_f at 15 bar)
    this.waterNominal = this.waterMass;
    this.pChest = P_ATM; this.pRec = P_ATM;
    this.mChest = rhoSteam(P_ATM, 120) * S.chestVolume;
    this.mRec = rhoSteam(P_ATM, 110) * S.receiverVolume;
    this.Tsup = tSat(this.p) + 40;    // superheated steam temperature, °C
    this.fire = { burning: 260, green: 0, temp: 900 };   // kg of coal burning / not yet alight on the grate
    this.tenderWater = S.tender.water;
    this.tenderCoal = S.tender.coal;
    this.tenderWaterC = 8;            // tender water temperature (filled warm-ish in winter)
    this.sand = 300;                  // kg in the sandboxes
    this.pMR = 8.0;                   // main reservoir, bar abs
    this.pumpOn = false;
    this.svOpen = false;
    this.ambientC = ambientC;
    // ---- controls (moved by the crew's hands only)
    this.c = {
      regulator: 0, reverser: 0.0,  // reverser: cut-off, + forward, - backward
      drainCocks: true, blower: 0.15, dampers: 1, firedoor: false,
      injector: [false, false], sander: false, whistle: 0, steamHeat: 0, airPump: 1,
      startingValve: false,         // driver-held live-steam admission to the receiver
    };
    this.regPos = 0;                  // actual regulator valve opening (lags the handle a little)
    // ---- outputs
    this.out = {
      torque: 0, Fadh: 0, slip: 0, creep: 0, power: 0, steamRate: 0, coalRate: 0, draft: 0,
      exhaustRate: 0, smoke: 0, events: [], level: 0, levelRaw: 0, svFlow: 0, drainFlow: 0, whistleFlow: 0,
      cylP: [[0, 0], [0, 0], [0, 0], [0, 0]], indicated: 0, mu: 0, pumpBeat: 0, heatFlow: 0, injectorFlow: 0,
    };
    this._pumpPhase = 0;
    this.time = 0;
  }

  /** Total mass of engine + tender now (supplies change), kg. */
  get mass() { return this.spec.engineMass + this.tenderMass; }
  get engineMass() { return this.spec.engineMass - (this.waterNominal - this.waterMass) - (300 - this.sand) * 0; }
  get tenderMass() { return this.spec.tender.empty + this.tenderWater + this.tenderCoal; }

  /** Water level in the gauge glass, mm above the firebox crown sheet. */
  _level(grade, accel, evap) {
    const base = 120 + (this.waterMass - this.waterNominal) / 10;      // ~10 kg per mm of level
    const swell = 30 * Math.pow(Math.min(1, evap / 2.6), 0.7);
    // the water surface lies square to the apparent gravity: uphill (and accelerating)
    // it runs back toward the firebox end, where the glass is
    const tilt = 3500 * (grade + accel / G);
    return { raw: base + swell, glass: base + swell + tilt, true: base, swell, tilt };
  }

  /**
   * Advance by dt. env: { v: train speed m/s, grade, accel, normalDrivers (N), mu: adhesion limit at the drivers,
   *   ambientC, airDensity, wind, coachesHeated, heatDemand (kg/s of steam the train's heating wants), brakeTorque (N m on the drivers) }
   */
  step(dt, env) {
    const S = this.spec, c = this.c, o = this.out;
    this.time += dt;
    o.events.length = 0;
    const v = env.v;
    // ---- regulator valve follows the handle (linkage play, a fraction of a second)
    this.regPos += (c.regulator - this.regPos) * Math.min(1, dt * 6);
    const p = this.p, Ts = tSat(p);
    // ---- superheat: the hotter and harder the fire, the hotter the steam (time constant ~1 min)
    const fireFrac = Math.min(1, o.coalRate / 0.5);
    const flowFrac = Math.min(1, o.steamRate / 2.4);
    // ~150 K of superheat at full work (about 340-350 °C at 15 at), little when the regulator is shut
    const Ttarget = Ts + 15 + 140 * Math.pow(fireFrac, 0.5) * (0.35 + 0.65 * Math.min(1, flowFrac * 2.5));
    this.Tsup += (Ttarget - this.Tsup) * Math.min(1, dt / 60);
    const Tch = Math.max(this.Tsup, tSat(this.pChest) + 1);

    // ---- regulator flow, boiler -> steam chest (compressible orifice)
    const regArea = S.regulatorArea * (this.regPos < 0.15 ? (this.regPos / 0.15) * 0.08 : 0.08 + 0.92 * Math.pow((this.regPos - 0.15) / 0.85, 1.3));
    const mReg = orifice(regArea * 0.72, p, Ts + 2, this.pChest);
    // starting valve: reduced live steam into the receiver (about 40 % of boiler pressure)
    const startOpen = c.startingValve && this.regPos > 0.02;
    const pStart = Math.min(p, 0.42 * p);
    const mStart = startOpen ? orifice(0.0012, Math.min(this.pChest, p), Tch, this.pRec) * (this.pRec < pStart ? 1 : 0) : 0;

    // ---- cylinders
    const ev = valveEvents(Math.abs(c.reverser));
    const evLP = valveEvents(Math.min(0.85, Math.abs(c.reverser) + 0.12));
    const dir = c.reverser >= 0 ? 1 : -1;
    const nrps = Math.abs(this.omega) / TAU;
    const u = 2 * S.hp.stroke * nrps;                                   // mean piston speed, m/s
    const throttle = (cc) => Math.max(0.6, 1 - 0.12 * Math.pow(u / 5, 2) * (1 - cc));
    const pBlastBack = P_ATM + 0.056 * o.exhaustRate * o.exhaustRate;    // blast pipe back pressure
    const pAdmHP = Math.max(P_ATM, this.pChest * throttle(ev.cut));
    const pAdmLP = Math.max(P_ATM, this.pRec * throttle(evLP.cut));
    const nHP = 1.30, nLP = 1.25;
    let torque = 0;
    for (let k = 0; k < 4; k++) {
      const cy = this.cyl[k];
      const hp = cy.group === 'hp';
      const phi = this.theta + cy.phase;
      const { f, dx } = slider(((phi % TAU) + TAU) % TAU, this.r, S.rod);
      // The valve is driven from the crank: in fore gear it opens the head end over the half
      // turn in which a forward-turning crank draws the piston away from it, in back gear over
      // the other half. (Rolling against the gear, the same events give counter-pressure.)
      const headAdmits = dir >= 0 ? dx > 0 : dx < 0;
      const e = hp ? ev : evLP, pa = hp ? pAdmHP : pAdmLP, pb = hp ? this.pRec : pBlastBack, cl = hp ? S.hp.clearance : S.lp.clearance, n = hp ? nHP : nLP;
      const pHead = endPressure(f, headAdmits, e, pa, pb, cl, n);
      const pCrank = endPressure(1 - f, !headAdmits, e, pa, pb, cl, n);
      o.cylP[k][0] = pHead; o.cylP[k][1] = pCrank;
      const A = hp ? this.areaHP : this.areaLP;
      const Fp = (pHead - pCrank) * 1e5 * A;          // + pushes the piston toward the crank
      torque += Fp * dx;
    }
    // piston, valve and motion friction (drag when drifting)
    torque -= Math.sign(this.omega) * Math.min(1, Math.abs(this.omega) * 4) * 2500 * this.R;
    o.torque = torque;

    // ---- steam drawn per revolution (cycle averages)
    const rhoHP = rhoSteam(pAdmHP, Tch);
    const TrecIn = Math.max(tSat(this.pRec) + 3, (Tch + 273.15) * Math.pow(this.pRec / Math.max(this.pChest, this.pRec + 0.01), (nHP - 1) / nHP) - 273.15);
    const rhoLP = rhoSteam(pAdmLP, TrecIn);
    const cushion = (pb, e, cl, n, T) => rhoSteam(Math.min(20, pb * Math.pow((e.comp + cl) / cl, n)), T) * cl;
    const mEndHP = Math.max(0, rhoHP * (ev.cut + S.hp.clearance) - cushion(this.pRec, ev, S.hp.clearance, nHP, TrecIn)) * this.Vhp;
    const mEndLP = Math.max(0, rhoLP * (evLP.cut + S.lp.clearance) - cushion(pBlastBack, evLP, S.lp.clearance, nLP, 110)) * this.Vlp;
    const drain = c.drainCocks ? 0.06 * Math.min(1, (this.pChest - P_ATM) / 4) * Math.min(1, this.regPos * 8) : 0;
    let mHP = 4 * mEndHP * nrps + drain;               // 2 cylinders x 2 ends
    let mLP = 4 * mEndLP * nrps + drain * 0.6;
    // at standstill with steam on, the pistons are held; leakage past rings and valves
    mHP += this.regPos > 0.02 ? 0.01 * (this.pChest - P_ATM) / 14 : 0;
    o.drainFlow = c.drainCocks ? drain * 1.6 : 0;

    // ---- steam chest and receiver (ideal-gas masses at their temperatures)
    this.mChest = Math.max(1e-3, this.mChest + (mReg - mHP - mStart) * dt);
    this.mRec = Math.max(1e-3, this.mRec + (mHP + mStart - mLP) * dt);
    this.pChest = Math.min(p, Math.max(P_ATM * 0.98, (this.mChest * 0.96 * R_STEAM * (Tch + 273.15)) / (S.chestVolume * 1e5)));
    this.pRec = Math.min(this.pChest + 0.01, Math.max(P_ATM * 0.98, (this.mRec * 0.97 * R_STEAM * (TrecIn + 273.15)) / (S.receiverVolume * 1e5)));
    // an empty receiver at standstill fills only through the starting valve or HP exhaust

    // ---- exhaust, blast and draught
    const blowerFlow = 0.09 * c.blower * Math.min(1, (p - P_ATM) / 10);
    const pumpSteam = this.pumpOn ? 0.035 * c.airPump : 0;
    o.exhaustRate = mLP + o.drainFlow * 0;        // LP exhaust up the blast pipe
    const chimneySteam = mLP + blowerFlow + pumpSteam * 0.8;
    o.draft = 275 * Math.pow(mLP, 1.85) + 900 * Math.pow(blowerFlow / 0.09, 1.6) * (blowerFlow > 0 ? 1 : 0) + 25;   // Pa of smokebox vacuum
    // exhaust beats: each LP release
    for (let k = 2; k < 4; k++) {
      const cy = this.cyl[k];
      for (const off of [0, Math.PI]) {
        const relPhi = Math.acos(1 - 2 * evLP.rel) + off;     // crank angle where the end releases (approx.)
        const a0 = (((this.theta - this.omega * dt + cy.phase) - relPhi) % TAU + TAU) % TAU;
        const a1 = (((this.theta + cy.phase) - relPhi) % TAU + TAU) % TAU;
        if (this.omega > 0.05 && a1 < a0 && a0 - a1 > Math.PI) {
          const pRel = pAdmLP * Math.pow((evLP.cut + S.lp.clearance) / (evLP.rel + S.lp.clearance), nLP);
          const ev = { type: 'beat', cyl: cy.name, strength: Math.max(0, pRel - pBlastBack), mass: mEndLP, t: this.time, n: (this._evN = (this._evN ?? 0) + 1) };
          o.events.push(ev);
          // kept for the renderer and the sound, which read them once a frame
          (this.queue ??= []).push(ev);
          if (this.queue.length > 256) this.queue.shift();
        }
      }
    }

    // ---- the fire
    const F = this.fire;
    // fresh coal warms, gives off its volatiles (smoke) and catches over about 40 s
    const catchRate = F.green / 40;
    F.green -= catchRate * dt; F.burning += catchRate * dt;
    const airFlow = 0.2 * c.dampers * Math.sqrt(Math.max(0, o.draft)) * (c.firedoor ? 0.75 : 1) * (F.burning < 120 ? 1.15 : 1);
    const burnMax = F.burning / 500;            // a bed burns through in ~8 min at full air
    const burn = Math.max(0, Math.min(airFlow / S.airPerCoal, burnMax));
    F.burning = Math.max(0, F.burning - burn * dt);
    const bmax = 0.55;                          // ~2 t/h on 3.7 m² (grate limit)
    const etaComb = 0.95 - 0.14 * (burn / bmax);
    const Qfire = burn * S.coalLHV * etaComb;
    const etaBoil = (0.82 - 0.22 * (burn / bmax)) * (c.firedoor ? 0.85 : 1);
    const Qloss = 320 * (Ts - env.ambientC) * (1 + (env.windSpeed ?? 0) / 15) + (env.inTunnel ? -40 * (Ts - env.ambientC) : 0);
    const Qw = Qfire * etaBoil - Qloss;
    o.coalRate = burn;
    o.smoke = Math.min(1, catchRate * 2.5 + (burn / bmax) * (1 - etaComb) * 4 + (c.firedoor ? 0 : 0));

    // ---- auxiliaries drawing steam
    // two live-steam injectors, ~180 l/min each when the water valve is wide (estimate); the valve trims delivery
    const injFrac = (x) => (x === true ? 1 : x > 0 ? Math.max(0.55, Math.min(1, x)) : 0);
    const injWater = 3.0 * injFrac(c.injector[0]) + 3.0 * injFrac(c.injector[1]);
    const injSteam = injWater / 12;
    const water = Math.min(injWater, this.tenderWater / Math.max(dt, 1e-3));
    const feedT = this.tenderWaterC + (injSteam * hg(p)) / (Math.max(water, 1e-6) * 4186) * (water > 0 ? 1 : 0);
    const hFeed = hWater(Math.min(95, feedT));
    const heatFlow = c.steamHeat * Math.min(env.heatDemand ?? 0, 0.25);
    const whistleFlow = 0.16 * c.whistle * Math.min(1, (p - P_ATM) / 10);
    // safety valves (two pop valves): lift at the set pressure, reseat 0.3 bar lower
    if (p >= S.pSet) this.svOpen = true; else if (p < S.pSet - 0.3) this.svOpen = false;
    const svFlow = this.svOpen ? Math.min(3.4, 0.6 + 8 * Math.max(0, p - S.pSet + 0.3)) : 0;
    // the air pump: governor between 7.0 and 8.0 bar main reservoir
    if (this.pMR < 7.0) this.pumpOn = true; else if (this.pMR > 8.0) this.pumpOn = false;
    const pumpAir = this.pumpOn ? 0.028 * c.airPump * Math.min(1, (p - P_ATM) / 8) : 0;   // ~1.4 m³/min free air
    this._pumpPhase += this.pumpOn ? dt * 1.6 * c.airPump : 0;
    o.pumpBeat = this.pumpOn ? Math.sin(this._pumpPhase * TAU) : 0;
    o.pumpAir = pumpAir;
    // main reservoir 0.8 m³ (estimate): 1 kg of air at ~290 K raises it by about 1.04 bar
    this.pMR += (pumpAir - (env.airDemand ?? 0)) * dt * (287 * 290) / (0.8 * 1e5);
    this.pMR = Math.max(1, Math.min(9.5, this.pMR));

    const steamOut = mReg + blowerFlow + pumpSteam + injSteam + heatFlow + whistleFlow + svFlow;
    o.steamRate = steamOut; o.svFlow = svFlow; o.whistleFlow = whistleFlow; o.heatFlow = heatFlow; o.injectorFlow = water;

    // ---- boiler: first law over the water, steam and hot steel
    const dTdp = (tSat(p + 0.05) - tSat(p - 0.05)) / 0.1;
    const C = Math.max(2000, this.waterMass) * dhfdp(p) + S.boilerSteel * 480 * dTdp;          // J per bar
    let dpdt = (Qw - steamOut * hfg(p) - water * (hf(p) - hFeed)) / C;
    // a melted fusible plug: steam and water blow into the firebox, the pressure falls away, the fire is out
    if (this.failed === 'fusible plug') { dpdt = -(this.p - P_ATM) / 45; this.fire.burning *= Math.exp(-dt / 20); this.fire.green *= Math.exp(-dt / 20); }
    this.p = Math.min(S.pSet + 1.5, Math.max(P_ATM, this.p + dpdt * dt));
    this.waterMass = Math.max(0, this.waterMass + (water + injSteam - steamOut) * dt);
    this.tenderWater = Math.max(0, this.tenderWater - water * dt);
    this._accS = (this._accS ?? 0) + ((env.accel ?? 0) - (this._accS ?? 0)) * Math.min(1, dt / 1.5);   // the water sloshes slowly
    const lv = this._level(env.grade ?? 0, this._accS, steamOut);
    o.level = lv.glass; o.levelRaw = lv.raw; o.levelTrue = lv.true;
    // the firebox crown sheet: covered by the water at the firebox end (tilt counts there, about 2.5 m from the middle)
    o.crownCover = lv.true + 2500 * ((env.grade ?? 0) + this._accS / G);
    if (o.crownCover < 0) this.crownExposed = (this.crownExposed ?? 0) + dt; else this.crownExposed = Math.max(0, (this.crownExposed ?? 0) - dt * 0.2);
    // the crown sheet bare and red hot for long: the lead plugs in it melt (they are there to save the boiler).
    // A sheet bared for a few seconds by a brake application is still wet and splashed; the copper has
    // to heat through before the lead core runs, which takes the better part of a minute.
    if (!this.failed && this.crownExposed > 40 && o.crownCover < -40) { this.failed = 'fusible plug'; o.events.push({ type: 'fusible plug', t: this.time }); }

    // ---- coupled wheels against the rail
    const N = env.normalDrivers;
    const slipV = this.omega * this.R - v;
    const { F: Fa, dF, creep } = adhesionForce(slipV, v, N, env.mu);
    o.mu = env.mu;
    // implicit in the creep force (it is stiff): J dw = (T - Fa R - Tb) dt with dFa = dF/dslip * R * dw
    const Tb = env.brakeTorque ?? 0;                 // brake blocks on the coupled wheels (friction: opposes rotation)
    const J = S.driverInertia, Jeff = J + Math.max(0, dF) * this.R * this.R * dt;   // the falling (kinetic) branch is taken explicitly
    const w0 = this.omega;
    let w1 = w0 + ((torque - Fa * this.R) * dt) / Jeff;
    if (Tb > 0) {
      const bw = (Tb * dt) / Jeff;
      if (w0 !== 0) {
        const w2 = w1 - Math.sign(w0) * bw;
        w1 = Math.sign(w2) !== Math.sign(w0) ? 0 : w2;     // the blocks can stop the wheel, not turn it back
      } else if (Math.abs(w1) <= bw) w1 = 0;                // held
      else w1 -= Math.sign(w1) * bw;
    }
    this.omega = w1;
    this.theta += this.omega * dt;
    const slip2 = this.omega * this.R - v;
    const res = adhesionForce(slip2, v, N, env.mu);
    o.Fadh = res.F; o.slip = slip2; o.creep = res.creep;
    o.power = torque * this.omega; o.indicated = o.power;
    return o;
  }

  /** The fireman puts a shovelful on the grate. */
  fireShovel(kg = 6) {
    const k = Math.min(kg, this.tenderCoal);
    this.tenderCoal -= k; this.fire.green += k;
  }
}

/** Mass flow (kg/s) through an orifice of effective area A from p1 (bar, T1 °C) to p2 (bar). */
export function orifice(A, p1, T1, p2) {
  if (A <= 0 || p1 <= p2) return 0;
  const k = 1.3, r = p2 / p1, rc = Math.pow(2 / (k + 1), k / (k - 1));
  const P1 = p1 * 1e5, rho1 = rhoSteam(p1, T1);
  if (r <= rc) return A * Math.sqrt(k * P1 * rho1 * Math.pow(2 / (k + 1), (k + 1) / (k - 1)));
  return A * Math.sqrt(2 * P1 * rho1 * (k / (k - 1)) * (Math.pow(r, 2 / k) - Math.pow(r, (k + 1) / k)));
}

void hSteam;
