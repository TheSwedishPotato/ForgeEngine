// Auto flight system of the A320: the flight management and guidance computers (FMGC) with the
// flight control unit (FCU) the pilots turn and push, the autopilot, the flight directors and the
// autothrust. Nothing here moves a control surface directly: the autopilot sends pitch and roll
// orders to the fly-by-wire computers (physics.js) exactly as the sidestick would, and the flight
// directors show the same orders to a pilot flying by hand, who follows them with the sidestick.
//
// Modes (as on the flight mode annunciator):
//   thrust:   MAN TOGA / MAN FLX / MAN THR, THR CLB, THR IDLE, SPEED, MACH, A.FLOOR, TOGA LK
//   vertical: SRS, CLB, OP CLB, ALT*, ALT, ALT CRZ, DES, OP DES, V/S, EXPED, G/S*, G/S, FLARE, ROLL OUT
//   lateral:  RWY, RWY TRK, NAV, HDG, LOC*, LOC, GA TRK, ROLL OUT
import { DEG, KT, FT, G, clamp, lerp, smoothstep } from './core.js';
import { angleDiff } from './atmosphere.js';

export const DETENT = { REV_MAX: -1, REV_IDLE: -0.08, IDLE: 0, CL: 0.6, FLX: 0.8, TOGA: 1 };
// Airbus A320 characteristic speeds (kt CAS) against gross weight 40, 45 ... 80 t, per configuration
// clean, 1, 1+F, 2, 3, FULL: 1-g stall speed VS1g, lowest selectable speed VLS (in flight and for
// take-off), and the F and S flap-retraction speeds (A320 FCOM tables, as used by the FlyByWire A32NX)
const SPD = {
  vs: [[124, 131, 138, 145, 150, 156, 161, 166, 172], [102, 107, 112, 117, 123, 127, 132, 137, 141], [93, 98, 103, 108, 112, 117, 122.8, 126.8, 130],
    [91, 96, 101, 105, 110, 114, 119, 122, 126], [91, 96, 101, 105, 110, 114, 119, 122, 126], [84, 88, 93, 97, 101, 105, 109, 113, 116]],
  vs3Gear: [89, 94, 99, 103, 108, 112, 117, 120, 124],
  vls: [[159, 168, 177, 186, 192, 198, 206, 212, 220], [125, 132, 138, 144, 151, 156, 162, 169, 173], [114, 121, 127, 133, 138, 144, 149, 154, 160],
    [110, 119, 125, 131, 137, 142, 145, 149, 154], [117, 119, 125, 131, 137, 142, 147, 152, 156], [116, 116, 116, 120, 125, 130, 135, 139, 143]],
  vls3Gear: [116, 118, 124, 130, 136, 141, 146, 151, 155],
  vlsTo: [[159, 168, 177, 186, 192, 198, 206, 212, 220], [125, 132, 138, 144, 151, 156, 162, 169, 173], [105, 111, 116, 122, 127, 132, 137, 141, 147],
    [101, 108, 114, 119, 125, 130, 132, 136, 140], [101, 106, 112, 116, 122, 127, 132, 136, 140], [116, 116, 116, 120, 125, 130, 135, 139, 143]],
  f: [131, 131, 131, 137, 144, 149, 155, 160, 166],
  s: [152, 161, 169, 178, 186, 193, 200, 207, 214],
};
function speedAt(row, massKg) {
  const t = Math.min(79.999, Math.max(40, massKg / 1000)), i = Math.floor((t - 40) / 5), k = (t - 40 - i * 5) / 5;
  return row[i] + (row[i + 1] - row[i]) * k;
}
export { SPD as SPEED_TABLES, speedAt };
// FADEC N1 targets: idle on the ground / in flight / approach idle, climb, FLX (a typical flexible
// take-off, about 83 % of TOGA thrust; MCT shares its detent), TOGA and maximum reverse
const N1 = { idleGnd: 0.205, idleAir: 0.26, idleApp: 0.30, CL: 0.885, FLX: 0.90, TOGA: 0.97, REV: 0.72 };
export { N1 as N1_RATING };

export class Autoflight {
  constructor(fm) {
    this.fm = fm;
    this.ap = false; this.athr = false; this.athrArmed = false; this.fd = true;
    this.lat = ''; this.latArmed = ''; this.vert = ''; this.vertArmed = ''; this.thr = 'MAN THR';
    this.fcu = { alt: 5000, spd: null, mach: null, hdg: null, vs: null, altManaged: true, std: false };
    this.phase = 'PREFLIGHT';
    this.v1 = 138; this.vr = 141; this.v2 = 146; this.thrRedAgl = 1500 * FT; this.accAgl = 1500 * FT; this.crzFt = 36000;
    this.offset = 0;            // lateral offset from the route (m, + right), e.g. to go round a storm
    this.qCmd = 0; this.bankCmd = 0; this.yawCmd = 0; this.n1Cmd = N1.idleGnd; this.gammaCmd = 0;
    this.spdTarget = 0; this.locDev = 0; this.gsDev = 0; this.locValid = false; this.gsValid = false;
    this.retard = false; this.alphaFloor = false; this.log = [];
    this.approachRwy = null;
    this._altStar = false;
  }

  // ---------- FCU and pedestal actions (used by the pilots) ----------
  engageAP() { if (this.fm.onGround && this.fm.agl < 30) return false; this.ap = true; return true; }
  disconnectAP(reason = 'pilot') { if (!this.ap) return; this.ap = false; this.fm.emit('ap-off'); if (reason !== 'pilot') this.fm.emit('ap-off-auto'); }
  athrOn() { this.athr = true; }
  athrOff() { this.athr = false; }
  setAlt(ft) { this.fcu.alt = Math.round(ft / 100) * 100; }
  setSpd(kt) { this.fcu.spd = kt; }                         // selected speed (pull)
  managedSpd() { this.fcu.spd = null; this.fcu.mach = null; } // push
  setHdg(deg) { this.fcu.hdg = ((deg % 360) + 360) % 360; this.lat = 'HDG'; }
  nav() { this.fcu.hdg = null; if (this.lat !== 'LOC' && this.lat !== 'LOC*') this.lat = 'NAV'; }
  // pull the altitude knob: open climb/descent towards the FCU altitude
  pullAlt() { const tgt = this.fcu.alt * FT, cur = this.fm.altInd; if (Math.abs(tgt - cur) < 60) return; const m = tgt > cur ? 'OP CLB' : 'OP DES'; if (this.vert === 'SRS' && m === 'OP CLB') { this.vertArmed = m; return; } this.vert = m; this._altStar = false; }
  // push: managed climb/descent
  pushAlt() { const tgt = this.fcu.alt * FT, cur = this.fm.altInd; if (Math.abs(tgt - cur) < 60) return; const m = tgt > cur ? 'CLB' : 'DES'; if (this.vert === 'SRS' && m === 'CLB') { this.vertArmed = m; return; } this.vert = m; this._altStar = false; }
  setVS(fpm) { this.fcu.vs = fpm; this.vert = 'V/S'; this._altStar = false; this._vsNoAlt = this.fcu.alt === 0; }
  armLoc() { this.latArmed = 'LOC'; }
  armAppr(rwy) { this.approachRwy = rwy; this.latArmed = 'LOC'; this.vertArmed = 'G/S'; }
  // thrust levers to TOGA in flight (go-around) or on the runway
  toga(ga = false) {
    this.athr = true; this.athrArmed = true; // TOGA engages the autothrust (active once the levers come back to CL)
    if (ga) { this.phase = 'GO AROUND'; this.vert = 'SRS'; this.lat = 'GA TRK'; this.latArmed = ''; this.vertArmed = ''; this.fcu.spd = null; this._gaTrack = this.fm.track; }
  }

  // Take-off data from weight and configuration (what the crew enters in the MCDU PERF page):
  // V2 = 1.2 VS1g in CONF 1+F, at least 1.1 VMCA (114 kt at Arlanda's elevation)
  takeoffData(massKg, flexOk = true) {
    const vs = speedAt(SPD.vs[2], massKg);
    this.v2 = Math.round(Math.max(1.2 * vs, 1.1 * 114, speedAt(SPD.vlsTo[2], massKg)));
    this.vr = this.v2 - 4; this.v1 = this.vr - 2;
    this.flex = flexOk;
    return { v1: this.v1, vr: this.vr, v2: this.v2 };
  }
  // VLS (the lowest selectable speed, 1.23 VS1g in the landing configurations) from the Airbus tables;
  // Vapp = VLS + max(5, headwind/3), at most +15
  vls(cfg = 5, mass = this.fm.mass) {
    if (cfg === 4 && this.fm.gear > 0.5) return speedAt(SPD.vls3Gear, mass);
    return speedAt(SPD.vls[cfg], mass);
  }
  vs1g(cfg = 0, mass = this.fm.mass) { return cfg === 4 && this.fm.gear > 0.5 ? speedAt(SPD.vs3Gear, mass) : speedAt(SPD.vs[cfg], mass); }
  // green dot (best lift/drag, clean): 2 kt per tonne + 85 kt below FL200, 1 kt per 1,000 ft above it
  greenDot(mass = this.fm.mass) { const alt = this.fm.altInd / FT; return 2 * mass / 1000 + 85 + Math.max(0, (alt - 20000) / 1000); }
  sSpeed(mass = this.fm.mass) { return speedAt(SPD.s, mass); }
  fSpeed(mass = this.fm.mass) { return speedAt(SPD.f, mass); }

  // ---------- per physics step ----------
  update(dt) {
    const fm = this.fm;
    const air = fm.air;
    const Va = Math.max(fm.tas, 30);
    const agl = fm.agl, gs = fm.gs;
    this._ils(fm);
    const ias = fm.ias;
    // --- flight phase (FMGC) ---
    if (this.phase === 'PREFLIGHT' && fm.ctl.thr[0] >= DETENT.FLX - 0.02 && fm.ctl.thr[1] >= DETENT.FLX - 0.02) { this.phase = 'TAKEOFF'; this.vert = 'SRS'; this.lat = 'RWY'; this.latArmed = 'NAV'; this.thr = fm.ctl.thr[0] >= 0.98 ? 'MAN TOGA' : 'MAN FLX'; this.athrArmed = true; this.athr = true; }
    // acceleration altitude: SRS gives way to the climb mode (unless the altitude is already being captured)
    if (this.phase === 'TAKEOFF' && agl > this.accAgl) { this.phase = 'CLIMB'; if (this.vert === 'SRS') { this.vert = this.fcu.alt * FT > fm.altInd + 60 ? (this.vertArmed === 'OP CLB' ? 'OP CLB' : 'CLB') : 'ALT*'; this.vertArmed = ''; } }
    if (this.phase === 'GO AROUND' && agl > 1500 * FT && this.vert === 'SRS') { this.vert = this.fcu.alt * FT > fm.altInd + 60 ? 'OP CLB' : 'ALT*'; }
    if (this.lat === 'RWY' && agl > 30) this.lat = 'RWY TRK';
    if ((this.lat === 'RWY TRK' || this.lat === 'GA TRK') && this.latArmed === 'NAV' && agl > 30 * FT) this.lat = 'NAV', this.latArmed = '';
    // --- thrust lever position decides the autothrust mode ---
    // the lever of each running engine; with one engine out the autothrust works up to the MCT detent
    const eoNow = fm.engFail[0] || fm.engFail[1] || !fm.engineRunning[0] || !fm.engineRunning[1];
    const tla = Math.max(fm.engineRunning[0] ? fm.ctl.thr[0] : -9, fm.engineRunning[1] ? fm.ctl.thr[1] : -9, eoNow ? -9 : 0);
    this.athrTop = eoNow ? DETENT.FLX : DETENT.CL;
    const inAthrRange = tla > 0.02 && tla <= this.athrTop + 0.02;
    // setting the thrust levers to IDLE disconnects the autothrust (the retard in the flare, or on the ground)
    if (this.athr && this.phase !== 'PREFLIGHT' && tla <= 0.01 && (fm.onGround || this.vert === 'FLARE' || this.retard)) { this.athr = false; this.athrArmed = false; }
    this.alphaFloor = fm.law === 'normal' && !fm.onGround && agl > 30 && (fm.alphaF ?? fm.alpha) > fm.alphaFloor && this.athrArmed;
    if (this.alphaFloor) { this.thr = 'A.FLOOR'; this._toga = 3; }
    // --- speed target ---
    this.spdTarget = this._speedTarget(fm);
    // --- vertical guidance -> flight path angle command (null = speed on pitch) ---
    const altT = this.fcu.alt * FT, altI = fm.altInd;
    const toAlt = altT - altI;
    let gammaCmd = null, thrSpeed = true, nzLim = 0.12;
    const vsNow = fm.vs;
    // altitude capture from any climb or descent mode
    const capturing = ['CLB', 'OP CLB', 'DES', 'OP DES', 'V/S', 'SRS', 'EXPED'].includes(this.vert) && Math.abs(toAlt) < Math.max(60, Math.abs(vsNow) * 11) && Math.sign(toAlt) === Math.sign(vsNow || toAlt);
    if (capturing && (this.phase !== 'TAKEOFF' || agl > 400) && (this.phase !== 'GO AROUND' || agl > 300)) { this.vert = 'ALT*'; this.fm.emit('alt-star'); }
    if (this.vert === 'ALT*' && Math.abs(toAlt) < 12 && Math.abs(vsNow) < 1.5) { this.vert = this.phase === 'CRUISE' || Math.abs(this.fcu.alt - this.crzFt) < 60 ? 'ALT CRZ' : 'ALT'; this.fm.emit('alt-captured'); }
    switch (this.vert) {
      case 'SRS': { // speed reference system: V2+10 (V2 with an engine out), pitch limited to 18 degrees
        const eo = fm.engFail[0] || fm.engFail[1];
        this.spdTarget = this.phase === 'GO AROUND' ? Math.max(this.vappFor(), ias) : (eo ? this.v2 : this.v2 + 10);
        gammaCmd = null; thrSpeed = false; nzLim = 0.25;
        break;
      }
      case 'CLB': case 'OP CLB': case 'DES': case 'OP DES': case 'EXPED':
        gammaCmd = null; thrSpeed = false; break;
      case 'ALT*': gammaCmd = Math.asin(clamp(clamp(toAlt * 0.09, -9, 9) / Va, -0.2, 0.2)); nzLim = 0.1; break;
      case 'ALT': case 'ALT CRZ': gammaCmd = Math.asin(clamp(clamp(toAlt * 0.06, -5, 5) / Va, -0.1, 0.1)); nzLim = 0.08; break;
      case 'V/S': { let v = (this.fcu.vs ?? 0) * FT / 60; if (Math.sign(toAlt) !== Math.sign(v) && Math.abs(toAlt) > 60) v = 0; gammaCmd = Math.asin(clamp(v / Va, -0.2, 0.15)); break; }
      case 'G/S*': case 'G/S': {
        // track the glide slope: -3 degrees plus a correction proportional to the height error
        const err = this.gsErrM;
        const dist = Math.max(300, this.gsDist);
        const k = clamp(1600 / dist, 0.3, 1.2);
        const vsGS = -gs * Math.tan(this.approachRwy?.gs ?? 3 * DEG);
        gammaCmd = Math.asin(clamp((vsGS - err * 0.06 * k) / Va, -0.14, 0.04));
        if (this.vert === 'G/S*' && Math.abs(err) < 8) this.vert = 'G/S';
        nzLim = 0.12;
        break;
      }
      case 'FLARE': { // autoland flare: sink rate proportional to height
        const tau = 4.0, v = -(Math.max(0, agl) + 0.5 * tau * 0.6) / tau;
        gammaCmd = Math.asin(clamp(v / Va, -0.14, 0.05)); nzLim = 0.3;
        break;
      }
      default: gammaCmd = null;
    }
    // managed descent: follow the vertical profile computed from the distance to go, idle thrust
    if (this.vert === 'DES' && this.profileAlt != null) {
      const err = this.profileAlt - altI;
      const vsPath = -gs * (this.profileSlope ?? Math.tan(3 * DEG));
      // below the path: a gentle 1000 ft/min until it is met; above it: steeper (the crew add speed brakes)
      let v = err > 30 ? -1000 * FT / 60 : vsPath + err * 0.03;
      v = Math.min(v, -300 * FT / 60);
      gammaCmd = Math.asin(clamp(v / Va, -0.2, 0));
      thrSpeed = true;
      // too fast on the profile: speed brakes (the pilots extend them when asked)
      this.tooFast = ias > this.spdTarget + 12;
    }
    // G/S capture from below: arm when LOC is captured and the beam comes down to meet us
    if (this.vertArmed === 'G/S' && this.gsValid && this.lat.startsWith('LOC') && this.gsErrM > -20 && this.gsErrM < 60) { this.vert = 'G/S*'; this.vertArmed = ''; fm.emit('gs-capture'); }
    if (this.latArmed === 'LOC' && this.locValid && Math.abs(this.locDevM) < Math.max(150, this.gsDist * 0.03) && this.lat !== 'LOC') { this.lat = 'LOC*'; this.latArmed = ''; fm.emit('loc-capture'); }
    if (this.lat === 'LOC*' && Math.abs(this.locDevM) < 25 && Math.abs(this.trackErr) < 3 * DEG) this.lat = 'LOC';
    // autoland: FLARE at 40 ft, ROLL OUT on the ground
    if (this.ap && this.vert === 'G/S' && agl < 40 * FT && this.lat === 'LOC') { this.vert = 'FLARE'; this.lat = 'FLARE'; fm.emit('ap-flare'); }
    if ((this.vert === 'FLARE' || this.vert === 'G/S') && fm.onGround && (fm.wow[1] || fm.wow[2])) { this.vert = 'ROLL OUT'; this.lat = 'ROLL OUT'; }
    this.gammaCmd = gammaCmd;
    // --- thrust: TECS-style energy split ---
    const eo = (fm.engFail[0] ? 1 : 0) + (fm.engFail[1] ? 1 : 0);
    const mg = fm.mass * G;
    const Vc = this._tas(this.spdTarget, air);
    const aDes = clamp(0.06 * (Vc - Va), -0.6, 0.6);
    const Tnow = fm.thrust[0] + fm.thrust[1];
    const gamma = Math.asin(clamp(fm.V.y / Math.max(Va, 1), -1, 1));
    const idle = agl < 2000 * FT && (fm.cfg > 0 || fm.gear > 0.5) ? N1.idleApp : N1.idleAir;
    let n1 = N1.CL;
    let speedOnPitch = gammaCmd == null;
    if (speedOnPitch) {
      // speed on pitch: CLB/OP CLB with climb thrust, DES/OP DES at idle, SRS with the take-off thrust
      const climbing = ['CLB', 'OP CLB', 'SRS', 'EXPED'].includes(this.vert) && (this.vert !== 'EXPED' || toAlt > 0);
      n1 = climbing ? (this.vert === 'SRS' ? (tla > DETENT.CL + 0.05 ? this._leverN1(tla) : N1.CL) : N1.CL) : idle;
      this.thr = climbing ? (this.vert === 'SRS' && tla > DETENT.CL + 0.05 ? (tla > 0.98 ? 'MAN TOGA' : 'MAN FLX') : 'THR CLB') : 'THR IDLE';
      // flight path that the thrust available allows at the target speed
      let gc = (Tnow - fm.drag) / mg - aDes / G;
      if (!climbing && this.vert.includes('DES')) gc = Math.min(gc, -0.005);
      gammaCmd = clamp(gc, -0.2, this.vert === 'SRS' ? 0.3 : 0.25);
      if (this.vert === 'OP DES' || this.vert === 'DES') gammaCmd = Math.min(gammaCmd, 0);
      nzLim = this.vert === 'SRS' ? 0.25 : 0.12;
    } else {
      const Treq = fm.drag + mg * Math.sin(gammaCmd) + fm.mass * aDes;
      n1 = clamp(fm.n1ForThrust(Treq / Math.max(1, 2 - eo), air, fm.mach), idle, N1.TOGA);
      this.thr = fm.mach > 0.6 && this.spdTarget > 250 ? 'MACH' : 'SPEED';
    }
    if (this.vert === 'FLARE' && agl < 10 * FT) { n1 = idle * 0.95; this.thr = 'RETARD'; this.retard = true; }
    if (this.alphaFloor || this._toga > 0) { n1 = N1.TOGA; this._toga -= dt; this.thr = this.alphaFloor ? 'A.FLOOR' : 'TOGA LK'; }
    this.n1Cmd = n1;
    this.athrActive = this.athr && inAthrRange;
    if (!this.athrActive) this.thr = tla > 0.98 ? 'MAN TOGA' : tla > DETENT.CL + 0.05 ? (fm.onGround || agl < 30 ? 'MAN FLX' : 'MAN MCT') : tla < 0 ? 'REV' : 'MAN THR';
    this.speedOnPitch = speedOnPitch;
    // --- flight path -> pitch rate order (limited to comfortable load factors) ---
    const phi = fm.bank;
    const phiC = clamp(phi, -33 * DEG, 33 * DEG);
    const qTurn = G / Math.max(Va, 40) * Math.tan(phiC) * Math.sin(phiC);
    const fl = this.vert === 'FLARE';
    const gff = this._gcPrev != null && dt > 0 ? clamp((gammaCmd - this._gcPrev) / dt, -0.05, 0.05) : 0;
    this._gcPrev = gammaCmd;
    this.qCmd = clamp((fl ? 1.0 : 0.45) * (gammaCmd - gamma) + (fl ? gff : 0), -nzLim * G / Va, nzLim * G / Va) + qTurn;
    this.qTurn = qTurn;
    // --- lateral guidance -> bank order ---
    this.bankCmd = this._lateral(fm, Va, gs);
    // rollout: yaw towards the runway centreline
    if (this.lat === 'ROLL OUT' || this.lat === 'RWY') this.yawCmd = clamp(-this.locDevM * 0.004 - this.trackErr * 1.2, -0.3, 0.3);
    // autopilot disconnects if the aircraft is flown outside its limits or a pilot pushes the stick hard
    if (this.ap && (Math.abs(fm.ctl.stickX) > 0.45 || Math.abs(fm.ctl.stickY) > 0.45)) this.disconnectAP('override');
    if (this.ap && (fm.law !== 'normal' || Math.abs(phi) > 45 * DEG || (fm.alphaF ?? fm.alpha) > fm.alphaProt)) this.disconnectAP('limits');
  }

  vappFor() { return this.fm.vappTarget ?? 137; }
  _tas(ias, air) { return ias * KT / Math.sqrt(air.rho / 1.225); }
  _iasForMach(M, air) { const tas = M * air.a; return Math.sqrt(air.rho / 1.225) * tas / KT; }
  _leverN1(tla, idle = N1.idleAir) {
    if (tla <= 0) return idle;
    if (tla <= DETENT.CL) return lerp(idle, N1.CL, tla / DETENT.CL);
    if (tla <= DETENT.FLX) return lerp(N1.CL, N1.FLX, (tla - DETENT.CL) / (DETENT.FLX - DETENT.CL));
    return lerp(N1.FLX, N1.TOGA, (tla - DETENT.FLX) / (DETENT.TOGA - DETENT.FLX));
  }

  // Managed speed from the flight phase and configuration, unless a speed is selected on the FCU.
  _speedTarget(fm) {
    const air = fm.air;
    if (this.fcu.spd != null) return this.fcu.spd;
    if (this.fcu.mach != null) return this._iasForMach(this.fcu.mach, air);
    const cfg = fm.cfgTarget, h = fm.altInd;
    const gd = this.greenDot(), vapp = this.vappFor();
    const cfgMin = [gd, this.sSpeed(), this.fSpeed(), this.fSpeed(), this.fSpeed() - 8, vapp][cfg];
    const vfe = [340, 230, 215, 200, 185, 177][cfg] - 5;
    let v;
    switch (this.phase) {
      case 'TAKEOFF': v = this.v2 + 10; break;
      case 'CLIMB': case 'CRUISE': v = h < 10000 * FT - 60 ? 250 : Math.min(290, this._iasForMach(0.78, air)); if (this.phase === 'CRUISE' && h > 10000 * FT) v = this._iasForMach(0.78, air); break;
      case 'DESCENT': v = h < 10300 * FT ? 250 : Math.min(290, this._iasForMach(0.78, air)); break;
      case 'APPROACH': v = cfg === 0 ? Math.max(gd, 210) : cfg === 1 ? this.sSpeed() : cfg <= 3 ? this.fSpeed() : cfg === 4 ? Math.max(vapp, this.fSpeed() - 12) : vapp; break;
      case 'GO AROUND': v = cfg >= 3 ? vapp + 5 : cfg >= 1 ? this.fSpeed() : gd; break;
      default: v = 250;
    }
    // an ATC speed restriction, then the flap limits and the minimum for the configuration
    if (this.atcSpd != null && this.phase !== 'GO AROUND') v = Math.min(v, Math.max(this.atcSpd, this.phase === 'APPROACH' ? vapp : 0));
    if (this.phase === 'CLIMB' || this.phase === 'TAKEOFF') v = Math.max(v, cfg > 0 ? 0 : gd);
    return clamp(v, Math.min(cfgMin, vapp), vfe);
  }

  // Lateral guidance -> bank command (rad)
  _lateral(fm, Va, gs) {
    const lim = fm.agl < 400 * FT ? 15 * DEG : this.lat.startsWith('LOC') ? 25 * DEG : 25 * DEG;
    const trk = fm.track;
    if (this.lat === 'HDG' && this.fcu.hdg != null) {
      const e = angleDiff(this.fcu.hdg * DEG, fm.heading);
      return clamp(e * 1.4, -lim, lim);
    }
    if (this.lat === 'RWY' || this.lat === 'RWY TRK' || this.lat === 'GA TRK') {
      const tgt = this.lat === 'GA TRK' ? (this._gaTrack ?? trk) : this.lat === 'RWY' ? fm.depHdg : (this._rwyTrk ?? (this._rwyTrk = trk));
      return clamp(angleDiff(tgt, trk) * 1.2, -10 * DEG, 10 * DEG);
    }
    if (this.lat.startsWith('LOC') || this.lat === 'FLARE' || this.lat === 'ROLL OUT') {
      const R = this.approachRwy; if (!R) return 0;
      const crs = R.hdg * DEG;
      const dist = Math.max(500, this.gsDist);
      // intercept at up to 30 degrees, then track the beam with a gain that tightens as it narrows
      const e = this.locDevM; // + right of the centreline
      const k = clamp(dist / 9000, 0.6, 3);
      const intercept = clamp(-e / (700 * k), -30 * DEG, 30 * DEG);
      const trkErr = angleDiff(crs + intercept, trk);
      const bank = clamp(trkErr * 2.2 * clamp(gs / 70, 0.8, 1.6), -lim, lim);
      return this.lat === 'FLARE' ? bank * 0.3 : bank;
    }
    // NAV: follow the route (with any lateral offset for weather)
    return fm.navBank(Va, gs, this.offset);
  }

  // ILS receivers: localizer at the far end of the runway, glide slope beside the touchdown zone
  _ils(fm) {
    const R = this.approachRwy;
    this.locValid = false; this.gsValid = false; this.trackErr = 0;
    if (!R) { this.locDevM = 0; this.gsErrM = 0; this.gsDist = 1e9; return; }
    const p = fm.gearPoint;
    const dx = p.x - R.thr.x, dz = p.z - R.thr.y;
    const along = dx * R.dir.x + dz * R.dir.y;             // + past the threshold
    const cross = dx * -R.dir.y + dz * R.dir.x;            // + right of the centreline (looking along the landing direction)
    this.locDevM = cross;
    const locDist = R.len + 300 - along;                   // distance to the localizer antenna
    this.locValid = locDist < 46000 && Math.abs(Math.atan2(cross, locDist)) < 35 * DEG && along < R.len;
    const gsx = R.tdz - along;                              // distance to the glide slope antenna
    this.gsDist = gsx;
    const hGS = Math.tan(R.gs) * gsx + 0.5;                // glide path height (m above the runway) at this point
    this.gsErrM = fm.agl - hGS;                             // + above the glide path
    this.gsValid = gsx > 150 && gsx < 36000 && Math.abs(Math.atan2(cross, gsx)) < 10 * DEG;
    this.trackErr = angleDiff(fm.track, R.hdg * DEG);
    this.locDots = clamp(Math.atan2(cross, locDist) / DEG / 0.8, -2.5, 2.5);
    this.gsDots = gsx > 0 ? clamp((Math.atan2(fm.agl, gsx) - R.gs) / DEG / 0.35, -2.5, 2.5) : 0;
  }

  // Short FMA text for the flight-deck panel
  fma() {
    return { thr: this.athr ? (this.athrActive ? this.thr : this.athrArmed ? 'A/THR' : '') : this.thr, vert: this.vert + (this.vertArmed ? ` · ${this.vertArmed}` : ''), lat: this.lat + (this.latArmed ? ` · ${this.latArmed}` : ''), ap: `${this.ap ? 'AP1 ' : ''}${this.fd ? '1FD2 ' : ''}${this.athr ? 'A/THR' : ''}`.trim() };
  }
}
