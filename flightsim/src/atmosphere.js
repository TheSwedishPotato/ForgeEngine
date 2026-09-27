// The air the aircraft flies through: ISA, a wind profile that strengthens and veers with
// height, Dryden turbulence (MIL-F-8785C) whose intensity depends on the weather, the
// height and the sun, and discrete hazards: clear-air turbulence patches, convective
// bumps under and inside cumulus, microburst windshear and wake vortices.
import { DEG, KT, FT, G, clamp, lerp, smoothstep, isa, rng } from './core.js';

// Parse the preset's '230° / 16 kt' into a direction (from, radians) and speed (m/s).
export function parseWind(str) {
  const m = /(\d+)°\s*\/\s*(\d+)/.exec(str || '');
  if (!m) return { from: 0, speed: 0 };
  return { from: +m[1] * DEG, speed: +m[2] * KT };
}

// Gaussian white noise (Box-Muller) from a seeded uniform generator.
function gauss(r) { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

export class Atmosphere {
  constructor(weather = {}, opts = {}) {
    this.W = weather;
    this.r = rng(opts.seed ?? 1415);
    const w = parseWind(weather.wind);
    this.surfFrom = w.from; this.surfSpeed = w.speed;
    // upper winds over southern Scandinavia in May: westerly, strengthening to a 45-60 kt jet
    this.jetFrom = 255 * DEG; this.jetSpeed = (45 + 15 * this.r()) * KT;
    this.cuBase = weather.cumulus > 0 ? weather.cuBase : 1e9; this.cuTop = weather.cumulus > 0 ? weather.cuTop : -1;
    this.stBase = weather.stratus ? weather.stratus.base : 1e9; this.stTop = weather.stratus ? weather.stratus.top : -1;
    this.cumulus = weather.cumulus || 0;
    this.baseTurb = weather.turb ?? 0.3;
    this.boost = 1;           // scaled by the director / events
    this.sunHeat = 0.5;       // 0 at night, 1 on a sunny afternoon (set each frame)
    // Dryden filter states (m/s and rad/s)
    this.ug = 0; this.vg = 0; this.wg = 0; this.pg = 0; this.wgPrev = 0; this.vgPrev = 0;
    this.qg = 0; this.rg = 0;
    this.sigma = 0;           // current vertical gust intensity (m/s), for the director and UI
    this.hazards = [];        // { kind, ... } active discrete hazards
    this.out = { wx: 0, wy: 0, wz: 0, pg: 0, qg: 0, rg: 0 };
  }

  // Mean wind (world frame, m/s, the direction the air moves towards) at height h.
  meanWind(h, out) {
    let speed, from;
    if (h < 300) { speed = this.surfSpeed * Math.pow(Math.max(h, 2) / 10, 0.14); from = this.surfFrom + 10 * DEG * (h / 300); }
    else {
      const k = smoothstep(300, 10000, h);
      speed = lerp(this.surfSpeed * Math.pow(30, 0.14), this.jetSpeed, k);
      from = this.surfFrom + 10 * DEG + angleDiff(this.jetFrom, this.surfFrom + 10 * DEG) * k;
    }
    const to = from + Math.PI;
    out.x = Math.sin(to) * speed; out.z = -Math.cos(to) * speed; out.speed = speed; out.from = from;
    return out;
  }

  // Vertical gust intensity sigma_w (m/s) from the weather at this height.
  intensity(h, inCloud) {
    const W = this.W;
    let s = (0.12 + 0.35 * this.baseTurb) * (0.45 + 0.55 * smoothstep(200, 900, h)); // background
    // mechanical turbulence in the surface layer, grows with the wind (MIL-F-8785C: sigma_w = 0.1 W20)
    s += 0.1 * this.surfSpeed * (1 - smoothstep(150, 700, h));
    // convection: thermals under fair-weather cumulus on a sunny day, up to the cloud tops
    const convTop = this.cumulus > 0 ? this.cuTop : 1400;
    s += (0.35 + 1.1 * this.cumulus) * this.sunHeat * (1 - smoothstep(convTop * 0.85, convTop * 1.15, h)) * smoothstep(40, 300, h);
    // inside cloud
    if (inCloud) s += this.cumulus > 0 ? 1.2 + 1.2 * this.cumulus : 0.7;
    // a little chop in the jet-stream shear near cruise levels
    s += 0.25 * smoothstep(8000, 10500, h) * this.baseTurb;
    return s * this.boost;
  }

  inCloudAt(h) { return (h > this.stBase && h < this.stTop) || (this.cumulus > 0.25 && h > this.cuBase && h < this.cuTop && this._cellCloud > 0.5); }

  // Advance turbulence and hazards; returns wind (world, m/s) + gust body rates (rad/s).
  // body: {fwdX, fwdZ} unit forward vector on the ground, V airspeed, h height, pos {x,z}.
  step(dt, h, V, pos, fwdX, fwdZ, out = this.out) {
    const r = this.r;
    V = Math.max(V, 5);
    // cumulus cells passing by: a slow random process decides whether we are in a cloud column
    this._cellT = (this._cellT ?? 0) - dt * V / 1200;
    if (this._cellT <= 0) { this._cellT = 1; this._cellCloud = r() < this.cumulus ? 1 : 0; }
    const inCloud = this.inCloudAt(h);
    let sw = this.intensity(h, inCloud);
    // scale lengths (MIL-F-8785C): low altitude grows with height, 533 m (1750 ft) above ~600 m
    const hft = Math.max(10, h / FT);
    let Lw, Lu, su, sv;
    if (hft < 1000) { Lw = hft * FT; Lu = hft / Math.pow(0.177 + 0.000823 * hft, 1.2) * FT; const k = 1 / Math.pow(0.177 + 0.000823 * hft, 0.4); su = sw * k; sv = su; }
    else if (hft < 2000) { const k = (hft - 1000) / 1000; Lw = lerp(1000 * FT, 533, k); Lu = lerp(1000 / Math.pow(0.177 + 0.823, 1.2) * FT, 533, k); su = sv = sw; }
    else { Lw = Lu = 533; su = sv = sw; }
    // discrete hazards add to the continuous field
    let hx = 0, hy = 0, hz = 0, hp = 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const z = this.hazards[i];
      z.t += dt;
      if (z.kind === 'cat') { // clear-air turbulence patch: intensity ramps up and down
        const k = Math.sin(Math.PI * clamp(z.t / z.dur, 0, 1));
        sw += z.sigma * k; su += z.sigma * 0.6 * k; sv += z.sigma * 0.8 * k;
        if (z.jolt && z.t > z.dur * 0.4 && !z.jolted) { z.jolted = true; z.joltV = -z.jolt; z.joltT = 0; }
        // the big one: a downdraft that sets in within about half a second and dies away more slowly;
        // the aircraft is left sinking through the air, so the load factor overshoots above 1 g after it
        if (z.joltV) { const w = z.width, t1 = z.joltT - 1.0; z.joltT += dt; hy += z.joltV * Math.exp(-(t1 * t1) / (t1 < 0 ? w : w * 6)); if (z.joltT > 7) z.joltV = 0; }
      } else if (z.kind === 'microburst') { // Oseguera-Bowles-like: radial outflow and a downdraft core
        const dx = pos.x - z.x, dz = pos.z - z.z; const rr = Math.hypot(dx, dz) + 1;
        const R = z.R, k = rr < R ? rr / R : Math.exp(-(((rr - R) / (0.8 * R)) ** 2)) * R / rr;
        const hk = Math.exp(-h / 900) - Math.exp(-h / 60);
        const out = z.u * k * hk * 2.2;
        hx += dx / rr * out; hz += dz / rr * out;
        hy += -z.w * Math.exp(-((rr / (0.9 * R)) ** 2)) * (1 - Math.exp(-h / 120));
        if (z.t > z.life) this.hazards.splice(i, 1);
        continue;
      } else if (z.kind === 'wake') { // crossing a vortex pair: a sharp rolling moment and a vertical jolt
        const k = Math.exp(-((z.t - z.at) ** 2) / 0.3);
        hp += z.roll * k * Math.sign(Math.sin(z.t * 2.4 + 1)); hy += z.up * Math.sin(z.t * 3.1) * k;
      } else if (z.kind === 'thermal') {
        hy += z.w * Math.sin(Math.PI * clamp(z.t / z.dur, 0, 1));
      }
      if (z.t > (z.dur ?? z.life ?? 10)) this.hazards.splice(i, 1);
    }
    // Dryden-like first-order (Ornstein-Uhlenbeck) filters driven by white noise
    const au = Math.exp(-V * dt / Lu), aw = Math.exp(-V * dt / Lw);
    this.ug = au * this.ug + su * Math.sqrt(1 - au * au) * gauss(r);
    this.vgPrev = this.vg; this.wgPrev = this.wg;
    this.vg = au * this.vg + sv * Math.sqrt(1 - au * au) * gauss(r);
    this.wg = aw * this.wg + sw * Math.sqrt(1 - aw * aw) * gauss(r);
    // angular gusts: roll from the spanwise gradient, pitch and yaw from the travel of w and v along the fuselage
    const b = 34.1, sp = 1.9 * sw / Math.sqrt(Lw * b), ap = Math.exp(-V * dt / (Math.PI * b / 4 * 4));
    this.pg = ap * this.pg + sp * Math.sqrt(1 - ap * ap) * gauss(r);
    this.qg = -(this.wg - this.wgPrev) / (dt * V) * 0.5; this.rg = (this.vg - this.vgPrev) / (dt * V) * 0.5;
    this.sigma = sw;
    // gusts are given along the aircraft's track: u along the nose, v to the right, w up
    const rx = -fwdZ, rz = fwdX;
    const mw = this.meanWind(h, this._mw || (this._mw = {}));
    out.wx = mw.x + fwdX * this.ug + rx * this.vg + hx;
    out.wz = mw.z + fwdZ * this.ug + rz * this.vg + hz;
    out.wy = this.wg + hy;
    out.pg = this.pg + hp; out.qg = this.qg; out.rg = this.rg;
    out.inCloud = inCloud;
    return out;
  }

  // Mean wind components on a runway heading (radians): head (+ from ahead) and cross (+ from the right).
  runwayWind(hdg, h = 10) {
    const w = this.meanWind(h, {});
    const ax = Math.sin(hdg), az = -Math.cos(hdg);
    return { head: -(w.x * ax + w.z * az), cross: -(w.x * -az + w.z * ax), speed: w.speed };
  }

  // ---------------- hazards the events system can trigger ----------------
  // jolt: peak downdraft (m/s); width: how sharp its onset is (s^2, smaller = more violent)
  addCAT(sigma = 3.5, dur = 70, jolt = 0, width = 0.35) { this.hazards.push({ kind: 'cat', t: 0, sigma, dur, jolt, width }); }
  addMicroburst(x, z, { R = 900, u = 12, w = 9, life = 600 } = {}) { this.hazards.push({ kind: 'microburst', t: 0, x, z, R, u, w, life }); }
  addWake(roll = 0.35, up = 3, dur = 5) { this.hazards.push({ kind: 'wake', t: 0, at: 1.2, roll, up, dur }); }
  addThermal(w = 2, dur = 6) { this.hazards.push({ kind: 'thermal', t: 0, w, dur }); }
}

function angleDiff(a, b) { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
export { angleDiff, gauss };
export const _isa = isa; // re-export for the physics module
