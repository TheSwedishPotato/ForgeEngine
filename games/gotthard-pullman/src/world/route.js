/**
 * The line: the train's running path from Erstfeld Gleis 1 up the left-hand
 * main line of the Gotthard north ramp to Göschenen Gleis 1, as baked from
 * OpenStreetMap and the Copernicus DEM (tools/geodata/build.py).
 *
 * Everything is indexed by chainage s (metres along the running path).
 * Map coordinates: x east, y north, z height above sea level (m). The
 * renderer's world is three.js-style: X = east, Y = up, Z = -north.
 */
import ROUTE from '../data/route.js';
import { gunzipBase64 } from '../data/decode.js';

export const GAUGE = 1.435;          // standard gauge, m
export const RAIL_SPACING = 1.5;     // centre-to-centre of the rail heads, m (gauge + head width)
const MAX_CANT = 0.150;              // m; Swiss maximum on the old mountain lines (assumed, see README)
const CANT_V_EQ = 55 / 3.6;          // equilibrium speed the cant is laid for (mixed traffic), m/s
const DEFICIENCY = 0.100;            // permitted cant deficiency for this heritage stock, m
const G = 9.80665;

function smooth(arr, radius) {
  const n = arr.length, out = new Float64Array(n);
  let acc = 0, cnt = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + arr[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius), b = Math.min(n, i + radius + 1);
    out[i] = (pre[b] - pre[a]) / (b - a);
  }
  void acc; void cnt;
  return out;
}

export class Track {
  /** xyz: Float32Array of x, y, z every `step` metres. */
  constructor(xyz, step, name) {
    this.name = name;
    this.step = step;
    const n = xyz.length / 3;
    this.n = n;
    this.length = (n - 1) * step;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = xyz[3 * i]; this.y[i] = xyz[3 * i + 1]; this.z[i] = xyz[3 * i + 2]; }
    // heading (radians, 0 = north, clockwise positive like a compass)
    this.heading = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      this.heading[i] = Math.atan2(this.x[b] - this.x[a], this.y[b] - this.y[a]);
    }
    // unwrap
    for (let i = 1; i < n; i++) {
      let d = this.heading[i] - this.heading[i - 1];
      while (d > Math.PI) { this.heading[i] -= 2 * Math.PI; d -= 2 * Math.PI; }
      while (d < -Math.PI) { this.heading[i] += 2 * Math.PI; d += 2 * Math.PI; }
    }
    // curvature (1/m, + = curving right/clockwise), smoothed over ~10 m
    const k = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) k[i] = (this.heading[i + 1] - this.heading[i - 1]) / (2 * step);
    k[0] = k[1]; k[n - 1] = k[n - 2];
    this.curv = smooth(k, Math.round(5 / step));
    // grade (rise over run), smoothed over ~20 m
    const g = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) g[i] = (this.z[i + 1] - this.z[i - 1]) / (2 * step);
    g[0] = g[1]; g[n - 1] = g[n - 2];
    this.grade = smooth(g, Math.round(10 / step));
    // cant (m, raises the outer rail), laid for the equilibrium speed, capped
    this.cant = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.min(MAX_CANT, (CANT_V_EQ * CANT_V_EQ * Math.abs(this.curv[i]) * RAIL_SPACING) / G);
      this.cant[i] = Math.sign(this.curv[i]) * c;
    }
    this.cant = smooth(this.cant, Math.round(10 / step));
    // curve speed limit from cant + permitted deficiency: v = sqrt(g R (h + I) / s)
    this.vCurve = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const R = 1 / Math.max(1e-6, Math.abs(this.curv[i]));
      this.vCurve[i] = Math.sqrt((G * R * (Math.abs(this.cant[i]) + DEFICIENCY)) / RAIL_SPACING);
    }
  }

  _idx(s) {
    const f = Math.min(this.n - 1.000001, Math.max(0, s / this.step));
    const i = Math.floor(f);
    return [i, f - i];
  }

  _lerp(arr, s) { const [i, t] = this._idx(s); return arr[i] + (arr[i + 1] - arr[i]) * t; }

  /** Map position at chainage s, written into out {x, y, z}. */
  pos(s, out = {}) {
    const [i, t] = this._idx(s);
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    return out;
  }
  headingAt(s) { return this._lerp(this.heading, s); }
  curvatureAt(s) { return this._lerp(this.curv, s); }
  gradeAt(s) { return this._lerp(this.grade, s); }
  cantAt(s) { return this._lerp(this.cant, s); }
  curveSpeedAt(s) { return this._lerp(this.vCurve, s); }

  /** Chainage of the point on the track nearest to map (x, y), searched near sGuess (or everywhere). */
  locate(x, y, sGuess = null, window = 400) {
    let i0 = 0, i1 = this.n - 1;
    if (sGuess != null) { i0 = Math.max(0, Math.floor((sGuess - window) / this.step)); i1 = Math.min(this.n - 1, Math.ceil((sGuess + window) / this.step)); }
    let best = 1e30, bi = i0;
    for (let i = i0; i <= i1; i++) { const d = (this.x[i] - x) ** 2 + (this.y[i] - y) ** 2; if (d < best) { best = d; bi = i; } }
    // refine on the neighbouring segments
    let bs = bi * this.step, bd = Math.sqrt(best);
    for (const j of [bi - 1, bi]) {
      if (j < 0 || j + 1 >= this.n) continue;
      const dx = this.x[j + 1] - this.x[j], dy = this.y[j + 1] - this.y[j], L2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((x - this.x[j]) * dx + (y - this.y[j]) * dy) / L2));
      const d = Math.hypot(this.x[j] + dx * u - x, this.y[j] + dy * u - y);
      if (d < bd) { bd = d; bs = (j + u) * this.step; }
    }
    return { s: bs, d: bd };
  }
}

export class Route {
  static async load() {
    const r = new Route();
    await r._init();
    return r;
  }

  async _init() {
    const R = ROUTE;
    this.data = R;
    this.step = R.step;
    this.run = new Track(await gunzipBase64(R.run.xyz), R.step, 'run');
    this.left = new Track(await gunzipBase64(R.left.xyz), R.step, 'left');
    this.right = new Track(await gunzipBase64(R.right.xyz), R.step, 'right');
    this.length = this.run.length;
    this.tunnels = R.tunnels.map((t) => ({ name: t.name, s0: Math.min(t.r0, t.r1), s1: Math.max(t.r0, t.r1) })).filter((t) => t.s1 - t.s0 > 1);
    this.bridges = R.bridges.map((t) => ({ name: t.name, s0: Math.min(t.r0, t.r1), s1: Math.max(t.r0, t.r1) })).filter((t) => t.s1 - t.s0 > 1);
    // the same structures in the left main line's own chainage (the run path leaves it at the stations)
    this.leftTunnels = R.tunnels.map((t) => ({ name: t.name, s0: Math.min(t.s0, t.s1), s1: Math.max(t.s0, t.s1) }));
    this.leftBridges = R.bridges.map((t) => ({ name: t.name, s0: Math.min(t.s0, t.s1), s1: Math.max(t.s0, t.s1) }));
    this.masts = R.masts.map(([s, side]) => ({ s, side }));
    // platforms: chainage range along the running path and which side of it they lie on
    this.platforms = R.platforms.map((p) => {
      let s0 = 1e9, s1 = -1e9, side = 0;
      for (let k = 0; k < p.xy.length; k++) {
        const [x, y] = p.xy[k];
        const { s } = this.run.locate(x, y, p.sRun, 500);
        s0 = Math.min(s0, s); s1 = Math.max(s1, s);
        const q = this.run.pos(s), h = this.run.headingAt(s);
        side += (x - q.x) * Math.cos(h) - (y - q.y) * Math.sin(h);   // + = right of the direction of travel
      }
      return { ref: p.ref, s0, s1, side: Math.sign(side), xy: p.xy };
    });
    this.stations = R.stations.map((st) => ({ name: st.name, s: st.sRun, km: st.km, z: st.z ?? st.zFit }));
    this._stops();
    // names OpenStreetMap leaves out, where the order and lengths of the line's structures make
    // them certain (de.wikipedia "Gotthardbahn" and "Chärstelenbachbrücke": south of Amsteg the
    // Windgällentunnel, 183 m, the bridge at km 47.9, then the Bristentunnel, 709 m)
    for (const [name, km, len] of [['Windgällentunnel', 47.7, 183], ['Bristentunnel', 48.4, 709]]) {
      const t = this.tunnels.find((x) => !x.name && Math.abs(this.kmAt(x.s0) - km) < 0.35 && Math.abs((x.s1 - x.s0) - len) < len * 0.2);
      if (t) t.name = name;
    }
  }

  /**
   * Where the train stands at each station. Erstfeld and Göschenen: on Gleis 1,
   * the engine near the far (south) end of the platform. The closed intermediate
   * stations: the train's middle opposite the station building.
   */
  _stops() {
    const byName = (n) => this.stations.find((s) => s.name === n);
    const plat = (station, ref) => this.platforms.filter((p) => String(p.ref) === ref).sort((a, b) => Math.abs((a.s0 + a.s1) / 2 - station.s) - Math.abs((b.s0 + b.s1) / 2 - station.s))[0];
    for (const st of this.stations) {
      if (st.name === 'Erstfeld' || st.name === 'Göschenen') {
        const p = plat(st, '1');
        st.platform = p;
        st.stopFront = p.s1 - 8;           // the buffer beam of the engine 8 m short of the platform end
        st.platformSide = p.side;
      } else {
        st.stopCentre = st.s;
        st.platformSide = null;            // decided by the station model (low platform beside the train)
      }
    }
    this.origin = byName('Erstfeld');
    this.terminus = byName('Göschenen');
  }

  structureAt(s) {
    for (const t of this.tunnels) if (s >= t.s0 && s <= t.s1) return { type: 'tunnel', ...t };
    for (const b of this.bridges) if (s >= b.s0 && s <= b.s1) return { type: 'bridge', ...b };
    return null;
  }
  inTunnel(s) { for (const t of this.tunnels) if (s >= t.s0 && s <= t.s1) return t; return null; }

  /** Official kilometre (from Immensee) at chainage s, by the two station references. */
  kmAt(s) {
    const a = this.origin, b = this.terminus;
    return a.km + ((s - a.s) / (b.s - a.s)) * (b.km - a.km);
  }

  /** Map position (x east, y north, z up) to the renderer's world (X east, Y up, Z south). */
  static toWorld(p, out) { out.x = p.x; out.y = p.z; out.z = -p.y; return out; }
}
