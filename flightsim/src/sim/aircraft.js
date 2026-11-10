/**
 * The whole aeroplane: a rigid body with six degrees of freedom, moved only by forces. Every step it asks the air (aero.js), the
 * propeller, the engine, the undercarriage and gravity what they do to it, adds the gyroscopic effect of the spinning propeller
 * and the engine's torque reaction, and integrates. The pilot's hands and feet come in as forces on the yoke and pedals: the
 * control surfaces go where the balance of pilot force, air load and trim tab puts them, so the controls stiffen with speed and
 * the trim wheel really does take the load off.
 *
 * Mass, centre of gravity and inertia follow the people, bags and fuel on board.
 */
import { DEG, G0, KT, FT, clamp, sat, lag, qrot, qrotInv, quatFromHPB, wrap360, v3 } from './util.js';
import { Aero } from './aero.js';
import { Propeller } from './propeller.js';
import { Powerplant, FuelSystem } from './powerplant.js';
import { Electrical } from './electrical.js';
import { Gear } from './gear.js';
import { Instruments } from './instruments.js';
import { Radios } from './radios.js';
import { c172Config, LIMITS } from './c172.js';

const SUB = 4;
const FLAT = { h: 0, mu: 0.8, rr: 0.02, rough: 0 };
const UP = { x: 0, y: 1, z: 0 };

export class Aircraft {
  constructor({ weather, ground = () => FLAT, nav = { vor: [], ils: [], com: [] }, magVar = 7 }) {
    const cfg = this.cfg = c172Config();
    this.limits = LIMITS;
    this.weather = weather; this.ground = ground;
    this.aero = new Aero(cfg);
    this.prop = new Propeller(cfg.prop);
    this.fuel = new FuelSystem();
    this.eng = new Powerplant(this.prop, this.fuel);
    this.elec = new Electrical();
    this.gear = new Gear(cfg.gear);
    this.inst = new Instruments({ magVar, latitude: weather.latitude });
    this.radios = new Radios(nav, { magVar });
    this.pos = v3(0, 1.3, 0); this.vel = v3(); this.om = v3();
    this.q = { x: 0, y: 0, z: 0, w: 1 }; this.qPrev = { x: 0, y: 0, z: 0, w: 1 }; this.posPrev = v3(0, 1.3, 0);
    this.payload = { pilot: 80, copilot: 0, rear: 0, baggage: 5 };
    this.ctl = {
      pitch: 0, roll: 0, yaw: 0, brakeL: 0, brakeR: 0, parkBrake: true, trim: 0, flapLever: 0, controlLock: true,
      magKey: 0, primer: 0, primerLocked: true, pitotHeat: false, panelLights: 0, radioLights: 0, cabinHeat: 0, cabinAir: 0.3,
      lights: { beacon: false, land: false, taxi: false, nav: false, strobe: false, dome: false },
    };
    this.surf = { flap: 0, ailL: 0, ailR: 0, elev: 0, rudder: 0 };
    this.flapDeg = 0; this.flapMoving = false; this.yoke = { pitch: 0, roll: 0 };
    this.sf = v3(0, G0, 0);                       // specific force, body axes: what an accelerometer (or the pilot's seat) feels
    this.relAir = v3(); this.air = weather.air(0); this.airB = { ref: v3(), c: v3(), gx: v3(), gz: v3() };
    this.time = 0; this.crashed = null; this.horn = 0; this.buffet = 0; this.cabinT = weather.oat; this.gLoad = 1;
    this.mass = 900; this.cg = v3(0, 1.2, 1.0); this.I = new Float64Array(6); this.Ii = new Float64Array(6);
    this._primer = 0; this._t = [v3(), v3(), v3(), v3(), v3(), v3()];
    const c = this.ctl, e = this.elec, L = c.lights;
    e.add('BCN_PITOT', 5, () => L.beacon); e.add('BCN_PITOT', 6.5, () => c.pitotHeat);
    e.add('STROBE', 3, () => L.strobe); e.add('STROBE', 1, () => true, true);
    e.add('LDG_LT', 9, () => L.land); e.add('LDG_LT', 4, () => L.taxi);
    e.add('FLAP', 8.5, () => this.flapMoving);
    e.add('INST', 0.4, () => true); e.add('FUEL_IND', 0.4, () => true);
    e.add('INST_LTS', () => 1.8 * c.panelLights + 0.6 * c.radioLights, () => c.panelLights + c.radioLights > 0.02);
    e.add('NAV_LT', 5.6, () => L.nav); e.add('NAV_LT', 1, () => L.dome);
    e.add('RADIO1', 1.4, () => this.radios.com.on || this.radios.nav.on, true);
    e.add('RADIO2', 1.2, () => this.radios.xpdr.mode >= 1, true);
    this.massProps();
  }

  // ------------------------------------------------------------------------------------------------ mass
  massProps() {
    const c = this.cfg.mass, p = this.payload;
    const items = [[c.empty.m, c.empty.p], [p.pilot, c.seats.pilot], [p.copilot, c.seats.copilot], [p.rear, c.seats.rear],
      [p.baggage, c.seats.baggage], [this.fuel.tank[0], c.tanks[0]], [this.fuel.tank[1], c.tanks[1]]];
    let m = 0, x = 0, y = 0, z = 0;
    for (const [mi, pi] of items) { m += mi; x += mi * pi.x; y += mi * pi.y; z += mi * pi.z; }
    x /= m; y /= m; z /= m;
    let xx = c.empty.I.x, yy = c.empty.I.y, zz = c.empty.I.z, xy = 0, xz = 0, yz = 0;
    for (const [mi, pi] of items) {
      const dx = pi.x - x, dy = pi.y - y, dz = pi.z - z;
      xx += mi * (dy * dy + dz * dz); yy += mi * (dx * dx + dz * dz); zz += mi * (dx * dx + dy * dy);
      xy -= mi * dx * dy; xz -= mi * dx * dz; yz -= mi * dy * dz;
    }
    this.mass = m; this.cg.x = x; this.cg.y = y; this.cg.z = z;
    const I = this.I, J = this.Ii;
    I[0] = xx; I[1] = yy; I[2] = zz; I[3] = xy; I[4] = xz; I[5] = yz;
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    J[0] = (yy * zz - yz * yz) / det; J[1] = (xx * zz - xz * xz) / det; J[2] = (xx * yy - xy * xy) / det;
    J[3] = (xz * yz - xy * zz) / det; J[4] = (xy * yz - xz * yy) / det; J[5] = (xy * xz - xx * yz) / det;
  }
  /** Centre of gravity as a percentage of the mean aerodynamic chord, and the weight in pounds. */
  get cgPercentMac() { return (this.cg.z - 0.66) / this.cfg.mac * 100; }

  // ------------------------------------------------------------------------------------------------ attitude read-outs
  get heading() { const f = qrot(this._t[5], this.q, { x: 0, y: 0, z: -1 }); return wrap360(Math.atan2(f.x, -f.z) / DEG); }
  get pitch() { return Math.asin(clamp(qrot(this._t[5], this.q, { x: 0, y: 0, z: -1 }).y, -1, 1)) / DEG; }
  get bank() { const r = qrot(this._t[5], this.q, { x: 1, y: 0, z: 0 }).y, u = qrot(this._t[4], this.q, UP).y; return Math.atan2(-r, u) / DEG; }
  get tas() { return Math.hypot(this.relAir.x, this.relAir.y, this.relAir.z); }
  get alpha() { return Math.atan2(-this.relAir.y, -this.relAir.z) / DEG; }
  get beta() { const v = this.tas; return v > 1 ? Math.asin(clamp(this.relAir.x / v, -1, 1)) / DEG : 0; }
  get agl() { return this.pos.y - this.cg.y - this.ground(this.pos.x, this.pos.z).h; }
  get altitude() { return this.pos.y - this.cg.y + this.weather.fieldElev; }
  /** World position of the structural origin (what the 3D model is hung on). */
  origin(out = v3()) { const r = qrot(out, this.q, this.cg); out.x = this.pos.x - r.x; out.y = this.pos.y - r.y; out.z = this.pos.z - r.z; return out; }

  // ------------------------------------------------------------------------------------------------ the pilot's controls
  _controls(dt) {
    const h = this.cfg.hinge, t = this.cfg.travel, c = this.ctl, s = this.surf, lock = c.controlLock;
    // elevator: where pilot force, air load on the surface, the trim tab and its own weight balance
    const qSc = Math.max(this.aero.tail.q, 2.5) * h.elevSc;
    let e = (h.chAlpha * this.aero.tail.alpha + h.chTab * c.trim * t.tab + (h.droop - c.pitch * h.pilotMax) / qSc) / -h.chDelta;
    e = lock ? 0.03 : clamp(e, -t.elevUp, t.elevDown);
    const k = lag(dt, 0.05);
    s.elev += (e - s.elev) * k;
    const v = this.tas, qW = Math.max(0.5 * this.air.rho * v * v, 60);
    const a = lock ? 0 : clamp(c.roll * h.qAil / qW, -1, 1);
    s.ailR += ((a > 0 ? -a * t.ailUp : -a * t.ailDown) - s.ailR) * k;
    s.ailL += ((a > 0 ? a * t.ailDown : a * t.ailUp) - s.ailL) * k;
    s.rudder += (clamp(c.yaw * h.qRud / qW, -1, 1) * t.rudder - s.rudder) * k;
    this.yoke.pitch = s.elev < 0 ? -s.elev / t.elevUp : -s.elev / t.elevDown; this.yoke.roll += (a - this.yoke.roll) * k;
    const g = this.gear, park = c.parkBrake ? 1 : 0;
    g.brakeL = Math.max(c.brakeL, park); g.brakeR = Math.max(c.brakeR, park); g.pedal = s.rudder / t.rudder;
  }

  // ------------------------------------------------------------------------------------------------ one physics sub-step
  _sub(dt) {
    const { pos, vel, q, om, cg, aero, prop, eng, gear, _t } = this, m = this.mass;
    const air = this.air, rho = air.rho, W = this.weather, gh = this.ground(pos.x, pos.z).h;
    // the air around the aeroplane, sampled at the centre, the wing tips, the nose and the tail
    const vb = qrotInv(_t[0], q, vel), A = this.airB;
    const probe = (lx, lz, out) => {
      const r = qrot(_t[1], q, { x: lx, y: 0, z: lz });
      return qrotInv(out, q, W.wind(pos.x + r.x, pos.y + r.y - gh, pos.z + r.z));
    };
    probe(0, 0, A.c);
    const l = probe(-5, 0, _t[2]), r = probe(5, 0, _t[3]);
    A.gx.x = (r.x - l.x) / 10; A.gx.y = (r.y - l.y) / 10; A.gx.z = (r.z - l.z) / 10;
    const n = probe(0, -2, _t[2]), tl = probe(0, 5, _t[3]);
    A.gz.x = (tl.x - n.x) / 7; A.gz.y = (tl.y - n.y) / 7; A.gz.z = (tl.z - n.z) / 7;
    A.ref.x = cg.x; A.ref.y = cg.y; A.ref.z = cg.z;
    this.relAir.x = vb.x - A.c.x; this.relAir.y = vb.y - A.c.y; this.relAir.z = vb.z - A.c.z;

    this._controls(dt);

    // propeller and engine
    const hub = prop.hub, hx = hub.x - cg.x, hy = hub.y - cg.y, hz = hub.z - cg.z;
    const ah = _t[1];
    ah.x = A.c.x + A.gz.x * hz - (vb.x + om.y * hz - om.z * hy);
    ah.y = A.c.y + A.gz.y * hz - (vb.y + om.z * hx - om.x * hz);
    ah.z = A.c.z + A.gz.z * hz - (vb.z + om.x * hy - om.y * hx);
    prop.step(dt, rho, air.a, eng.omega, ah);
    eng.step(dt, air, this.elec.masterBat ? this.elec.volts : 0, Math.max(0, ah.z + prop.slip.vi));

    aero.step(dt, rho, vb, om, A, prop.slip, this.surf, cg);

    // forces and moments in body axes: air, propeller (at the hub), the engine's torque reaction
    const pF = prop.F;
    let Fx = aero.F.x + pF.x, Fy = aero.F.y + pF.y, Fz = aero.F.z + pF.z;
    let Mx = aero.M.x + prop.M.x + hy * pF.z - hz * pF.y, My = aero.M.y + prop.M.y + hz * pF.x - hx * pF.z, Mz = aero.M.z + hx * pF.y - hy * pF.x + eng.reaction;
    // the ground
    gear.step(dt, this, this.ground, m);
    const gF = qrotInv(_t[2], q, gear.F), gM = qrotInv(_t[3], q, gear.M);
    Fx += gF.x; Fy += gF.y; Fz += gF.z; Mx += gM.x; My += gM.y; Mz += gM.z;
    this.sf.x = Fx / m; this.sf.y = Fy / m; this.sf.z = Fz / m;

    // rotation: I w' = M - w x (I w + H), H the propeller's angular momentum (it points forward)
    const I = this.I, J = this.Ii, H = -prop.inertia * eng.omega;
    const Lx = I[0] * om.x + I[3] * om.y + I[4] * om.z, Ly = I[3] * om.x + I[1] * om.y + I[5] * om.z, Lz = I[4] * om.x + I[5] * om.y + I[2] * om.z + H;
    const tx = Mx - (om.y * Lz - om.z * Ly), ty = My - (om.z * Lx - om.x * Lz), tz = Mz - (om.x * Ly - om.y * Lx);
    om.x += (J[0] * tx + J[3] * ty + J[4] * tz) * dt; om.y += (J[3] * tx + J[1] * ty + J[5] * tz) * dt; om.z += (J[4] * tx + J[5] * ty + J[2] * tz) * dt;
    // translation, world axes
    const Fw = qrot(_t[2], q, { x: Fx, y: Fy, z: Fz });
    vel.x += Fw.x / m * dt; vel.y += (Fw.y / m - G0) * dt; vel.z += Fw.z / m * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt; pos.z += vel.z * dt;
    // attitude: q <- q * exp(w dt / 2)
    const hx2 = om.x * dt * 0.5, hy2 = om.y * dt * 0.5, hz2 = om.z * dt * 0.5;
    const qx = q.x + (q.w * hx2 + q.y * hz2 - q.z * hy2), qy = q.y + (q.w * hy2 + q.z * hx2 - q.x * hz2), qz = q.z + (q.w * hz2 + q.x * hy2 - q.y * hx2), qw = q.w - (q.x * hx2 + q.y * hy2 + q.z * hz2);
    const qn = 1 / Math.hypot(qx, qy, qz, qw);
    q.x = qx * qn; q.y = qy * qn; q.z = qz * qn; q.w = qw * qn;
  }

  // ------------------------------------------------------------------------------------------------ one 1/60 s step
  step(dt = 1 / 60) {
    const { q, pos, cg, ctl, eng, elec, _t } = this;
    this.time += dt;
    Object.assign(this.qPrev, q); Object.assign(this.posPrev, pos);
    this.massProps();
    this.air = this.weather.air(pos.y - cg.y);
    // ignition key, primer, pitot heat
    const key = ctl.magKey;
    eng.magL = key >= 2; eng.magR = key === 1 || key >= 3; eng.starter = key === 4 && elec.masterBat;
    if (ctl.primer < this._primer) eng.prime(this._primer - ctl.primer);
    this._primer = ctl.primer;
    this.inst.pitotHeat = ctl.pitotHeat;
    // flaps: an electric motor drives them to where the lever points
    const want = ctl.flapLever * 10, df = want - this.flapDeg;
    this.flapMoving = Math.abs(df) > 0.05 && elec.has('FLAP');
    if (this.flapMoving) this.flapDeg += clamp(df, -3.3 * dt, 3.3 * dt);
    this.surf.flap = this.flapDeg * DEG;
    // the wake trails along the airflow; near the ground the vortices are mirrored in it
    const w = this.relAir, sp = Math.hypot(w.x, w.y, w.z);
    const d = sp > 1 ? { x: -w.x / sp, y: -w.y / sp, z: -w.z / sp } : { x: 0, y: 0, z: 1 };
    const h = pos.y - this.ground(pos.x, pos.z).h;
    let plane = null;
    if (h < 16) { const nb = qrotInv(_t[4], q, UP); plane = { nx: nb.x, ny: nb.y, nz: nb.z, px: cg.x - nb.x * h, py: cg.y - nb.y * h, pz: cg.z - nb.z * h }; }
    this.aero.influence(d, plane);

    for (let i = 0; i < SUB; i++) this._sub(dt / SUB);

    elec.step(dt, eng.rpm, eng.starterAmps);
    this.fuel.step(dt, clamp(this.sf.x / G0, -1, 1));
    this.inst.step(dt, this);
    this.radios.step(dt, this);
    // stall warning: a reed horn worked by suction at the leading edge, so it needs no electricity
    // (the stagnation point slides under the leading edge as the stall nears, and the opening there goes from pressure to suction)
    const hs = this.aero.strips[this.cfg.hornStrip];
    const near = hs.sep > 0.3 ? 1 : sat((hs.cl - 1.2 - 0.0075 * this.flapDeg) / 0.1);
    this.horn += (near * sat((hs.q - 120) / 200) - this.horn) * lag(dt, 0.08);
    this.buffet += (sat(this.aero.buffet / (this.mass * G0) * 2.2) - this.buffet) * lag(dt, 0.15);
    this.gLoad = this.sf.y / G0;
    this.cabinT += dt * ((this.air.tC - this.cabinT) * (0.004 + 0.02 * ctl.cabinAir * sat(sp / 40)) + ctl.cabinHeat * sat(eng.egt / 700) * 0.12);
    // damage
    if (!this.crashed) {
      if (this.gear.damage) this.crashed = this.gear.damage;
      else if (this.gLoad > 6.5 || this.gLoad < -3.5) this.crashed = 'structural failure: the wings were overloaded';
      if (this.crashed && /propeller|nose|roof|fin/.test(this.crashed)) eng.damaged = true;
    }
  }

  // ------------------------------------------------------------------------------------------------ starting situations
  /**
   * @param {'cold'|'ready'|'runway'|'final'|'cruise'} kind
   * @param {object} at  { x, z, heading } in world metres and degrees true; for 'final' and 'cruise' also `alt` (m above the field)
   */
  reset(kind, at) {
    const cfg = this.cfg, c = this.ctl, e = this.elec, eng = this.eng, i = this.inst, L = c.lights, oat = this.weather.oat;
    const running = kind !== 'cold', flying = kind === 'final' || kind === 'cruise';
    this.massProps();
    Object.assign(this.q, quatFromHPB(at.heading, flying ? 2 : 0, 0));
    const hd = at.heading * DEG, sp = kind === 'final' ? 72 * KT : kind === 'cruise' ? 105 * KT : 0;
    this.pos.x = at.x; this.pos.z = at.z; this.pos.y = flying ? at.alt + this.cg.y : this.ground(at.x, at.z).h + this.cg.y + 0.0;
    this.vel.x = Math.sin(hd) * sp; this.vel.z = -Math.cos(hd) * sp; this.vel.y = kind === 'final' ? -sp * 0.052 : 0;
    this.om.x = this.om.y = this.om.z = 0;
    Object.assign(this.qPrev, this.q); Object.assign(this.posPrev, this.pos);
    for (const s of this.aero.strips) s.gamma = 0;
    this.crashed = null; this.gear.damage = null; this.gear.touchdown = null; this.gear.hardest = 0; eng.damaged = false;
    for (const w of this.gear.wheels) { w.collapsed = false; w.dLon = w.dLat = 0; w.comp = 0; w.load = 0; }
    // switches and levers
    Object.assign(c, { pitch: 0, roll: 0, yaw: 0, brakeL: 0, brakeR: 0, parkBrake: !flying, controlLock: !running, trim: flying ? 0.12 : 0,
      flapLever: kind === 'final' ? 2 : 0, magKey: running ? 3 : 0, primer: 0, primerLocked: true, pitotHeat: false,
      panelLights: 0, radioLights: 0, cabinHeat: 0, cabinAir: 0.3 });
    L.beacon = running; L.nav = false; L.strobe = flying; L.land = flying; L.taxi = false; L.dome = false;
    this.flapDeg = c.flapLever * 10; this._primer = 0;
    e.masterBat = e.masterAlt = running; e.avionics = running; e.volts = running ? 28 : 0; e.battTemp = oat;
    for (const k in e.breaker) e.breaker[k] = true;
    eng.throttle = kind === 'cruise' ? 0.72 : kind === 'final' ? 0.33 : running ? 0.1 : 0;
    eng.mixture = running ? 1 : 0; eng.carbHeat = 0; eng.ice = 0; eng.film = running ? 0.0004 : 0; eng.bowl = 0.055; eng.foul = [0, 0];
    eng.omega = (kind === 'cruise' ? 2350 : kind === 'final' ? 1800 : running ? 900 : 0) * DEG * 6;
    eng.setTemps(oat);
    if (running) { eng.cht = flying ? 175 : 120; eng.oilT = flying ? 85 : 55; eng.egt = 500; eng.oilP = 60; eng.suction = 5; }
    else eng.oilP = eng.suction = 0;
    this.fuel.selector = running ? 2 : 1;
    this.gear.chocks = !running; this.gear.tiedown = !running; i.pitotCover = !running; i.pitotIce = 0;
    if (!running) this.gear.setTiePoints(this, cfg.gear.tie);
    // instruments
    i.kollsman = running ? Math.round(this.weather.qnh / 33.86389) / 100 : 29.92;
    i.aiSpin = i.dgSpin = running ? 1 : 0; i.tcSpin = running ? 1 : 0; i.aiTumble = 0;
    if (running) { Object.assign(i.aiAxis, UP); i.dg = wrap360(at.heading - i.magVar / DEG); }
    i.compassAz = i.magVar; i.compassV = 0; i._hdg = null;
    i.pitotP = i.staticP = i.caseP = this.weather.air(this.pos.y - this.cg.y).p;
    this.radios.com.on = this.radios.nav.on = running; this.radios.xpdr.mode = flying ? 3 : running ? 1 : 0;
    this.cabinT = oat; this.horn = 0; this.kind = kind;
    this.air = this.weather.air(this.pos.y - this.cg.y);
  }

  /** Numbers for a read-out or a test. */
  telemetry() {
    const i = this.inst;
    return { kias: i.kias, alt: i.altFt, vs: i.vsFpm, hdg: this.heading, pitch: this.pitch, bank: this.bank, rpm: this.eng.rpm, ktas: this.tas / KT,
      agl: this.agl / FT, alpha: this.alpha, beta: this.beta, g: this.gLoad, hp: this.eng.hp, map: this.eng.mapInHg, gph: this.eng.gph, flaps: this.flapDeg };
  }
}
export { LIMITS };
