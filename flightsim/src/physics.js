// Physics-based A320neo: a rigid body with six degrees of freedom integrated at 120 Hz, plus the
// flexible modes of the wing and fuselage.
//
// Forces: lift, drag and side force from angle of attack, sideslip, flap/slat configuration,
// spoilers, gear and ground effect (with a real stall); LEAP-1A26 thrust that lapses with
// density and Mach, spools up and down, burns fuel and can fail; three oleo struts with
// tyre friction, brakes and nose-wheel steering; gravity. Moments: aerodynamic stability
// and damping derivatives, control surfaces, engine offset and gear loads.
//
// Nobody flies this aircraft but the crew (crew.js). The only inputs are the cockpit controls in
// `ctl`: sidesticks, rudder pedals and toe brakes, the nose-wheel tiller, the thrust levers with
// their detents, the flap, gear and speed-brake levers, the autobrake and parking brake. The
// fly-by-wire computers turn those into surface deflections with the Airbus control laws:
//   * normal law in flight: the sidestick demands load factor (+2.5/-1 g clean, +2/0 g with
//     flaps), neutral stick holds the flight path with automatic trim and bank compensation to
//     33 degrees; roll rate up to 15 degrees/s, bank held when released, 67 degrees maximum;
//     angle-of-attack, pitch-attitude, high-speed and load-factor protections;
//   * flare law below 50 ft: attitude memorised at 50 ft, then from 30 ft the aircraft lowers its
//     nose towards -2 degrees over 8 seconds, so the pilot has to flare with the stick;
//   * ground law: stick straight to the elevator, blended into flight law over 5 s after lift-off.
// The autopilot (autoflight.js) sends its orders to the same laws.
import * as THREE from 'three';
import { DEG, KT, FT, G, clamp, lerp, smoothstep, vnoise1 } from './core.js';
import { CONFIGS } from './flight.js';
import { Atmosphere, angleDiff } from './atmosphere.js';
import { Autoflight, DETENT, N1_RATING } from './autoflight.js';
import { NOSE_GEAR, MAIN_GEAR, WHEELBASE as WB, cgAt, ENGINE } from './airframe.js';

// ---------------- aircraft data ----------------
const S = 122.6, B = 35.8, CBAR = 4.19;
const OEW = 44300, TOW = 64500;
// moments of inertia of the empty aircraft (42.5 t; FlyByWire A32NX flight model): roll, pitch, yaw kg m2
const IXX0 = 1.341e6, IYY0 = 3.327e6, IZZ0 = 4.293e6;
const WHEELBASE = WB;               // 12.64 m
const T_MAX = 120600;               // N, LEAP-1A26 sea-level static
const DT = 1 / 120;
// aircraft-coordinate points (x right, y up, z aft; cabin floor y = 0) from airframe.js
const CG = [0, 0.5, cgAt(0.27)];    // 27 % MAC, a typical take-off centre of gravity
const NOSE_LOAD = (MAIN_GEAR.z - CG[2]) / WB; // static share of the weight on the nose leg (about 11 %)
const GEAR = [ // contact points when the strut carries its static load
  { name: 'nose', p: [0, NOSE_GEAR.y, NOSE_GEAR.z], load: NOSE_LOAD, defl: 0.12, stroke: 0.30, steer: true, brake: false },
  { name: 'left', p: [-MAIN_GEAR.x, MAIN_GEAR.y, MAIN_GEAR.z], load: (1 - NOSE_LOAD) / 2, defl: 0.25, stroke: 0.47, steer: false, brake: true },
  { name: 'right', p: [MAIN_GEAR.x, MAIN_GEAR.y, MAIN_GEAR.z], load: (1 - NOSE_LOAD) / 2, defl: 0.25, stroke: 0.47, steer: false, brake: true },
];
// oleo gas spring: F = F_static ((L - c_static) / (L - c))^1.35, with the gas column L chosen so that the
// strut reaches the end of its stroke at about four times its static load (a landing-design load)
for (const g of GEAR) g.gasL = (Math.pow(4, 1 / 1.35) * g.stroke - g.defl) / (Math.pow(4, 1 / 1.35) - 1);
const G_LOCAL = [0, MAIN_GEAR.y, MAIN_GEAR.z];
const ENG_X = ENGINE.x, ENG_ARM = CG[1] - ENGINE.y; // engine spanwise position; thrust line below the CG
// structure that must never touch the ground
const STRIKE = [
  // the underside of the tail cone: the fuselage clears the ground up to about 11.5 degrees of pitch
  // on the main wheels (Airbus quotes 11.7 degrees with the struts compressed)
  { name: 'tail', p: [0, -1.14, 21.6] }, { name: 'tail', p: [0, -0.93, 22.6] }, { name: 'tail', p: [0, -0.48, 24.6] }, { name: 'tail', p: [0, 0.30, 27.6] },
  { name: 'pod-left', p: [-ENG_X, ENGINE.y - 1.25, 5.2] }, { name: 'pod-right', p: [ENG_X, ENGINE.y - 1.25, 5.2] },
  { name: 'wingtip-left', p: [-16.3, 0.76, 13.6] }, { name: 'wingtip-right', p: [16.3, 0.76, 13.6] },
  { name: 'nose', p: [0, -1.14, -6.4] }, { name: 'belly', p: [0, -1.90, 7.6] }, { name: 'belly', p: [0, -1.70, 15.6] },
];
// per configuration: CL at zero alpha, stall alpha, CLmax, drag increment, VFE (kt)
// ---------------- aerodynamics, per configuration: clean, 1, 1+F, 2, 3, FULL ----------------
// a0: zero-lift angle of attack and aProt / aFloor / aMax: the angle-of-attack protection
//   thresholds (deg, fuselage angle) of the flight augmentation computer, low-Mach values;
// clmax: from the Airbus 1-g stall speeds (VS1g): clean 154.8, 1: 126.2, 1+F: 116, 2: 113.2,
//   3: 113.2 (111.2 gear down), FULL: 104.2 kt CAS at 64 t, i.e. CLmax = 2W / (rho0 S VS1g^2);
// cd: profile drag of the extended slats and flaps; df: flap angle (deg); vfe: flap limit speed (kt).
// The lift slope of each configuration makes V(alpha max) = 1.06 VS1g, as on the real aircraft.
const AERO = [
  { a0: -1.84, aProt: 6.5, aFloor: 7.6, aMax: 8.7, clmax: 1.32, cd: 0.000, df: 0, vfe: 350 },
  { a0: -1.84, aProt: 11.7, aFloor: 12.5, aMax: 13.6, clmax: 1.98, cd: 0.004, df: 0, vfe: 230 },
  { a0: -2.18, aProt: 11.7, aFloor: 12.7, aMax: 13.6, clmax: 2.35, cd: 0.012, df: 10, vfe: 215 },
  { a0: -4.72, aProt: 11.9, aFloor: 13.1, aMax: 14.2, clmax: 2.46, cd: 0.020, df: 15, vfe: 200 },
  { a0: -4.27, aProt: 11.0, aFloor: 12.1, aMax: 13.1, clmax: 2.50, cd: 0.030, df: 20, vfe: 185 },
  { a0: -6.94, aProt: 10.6, aFloor: 11.8, aMax: 13.0, clmax: 2.91, cd: 0.060, df: 35, vfe: 177 },
];
for (const a of AERO) { a.cla = (a.clmax / (1.06 * 1.06)) / ((a.aMax - a.a0) * DEG); a.a0r = a.a0 * DEG; }
// Clean-wing CLmax falls with Mach as shocks separate the flow; the buffet boundary sits below it.
const CLMAX_MACH = [[0.3, 1.32], [0.5, 1.30], [0.6, 1.25], [0.7, 1.18], [0.78, 1.12], [0.82, 1.05], [0.86, 0.95], [0.95, 0.8]];
const CL_BUFFET = [[0.3, 1.2], [0.5, 1.12], [0.6, 1.0], [0.7, 0.87], [0.75, 0.80], [0.78, 0.76], [0.82, 0.68], [0.86, 0.55], [0.95, 0.4]];
// Drag polar of the A320neo (OpenAP): CD0 0.017, k 0.038, landing gear +0.017. Extending the flaps
// raises the span efficiency: k = 1 / (1/k + pi A 0.0026 flap-deg). Wave drag 20 (M - Mcrit)^4 with the
// Korn equation for Mcrit (kappa 0.95, 25 deg sweep, 11 % thickness).
const CD0 = 0.017, K_IND = 0.038, CD_GEAR = 0.017, ASPECT = B * B / S;
const VR = 141, V2 = 146, VAPP = 137;
const tab = (T, x) => { if (x <= T[0][0]) return T[0][1]; for (let i = 1; i < T.length; i++) if (x <= T[i][0]) return lerp(T[i - 1][1], T[i][1], (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0])); return T[T.length - 1][1]; };
// lift-curve slope grows with Mach (a swept-wing fit, milder than Prandtl-Glauert)
const kMach = (m) => Math.pow(Math.sqrt(0.96) / Math.sqrt(1 - Math.min(m, 0.86) ** 2), 0.4);
const COS_L = Math.cos(25 * DEG);
function waveDrag(mach, CL) {
  const mcrit = 0.95 / COS_L - 0.11 / (COS_L * COS_L) - 0.1 * Math.max(0, CL) / (COS_L ** 3) - 0.108;
  return mach > mcrit ? 20 * (mach - mcrit) ** 4 : 0;
}
// Flexible modes. Airbus publishes no A320 figures, so these are engineering estimates: wing first bending
// about 2 Hz (large transports 1-2 Hz; an A320 wing is short and stiff); tip about 0.85 m up per g of
// lift (about 5 % of the semi-span), 0.18 m of droop under its own, fuel and engine weight.
// Fuselage first vertical bending about 3.2 Hz. Structural damping 3 %, plus aerodynamic damping.
const WING_F = 2.0, WING_D1G = 0.85, WING_DROOP = 0.18;
const FUSE_F = 3.2;

// ---------------- small vector/quaternion helpers on plain numbers ----------------
const tv = { x: 0, y: 0, z: 0 };
function rot(q, x, y, z, o = tv) { // rotate (x,y,z) by quaternion q = {x,y,z,w}
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  o.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; o.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; o.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return o;
}
function rotInv(q, x, y, z, o = tv) { return rot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, x, y, z, o); }
function pathLen(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z); return L; }
function pointAlong(pts, s) {
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || k === pts.length - 1) { const u = s / Math.max(L, 1e-6); return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }; }
    s -= L;
  }
  return pts[pts.length - 1];
}

// ---------------- engines: CFM LEAP-1A26 ----------------
// Thrust from the fan speed in corrected form, T = delta * F(N1 / sqrt(theta)) * g(M), as turbofans
// behave: 120.6 kN at 97 % N1 sea-level static, about 3 kN at ground idle. g(M) matches Bartel &
// Young's take-off lapse at Mach 0.2 (0.78 for a bypass ratio of 11.1) and, with ram recovery, their
// maximum climb thrust at altitude (about 25 kN per engine at Mach 0.78 and FL360, 37 kN at FL200).
// That puts cruise near 78 % N1 and a CONF FULL approach near 59 % N1.
const N1_REF = 0.97, N1_GI = 0.205;
const fanF = (n1c) => (n1c <= N1_GI ? 0.025 * (n1c / N1_GI) ** 2 : 0.025 + 0.975 * ((n1c - N1_GI) / (N1_REF - N1_GI)) ** 2.5);
const machLapse = (m) => { const mm = Math.min(m, 0.9); return 1 - 1.3686 * mm + 1.393 * mm * mm; };
function engineThrust(n1, air, mach) {
  const theta = air.T / 288.15, delta = air.p / 101325;
  return T_MAX * delta * fanF(n1 / Math.sqrt(theta)) * machLapse(mach);
}
function n1ForThrust(t, air, mach) {
  const theta = air.T / 288.15, delta = air.p / 101325;
  const f = Math.max(0, t) / (T_MAX * delta * machLapse(mach));
  const n1c = f <= 0.025 ? N1_GI * Math.sqrt(f / 0.025) : N1_GI + (N1_REF - N1_GI) * Math.pow((f - 0.025) / 0.975, 0.4);
  return n1c * Math.sqrt(theta);
}
// Fuel: sea-level static TSFC from the ICAO emissions databank (0.861 kg/s at 120.6 kN take-off,
// 0.71 at 85 %), rising with Mach to about 15 g/kN/s in cruise; ground idle burns about 0.09 kg/s.
function fuelFlow(thrust, air, mach) {
  const tsfc = 7.1e-6 * (1 + 1.85 * mach) * Math.sqrt(air.T / 288.15);
  return Math.max(tsfc * Math.max(0, thrust), 0.05 + 0.04 * air.sigma);
}

// Lift coefficient at fuselage angle of attack alpha (rad): linear from the zero-lift angle, rounding
// off above 85 % of CLmax to the stall, then falling away.
function liftCurve(a, alpha, mach, clmaxCap = 9) {
  const cla = a.cla * kMach(mach);
  const clmax = Math.min(a.clmax, clmaxCap);
  const clk = 0.85 * clmax, ak = a.a0r + clk / cla, span = 2 * (clmax - clk) / cla, as = ak + span;
  if (alpha <= ak) return cla * (alpha - a.a0r);
  if (alpha <= as) { const d = alpha - ak; return clk + cla * d - cla * d * d / (2 * span); }
  return Math.max(0.55 * clmax, clmax - 2.2 * (alpha - as)); // stalled
}
// stall angle of attack of that curve
const stallAlpha = (a, mach, clmaxCap = 9) => { const cla = a.cla * kMach(mach), clmax = Math.min(a.clmax, clmaxCap); return a.a0r + 1.15 * clmax / cla; };

export class FlightModel {
  constructor(route, opts = {}) {
    this.route = route; this.path = route.path; this.m = route.m;
    this.atmo = opts.atmosphere || new Atmosphere(opts.weather || { turb: opts.turbulence ?? 0.3, wind: opts.wind || '210° / 8 kt' }, { seed: opts.seed });
    this._wetOpt = opts.wet;
    this.t = 0; this.s = 0;
    this.phase = 'parked';
    this.events = []; this._flags = {};
    // rigid-body state (CG, world frame) and attitude (aircraft axes -> world)
    this.payload = 13200; this.mass = TOW; this.fuel = TOW - OEW - this.payload; // 13.2 t of passengers, bags and cargo
    this.P = { x: 0, y: 0, z: 0 }; this.V = { x: 0, y: 0, z: 0 };
    this.Q = { x: 0, y: 0, z: 0, w: 1 };
    this.p = 0; this.q = 0; this.r = 0;        // body rates: roll (right wing down +), pitch (nose up +), yaw (nose right +)
    this.pd = 0; this.qd = 0; this.rd = 0;
    // ---- cockpit controls: the only way anything moves ----
    this.ctl = {
      stickX: 0, stickY: 0,        // sidestick: roll (+ right), pitch (+ aft = nose up), -1..1
      pedal: 0,                    // rudder pedals (+ right)
      tiller: 0,                   // nose-wheel steering tiller (+ right)
      brakeL: 0, brakeR: 0,        // toe brakes 0..1
      parkBrake: true,
      thr: [0, 0],                 // thrust levers: -1 max reverse, 0 idle, 0.6 CL, 0.8 FLX/MCT, 1 TOGA
      flapLever: 0,                // 0, 1, 2, 3, 4 (FULL)
      gearLever: 1,                // 1 down
      speedbrake: 0,               // speed-brake lever 0..1
      spoilersArmed: false,
      autobrake: 'OFF',            // OFF, LO, MED, MAX
      engMaster: [true, true],
      engMode: 'NORM',             // ENG MODE selector: NORM, IGN/START
      trim: null,                  // take-off trim set on the pedestal (rad)
    };
    // systems
    this.n1 = [0.205, 0.205]; this.n1Cmd = [0.205, 0.205]; this.engineRunning = [true, true];
    this.n2 = [0.68, 0.68]; this.egt = [480, 480]; this.engStart = [null, null]; // start sequence per engine
    this.tug = null;            // pushback tug on the nose gear
    this.engFail = [0, 0];      // 0 ok, 1 failed (windmilling), 2 seized/damaged
    this.engFire = [false, false];
    this.cfg = 0; this.cfgTarget = 0; this.slat = 0; this.flap = 0; this._leverPrev = 0;
    this.gear = 1; this.gearCmd = 1; this.gearCollapsed = [false, false, false];
    this.spoiler = 0; this.spoilerCmd = 0; this.groundSpoiler = 0; this.gspCmd = false; this.reverse = 0; this.reverseCmd = 0;
    this.brake = 1; this.brakeL = 1; this.brakeR = 1; this.parkBrake = true; this.autobrake = 0; this.abActive = false; this.steer = 0;
    this.de = 0; this.ths = -2.0 * DEG; this.da = 0; this.dr = 0; this._ia = 0; this._ir = 0;
    this.law = 'normal';        // normal | alternate | direct
    this.fbwMode = 'ground';    // ground | flight | flare
    this.hyd = { green: true, yellow: true, blue: true };
    this.cabinAlt = 0; this.cabinAltTarget = 0; this.pressurised = true; this.pressLeak = 0;
    this.holdTimer = 0; this.rotating = false; this.liftoffT = -1; this.touchdownT = -1; this.airborneT = 0;
    // flexible structure
    this.wingFlex = -WING_DROOP; this.wingFlexV = 0; this.wingFlexA = 0; this.wingTwist = 0; this.wingTwistV = 0;
    this.fuseFlex = 0; this.fuseFlexV = 0; this.fuseAcc = 0;
    // outputs kept compatible with the rest of the game
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.h = 0; this.agl = 0; this.v = 0; this.vs = 0; this.ias = 0; this.tas = 0; this.mach = 0; this.gs = 0; this.altInd = 0; this.track = 0;
    this.heading = 0; this.pitch = 0; this.bank = 0; this.alpha = 0; this.beta = 0; this.gamma = 0;
    this.nz = 1; this.ny = 0; this.nx = 0;
    this.accel = new THREE.Vector3(); this.bump = 0; this.shake = 0; this.rollRumble = 0; this.thump = 0;
    this.turbLevel = 0; this._turbBoost = 1; this.turbBank = 0; this.turbPitch = 0;
    this.distToGo = 0; this.brakeDecel = 0; this.flapsMoving = false; this.gearMoving = false;
    this.onGround = true; this.wow = [true, true, true]; this.strutC = [0, 0, 0];
    this.drag = 0; this.lift = 0; this.thrust = [0, 0];
    this.stall = 0; this.buffet = 0; this.overspeed = 0; this.stallWarn = false;
    this.crashed = false; this.damage = {};
    this.ctrl = { ail: 0, elev: 0, rud: 0, sbL: 0, sbR: 0 };
    this._contact = [false, false, false]; this.contactSink = [0, 0, 0]; this._accLong = 0;
    this.sf = { x: 0, y: G, z: 0 }; this.xtk = 0; this.CL = 0; this.qbar = 0;
    this._tmp = {}; this._t2 = {}; this._wind = {};
    this.wind = this._wind;     // the air's velocity at the aircraft (mean wind + gusts + storm flows), m/s
    this.gearPoint = { x: 0, y: 0, z: 0 };
    this.air = this.atmo.air(0);
    this.alphaProt = 12 * DEG; this.alphaFloor = 13 * DEG; this.alphaMax = 14 * DEG;
    this.depHdg = route.dep ? route.dep.hdg * DEG : 0;
    this.afs = new Autoflight(this);
    this.baro = null;           // altimeter setting in hPa (null = standard 1013.25)
    this.crew = null;           // set by the crew
    if (opts.stand) this.placeAt(opts.stand.x, opts.stand.z, opts.stand.heading); else this._placeOnGround(0);
    if (opts.coldStart) { // at the gate before start: engines off, masters off, APU on
      this.ctl.engMaster = [false, false]; this.engineRunning = [false, false];
      this.n1 = [0, 0]; this.n1Cmd = [0, 0]; this.n2 = [0, 0]; this.phase = 'boarding';
    }
    this.ctl.trim = this._toTrim(); this.ths = this.ctl.trim;
    this.update(0);
  }

  get turbBoost() { return this._turbBoost; }
  set turbBoost(v) { this._turbBoost = v; this.atmo.boost = v; }
  get wet() { return this._wetOpt || this.atmo.rain > 1 || (this.atmo.sfc.precip ?? 0) > 0.3; }

  emit(e) { this.events.push(e); if (this.crew) this.crew.onEvent?.(e); }
  once(name, cond) { if (cond && !this._flags[name]) { this._flags[name] = true; this.emit(name); return true; } return false; }
  // compatibility: configuration index 0 (clean) .. 5 (FULL) through the flap lever
  setConfig(i) { this.ctl.flapLever = [0, 1, 1, 2, 3, 4][clamp(i, 0, 5)]; }
  shutdown() { this._flags.shutdown = true; this.ctl.engMaster = [false, false]; }
  n1ForThrust(T, air, mach) { return n1ForThrust(T, air, mach); }
  thrustAt(n1, air, mach) { return engineThrust(n1, air, mach); }

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

  // main-gear point at (x, z) facing `hdg` (radians, 0 = north, clockwise)
  placeAt(x, z, hdg) {
    this.Q.x = 0; this.Q.y = Math.sin(-hdg / 2); this.Q.z = 0; this.Q.w = Math.cos(-hdg / 2);
    const off = rot(this.Q, CG[0] - G_LOCAL[0], CG[1] - G_LOCAL[1], CG[2] - G_LOCAL[2], {});
    this.P.x = x + off.x; this.P.y = off.y; this.P.z = z + off.z;
    this.V.x = this.V.y = this.V.z = 0; this.p = this.q = this.r = 0; this.s = 0;
  }

  // Pushback: the tug steers the nose wheel through the towbar (nose-wheel steering disconnected by
  // the towing pin) and pushes, keeping to walking pace, so that the main gear follows `pts`
  // (world {x, z}); limits for the A320 with a towbar: 95 degrees of steering, 25 km/h.
  startPushback(pts) { this.tug = { pts, v: 0, F: 0, steer: 0, i: 0, state: 'push', I: 0, len: pathLen(pts) }; this.emit('pushback-start'); }
  _tugStep(dt) {
    const T = this.tug; if (!T || T.state === 'off') return;
    const M = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._tg || (this._tg = {}));
    const hd = this.heading, fx = Math.sin(hd), fz = -Math.cos(hd), rx = -fz, rz = fx;
    const along = this.V.x * fx + this.V.z * fz; // + forward
    // nearest point along the polyline (search forwards only)
    let best = T.i, bd = Infinity, sAt = 0, acc = 0;
    for (let k = 0; k < T.pts.length - 1; k++) {
      const a = T.pts[k], b = T.pts[k + 1], ex = b.x - a.x, ez = b.z - a.z, L = Math.hypot(ex, ez);
      if (k >= T.i) { const u = clamp(((M.x - a.x) * ex + (M.z - a.z) * ez) / (L * L), 0, 1); const d = Math.hypot(a.x + ex * u - M.x, a.z + ez * u - M.z); if (d < bd) { bd = d; best = k; sAt = acc + u * L; } }
      acc += L;
    }
    T.i = best; T.sAt = sAt;
    const remain = T.len - sAt;
    // pure pursuit for the main gear moving backwards: look-ahead point along the path
    const tgt = pointAlong(T.pts, Math.min(T.len + 3, sAt + 7));
    const dx = tgt.x - M.x, dz = tgt.z - M.z, lf = dx * fx + dz * fz, ll = dx * rx + dz * rz;
    const kappa = 2 * ll / Math.max(1, lf * lf + ll * ll);
    T.steer = clamp(Math.atan(kappa * WHEELBASE), -95 * DEG, 95 * DEG);
    // speed: up to 1.5 m/s, easing to a stop at the end of the push
    const vDes = T.state === 'push' ? Math.min(1.5, Math.sqrt(Math.max(0, 2 * 0.12 * (remain - 0.3)))) : 0;
    const back = -along, err = vDes - back;
    T.I = clamp(T.I + err * dt, -2, 2);
    const drag = 0.012 * this.mass * G * Math.sign(back || 1) + (this.thrust[0] + this.thrust[1]);
    T.F = -clamp(this.mass * (0.25 * err + 0.05 * T.I) + (T.state === 'push' && vDes > 0 ? drag : 0), -150000, 150000);
    if (T.state === 'push' && remain < 0.35 && Math.abs(along) < 0.08) { T.state = 'stopped'; T.F = 0; this.emit('pushback-stopped'); }
    if (T.state === 'stopped') T.F = clamp(this.mass * 0.5 * -along, -60000, 60000); // the tug holds the aircraft on its own brakes
  }

  // world position of an aircraft-coordinate point
  worldPoint(x, y, z, o = {}) { const w = rot(this.Q, x - CG[0], y - CG[1], z - CG[2], o); w.x += this.P.x; w.y += this.P.y; w.z += this.P.z; return w; }

  // Specific force (m/s^2, aircraft axes x right, y up, z aft) felt at an aircraft-coordinate
  // point: the CG value plus the rotational terms and the fuselage bending, so the back of the
  // cabin bumps more.
  accelAt(x, y, z, o = new THREE.Vector3()) {
    const rx = x - CG[0], ry = y - CG[1], rz = z - CG[2];
    // body rates in three axes: wx = q, wy = -r, wz = -p
    const wx = this.q, wy = -this.r, wz = -this.p, ax = this.qd, ay = -this.rd, az = -this.pd;
    // alpha x r + w x (w x r)
    const c1x = ay * rz - az * ry, c1y = az * rx - ax * rz, c1z = ax * ry - ay * rx;
    const wr = wx * rx + wy * ry + wz * rz, ww = wx * wx + wy * wy + wz * wz;
    const c2x = wx * wr - rx * ww, c2y = wy * wr - ry * ww, c2z = wz * wr - rz * ww;
    // first fuselage bending mode: nodes near the wing, the ends move most
    const phi = ((z - 10.5) / 16) ** 2 - 0.25;
    o.set(this.sf.x + c1x + c2x, this.sf.y + c1y + c2y + phi * this.fuseAcc, this.sf.z + c1z + c2z);
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
    this.track = Math.hypot(V.x, V.z) > 2 ? Math.atan2(V.x, -V.z) : psi;
    // ---- air data ----
    const gearH = this._lowestGear();
    this.agl = Math.max(0, gearH);
    const gp = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this.gearPoint);
    const airspeedGuess = Math.hypot(V.x, V.y, V.z);
    const w = this.atmo.step(dt, Math.max(0, gearH), airspeedGuess, gp, fx, fz, this._wind);
    const air = this.air = this.atmo.air(Math.max(0, P.y));
    const onGroundW = this.wow[1] || this.wow[2] || this.wow[0];
    const shelter = onGroundW ? 0.4 : 1; // near the surface and on the runway the vertical gusts are smaller
    const vax = V.x - w.wx, vay = V.y - w.wy * shelter, vaz = V.z - w.wz;
    const vb = rotInv(Q, vax, vay, vaz, this._vb || (this._vb = {}));
    const u = -vb.z, vv = vb.x, ww = -vb.y; // aviation body: forward, right, down
    const Va = Math.max(0.1, Math.hypot(u, vv, ww));
    const alpha = Math.atan2(ww, Math.max(u, 0.1)), beta = Math.asin(clamp(vv / Va, -1, 1));
    const qbar = 0.5 * air.rho * Va * Va, mach = Va / air.a;
    this.alpha = alpha; this.beta = beta; this.tas = Va; this.mach = mach; this.qbar = qbar;
    // the protections use a filtered angle of attack, so a single gust does not trip them
    this.alphaF = lerp(this.alphaF ?? alpha, alpha, 1 - Math.exp(-dt / 0.6));
    this.ias = Math.sqrt(2 * qbar / 1.225) / KT;
    this.altInd = this.atmo.indicatedAlt(Math.max(0, P.y), this.baro);
    if (this.atmo.strike) { this.emit('lightning-strike'); this.lightningT = this.t; }
    // ---- configuration & surfaces ----
    this._systems(dt);
    const cf = this._cfgf(), i0 = Math.floor(cf), i1 = Math.min(5, i0 + 1), kf = cf - i0;
    const A0 = AERO[i0], A1 = AERO[i1];
    const aero = this._aeroTmp || (this._aeroTmp = {});
    for (const key of ['a0r', 'cla', 'clmax', 'cd', 'df', 'aProt', 'aFloor', 'aMax']) aero[key] = lerp(A0[key], A1[key], kf);
    // the clean wing's CLmax falls with Mach (with slats out the aircraft is always slow)
    const cap = cf < 1 ? lerp(tab(CLMAX_MACH, mach), 9, cf) : 9;
    const aStall = stallAlpha(aero, mach, cap);
    // protections: the FAC thresholds (the clean ones fall between Mach 0.5 and 0.9), kept below the stall
    const mk = cf < 1 ? clamp((mach - 0.5) / 0.4, 0, 1) * (1 - cf) : 0;
    this.alphaProt = Math.min((aero.aProt - 1.9 * mk) * DEG, aStall - 2.5 * DEG);
    this.alphaFloor = Math.min((aero.aFloor - 1.57 * mk) * DEG, aStall - 1.5 * DEG);
    this.alphaMax = Math.min((aero.aMax - 2.3 * mk) * DEG, aStall - 0.8 * DEG);
    this.alphaStall = aStall;
    // stall warning (alternate and direct law only): the FAC's warning threshold, the alpha-prot values
    this.stallWarn = this.law !== 'normal' && alpha > this.alphaProt && !this.onGround;
    // ---- the crew's hands, the autopilot, the fly-by-wire computers ----
    if (this.crew) this.crew.control(dt);
    this.afs.update(dt);
    this._fbw(dt, theta, phi, alpha, beta, qbar, Va);
    // ---- aerodynamics ----
    const pa = this.p - w.pg, qa = this.q - w.qg, ra = this.r - w.rg;
    const hb = Math.max(0.5, gearH + 2.9) / B; // the wing sits about 2.9 m above the wheels' contact points
    const ge = hb < 1 ? (16 * hb) ** 2 / (1 + (16 * hb) ** 2) : 1; // ground effect on induced drag
    let CL = liftCurve(aero, alpha, mach, cap) + (hb < 1 ? 0.08 * (1 - hb) : 0);
    // panels 1-5 on each wing are powered green, yellow, blue, yellow, green; speedbrakes use 2-4, ground spoilers all five
    const H = this.hyd;
    const sb = this.spoiler * ((H.yellow ? 2 : 0) + (H.blue ? 1 : 0)) / 3;
    const gsp = this.groundSpoiler * ((H.green ? 2 : 0) + (H.yellow ? 2 : 0) + (H.blue ? 1 : 0)) / 5;
    CL += -0.12 * sb - 0.75 * gsp * clamp(CL, 0, 2);
    // the flexing wing: bending velocity changes the local angle of attack (aerodynamic damping)
    CL += -aero.cla * 0.35 * this.wingFlexV / Math.max(Va, 20);
    CL += 4.5 * qa * CBAR / (2 * Va) + 0.35 * this.de;
    const stalled = alpha > aStall;
    this.stall = stalled ? 1 : 0;
    // buffet: near the stall at low speed, shock buffet above the buffet-onset lift at high Mach
    const clBo = cf < 1 ? tab(CL_BUFFET, mach) : 9;
    this.buffet = smoothstep(aStall - 3 * DEG, aStall, alpha) + (cf < 1 ? smoothstep(clBo, clBo * 1.2, CL) : 0) + smoothstep(0.82, 0.86, mach);
    const kInd = 1 / (1 / K_IND + Math.PI * ASPECT * 0.0026 * aero.df);
    let CD = CD0 + aero.cd + kInd * ge * CL * CL + CD_GEAR * this.gear + 0.03 * sb + 0.07 * gsp + waveDrag(mach, CL);
    if (stalled) CD += 0.6 * (alpha - aStall);
    for (let i = 0; i < 2; i++) if (this.engFail[i]) CD += 0.004; // windmilling engine
    this.CD = CD;
    const CY = -0.85 * beta - 0.2 * this.dr;
    const lift = qbar * S * CL, drag = qbar * S * CD, side = qbar * S * CY;
    this.lift = lift; this.drag = drag; this.CL = CL;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    let Fx = -drag * ca + lift * sa, Fy = side, Fz = -drag * sa - lift * ca;
    // force breakdown in aircraft coordinates (x right, y up, z aft) for the debug view
    const dF = this.dbgF || (this.dbgF = { lift: [0, 0, 0], drag: [0, 0, 0], side: [0, 0, 0], thrust: [0, 0, 0], ground: { x: 0, y: 0, z: 0 }, tow: 0 });
    dF.lift[1] = lift * ca; dF.lift[2] = -lift * sa; dF.drag[1] = drag * sa; dF.drag[2] = drag * ca; dF.side[0] = side;
    // moments (aviation body)
    const pH = pa * B / (2 * Va), qH = qa * CBAR / (2 * Va), rH = ra * B / (2 * Va);
    let Cl = -0.10 * beta - 0.45 * pH + 0.12 * rH + 0.09 * this.da - 0.015 * this.dr;
    // downwash lag at the tailplane: an alpha-dot damping term
    const adot = (alpha - (this._aPrev ?? alpha)) / dt; this._aPrev = alpha;
    this._adot = lerp(this._adot ?? 0, clamp(adot, -1, 1), 1 - Math.exp(-dt / 0.05));
    const adH = this._adot * CBAR / (2 * Va);
    let Cm = 0.06 - 1.0 * alpha - 22 * qH - 8 * adH - 1.3 * this.de - 2.4 * this.ths - 0.035 * cf + 0.02 * gsp + 0.02 * sb;
    let Cn = 0.12 * beta - 0.22 * rH - 0.03 * pH + 0.085 * this.dr - 0.012 * this.da;
    if (stalled) { Cm -= 0.25 * (alpha - aStall) * 3; Cl += 0.02 * (vnoise1(this.t * 1.7) - 0.5) * (this.law === 'normal' ? 0.3 : 1); }
    let L = qbar * S * B * Cl, M = qbar * S * CBAR * Cm, N = qbar * S * B * Cn;
    // ---- engines ----
    let T = 0;
    for (let i = 0; i < 2; i++) {
      let t = this.engFail[i] ? -0.012 * qbar * 2.0 : engineThrust(this.n1[i], air, mach);
      if (!this.engineRunning[i] && !this.engFail[i]) t = 0;
      // reverser 1 is green, reverser 2 yellow: without its hydraulics a reverser stays stowed and the FADEC holds that engine at idle
      const revOk = i === 0 ? this.hyd.green : this.hyd.yellow;
      if (this.reverse > 0.05 && !this.engFail[i] && this.ctl.thr[i] < 0) t = revOk ? t * (1 - this.reverse) - t * this.reverse * 0.38 : engineThrust(Math.min(this.n1[i], 0.205), air, mach);
      this.thrust[i] = t; T += t;
    }
    Fx += T;
    dF.thrust[2] = -T;
    N += (this.thrust[0] - this.thrust[1]) * ENG_X; // left engine pushes the nose right
    M += T * ENG_ARM;                               // thrust line below the CG
    // ---- convert aero+thrust to world ----
    const fb = rot(Q, Fy, -Fz, -Fx, this._fw || (this._fw = {}));
    let Fwx = fb.x, Fwy = fb.y, Fwz = fb.z;
    let Mtx = M, Mty = -N, Mtz = -L;
    // ---- landing gear & structure contacts ----
    const gr = this._ground(dt, fx, fz);
    Fwx += gr.fx; Fwy += gr.fy; Fwz += gr.fz;
    rotInv(Q, gr.fx, gr.fy, gr.fz, dF.ground); dF.tow = this.tug && this.tug.state !== 'off' ? this.tug.F : 0;
    if (this.tug && this.tug.state !== 'off' && this.wow[0]) {
      this._tugStep(dt);
      // towbar force along the nose wheel, at the nose-gear contact point
      const sfx = Math.sin(this.steer), cfx = Math.cos(this.steer);
      const lx = fx * cfx - fz * sfx, lz = fz * cfx + fx * sfx, F = this.tug.F;
      const r = rot(this.Q, GEAR[0].p[0] - CG[0], GEAR[0].p[1] - CG[1], GEAR[0].p[2] - CG[2], this._rt || (this._rt = {}));
      const Fx = lx * F, Fz = lz * F;
      Fwx += Fx; Fwz += Fz;
      const tm = rotInv(this.Q, r.y * Fz, r.z * Fx - r.x * Fz, -r.y * Fx, this._tm || (this._tm = {}));
      Mtx += tm.x; Mty += tm.y; Mtz += tm.z;
    }
    const gm = rotInv(Q, gr.mx, gr.my, gr.mz, this._gm || (this._gm = {}));
    Mtx += gm.x; Mty += gm.y; Mtz += gm.z;
    // ---- translational dynamics ----
    const m = this.mass;
    const sfw = this._sfw || (this._sfw = {}); sfw.x = Fwx / m; sfw.y = Fwy / m; sfw.z = Fwz / m;
    this.sf = rotInv(Q, sfw.x, sfw.y, sfw.z, this.sf || {});
    V.x += sfw.x * dt; V.y += (sfw.y - G) * dt; V.z += sfw.z * dt;
    P.x += V.x * dt; P.y += V.y * dt; P.z += V.z * dt;
    // ---- rotational dynamics (aviation body axes) ----
    // inertia: the empty aircraft plus the payload spread along the cabin and the fuel in the wings
    const pay = this.payload, fuel = Math.max(0, this.fuel), ke = OEW / 42500;
    const Ixx = IXX0 * ke + fuel * 28 + pay * 1.0, Iyy = IYY0 * ke + pay * 41 + fuel * 2.5, Izz = IZZ0 * ke + pay * 42 + fuel * 30;
    const Lb = -Mtz, Mb = Mtx, Nb = -Mty;
    this.pd = (Lb + (Iyy - Izz) * this.q * this.r) / Ixx;
    this.qd = (Mb + (Izz - Ixx) * this.p * this.r) / Iyy;
    this.rd = (Nb + (Ixx - Iyy) * this.p * this.q) / Izz;
    this.p += this.pd * dt; this.q += this.qd * dt; this.r += this.rd * dt;
    const ox = this.q, oy = -this.r, oz = -this.p;
    const qx = Q.x, qy = Q.y, qz = Q.z, qw = Q.w;
    Q.x += 0.5 * dt * (qw * ox + qy * oz - qz * oy);
    Q.y += 0.5 * dt * (qw * oy + qz * ox - qx * oz);
    Q.z += 0.5 * dt * (qw * oz + qx * oy - qy * ox);
    Q.w += 0.5 * dt * (-qx * ox - qy * oy - qz * oz);
    const qn = Math.hypot(Q.x, Q.y, Q.z, Q.w); Q.x /= qn; Q.y /= qn; Q.z /= qn; Q.w /= qn;
    // ---- fuel ----
    this.ff = [0, 0];
    for (let i = 0; i < 2; i++) if (this.engineRunning[i] && !this.engFail[i]) { const ff = fuelFlow(engineThrust(this.n1[i], air, mach), air, mach); this.ff[i] = ff; this.fuel -= ff * dt; this.mass -= ff * dt; }
    // ---- load factors & structural limits ----
    this.nz = this.sf.y / G; this.ny = this.sf.x / G; this.nx = -this.sf.z / G;
    if (!this.onGround && (this.nz > 2.6 || this.nz < -1.1)) this._damage('overstress');
    this.overspeed = this.ias > 350 + 4 || this.mach > 0.82 + 0.006 ? 1 : 0;
    this._flex(dt, lift, qbar);
    // ---- where are we on the route ----
    this._track(dt);
    // ---- the cabin feels every physics step ----
    if (this.onSubstep) this.onSubstep(dt);
  }

  // ---------------- flexible wing and fuselage ----------------
  _flex(dt, lift, qbar) {
    const W = this.mass * G;
    const aeroD = clamp(qbar / 12000, 0, 1);
    // symmetric wing bending: lift bends the wing up, its own weight (and the engines) pulls it down
    const wW = 2 * Math.PI * WING_F, zW = 0.03 + 0.09 * aeroD;
    const tgt = WING_D1G * lift / W - WING_DROOP * this.nz;
    this.wingFlexA = wW * wW * (tgt - this.wingFlex) - 2 * zW * wW * this.wingFlexV;
    this.wingFlexV += this.wingFlexA * dt; this.wingFlex += this.wingFlexV * dt;
    // antisymmetric: rolling acceleration and roll gusts twist the pair of wings
    const tgtA = -0.03 * this.pd - 0.05 * this.atmo.pg * clamp(this.tas / 200, 0, 1.5);
    this.wingTwistV += (wW * 1.3) ** 2 * (tgtA - this.wingTwist) * dt - 2 * zW * wW * 1.3 * this.wingTwistV * dt;
    this.wingTwist += this.wingTwistV * dt;
    // fuselage vertical bending, excited by gusts and by the gear on touchdown
    const wF = 2 * Math.PI * FUSE_F, zF = 0.03;
    const tgtF = -0.012 * (this.nz - 1) - 0.004 * this.qd;
    const acc = wF * wF * (tgtF - this.fuseFlex) - 2 * zF * wF * this.fuseFlexV;
    this.fuseFlexV += acc * dt; this.fuseFlex += this.fuseFlexV * dt;
    this.fuseAcc = acc;
  }

  // radio altitude: height of the main-gear contact point (of the belly with the gear up)
  _lowestGear() {
    return this.gear > 0.5 ? this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t2).y : this.worldPoint(0, -1.90, 8.6, this._t2).y + (MAIN_GEAR.y + 1.90);
  }

  // ---------------- gear, tyres, brakes, structure strikes ----------------
  _ground(dt, fx, fz) {
    const out = this._gr || (this._gr = { fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
    out.fx = out.fy = out.fz = out.mx = out.my = out.mz = 0;
    const W = this.mass * G;
    const wet = this.wet;
    const mu = wet ? 0.5 : 0.8, muBrake = wet ? 0.25 : 0.45;
    let anyWow = false, structure = false;
    const sfx = Math.sin(this.steer), cfx = Math.cos(this.steer);
    const hydBrake = this.hyd.green || this.hyd.yellow ? 1 : 0.4;
    for (let i = 0; i < 3; i++) {
      const g = GEAR[i];
      this.wow[i] = false;
      if (this.gear < 0.98 || this.gearCollapsed[i]) { this.strutC[i] = 0; continue; }
      const r = rot(this.Q, g.p[0] - CG[0], g.p[1] - CG[1], g.p[2] - CG[2], this._rr || (this._rr = {}));
      const py = this.P.y + r.y;
      const c = g.defl - py; // strut compression
      if (c <= 0) { this.strutC[i] = 0; continue; }
      anyWow = true; this.wow[i] = true;
      const wv = rot(this.Q, this.q, -this.r, -this.p, this._wv || (this._wv = {}));
      const cvx = this.V.x + wv.y * r.z - wv.z * r.y, cvy = this.V.y + wv.z * r.x - wv.x * r.z, cvz = this.V.z + wv.x * r.y - wv.y * r.x;
      const k = g.load * W / g.defl, d = 2 * 0.55 * Math.sqrt(k * this.mass * g.load);
      // tyre then oleo: the gas spring stiffens with stroke; the orifice damps rebound harder than compression
      const cs = Math.min(c, g.stroke - 0.01);
      let Fn = g.load * W * Math.pow((g.gasL - g.defl) / (g.gasL - cs), 1.35) * Math.min(1, c / 0.04) - d * cvy * (cvy > 0 ? 2.5 : 1) * Math.min(1, c / 0.06);
      if (c > g.stroke) Fn += k * 30 * (c - g.stroke); // bottoming out
      Fn = Math.max(0, Fn);
      if (!this._contact[i]) {
        this._contact[i] = true; this.contactSink[i] = -cvy;
        // oleo design limit ~10 ft/s at landing weight; well beyond it the gear fails
        const lim = g.steer ? 4.2 : 4.9;
        if (-cvy > lim && !this.gearCollapsed[i]) { this.gearCollapsed[i] = true; this._damage(`gear-${g.name}`); this.emit('gear-collapse'); }
        // the fuselage rings as the wheels hit
        if (!g.steer) { this.fuseFlexV += clamp(-cvy, 0, 5) * 0.012; this.wingFlexV -= clamp(-cvy, 0, 5) * 0.12; }
      }
      let lx = fx, lz = fz;
      if (g.steer) { lx = fx * cfx - fz * sfx; lz = fz * cfx + fx * sfx; }
      const vl = cvx * lx + cvz * lz, vlat = cvx * -lz + cvz * lx;
      const bk = g.brake ? (this.parkBrake ? 1 : (i === 1 ? this.brakeL : this.brakeR)) * muBrake * hydBrake : 0;
      const Flong = -(0.010 + bk) * Fn * Math.tanh(vl / 0.12);
      // tyre side force from the slip angle: cornering force builds up over the first few degrees of
      // slip (aircraft tyres peak near 8-10 degrees), not at a few centimetres per second of side speed
      const slip = Math.atan2(vlat, Math.max(Math.abs(vl), 0.6));
      const Flat = -mu * Fn * Math.tanh(slip / 0.09);
      const Fx = lx * Flong + -lz * Flat, Fz = lz * Flong + lx * Flat, Fy = Fn;
      out.fx += Fx; out.fy += Fy; out.fz += Fz;
      out.mx += r.y * Fz - r.z * Fy; out.my += r.z * Fx - r.x * Fz; out.mz += r.x * Fy - r.y * Fx;
      this.strutC[i] = c;
    }
    for (let i = 0; i < 3; i++) if (!this.wow[i]) this._contact[i] = false;
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
    const gearDown = this.gear > 0.98 && !this.gearCollapsed[1] && !this.gearCollapsed[2];
    const severe = ((name === 'belly' || name === 'nose' || name.startsWith('wingtip')) && (sink > 3 || speed > 40))
      || (!gearDown && speed > 15 && name !== 'tail');
    if ((severe || sink > 8) && !this.crashed) {
      this.crashed = true; this.crashT = this.t; this.crashSpeed = speed; this.crashSink = sink; this.crashPart = name;
      this.survivable = sink < 6 && speed < 95 && !(name.startsWith('wingtip') && sink > 3);
      this.emit('crash');
    }
  }

  _damage(what) { if (!this.damage[what]) { this.damage[what] = { t: this.t }; this.emit(`damage-${what}`); } }

  // ---------------- systems: flaps, gear, spoilers, reversers, engines, brakes, steering, pressurisation ----------------
  _systems(dt) {
    const c = this.ctl;
    const gsKt = Math.hypot(this.V.x, this.V.z) / KT;
    // flap lever: position 1 gives 1+F on the ground (or when retracting), CONF 1 when extending in
    // flight; the flaps of 1+F retract automatically at 210 kt
    const lev = clamp(Math.round(c.flapLever), 0, 4);
    if (lev !== this._leverPrev) {
      this.cfgTarget = lev === 0 ? 0 : lev === 1 ? (this.onGround || this.ias < 100 || this._leverPrev > 1 ? 2 : 1) : lev + 1;
      this._leverPrev = lev; this.emit('flaps');
    }
    if (this.cfgTarget === 2 && lev === 1 && this.ias > 210 && !this.onGround) this.cfgTarget = 1;
    const cfgT = CONFIGS[this.cfgTarget];
    const flapRate = 0.75 * ((this.hyd.green ? 1 : 0) + (this.hyd.yellow ? 1 : 0));
    const slatRate = 0.8 * ((this.hyd.green ? 1 : 0) + (this.hyd.blue ? 1 : 0));
    this.slat += clamp(cfgT.slat - this.slat, -slatRate * dt, slatRate * dt);
    if (!this.flapJam) this.flap += clamp(cfgT.flap - this.flap, -flapRate * dt, flapRate * dt);
    this.flapsMoving = Math.abs(cfgT.flap - this.flap) > 0.05 && !this.flapJam || Math.abs(cfgT.slat - this.slat) > 0.05;
    if (!this.flapsMoving) this.cfg = this.cfgTarget;
    // gear: green hydraulics, or a gravity extension
    this.gearCmd = c.gearLever ? 1 : 0;
    if (this.onGround && this.gearCmd === 0) this.gearCmd = 1; // safety: no retraction with weight on wheels
    const gPrev = this.gear;
    const gearRate = this.hyd.green ? 1 / 9 : 1 / 25;
    if (this.gearCmd < this.gear && !this.hyd.green) { /* cannot retract */ } else this.gear += clamp(this.gearCmd - this.gear, -dt * gearRate, dt * gearRate);
    // a main leg whose uplock or actuator has failed stays in its bay when the others come down
    if (this.gearFailLeg && this.gear > 0.9 && !this.gearCollapsed[this.gearFailLeg]) this.gearCollapsed[this.gearFailLeg] = true;
    this.gearMoving = Math.abs(this.gear - gPrev) > 1e-7;
    // speed brakes (inhibited in CONF FULL and in alpha protection) and ground spoilers
    const sbInhibit = this.cfgTarget === 5 || this.alpha > this.alphaProt;
    this.spoilerCmd = this.onGround ? 0 : sbInhibit ? 0 : clamp(c.speedbrake, 0, 1);
    const mainWow = this.wow[1] || this.wow[2];
    const idleOrRev = c.thr[0] <= 0.03 && c.thr[1] <= 0.03;
    const revSel = c.thr[0] < -0.02 || c.thr[1] < -0.02;
    if ((c.spoilersArmed && mainWow && idleOrRev && gsKt > 30) || (mainWow && revSel && gsKt > 20)) this.gspCmd = true;
    if (c.spoilersArmed && this.onGround && gsKt > 72 && idleOrRev && this.phase === 'takeoff') this.gspCmd = true; // rejected take-off
    if (!c.spoilersArmed && !revSel && (!idleOrRev || gsKt < 5)) this.gspCmd = false;
    if (!this.onGround) this.gspCmd = false;
    this.spoiler += clamp(this.spoilerCmd - this.spoiler, -dt * 0.6, dt * 1.2);
    this.groundSpoiler += clamp((this.gspCmd ? 1 : 0) - this.groundSpoiler, -dt * 1.0, dt * 3.0);
    // reversers deploy only on the ground
    this.reverseCmd = revSel && mainWow ? 1 : 0;
    this.reverse += clamp(this.reverseCmd - this.reverse, -dt / 2, dt / 1.8);
    // ---- engines: FADEC target from the lever, or from the autothrust within the lever's limit ----
    const afs = this.afs;
    const idleA = this.onGround ? N1_RATING.idleGnd : (this.cfgTarget > 0 || this.gear > 0.5 ? N1_RATING.idleApp : N1_RATING.idleAir);
    for (let i = 0; i < 2; i++) {
      if (!c.engMaster[i]) this.engineRunning[i] = false;
      const tla = c.thr[i];
      let tgt;
      if (tla < 0) tgt = this.reverse > 0.8 ? lerp(idleA, N1_RATING.REV, clamp((-tla - 0.08) / 0.92, 0, 1)) : idleA;
      else if (afs.athrActive && tla <= (afs.athrTop ?? DETENT.CL) + 0.02) tgt = Math.min(afs.n1Cmd, afs._leverN1(tla, idleA));
      else tgt = tla <= 0.01 ? idleA : afs._leverN1(tla, idleA);
      if (afs._toga > 0 || afs.alphaFloor) tgt = N1_RATING.TOGA;
      tgt = Math.max(tgt, idleA);
      if (this.engFail[i]) { this.n1[i] += (0.06 * clamp(this.ias / 250, 0, 1.2) * (this.engFail[i] === 2 ? 0.1 : 1) - this.n1[i]) * dt * 0.4; this.engineRunning[i] = false; this.n1Cmd[i] = 0; continue; }
      if (this._engineStart(i, dt, c)) continue;
      const cmd = this.engineRunning[i] ? tgt : 0;
      this.n1Cmd[i] = cmd;
      const n = this.n1[i];
      const up = cmd > n;
      const rate = up ? (n < 0.5 ? 0.075 : 0.19) : (this.engineRunning[i] ? 0.22 : 0.05);
      this.n1[i] += clamp((cmd - n) * (up ? 1.4 : 1.1), -rate, rate) * dt;
      // core speed and exhaust temperature follow the fan (ground idle about 20 % N1, 68 % N2)
      const oat = this.air ? this.air.T - 273.15 : 15;
      if (this.engineRunning[i]) { this.n2[i] = 0.68 + 0.32 * clamp((this.n1[i] - 0.205) / 0.765, -0.3, 1.1); this.egt[i] += (430 + 470 * Math.max(0, this.n1[i] - 0.205) ** 1.3 + oat - (this.egt[i])) * Math.min(1, dt * 0.5); }
      else { this.n2[i] = Math.max(0, this.n2[i] - dt * 0.012 * (0.3 + this.n2[i])); this.egt[i] += (oat - this.egt[i]) * dt * 0.01; }
    }
    // ---- brakes: toe brakes, autobrake, parking brake ----
    this.parkBrake = c.parkBrake;
    const ab = c.autobrake;
    const decelTgt = ab === 'LO' ? 1.7 : ab === 'MED' ? 3.0 : ab === 'MAX' ? 6.0 : 0;
    const abDelay = ab === 'LO' ? 4 : ab === 'MED' ? 2 : 0;
    if (ab !== 'OFF' && this.groundSpoiler > 0.5 && !this.abActive && this.hyd.green) { this.abActive = true; this._abT = this.t; this._abI = 0; }
    if (this.abActive && (Math.max(c.brakeL, c.brakeR) > 0.35 || c.thr[0] > 0.1 || c.thr[1] > 0.1 || ab === 'OFF' || !this.hyd.green)) { this.abActive = false; c.autobrake = 'OFF'; this.emit('autobrake-off'); }
    let abBrake = 0;
    if (this.abActive && this.t - this._abT > abDelay) {
      const decel = -this._accLong;
      this._abI = clamp((this._abI || 0) + (decelTgt - decel) * dt * 0.6, 0, 1);
      abBrake = ab === 'MAX' ? 1 : clamp(this._abI + 0.12, 0, 1);
      if (gsKt < 2) abBrake = 1;
    }
    this.autobrake = this.abActive ? decelTgt : 0;
    this.brakeL = Math.max(c.brakeL, abBrake); this.brakeR = Math.max(c.brakeR, abBrake);
    this.brake = Math.max(this.brakeL, this.brakeR);
    // ---- nose-wheel steering (yellow hydraulics on the A320neo): tiller up to 75 degrees at taxi
    // speed, fading out by 70 kt; pedals up to 6 degrees, fading out by 130 kt ----
    const tillerK = 1 - smoothstep(20, 70, gsKt), pedalK = 1 - smoothstep(40, 130, gsKt);
    const nws = this.hyd.yellow && this.wow[0] ? clamp(c.tiller * 75 * tillerK + c.pedal * 6 * pedalK, -75, 75) * DEG : 0;
    const towing = this.tug && this.tug.state !== 'off';
    this.steer += clamp((towing ? this.tug.steer : nws) - this.steer, -25 * DEG * dt, 25 * DEG * dt);
    // cabin pressure: schedule ~ 8000 ft cabin at FL360, leak to outside if pressurisation is lost
    const h = Math.max(0, this.P.y);
    this.cabinAltTarget = this.pressurised ? Math.min(h, h * 0.22 + 0) : h;
    const leak = this.pressurised ? 2.5 : 30 + this.pressLeak * 400;
    this.cabinAlt += clamp(this.cabinAltTarget - this.cabinAlt, -leak * dt * 1.5, leak * dt);
  }

  // LEAP-1A automatic start with the ENG MODE selector at IGN/START and the master switch ON: the
  // starter (APU bleed air) cranks the core, the FADEC first motors it dry for a bowed-rotor cool-down
  // (short for an engine that has stood cold overnight), ignition above 15 % N2, fuel above 20 % N2,
  // light-off in 2-3 s, ignition off at 55 % and starter cut-out at 63 % N2, then idle.
  _engineStart(i, dt, c) {
    let st = this.engStart[i];
    if (!st && c.engMaster[i] && !this.engineRunning[i] && !this.engFail[i] && c.engMode === 'IGN/START') { st = this.engStart[i] = { phase: 'crank', t: 0, motor: this._warm ? 40 : 6 }; this.emit(`engine-start-${i + 1}`); }
    if (!st) return false;
    if (!c.engMaster[i] || this.engFail[i]) { this.engStart[i] = null; return false; }
    st.t += dt;
    const n2 = this.n2[i], oat = this.air ? this.air.T - 273.15 : 15;
    if (st.phase === 'crank') { this.n2[i] += (Math.min(0.3, 0.26 + 0.04 * (st.t > st.motor ? 1 : 0)) - n2) * dt * 0.35; if (st.t > st.motor && n2 > 0.2) { st.phase = 'fuel'; st.tf = st.t; this.emit(`engine-fuel-${i + 1}`); } }
    else if (st.phase === 'fuel') { this.n2[i] += 0.004 * dt; if (st.t - st.tf > 2.5) { st.phase = 'lit'; this.emit(`engine-lightoff-${i + 1}`); } }
    else if (st.phase === 'lit') {
      this.n2[i] += (0.006 + 0.03 * clamp(n2 - 0.2, 0, 0.5)) * dt;
      if (n2 > 0.63 && !st.cut) { st.cut = true; this.emit(`engine-starter-cut-${i + 1}`); }
      if (n2 >= 0.675) { this.engStart[i] = null; this.engineRunning[i] = true; this.emit(`engine-running-${i + 1}`); }
    }
    const lit = st.phase === 'lit';
    this.n1[i] = 0.205 * clamp((this.n2[i] - 0.14) / 0.54, 0, 1) ** 1.5;
    const egtT = lit ? 430 + oat + 260 * Math.sin(Math.PI * clamp((this.n2[i] - 0.2) / 0.5, 0, 1)) : oat;
    this.egt[i] += (egtT - this.egt[i]) * Math.min(1, dt * (lit ? 0.9 : 0.05));
    this.n1Cmd[i] = 0;
    return true;
  }

  // ---------------- fly-by-wire control laws ----------------
  _fbw(dt, theta, phi, alpha, beta, qbar, Va) {
    const c = this.ctl, afs = this.afs;
    const mainWow = this.wow[1] || this.wow[2];
    // mode switching: ground -> flight (blended over 5 s after lift-off) -> flare (50 ft) -> ground
    if (this.fbwMode === 'ground' && !mainWow && !this.wow[0] && this.agl > 0.5) { this.fbwMode = 'flight'; this._flightT = this.t; }
    if (this.fbwMode === 'flight' && this.agl < 50 * FT && this.gear > 0.9 && this.V.y < 0 && this.cfgTarget >= 3 && this.t - (this._flightT ?? 0) > 20) { this.fbwMode = 'flare'; this._theta50 = theta; this._t30 = null; }
    if (this.fbwMode === 'flare' && this.agl > 100 * FT) this.fbwMode = 'flight';
    if (this.fbwMode !== 'ground' && mainWow && this.wow[0]) { this.fbwMode = 'ground'; }
    if (this.fbwMode === 'flare' && mainWow && this._t30 != null && this.t - this._t30 > 1 && this.fbwMode !== 'ground') this.fbwMode = 'flare';
    const direct = this.law === 'direct';
    const Vq = Math.max(qbar, 400);
    const Kq = clamp(3.2 * 9000 / Vq, 1.5, 16);
    const clean = this.cfgTarget === 0;
    const nzHi = clean ? 2.5 : 2.0, nzLo = clean ? -1.0 : 0.0;
    const flightBlend = this.fbwMode === 'ground' ? 0 : clamp((this.t - (this._flightT ?? 0)) / 5, 0, 1);
    // ---------- pitch ----------
    if (this.fbwMode === 'ground' || direct) {
      // direct law: stick to elevator (30 degrees up, 17 down). On the ground the trim stays where the crew set it.
      const deStick = c.stickY > 0 ? -30 * DEG * c.stickY : -17 * DEG * c.stickY;
      this.de += (deStick - this.de) * Math.min(1, dt * 12);
      if (this.onGround && c.trim != null && this.fbwMode === 'ground') this.ths += (c.trim - this.ths) * Math.min(1, dt * 0.5);
    } else {
      let qCmd;
      const phiC = clamp(phi, -33 * DEG, 33 * DEG);
      const qTurn = G / Math.max(Va, 40) * Math.tan(phiC) * Math.sin(phiC);
      if (this.fbwMode === 'flare' && !afs.ap) {
        // flare law: attitude memorised at 50 ft, lowered towards -2 degrees over 8 s from 30 ft
        if (this._t30 == null && this.agl < 30 * FT) this._t30 = this.t;
        const k = this._t30 == null ? 0 : clamp((this.t - this._t30) / 8, 0, 1);
        const thRef = lerp(this._theta50, -2 * DEG, k);
        this.flareRef = thRef;
        const thCmd = thRef + c.stickY * 20 * DEG;
        qCmd = clamp(1.2 * (thCmd - theta), -5 * DEG, 5 * DEG);
      } else if (afs.ap) {
        qCmd = afs.qCmd; this.flareRef = null;
      } else {
        // load-factor demand: neutral stick holds the flight path (1 g corrected for bank)
        const dnz = c.stickY >= 0 ? c.stickY * (nzHi - 1) : c.stickY * (1 - nzLo);
        qCmd = qTurn + G / Math.max(Va, 40) * dnz;
      }

      if (this.law === 'normal') {
        // load-factor protection
        if (this.nz > nzHi) qCmd = Math.min(qCmd, -(this.nz - nzHi) * G / Va * 2);
        if (this.nz < nzLo) qCmd = Math.max(qCmd, (nzLo - this.nz) * G / Va * 2);
        // angle-of-attack protection: beyond alpha prot the stick commands alpha, full aft = alpha max
        const aCmdMax = this.alphaProt + Math.max(0, c.stickY) * (this.alphaMax - this.alphaProt);
        if (this.alphaF > this.alphaProt - 1 * DEG) qCmd = Math.min(qCmd, (aCmdMax - this.alphaF) * 1.5);
        // pitch attitude: +30 degrees (25 at low speed), -15 degrees
        const thMax = (this.ias < 180 ? 25 : 30) * DEG;
        if (theta > thMax) qCmd = Math.min(qCmd, -(theta - thMax));
        if (theta < -15 * DEG) qCmd = Math.max(qCmd, (-15 * DEG - theta));
        // high-speed protection: a nose-up order above VMO + 6 kt / MMO + 0.01
        if (this.ias > 356 || this.mach > 0.83) qCmd = Math.max(qCmd, 1.5 * DEG);
      }
      this.qCmdFbw = qCmd;
      const deLaw = clamp(-Kq * (qCmd - this.q), -30 * DEG, 17 * DEG);
      // after lift-off the ground law's direct stick-to-elevator fades into the flight law over 5 s
      const deDirect = c.stickY > 0 ? -30 * DEG * c.stickY : -17 * DEG * c.stickY;
      this.de = flightBlend < 1 && !afs.ap ? lerp(deDirect, deLaw, flightBlend) : deLaw;
      // automatic trim offloads the elevator in flight (frozen below 50 ft in the flare)
      if (this.fbwMode === 'flight') this.ths += clamp(this.de * 0.25, -0.35 * DEG, 0.35 * DEG) * dt;
    }
    this.ths = clamp(this.ths, -13.5 * DEG, 4 * DEG);
    // ---------- roll & yaw ----------
    // laterally the ground law takes over as soon as the main wheels are down (and until lift-off)
    this._mwT = mainWow ? (this._mwT ?? 0) + dt : 0;
    const airb = this.fbwMode !== 'ground' && this._mwT < 0.2;
    if (airb && !direct) {
      let pCmd;
      if (afs.ap) {
        const pMax = afs.phase === 'GO AROUND' ? 7 * DEG : 5 * DEG;
        pCmd = clamp(1.1 * (afs.bankCmd - phi), -pMax, pMax);
        this._bankHold = phi;
      } else {
        const sx = Math.abs(c.stickX) > 0.04 ? c.stickX : 0;
        if (sx) { pCmd = sx * 15 * DEG; this._bankHold = phi; }
        else {
          const hold = clamp(this._bankHold ?? phi, -33 * DEG, 33 * DEG);
          pCmd = Math.abs(phi) > 33 * DEG ? -(phi - Math.sign(phi) * 33 * DEG) * 0.8 : clamp(1.2 * (hold - phi), -5 * DEG, 5 * DEG);
          if (Math.abs(phi) > 33 * DEG) this._bankHold = Math.sign(phi) * 33 * DEG;
        }
      }
      if (this.law === 'normal' && Math.abs(phi) > 60 * DEG) pCmd = Math.min(Math.abs(pCmd), 0) * Math.sign(pCmd) - (phi - Math.sign(phi) * 60 * DEG) * 1.5;
      pCmd *= flightBlend < 1 ? lerp(0.4, 1, flightBlend) : 1;
      const Kp = clamp(1.6 * 9000 / Vq, 0.4, 10);
      const e = pCmd - this.p;
      this._ia = clamp(this._ia + e * dt * 0.6, -0.25, 0.25);
      this.da = clamp(Kp * e + this._ia * Kp, -25 * DEG, 25 * DEG);
      // yaw damper, turn coordination, and the pedals commanding sideslip
      const rCmd = G * Math.sin(phi) / Math.max(Va, 30);
      // right pedal yaws the nose right, so the relative wind comes from the left: negative sideslip
      const betaCmd = -c.pedal * lerp(15, 2, smoothstep(160, 350, this.ias)) * DEG;
      this._ir = clamp(this._ir + (beta - betaCmd) * dt * 0.8, -0.35, 0.35);
      const rudLim = lerp(30, 3.5, smoothstep(160, 380, this.ias)) * DEG;
      this.dr = clamp(clamp(2.5 * 9000 / Vq, 0.3, 10) * (1.2 * (beta - betaCmd) + 0.9 * (rCmd - this.r)) + this._ir * 3 + c.pedal * rudLim * 0.4, -rudLim, rudLim);
    } else {
      this._ia *= 0.9; this._ir *= 0.9; this._bankHold = 0;
      this.da += (c.stickX * 25 * DEG - this.da) * Math.min(1, dt * 10);
      const rudLim = lerp(30, 3.5, smoothstep(160, 380, this.ias)) * DEG;
      this.dr += (clamp(c.pedal * 30 * DEG, -rudLim, rudLim) - this.dr) * Math.min(1, dt * 8);
    }
    this.ctrl.ail = this.da / (25 * DEG); this.ctrl.elev = this.de / (25 * DEG); this.ctrl.rud = this.dr / (30 * DEG);
  }

  // Route-following bank command for the NAV mode (with a lateral offset in metres, + right)
  navBank(Va, gs, offset = 0) {
    const path = this.path, sref = this.s;
    const tp = path.sample(sref, this._tmp);
    const nx = -tp.dz, nz = tp.dx; // right-hand normal
    const G2 = this.gearPoint;
    const e = (G2.x - tp.x) * nx + (G2.z - tp.z) * nz - offset; // + right of the desired track
    const look = path.sample(sref + Math.max(120, gs * 4), this._t3 || (this._t3 = {}));
    const chiPath = look.heading;
    const chi = this.track;
    const final = this._d2td() < 16000;
    const L = final ? Math.max(700, gs * 10) : Math.max(1500, gs * 18);
    const chiDes = chiPath - Math.atan(e / L);
    let dchi = angleDiff(chiDes, chi);
    // pointing the wrong way: commit to one direction of turn instead of dithering at 180 degrees
    if (Math.abs(dchi) > 150 * DEG) { this._uturn = this._uturn || Math.sign(dchi) || 1; dchi = this._uturn * Math.abs(dchi); } else this._uturn = 0;
    const kk = path.sample(sref + gs * 2, this._t4 || (this._t4 = {})).k;
    const ff = Math.atan(gs * gs * kk / G);
    const turnRate = clamp(dchi * 0.18, -3 * DEG, 3 * DEG);
    let bank = ff + Math.atan(gs * turnRate / G);
    const lim = this.agl < 150 ? 10 * DEG : final ? 18 * DEG : 25 * DEG;
    bank = clamp(bank, -lim, lim);
    this.xtk = e + offset;
    return bank;
  }

  // Divert the rest of the flight onto another route (e.g. back to Arlanda).
  divert(route) {
    this.route = route; this.path = route.path; this.m = route.m; this.airport = route.airport;
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], {});
    this.s = 0; for (let k = 0; k < 4; k++) { const tp = this.path.sample(this.s, this._tmp); this.s = clamp(this.s + (G2.x - tp.x) * tp.dx + (G2.z - tp.z) * tp.dz, 0, this.path.length); }
    this.emit('diverted');
  }

  // take-off trim from the load sheet: close to neutral, so that rotation takes a deliberate pull
  _toTrim() { return lerp(-0.6, 0.2, (this.mass - 55000) / 20000) * DEG; }
  _d2td() { return this.m.touchdown - this.s; }

  // Altitude (m) of the descent path as a function of distance to touchdown.
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
    const gx = this.gearPoint.x, gz = this.gearPoint.z;
    // along-route position: projection onto the local tangent, never faster than the aircraft can move
    // (far off a curved route the projection alone can jump to another leg)
    const maxStep = Math.max(2, Math.hypot(this.V.x, this.V.z) * dt * 2.5);
    for (let k = 0; k < 2; k++) {
      const tp = this.path.sample(this.s, this._tmp);
      this.s = clamp(this.s + clamp((gx - tp.x) * tp.dx + (gz - tp.z) * tp.dz, -maxStep, maxStep), 0, this.path.length);
    }
    // lift-off and touchdown bookkeeping (the crew decides what to do about them)
    const mainWow = this.wow[1] || this.wow[2];
    if (!mainWow && !this.wow[0] && this.agl > 0.3) { this.airborneT += dt; if (this.airborneT > 0.4 && !this.airborne) { this.airborne = true; this.liftoffT = this.t; this.emit('liftoff'); } }
    else if (mainWow) {
      if (this.airborne && this.airborneT > 3 && !this.crashed) {
        const sink = Math.max(this.contactSink[1] || 0, this.contactSink[2] || 0);
        this.touchdownT = this.t; this.touchdownSink = sink; this.touchdownS = this.s;
        this.thump = Math.min(1, sink / 2.2 + 0.3);
        this.emit('touchdown');
        if (sink > 3.05) this.emit('hard-landing');
        if (sink > 4.3) this._damage('hard-landing-severe');
      }
      this.airborne = false; this.airborneT = 0;
    }
    if (this.touchdownT > 0 && !mainWow && this.t - this.touchdownT < 5 && this.agl > 0.3 && !this.bounceT && this.phase === 'rollout') { this.bounceT = this.t; this.emit('bounce'); }
    // after a crash: the wreck has come to rest
    if (this.crashed && !this.crashStopped) {
      if (Math.hypot(this.V.x, this.V.z) < 0.8 && Math.abs(this.r) < 0.03 && this.onGround) { this._csT = (this._csT || 0) + dt; if (this._csT > 1.5) { this.crashStopped = true; this.emit('crash-stopped'); } } else this._csT = 0;
    }
  }

  // ---------------- physical failures (the events system) ----------------
  failEngine(i, kind = 1) { if (this.engFail[i]) return; this.engFail[i] = kind; this.engineRunning[i] = false; this.emit(`engine-failure-${i + 1}`); }
  depressurise(rate = 1) { this.pressurised = false; this.pressLeak = rate; this.emit('depressurisation'); }
  // compatibility: these are decisions, so they go to the crew
  goAround(reason = 'unstable') { return this.crew ? this.crew.goAround(reason) : false; }
  rejectTakeoff() { return this.crew ? this.crew.rejectTakeoff('event') : false; }
  emergencyDescent() { return this.crew ? this.crew.emergencyDescent() : false; }

  // ---------------- outputs for the renderer, audio and cabin ----------------
  _outputs(dt) {
    const G2 = this.worldPoint(G_LOCAL[0], G_LOCAL[1], G_LOCAL[2], this._t5 || (this._t5 = {}));
    this.pos.set(G2.x, Math.max(0, G2.y), G2.z);
    this.quat.set(this.Q.x, this.Q.y, this.Q.z, this.Q.w);
    this.h = Math.max(0, G2.y);
    this.gs = Math.hypot(this.V.x, this.V.z);
    this.v = this.onGround ? this.gs : Math.max(this.gs, this.tas * 0.9);
    this.vs = this.V.y;
    this.distToGo = this.m.stand - this.s;
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
    this.gamma = Math.asin(clamp(this.V.y / Math.max(this.tas, 1), -1, 1));
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
export { G_LOCAL as GEAR_POINT, CG as CG_POINT, VAPP, VR, V2, WHEELBASE };
