// The air the aircraft flies through, computed from the weather you set (weather.js).
//
//  * Pressure and temperature: the surface temperature and QNH at the nearest airport, a 6.5 K/km
//    lapse rate to an 11 km tropopause, hydrostatic pressure. The altimeter reads pressure, so a
//    flight level is lower in true height on a cold day and higher on a warm one, as in reality.
//  * Mean wind: a logarithmic surface layer over the local roughness (forest, open land, sea),
//    an Ekman layer up to about 1 km in which the wind strengthens and veers (more over land than
//    over sea), then a thermal-wind increase towards the jet stream near the tropopause.
//  * Turbulence: Dryden spectra (MIL-F-8785C / MIL-HDBK-1797) with the low-altitude scale lengths
//    and intensities (sigma_w = 0.1 W20), gusts from the reported gust factor (peak = mean + 3 sigma_u),
//    convective turbulence under cumulus on sunny days, and patches of clear-air turbulence near
//    the jet whose strength matches the ICAO categories (light, moderate 0.5-1.0 g, severe > 1 g).
//  * Thunderstorms: each cell's updraft, downdraft, gust-front outflow and microburst, severe
//    turbulence and rain inside it, hail under the anvil, and lightning that can strike the
//    aircraft near the freezing level.
import { DEG, KT, FT, G, clamp, lerp, smoothstep, rng } from './core.js';
import { Weather, weatherFromLegacy, STATIONS } from './weather.js';

// Parse the old '230° / 16 kt' strings into a direction (from, radians) and speed (m/s).
export function parseWind(str) {
  const m = /(\d+)°\s*\/\s*(\d+)/.exec(str || '');
  if (!m) return { from: 0, speed: 0 };
  return { from: +m[1] * DEG, speed: +m[2] * KT };
}

// Gaussian white noise (Box-Muller) from a seeded uniform generator.
function gauss(r) { const u = Math.max(1e-9, r()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }

// MIL-HDBK-1797 medium/high altitude turbulence intensity sigma (ft/s) against altitude (ft) for
// probabilities of exceedance 1e-1 (background), 1e-2, 1e-3, 1e-5.
const HI_ALT = [500, 1750, 3750, 7500, 15000, 25000, 35000, 45000, 55000];
const HI_SIG = {
  bg: [4.2, 3.6, 3.3, 1.6, 0, 0, 0, 0, 0],
  p2: [6.6, 6.9, 7.4, 6.7, 4.6, 2.7, 0.4, 0, 0],
  p3: [8.6, 9.6, 10.6, 10.1, 8.0, 6.6, 5.0, 4.2, 2.7],
  p5: [15.6, 17.6, 23.0, 23.6, 22.1, 20.0, 16.0, 15.1, 12.1],
};
function hiSigma(row, hft) {
  const a = HI_ALT, v = HI_SIG[row];
  if (hft <= a[0]) return v[0] * FT;
  for (let i = 1; i < a.length; i++) if (hft < a[i]) return lerp(v[i - 1], v[i], (hft - a[i - 1]) / (a[i] - a[i - 1])) * FT;
  return v[v.length - 1] * FT;
}
// Clear-air turbulence patch intensity (sigma_w, m/s) per category, calibrated so that the A320
// model feels the ICAO g-changes: light < 0.5 g, moderate 0.5-1.0 g, severe > 1.0 g.
const CAT_SIGMA = [0, 1.6, 4.4, 6.2];

const B_SPAN = 34.1;

export class Atmosphere {
  constructor(weather = {}, opts = {}) {
    this.wx = weather instanceof Weather ? weather : weatherFromLegacy(weather);
    this.r = rng(opts.seed ?? 1415);
    this.boost = 1;           // scaled by events
    this.sunHeat = 0.5;       // 0 at night, 1 on a sunny afternoon (set each frame)
    this.t = 0;
    // Dryden filter states
    this.ug = 0; this.vg1 = 0; this.vg2 = 0; this.wg1 = 0; this.wg2 = 0; this.vg = 0; this.wg = 0; this.pg = 0; this.qg = 0; this.rg = 0;
    this._wf = 0; this._vf = 0;
    this.sigma = 0;           // current vertical gust intensity (m/s)
    this.hazards = [];        // discrete hazards (manual CAT, microbursts, wake, thermals)
    this.out = { wx: 0, wy: 0, wz: 0, pg: 0, qg: 0, rg: 0 };
    this.sfc = {}; this._sfcT = -99; this._pos = { x: 0, z: 0 };
    this.rain = 0; this.inCloud = false; this.visM = 30000; this.oat = 15; this.strike = null; this.hail = 0;
    this._catPatches = null;
    this._cellT = 0; this._cellCloud = 0;
  }
  get W() { return this.wxHere(); }
  // renderer-style weather summary here (cached with the surface conditions)
  wxHere() {
    if (!this._vis || Math.abs(this.t - this._visT) > 0.5 || this._visV !== this.wx.version) { this._vis = this.wx.visualAt(this._pos.x, this._pos.z, this.t); this._visT = this.t; this._visV = this.wx.version; }
    return this._vis;
  }

  // Weather changed in the editor: rebuild what depends on it.
  refresh() { this._catPatches = null; this._sfcT = -99; }

  // ---------- surface conditions under the aircraft (cached; they change slowly) ----------
  surface(x = this._pos.x, z = this._pos.z) {
    if (Math.abs(this.t - this._sfcT) > 0.5 || Math.hypot(x - this._sfcX, z - this._sfcZ) > 3000) {
      this.wx.surfaceAt(x, z, this.sfc); this._sfcT = this.t; this._sfcX = x; this._sfcZ = z;
      const k = this.sfc.k;
      // roughness: forest around Arlanda, farmland across Sweden, the sea and a flat airfield at Kastrup
      this.sfc.z0 = k < 0.08 ? 0.5 : k > 0.93 ? 0.03 : 0.25;
      this.sfc.overSea = k > 0.9;
      this.sfc.elev = lerp(STATIONS.ARN.elevFt, STATIONS.CPH.elevFt, k) * FT;
    }
    return this.sfc;
  }

  // ---------- temperature, pressure, density ----------
  // h: height above the ground (m). Returns T (K), p (Pa), rho, a, sigma (rho/1.225), and the
  // pressure altitude (m) that a standard altimeter at 1013.25 hPa would show.
  air(h, out = this._air || (this._air = {})) {
    const s = this.surface();
    const z = Math.max(0, h) + s.elev;                 // height above mean sea level
    const T0 = s.temp + 273.15 + 0.0065 * s.elev;       // sea-level temperature
    const P0 = s.qnh * 100;
    const zt = 11000 + (T0 - 288.15) * 60;              // warmer air: higher tropopause
    const Tt = T0 - 0.0065 * zt;
    let T, p;
    if (z < zt) { T = T0 - 0.0065 * z; p = P0 * Math.pow(T / T0, 5.25588); }
    else { T = Tt; p = P0 * Math.pow(Tt / T0, 5.25588) * Math.exp(-G * (z - zt) / (287.05 * Tt)); }
    out.T = T; out.p = p; out.rho = p / (287.05 * T); out.a = Math.sqrt(1.4 * 287.05 * T); out.sigma = out.rho / 1.225;
    out.hp = pressureAltitude(p); out.isaDev = T - isaT(out.hp);
    return out;
  }
  // What an altimeter set to `baro` hPa reads (m) at height h.
  indicatedAlt(h, baroHpa) {
    const p = this.air(h, this._ia || (this._ia = {})).p;
    if (!baroHpa || Math.abs(baroHpa - 1013.25) < 0.01) return pressureAltitude(p);
    return 44330.8 * (1 - Math.pow(p / (baroHpa * 100), 0.190263));
  }
  // Height above ground (m) at which an altimeter set to `baro` reads `alt` (m): inverse of the above.
  heightForIndicated(alt, baroHpa) {
    const s = this.surface();
    const pT = baroHpa && Math.abs(baroHpa - 1013.25) > 0.01 ? baroHpa * 100 * Math.pow(1 - alt / 44330.8, 5.25588) : isaP(alt);
    const T0 = s.temp + 273.15 + 0.0065 * s.elev, P0 = s.qnh * 100;
    const zt = 11000 + (T0 - 288.15) * 60, Tt = T0 - 0.0065 * zt, pt = P0 * Math.pow(Tt / T0, 5.25588);
    let z;
    if (pT > pt) z = (T0 / 0.0065) * (1 - Math.pow(pT / P0, 1 / 5.25588));
    else z = zt + Math.log(pt / pT) * 287.05 * Tt / G;
    return z - s.elev;
  }

  // ---------- mean wind (m/s, world frame, direction the air moves towards) ----------
  meanWind(h, out = {}, x = this._pos.x, z = this._pos.z) {
    const s = this.surface(x, z);
    const U10 = s.wspd * KT, z0 = s.z0;
    const zs = 80, ze = 1000;
    const hz = Math.max(h, z0 * 2);
    const logK = (zz) => Math.log(Math.max(zz, z0 * 2) / z0) / Math.log(10 / z0);
    const land = !s.overSea;
    const gRatio = land ? 1.75 : 1.35, veer = (land ? 24 : 11) * DEG;
    let speed, from;
    const sfcFrom = s.wdir * DEG;
    if (h <= zs) { speed = U10 * logK(hz); from = sfcFrom + veer * 0.1 * (h / zs); }
    else if (h <= ze) {
      const k = smoothstep(zs, ze, h);
      speed = lerp(U10 * logK(zs), U10 * gRatio, k); from = sfcFrom + veer * lerp(0.1, 1, k);
    } else {
      const jetH = 10500, k = smoothstep(ze, jetH, h);
      const jFrom = (this.wx.s.jetDir ?? 255) * DEG, jet = (this.wx.s.jetKt ?? 55) * KT;
      const gFrom = sfcFrom + veer;
      speed = lerp(U10 * gRatio, jet, k); from = gFrom + angleDiff(jFrom, gFrom) * k;
      if (h > jetH) speed *= 1 - 0.3 * smoothstep(jetH, jetH + 3000, h);
    }
    const to = from + Math.PI;
    out.x = Math.sin(to) * speed; out.z = -Math.cos(to) * speed; out.speed = speed; out.from = from;
    return out;
  }

  // Vertical gust intensity sigma_w (m/s) from the weather here (without discrete hazards).
  intensity(h, inCloud) {
    const s = this.surface();
    const hft = Math.max(10, h / FT);
    const W20 = this.meanWind(6, this._mw6 || (this._mw6 = {})).speed;
    // low altitude: MIL-F-8785C sigma_w = 0.1 W20 below 1000 ft, blending to the medium-altitude
    // background between 1000 and 2000 ft
    const low = 0.1 * W20, hi = hiSigma('bg', hft) * 0.35 + 0.08;
    let sw = hft < 1000 ? low : hft < 2000 ? lerp(low, hi, (hft - 1000) / 1000) : hi;
    if (this.wx.s.calm) sw *= 0.2;
    // convection: thermals under fair-weather cumulus on a sunny day, up to the cloud tops
    const V = this.wxHere();
    const convTop = V.cumulus > 0 ? V.cuTop : 1400;
    sw += (0.3 + 1.1 * V.cumulus) * this.sunHeat * (1 - smoothstep(convTop * 0.85, convTop * 1.15, h)) * smoothstep(40, 300, h) * (s.temp > 8 ? 1 : 0.4);
    if (inCloud) sw += V.cumulus > 0 && h < V.cuTop + 200 ? 1.1 + 1.3 * V.cumulus : 0.6;
    // a little chop in the jet-stream shear near cruise levels, stronger with a strong jet
    sw += 0.15 * smoothstep(8000, 10500, h) * clamp(((this.wx.s.jetKt ?? 55) - 40) / 80, 0, 1.5);
    return sw * this.boost;
  }

  // Patches of clear-air turbulence along the route near the jet, from the CAT setting.
  _makeCAT() {
    const lvl = this.wx.s.cat | 0, r = rng(this.wx.seed * 13 + lvl);
    const A = STATIONS.ARN, C = STATIONS.CPH;
    const patches = [];
    const add = (cat, n) => { for (let i = 0; i < n; i++) { const t = 0.15 + r() * 0.7; patches.push({ x: lerp(A.x, C.x, t) + (r() - 0.5) * 30000, z: lerp(A.z, C.z, t) + (r() - 0.5) * 30000, R: 15000 + r() * 35000, h0: 7300 + r() * 3000, dh: 700 + r() * 700, sigma: CAT_SIGMA[cat] * (0.85 + 0.3 * r()), cat, jolt: cat === 3, jolted: false }); } };
    if (lvl >= 1) add(1, 4);
    if (lvl >= 2) add(2, 2);
    if (lvl >= 3) add(3, 1);
    this._catPatches = patches;
  }
  catAt(x, h, z) {
    if (!this._catPatches) this._makeCAT();
    let s = 0, pj = null;
    for (const p of this._catPatches) {
      const d = Math.hypot(x - p.x, z - p.z); if (d > p.R) continue;
      const k = (1 - smoothstep(p.R * 0.55, p.R, d)) * Math.exp(-(((h - p.h0) / p.dh) ** 2));
      if (k * p.sigma > s) { s = k * p.sigma; pj = k > 0.7 ? p : pj; }
    }
    return { sigma: s, patch: pj };
  }

  inCloudAt(h) {
    const V = this.wxHere();
    if (V.stratus && h > V.stratus.base && h < V.stratus.top) return true;
    if (!this._layers || this._layersV !== this._visT) { this._layers = this.wx.layersAt(this._pos.x, this._pos.z); this._layersV = this._visT; }
    for (const c of this._layers) if (c.cov >= 0.9 && h > c.baseM && h < c.topM) return true;
    return V.cumulus > 0.05 && h > V.cuBase && h < V.cuTop && this._cellCloud > 0.5;
  }

  // ---------- thunderstorm fields at a point ----------
  storms(x, h, z, out) {
    out.w = 0; out.ux = 0; out.uz = 0; out.sigma = 0; out.rain = 0; out.cloud = false; out.hail = 0; out.cell = null;
    const t = this.t;
    for (const c of this.wx.cells) {
      const st = this.wx.stage(c, t); if (!st.alive) continue;
      const dx = x - c.x, dz = z - c.z, r = Math.hypot(dx, dz) + 1;
      if (r > c.R * 8) continue;
      const base = this.wx.lcl(this.sfc.temp ?? 15, this.sfc.dew ?? 8), top = Math.max(base + 1500, c.topMax * st.top);
      const R = c.R;
      const inCol = r < R * 1.4 && h > base && h < top;
      const anvilR = R * (2 + 3 * st.top) * smoothstep(0.3, 0.6, st.a + 0.2);
      const inAnvil = h > top - 1800 && h < top + 300 && r < anvilR;
      if (inCol || inAnvil) { out.cloud = true; out.cell = c; }
      const zk = clamp((h - base) / (top - base), 0, 1);
      // updraft core: strongest two-thirds of the way up, feeding in from below the base
      const up = c.wUp * st.up * Math.exp(-((r / R) ** 2)) * (h < base ? smoothstep(-200, base, h) * 0.6 : Math.pow(Math.sin(Math.PI * zk), 0.7));
      // precipitation downdraft beside the core, reaching the ground as the storm matures
      const dn = c.wDn * st.down * Math.exp(-(((r - 0.7 * R) / (0.9 * R)) ** 2)) * (h < top * 0.7 ? 1 : 1 - smoothstep(top * 0.7, top, h));
      out.w += up - dn * (h < 300 ? smoothstep(0, 300, h) : 1);
      // gust front: the cold outflow spreading from the downdraft along the ground
      if (h < 900) {
        const ro = R * 1.2, prof = (r / ro) * Math.exp(1 - (r / ro) ** 2) + 0.35 * Math.exp(-(((r - 4 * R) / (2.5 * R)) ** 2));
        const uo = c.wDn * 1.3 * st.down * prof * (1 - smoothstep(250, 900, h)) * smoothstep(0, 30, h + 30);
        out.ux += dx / r * uo; out.uz += dz / r * uo;
      }
      // microburst from a collapsing cell
      if (c.mb && !c.mb.done) {
        const m = c.mb, age = t - m.t0, life = clamp(Math.sin(Math.PI * clamp(age / m.life, 0, 1)) * 1.6, 0, 1);
        const mx = x - m.x, mz = z - m.z, rr = Math.hypot(mx, mz) + 1;
        const k = rr < m.R ? rr / m.R : Math.exp(-(((rr - m.R) / (0.8 * m.R)) ** 2)) * m.R / rr;
        const hk = Math.exp(-h / 900) - Math.exp(-h / 60);
        const o = m.u * k * hk * 2.2 * life;
        out.ux += mx / rr * o; out.uz += mz / rr * o;
        out.w -= m.w * Math.exp(-((rr / (0.9 * m.R)) ** 2)) * (1 - Math.exp(-h / 120)) * life;
      }
      // turbulence: severe inside a mature cell, moderate at its edge and under the anvil
      const turbIn = (2.8 + 4.5 * Math.max(st.up, st.down)) * (inCol ? 1 - smoothstep(R * 0.9, R * 1.4, r) * 0.6 : 0);
      const turbNear = (1.2 + 1.5 * st.up) * Math.exp(-(((r - 1.5 * R) / (2.5 * R)) ** 2)) * (h > base * 0.5 ? 1 : 0.5) + (inAnvil ? 1.4 : 0);
      out.sigma = Math.max(out.sigma, turbIn, turbNear * 0.8);
      // heavy rain in the downdraft core, hail near and under the anvil of the strongest cells
      out.rain = Math.max(out.rain, 60 * st.rain * Math.exp(-(((r - 0.4 * R) / (1.1 * R)) ** 2)) * (h < top ? 1 : 0));
      if (c.k > 0.55 && st.up > 0.4 && (inCol || (inAnvil && r < R * 3))) out.hail = Math.max(out.hail, c.k * st.up);
    }
    return out;
  }

  // Advance turbulence and hazards; returns wind (world, m/s) + gust body rates (rad/s).
  // h: height above ground, V airspeed, pos {x,z}, (fwdX, fwdZ) unit forward vector on the ground.
  step(dt, h, V, pos, fwdX, fwdZ, out = this.out) {
    this.t += dt;
    this._wxT = (this._wxT || 0) + dt;
    if (this._wxT > 0.25) { this.wx.update(this._wxT, this.t, this.steeringWind()); this.wx.lastT = this.t; this._wxT = 0; }
    const r = this.r;
    this._pos.x = pos.x; this._pos.z = pos.z;
    V = Math.max(V, 5);
    const sfc = this.surface(pos.x, pos.z);
    // cumulus cells passing by: a slow random process decides whether we are in a cloud column
    const vis = this.wxHere();
    this._cellT -= dt * V / 1200;
    if (this._cellT <= 0) { this._cellT = 1; this._cellCloud = r() < vis.cumulus ? 1 : 0; }
    const S = this.storms(pos.x, h, pos.z, this._st || (this._st = {}));
    const inCloud = this.inCloudAt(h) || S.cloud;
    this.inCloud = inCloud;
    let sw = this.intensity(h, inCloud);
    const cat = this.catAt(pos.x, h, pos.z);
    sw = Math.hypot(sw, cat.sigma * this.boost, S.sigma * this.boost);
    // scale lengths and horizontal intensities (MIL-F-8785C)
    const hft = Math.max(10, h / FT);
    let Lw, Lu, su, sv;
    if (hft < 1000) { Lw = hft * FT; Lu = hft / Math.pow(0.177 + 0.000823 * hft, 1.2) * FT; const k = 1 / Math.pow(0.177 + 0.000823 * hft, 0.4); su = sw * k; sv = su; }
    else if (hft < 2000) { const k = (hft - 1000) / 1000; Lw = lerp(1000 * FT, 533, k); Lu = lerp(1000 / Math.pow(1, 1.2) * FT, 533, k); su = sv = sw * lerp(1 / Math.pow(1, 0.4), 1, k); }
    else { Lw = Lu = 533; su = sv = sw; }
    // gusty surface wind: the reported gust is about three standard deviations above the mean
    const gustSig = Math.max(0, (sfc.gust - sfc.wspd) * KT / 3) * (1 - smoothstep(300, 1200, h));
    su = Math.max(su, gustSig); sv = Math.max(sv, gustSig * 0.8);
    // discrete hazards add to the continuous field
    let hx = S.ux, hy = S.w, hz = S.uz, hp = 0;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const z = this.hazards[i];
      z.t += dt;
      if (z.kind === 'cat') { // a patch of turbulence we have just flown into (manual events)
        const k = Math.sin(Math.PI * clamp(z.t / z.dur, 0, 1));
        sw += z.sigma * k; su += z.sigma * 0.6 * k; sv += z.sigma * 0.8 * k;
        if (z.jolt && z.t > z.dur * 0.4 && !z.jolted) { z.jolted = true; z.joltV = -z.jolt; z.joltT = 0; }
        // the big one: a downdraft that sets in within about half a second and dies away more slowly;
        // the aircraft is left sinking through the air, so the load factor overshoots above 1 g after it
        if (z.joltV) { const w = z.width, t1 = z.joltT - 1.0; z.joltT += dt; hy += z.joltV * Math.exp(-(t1 * t1) / (t1 < 0 ? w : w * 6)); if (z.joltT > 7) z.joltV = 0; }
      } else if (z.kind === 'microburst') {
        const dx = pos.x - z.x, dz = pos.z - z.z; const rr = Math.hypot(dx, dz) + 1;
        const R = z.R, k = rr < R ? rr / R : Math.exp(-(((rr - R) / (0.8 * R)) ** 2)) * R / rr;
        const hk = Math.exp(-h / 900) - Math.exp(-h / 60);
        const o = z.u * k * hk * 2.2;
        hx += dx / rr * o; hz += dz / rr * o;
        hy += -z.w * Math.exp(-((rr / (0.9 * R)) ** 2)) * (1 - Math.exp(-h / 120));
        if (z.t > z.life) this.hazards.splice(i, 1);
        continue;
      } else if (z.kind === 'wake') {
        const k = Math.exp(-((z.t - z.at) ** 2) / 0.3);
        hp += z.roll * k * Math.sign(Math.sin(z.t * 2.4 + 1)); hy += z.up * Math.sin(z.t * 3.1) * k;
      } else if (z.kind === 'thermal') {
        hy += z.w * Math.sin(Math.PI * clamp(z.t / z.dur, 0, 1));
      }
      if (z.t > (z.dur ?? z.life ?? 10)) this.hazards.splice(i, 1);
    }
    // a severe CAT patch holds a sharp discrete gust near its core
    if (cat.patch && cat.patch.jolt && !cat.patch.jolted && cat.sigma > cat.patch.sigma * 0.8) { cat.patch.jolted = true; this.addCAT(0, 8, 18 + r() * 6, 0.28); }
    // ---- Dryden filters ----
    // u: first order; v and w: (1 + sqrt3 T s)/(1 + T s)^2 driven by white noise, scaled to sigma
    const Tu = Math.max(0.05, Lu / V), Tw = Math.max(0.05, Lw / V), Tv = Tu;
    const au = Math.exp(-dt / Tu);
    this.ug = au * this.ug + su * Math.sqrt(1 - au * au) * gauss(r);
    const n = 1 / Math.sqrt(dt);
    const wPrev = this.wg, vPrev = this.vg;
    { const T = Tw; this.wg2 += dt * (-this.wg1 / (T * T) - 2 * this.wg2 / T + gauss(r) * n); this.wg1 += dt * this.wg2; this.wg = sw * Math.sqrt(T) * (this.wg1 + 1.7320508 * T * this.wg2) / (T * T); }
    { const T = Tv; this.vg2 += dt * (-this.vg1 / (T * T) - 2 * this.vg2 / T + gauss(r) * n); this.vg1 += dt * this.vg2; this.vg = sv * Math.sqrt(T) * (this.vg1 + 1.7320508 * T * this.vg2) / (T * T); }
    // angular gusts: roll from the spanwise gradient, pitch and yaw from the travel of w and v along the fuselage
    const sp = 1.9 * sw / Math.sqrt(Lw * B_SPAN), ap = Math.exp(-V * dt / (Math.PI * B_SPAN));
    this.pg = ap * this.pg + sp * Math.sqrt(1 - ap * ap) * gauss(r);
    const lagQ = Math.exp(-dt * Math.PI * V / (4 * B_SPAN)), lagR = Math.exp(-dt * Math.PI * V / (3 * B_SPAN));
    this._wf = lagQ * this._wf + (1 - lagQ) * (this.wg - wPrev) / (dt * V);
    this._vf = lagR * this._vf + (1 - lagR) * (this.vg - vPrev) / (dt * V);
    this.qg = -this._wf; this.rg = this._vf;
    this.sigma = sw;
    // gusts are given along the aircraft's track: u along the nose, v to the right, w up
    const rx = -fwdZ, rz = fwdX;
    const mw = this.meanWind(h, this._mw || (this._mw = {}), pos.x, pos.z);
    out.wx = mw.x + fwdX * this.ug + rx * this.vg + hx;
    out.wz = mw.z + fwdZ * this.ug + rz * this.vg + hz;
    out.wy = this.wg + hy;
    out.pg = this.pg + hp; out.qg = this.qg; out.rg = this.rg;
    out.inCloud = inCloud;
    // what the pilots and the cabin can see and hear
    const a = this.air(h);
    this.oat = a.T - 273.15;
    this.rain = Math.max(S.rain, h < (vis.stratus?.top ?? vis.cuBase + 500) ? sfc.precip * 6 : 0);
    this.hail = S.hail;
    this.visM = inCloud ? 60 + 200 * (1 - (S.cloud ? 1 : 0.5)) : h < 30 + (vis.fog?.top ?? 0) ? sfc.vis : Math.max(sfc.vis, lerp(sfc.vis, 60000, smoothstep(300, 3000, h))) / (1 + this.rain / 8);
    // lightning strikes on the aircraft: in a storm cloud near the freezing level, climbing or descending
    this.strike = null;
    if (S.cloud && S.cell) {
      const st = this.wx.stage(S.cell, this.t);
      const nearFreezing = Math.exp(-(((this.oat + 2) / 9) ** 2));
      const rate = (1 / 150) * Math.max(st.up, st.down) * nearFreezing * (0.5 + S.cell.k);
      if (r() < rate * dt) this.strike = { x: pos.x, y: h, z: pos.z };
    }
    return out;
  }

  // Mean wind components on a runway heading (radians): head (+ from ahead) and cross (+ from the right).
  runwayWind(hdg, h = 10, x, z) {
    const w = this.meanWind(h, {}, x ?? this._pos.x, z ?? this._pos.z);
    const ax = Math.sin(hdg), az = -Math.cos(hdg);
    return { head: -(w.x * ax + w.z * az), cross: -(w.x * -az + w.z * ax), speed: w.speed };
  }
  // The wind at a mid level that moves the storms along.
  steeringWind() { const w = this.meanWind(3500, this._sw || (this._sw = {})); return { x: w.x * 0.8, z: w.z * 0.8 }; }

  // ---------------- hazards the events system can trigger ----------------
  // jolt: peak downdraft (m/s); width: how sharp its onset is (s^2, smaller = more violent)
  addCAT(sigma = 3.5, dur = 70, jolt = 0, width = 0.35) { this.hazards.push({ kind: 'cat', t: 0, sigma, dur, jolt, width }); }
  addMicroburst(x, z, { R = 900, u = 12, w = 9, life = 600 } = {}) { this.hazards.push({ kind: 'microburst', t: 0, x, z, R, u, w, life }); }
  addWake(roll = 0.35, up = 3, dur = 5) { this.hazards.push({ kind: 'wake', t: 0, at: 1.2, roll, up, dur }); }
  addThermal(w = 2, dur = 6) { this.hazards.push({ kind: 'thermal', t: 0, w, dur }); }
}

// ISA helpers
function isaT(hp) { return hp < 11000 ? 288.15 - 0.0065 * hp : 216.65; }
function isaP(hp) { return hp < 11000 ? 101325 * Math.pow(1 - hp / 44330.8, 5.25588) : 22632 * Math.exp(-(hp - 11000) / 6341.6); }
export function pressureAltitude(p) { return p > 22632 ? 44330.8 * (1 - Math.pow(p / 101325, 0.190263)) : 11000 + 6341.6 * Math.log(22632 / p); }

function angleDiff(a, b) { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; }
export { angleDiff, gauss };
