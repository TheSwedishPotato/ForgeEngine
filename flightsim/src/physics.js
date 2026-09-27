// Physics-based A320neo: a rigid body with six degrees of freedom integrated at 120 Hz.
//
// Forces: lift, drag and side force from angle of attack, sideslip, flap/slat configuration,
// spoilers, gear and ground effect (with a real stall); LEAP-1A26 thrust that lapses with
// density and Mach, spools up and down, burns fuel and can fail; three oleo struts with
// tyre friction, brakes and nose-wheel steering; gravity. Moments: aerodynamic stability
// and damping derivatives, control surfaces, engine offset and gear loads.
//
// The pilots are modelled as fly-by-wire control laws (pitch-rate command with automatic
// stabiliser trim, roll-rate command with bank protection, yaw damper and turn coordination)
// flown by an autopilot and autothrust in the style of TECS: pitch controls the flight path,
// thrust controls the energy. Taxi uses pure-pursuit nose-wheel steering. Nothing moves the
// aircraft except these forces, so gusts, windshear, failures and bad landings play out
// through the same physics, including hard landings, tail strikes and crashes.
import * as THREE from 'three';
import { DEG, KT, FT, G, clamp, lerp, smoothstep, isa, vnoise1 } from './core.js';
import { CONFIGS } from './flight.js';
import { Atmosphere, angleDiff } from './atmosphere.js';

// ---------------- aircraft data ----------------
const S = 122.6, B = 35.8, CBAR = 4.19;
const OEW = 44300, TOW = 64500;
const IXX0 = 1.30e6, IYY0 = 3.20e6, IZZ0 = 4.45e6;
const WHEELBASE = 13.8;
const CRUISE_ALT = 36000 * FT;
const T_MAX = 120600;               // N, LEAP-1A26 sea-level static
const DT = 1 / 120;
// aircraft-coordinate points (x right, y up, z aft; cabin floor y = 0, L1 door z = -2.3)
const CG = [0, 0.6, 10.3];
const GEAR = [ // contact points when the strut carries its static load
  { name: 'nose', p: [0, -3.41, -2.3], load: 0.087, defl: 0.12, steer: true, brake: false },
  { name: 'left', p: [-3.8, -3.4, 11.5], load: 0.4565, defl: 0.25, steer: false, brake: true },
  { name: 'right', p: [3.8, -3.4, 11.5], load: 0.4565, defl: 0.25, steer: false, brake: true },
];
const G_LOCAL = [0, -3.4, 11.5];
// structure that must never touch the ground
const STRIKE = [
  // the tail cone touches at 11.7 degrees of pitch on compressed main gear (Airbus A320 airport planning figure)
  { name: 'tail', p: [0, -0.40, 26.0] }, { name: 'tail', p: [0, 0.15, 28.5] },
  { name: 'pod-left', p: [-5.75, -2.85, 4.5] }, { name: 'pod-right', p: [5.75, -2.85, 4.5] },
  { name: 'wingtip-left', p: [-17.4, 1.0, 15.5] }, { name: 'wingtip-right', p: [17.4, 1.0, 15.5] },
  { name: 'nose', p: [0, -0.9, -6.2] }, { name: 'belly', p: [0, -1.25, 9.8] }, { name: 'belly', p: [0, -0.97, 18] },
];
// per configuration: CL at zero alpha, stall alpha, CLmax, drag increment, VFE (kt)
const AERO = [
  { cl0: 0.25, as: 14.0, clmax: 1.55, cd: 0.000, vfe: 350 },
  { cl0: 0.30, as: 18.0, clmax: 2.00, cd: 0.008, vfe: 230 },
  { cl0: 0.55, as: 17.0, clmax: 2.15, cd: 0.016, vfe: 215 },
  { cl0: 0.72, as: 16.5, clmax: 2.28, cd: 0.034, vfe: 200 },
  { cl0: 0.85, as: 16.0, clmax: 2.38, cd: 0.046, vfe: 185 },
  { cl0: 1.00, as: 16.5, clmax: 2.62, cd: 0.078, vfe: 177 },
];
const CLA = 5.6, K_IND = 0.039, CD0 = 0.0215;
const VR = 144, V2 = 150, VAPP = 137;

// ---------------- small vector/quaternion helpers on plain numbers ----------------
const tv = { x: 0, y: 0, z: 0 };
function rot(q, x, y, z, o = tv) { // rotate (x,y,z) by quaternion q = {x,y,z,w}
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  o.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; o.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; o.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return o;
}
function rotInv(q, x, y, z, o = tv) { return rot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, o); }

function engineThrust(n1, sigma, mach) {
  const frac = clamp((n1 - 0.19) / 0.81, 0, 1.05);
  const tmax = T_MAX * Math.pow(sigma, 0.92) * (1 - 0.35 * mach + 0.2 * mach * mach);
  return tmax * frac * frac + 3000 * sigma;
}
function n1ForThrust(t, sigma, mach) {
  const tmax = T_MAX * Math.pow(sigma, 0.92) * (1 - 0.35 * mach + 0.2 * mach * mach);
  return 0.19 + 0.81 * Math.sqrt(clamp((t - 3000 * sigma) / tmax, 0, 1.1));
}

function liftCurve(a, alpha, mach) {
  const cla = CLA / Math.sqrt(1 - Math.min(mach, 0.8) ** 2);
  const as = a.as * DEG * (1 - 0.35 * smoothstep(0.3, 0.8, mach)); // shock-induced separation lowers the stall alpha
  const lin = a.cl0 + cla * alpha;
  const clmax = Math.min(a.clmax, a.cl0 + cla * as - 0.01);
  const ak = as - 2 * (a.cl0 + cla * as - clmax) / cla;
  if (alpha <= ak) return lin;
  if (alpha <= as) { const d = alpha - ak, L = as - ak; return a.cl0 + cla * ak + cla * d - cla * d * d / (2 * L); }
  return Math.max(0.55 * clmax, clmax - 2.2 * (alpha - as)); // stalled
}

export class FlightModel {
  constructor(route, opts = {}) {
    this.path = route.path; this.m = route.m;
    this.atmo = opts.atmosphere || new Atmosphere(opts.weather || { turb: opts.turbulence ?? 0.3, wind: opts.wind || '210° / 8 kt' }, { seed: opts.seed });
    this.wet = !!opts.wet;
    this.t = 0; this.s = 0;
    this.phase = 'parked';
    this.events = []; this._flags = {};
    // rigid-body state (CG, world frame) and attitude (aircraft axes -> world)
    this.mass = TOW; this.fuel = TOW - OEW - 13200; // payload ~13.2 t
    this.P = { x: 0, y: 0, z: 0 }; this.V = { x: 0, y: 0, z: 0 };
    this.Q = { x: 0, y: 0, z: 0, w: 1 };
    this.p = 0; this.q = 0; this.r = 0;        // body rates: roll (right wing down +), pitch (nose up +), yaw (nose right +)
    this.pd = 0; this.qd = 0; this.rd = 0;
    // systems
    this.n1 = [0.205, 0.205]; this.n1Cmd = [0.205, 0.205]; this.engineRunning = [true, true];
    this.engFail = [0, 0];      // 0 ok, 1 failed (windmilling), 2 seized/damaged
    this.engFire = [false, false];
    this.cfg = 0; this.cfgTarget = 0; this.slat = 0; this.flap = 0;
    this.gear = 1; this.gearCmd = 1; this.gearCollapsed = [false, false, false];
    this.spoiler = 0; this.spoilerCmd = 0; this.groundSpoiler = 0; this.reverse = 0; this.reverseCmd = 0;
    this.brake = 1; this.parkBrake = true; this.autobrake = 0; this.steer = 0;
    this.de = 0; this.ths = -2.0 * DEG; this.da = 0; this.dr = 0; this._ia = 0; this._ir = 0;
    this.law = 'normal';        // normal | alternate | direct
    this.hyd = { green: true, yellow: true, blue: true };
    this.cabinAlt = 0; this.cabinAltTarget = 0; this.pressurised = true; this.pressLeak = 0;
    // clearances from the director
    this.clearTaxi = false; this.clearLineup = false; this.clearTakeoff = false;
    this.holdTimer = 0; this.rotating = false; this.liftoffT = -1; this.touchdownT = -1;
    // outputs kept compatible with the rest of the game
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.h = 0; this.agl = 0; this.v = 0; this.vs = 0; this.ias = 0; this.tas = 0; this.mach = 0; this.gs = 0;
    this.heading = 0; this.pitch = 0; this.bank = 0; this.alpha = 0; this.beta = 0; this.gamma = 0;
    this.nz = 1; this.ny = 0; this.nx = 0;
    this.accel = new THREE.Vector3(); this.bump = 0; this.shake = 0; this.rollRumble = 0; this.thump = 0;
    this.turbLevel = 0; this._turbBoost = 1; this.turbBank = 0; this.turbPitch = 0;
    this.distToGo = 0; this.brakeDecel = 0; this.flapsMoving = false; this.gearMoving = false;
    this.onGround = true; this.wow = [true, true, true]; this.strutC = [0, 0, 0];
    this.drag = 0; this.lift = 0; this.thrust = [0, 0];
    this.stall = 0; this.buffet = 0; this.overspeed = 0;
    this.crashed = false; this.damage = {};
    this.ap = { mode: 'ground', vsCmd: 0, gammaCmd: 0, iasCmd: 0, bankCmd: 0, altCmd: CRUISE_ALT, thr: 'idle' };
    this.proc = null;            // a temporary procedure path (go-around circuit, return)
    this.ctrl = { ail: 0, elev: 0, rud: 0, sbL: 0, sbR: 0 };
    this._contact = [false, false, false]; this.contactSink = [0, 0, 0]; this._accLong = 0;
    this.sf = { x: 0, y: G, z: 0 }; this.xtk = 0; this.gamma = 0; this.CL = 0; this.qbar = 0;
    this._tmp = {}; this._t2 = {}; this._wind = {};
    this._placeOnGround(0);
    this.update(0);
  }

  get turbBoost() { return this._turbBoost; }
  set turbBoost(v) { this._turbBoost = v; this.atmo.boost = v; }

  emit(e) { this.events.push(e); }
  once(name, cond) { if (cond && !this._flags[name]) { this._flags[name] = true; this.emit(name); return true; } return false; }
  setConfig(i) { this.cfgTarget = clamp(i, 0, 5); }
  shutdown() { this._flags.shutdown = true; }

  // ---------------- placement ----------------
  _placeOnGround(s) {
    const tp = this.path.sample(s, this._tmp);
    const hdg = tp.heading;
    this.Q.x = 0; this.Q.y = Math.sin(-hdg / 2); this.Q.z = 0; this.Q.w = Math.cos(-hdg / 2);
    // main gear point on the path, gear at static deflection
    const off = rot(this.Q, CG[0] - G_LOCAL[0], CG[1] - G_LOCAL[1], CG[2] - G_LOCAL[2], {});
    this.P.x = tp.x + off.x; this.P.y = off.y; this.P.z = tp.z + off.z;
    this.V.x = this.V.y = this.V.z = 0; this.p = this.q = this.r = 0; this.s = s;
  }

  // world position of an aircraft-coordinate point
  worldPoint(x, y, z, o = {}) { const w = rot(this.Q, x - CG[0], y - CG[1], z - CG[2], o); w.x += this.P.x; w.y += this.P.y; w.z += this.P.z; return w; }

  // Specific force (m/s^2, aircraft axes x right, y up, z aft) felt at an aircraft-coordinate
  // point: the CG value plus the rotational terms, so the back of the cabin bumps more.
  accelAt(x, y, z, o = new THREE.Vector3()) {
    const rx = x - CG[0], ry = y - CG[1], rz = z - CG[2];
    // body rates in three axes: wx = q, wy = -r, wz = -p
    const wx = this.q, wy = -this.r, wz = -this.p, ax = this.qd, ay = -this.rd, az = -this.pd;
    // alpha x r + w x (w x r)
    const c1x = ay * rz - az * ry, c1y = az * rx - ax * rz, c1z = ax * ry - ay * rx;
    const wr = wx * rx + wy * ry + wz * rz, ww = wx * wx + wy * wy + wz * wz;
    const c2x = wx * wr - rx * ww, c2y = wy * wr - ry * ww, c2z = wz * wr - rz * ww;
    o.set(this.sf.x + c1x + c2x, this.sf.y + c1y + c2y, this.sf.z + c1z + c2z);
    return o;
  }

  // ---------------- main update ----------------
  update(dt) {
    if (dt > 0) {
      let left = dt;
      while (left > 1e-6) { const h = Math.min(DT, left); this._step(h); left -= h; }
    }
    this._outputs(dt);
  }

  _step(dt) {
    if (this.crashed && this.crashStopped) return;
    this.t += dt;
    const P = this.P, V = this.V, Q = this.Q;
    // ---- attitude angles ----
    const f = rot(Q, 0, 0, -1, this._f || (this._f = {})), rw = rot(Q, 1, 0, 0, this._r || (this._r = {})), up = rot(Q, 0, 1, 0, this._u || (this._u = {}));
    const theta = Math.asin(clamp(f.y, -1, 1)), phi = Math.atan2(-rw.y, up.y), psi = Math.atan2(f.x, -f.z);
    this.pitch = theta; this.bank = phi; this.heading = psi;
    const gl = Math.hypot(f.x, f.z) || 1, fx = f.x / gl, fz = f.z / gl;
    // ---- air data ----
    const hCG = P.y;
    const gearH = this._lowestGear();
    this.agl = Math.max(0, gearH);
    const air = isa(Math.max(0, hCG));
    const airspeedGuess = Math.hypot(V.x, V.y, V.z);
    const w = this.atmo.step(dt, Math.max(0, gearH), airspeedGuess, P, fx, fz, this._wind);
    const onGroundW = this.wow[1] || this.wow[2] || this.wow[0];
    const shelter = onGroundW ? 0.4 : 1; // near the surface and on the runway the gusts are smaller
    const vax = V.x - w.wx, vay = V.y - w.wy * shelter, vaz = V.z - w.wz;
    const vb = rotInv(Q, vax, vay, vaz, this._vb || (this._vb = {}));
    const u = -vb.z, vv = vb.x, ww = -vb.y; // aviation body: forward, right, down
    const Va = Math.max(0.1, Math.hypot(u, vv, ww));
    const alpha = Math.atan2(ww, Math.max(u, 0.1)), beta = Math.asin(clamp(vv / Va, -1, 1));
    const qbar = 0.5 * air.rho * Va * Va, mach = Va / air.a;
    this.alpha = alpha; this.beta = beta; this.tas = Va; this.mach = mach; this.qbar = qbar;
    this.ias = Math.sqrt(2 * qbar / 1.225) / KT;
    // ---- configuration & surfaces ----
    this._systems(dt);
    const cf = this._cfgf(), i0 = Math.floor(cf), i1 = Math.min(5, i0 + 1), kf = cf - i0;
    const A0 = AERO[i0], A1 = AERO[i1];
    const aero = this._aeroTmp || (this._aeroTmp = {});
    for (const key of ['cl0', 'as', 'clmax', 'cd']) aero[key] = lerp(A0[key], A1[key], kf);
    // ---- guidance & control laws (the crew) ----
    this._pilot(dt, theta, phi, psi, alpha, beta, qbar, Va, mach, air);
    // ---- aerodynamics ----
    const pa = this.p - w.pg, qa = this.q - w.qg, ra = this.r - w.rg;
    const hb = Math.max(0.5, gearH + 3.4) / B;
    const ge = hb < 1 ? (16 * hb) ** 2 / (1 + (16 * hb) ** 2) : 1; // ground effect on induced drag
    let CL = liftCurve(aero, alpha, mach) + (hb < 1 ? 0.08 * (1 - hb) : 0);
    // panels 1-5 on each wing are powered green, yellow, blue, yellow, green; speedbrakes use 2-4, ground spoilers all five
    const H = this.hyd;
    const sb = this.spoiler * ((H.yellow ? 2 : 0) + (H.blue ? 1 : 0)) / 3;
    const gsp = this.groundSpoiler * ((H.green ? 2 : 0) + (H.yellow ? 2 : 0) + (H.blue ? 1 : 0)) / 5;
    CL += -0.12 * sb - 0.75 * gsp * clamp(CL, 0, 2);
    CL += 4.5 * qa * CBAR / (2 * Va) + 0.35 * this.de;
    const stalled = alpha > aero.as * DEG * (1 - 0.35 * smoothstep(0.3, 0.8, mach));
    this.stall = stalled ? 1 : 0;
    this.buffet = smoothstep(aero.as * DEG - 3 * DEG, aero.as * DEG, alpha) + smoothstep(0.8, 0.86, mach);
    let CD = CD0 + aero.cd + K_IND * ge * CL * CL + 0.016 * this.gear + 0.03 * sb + 0.07 * gsp;
    if (mach > 0.72) CD += 20 * (mach - 0.72) ** 4;
    if (stalled) CD += 0.6 * (alpha - aero.as * DEG);
    for (let i = 0; i < 2; i++) if (this.engFail[i]) CD += 0.004; // windmilling engine
    const CY = -0.85 * beta - 0.2 * this.dr;
    const lift = qbar * S * CL, drag = qbar * S * CD, side = qbar * S * CY;
    this.lift = lift; this.drag = drag; this.CL = CL;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    let Fx = -drag * ca + lift * sa, Fy = side, Fz = -drag * sa - lift * ca;
    // moments (aviation body)
    const pH = pa * B / (2 * Va), qH = qa * CBAR / (2 * Va), rH = ra * B / (2 * Va);
    let Cl = -0.10 * beta - 0.45 * pH + 0.12 * rH + 0.09 * this.da - 0.015 * this.dr;
    let Cm = 0.06 - 1.0 * alpha - 22 * qH - 1.5 * (this.de + 1.6 * this.ths) - 0.035 * cf - 0.02 * gsp - 0.05 * sb;
    let Cn = 0.12 * beta - 0.22 * rH - 0.03 * pH + 0.085 * this.dr - 0.012 * this.da;
    if (stalled) { Cm -= 0.25 * (alpha - aero.as * DEG) * 3; Cl += 0.02 * (vnoise1(this.t * 1.7) - 0.5) * (this.law === 'normal' ? 0.3 : 1); }
    let L = qbar * S * B * Cl, M = qbar * S * CBAR * Cm, N = qbar * S * B * Cn;
    // ---- engines ----
    const sig = air.sigma;
    let T = 0;
    for (let i = 0; i < 2; i++) {
      let t = this.engFail[i] ? -0.012 * qbar * 2.0 : engineThrust(this.n1[i], sig, mach);
      if (!this.engineRunning[i] && !this.engFail[i]) t = 0;
      // reverser 1 is green, reverser 2 yellow: without its hydraulics a reverser stays stowed and the FADEC holds that engine at idle
      const revOk = i === 0 ? this.hyd.green : this.hyd.yellow;
      if (this.reverse > 0.05 && !this.engFail[i]) t = revOk ? t * (1 - this.reverse) - t * this.reverse * 0.38 : engineThrust(Math.min(this.n1[i], 0.205), sig, mach);
      this.thrust[i] = t; T += t;
    }
    Fx += T;
    N += (this.thrust[0] - this.thrust[1]) * 5.75; // left engine pushes the nose right
    M += T * 2.3;                                  // thrust line below the CG
    // ---- convert aero+thrust to world ----
    const fb = rot(Q, Fy, -Fz, -Fx, this._fw || (this._fw = {}));
    let Fwx = fb.x, Fwy = fb.y, Fwz = fb.z;
    // moments to three-axes vector (Mx = pitch, My = -yaw, Mz = -roll) to world for adding gear moments
    let Mtx = M, Mty = -N, Mtz = -L;
    // ---- landing gear & structure contacts ----
    const gr = this._ground(dt, fx, fz);
    Fwx += gr.fx; Fwy += gr.fy; Fwz += gr.fz;
    const gm = rotInv(Q, gr.mx, gr.my, gr.mz, this._gm || (this._gm = {}));
    Mtx += gm.x; Mty += gm.y; Mtz += gm.z;
    // ---- translational dynamics ----
    const m = this.mass;
    // specific force (non-gravitational acceleration) in aircraft axes, for the cabin
    const sfw = { x: Fwx / m, y: Fwy / m, z: Fwz / m };
    this.sf = rotInv(Q, sfw.x, sfw.y, sfw.z, this.sf || {});
    V.x += sfw.x * dt; V.y += (sfw.y - G) * dt; V.z += sfw.z * dt;
    P.x += V.x * dt; P.y += V.y * dt; P.z += V.z * dt;
    // ---- rotational dynamics (aviation body axes) ----
    const k = this.mass / TOW, Ixx = IXX0 * (0.85 + 0.15 * this.fuel / 7000) * k, Iyy = IYY0 * k, Izz = IZZ0 * k;
    const Lb = -Mtz, Mb = Mtx, Nb = -Mty;
    this.pd = (Lb + (Iyy - Izz) * this.q * this.r) / Ixx;
    this.qd = (Mb + (Izz - Ixx) * this.p * this.r) / Iyy;
    this.rd = (Nb + (Ixx - Iyy) * this.p * this.q) / Izz;
    this.p += this.pd * dt; this.q += this.qd * dt; this.r += this.rd * dt;
    // quaternion kinematics with three-axes body rate (q, -r, -p)
    const ox = this.q, oy = -this.r, oz = -this.p;
    const qx = Q.x, qy = Q.y, qz = Q.z, qw = Q.w;
    Q.x += 0.5 * dt * (qw * ox + qy * oz - qz * oy);
    Q.y += 0.5 * dt * (qw * oy + qz * ox - qx * oz);
    Q.z += 0.5 * dt * (qw * oz + qx * oy - qy * ox);
    Q.w += 0.5 * dt * (-qx * ox - qy * oy - qz * oz);
    const qn = Math.hypot(Q.x, Q.y, Q.z, Q.w); Q.x /= qn; Q.y /= qn; Q.z /= qn; Q.w /= qn;
    // ---- fuel ----
    const tsfc = lerp(1.05e-5, 1.5e-5, smoothstep(0, 10000, hCG));
    for (let i = 0; i < 2; i++) if (this.engineRunning[i] && !this.engFail[i]) { const ff = Math.max(0.07, tsfc * Math.max(0, this.thrust[i])); this.fuel -= ff * dt; this.mass -= ff * dt; }
    // ---- load factors & structural limits ----
    this.nz = this.sf.y / G; this.ny = this.sf.x / G; this.nx = -this.sf.z / G;
    if (!this.onGround && (this.nz > 2.6 || this.nz < -1.1)) this._damage('overstress');
    if (this.ias > 350 + 15 || this.mach > 0.86) this.overspeed = 1; else this.overspeed = 0;
    // ---- where are we on the route ----
    this._track(dt);
    // ---- the cabin feels every physics step ----
    if (this.onSubstep) this.onSubstep(dt);
  }

  // radio altitude: height of the main-gear contact point (of the belly with the gear up)
  _lowestGear() {
    return this.gear > 0.5 ? this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t2).y : this.worldPoint(0, -1.25, 10, this._t2).y + 2.15;
  }

  // ---------------- gear, tyres, brakes, structure strikes ----------------
  _ground(dt, fx, fz) {
    const out = this._gr || (this._gr = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
    out.fx = out.fy = out.fz = out.mx = out.my = out.mz = 0;
    const W = this.mass * G;
    const mu = this.wet ? 0.5 : 0.8, muBrake = this.wet ? 0.22 : 0.45;
    let anyWow = false, structure = false;
    const sfx = Math.sin(this.steer), cfx = Math.cos(this.steer);
    for (let i = 0; i < 3; i++) {
      const g = GEAR[i];
      this.wow[i] = false;
      if (this.gear < 0.98 || this.gearCollapsed[i]) { this.strutC[i] = 0; continue; }
      const r = rot(this.Q, g.p[0] - CG[0], g.p[1] - CG[1], g.p[2] - CG[2], this._rr || (this._rr = {}));
      const py = this.P.y + r.y;
      const c = g.defl - py; // strut compression
      if (c <= 0) { this.strutC[i] = 0; continue; }
      anyWow = true; this.wow[i] = true;
      // contact point velocity v + w x r (w in world)
      const wv = rot(this.Q, this.q, -this.r, -this.p, this._wv || (this._wv = {}));
      const cvx = this.V.x + wv.y * r.z - wv.z * r.y, cvy = this.V.y + wv.z * r.x - wv.x * r.z, cvz = this.V.z + wv.x * r.y - wv.y * r.x;
      const k = g.load * W / g.defl, d = 2 * 0.55 * Math.sqrt(k * this.mass * g.load);
      let Fn = k * c - d * cvy * Math.min(1, c / 0.06); // tyre then oleo: damping builds up with stroke
      const stroke = 0.5;
      if (c > stroke) Fn += k * 30 * (c - stroke); // bottoming out
      Fn = Math.max(0, Fn);
      // hard-landing bookkeeping: sink rate at contact
      if (!this._contact[i]) {
        this._contact[i] = true; this.contactSink[i] = -cvy;
        // oleo design limit ~10 ft/s at landing weight; well beyond it the gear fails
        const lim = g.steer ? 4.2 : 4.9;
        if (-cvy > lim && !this.gearCollapsed[i]) { this.gearCollapsed[i] = true; this._damage(`gear-${g.name}`); this.emit('gear-collapse'); }
      }
      // wheel directions on the ground
      let lx = fx, lz = fz;
      if (g.steer) { lx = fx * cfx - fz * sfx; lz = fz * cfx + fx * sfx; }
      const vl = cvx * lx + cvz * lz, vlat = cvx * -lz + cvz * lx;
      const brakeK = g.brake ? (this.parkBrake ? 1 : this.brake) * muBrake * (this.hyd.green || this.hyd.yellow ? 1 : 0.4) : 0;
      const Flong = -(0.010 + brakeK) * Fn * Math.tanh(vl / 0.12);
      const Flat = -mu * Fn * Math.tanh(vlat / 0.12);
      const Fx = lx * Flong + -lz * Flat, Fz = lz * Flong + lx * Flat, Fy = Fn;
      out.fx += Fx; out.fy += Fy; out.fz += Fz;
      out.mx += r.y * Fz - r.z * Fy; out.my += r.z * Fx - r.x * Fz; out.mz += r.x * Fy - r.y * Fx;
      this.strutC[i] = c;
    }
    for (let i = 0; i < 3; i++) if (!this.wow[i]) this._contact[i] = false;
    // structure touching the ground: friction and a hard stop
    for (const sp of STRIKE) {
      const r = rot(this.Q, sp.p[0] - CG[0], sp.p[1] - CG[1], sp.p[2] - CG[2], this._rs || (this._rs = {}));
      const py = this.P.y + r.y;
      if (py >= 0) continue;
      const wv = rot(this.Q, this.q, -this.r, -this.p, this._wv2 || (this._wv2 = {}));
      const cvx = this.V.x + wv.y * r.z - wv.z * r.y, cvy = this.V.y + wv.z * r.x - wv.x * r.z, cvz = this.V.z + wv.x * r.y - wv.y * r.x;
      const k = W * 6, Fn = Math.max(0, -py * k - cvy * W * 1.5);
      const hs = Math.hypot(cvx, cvz) + 1e-3;
      const Fx = -cvx / hs * 0.45 * Fn * Math.tanh(hs / 0.3), Fz = -cvz / hs * 0.45 * Fn * Math.tanh(hs / 0.3);
      out.fx += Fx; out.fy += Fn; out.fz += Fz;
      out.mx += r.y * Fz - r.z * Fn; out.my += r.z * Fx - r.x * Fz; out.mz += r.x * Fn - r.y * Fx;
      this._strike(sp.name, -cvy, hs);
      anyWow = true; structure = true;
    }
    this.onGround = anyWow && (this.wow[1] || this.wow[2] || structure || this.gearCollapsed.some(Boolean));
    return out;
  }

  _strike(name, sink, speed) {
    const key = `strike-${name}`;
    if (!this.damage[key]) {
      this.damage[key] = { sink, speed, t: this.t };
      this.emit(key);
      if (name === 'tail' && sink < 3 && speed < 110) this.emit('tailstrike');
    }
    // an impact is a crash when the fuselage, nose or a wing hits hard or fast
    const gearDown = this.gear > 0.98 && !this.gearCollapsed[1] && !this.gearCollapsed[2];
    const severe = ((name === 'belly' || name === 'nose' || name.startsWith('wingtip')) && (sink > 3 || speed > 40))
      || (!gearDown && speed > 15 && name !== 'tail'); // sliding on the belly or the engines: a crash-landing
    if ((severe || sink > 8) && !this.crashed) {
      this.crashed = true; this.crashT = this.t; this.crashSpeed = speed; this.crashSink = sink; this.crashPart = name;
      // a controlled belly landing or runway excursion is survivable; a high-energy impact is not
      this.survivable = sink < 6 && speed < 95 && !(name.startsWith('wingtip') && sink > 3);
      this.emit('crash');
    }
  }

  _damage(what) { if (!this.damage[what]) { this.damage[what] = { t: this.t }; this.emit(`damage-${what}`); } }

  // ---------------- systems: flaps, gear, spoilers, reversers, engines, pressurisation ----------------
  _systems(dt) {
    const cfgT = CONFIGS[this.cfgTarget];
    // flaps are driven by green and yellow, slats by green and blue: with one of the pair lost they run at half speed
    const flapRate = 0.75 * ((this.hyd.green ? 1 : 0) + (this.hyd.yellow ? 1 : 0));
    const slatRate = 0.8 * ((this.hyd.green ? 1 : 0) + (this.hyd.blue ? 1 : 0));
    this.slat += clamp(cfgT.slat - this.slat, -slatRate * dt, slatRate * dt);
    if (!this.flapJam) this.flap += clamp(cfgT.flap - this.flap, -flapRate * dt, flapRate * dt);
    this.flapsMoving = Math.abs(cfgT.flap - this.flap) > 0.05 && !this.flapJam || Math.abs(cfgT.slat - this.slat) > 0.05;
    if (!this.flapsMoving) this.cfg = this.cfgTarget;
    const gPrev = this.gear;
    const gearRate = this.hyd.green ? 1 / 9 : 1 / 25; // gravity extension without green hydraulics
    if (this.gearCmd < this.gear && !this.hyd.green) { /* cannot retract */ } else this.gear += clamp(this.gearCmd - this.gear, -dt * gearRate, dt * gearRate);
    this.gearMoving = Math.abs(this.gear - gPrev) > 1e-7;
    this.spoiler += clamp(this.spoilerCmd - this.spoiler, -dt * 0.6, dt * 1.2);
    this.groundSpoiler += clamp((this.gspCmd ? 1 : 0) - this.groundSpoiler, -dt * 1.0, dt * 3.0);
    this.reverse += clamp(this.reverseCmd - this.reverse, -dt / 2, dt / 1.8);
    for (let i = 0; i < 2; i++) {
      if (this.engFail[i]) { this.n1[i] += (0.06 * clamp(this.ias / 250, 0, 1.2) * (this.engFail[i] === 2 ? 0.1 : 1) - this.n1[i]) * dt * 0.4; this.engineRunning[i] = false; continue; }
      const cmd = this.engineRunning[i] ? this.n1Cmd[i] : 0;
      const n = this.n1[i];
      const up = cmd > n;
      const rate = up ? (n < 0.5 ? 0.075 : 0.19) : (this.engineRunning[i] ? 0.22 : 0.05);
      this.n1[i] += clamp((cmd - n) * (up ? 1.4 : 1.1), -rate, rate) * dt;
    }
    // cabin pressure: schedule ~ 8000 ft cabin at FL360, leak to outside if pressurisation is lost
    const h = Math.max(0, this.P.y);
    this.cabinAltTarget = this.pressurised ? Math.min(h, h * 0.22 + 0) : h;
    const leak = this.pressurised ? 2.5 : 30 + this.pressLeak * 400;
    this.cabinAlt += clamp(this.cabinAltTarget - this.cabinAlt, -leak * dt * 1.5, leak * dt);
  }

  // ---------------- the crew: guidance, autopilot, autothrust, fly-by-wire ----------------
  _pilot(dt, theta, phi, psi, alpha, beta, qbar, Va, mach, air) {
    const m = this.m, ap = this.ap;
    const gs = Math.hypot(this.V.x, this.V.z);
    const onG = this.onGround && !this.crashed;
    const d2td = this._d2td();
    this.distToGo = m.stand - this.s;
    const idleAir = this.cfg > 0 || this.gear > 0.5 ? 0.30 : 0.26;
    let qCmd = null, bankCmd = 0, thrMode = 'n1', n1Target = 0.205, vGround = null;
    let steerMode = null;
    this.gspCmd = false;
    if (this.crashed) { this.n1Cmd = [0, 0]; this.engineRunning = [false, false]; this.brake = 1; this.de = 0; this.da = 0; this.dr = 0; this.steer = 0; if (gs < 0.5 && this.onGround) { this._stopT = (this._stopT || 0) + dt; this.crashStopped = this._stopT > 2; } return; }
    switch (this.phase) {
      case 'parked':
        vGround = 0; this.parkBrake = true; n1Target = 0.205;
        if (this.clearTaxi) { this.phase = 'taxi-out'; this.parkBrake = false; this.emit('taxi-start'); }
        break;
      case 'taxi-out':
        vGround = Math.min(this._speedLimitTaxi(), this._stopAt(m.hold, 9, 0.55)); steerMode = 'taxi';
        if (this.s > m.hold - 1.5 && gs < 0.3) { this.phase = 'hold'; this.emit('holding-point'); }
        break;
      case 'hold':
        vGround = 0; this.parkBrake = gs < 0.2;
        if (this.clearLineup) { this.phase = 'lineup'; this.parkBrake = false; this.emit('lineup-start'); }
        break;
      case 'lineup':
        vGround = Math.min(this._speedLimitTaxi() * 0.85, this._stopAt(m.lineup, 7, 0.5)); steerMode = 'taxi';
        if (this.s > m.lineup - 1.5 && gs < 0.25 && this.clearTakeoff) { this.phase = 'takeoff'; this.holdTimer = 0; this.emit('takeoff-roll'); }
        break;
      case 'takeoff': {
        this.holdTimer += dt; this.parkBrake = false; this.brake = 0; steerMode = 'runway';
        thrMode = 'n1'; n1Target = this.holdTimer < 3.5 ? 0.5 : (this.toga ? 0.95 : 0.855);
        if (this.ias > 80) this.once('80kt', true);
        if (this.rejectT) { // rejected take-off: idle, max brakes, reversers
          n1Target = 0.205; this.brake = 1; this.gspCmd = true; this.reverseCmd = gs > 15 ? 1 : 0;
          if (gs < 1) { this.phase = 'rto-stop'; this.reverseCmd = 0; this.parkBrake = true; this.emit('rto-stopped'); }
          break;
        }
        if (this.ias >= VR && !this.rotating) { this.rotating = true; this.emit('rotate'); }
        if (this.rotating) { qCmd = theta < 12.5 * DEG ? 3 * DEG : clamp((15 * DEG - theta) * 1.2, -1 * DEG, 2 * DEG); this._rollLevel = true; }
        if (this.rotating && !this.wow[1] && !this.wow[2] && !this.wow[0]) {
          this._airT = (this._airT || 0) + dt;
          if (this._airT > 0.4) { this.phase = 'climb'; this.liftoffT = this.t; this.emit('liftoff'); ap.mode = 'srs'; }
        } else this._airT = 0;
        break;
      }
      case 'rto-stop': case 'runway-stop': vGround = 0; this.parkBrake = true; n1Target = this.phase === 'runway-stop' && this.evacuating ? 0 : 0.205; if (this.evacuating) this.engineRunning = [false, false]; break;
      default: break;
    }

    // ---------------- airborne modes ----------------
    // both engines failed: nothing else matters but the glide
    if (this.engFail[0] && this.engFail[1] && !this.onGround && this.phase !== 'forced' && this.phase !== 'flare') { this.phase = 'forced'; this.emit('forced-landing'); }
    const airborne = ['climb', 'cruise', 'descent', 'approach', 'flare', 'go-around', 'emergency', 'forced'].includes(this.phase);
    if (airborne) {
      const agl = this.agl;
      let iasCmd = 250, gammaCmd = null, thr = 'speed';
      const tAir = this.t - this.liftoffT;
      if (this.phase === 'climb' || this.phase === 'go-around') {
        const ga = this.phase === 'go-around';
        if (agl < 460 + (ga ? 0 : 0)) { iasCmd = ga ? VAPP + 10 : V2 + 10; thr = ga || this.toga ? 'toga' : 'flex'; }
        else {
          this.once(ga ? 'ga-thrust-reduction' : 'thrust-reduction', true);
          thr = 'clb';
          iasCmd = this.P.y < 3048 ? 250 : 290;
          if (this.cfgTarget > 0) iasCmd = this.cfgTarget >= 2 ? 195 : 225; // accelerate through F and S speeds
        }
        if (this.P.y > 3048) iasCmd = Math.min(iasCmd, this._iasForMach(0.78, air));
        if (ga && this._gaLevel) iasCmd = this.cfgTarget > 0 ? 190 : 210; // circuit at green-dot speed
        if (!ga && tAir > 3.5 && this.vs > 1.5) { this.gearCmd = 0; this.once('gear-up', true); }
        if (ga && this.vs > 1.5 && tAir > 2) { this.gearCmd = 0; this.once('ga-gear-up', true); }
        if (!ga) {
          if (this.ias > 180 && this.cfgTarget > 1 && agl > 460) { this.setConfig(1); this.emit('flaps'); }
          if (this.ias > 212 && this.cfgTarget > 0 && agl > 460) { this.setConfig(0); this.emit('flaps'); }
        } else {
          if (this.cfgTarget === 5 && tAir > 1) this.setConfig(4);
          if (agl > 400 && this.ias > 175 && this.cfgTarget > 1) this.setConfig(1);
          if (this.ias > 205 && this.cfgTarget > 0 && agl > 450) this.setConfig(0);
        }
        const altT = ga ? this.gaAlt : (this.levelOff ?? CRUISE_ALT);
        // altitude capture: blend to a path mode when close to the target level
        const toAlt = altT - this.P.y;
        if (toAlt < Math.max(60, this.vs * 12)) { thr = 'speed'; gammaCmd = Math.asin(clamp(clamp(toAlt * 0.08, -6, 6) / Va, -0.2, 0.2)); }
        if (!ga && toAlt < 15) { this.phase = 'cruise'; this.emit('top-of-climb'); }
        if (ga && toAlt < 20 && !this._gaLevel) { this._gaLevel = true; this.emit('ga-level'); }
        // start the descent from the climb on a short sector
        if (!ga && this.descentProfile(d2td) < this.P.y - 20 && tAir > 120) { this.phase = 'descent'; this.emit('top-of-descent'); }
        if (ga && this._gaLevel && this.descentProfile(d2td) <= this.P.y + 15 && d2td < 26000) { this.phase = 'approach'; this._gate1000 = false; this.emit('ga-rejoin'); }
        this.once('passing-10000-climb', !ga && this.P.y > 3048);
      }
      if (this.phase === 'cruise') {
        iasCmd = Math.min(this.P.y < 3048 ? 250 : 300, this._iasForMach(0.78, air)); thr = 'speed';
        const target = this.levelOff ?? CRUISE_ALT;
        gammaCmd = Math.asin(clamp(clamp((target - this.P.y) * 0.06, -5, 5) / Va, -0.1, 0.1));
        if (this.descentProfile(d2td) < this.P.y - 20) { this.phase = 'descent'; this.emit('top-of-descent'); }
      }
      if (this.phase === 'descent' || this.phase === 'approach') {
        const hPath = this.descentProfile(d2td);
        const err = hPath - this.P.y;
        const vsPath = -(gs * this.descentSlope(d2td));
        let vsCmd = clamp(vsPath + err * 0.035, -22, 3);
        iasCmd = this.P.y > 3100 ? Math.min(290, this._iasForMach(0.78, air)) : 250;
        if (d2td < 42000) iasCmd = 220;
        if (d2td < 30000) iasCmd = 200;
        if (d2td < 22000) iasCmd = 180;
        if (d2td < 16500) iasCmd = 160;
        if (d2td < 12000) iasCmd = 145;
        if (d2td < 9000) iasCmd = this._vapp(gs);
        // too fast to follow the path: shallow the descent (speed priority) above 3000 ft
        if (this.ias > iasCmd + 12 && this.P.y > 900) vsCmd = Math.max(vsCmd, vsPath * 0.6);
        gammaCmd = Math.asin(clamp(vsCmd / Va, -0.2, 0.1));
        thr = 'speed';
        if (d2td < 30000 && this.phase === 'descent') { this.phase = 'approach'; this.emit('approach'); }
        // configuration schedule, respecting VFE
        const ldgCfg = this._landingCfg();
        const want = Math.min(ldgCfg, d2td < 10000 ? 5 : d2td < 12500 ? 4 : d2td < 19000 ? 3 : d2td < 28000 ? 1 : 0);
        if (want > this.cfgTarget && this.ias < AERO[want].vfe - 4) { this.setConfig(this.cfgTarget + 1 < want && this.ias < AERO[this.cfgTarget + 1].vfe - 4 ? this.cfgTarget + 1 : want); this.emit('flaps'); }
        if (d2td < 14500 && this.ias < 250) { if (this.gearCmd < 1) { this.gearCmd = 1; this.once('gear-down', true); } }
        this.once('passing-10000-descent', this.P.y < 3048);
        // stabilised approach gate at 1000 ft
        if (this.phase === 'approach' && agl < 305 && !this._gate1000) {
          this._gate1000 = true;
          const ok = this.cfgTarget === this._landingCfg() && this.gear > 0.98 && Math.abs(this.ias - this._vapp(gs)) < 15 && this.vs > -6 && Math.abs(err) < 45;
          if (!ok && !this.noGoAround) this.goAround('unstable');
          else this.emit('stable');
        }
        if (agl < 16 && this.phase === 'approach') { this.phase = 'flare'; this.emit('flare'); }
      }
      if (this.phase === 'flare') {
        iasCmd = this._vapp(gs) - 5;
        // exponential flare: sink rate proportional to height, aiming for ~0.5 m/s at the mains
        const tau = 4.2, hOff = 0.5 * tau;
        const vsCmd = -(Math.max(0, agl) + hOff) / tau;
        gammaCmd = Math.asin(clamp(vsCmd / Va, -0.2, 0.1));
        thr = agl < 7 ? 'idle' : 'speed';
        if (agl < 7) this.once('retard', true);
      }
      if (this.phase === 'forced') { // both engines out: glide at best L/D, then a forced landing straight ahead
        thr = 'idle'; gammaCmd = null;
        iasCmd = agl > 600 ? 215 : agl > 250 ? 175 : this._vapp(gs) + 10;
        if (agl < 600 && this.cfgTarget < 3 && this.ias < 190) { this.setConfig(this.cfgTarget + 1); this.emit('flaps'); }
        this.gearCmd = this.ditch === false ? 1 : 0;
        // flare earlier the faster we are sinking (a glide with no thrust comes down steeply)
        if (agl < Math.max(16, -this.vs * 5) || this._forcedFlare) {
          const tau = 3.2, vsCmd = -(Math.max(0, agl) + 1.5) / tau;
          gammaCmd = Math.asin(clamp(vsCmd / Va, -0.2, 0.1));
          this._forcedFlare = true;
        }
      }
      if (this.phase === 'emergency') { // emergency descent: idle, speedbrakes, turn off the airway
        iasCmd = Math.min(310, this._iasForMach(0.8, air)); thr = 'idle';
        this.spoilerCmd = 1;
        gammaCmd = null;
        if (this.P.y < (this.emergAlt ?? 3048) + 150) { this.spoilerCmd = 0; this.phase = 'descent'; this.emit('emergency-level'); this.levelOff = this.emergAlt ?? 3048; }
      }
      // windshear escape: full thrust, pitch to the protected alpha, until climbing out of it
      if (this.shearEscape) {
        thr = 'toga'; gammaCmd = null; iasCmd = 0;
        this._shT = (this._shT || 0) + dt;
        if ((this._shT > 12 && this.vs > 4 && this.ias > 140) || agl > 450) { this.shearEscape = false; this._shT = 0; this.emit('shear-clear'); }
      }
      ap.iasCmd = iasCmd; ap.thr = thr;
      // ----- total energy control -----
      const Vc = this._tasForIas(iasCmd, air);
      const aDes = clamp(0.06 * (Vc - Va), -0.6, 0.6);
      const Tnow = this.thrust[0] + this.thrust[1];
      const mg = this.mass * G;
      const gamma = Math.asin(clamp(this.V.y / Math.max(Va, 1), -1, 1));
      this.gamma = gamma;
      const engOut = (this.engFail[0] ? 1 : 0) + (this.engFail[1] ? 1 : 0);
      const n1Max = { toga: 0.97, flex: 0.855, clb: 0.885, idle: idleAir, speed: 0.885 }[thr] ?? 0.885;
      if (gammaCmd == null) {
        // speed on pitch: the flight path follows from the thrust available
        gammaCmd = (Tnow - this.drag) / mg - aDes / G;
        if (this.shearEscape) gammaCmd = 0.22; // the alpha protection limits how much of this is achievable
        gammaCmd = clamp(gammaCmd, -0.2, this.phase === 'climb' && tAir < 30 ? 0.3 : 0.25);
        n1Target = thr === 'idle' ? idleAir : n1Max;
      } else {
        const Treq = this.drag + mg * Math.sin(gammaCmd) + this.mass * aDes;
        const perEng = Treq / Math.max(1, 2 - engOut);
        n1Target = thr === 'idle' ? idleAir : clamp(n1ForThrust(perEng, air.sigma, mach), idleAir, 0.97);
        // thrust at idle and still fast: speedbrakes (not with FULL flaps or near the ground)
        if (this.phase !== 'emergency') {
          const fast = this.ias - iasCmd;
          this.spoilerCmd = (n1Target <= idleAir + 0.005 && fast > 6 && agl > 300 && this.cfgTarget < 4) ? clamp((fast - 6) / 12, 0, 1) : 0;
        }
      }
      // alpha floor: TOGA when the angle of attack is dangerously high (normal law)
      if (this.law === 'normal' && agl > 30 && alpha > (this._aeroTmp.as - 3.5) * DEG) { n1Target = 0.97; this.once('alpha-floor', true); }
      thrMode = 'n1';
      // flight path -> pitch rate (limited to comfortable load factors)
      const flare = this.phase === 'flare';
      const nzLim = flare || this._forcedFlare ? 0.35 : this.shearEscape || this.phase === 'go-around' || this.phase === 'forced' ? 0.3 : 0.12;
      const gff = this._gcPrev != null && dt > 0 ? clamp((gammaCmd - this._gcPrev) / dt, -0.05, 0.05) : 0;
      this._gcPrev = gammaCmd;
      const fl = flare || this._forcedFlare;
      // a level turn needs a steady nose-up pitch rate (g/V tan(phi) sin(phi)); the Airbus pitch law
      // compensates for bank automatically up to 33 degrees
      const phiC = clamp(phi, -33 * DEG, 33 * DEG);
      const qTurn = G / Math.max(Va, 40) * Math.tan(phiC) * Math.sin(phiC);
      qCmd = clamp((fl ? 1.0 : 0.45) * (gammaCmd - gamma) + (fl ? gff : 0), -nzLim * G / Va, nzLim * G / Va) + qTurn;
      // pitch attitude and alpha protections
      if (this.law === 'normal') {
        const aProt = (this._aeroTmp.as - 3) * DEG;
        if (alpha > aProt) qCmd = Math.min(qCmd, -(alpha - aProt) * 1.5);
        if (theta > 25 * DEG) qCmd = Math.min(qCmd, 0);
        if (theta < -13 * DEG) qCmd = Math.max(qCmd, 0);
      }
      // ----- lateral guidance -----
      bankCmd = this._lateral(Va, gs);
      if (this.phase === 'flare' && agl < 6) bankCmd *= 0.3;
    }

    // ---------------- ground rollout & taxi-in ----------------
    if (this.phase === 'rollout') {
      const tt = this.t - this.touchdownT;
      steerMode = 'runway'; this.gspCmd = true; this.spoilerCmd = 0;
      // de-rotation, then nose wheel on the ground
      if (!this.wow[0]) qCmd = clamp(-1.8 * DEG - this.q * 0.5, -3 * DEG, 0);
      if (tt > 1.0 && gs > 36 && !this.noReverse) this.reverseCmd = 1; else if (gs < 16) this.reverseCmd = 0;
      n1Target = this.reverseCmd ? (gs > 36 ? 0.72 : 0.35) : 0.205;
      // autobrake LO to the exit, then taxi speed
      const exitV = 12;
      const need = this._stopAt(m.exit + 40, 80, 1.9);
      vGround = Math.max(exitV, Math.min(need, gs));
      // autobrake LO (1.7 m/s2, 4 s after the ground spoilers) normally, MED (3 m/s2, after 2 s) after an abnormal;
      // without green hydraulics there is no autobrake and the pilots brake by hand on the yellow alternate brakes
      const med = this.abMed || this.airport || !this.hyd.green;
      this.autobrake = tt > (med ? 2 : 4) ? (med ? 3.0 : 1.7) : 0;
      if (gs <= exitV + 0.3) { this.reverseCmd = 0; }
      // after some emergencies the crew stops straight ahead on the runway for the fire services
      if (this.stopOnRunway && tt > 3) { vGround = 0; this.autobrake = 3.0; if (gs < 0.3) { this.phase = 'runway-stop'; this.parkBrake = true; this.reverseCmd = 0; this.emit('stopped-on-runway'); } }
      else if (this.s > m.exit - 10) { this.phase = 'taxi-in'; this.gspCmd = false; this.emit('vacated'); this.setConfig(0); this.autobrake = 0; }
      if (this.bounceT && this.t - this.bounceT < 2) this.gspCmd = true;
    }
    if (this.phase === 'taxi-in') {
      this.spoilerCmd = 0; this.reverseCmd = 0; steerMode = 'taxi';
      vGround = Math.min(this._speedLimitTaxi(), this._stopAt(m.stand, 9, 0.45));
      if (this.t - this.touchdownT > 150 && this.engineRunning[1] && !this.engFail[0] && !this.engFail[1]) { this.engineRunning[1] = false; this.emit('engine2-shutdown'); }
      if (this.s >= m.stand - 0.6 && gs < 0.15) { this.phase = 'arrived'; this.parkBrake = true; this.emit('parked'); }
    }
    if (this.phase === 'arrived') {
      vGround = 0; this.parkBrake = true;
      if (this.engineRunning[0] && this._flags.shutdown) this.engineRunning[0] = false;
      n1Target = 0.205;
    }

    // ---------------- ground speed control: thrust and brakes ----------------
    if (vGround != null && this.phase !== 'takeoff') {
      const dv = vGround - gs;
      if (this.phase === 'rollout') {
        // autobrake: hold the selected deceleration, ease off at the exit speed
        const decel = -this._accLong;
        this._abI = clamp((this._abI || 0) + (this.autobrake > 0 && gs > vGround + 0.5 ? (this.autobrake - decel) : -2) * dt * 0.6, 0, 1);
        this.brake = this.autobrake > 0 && gs > vGround + 0.5 ? clamp(this._abI + 0.15, 0, 1) : clamp(-dv * 0.4, 0, 1);
      } else {
        this._taxiI = clamp((this._taxiI || 0) + (dv > 0 ? dv : dv * 3) * dt * 0.02, 0, 0.12);
        n1Target = vGround < 0.05 ? 0.205 : clamp(0.205 + 0.03 * dv + this._taxiI + (gs < 0.6 && vGround > 1.5 ? 0.11 : 0), 0.205, 0.42);
        this.brake = dv < -0.4 ? clamp(-(dv + 0.4) * 0.35, 0, 1) : 0;
        if (vGround < 0.05 && gs < 0.5) this.brake = 1;
      }
    }
    // engines
    for (let i = 0; i < 2; i++) {
      let t = n1Target;
      if (this.phase === 'taxi-in' && i === 1 && !this.engineRunning[1]) t = 0;
      this.n1Cmd[i] = this.engFail[i] ? 0 : t;
    }
    if (this.phase === 'taxi-in' && !this.engineRunning[1]) this.n1Cmd[0] = Math.min(0.5, n1Target + 0.03);

    // ---------------- nose-wheel steering ----------------
    if (onG && steerMode) this.steer = this._steerTo(steerMode, gs, dt);
    else this.steer += (0 - this.steer) * Math.min(1, dt * 2);

    // ---------------- fly-by-wire control laws ----------------
    const Vq = Math.max(qbar, 400);
    if (qCmd != null) {
      const Kq = clamp(3.2 * 9000 / Vq, 1.5, 16);
      const direct = this.law === 'direct';
      this.de = clamp(-Kq * (qCmd - this.q) - (direct ? 0 : 0), -30 * DEG, 17 * DEG);
      // automatic stabiliser trim offloads the elevator (not on the ground, not in direct law)
      if (!onG && !direct) this.ths += clamp(this.de * 0.25, -0.35 * DEG, 0.35 * DEG) * dt;
      this.ths = clamp(this.ths, -13.5 * DEG, 4 * DEG);
    } else {
      this.de += (0 - this.de) * Math.min(1, dt * 3);
      if (onG && this.phase !== 'rollout' && this.phase !== 'taxi-in' && this.phase !== 'arrived') this.ths += (this._toTrim() - this.ths) * Math.min(1, dt * 0.5);
    }
    // roll: rate command towards the bank target, bank protection at 67 degrees
    const airb = !onG || this._rollLevel;
    if (this.phase !== 'takeoff') this._rollLevel = false;
    if (airb) {
      const pMax = this.phase === 'go-around' || this.shearEscape ? 10 * DEG : 5.5 * DEG;
      let pCmd = clamp(1.1 * (bankCmd - phi), -pMax, pMax);
      if (this.law === 'normal' && Math.abs(phi) > 33 * DEG) pCmd -= (phi - Math.sign(phi) * 33 * DEG) * 0.8;
      const Kp = clamp(1.6 * 9000 / Vq, 0.4, 10);
      const e = pCmd - this.p;
      this._ia = clamp(this._ia + e * dt * 0.6, -0.25, 0.25);
      this.da = clamp(Kp * e + this._ia * Kp, -25 * DEG, 25 * DEG);
      // yaw damper, turn coordination, and rudder for engine-out asymmetry
      const rCmd = G * Math.sin(phi) / Math.max(Va, 30);
      this._ir = clamp(this._ir + beta * dt * 0.8, -0.35, 0.35);
      const rudLim = lerp(30, 3.5, smoothstep(160, 380, this.ias)) * DEG;
      this.dr = clamp(clamp(2.5 * 9000 / Vq, 0.3, 10) * (1.2 * beta + 0.9 * (rCmd - this.r)) + this._ir * 3, -rudLim, rudLim);
    } else {
      this._ia *= 0.9; this._ir *= 0.9;
      this.da += (0 - this.da) * Math.min(1, dt * 3);
      // rudder follows the nose-wheel steering on the take-off and landing roll
      this.dr = clamp(this.steer * 3, -30 * DEG, 30 * DEG) * smoothstep(20, 60, this.ias);
    }
    if (this.law === 'direct') this.da *= 0.8;
    this.ctrl.ail = this.da / (25 * DEG); this.ctrl.elev = this.de / (25 * DEG); this.ctrl.rud = this.dr / (30 * DEG);
  }

  // Approach speed: VLS + max(5 kt, a third of the headwind), limited to +15 kt, then Airbus
  // "ground speed mini": the target rises when a gust increases the headwind, keeping energy.
  _vapp(gs) {
    if (this._vappBase == null) {
      const rw = this.atmo.runwayWind(this.path.sample(this.m.touchdown, {}).heading, 10);
      this._towerHead = rw.head / KT;
      this._vappBase = 132 + clamp(Math.max(5, this._towerHead / 3 + this.atmo.sigma * 2), 5, 15);
    }
    const gsMini = this._vappBase - Math.max(0, this._towerHead);
    const headNow = this.ias - gs / KT;
    return clamp(Math.max(this._vappBase, gsMini + headNow), this._vappBase, this._vappBase + 15);
  }

  // CONF FULL normally and with one engine out; CONF 3 with jammed flaps or no green and yellow hydraulics
  _landingCfg() { return this.flapJam || !(this.hyd.green || this.hyd.yellow) ? 4 : 5; }

  // Divert the rest of the flight onto another route (e.g. back to Arlanda).
  divert(route) {
    this.path = route.path; this.m = route.m; this.proc = null; this.airport = route.airport;
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], {});
    this.s = 0; for (let k = 0; k < 4; k++) { const tp = this.path.sample(this.s, this._tmp); this.s = clamp(this.s + (G2.x - tp.x) * tp.dx + (G2.z - tp.z) * tp.dz, 0, this.path.length); }
    this.levelOff = Math.min(this.levelOff ?? CRUISE_ALT, 914);
    this._vappBase = null; this._gate1000 = false;
    if (this.phase === 'cruise' || this.phase === 'descent') this.phase = this.P.y > 1000 ? 'descent' : 'cruise';
    this.emit('diverted');
  }

  _toTrim() { return lerp(-2.5, -1.0, (this.mass - 55000) / 20000) * DEG; }

  _lateral(Va, gs) {
    const path = this.proc || this.path, sref = this.proc ? this.procS : this.s;
    const tp = path.sample(sref, this._tmp);
    const nx = -tp.dz, nz = tp.dx; // right-hand normal
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t2);
    const e = (G2.x - tp.x) * nx + (G2.z - tp.z) * nz; // + right of path
    const look = path.sample(sref + Math.max(120, gs * 4), this._t3 || (this._t3 = {}));
    const chiPath = look.heading;
    const chi = Math.atan2(this.V.x, -this.V.z);
    const final = !this.proc && this._d2td() < 16000;
    const L = final ? Math.max(700, gs * 10) : Math.max(1500, gs * 18);
    const chiDes = chiPath - Math.atan(e / L);
    const dchi = angleDiff(chiDes, chi);
    const kk = path.sample(sref + gs * 2, this._t4 || (this._t4 = {})).k;
    const ff = Math.atan(gs * gs * kk / G);
    const turnRate = clamp(dchi * 0.18, -3 * DEG, 3 * DEG);
    let bank = ff + Math.atan(gs * turnRate / G);
    const lim = this.agl < 150 ? 10 * DEG : final ? 18 * DEG : 25 * DEG;
    bank = clamp(bank, -lim, lim);
    this.xtk = e;
    return bank;
  }

  _procGuidance() { /* the procedure path is flown by _lateral; vertical handled by the go-around mode */ }

  _steerTo(mode, gs, dt) {
    const Ld = mode === 'runway' ? clamp(gs * 3, 40, 260) : clamp(6 + gs * 2.2, 12, 34);
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t2);
    const tp = this.path.sample(this.s + Ld, this._tmp);
    const dx = tp.x - G2.x, dz = tp.z - G2.z;
    const bearing = Math.atan2(dx, -dz);
    const eta = angleDiff(bearing, this.heading);
    const dist = Math.max(4, Math.hypot(dx, dz));
    let d = Math.atan(2 * WHEELBASE * Math.sin(eta) / dist);
    const lim = gs < 8 ? 70 * DEG : lerp(70, 6, clamp((gs - 8) / 18, 0, 1)) * DEG;
    d = clamp(d, -lim, lim);
    return this.steer + clamp(d - this.steer, -30 * DEG * dt, 30 * DEG * dt);
  }

  _speedLimitTaxi() {
    const k = this.path.maxCurvatureAhead(this.s, 70);
    const vTurn = k > 0 ? Math.sqrt(0.9 / k) : 99;
    return Math.min(8.8, Math.max(3.2, vTurn));
  }
  _stopAt(sStop, vMax, decel = 0.6) { const d = Math.max(0, sStop - this.s); return Math.min(vMax, Math.sqrt(2 * decel * d)); }
  _iasForMach(M, air) { const tas = M * air.a; return Math.sqrt(air.rho / 1.225) * tas / KT; }
  _tasForIas(ias, air) { return ias * KT / Math.sqrt(air.rho / 1.225); }
  _d2td() { return this.proc ? this.procRemain() : this.m.touchdown - this.s; }

  // Altitude (m) of the descent path as a function of distance to touchdown (as in the reference model).
  descentProfile(d) {
    const tan3 = Math.tan(3 * DEG);
    const d10 = 3048 / tan3;
    if (d < d10) return Math.max(0, d * tan3);
    if (d < d10 + 9000) return 3048;
    return 3048 + (d - d10 - 9000) * Math.tan(3.1 * DEG);
  }
  descentSlope(d) {
    const d10 = 3048 / Math.tan(3 * DEG);
    if (d < d10) return Math.tan(3 * DEG);
    if (d < d10 + 9000) return 0;
    return Math.tan(3.1 * DEG);
  }

  // ---------------- position along the route ----------------
  _track(dt) {
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t2);
    const gx = G2.x, gz = G2.z;
    if (this.proc) { // flying a procedure: follow it, and map progress to the main route's distance to go
      for (let k = 0; k < 2; k++) { const tp = this.proc.sample(this.procS, this._tmp); this.procS = clamp(this.procS + (gx - tp.x) * tp.dx + (gz - tp.z) * tp.dz, 0, this.proc.length); }
      if (this.procS >= this.proc.length - 50) { this.s = this.path.locate({ x: gx, y: gz }); this.proc = null; this.emit('procedure-end'); }
      else this.s = this.m.touchdown - this.procRemain();
      return;
    }
    for (let k = 0; k < 2; k++) {
      const tp = this.path.sample(this.s, this._tmp);
      this.s = clamp(this.s + (gx - tp.x) * tp.dx + (gz - tp.z) * tp.dz, 0, this.path.length);
    }
    // touchdown / bounce / liftoff bookkeeping
    const mainWow = this.wow[1] || this.wow[2];
    if ((this.phase === 'flare' || this.phase === 'approach' || this.phase === 'go-around') && mainWow && !this.crashed) {
      const sink = Math.max(this.contactSink[1] || 0, this.contactSink[2] || 0);
      if (this.phase === 'go-around') { this.emit('touch-and-go'); }
      else {
        this.phase = 'rollout'; this.touchdownT = this.t; this.touchdownSink = sink; this.touchdownS = this.s;
        this.thump = Math.min(1, sink / 2.2 + 0.3);
        this.emit('touchdown');
        if (sink > 3.05) this.emit('hard-landing');
        if (sink > 4.3) this._damage('hard-landing-severe');
      }
    }
    if (this.phase === 'rollout' && !mainWow && this.t - this.touchdownT < 5 && this.agl > 0.3 && !this.bounceT) { this.bounceT = this.t; this.emit('bounce'); }
  }

  procRemain() { return (this.proc.length - this.procS) + (this.procJoinD ?? 0); }

  // ---------------- abnormal procedures, used by the events system ----------------
  goAround(reason = 'unstable') {
    if (this.phase === 'go-around' || this.onGround || this.crashed) return false;
    this.phase = 'go-around'; this.liftoffT = this.t; this._gaLevel = false; this._gate1000 = false;
    this.gaAlt = 914; this.shearEscape = reason === 'windshear';
    this.goArounds = (this.goArounds || 0) + 1;
    this.emit('go-around'); this.emit(`go-around-${reason}`);
    this._buildCircuit();
    return true;
  }
  _buildCircuit() {
    // runway heading to 5 km past the threshold, left-hand circuit, rejoin the final 18 km out
    const thr = this.path.sample(this.m.thr, {}), td = this.path.sample(this.m.touchdown, {});
    const ux = td.dx, uz = td.dz, lx = uz, lz = -ux; // left of the runway direction
    const P0 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], {});
    const pt = (a, b) => new THREE.Vector2(thr.x + ux * a + lx * b, thr.z + uz * a + lz * b);
    const pts = [new THREE.Vector2(P0.x, P0.z), pt(7000, 0), pt(10000, 7000), pt(-11000, 7000), pt(-22000, 2500), pt(-24000, 0), pt(-15000, 0)];
    this.proc = new (this.path.constructor)(pts, [0, 3200, 3200, 3200, 3200, 2500, 0]);
    this.procS = 0; this.procJoinD = this.m.touchdown - this.m.thr + 14000;
  }
  rejectTakeoff() { if (this.phase === 'takeoff' && this.ias < 140) { this.rejectT = this.t; this._rtoV = this.ias; this.emit('rto'); return true; } return false; }
  failEngine(i, kind = 1) { this.engFail[i] = kind; this.engineRunning[i] = false; this.emit(`engine-failure-${i + 1}`); }
  depressurise(rate = 1) { this.pressurised = false; this.pressLeak = rate; this.emit('depressurisation'); }
  emergencyDescent(toAlt = 3048) { if (this.onGround) return; this.phase = 'emergency'; this.emergAlt = toAlt; this.emit('emergency-descent'); }

  // ---------------- outputs for the renderer, audio and cabin ----------------
  _outputs(dt) {
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t5 || (this._t5 = {}));
    this.pos.set(G2.x, Math.max(0, G2.y), G2.z);
    this.quat.set(this.Q.x, this.Q.y, this.Q.z, this.Q.w);
    this.h = Math.max(0, G2.y);
    this.gs = Math.hypot(this.V.x, this.V.z);
    this.v = this.onGround ? this.gs : Math.max(this.gs, this.tas * 0.9);
    this.vs = this.V.y;
    // longitudinal acceleration along the ground track, for autobrake and head motion
    const along = (this.V.x * Math.sin(this.heading) - this.V.z * Math.cos(this.heading));
    if (dt > 0) { this._accLong = (along - (this._lastAlong ?? along)) / dt; this._lastAlong = along; }
    this.brakeDecel = this.onGround ? Math.max(0, -(this._accLong || 0)) : 0;
    if (!this.sf) this.sf = { x: 0, y: G, z: 0 };
    this.accel.set(this.sf.x, this.sf.y - G * Math.cos(this.pitch) * Math.cos(this.bank), -this.sf.z);
    this.turbLevel = clamp(this.atmo.sigma / 2.2, 0, 2) * (this.onGround ? 0.2 : 1);
    this.bump = clamp((this.nz - 1) * 2.8, -3, 3);
    this.turbBank = 0; this.turbPitch = 0;
    this.rollRumble = this.onGround ? clamp(this.gs / 75, 0, 1) : 0;
    this.thump = Math.max(0, this.thump - (dt || 0) * 3);
    this.cfgf = this._cfgf();
  }
  _cfgf() {
    const f = this.flap, s = this.slat;
    if (f <= 0) return clamp(s / 18, 0, 1);
    if (f <= 10) return 1 + f / 10;
    if (f <= 15) return 2 + (f - 10) / 5;
    if (f <= 20) return 3 + (f - 15) / 5;
    return 4 + clamp((f - 20) / 15, 0, 1);
  }
}
export { G_LOCAL as GEAR_POINT, CG as CG_POINT, VAPP, VR, V2 };
