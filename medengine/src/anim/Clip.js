/**
 * Animation clips: named tracks of keyframes on bones.
 *
 * A clip stores, per bone, a quaternion track (the bone's local rotation) and optionally a position
 * track (its local position, normally only the pelvis). Tracks are sampled with slerp / lerp. Clips
 * made by the retargeter are uniformly sampled (`dt` set), which makes sampling O(1).
 */
import { Quaternion } from '../math/core.js';

/**
 * A named moment in a clip: a footfall, the frame a punch lands. The animator reports it (`animator.onEvent`) as the playhead passes.
 * @typedef {object} ClipEvent
 * @property {number} time   seconds from the start of the clip
 * @property {string} name
 * @property {any} [data]    whatever the event carries ({ foot: 'l' } for a footstep)
 */

const _a = new Quaternion(), _b = new Quaternion();

export class Track {
  /**
   * @param {string} bone     the bone (Object3D name) this track drives
   * @param {'quaternion'|'position'|'scale'|'weights'} kind
   *        quaternion = local rotation, position = local translation, scale = local scale,
   *        weights = morph-target weights of the mesh with that name (glTF animations carry all four)
   * @param {Float32Array|number[]} values  4 (quaternion), 3 (position, scale) or `size` (weights) numbers per key
   * @param {Float32Array|number[]|null} times  seconds per key (omit when `dt` is given)
   * @param {number} [dt]     uniform key spacing in seconds
   * @param {number} [size]   numbers per key; only needed for 'weights' (the number of morph targets)
   */
  constructor(bone, kind, values, times = null, dt = 0, size = 0) {
    this.bone = bone; this.kind = kind;
    if (kind !== 'quaternion' && kind !== 'position' && kind !== 'scale' && kind !== 'weights') throw new Error(`Track ${bone}: unknown kind '${kind}'`);
    this.size = kind === 'quaternion' ? 4 : kind === 'weights' ? size : 3;
    if (!(this.size > 0)) throw new Error(`Track ${bone}: a 'weights' track needs size (the number of morph targets)`);
    this.values = values instanceof Float32Array ? values : Float32Array.from(values);
    this.count = this.values.length / this.size;
    this.dt = dt;
    this.times = times ? (times instanceof Float32Array ? times : Float32Array.from(times)) : null;
    if (!this.times && !dt) throw new Error('Track: give times or dt');
    if (this.times && this.times.length !== this.count) throw new Error(`Track ${bone}: ${this.times.length} times for ${this.count} keys`);
  }
  get duration() { return this.times ? this.times[this.count - 1] : (this.count - 1) * this.dt; }

  /** Finds the key interval of time t: sets this._i (lower key) and this._f (0..1 between keys). */
  _locate(t) {
    const n = this.count;
    if (n === 1 || t <= 0) { this._i = 0; this._f = 0; return; }
    if (this.dt) {
      const x = t / this.dt;
      const i = Math.floor(x);
      if (i >= n - 1) { this._i = n - 1; this._f = 0; return; }
      this._i = i; this._f = x - i; return;
    }
    const T = this.times;
    if (t >= T[n - 1]) { this._i = n - 1; this._f = 0; return; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    this._i = lo; this._f = (t - T[lo]) / (T[hi] - T[lo]);
  }

  /** Writes the value at time t into out[o..] (quaternion: x y z w; position: x y z). */
  sample(t, out, o = 0) {
    this._locate(t);
    const V = this.values, s = this.size, i = this._i * s, f = this._f;
    if (f === 0) { for (let k = 0; k < s; k++) out[o + k] = V[i + k]; return out; }
    if (this.kind !== 'quaternion') { for (let k = 0; k < s; k++) out[o + k] = V[i + k] + (V[i + s + k] - V[i + k]) * f; return out; }
    _a.set(V[i], V[i + 1], V[i + 2], V[i + 3]);
    _b.set(V[i + 4], V[i + 5], V[i + 6], V[i + 7]);
    _a.slerp(_b, f);
    out[o] = _a.x; out[o + 1] = _a.y; out[o + 2] = _a.z; out[o + 3] = _a.w;
    return out;
  }
}

export class AnimationClip {
  /**
   * @param {string} name
   * @param {Track[]} tracks
   * @param {object} [o]
   * @param {number} [o.duration]   seconds (default: the longest track)
   * @param {boolean} [o.loop]      whether it is meant to loop (walk cycles)
   * @param {string|null} [o.rootBone]  the bone whose horizontal travel is "root motion" (default 'pelvis' if it has a position track)
   * @param {boolean} [o.additive]  tracks are offsets from a reference pose, to be added on top of other motion
   * @param {ClipEvent[]} [o.events]  named moments (footsteps, hit frames)
   * @param {'auto'|'trend'|'full'|'none'} [o.rootMotion]  how the root bone's travel is handed to the game:
   *        'trend' constant speed (cycles), 'full' the real curve (lunges), 'none' leave it in the pose, 'auto' by `loop`
   * @param {boolean} [o.rootYaw]   also hand over the root's turning (turn-in-place clips)
   * @param {object} [o.meta]       credits, source file, ...
   */
  constructor(name, tracks, { duration = 0, loop = false, rootBone = undefined, additive = false, events = [], meta = {}, rootMotion = 'auto', rootYaw = false } = {}) {
    this.name = name;
    this.tracks = tracks;
    this.duration = duration || tracks.reduce((m, t) => Math.max(m, t.duration), 0);
    this.loop = loop; this.additive = additive;
    this.rootMotion = rootMotion; this.rootYaw = rootYaw;
    this.events = events.slice().sort((a, b) => a.time - b.time);
    this.meta = meta;
    this._index();
    this.rootBone = rootBone === undefined ? (this.byBone.get('pelvis')?.p ? 'pelvis' : null) : rootBone;
  }

  get bones() { return [...this.byBone.keys()]; }

  /** (Re)builds `byBone`: per bone name its rotation `q`, translation `p`, scale `s` and morph `w` tracks (or null). */
  _index() {
    this.byBone = new Map();
    for (const t of this.tracks) {
      let e = this.byBone.get(t.bone);
      if (!e) { e = { q: null, p: null, s: null, w: null }; this.byBone.set(t.bone, e); }
      if (t.kind === 'quaternion') e.q = t; else if (t.kind === 'position') e.p = t; else if (t.kind === 'scale') e.s = t; else e.w = t;
    }
  }

  /** The local position of `bone` at time t (null when it has no position track). */
  positionAt(bone, t, out = new Float32Array(3)) { const e = this.byBone.get(bone); return e?.p ? e.p.sample(t, out) : null; }
  rotationAt(bone, t, out = new Float32Array(4)) { const e = this.byBone.get(bone); return e?.q ? e.q.sample(t, out) : null; }

  /** Total horizontal travel of the root bone over the clip, in metres (0 when there is none). */
  get rootTravel() {
    const p = this.rootBone && this.byBone.get(this.rootBone)?.p;
    if (!p) return 0;
    const V = p.values, n = p.count;
    return Math.hypot(V[(n - 1) * 3] - V[0], V[(n - 1) * 3 + 2] - V[2]);
  }

  clone(name = this.name) { return new AnimationClip(name, this.tracks.map((t) => new Track(t.bone, t.kind, t.values.slice(), t.times?.slice() ?? null, t.dt, t.size)), { duration: this.duration, loop: this.loop, rootBone: this.rootBone, additive: this.additive, events: this.events.map((e) => ({ ...e })), meta: { ...this.meta }, rootMotion: this.rootMotion, rootYaw: this.rootYaw }); }

  /** A new clip holding only [t0, t1] (resampled at `fps`, default 30), starting at time 0. */
  crop(t0, t1, fps = 30) {
    const dt = 1 / fps, n = Math.max(2, Math.round((t1 - t0) * fps) + 1);
    const tracks = this.tracks.map((tr) => {
      const out = new Float32Array(n * tr.size);
      for (let k = 0; k < n; k++) tr.sample(Math.min(t1, t0 + k * dt), out, k * tr.size);
      // a cut that starts mid-travel still starts where the clip started horizontally (the character's origin)
      if (tr.kind === 'position' && tr.bone === this.rootBone) {
        const f = tr.sample(0, new Float32Array(3)), sx = f[0] - out[0], sz = f[2] - out[2];
        for (let k = 0; k < n; k++) { out[k * 3] += sx; out[k * 3 + 2] += sz; }
      }
      return new Track(tr.bone, tr.kind, out, null, dt, tr.size);
    });
    return new AnimationClip(`${this.name}[${t0.toFixed(2)}-${t1.toFixed(2)}]`, tracks, { duration: (n - 1) * dt, loop: this.loop, rootBone: this.rootBone, additive: this.additive, events: this.events.filter((e) => e.time >= t0 && e.time <= t1).map((e) => ({ ...e, time: e.time - t0 })), meta: { ...this.meta }, rootMotion: this.rootMotion, rootYaw: this.rootYaw });
  }

  /** The same motion, played from the end to the start. */
  reverse() {
    const c = this.clone(`${this.name}~`);
    for (const tr of c.tracks) {
      const n = tr.count, s = tr.size, v = tr.values.slice();
      for (let k = 0; k < n; k++) tr.values.set(v.subarray((n - 1 - k) * s, (n - k) * s), k * s);
      if (tr.times) { const t = tr.times.slice(); for (let k = 0; k < n; k++) tr.times[k] = c.duration - t[n - 1 - k]; }
    }
    c.events = c.events.map((e) => ({ ...e, time: c.duration - e.time })).sort((a, b) => a.time - b.time);
    return c;
  }

  /**
   * Mirrors the motion left-right: swaps `_l` and `_r` bones and reflects rotations across the
   * character's mid-plane (x -> -x). Needs a rig whose rest pose is left-right symmetric and
   * world-aligned (the Med Engine humans are).
   */
  mirror(swap = (n) => (/_l$/.test(n) ? n.replace(/_l$/, '_r') : /_r$/.test(n) ? n.replace(/_r$/, '_l') : n)) {
    const c = this.clone(`${this.name} (mirrored)`);
    for (const tr of c.tracks) {
      tr.bone = swap(tr.bone);
      const V = tr.values;
      if (tr.kind === 'quaternion') for (let k = 0; k < tr.count; k++) { V[k * 4 + 1] = -V[k * 4 + 1]; V[k * 4 + 2] = -V[k * 4 + 2]; }
      else if (tr.kind === 'position') for (let k = 0; k < tr.count; k++) V[k * 3] = -V[k * 3];
      // scale and morph weights are left as they are (a scale is a magnitude; morph targets have no left / right here)
    }
    c._index();
    return c;
  }

  /**
   * An additive clip: every rotation becomes the offset from the `refTime` pose of this clip
   * (q * ref^-1), positions the difference. Layer it on top of a base motion (a breath, a lean, a flinch).
   */
  makeAdditive(refTime = 0) {
    const c = this.clone(`${this.name} (additive)`);
    c.additive = true;
    // (scale tracks are left alone: there is no meaningful "offset" of a scale)
    c.tracks.forEach((tr, i) => {
      const ref = new Float32Array(Math.max(4, tr.size));
      this.tracks[i].sample(refTime, ref);
      if (tr.kind === 'quaternion') {
        _b.set(ref[0], ref[1], ref[2], ref[3]).invert();
        for (let k = 0; k < tr.count; k++) { _a.fromArray(tr.values, k * 4).multiply(_b); _a.toArray(tr.values, k * 4); }
      } else if (tr.kind !== 'scale') for (let k = 0; k < tr.count; k++) for (let a = 0; a < tr.size; a++) tr.values[k * tr.size + a] -= ref[a];
    });
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Binary form (.medclip): a JSON header and one Float32 block. Small, fast to load, no parsing.

  toBinary() {
    const head = {
      v: 1, name: this.name, duration: this.duration, loop: this.loop, additive: this.additive, rootBone: this.rootBone, events: this.events, meta: this.meta, rootMotion: this.rootMotion, rootYaw: this.rootYaw,
      tracks: [], total: 0,
    };
    let at = 0;
    for (const t of this.tracks) {
      head.tracks.push({ bone: t.bone, kind: t.kind, count: t.count, dt: t.dt, times: !!t.times, at, size: t.size });
      at += t.values.length + (t.times ? t.count : 0);
    }
    head.total = at;
    const json = new TextEncoder().encode(JSON.stringify(head));
    const pad = (4 - (json.length % 4)) % 4;
    const buf = new ArrayBuffer(8 + json.length + pad + at * 4);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x504c434d, true);                 // 'MCLP'
    dv.setUint32(4, json.length + pad, true);
    new Uint8Array(buf, 8, json.length).set(json);
    for (let k = 0; k < pad; k++) new Uint8Array(buf)[8 + json.length + k] = 32;
    const f = new Float32Array(buf, 8 + json.length + pad, at);
    this.tracks.forEach((t, i) => {
      f.set(t.values, head.tracks[i].at);
      if (t.times) f.set(t.times, head.tracks[i].at + t.values.length);
    });
    return buf;
  }

  static fromBinary(buf) {
    const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const dv = new DataView(ab);
    if (dv.getUint32(0, true) !== 0x504c434d) throw new Error('AnimationClip.fromBinary: not a .medclip file');
    const jl = dv.getUint32(4, true);
    const head = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, jl)));
    const f = new Float32Array(ab.slice(8 + jl, 8 + jl + head.total * 4));
    const tracks = head.tracks.map((t) => {
      const size = t.size ?? (t.kind === 'quaternion' ? 4 : 3), n = t.count * size;
      return new Track(t.bone, t.kind, f.slice(t.at, t.at + n), t.times ? f.slice(t.at + n, t.at + n + t.count) : null, t.dt, size);
    });
    return new AnimationClip(head.name, tracks, { duration: head.duration, loop: head.loop, additive: head.additive, rootBone: head.rootBone, events: head.events, meta: head.meta, rootMotion: head.rootMotion ?? 'auto', rootYaw: !!head.rootYaw });
  }
}
