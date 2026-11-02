/**
 * The car as a running machine: its parts' conditions (car/assembly.js) turned into what the engine
 * gets (sim/engine.js), the battery and charging, the warning lamps, the fault memory, the fluids,
 * the tyres losing air, and what a driver would notice on a drive round the block.
 *
 * What the instruments read is only what the car would really tell you:
 *  - the Golf (2016) has OBD-II: P-codes with freeze-frame-free descriptions, live data, misfire
 *    counters per cylinder, and the electric parking brake's service mode;
 *  - the Volvo (1990) has none of that: its LH-Jetronic 2.4 and EZ-116K control units flash three
 *    digit codes on the diagnostic unit in the engine bay, and know nothing of misfires. A dead
 *    cylinder there is found the old way: listen, then pull the leads one at a time with the
 *    engine running and hear which makes no difference;
 *  - the F1 car talks to a laptop over its own telemetry.
 */
import { Engine } from './engine.js';

const LH_CODES = {
  '1-1-1': 'No faults stored', '1-2-1': 'Air mass meter signal missing or faulty', '1-2-3': 'Coolant temperature sensor signal missing or faulty',
  '2-1-2': 'Lambda (oxygen) sensor signal missing or faulty', '2-3-1': 'Lambda control: too lean or rich at part load', '2-3-2': 'Lambda control: too lean or rich at idle',
};
const EZK_CODES = { '1-1-1': 'No faults stored', '1-4-2': 'Control unit internal fault', '1-4-3': 'Knock sensor signal', '1-4-4': 'Load signal missing', '2-1-4': 'Engine speed signal intermittent', '2-2-4': 'Coolant temperature sensor signal' };
export const OBD_TEXT = {
  P0300: 'Random/multiple cylinder misfire detected', P0301: 'Cylinder 1 misfire detected', P0302: 'Cylinder 2 misfire detected', P0303: 'Cylinder 3 misfire detected', P0304: 'Cylinder 4 misfire detected',
  P0351: 'Ignition coil A primary/secondary circuit', P0352: 'Ignition coil B primary/secondary circuit', P0353: 'Ignition coil C primary/secondary circuit', P0354: 'Ignition coil D primary/secondary circuit',
  P0171: 'System too lean (bank 1)', P0130: 'O2 sensor circuit (bank 1 sensor 1)', P0134: 'O2 sensor circuit no activity detected (bank 1 sensor 1)',
  P0128: 'Coolant temperature below thermostat regulating temperature', P0562: 'System voltage low', P0620: 'Generator control circuit',
  B1046: 'Dipped beam bulb, left: open circuit', B1047: 'Dipped beam bulb, right: open circuit', B1050: 'Brake light bulb: open circuit',
  C0040: 'Tyre pressure monitoring: pressure loss detected', U0415: 'Invalid data received from ABS control module',
};

export class CarSim {
  constructor(A) {
    this.A = A;
    this.spec = A.spec;
    this.E = new Engine(A.spec);
    this.volts = 12.5;
    this.dtcs = new Map();         // code -> { since, count, active }
    this.time = 0;
    this.lamps = {};
    this.rpmHist = [];
    this.oilSpilt = 0;            // litres that went somewhere other than a drain pan
    this.oilCaught = 0;
    this.drainPan = false;        // set by the world: a pan under the drain plug
    this.airInBrakes = { FL: 0, FR: 0, RL: 0, RR: 0 };
    this.wheelSpin = { FL: 0, FR: 0, RL: 0, RR: 0 };
    this.squeal = 0;
    this.blink = null;            // the Volvo's LED sequence being flashed
    this.engineMinutes = 0;
    this.f1warm = 25;
    A.onChange = (id, what) => this._changed(id, what);
  }

  get P() { return this.A.parts; }
  part(id) { return this.A.parts.get(id); }
  on(id) { return this.A.installed(id); }

  // ---- what the engine gets from the parts --------------------------------------------------

  _io(controls) {
    const A = this.A, s = this.spec, n = s.engine.cyl, st = A.state, volvo = s.id === 'volvo240', f1 = !!st.f1;
    const spark = [], comp = [];
    const capOK = !volvo || (this.on('distcap') && this.on('rotor'));
    const capF = volvo && this.on('distcap') && this.part('distcap').cond.cracked ? 0.86 : 1;
    const rotorF = volvo && this.on('rotor') && this.part('rotor').cond.worn ? 0.94 : 1;
    const load = controls.throttle ?? 0;
    for (let i = 1; i <= n; i++) {
      let p = 1;
      if (f1) { spark.push(1); comp.push(A.part('engine').cond.comp[i - 1]); continue; }
      const plug = this.part('plug' + i);
      const plugIn = this.on('plug' + i) && !A.fast(`plug${i}.thread`).out;
      if (!plugIn) { spark.push(0); comp.push(0.05); continue; }
      const c = plug.cond;
      if (c.fouled) p *= 0.45;
      if (c.cracked) p *= 0.6;
      if (c.gap > c.spec + 0.3) p *= 1 - Math.min(0.5, (c.gap - c.spec - 0.3) * 0.8 * (0.3 + load));
      if (volvo) {
        if (!this.on('lead' + i) || !this.part('lead' + i).cond.ok) p = 0;
        if (!capOK) p = 0;
        p *= capF * rotorF;
      } else if (!this.on('coil' + i) || !this.part('coil' + i).cond.ok) p = 0;
      spark.push(p);
      comp.push(A.part('engine').cond.comp[i - 1]);
    }
    const fuseOK = (no) => !this.part('fuse' + no) || (this.on('fuse' + no) && this.part('fuse' + no).cond.ok);
    let unmetered = 0;
    if (this.on('vachose') === false || this.part('vachose')?.cond.split) unmetered += 1.4;
    if (volvo && !this.on('amm')) unmetered += 8;
    if (!this.on('oilcap')) unmetered += volvo ? 0.6 : 0.4;
    if (!this.on('dipstick')) unmetered += 0.15;
    const battOn = f1 || (this.on('battery') && !A.fast('battery.neg').out && !A.fast('battery.pos').out);
    this.battConnected = battOn;
    const ign = battOn && st.ignition >= 2 && (volvo ? fuseOK('2') : f1 ? true : fuseOK('SC17'));
    const thermo = this.part('thermostat');
    return {
      volts: this.volts, ignition: ign, starter: battOn && st.ignition === 3 && this.on('starter') && this.part('starter')?.cond.ok && this.part('starter')?.cond.solenoid,
      throttle: load, spark, comp, unmetered,
      ammOk: !volvo || (this.on('amm') && this.part('amm').cond.ok), o2Ok: f1 || (this.on('o2sensor') && this.part('o2sensor').cond.ok),
      fuelOk: f1 ? st.fuelPump !== false : volvo ? fuseOK('2') : true,
      fanOn: this.E.coolant > (s.engine.coolant.thermostat + 8),
      thermo: !thermo || !this.on('thermostat') ? 1 : thermo.cond.stuckOpen ? 1 : thermo.cond.stuckShut ? 0 : null,
      opens: s.engine.coolant.thermostat,
      coolantLevel: f1 ? 1 : this.part('exptank').cond.level, radiator: 1,
      oilLevel: this.part('engine').cond.oil / s.engine.oil.capacity,
      load: this._altLoad(),
      f1: f1 ? { starterTool: st.externalStarter, warm: this.f1warm > 45 } : null,
    };
  }

  _altLoad() {
    if (!this.E.running || this.spec.engine.mguk) return 0;
    const belt = this.on('belt');
    return belt ? 1.6 + (this.chargeA ?? 0) * 0.04 : 0;
  }

  // ---- each step -------------------------------------------------------------------------------

  /** controls: { throttle (0..1) }; dt in seconds of game time. */
  step(dt, controls = {}) {
    const A = this.A, st = A.state;
    this.time += dt;
    const io = this._io(controls);
    this.io = io;
    // the F1 car: the heater cart warms its water and oil before it may be started
    if (st.f1) { if (st.heaterCart) this.f1warm = Math.min(65, this.f1warm + dt * 0.3); this.E.coolant = Math.max(this.E.coolant, this.f1warm); this.E.oilT = Math.max(this.E.oilT, this.f1warm); }
    this.E.step(dt, io);
    if (this.E.running) this.engineMinutes += dt / 60;
    this._electrical(dt, io);
    this._fluids(dt);
    this._tyres(dt);
    this._dtcs(dt, io);
    this._lamps(io);
    // the speed trace for roughness (the shake you see and the gauge needle's flicker)
    this.rpmHist.push(this.E.rpm); if (this.rpmHist.length > 60) this.rpmHist.shift();
    if (this.blink) this._blink(dt);
    // brakes dragging on a seized caliper, wheels spun by hand on the lift
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const w = this.wheelSpin[k];
      if (!w) continue;
      const drag = this.drag(k);
      const I = 1.1;
      const dw = (drag / I) * dt;
      this.wheelSpin[k] = Math.abs(w) <= dw ? 0 : w - Math.sign(w) * dw;
    }
  }

  /** How rough the engine is running: the spread of crank speed (rpm) over the last frames. */
  get roughness() {
    const h = this.rpmHist; if (h.length < 5 || !this.E.running) return 0;
    const m = h.reduce((a, b) => a + b, 0) / h.length;
    return Math.sqrt(h.reduce((a, b) => a + (b - m) ** 2, 0) / h.length);
  }

  _electrical(dt, io) {
    const A = this.A, st = A.state;
    if (st.f1) { this.volts = 12.8; return; }
    const b = this.part('battery');
    if (!this.on('battery')) { this.volts = 0; return; }
    const c = b.cond;
    const ocv = 11.8 + 0.85 * Math.max(0, Math.min(1, c.soc));
    const R = (0.009 / Math.max(0.15, c.soh)) * (c.sulfated ? 3 : 1);
    let load = (st.ignition >= 2 ? 7 : st.ignition === 1 ? 2 : 0.03) + (this.E.coolant > this.spec.engine.coolant.thermostat + 8 ? 14 : 0);
    load += this.E.starterAmps ?? 0;
    // the alternator: regulated to 14.2 V once it spins fast enough, if it works, and if its belt drives it
    const alt = this.part('alternator');
    const belt = this.part('belt');
    const altRpm = this.E.rpm * 2.6 * (this.on('belt') ? (belt.cond.glazed ? 0.8 : 1) : 0);
    const canCharge = this.E.running && this.on('alternator') && alt.cond.ok && this.on('belt') && altRpm > 1600 && this.battConnected;
    if (canCharge) {
      const maxA = (alt.cond.output ?? 1) * 70 * Math.min(1, (altRpm - 1600) / 2500 + 0.4);
      const want = (14.2 - ocv) / R + load;
      const I = Math.min(maxA, Math.max(0, want));
      this.chargeA = I;
      this.volts = ocv + (I - load) * R;
      c.soc = Math.min(1, c.soc + ((I - load) * dt) / (this.spec.battery.ah * 3600 * Math.max(0.2, c.soh)));
      this.squeal = belt.cond.glazed && this.E.rpm > 1500 ? 1 : 0;
    } else {
      this.chargeA = 0;
      this.volts = Math.max(0, this.battConnected ? ocv - load * R : ocv);
      c.soc = Math.max(0, c.soc - (load * dt) / (this.spec.battery.ah * 3600 * Math.max(0.2, c.soh)));
      this.squeal = 0;
    }
  }

  _fluids(dt) {
    const A = this.A, st = A.state;
    if (st.f1) return;
    const eng = this.part('engine').cond, cap = this.spec.engine.oil.capacity;
    // the drain plug out: oil runs out of the hole, faster hot (thinner), slowing as the sump empties
    const dp = A.fast('drainplug.plug');
    if (dp?.out && eng.oil > 0.05) {
      const visc = 0.25 + 0.75 * Math.min(1, Math.max(0, (this.E.oilT - 10) / 70));
      const q = Math.min(eng.oil, (0.035 + 0.06 * Math.sqrt(eng.oil / cap)) * visc * dt);
      eng.oil -= q;
      if (this.drainPan) this.oilCaught += q; else this.oilSpilt += q;
      this.draining = q / dt;
    } else this.draining = 0;
    // the oil filter off: what was in it comes out (about 0.3 l)
    if (!this.on('oilfilter') && !this._filterSpilt) { this._filterSpilt = true; const q = Math.min(eng.oil, 0.3); eng.oil -= q; if (this.drainPan) this.oilCaught += q; else this.oilSpilt += q; }
    if (this.on('oilfilter')) this._filterSpilt = false;
    // running with the drain plug out or the filter off pumps oil out fast
    if (this.E.running && (dp?.out || !this.on('oilfilter'))) eng.oil = Math.max(0, eng.oil - dt * 0.05);
    // coolant out through the thermostat housing
    if (!this.on('thermohousing')) { const t = this.part('exptank').cond; t.level = Math.max(0.1, t.level - dt * 0.02); }
    // a split brake hose or a caliper off its hose leaks; with the reservoir low, air gets in
    const res = this.part('reservoir').cond;
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const h = this.part('hose' + k);
      if (h?.cond.leak) { res.level = Math.max(0, res.level - dt * 0.0004 * (st.brakePedal > 0.5 ? 6 : 1)); }
    }
    if (res.level < 0.25) for (const k in this.airInBrakes) this.airInBrakes[k] = Math.max(this.airInBrakes[k], 0.6);
  }

  _tyres(dt) {
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const w = this.part('wheel' + k);
      if (!w || w.removed) continue;
      const c = w.cond;
      if (c.leak > 0) c.bar = Math.max(0, c.bar - (c.leak * dt) / 3600 * Math.max(0.2, c.bar / 2.2));
    }
  }

  _changed(id, what) {
    const p = this.part(id);
    if (!p) return;
    // a caliper off its hose (only the floating ones' pistons get pushed back; the hose stays on) – replaced calipers need bleeding
    if (p.kind === 'caliper' && what === 'installed' && p.installedNew) this.airInBrakes[p.corner] = 1;
    if (p.kind === 'battery' && what === 'removed') { this.dtcs.clear(); this.E.trimLT = 0; }
  }

  _dtcs(dt, io) {
    const s = this.spec, E = this.E;
    const set = (code) => { const d = this.dtcs.get(code); if (d) { d.count++; d.active = true; } else this.dtcs.set(code, { since: this.time, count: 1, active: true }); };
    if (s.engine.diag === 'OBD2') {
      if (E.running && E.misfireRate) {
        const bad = E.misfireRate.map((r, i) => (r > 0.04 ? i + 1 : 0)).filter(Boolean);
        for (const c of bad) set('P030' + c);
        if (bad.length > 1) set('P0300');
      }
      for (let i = 1; i <= 4; i++) if (io.ignition && this.on('coil' + i) && !this.part('coil' + i).cond.ok) set('P035' + i);
      if (E.running && E.coolant > 40 && E.trimST + E.trimLT > 20) set('P0171');
      if (io.ignition && !io.o2Ok) set(this.on('o2sensor') ? 'P0134' : 'P0130');
      if (E.running && this.engineMinutes > 12 && E.coolant < 70) set('P0128');
      if (E.running && this.volts < 11.6) set('P0562');
      if (E.running && (!this.part('alternator').cond.ok || !this.on('belt'))) set('P0620');
      if (io.ignition && this.on('bulbL') === false || (io.ignition && !this.part('bulbL').cond.ok)) set('B1046');
      if (io.ignition && this.on('bulbR') === false || (io.ignition && !this.part('bulbR').cond.ok)) set('B1047');
      if (this._tpms()) set('C0040');
    } else if (s.engine.diag === 'LH2.4') {
      if (io.ignition && !io.ammOk) set('LH:1-2-1');
      if (io.ignition && !io.o2Ok && E.coolant > 40 && E.running) set('LH:2-1-2');
      if (E.running && E.coolant > 40) {
        const t = E.trimST + E.trimLT;
        if (Math.abs(t) > 18 && (io.throttle ?? 0) < 0.05) set('LH:2-3-2');
        if (Math.abs(t) > 18 && (io.throttle ?? 0) >= 0.05) set('LH:2-3-1');
      }
    }
  }

  _tpms() { return this.spec.id === 'golf7' && ['FL', 'FR', 'RL', 'RR'].some((k) => this.part('wheel' + k).cond.bar < this.spec.wheels.pressure[k[0]] * 0.78); }

  _lamps(io) {
    const E = this.E, st = this.A.state, on = io.ignition;
    const oilP = E.oilPressure(io.oilLevel);
    const misfire = E.running && E.misfireRate && E.misfireRate.some((r) => r > 0.1);
    this.lamps = {
      battery: on && !(this.chargeA > 0) && !st.f1,
      oil: on && oilP < 0.3 && !st.f1,
      engine: on && (!E.running ? true : [...this.dtcs.keys()].some((c) => /^P0|^LH/.test(c) && this.dtcs.get(c).active)),
      engineFlash: misfire && this.spec.engine.diag === 'OBD2',
      brake: on && (this.part('reservoir')?.cond.level < 0.35 || st.handbrake),
      tpms: on && this._tpms(),
      epb: on && st.epbService,
      bulb: on && this.spec.id === 'golf7' && ['bulbL', 'bulbR', 'brakebulbL', 'brakebulbR'].some((b) => !this.on(b) || !this.part(b).cond.ok),
    };
    this.gauges = { rpm: E.rpm, coolant: E.coolant, oilP, volts: this.volts, fuel: this.part('tank')?.cond.fuel ?? 0.5 };
  }

  /** The drag (N·m) on a wheel spun by hand on the lift: pads lightly rubbing, a seized caliper, a rough bearing. */
  drag(k) {
    let d = 1.2;
    const cal = this.part('caliper' + k);
    if (cal && !cal.removed && cal.cond.seized) d += 45;
    const hub = this.part('hub' + k);
    if (hub?.cond.rough) d += hub.cond.rough * 3;
    if (this.spec.drive === 'FWD' && k[0] === 'F' && this.A.state.gear) d += 400;
    if (this.spec.drive === 'RWD' && k[0] === 'R' && this.A.state.gear) d += 400;
    if (k[0] === 'R' && this.A.state.handbrake) d += 600;
    return d;
  }

  // ---- the instruments ---------------------------------------------------------------------------

  /** The OBD-II scan tool: what it shows on its screen. */
  scan() {
    if (this.spec.engine.diag !== 'OBD2') return { error: this.spec.id === 'volvo240' ? 'No OBD-II socket: this car is from 1990. Use the diagnostic unit in the engine bay (blink codes).' : 'This car speaks only to its team\'s telemetry laptop.' };
    if (!this.battConnected) return { error: 'No power at the socket (pin 16): the battery is disconnected.' };
    if (this.A.state.ignition < 2) return { error: 'Turn the ignition on (position II) to talk to the control units.' };
    const E = this.E;
    return {
      codes: [...this.dtcs.entries()].map(([c, d]) => ({ code: c, text: OBD_TEXT[c] ?? 'Manufacturer-specific code', status: d.active ? 'active' : 'stored', count: d.count })),
      live: { 'Engine speed': `${E.rpm.toFixed(0)} rpm`, 'Coolant temperature': `${E.coolant.toFixed(0)} °C`, 'Short-term fuel trim': `${E.trimST.toFixed(1)} %`, 'Long-term fuel trim': `${E.trimLT.toFixed(1)} %`,
        'Lambda': E.running ? E.lambda.toFixed(2) : '—', 'Battery voltage': `${this.volts.toFixed(2)} V`, 'Oil temperature': `${E.oilT.toFixed(0)} °C`, 'Throttle / idle air': `${(E.idleAir * 100).toFixed(0)} %`,
        ...Object.fromEntries((E.misfireRate ?? [0, 0, 0, 0]).map((r, i) => [`Misfires cyl ${i + 1} (per 100)`, `${Math.round(r * 100)}`])) },
      epb: this.spec.brakes.epb ? (this.A.state.epbService ? 'Service mode: rear pistons wound back' : 'Normal') : null,
    };
  }
  clearCodes() { for (const [k, d] of this.dtcs) { if (!d.active || !this._stillTrue(k)) this.dtcs.delete(k); else d.count = 1; } for (const d of this.dtcs.values()) d.active = false; this.E.trimLT = 0; }
  _stillTrue(code) { return false; }
  setEpbService(on) { if (!this.spec.brakes.epb) return false; this.A.state.epbService = on; if (!on) this.A.state.handbrake = true; return true; }

  /** The Volvo's diagnostic unit: press the button (socket 2: fuel, 6: ignition) and the LED flashes the next code. */
  pressDiag(socket = 2) {
    if (this.A.state.ignition < 2) return { error: 'Ignition on first (the LED lights while you hold the button).' };
    const prefix = socket === 2 ? 'LH:' : 'EZ:';
    const codes = [...this.dtcs.keys()].filter((c) => c.startsWith(prefix)).map((c) => c.slice(3));
    this._diagIdx = ((this._diagIdx ?? -1) + 1) % (codes.length + 1);
    const code = this._diagIdx < codes.length ? codes[this._diagIdx] : '1-1-1';
    this.blink = { seq: code.split('-').map(Number), i: 0, n: 0, t: 0, on: false };
    return { code, text: (socket === 2 ? LH_CODES : EZK_CODES)[code] ?? 'unknown code' };
  }
  _blink(dt) {
    const b = this.blink; b.t += dt;
    const cycle = b.on ? 0.35 : b.n === 0 && b.i > 0 && b.t < 1.4 ? 1.4 : 0.45;
    if (b.t < cycle) return;
    b.t = 0;
    if (!b.on) { if (b.i >= b.seq.length) { this.blink = null; return; } b.on = true; }
    else { b.on = false; b.n++; if (b.n >= b.seq[b.i]) { b.n = 0; b.i++; } }
  }
  get diagLed() { return !!this.blink?.on; }

  /** The multimeter across the battery's terminals (V). */
  batteryVolts() { return this.on('battery') ? this.volts : null; }

  /** Dipstick: where the oil reaches, 0 (MIN) .. 1 (MAX), and how it looks. */
  dipstick() {
    const cap = this.spec.engine.oil.capacity, oil = this.part('engine').cond.oil;
    const lvl = (oil - (cap - 1.0)) / 1.0;
    const age = this.part('engine').cond.oilAge;
    return { level: lvl, text: lvl < -0.05 ? 'below MIN (the stick comes out nearly dry)' : lvl < 0.15 ? 'at MIN' : lvl < 0.85 ? `between MIN and MAX (${Math.round(lvl * 100)} %)` : lvl <= 1.1 ? 'at MAX' : 'above MAX: overfilled', colour: age > 15000 ? 'black and thin' : age > 8000 ? 'dark brown' : 'clear amber' };
  }

  /** Brake fluid tester pen in the reservoir: water content, % */
  fluidWater() { return this.part('reservoir').cond.water; }

  // ---- a drive round the block --------------------------------------------------------------------

  /**
   * What a driver would notice on a 10-minute drive (and the dealer's road test before handing the
   * car back): a list of { what, who } where who is 'driver' (anyone notices) or 'mechanic'.
   */
  roadTest() {
    const A = this.A, s = this.spec, o = [];
    const say = (what, sev = 1) => o.push({ what, sev });
    const missing = [...A.parts.values()].filter((p) => p.removed && !p.fixed);
    if (missing.some((p) => p.kind === 'wheel')) return [{ what: 'The car is missing a wheel. It cannot be driven.', sev: 5 }];
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const W = A.part('wheel' + k), nuts = W.fasteners.map((f) => A.fast(f));
      const loose = nuts.filter((f) => f.out || f.clamp < f.spec * 0.5).length;
      if (loose >= 2) say(`A loud knocking from the ${cornerName(k)} wheel that gets worse with every turn; the wheel is working loose.`, 5);
      else if (loose === 1) say(`A faint click from the ${cornerName(k)} wheel at walking pace.`, 3);
      const c = W.cond;
      if (c.bar < s.wheels.pressure[k[0]] * 0.6) say(`The car pulls towards the ${k[1] === 'L' ? 'left' : 'right'} and the steering feels heavy and vague (the ${cornerName(k)} tyre is soft).`, 3);
      if (c.imbalance > 25) say(`A vibration through the ${k[0] === 'F' ? 'steering wheel' : 'seat'} between 90 and 110 km/h.`, 2);
      const pads = ['padI', 'padO'].map((p) => A.part(p + k)).filter(Boolean);
      if (pads.some((p) => p.removed)) say(`The brake pedal sinks: the ${cornerName(k)} brake has no pads.`, 5);
      else {
        const mm = Math.min(...pads.map((p) => p.cond.mm));
        if (mm < 1.5) say(`A harsh metallic grinding from the ${cornerName(k)} wheel when braking (metal on metal).`, 4);
        else if (mm < 3 && pads.some((p) => p.cond.squealer)) say(`A high squeal from the ${cornerName(k)} wheel when braking lightly (the wear indicator).`, 2);
      }
      const disc = A.part('disc' + k);
      if (disc && !disc.removed && disc.cond.runout > 0.06) say(`The steering wheel shudders when braking from speed${k[0] === 'R' ? ', felt in the brake pedal' : ''}.`, 2);
      const cal = A.part('caliper' + k);
      if (cal && !cal.removed && cal.cond.seized) say(`The car pulls to the ${k[1] === 'L' ? 'left' : 'right'} when braking, and afterwards the ${cornerName(k)} wheel is very hot and smells of burning brakes.`, 3);
      if (this.airInBrakes[k] > 0.3) say('The brake pedal is soft and goes a long way down before the brakes bite.', 4);
      const hub = A.part('hub' + k);
      if (hub && (hub.cond.rough > 0.3 || hub.cond.play > 0.1)) say(`A droning hum from the ${cornerName(k)} that rises with speed and changes when turning.`, 2);
      const link = A.part('link' + k);
      if (link && link.cond.play > 0.5) say(`A clunk from the ${cornerName(k)} over speed bumps and broken tarmac.`, 2);
      const bj = A.part('balljoint' + k);
      if (bj && bj.cond.play > 0.5) say(`A knock from the ${cornerName(k)} over bumps and when braking; the steering wanders.`, 3);
      const boot = A.part('cvboot' + k);
      if (boot && boot.cond.torn) say(boot.cond.grease < 0.4 ? `A clicking from the ${cornerName(k)} on full lock (the outer CV joint, dry).` : `Grease flung round the inside of the ${cornerName(k)} wheel (a torn CV boot).`, 2);
      for (const f of [...(cal?.fasteners ?? []), ...(A.part('carrier' + k)?.fasteners ?? [])].map((id) => A.fast(id))) if (f.out || f.clamp < f.spec * 0.5) { say(`A knock and a scrape from the ${cornerName(k)} brake: something in it is loose.`, 5); break; }
    }
    // the engine
    const io = this.io ?? this._io({});
    const dead = io.spark.map((p, i) => (p < 0.5 ? i + 1 : 0)).filter(Boolean);
    const weak = io.spark.map((p, i) => (p >= 0.5 && p < 0.95 ? i + 1 : 0)).filter(Boolean);
    if (!A.state.f1 && (!this.on('starter') || !this.part('starter').cond.solenoid || !this.part('starter').cond.ok)) say('Turning the key: a single click and nothing (or nothing at all). The engine will not crank.', 5);
    if (this.on('battery') && this.part('battery').cond.soh < 0.45) say('The engine cranks slowly and only just starts, worse in the cold mornings.', 3);
    if (dead.length) say(`The engine shakes at idle and is down on power, chugging when pulling away${s.engine.diag === 'OBD2' ? '; the engine light flashes' : ''}.`, 4);
    else if (weak.length) say('An occasional stumble pulling hard uphill, as if it hiccups.', 2);
    if (io.unmetered > 1) say(s.id === 'volvo240' ? 'The idle hunts up and down and it hesitates pulling away; a hiss under the bonnet.' : 'A hiss under the bonnet at idle; the idle is a little high and the engine light is on.', 2);
    if (!io.o2Ok) say('Fuel economy is worse than it was, and the engine light is on.', 2);
    if (io.thermo === 1 && this.on('thermostat')) say('The temperature gauge stays low and the heater only blows lukewarm air.', 2);
    if (this.part('alternator') && (!this.part('alternator').cond.ok || !this.on('belt'))) say('The battery light comes on while driving; after a while the lights dim and the car dies.', 4);
    if (this.part('belt')?.cond.glazed) say('A squeal from under the bonnet on cold starts and when revving.', 2);
    const dip = this.dipstick();
    if (dip.level < -0.3) say('The oil light flickers on at idle when hot.', 5);
    if (this.part('silencer')?.cond.hole) say('The exhaust is loud and raspy, and there is a blowing noise from under the back.', 2);
    if (this.part('airfilter')?.cond.clog > 0.85) say('Sluggish when accelerating hard.', 1);
    for (const k of ['bulbL', 'bulbR']) if (!this.on(k) || !this.part(k).cond.ok) say(`The ${k === 'bulbL' ? 'left' : 'right'} dipped headlight is out.`, 2);
    for (const k of ['wiperL', 'wiperR']) if (this.part(k)?.cond.wear > 0.8) { say('The wipers smear and judder across the screen.', 1); break; }
    for (const f of this.A.byKind('fuse')) if (!f.cond.ok || f.removed) say(`${f.cond.circuit}: does not work.`, 2);
    for (const it of this.A.items) if (!it.found && it.rattles) say(`Something rattles ${it.whereText}.`, 1);
    const audit = A.audit();
    for (const b of audit.bad) if (b.j !== 'ok' && !/wheel/.test(b.id) && b.torque < b.spec * 0.5) say(`Something is loose: ${b.part} (${b.name}).`, 3);
    if (this.oilSpilt > 0.3) say('A smell of burning oil after driving (oil spilt on the engine or the exhaust).', 1);
    return o;
  }
}

export function cornerName(k) { return { FL: 'front left', FR: 'front right', RL: 'rear left', RR: 'rear right' }[k]; }
