// The weather you set: surface conditions at Arlanda and Kastrup, cloud layers, winds aloft,
// clear-air turbulence and thunderstorms. From it come the METARs the pilots and ATC read, the
// runway in use, the fields the atmosphere turns into physics (see atmosphere.js) and the
// numbers the renderer draws. Everything can be changed during the flight.
//
// Physical rules used here:
//  * cumulus base from the temperature/dew point spread (lifting condensation level, about
//    125 m per degree C), fog when the spread closes and the visibility drops below 1000 m;
//  * thunderstorm cells with a life cycle (towering cumulus, mature, dissipating) of 30-70 min,
//    updrafts of 10-25 m/s, downdrafts and microbursts (under 4 km across, 5-15 minutes) that
//    form as a cell collapses, lightning at a rate that follows the updraft, drifting with the
//    mid-level wind (FAA-H-8083-28 ch. 22, AC 00-24C);
//  * METAR format as in ICAO Annex 3 (wind, visibility, RVR, weather, cloud, T/Td, QNH).
import { DEG, KT, FT, clamp, lerp, smoothstep, project, rng } from './core.js';

export const STATIONS = {
  ARN: { icao: 'ESSA', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, elevFt: 137 },
  CPH: { icao: 'EKCH', name: 'Copenhagen Kastrup', lat: 55.6180, lon: 12.6560, elevFt: 17 },
};
for (const s of Object.values(STATIONS)) { const p = project(s.lat, s.lon); s.x = p.x; s.z = p.z; }

export const COVER = { SKC: 0, FEW: 0.18, SCT: 0.4, BKN: 0.7, OVC: 0.97 };
export const PRECIP = ['none', 'light', 'moderate', 'heavy'];
export const CAT_LEVELS = ['none', 'light', 'moderate', 'severe'];
export const STORM_LEVELS = ['none', 'isolated', 'scattered', 'numerous', 'line'];
export const STORM_WHERE = ['anywhere', 'route', 'ARN', 'CPH'];

const surf = (o) => ({ wdir: 220, wspd: 10, gust: 0, vis: 30000, temp: 14, dew: 6, qnh: 1015, precip: 0, ...o });

// Quick starting points; every value can then be edited.
export const PRESETS = {
  clear: { label: 'Clear skies', arn: surf({ wdir: 210, wspd: 8, vis: 60000, temp: 16, dew: 4, qnh: 1022 }), cph: surf({ wdir: 200, wspd: 9, vis: 60000, temp: 17, dew: 6, qnh: 1021 }), clouds: [], cirrus: 0.35, jetDir: 260, jetKt: 50, cat: 0, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  fair: { label: 'Fair-weather cumulus', arn: surf({ wdir: 220, wspd: 12, vis: 45000, temp: 14, dew: 5, qnh: 1016 }), cph: surf({ wdir: 230, wspd: 13, vis: 45000, temp: 15, dew: 7, qnh: 1015 }), clouds: [{ cover: 'SCT', base: 3800, top: 6800, type: 'CU' }], cirrus: 0.2, jetDir: 255, jetKt: 55, cat: 0, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  broken: { label: 'Broken clouds, breezy', arn: surf({ wdir: 230, wspd: 16, gust: 26, vis: 30000, temp: 12, dew: 5, qnh: 1009 }), cph: surf({ wdir: 240, wspd: 18, gust: 28, vis: 30000, temp: 13, dew: 6, qnh: 1008 }), clouds: [{ cover: 'BKN', base: 3000, top: 6600, type: 'CU' }], cirrus: 0.45, jetDir: 260, jetKt: 80, cat: 1, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  rain: { label: 'Overcast with rain', arn: surf({ wdir: 200, wspd: 14, gust: 22, vis: 7000, temp: 10, dew: 8, qnh: 1003, precip: 1 }), cph: surf({ wdir: 190, wspd: 16, gust: 25, vis: 5000, temp: 11, dew: 9, qnh: 1001, precip: 2 }), clouds: [{ cover: 'BKN', base: 1400, top: 3000, type: 'ST' }, { cover: 'OVC', base: 3000, top: 7500, type: 'ST' }], cirrus: 0, jetDir: 240, jetKt: 70, cat: 1, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  fog: { label: 'Morning fog at Arlanda', arn: surf({ wdir: 0, wspd: 0, vis: 300, temp: 8, dew: 8, qnh: 1026 }), cph: surf({ wdir: 150, wspd: 5, vis: 20000, temp: 13, dew: 7, qnh: 1024 }), clouds: [{ cover: 'FEW', base: 4300, top: 6200, type: 'CU' }], cirrus: 0.2, jetDir: 270, jetKt: 45, cat: 0, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  lowvis: { label: 'Dense fog at Kastrup (CAT III)', arn: surf({ wdir: 190, wspd: 6, vis: 12000, temp: 11, dew: 8, qnh: 1027 }), cph: surf({ wdir: 60, wspd: 4, vis: 150, temp: 9, dew: 9, qnh: 1028 }), clouds: [], cirrus: 0.1, jetDir: 270, jetKt: 40, cat: 0, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  storms: { label: 'Thunderstorms', arn: surf({ wdir: 190, wspd: 10, gust: 20, vis: 20000, temp: 24, dew: 15, qnh: 1008 }), cph: surf({ wdir: 210, wspd: 14, gust: 30, vis: 6000, temp: 25, dew: 17, qnh: 1006, precip: 2 }), clouds: [{ cover: 'SCT', base: 3500, top: 9000, type: 'CU' }], cirrus: 0.5, jetDir: 235, jetKt: 70, cat: 1, storms: 2, stormWhere: 'route', stormTopFt: 38000 },
  gale: { label: 'Strong westerly gale', arn: surf({ wdir: 250, wspd: 24, gust: 38, vis: 25000, temp: 11, dew: 4, qnh: 991 }), cph: surf({ wdir: 270, wspd: 30, gust: 46, vis: 15000, temp: 12, dew: 5, qnh: 988, precip: 1 }), clouds: [{ cover: 'BKN', base: 2400, top: 6000, type: 'CU' }], cirrus: 0.3, jetDir: 265, jetKt: 140, cat: 2, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000 },
  northerly: { label: 'Cold northerly (runways 01 and 04)', arn: surf({ wdir: 10, wspd: 14, gust: 22, vis: 40000, temp: 6, dew: -3, qnh: 1030 }), cph: surf({ wdir: 30, wspd: 16, gust: 24, vis: 35000, temp: 8, dew: -1, qnh: 1029 }), clouds: [{ cover: 'SCT', base: 2800, top: 5000, type: 'CU' }], cirrus: 0.1, jetDir: 330, jetKt: 70, cat: 1, storms: 0, stormWhere: 'anywhere', stormTopFt: 30000 },
};
const ORDER = ['clear', 'fair', 'broken', 'rain', 'fog', 'lowvis', 'storms', 'gale', 'northerly'];
export const PRESET_LIST = ORDER.map((k) => ({ id: k, label: PRESETS[k].label }));

export function presetWeather(id) { return JSON.parse(JSON.stringify(PRESETS[id] || PRESETS.fair)); }

// ---------------- helpers ----------------
const f3 = (n) => String(Math.max(0, Math.round(n))).padStart(3, '0');
const tt = (c) => (c < 0 ? 'M' : '') + String(Math.round(Math.abs(c))).padStart(2, '0');

// Wind components on a runway heading (deg): head (+ from ahead) and cross (+ from the right).
export function windComponents(wdir, wspd, rwyHdg) {
  const d = (wdir - rwyHdg) * DEG;
  return { head: wspd * Math.cos(d), cross: wspd * Math.sin(d) };
}

// ---------------- the weather state ----------------
export class Weather {
  constructor(state, opts = {}) {
    this.seed = opts.seed ?? 1415;
    this.set(state || presetWeather('fair'), true);
    this.flashes = [];      // lightning flashes this frame (for the renderer and audio)
    this.version = 0;
  }

  // Replace the settings (from the editor). Storms are regenerated only when their settings change.
  set(state, first = false) {
    const prev = this.s;
    this.s = JSON.parse(JSON.stringify(state));
    for (const k of ['arn', 'cph']) this.s[k] = surf(this.s[k]);
    this.s.clouds = (this.s.clouds || []).filter((c) => c && c.cover && c.cover !== 'SKC').sort((a, b) => a.base - b.base).slice(0, 3);
    if (first || !prev || prev.storms !== this.s.storms || prev.stormWhere !== this.s.stormWhere || prev.stormTopFt !== this.s.stormTopFt) this._makeStorms();
    else for (const c of this.cells) c.topMax = this.s.stormTopFt * FT * (0.85 + 0.15 * c.k);
    this.version = (this.version || 0) + 1;
  }

  // ---------- surface conditions at any point: blended between the two airports ----------
  // Along the line ARN -> CPH the conditions change smoothly; beyond each airport they are that airport's.
  fraction(x, z) {
    const A = STATIONS.ARN, C = STATIONS.CPH;
    const dx = C.x - A.x, dz = C.z - A.z, L2 = dx * dx + dz * dz;
    const t = ((x - A.x) * dx + (z - A.z) * dz) / L2;
    return smoothstep(0.12, 0.88, t);
  }
  surfaceAt(x, z, out = {}) {
    const k = this.fraction(x, z), a = this.s.arn, c = this.s.cph;
    // wind as a vector so that opposite directions blend through calm, not through a rotation
    const ax = Math.sin(a.wdir * DEG) * a.wspd, az = Math.cos(a.wdir * DEG) * a.wspd;
    const cx = Math.sin(c.wdir * DEG) * c.wspd, cz = Math.cos(c.wdir * DEG) * c.wspd;
    const wx = lerp(ax, cx, k), wz = lerp(az, cz, k);
    out.wspd = Math.hypot(wx, wz); out.wdir = out.wspd > 0.1 ? (Math.atan2(wx, wz) / DEG + 360) % 360 : lerp(a.wdir, c.wdir, k);
    out.gust = lerp(Math.max(a.gust, a.wspd), Math.max(c.gust, c.wspd), k);
    out.vis = Math.exp(lerp(Math.log(Math.max(50, a.vis)), Math.log(Math.max(50, c.vis)), k));
    out.temp = lerp(a.temp, c.temp, k); out.dew = lerp(a.dew, c.dew, k); out.qnh = lerp(a.qnh, c.qnh, k);
    out.precip = lerp(a.precip, c.precip, k);
    out.k = k;
    // en route (far from both airports) the low visibility of an airport's fog does not apply
    const mid = Math.min(k, 1 - k);
    if (mid > 0.1) out.vis = Math.max(out.vis, lerp(out.vis, 40000 - 8000 * out.precip, smoothstep(0.1, 0.25, mid)));
    return out;
  }
  station(id) { return this.s[id === 'ARN' ? 'arn' : 'cph']; }

  // Lifting condensation level (m above ground): the base of convective cloud from the spread.
  lcl(temp, dew) { return clamp(125 * (temp - dew), 60, 4000); }
  // Is there fog here? (visibility under 1000 m with a spread under about 1 degree)
  fogAt(sfc) { return sfc.vis < 1000 && sfc.temp - sfc.dew < 1.5; }
  freezingLevel(sfc) { return Math.max(0, sfc.temp / 0.0065); } // m above ground at the standard lapse rate

  // Cloud layers in metres. Cumulus bases follow the dew point spread when the user leaves them "auto".
  layersAt(x, z) {
    const sfc = this.surfaceAt(x, z, this._s1 || (this._s1 = {}));
    return this.s.clouds.map((c) => ({ ...c, baseM: c.base * FT, topM: Math.max(c.top, c.base + 500) * FT, cov: COVER[c.cover] ?? 0 }));
  }
  ceilingFt(id) {
    const st = this.station(id);
    if (this.fogAt(st)) return Math.max(50, Math.round(st.vis / 10 / FT / 100) * 100 || 100);
    const b = this.s.clouds.find((c) => c.cover === 'BKN' || c.cover === 'OVC');
    return b ? b.base : 99999;
  }

  // ---------- thunderstorm cells ----------
  _makeStorms() {
    const r = rng(this.seed * 7 + 11);
    this.cells = []; this._r = r;
    const lvl = this.s.storms | 0;
    if (!lvl) return;
    const A = STATIONS.ARN, C = STATIONS.CPH;
    const along = (t, off) => { const dx = C.x - A.x, dz = C.z - A.z, L = Math.hypot(dx, dz); return { x: A.x + dx * t - dz / L * off, z: A.z + dz * t + dx / L * off }; };
    const where = this.s.stormWhere || 'anywhere';
    const n = [0, 3, 8, 16, 12][lvl];
    for (let i = 0; i < n; i++) {
      let p;
      if (lvl === 4) { // a squall line crossing the route
        const t0 = 0.35 + r() * 0.3; const k = (i / (n - 1) - 0.5) * 2;
        const q = along(t0 + k * 0.08, k * 95000); p = { x: q.x + (r() - 0.5) * 9000, z: q.z + (r() - 0.5) * 9000 };
      } else if (where === 'ARN' || where === 'CPH') {
        const S = STATIONS[where]; const near = i < Math.ceil(n / 2);
        const a = r() * Math.PI * 2, d = near ? 6000 + r() * 22000 : 25000 + r() * 80000;
        p = { x: S.x + Math.cos(a) * d, z: S.z + Math.sin(a) * d };
      } else if (where === 'route') {
        p = along(0.08 + r() * 0.84, (r() - 0.5) * 2 * (i % 2 ? 60000 : 18000));
      } else p = along(-0.05 + r() * 1.1, (r() - 0.5) * 2 * 140000);
      this.cells.push(this._cell(p.x, p.z, r, lvl === 4 ? r() * 900 : -r() * 2400 + r() * 1800));
    }
    // cells over an airport are timed to be alive when we are there
    if (where === 'CPH') for (const c of this.cells.slice(0, 2)) c.t0 = 2400 + r() * 900 - c.life * 0.35;
  }
  _cell(x, z, r, t0) {
    const k = r();
    const life = 1800 + r() * 2400;                      // 30-70 min
    return {
      x, z, t0, life, k,
      R: 1600 + 2200 * k,                                 // updraft core radius (m)
      topMax: this.s.stormTopFt * FT * (0.85 + 0.15 * k), // cloud top at maturity
      wUp: 10 + 15 * k,                                   // peak updraft (m/s)
      wDn: 6 + 9 * r(),                                   // peak downdraft (m/s)
      flashRate: 2 + 14 * k,                              // flashes per minute at maturity
      micro: r() < 0.45,                                  // collapses into a microburst?
      nextFlash: 0, mb: null,
    };
  }
  // Life-cycle stage: 0 = young towering cumulus, 1 = mature, then dissipating (returns 0..1 strength)
  stage(c, t) {
    const a = (t - c.t0) / c.life;
    if (a < 0 || a > 1) return { a, up: 0, down: 0, rain: 0, top: 0, dissip: 0, alive: false };
    const grow = smoothstep(0, 0.3, a), decay = 1 - smoothstep(0.62, 1.0, a);
    return {
      a, alive: true,
      up: grow * (1 - smoothstep(0.5, 0.8, a)),                    // the updraft dies as the storm matures
      down: smoothstep(0.25, 0.45, a) * decay,                      // precipitation-loaded downdraft
      rain: smoothstep(0.25, 0.4, a) * decay,
      top: lerp(0.35, 1, grow) * lerp(1, 0.8, smoothstep(0.7, 1, a)),
      dissip: smoothstep(0.55, 0.7, a) * decay,
    };
  }
  // Advance storms: drift with the steering wind, rebirth, lightning, microbursts.
  update(dt, t, steer) {
    if (this.flashes.length > 64) this.flashes.splice(0, this.flashes.length - 64);
    const r = this._r || (this._r = rng(this.seed));
    for (const c of this.cells) {
      c.x += (steer?.x ?? 0) * dt; c.z += (steer?.z ?? 0) * dt;
      const st = this.stage(c, t);
      if (st.a > 1) { // a new cell forms nearby (storms regenerate on the gust front)
        const a = r() * Math.PI * 2; const nc = this._cell(c.x + Math.cos(a) * 15000, c.z + Math.sin(a) * 15000, r, t);
        Object.assign(c, nc); continue;
      }
      if (!st.alive) continue;
      // lightning: a Poisson process whose rate follows the updraft and the ice aloft
      const rate = c.flashRate / 60 * Math.max(st.up, st.down * 0.6);
      c.nextFlash -= dt * rate;
      while (c.nextFlash <= 0) {
        c.nextFlash += -Math.log(Math.max(1e-6, r()));
        const cg = r() < 0.22; // cloud-to-ground
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.R * (cg ? 0.8 : 1.6);
        const top = c.topMax * st.top;
        this.flashes.push({ t, x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, y: cg ? top * 0.3 : lerp(top * 0.45, top * 0.85, r()), cg, i: 0.6 + r() * 0.8, cell: c });
      }
      // a collapsing cell may drop a microburst
      if (c.micro && !c.mb && st.dissip > 0.3) c.mb = { t0: t, x: c.x + (r() - 0.5) * c.R, z: c.z + (r() - 0.5) * c.R, R: 700 + 700 * r(), u: 12 + 10 * r(), w: 12 + 12 * r(), life: 300 + 600 * r() };
      if (c.mb && t - c.mb.t0 > c.mb.life) { c.mb.done = true; }
    }
  }

  // Radar reflectivity (dBZ) of the storms at a point, as the weather radar would see it.
  reflectivity(x, h, z, t) {
    let best = 0;
    for (const c of this.cells) {
      const st = this.stage(c, t); if (!st.alive) continue;
      const d = Math.hypot(x - c.x, z - c.z); if (d > c.R * 4) continue;
      const top = c.topMax * st.top; if (h > top) continue;
      const core = Math.exp(-((d / (c.R * 1.3)) ** 2)) * (0.35 + 0.65 * st.rain);
      best = Math.max(best, 15 + 45 * core * (0.6 + 0.4 * c.k));
    }
    return best;
  }

  // ---------- METAR ----------
  metar(id, dayHourUTC = 4.3, rwy = null) {
    const st = this.station(id), S = STATIONS[id];
    const hh = String(Math.floor(dayHourUTC)).padStart(2, '0'), mm = Math.floor((dayHourUTC % 1) * 60) >= 50 ? '50' : '20';
    const parts = [S.icao, `10${hh}${mm}Z`];
    const w = Math.round(st.wspd), g = Math.round(st.gust);
    parts.push(w < 1 ? '00000KT' : `${f3(Math.round(st.wdir / 10) * 10 || 360)}${String(w).padStart(2, '0')}${g >= w + 10 ? 'G' + String(g).padStart(2, '0') : ''}KT`);
    const ts = this.stormNear(id, 0);
    const fog = this.fogAt(st);
    const cav = st.vis >= 10000 && !this.s.clouds.some((c) => c.base < 5000 || c.type === 'CB') && !st.precip && !ts && !fog;
    if (cav) parts.push('CAVOK');
    else {
      parts.push(st.vis >= 10000 ? '9999' : String(Math.round(st.vis / (st.vis < 800 ? 50 : st.vis < 5000 ? 100 : 1000)) * (st.vis < 800 ? 50 : st.vis < 5000 ? 100 : 1000)).padStart(4, '0'));
      if (st.vis < 1500) { const rw = rwy || (id === 'CPH' ? '22L' : '19R'); parts.push(`R${rw}/${String(Math.round(Math.min(2000, st.vis * 1.4) / 25) * 25).padStart(4, '0')}`); }
      const wx = [];
      const intens = ['', '-', '', '+'][Math.round(st.precip)];
      if (ts) wx.push(`${st.precip >= 2.5 ? '+' : ''}TS${st.precip ? 'RA' : ''}`);
      else if (st.precip >= 0.5) wx.push(`${intens}RA`);
      if (fog) wx.push('FG'); else if (st.vis < 5000 && st.temp - st.dew < 3 && !st.precip) wx.push('BR');
      if (!ts && this.stormNear(id, 1)) wx.push('VCTS');
      parts.push(...wx);
      if (fog) parts.push('VV' + f3(Math.max(1, st.vis / 10 / FT / 100)));
      else {
        const cl = this.s.clouds.map((c) => `${c.cover}${f3(c.base / 100)}`);
        if (ts) cl.push(`BKN${f3(this.lcl(st.temp, st.dew) / FT / 100)}CB`);
        parts.push(...(cl.length ? cl : ['NSC']));
      }
    }
    parts.push(`${tt(st.temp)}/${tt(st.dew)}`, `Q${Math.round(st.qnh)}`, 'NOSIG');
    return parts.join(' ');
  }
  // Is a thunderstorm at (range 0) or near (range 1: within 16 km) the airport?
  stormNear(id, range = 0, t = this.lastT || 0) {
    const S = STATIONS[id];
    for (const c of this.cells) {
      const st = this.stage(c, t); if (!st.alive || st.a < 0.2) continue;
      const d = Math.hypot(c.x - S.x, c.z - S.z);
      if (range === 0 && d < 8000) return true;
      if (range === 1 && d < 16000) return true;
    }
    return false;
  }

  // ---------- what the renderer needs (compatible with the old presets) ----------
  visualAt(x, z, t = 0) {
    const sfc = this.surfaceAt(x, z, this._s2 || (this._s2 = {}));
    const L = this.layersAt(x, z);
    const cu = L.filter((c) => c.type === 'CU' || c.type === 'SC'), st = L.filter((c) => c.type === 'ST' && c.cov >= 0.6);
    const lcl = this.lcl(sfc.temp, sfc.dew);
    const cuBase = cu.length ? cu[0].baseM : lcl, cuTop = cu.length ? Math.max(...cu.map((c) => c.topM)) : lcl + 900;
    const cov = cu.reduce((m, c) => Math.max(m, c.cov), 0);
    const deck = st.length ? { base: st[0].baseM, top: Math.max(...st.map((c) => c.topM)) } : null;
    const fogA = this.fogAt(this.s.arn), fogC = this.fogAt(this.s.cph);
    return {
      label: this.s.label || 'Custom', cumulus: clamp(cov, 0, 0.95), cuBase, cuTop, stratus: deck, cirrus: this.s.cirrus ?? 0.2,
      vis: sfc.vis, turb: 0.2 + 0.25 * (this.s.cat || 0), rain: clamp(sfc.precip / 2, 0, 1.2), wind: `${Math.round(sfc.wdir)}° / ${Math.round(sfc.wspd)} kt`,
      temp: [this.s.arn.temp, this.s.cph.temp], metar: '',
      fog: fogA || fogC ? (() => { const apt = fogA && (!fogC || sfc.k < 0.5) ? 'ARN' : 'CPH'; const v = this.station(apt).vis; return { top: 40 + 120 * (1 - clamp(v / 1000, 0, 1)), airport: apt, vis: v }; })() : null,
      storms: this.cells, stormT: t, stage: this._stageFn || (this._stageFn = (c, tt) => this.stage(c, tt)),
      // the anvil streams downwind with the winds near the top of the storm
      anvilDir: { x: -Math.sin((this.s.jetDir ?? 255) * DEG), z: Math.cos((this.s.jetDir ?? 255) * DEG) },
    };
  }
}

// Build a Weather from one of the old single-preset objects ({ wind: '220° / 12 kt', cumulus, ... }).
export function weatherFromLegacy(W = {}) {
  const m = /(\d+)°\s*\/\s*(\d+)/.exec(W.wind || '');
  const wdir = m ? +m[1] : 0, wspd = m ? +m[2] : 0;
  const t = W.temp || [14, 15];
  const s = {
    label: W.label || 'Custom',
    arn: { wdir, wspd, gust: 0, vis: W.vis ?? 40000, temp: t[0], dew: t[0] - 7, qnh: 1015, precip: (W.rain || 0) * 2 },
    cph: { wdir, wspd, gust: 0, vis: W.vis ?? 40000, temp: t[1] ?? t[0], dew: (t[1] ?? t[0]) - 7, qnh: 1014, precip: (W.rain || 0) * 2 },
    clouds: [], cirrus: W.cirrus ?? 0.2, jetDir: 255, jetKt: 55, cat: (W.turb ?? 0.3) > 0.5 ? 1 : 0, storms: 0, stormWhere: 'anywhere', stormTopFt: 36000,
  };
  if (W.cumulus > 0) s.clouds.push({ cover: W.cumulus > 0.55 ? 'BKN' : W.cumulus > 0.25 ? 'SCT' : 'FEW', base: Math.round(W.cuBase / FT / 100) * 100, top: Math.round(W.cuTop / FT / 100) * 100, type: 'CU' });
  if (W.stratus) s.clouds.push({ cover: 'OVC', base: Math.round(W.stratus.base / FT / 100) * 100, top: Math.round(W.stratus.top / FT / 100) * 100, type: 'ST' });
  if (W.fog) { const k = W.fog.airport === 'CPH' ? 'cph' : 'arn'; s[k].vis = 300; s[k].dew = s[k].temp; }
  if (W.turb === 0) s.calm = true;
  return new Weather(s);
}
