/**
 * The instruments, each working the way the real one does, with the errors that come with it.
 *
 *  - Airspeed, altimeter and vertical speed read the pitot tube and the static port. The static port has a position error that
 *    varies with angle of attack (the handbook's IAS-to-CAS table falls out of it); the vertical-speed indicator is a capsule with
 *    a calibrated leak, so it lags; a blocked pitot tube (ice, or the cover left on) turns the airspeed indicator into an
 *    altimeter; the alternate static source reads cabin pressure.
 *  - The attitude and heading indicators are gyros spun by the engine's vacuum pump. They take minutes to spin up, erect slowly
 *    toward whatever the aeroplane feels as "down" (so they pick up small errors in turns), tumble past their limits, wind down
 *    when the suction goes, and the heading indicator drifts and has to be reset against the compass.
 *  - The turn coordinator's gyro is electric. The ball is a ball in a curved tube.
 *  - The magnetic compass is a magnet on a pendulous card in a bowl of liquid, in a field that dips 73 degrees: it leads and lags
 *    in turns and swings when the aeroplane accelerates, as a real one does this far north.
 */
import { DEG, G0, KT, FT, clamp, sat, lag, table, smooth, wrapPi, wrap360, qrot, qrotInv, rng } from './util.js';
import { altimeterHeight } from './atmosphere.js';

const P0 = 101325, A0 = 340.294;
// static-port pressure error as a fraction of dynamic pressure, against wing lift coefficient (from the handbook's calibration table)
const CP_CL = [0.17, 0.30, 0.43, 0.67, 0.83, 1.06, 1.30, 1.60], CP = [-0.079, -0.070, -0.063, -0.052, 0, 0.063, 0.203, 0.255];

export class Instruments {
  constructor(o = {}) {
    const r = this.rand = rng(o.seed ?? 3);
    this.magVar = (o.magVar ?? 7) * DEG;           // east is positive
    this.dip = (o.dip ?? 73) * DEG;
    this.latitude = o.latitude ?? 59.35;
    // pitot-static
    this.pitotP = P0; this.staticP = P0; this.caseP = P0; this.pitotIce = 0; this.pitotCover = false; this.altStatic = false; this.pitotHeat = false;
    this.ias = 0; this.kollsman = 29.92; this.alt = 0; this.vs = 0;
    // gyros
    this.aiSpin = 0; this.aiAxis = { x: 0.26 * (r() - 0.5), y: 1, z: 0.3 * (r() - 0.5) }; this.aiPitch = 0; this.aiBank = 0; this.aiAdjust = 0; this.aiTumble = 0;
    this.dgSpin = 0; this.dg = r() * 360; this.dgDrift = (r() - 0.5) * 4; this.bug = 0; this._hdg = null;
    this.tcSpin = 0; this.tcRate = 0; this.ball = 0; this.ballV = 0;
    this.compass = 0; this.compassV = 0; this.compassAz = this.magVar; this.cardUp = { x: 0, y: 1, z: 0 };
    // engine gauges
    this.rpm = 0; this.fuelL = 0; this.fuelR = 0; this.oilT = 0; this.oilP = 0; this.amps = 0; this.suction = 0; this.egt = 0; this.oat = 15;
    this.flag = { tc: true, nav: true, gs: true };
    this._f = { x: 0, y: 0, z: 0 }; this._u = { x: 0, y: 0, z: 0 };
  }

  /** @param {number} dt @param {object} ac the Aircraft */
  step(dt, ac) {
    const air = ac.air, q = ac.q, e = ac.elec;
    // ---- pitot-static
    const w = ac.relAir;                                 // the aeroplane's velocity through the air, body axes
    const uf = Math.max(0, -w.z), V = Math.hypot(w.x, w.y, w.z);
    // a pitot tube reads true up to about 12 degrees off the airflow, then falls away
    const vp = V > 1 ? uf + (V - uf) * smooth(0.62, 0.30, Math.acos(clamp(uf / V, -1, 1))) : uf;
    const mach = vp / air.a, qc = air.p * (Math.pow(1 + 0.2 * mach * mach, 3.5) - 1), qdyn = 0.5 * air.rho * V * V;
    const visible = air.rh > 0.97 || ac.weather.rain > 0.2;       // in cloud or rain
    if (visible && air.tC < 1 && !(this.pitotHeat && e.has('BCN_PITOT'))) this.pitotIce = Math.min(1, this.pitotIce + dt / 90);
    else if (air.tC > 1 || (this.pitotHeat && e.has('BCN_PITOT'))) this.pitotIce = Math.max(0, this.pitotIce - dt / 25);
    if (!(this.pitotCover || this.pitotIce > 0.6)) this.pitotP += (air.p + qc - this.pitotP) * lag(dt, 0.08);
    const cp = this.altStatic ? -0.035 : (table(CP_CL, CP, ac.aero.wingCL * 0.95) + 0.0055 * ac.flapDeg * sat((ac.aero.wingCL - 0.8) / 0.9)) * ac.aero.fade - 0.22 * (V > 5 ? w.x / V : 0);
    this.staticP += (air.p + cp * qdyn - this.staticP) * lag(dt, 0.12);
    const qInd = Math.max(0, this.pitotP - this.staticP);
    const ias = A0 * Math.sqrt(5 * (Math.pow(qInd / P0 + 1, 2 / 7) - 1));
    this.ias += (ias - this.ias) * lag(dt, 0.25);
    this.alt += (altimeterHeight(this.staticP, this.kollsman * 3386.389) - this.alt) * lag(dt, 0.35);
    this.caseP += (this.staticP - this.caseP) * lag(dt, 3.5);
    this.vs += (clamp((this.caseP - this.staticP) / (3.5 * air.rho * G0), -10.4, 10.4) - this.vs) * lag(dt, 0.4);

    // ---- what the aeroplane feels as "up" (the specific force), in world axes
    const f = qrot(this._f, q, ac.sf), fl = Math.hypot(f.x, f.y, f.z) || 1;
    const ux = f.x / fl, uy = f.y / fl, uz = f.z / fl;

    // ---- attitude indicator
    this.aiSpin += (sat((ac.eng.suction - 0.6) / 3.6) - this.aiSpin) * lag(dt, ac.eng.suction > 3 ? 50 : 260);
    const A = this.aiAxis, grip = sat(this.aiSpin * 1.7);
    if (grip < 1) {                                      // a slow rotor is dragged round by the case
      const ab = qrotInv(this._u, ac.qPrev, A), dragged = qrot({ x: 0, y: 0, z: 0 }, q, ab), k = (1 - grip) * lag(dt, 1.5);
      A.x += (dragged.x - A.x) * k; A.y += (dragged.y - A.y) * k; A.z += (dragged.z - A.z) * k;
    }
    if (this.aiTumble > 0) {                             // toppled: it precesses wildly until it settles
      this.aiTumble -= dt;
      const s = Math.sin(ac.time * 7), c = Math.cos(ac.time * 5);
      A.x += s * 1.5 * dt; A.z += c * 1.5 * dt;
    } else {                                             // the pendulous vanes pull the rotor toward the felt vertical, a few degrees a minute
      const ex = ux - A.x, ey = uy - A.y, ez = uz - A.z, d = Math.hypot(ex, ey, ez);
      if (d > 1e-6) { const k = Math.min(0.0030 * this.aiSpin, d * 0.06) * dt / d; A.x += ex * k; A.y += ey * k; A.z += ez * k; }
    }
    const al = Math.hypot(A.x, A.y, A.z); A.x /= al; A.y /= al; A.z /= al;
    const gb = qrotInv(this._u, q, A);
    this.aiBank = Math.atan2(-gb.x, gb.y); this.aiPitch = Math.asin(clamp(gb.z, -1, 1));
    if (grip > 0.5 && this.aiTumble <= 0 && (Math.abs(this.aiPitch) > 70 * DEG || Math.abs(this.aiBank) > 110 * DEG)) this.aiTumble = 6;

    // ---- heading indicator: holds its direction in space, minus drift; set it with the knob
    this.dgSpin += (sat((ac.eng.suction - 0.6) / 3.6) - this.dgSpin) * lag(dt, ac.eng.suction > 3 ? 40 : 220);
    const hdg = ac.heading;
    if (this._hdg !== null) {
      const dh = wrapPi((hdg - this._hdg) * DEG) / DEG, gripD = sat(this.dgSpin * 1.6);
      const earth = -15.04 * Math.sin(this.latitude * DEG) / 3600;           // deg/s: the earth turns under the gyro
      this.dg = wrap360(this.dg + dh * gripD + (earth + this.dgDrift / 3600 * (1 + 6 * (1 - gripD))) * dt);
    }
    this._hdg = hdg;

    // ---- turn coordinator (its gyro is canted 30 degrees, so it feels roll as well as yaw) and the ball
    const tcOn = e.has('INST');
    this.tcSpin += ((tcOn ? 1 : 0) - this.tcSpin) * lag(dt, tcOn ? 6 : 50);
    this.flag.tc = this.tcSpin < 0.6;
    const rate = (-ac.om.y * 0.866 - ac.om.z * 0.5) / (3 * DEG) * this.tcSpin;
    this.tcRate += (clamp(rate, -1.7, 1.7) - this.tcRate) * lag(dt, 0.35);
    const fb = ac.sf, ballT = clamp(-Math.atan2(fb.x, Math.max(fb.y, 0.5)), -0.25, 0.25);
    this.ballV += (190 * (ballT - this.ball) - 16 * this.ballV) * dt; this.ball = clamp(this.ball + this.ballV * dt, -0.26, 0.26);

    // ---- magnetic compass
    const cu = this.cardUp, kc = lag(dt, 0.45);
    cu.x += (ux - cu.x) * kc; cu.y += (uy - cu.y) * kc; cu.z += (uz - cu.z) * kc;
    const cl = Math.hypot(cu.x, cu.y, cu.z); let nx = cu.x / cl, ny = cu.y / cl, nz = cu.z / cl;
    const tilt = Math.acos(clamp(ny, -1, 1)), maxTilt = 18 * DEG;             // the card hits its stops
    if (tilt > maxTilt) { const s = Math.sin(maxTilt) / Math.sin(tilt); nx *= s; nz *= s; ny = Math.cos(maxTilt); }
    const H = Math.cos(this.dip), Z = Math.sin(this.dip);
    const bx = H * Math.sin(this.magVar), by = -Z, bz = -H * Math.cos(this.magVar);
    const bn = bx * nx + by * ny + bz * nz, px = bx - bn * nx, pz = bz - bn * nz;      // the field as the tilted card feels it
    const target = Math.atan2(px, -pz), pull = Math.hypot(px, pz) / H;
    const yawRate = -(ac.om.y);                                                         // the liquid drags the card a little
    this.compassV += (-5.0 * pull * Math.sin(this.compassAz - target) - 2.2 * this.compassV + 0.25 * yawRate) * dt;
    this.compassAz = wrapPi(this.compassAz + this.compassV * dt);
    this.compass = wrap360(hdg - this.compassAz / DEG);

    // ---- engine and system gauges
    const eng = ac.eng, fu = ac.fuel, fuelOn = e.has('FUEL_IND');
    this.rpm += (eng.rpm - this.rpm) * lag(dt, 0.25);
    const slosh = clamp(this.ball * 14, -4, 4);
    this.fuelL += ((fuelOn ? clamp(fu.gallons(0) + slosh, 0, 21) : -1.5) - this.fuelL) * lag(dt, 1.8);
    this.fuelR += ((fuelOn ? clamp(fu.gallons(1) - slosh, 0, 21) : -1.5) - this.fuelR) * lag(dt, 1.8);
    this.oilT += ((fuelOn ? eng.oilT : 0) - this.oilT) * lag(dt, 2.5);
    this.oilP += (eng.oilP - this.oilP) * lag(dt, 0.4);
    this.amps += ((e.volts > 5 ? e.battAmps : 0) - this.amps) * lag(dt, 0.3);
    this.suction += (eng.suction - this.suction) * lag(dt, 0.5);
    this.egt += (eng.egt - this.egt) * lag(dt, 1.2);
    this.oat += (air.tC + 0.8 * (V * V) / 2010 - this.oat) * lag(dt, 8);               // the probe warms a little in the airflow
  }
  get kias() { return this.ias / KT; }
  get altFt() { return this.alt / FT; }
  get vsFpm() { return this.vs / FT * 60; }
}
