/**
 * The electric plant: two storage batteries, four main generators, four main motors, the
 * auxiliary generator, and the main propulsion control cubicle in the maneuvering room that
 * connects them (Fleet Type Submarine 6C, General Information Book A-1).
 *
 * The cubicle's ten levers, as on the boat:
 *  - two reverse levers (OFF, AHEAD, ASTERN), port and starboard motors;
 *  - two starter levers (STOP, SER 1, SER 2, SER 3, PAR 1, PAR 2): the two motors of a side in
 *    series or in parallel, with starting resistance in SER 1, SER 2 and PAR 1;
 *  - four generator levers (OFF, MOTOR BUS, BAT BUS);
 *  - the battery selector (OFF, AFT BAT, FWD BAT, BOTH BAT);
 *  - the bus selector (BUS TIE CLOSED, BUS TIE OPEN, OFF, BAT BUS, SLOW).
 * And the rheostats: each generator's field (its voltage) and each side's motor field (on the
 * battery the speed is set by weakening the motors' field). The levers move only when an
 * electrician moves them (crew/), or you.
 *
 * Every step the network is solved: each battery, generator and motor pair is an EMF behind a
 * resistance; the battery bus and the two motor buses are nodes (merged as the bus selector
 * ties them); Kirchhoff's current law gives the bus voltages, Ohm's law the currents, and the
 * currents the torques (T = K phi I) on the shafts and on the engines.
 *
 * Batteries: 126 cells each, Gould or Exide, 1,660 lb a cell. The kinetic battery model
 * (Manwell & McGowan 1993: the charge in two wells, one available and one bound, flowing
 * between them) fitted to the yard's discharge rates (8,050 A for half an hour ... 235 A for 48
 * hours) to within 9 %: capacity 11,256 Ah, available share 0.336, rate constant 0.213 an hour.
 * So she gives less at high rates, and gets some back after a rest. Open-circuit voltage from
 * the electrolyte's specific gravity (OCV = SG + 0.84 per cell: 2.09 V at 1.250, the book's
 * 262.5 V for 126 cells); charging gasses hydrogen above about 2.35 V a cell (Faraday: 0.0376 g
 * of H2 an ampere-hour of overcharge).
 */
import { BATTERY, MAIN_MOTOR, MAIN_GENERATOR, REDUCTION_GEAR, AUX_ENGINE } from '../data/boat.js';

export const KIBAM = { C: 11256, c: 0.336, k: 0.213 };          // Ah, fraction, per hour
const R_CELL = 3.5e-5;                                           // ohm a cell (estimate from the rated currents' voltage drop)
const RATIO = REDUCTION_GEAR.ratio;

/** Starting resistance (ohms) in each starter position (estimates: about 3,000 A at 250 V on starting). */
const START_R = { stop: Infinity, ser1: 0.075, ser2: 0.03, ser3: 0, par1: 0.02, par2: 0 };

export class Battery {
  constructor(name, soc = 0.95) {
    this.name = name;
    this.cells = BATTERY.cells;
    const { C, c } = KIBAM;
    this.q1 = c * C * soc;            // available charge (Ah)
    this.q2 = (1 - c) * C * soc;      // bound charge
    this.I = 0;                       // + discharge (A)
    this.V = 0;
    this.T = 30;                      // electrolyte temperature (C)
    this.h2 = 0;                      // hydrogen given off this step (mol/s)
    this.ah = 0;                      // ampere-hours out since the start (+) or in (-)
  }
  get soc() { return (this.q1 + this.q2) / KIBAM.C; }
  get available() { return this.q1 / (KIBAM.c * KIBAM.C); }
  /** Specific gravity of the electrolyte: 1.250 charged, about 1.100 flat. */
  get sg() { return 1.100 + 0.150 * Math.max(0, Math.min(1, this.soc)); }
  /** Open-circuit EMF of the battery. As the available charge runs out the voltage falls away. */
  get emf() {
    const cell = this.sg + 0.84 - 0.25 * Math.max(0, 0.15 - this.available) / 0.15;
    return this.cells * cell;
  }
  /** Internal resistance (rises as the cells cool and as they run down). */
  get R() { return this.cells * R_CELL * (1 + 0.012 * Math.max(0, 25 - this.T)) * (1 + 0.6 * Math.max(0, 0.3 - this.soc)); }

  /** Advance the two wells by dt (s) at the current I. */
  step(dt) {
    const { C, c, k } = KIBAM;
    const h = dt / 3600;
    const h1 = this.q1 / c, h2 = this.q2 / (1 - c);
    const flow = k * (h2 - h1) * h;
    // charging fills the available well; past full the excess only gasses
    let I = this.I;
    const gasV = 2.35 * this.cells;
    let gasFrac = 0;
    if (I < 0) {
      // charge acceptance falls off near full and above the gassing voltage
      gasFrac = Math.min(1, Math.max(0, (this.V - gasV) / (0.25 * this.cells)) + Math.max(0, this.soc - 0.9) * 6);
      gasFrac = Math.min(0.95, gasFrac);
      this.h2 = (-I * gasFrac) * 0.0376 / 2.016 / 3600;          // mol/s of H2
    } else this.h2 = 0;
    const dq = I * h * (I < 0 ? 1 - gasFrac : 1);
    this.q1 = Math.max(0, Math.min(c * C, this.q1 - dq + flow));
    this.q2 = Math.max(0, Math.min((1 - c) * C, this.q2 - flow));
    this.ah += I * h;
    // the electrolyte warms with the I^2 R losses and cools to the hull
    this.T += dt * (I * I * this.R / (2.4e7) - (this.T - 24) / 20000);
  }
}

/** A DC machine's EMF constant from its rating: E = K phi omega. */
const MOTOR_K = (MAIN_MOTOR.volts - MAIN_MOTOR.amps * 0.005) / (MAIN_MOTOR.rpm * Math.PI / 30);   // V/(rad/s) at full field
const MOTOR_R = 0.005;                // ohm, armature with interpoles (estimate)
const GEN_R = 0.004;
const GEN_K = (MAIN_GENERATOR.volts + MAIN_GENERATOR.amps * GEN_R) / (MAIN_GENERATOR.rpm * Math.PI / 30);
const AUXGEN_K = (AUX_ENGINE.volts + AUX_ENGINE.amps * 0.01) / (AUX_ENGINE.rpm * Math.PI / 30);

export class ElectricPlant {
  constructor() {
    this.batteries = { fwd: new Battery('Forward battery', 0.92), aft: new Battery('After battery', 0.92) };
    // the cubicle (as the crew leave it alongside: everything off)
    this.c = {
      reverse: { port: 'off', stbd: 'off' },
      starter: { port: 'stop', stbd: 'stop' },
      gen: ['off', 'off', 'off', 'off'],          // generators 1..4 (1 and 3 starboard, 2 and 4 port)
      batSel: 'both',
      busSel: 'off',
      genField: [0, 0, 0, 0],                     // 0..1
      motorField: { port: 1, stbd: 1 },           // 0.45..1 (weak field: faster)
      auxGen: false,                              // the auxiliary generator on the line
      auxField: 0.8,
    };
    this.genOmega = [0, 0, 0, 0];                 // engine speeds (rad/s), set by the engines
    this.auxOmega = 0;
    this.auxLoad = 45e3;                          // W: lighting, ventilation, gyro, radio, galley, refrigeration (set by the boat)
    this.out = { VB: 0, VP: 0, VS: 0, Imotor: { port: 0, stbd: 0 }, Igen: [0, 0, 0, 0], Ibat: { fwd: 0, aft: 0 }, Iaux: 0, Tshaft: { port: 0, stbd: 0 }, Tgen: [0, 0, 0, 0], Tauxgen: 0, trip: null };
    this.trips = { port: 0, stbd: 0 };            // overload timers
    this.breakers = { port: true, stbd: true };   // motor circuit breakers (an overload opens them)
  }

  /** Motor field factor phi (0.45..1 by the rheostat), with the series winding strengthening it under load. */
  _phi(side, I) { return Math.max(0.45, Math.min(1, this.c.motorField[side])) * (1 + 0.08 * Math.min(2, Math.abs(I) / MAIN_MOTOR.amps)); }

  /**
   * Solve the network for the shaft speeds (rad/s of the propeller shafts), and return the
   * torques. shaftOmega: { port, stbd }.
   */
  solve(shaftOmega) {
    const c = this.c, o = this.out;
    const bats = [];
    if (c.batSel === 'fwd' || c.batSel === 'both') bats.push(this.batteries.fwd);
    if (c.batSel === 'aft' || c.batSel === 'both') bats.push(this.batteries.aft);
    // nodes: 0 battery bus, 1 port motor bus, 2 starboard motor bus; merged by the bus selector
    const node = [0, 1, 2];
    if (c.busSel === 'tieClosed') node[2] = 1;
    if (c.busSel === 'batBus' || c.busSel === 'slow') { node[1] = 0; node[2] = 0; }
    const motorsLive = c.busSel !== 'off';
    // elements: { n (node), E, R }  current out of the node into the element = (V - E) / R
    const el = [];
    for (const b of bats) el.push({ kind: 'bat', b, n: node[0], E: b.emf, R: b.R });
    for (let g = 0; g < 4; g++) {
      if (c.gen[g] === 'off') continue;
      const side = g % 2 === 0 ? 2 : 1;                   // 1 and 3 starboard, 2 and 4 port
      const n = c.gen[g] === 'batBus' ? node[0] : node[side];
      el.push({ kind: 'gen', g, n, E: GEN_K * Math.max(0, Math.min(1, c.genField[g])) * this.genOmega[g], R: GEN_R });
    }
    if (c.auxGen) el.push({ kind: 'aux', n: node[0], E: AUXGEN_K * c.auxField * this.auxOmega, R: 0.012 });
    // motors: a pair per side; SLOW puts all four in series across the battery bus
    const motorEl = {};
    if (motorsLive && c.busSel !== 'slow') {
      for (const side of ['port', 'stbd']) {
        const dir = c.reverse[side] === 'ahead' ? 1 : c.reverse[side] === 'astern' ? -1 : 0;
        const st = c.starter[side];
        if (!dir || st === 'stop' || !this.breakers[side]) continue;
        const wm = shaftOmega[side] * RATIO * dir;          // motor speed in the sense of the connection
        const phi = this._phi(side, this.out.Imotor[side]);
        const Em = MOTOR_K * phi * wm;
        const series = st.startsWith('ser');
        const E = series ? 2 * Em : Em;
        const R = series ? 2 * MOTOR_R + START_R[st] : MOTOR_R / 2 + START_R[st] / 2;
        const e = { kind: 'motor', side, dir, series, phi, n: node[side === 'port' ? 1 : 2], E, R };
        el.push(e); motorEl[side] = e;
      }
    } else if (c.busSel === 'slow') {
      const dP = c.reverse.port === 'ahead' ? 1 : c.reverse.port === 'astern' ? -1 : 0;
      const dS = c.reverse.stbd === 'ahead' ? 1 : c.reverse.stbd === 'astern' ? -1 : 0;
      if (dP && dS && c.starter.port !== 'stop' && c.starter.stbd !== 'stop') {
        const phiP = this._phi('port', this.out.Imotor.port), phiS = this._phi('stbd', this.out.Imotor.stbd);
        const E = 2 * MOTOR_K * (phiP * shaftOmega.port * RATIO * dP + phiS * shaftOmega.stbd * RATIO * dS);
        const e = { kind: 'slow', dP, dS, phiP, phiS, n: node[0], E, R: 4 * MOTOR_R + START_R[c.starter.port] };
        el.push(e); motorEl.slow = e;
      }
    }
    // Kirchhoff: for each distinct node, sum (E - V)/R = load current. Nodes are independent
    // (no element joins two nodes): each solves on its own.
    const V = {};
    for (const n of new Set(node)) {
      let G = 0, J = 0;
      for (const e of el) if (e.n === n && isFinite(e.R)) { G += 1 / e.R; J += e.E / e.R; }
      // the auxiliary load hangs on the battery bus: P = V I, linearised about the last voltage
      if (n === node[0] && G > 0) {
        const V0 = Math.max(150, o.VB || 250);
        J -= this.auxLoad / V0;
      }
      V[n] = G > 0 ? Math.max(0, J / G) : 0;
    }
    // currents and torques
    o.Ibat.fwd = o.Ibat.aft = 0; o.Igen = [0, 0, 0, 0]; o.Iaux = 0;
    o.Tgen = [0, 0, 0, 0]; o.Tauxgen = 0;
    o.Imotor.port = o.Imotor.stbd = 0; o.Tshaft.port = o.Tshaft.stbd = 0;
    for (const e of el) {
      const I = (e.E - V[e.n]) / e.R;                       // out of the element into the node
      if (e.kind === 'bat') { e.b.I = I; e.b.V = V[e.n]; o.Ibat[e.b === this.batteries.fwd ? 'fwd' : 'aft'] = I; }
      else if (e.kind === 'gen') { o.Igen[e.g] = I; o.Tgen[e.g] = GEN_K * Math.max(0, Math.min(1, c.genField[e.g])) * I; }
      else if (e.kind === 'aux') { o.Iaux = I; o.Tauxgen = AUXGEN_K * c.auxField * I; }
      else if (e.kind === 'motor') {
        const Ia = -I;                                        // into the motors
        const Im = e.series ? Ia : Ia / 2;                    // each motor's armature current
        o.Imotor[e.side] = Ia;
        // both motors on the shaft through the reduction gear
        o.Tshaft[e.side] = e.dir * 2 * MOTOR_K * e.phi * Im * RATIO;
      } else if (e.kind === 'slow') {
        const Ia = -I;
        o.Imotor.port = o.Imotor.stbd = Ia;
        o.Tshaft.port = e.dP * 2 * MOTOR_K * e.phiP * Ia * RATIO;
        o.Tshaft.stbd = e.dS * 2 * MOTOR_K * e.phiS * Ia * RATIO;
      }
    }
    for (const b of Object.values(this.batteries)) if (!bats.includes(b)) { b.I = 0; b.V = b.emf; }
    o.VB = V[node[0]] ?? 0; o.VP = V[node[1]] ?? 0; o.VS = V[node[2]] ?? 0;
    return o;
  }

  /** Overload protection: a side's breaker opens after 4 s above twice the motors' rating. */
  protect(dt) {
    for (const side of ['port', 'stbd']) {
      const I = Math.abs(this.out.Imotor[side]);
      const limit = 2 * MAIN_MOTOR.amps * (this.c.starter[side].startsWith('par') ? 2 : 1);
      if (I > limit) this.trips[side] += dt; else this.trips[side] = Math.max(0, this.trips[side] - dt);
      if (this.trips[side] > 4 && this.breakers[side]) { this.breakers[side] = false; this.out.trip = `${side} motors' breaker opened on overload`; }
    }
  }

  step(dt) {
    for (const b of Object.values(this.batteries)) b.step(dt);
    this.protect(dt);
  }
}

export { MOTOR_K, GEN_K, RATIO, MOTOR_R };
