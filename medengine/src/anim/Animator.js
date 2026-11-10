/**
 * Animator: plays AnimationClips on a bone hierarchy.
 *
 *   layers      layer 0 is the base; higher layers blend on top of what is below them, optionally through a
 *               bone mask (an upper-body wave over a walk). A layer can be additive (a breath, a flinch).
 *   actions     one clip being played: time, speed, weight, fades, loop, events.
 *   fades       play() cross-fades from whatever the layer was doing; weights inside a layer are normalised,
 *               so a cross-fade never pops or collapses.
 *   root motion the pelvis' horizontal travel in a clip is taken out of the pose and handed to you in
 *               `rootDelta` (metres and radians this frame, in the character's local frame): apply it to the
 *               character, or ignore it and drive movement from physics.
 *   events      `{time, name, data}` entries of a clip fire `onEvent` as the playhead passes them.
 *
 * The animator writes to the bones' `position` / `quaternion` / `scale` each `update(dt)` (and, for 'weights'
 * tracks, to the `morphTargetInfluences` of the mesh with that name). Rotation and translation support masks,
 * additive layers and root motion; scale and morph weights are blended by weight and layer mask, and an
 * additive layer leaves them alone. Run it before anything that adjusts bones afterwards (look-at, IK, ragdoll),
 * then update the scene's world matrices.
 */
import { Quaternion } from '../math/core.js';

/**
 * @import { Object3D } from '../scene/Object3D.js'
 * @import { AnimationClip } from './Clip.js'
 * @import { StateMachine } from './StateMachine.js'
 */

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const _tmp = new Float32Array(4), _tmp2 = new Float32Array(4);
let _wtmp = new Float32Array(64);

/** The morph weights array that animates `node`: its own, or the first child's (a glTF mesh with several primitives). */
function morphArray(node) {
  if (node.morphTargetInfluences) return node.morphTargetInfluences;
  for (const c of node.children) if (c.morphTargetInfluences) return c.morphTargetInfluences;
  return null;
}

/** Cached facts about a clip's root-motion track. */
const ROOT = new WeakMap();
function rootInfo(clip) {
  const key = `${clip.loop}|${clip.rootMotion}|${clip.rootYaw}|${clip.rootBone}`;
  let r = ROOT.get(clip);
  if (r !== undefined && (r === null ? clip._rootKey === key : r.key === key)) return r;
  const e = clip.rootBone ? clip.byBone.get(clip.rootBone) : null;
  clip._rootKey = key;
  if (!e || !e.p) { ROOT.set(clip, null); return null; }
  const p = e.p, n = p.count, V = p.values;
  // 'trend': a looping clip travels at constant speed (hip sway stays in the pose); 'full': the real curve (a lunge)
  const mode = clip.rootMotion === 'auto' || clip.rootMotion === undefined ? (clip.loop ? 'trend' : 'full') : clip.rootMotion;
  r = {
    key, track: p, qtrack: e.q, mode,
    x0: V[0], z0: V[2],
    netX: V[(n - 1) * 3] - V[0], netZ: V[(n - 1) * 3 + 2] - V[2],
    yawTrack: clip.rootYaw && e.q ? e.q : null,
  };
  ROOT.set(clip, r);
  return r;
}

function yawOf(q, o = 0) { return 2 * Math.atan2(q[o + 1], q[o + 3]); }

export class Action {
  /**
   * @param {Animator} animator
   * @param {AnimationClip} clip
   * @param {Layer} layer
   */
  constructor(animator, clip, layer) {
    this.animator = animator; this.clip = clip; this.layer = layer;
    this.time = 0;
    this.speed = 1;
    this.weight = 1;
    this.loop = clip.loop;
    /** Manual actions are advanced by someone else (the state machine): update() leaves time and weight alone. */
    this.manual = false;
    /**
     * Which owner a manual action belongs to (state machine + state), so one clip can have several playheads.
     * @type {string|null}
     */
    this.key = null;
    this.paused = false;
    this.finished = false;
    this.loops = 0;
    /** @type {((action: Action) => void)|null} called once when a non-looping action has played to its end */
    this.onFinish = null;
    /** @type {((name: string, data: any, action: Action) => void)|null} called as the playhead passes a clip event */
    this.onEvent = null;
    this._fade = null;
    this._prev = 0;
    this.removeWhenFaded = true;
  }
  get duration() { return this.clip.duration; }
  get normalizedTime() { const d = this.clip.duration; return d > 0 ? this.time / d : 0; }
  set normalizedTime(v) { this.time = v * this.clip.duration; this._prev = this.time; }
  get isFading() { return !!this._fade; }
  /** Moves the weight to `w` over `duration` seconds (0 = at once). */
  fadeTo(w, duration = 0.2) {
    if (duration <= 0) {
      this.weight = w; this._fade = null;
      if (w === 0 && this.removeWhenFaded && !this.manual) this.layer._remove(this);
      return this;
    }
    this._fade = { from: this.weight, to: w, t: 0, d: duration };
    return this;
  }
  fadeIn(duration = 0.2) { this.weight = 0; return this.fadeTo(1, duration); }
  fadeOut(duration = 0.2) { return this.fadeTo(0, duration); }
  stop(duration = 0) { this.fadeTo(0, duration); this._stopping = true; if (duration <= 0) this.layer._remove(this); return this; }
  setTime(t) { this.time = t; this._prev = t; this.finished = false; return this; }
}

/**
 * Settings for a layer (`animator.layer(i, settings)`).
 * @typedef {object} LayerSettings
 * @property {number} [weight]     how much the layer counts, 0..1 (also the influence of the bones named in `mask`)
 * @property {boolean} [additive]  add the layer's pose on top of the layers below instead of blending with them
 * @property {Iterable<string> | Map<string, number> | null} [mask]  bone names the layer is restricted to; a Map gives a weight per bone; null clears the mask
 * @property {boolean} [children]  with a list of names in `mask`: include everything below those bones (default true)
 */

export class Layer {
  /**
   * @param {Animator} animator
   * @param {number} index
   */
  constructor(animator, index) {
    this.animator = animator; this.index = index;
    this.weight = 1;
    this.additive = false;
    /** @type {Map<string, number>|null} bone name -> influence 0..1 (null: all bones) */
    this.mask = null;
    /** @type {Action[]} */ this.actions = [];
    /** The most recent action started with play(). */ this.current = null;
    this.q = new Float32Array(0); this.qw = new Float32Array(0); this.p = new Float32Array(0); this.pw = new Float32Array(0);
    this.s = new Float32Array(0); this.sw = new Float32Array(0);
    /** @type {Map<number, {v: Float32Array, w: number}>|null} morph weights being mixed, per node slot */ this.wacc = null;
  }
  _remove(a) { const i = this.actions.indexOf(a); if (i >= 0) this.actions.splice(i, 1); if (this.current === a) this.current = this.actions[this.actions.length - 1] ?? null; }
  /**
   * Restricts the layer to some bones. `names` are bone names; `children` includes everything below them.
   * Pass a Map for per-bone weights, or null to clear.
   * @param {Iterable<string> | Map<string, number> | null | undefined} names
   * @param {{ children?: boolean, weight?: number }} [o]
   * @returns {this}
   */
  setMask(names, { children = true, weight = 1 } = {}) {
    if (names == null) { this.mask = null; return this; }
    if (names instanceof Map) { this.mask = names; return this; }
    const m = new Map();
    for (const n of names) {
      const o = this.animator.root.getObjectByName(n);
      if (!o) continue;
      if (children) o.traverse((c) => { if (c.name) m.set(c.name, weight); });
      else m.set(n, weight);
    }
    this.mask = m;
    return this;
  }
  /**
   * All bones except the given ones (and, with `children`, everything below them).
   * @param {Iterable<string>} names
   * @param {{ children?: boolean }} [o]
   * @returns {this}
   */
  setMaskExcept(names, { children = true } = {}) {
    const skip = new Set();
    for (const n of names) {
      const o = this.animator.root.getObjectByName(n);
      if (!o) continue;
      if (children) o.traverse((c) => { if (c.name) skip.add(c.name); }); else skip.add(n);
    }
    const m = new Map();
    this.animator.root.traverse((c) => { if (c.name && !skip.has(c.name)) m.set(c.name, 1); });
    this.mask = m;
    return this;
  }
}

export class Animator {
  /**
   * @param {Object3D} root  the character: the hierarchy that holds the bones named in the clips
   * @param {object} [o]
   * @param {boolean} [o.rootMotion] take horizontal pelvis travel out of the pose (default true)
   */
  constructor(root, { rootMotion = true } = {}) {
    this.root = root;
    this.rootMotion = rootMotion;
    this.speed = 1;
    this.time = 0;
    /** @type {Layer[]} */ this.layers = [];
    /** Root motion produced by the last update(), in the character's local frame (+Z forward). */
    this.rootDelta = { x: 0, y: 0, z: 0, yaw: 0 };
    /** @type {((name: string, data: any, action: Action) => void)|null} fired as the playhead passes a clip event (the action's own `onEvent` fires first) */
    this.onEvent = null;
    this._slots = new Map(); this._nodes = []; this._restQ = []; this._restP = []; this._restS = [];
    this._bound = new WeakMap();
    this._cap = 0; this._outQ = new Float32Array(0); this._outP = new Float32Array(0); this._drivenP = new Uint8Array(0);
    this._outS = new Float32Array(0); this._drivenS = new Uint8Array(0);
    /** slot -> rest / current morph weights, for the nodes that have a 'weights' track */
    this._wRest = new Map(); this._wOut = new Map(); this._wDriven = new Set();
    /** @type {StateMachine[]} */ this._machines = null;
    this.layer(0);
  }

  /**
   * Gets (creating if needed) layer `i`, with optional settings.
   * @param {number} [i]  0 is the base layer
   * @param {LayerSettings | null} [o]
   * @returns {Layer}
   */
  layer(i = 0, o = null) {
    while (this.layers.length <= i) { const nl = new Layer(this, this.layers.length); this.layers.push(nl); this._sizeLayer(nl); }
    const L = this.layers[i];
    if (o) { if (o.weight !== undefined) L.weight = o.weight; if (o.additive !== undefined) L.additive = o.additive; if (o.mask !== undefined) L.setMask(o.mask, o); }
    return L;
  }

  _slot(name) {
    let s = this._slots.get(name);
    if (s !== undefined) return s;
    s = this._nodes.length;
    const node = this.root.getObjectByName(name) ?? (this.root.name === name ? this.root : null);
    this._slots.set(name, s);
    this._nodes.push(node);
    this._restQ.push(node ? node.quaternion.toArray() : null);
    this._restP.push(node ? node.position.toArray() : null);
    this._restS.push(node ? node.scale.toArray() : null);
    return s;
  }

  _binding(clip) {
    let b = this._bound.get(clip);
    if (b) return b;
    b = new Int32Array(clip.tracks.length);
    clip.tracks.forEach((t, i) => {
      const s = this._slot(t.bone);
      b[i] = this._nodes[s] ? s : -1;
      if (t.kind === 'weights' && b[i] >= 0) {
        const arr = morphArray(this._nodes[s]);
        if (!arr) b[i] = -1;                                  // the node has nothing to morph
        else if (!this._wRest.has(s)) { this._wRest.set(s, Float32Array.from(arr)); this._wOut.set(s, new Float32Array(arr.length)); }
      }
    });
    this._bound.set(clip, b);
    this._grow();
    return b;
  }

  _grow() {
    const n = this._nodes.length;
    if (n <= this._cap) return;
    const cap = Math.max(32, n * 2);
    this._cap = cap;
    this._outQ = new Float32Array(cap * 4); this._outP = new Float32Array(cap * 3); this._drivenP = new Uint8Array(cap);
    this._outS = new Float32Array(cap * 3); this._drivenS = new Uint8Array(cap);
    for (const L of this.layers) this._sizeLayer(L);
  }

  _sizeLayer(L) {
    const cap = this._cap;
    if (L.qw.length >= cap) return;
    L.q = new Float32Array(cap * 4); L.qw = new Float32Array(cap); L.p = new Float32Array(cap * 3); L.pw = new Float32Array(cap);
    L.s = new Float32Array(cap * 3); L.sw = new Float32Array(cap);
  }

  /**
   * Registers bones with the animator now and takes their current local transforms as their rest pose. Clips register the bones
   * they drive when they first play, which is too late if the character is already posed by then (a ragdoll lying on the floor);
   * call this once while the character is in its rest pose. Registered bones that no playing clip drives are held at rest.
   */
  registerBones(names) {
    for (const n of names) this._slot(n);
    this._grow();
    return this;
  }

  /** Re-reads the bones' current local transforms as the rest pose (call after changing the model's bind pose). */
  captureRest() {
    this._nodes.forEach((node, s) => { if (node) { this._restQ[s] = node.quaternion.toArray(); this._restP[s] = node.position.toArray(); this._restS[s] = node.scale.toArray(); } });
    for (const s of this._wRest.keys()) { const arr = morphArray(this._nodes[s]); if (arr) this._wRest.set(s, Float32Array.from(arr)); }
  }

  /**
   * A persistent action for `clip` on a layer, created the first time and then reused. Its time and weight
   * are yours to set (`manual`): this is what the state machine builds on.
   * @param {AnimationClip} clip
   * @param {number} [layer]  layer index, 0 is the base layer
   * @param {string|null} [key]  tells several playheads on the same clip apart
   * @returns {Action}
   */
  action(clip, layer = 0, key = null) {
    const L = this.layer(layer);
    let a = L.actions.find((x) => x.clip === clip && x.manual && x.key === key);
    if (!a) { a = new Action(this, clip, L); a.manual = true; a.key = key; a.weight = 0; L.actions.push(a); this._binding(clip); this._grow(); }
    return a;
  }

  /**
   * Plays `clip`, cross-fading from whatever the layer was playing.
   * @param {AnimationClip} clip
   * @param {object} [o]
   * @param {number} [o.layer]  0 = base layer
   * @param {number} [o.fade]   cross-fade seconds (default 0.2)
   * @param {boolean} [o.loop]  default: the clip's own flag
   * @param {number} [o.speed]
   * @param {number} [o.time]   start time in seconds
   * @param {number} [o.normalizedTime] start time as a fraction of the clip (wins over `time`)
   * @param {boolean} [o.sync]  start at the same phase as the clip being replaced (walk -> run)
   * @param {boolean} [o.restart] restart even when this clip is already the current one
   * @param {number} [o.weight]  final weight of the action, 0..1 (default 1)
   * @returns {Action}
   */
  play(clip, { layer = 0, fade = 0.2, loop, speed = 1, time = 0, normalizedTime, sync = false, restart = false, weight = 1 } = {}) {
    const L = this.layer(layer), cur = L.current;
    if (!restart && cur && cur.clip === clip && !cur.finished && !cur._stopping && !cur.manual) {
      cur.speed = speed; if (loop !== undefined) cur.loop = loop;
      cur.fadeTo(weight, fade);
      return cur;
    }
    const a = new Action(this, clip, L);
    a.speed = speed;
    if (loop !== undefined) a.loop = loop;
    a.time = normalizedTime !== undefined ? normalizedTime * clip.duration : time;
    if (sync && cur) a.time = cur.normalizedTime * clip.duration;
    a._prev = a.time;
    const others = L.actions.filter((o) => o !== a);
    for (const o of others) { if (o.manual) o.fadeTo(0, fade); else { o.fadeOut(fade); o._stopping = true; } }
    if (fade > 0 && (others.length || L.index > 0)) { a.weight = 0; a.fadeTo(weight, fade); } else a.weight = weight;
    L.actions.push(a);
    L.current = a;
    this._binding(clip); this._grow();
    return a;
  }

  /** Fades every action on a layer out (and removes them). */
  stop(layer = 0, fade = 0.2) {
    const L = this.layer(layer);
    for (const a of [...L.actions]) { a.fadeOut(fade); a._stopping = true; if (fade <= 0) L._remove(a); }
    L.current = null;
  }

  stopAll(fade = 0.2) { for (let i = 0; i < this.layers.length; i++) this.stop(i, fade); }

  /** Is this clip the current, un-stopped action of its layer? */
  isPlaying(clip, layer = 0) { return this.layer(layer).actions.some((a) => a.clip === clip && !a._stopping && !a.finished); }

  // -------------------------------------------------------------------------------------------

  update(dt) {
    dt *= this.speed;
    this.time += dt;
    const rd = this.rootDelta; rd.x = rd.y = rd.z = rd.yaw = 0;
    this._grow();
    // state machines set the weights and step their own (manual) actions
    if (this._machines) for (const m of this._machines) m.update(dt);
    // advance playheads and fades
    for (const L of this.layers) {
      for (let i = L.actions.length - 1; i >= 0; i--) {
        const a = L.actions[i];
        if (a._fade) {
          const f = a._fade; f.t += dt;
          const k = smooth(f.t / f.d);
          a.weight = f.from + (f.to - f.from) * k;
          if (f.t >= f.d) { a.weight = f.to; a._fade = null; if (f.to === 0 && a.removeWhenFaded && !a.manual) { L._remove(a); continue; } }
        }
        if (a.manual || a.paused) continue;
        this._advance(a, dt * a.speed);
        if (a.finished && a.onFinish) { const fn = a.onFinish; a.onFinish = null; fn(a); }
      }
    }
    this._evaluate();
  }

  /**
   * Advances one action's playhead by `dt` seconds of clip time (already multiplied by its speed): fires the
   * events passed, adds the root motion at the action's current weight, handles looping and the end.
   * update() does this for ordinary actions; manual ones (state machine) are stepped by their owner.
   */
  step(a, dt) {
    const clip = a.clip, dur = clip.duration;
    if (dur <= 0 || dt === 0) return;
    const t0 = a.time;
    let t1 = t0 + dt;
    const first = !a._started; a._started = true;
    const rm = this.rootMotion ? rootInfo(clip) : null;
    if (a.loop) {
      if (dt > 0 && t1 >= dur) {
        this._events(a, t0, dur, first); if (rm) this._rootDelta(a, rm, t0, dur);
        a.loops++;
        t1 -= dur * Math.floor(t1 / dur);
        this._events(a, 0, t1, true); if (rm) this._rootDelta(a, rm, 0, t1);
      } else if (dt < 0 && t1 < 0) {
        this._events(a, 0, t0, first); if (rm) this._rootDelta(a, rm, t0, 0);
        a.loops++;
        t1 = ((t1 % dur) + dur) % dur;
        this._events(a, t1, dur, true); if (rm) this._rootDelta(a, rm, dur, t1);
      } else { this._events(a, t0, t1, first); if (rm) this._rootDelta(a, rm, t0, t1); }
      a.time = t1;
    } else {
      if (t1 >= dur) { t1 = dur; a.finished = true; }
      else if (t1 <= 0 && dt < 0) { t1 = 0; a.finished = true; }
      this._events(a, t0, t1, first);
      if (rm) this._rootDelta(a, rm, t0, t1);
      a.time = t1;
    }
    a._prev = t0;
  }
  _advance(a, dt) { this.step(a, dt); }

  _events(a, t0, t1, includeStart) {
    const ev = a.clip.events;
    if (!ev.length) return;
    const lo = Math.min(t0, t1), hi = Math.max(t0, t1);
    for (const e of ev) {
      const inside = includeStart ? (e.time >= lo && e.time <= hi) : (e.time > lo && e.time <= hi);
      if (inside) { a.onEvent?.(e.name, e.data, a); this.onEvent?.(e.name, e.data, a); }
    }
  }

  /** Accumulates the weighted root motion between two clip times into rootDelta. */
  _rootDelta(a, rm, t0, t1) {
    const w = a.weight * a.layer.weight * (a.layer.additive ? 0 : 1);
    if (w <= 0) return;
    const rd = this.rootDelta, dur = a.clip.duration;
    if (rm.mode === 'none') return;
    let dx, dz;
    if (rm.mode === 'trend') {
      const k = (t1 - t0) / dur;
      dx = rm.netX * k; dz = rm.netZ * k;
    } else {
      rm.track.sample(t0, _tmp, 0); const ax = _tmp[0], az = _tmp[2];
      rm.track.sample(t1, _tmp, 0); const bx = _tmp[0], bz = _tmp[2];
      dx = bx - ax; dz = bz - az;
      if (rm.yawTrack) {
        rm.yawTrack.sample(t0, _tmp, 0); const y0 = yawOf(_tmp);
        rm.yawTrack.sample(t1, _tmp2, 0); let dy = yawOf(_tmp2) - y0;
        if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
        rd.yaw += dy * w;
        // express the displacement in the heading frame at t0
        const c = Math.cos(-y0), s = Math.sin(-y0), x = dx * c + dz * s, z = -dx * s + dz * c;
        dx = x; dz = z;
      }
    }
    rd.x += dx * w; rd.z += dz * w;
  }

  /** Mixes all layers and writes the result to the bones. */
  _evaluate() {
    const n = this._nodes.length;
    if (!n) return;
    const outQ = this._outQ, outP = this._outP, drivenP = this._drivenP, outS = this._outS, drivenS = this._drivenS;
    for (let s = 0; s < n; s++) {
      const rq = this._restQ[s], rp = this._restP[s];
      if (!rq) continue;
      outQ[s * 4] = rq[0]; outQ[s * 4 + 1] = rq[1]; outQ[s * 4 + 2] = rq[2]; outQ[s * 4 + 3] = rq[3];
      outP[s * 3] = rp[0]; outP[s * 3 + 1] = rp[1]; outP[s * 3 + 2] = rp[2];
      drivenP[s] = 0;
      const rs = this._restS[s];
      outS[s * 3] = rs[0]; outS[s * 3 + 1] = rs[1]; outS[s * 3 + 2] = rs[2];
      drivenS[s] = 0;
    }
    for (const [s, r] of this._wRest) this._wOut.get(s).set(r);
    this._wDriven.clear();
    for (const L of this.layers) {
      if (L.weight <= 0 || !L.actions.length) continue;
      L.qw.fill(0, 0, n); L.pw.fill(0, 0, n); L.p.fill(0, 0, n * 3); L.q.fill(0, 0, n * 4); L.sw.fill(0, 0, n); L.s.fill(0, 0, n * 3);
      if (L.wacc) for (const e of L.wacc.values()) { e.v.fill(0); e.w = 0; }
      let any = false;
      for (const a of L.actions) {
        const w = a.weight;
        if (w <= 1e-5) continue;
        any = true;
        const clip = a.clip, bind = this._bound.get(clip) ?? this._binding(clip), tracks = clip.tracks;
        const rm = this.rootMotion ? rootInfo(clip) : null;
        for (let i = 0; i < tracks.length; i++) {
          const s = bind[i];
          if (s < 0) continue;
          const tr = tracks[i];
          tr.sample(a.time, _tmp, 0);
          if (tr.kind === 'quaternion') {
            if (rm && rm.yawTrack === tr) this._stripYaw(a, rm, _tmp);
            const o = s * 4, Q = L.q;
            // keep every contribution in the same hemisphere as the first one
            const sign = Q[o] * _tmp[0] + Q[o + 1] * _tmp[1] + Q[o + 2] * _tmp[2] + Q[o + 3] * _tmp[3] < 0 ? -w : w;
            Q[o] += _tmp[0] * sign; Q[o + 1] += _tmp[1] * sign; Q[o + 2] += _tmp[2] * sign; Q[o + 3] += _tmp[3] * sign;
            L.qw[s] += w;
          } else if (tr.kind === 'position') {
            if (rm && rm.track === tr) this._stripTravel(a, rm, _tmp);
            const o = s * 3;
            L.p[o] += _tmp[0] * w; L.p[o + 1] += _tmp[1] * w; L.p[o + 2] += _tmp[2] * w;
            L.pw[s] += w;
          } else if (tr.kind === 'scale') {
            const o = s * 3;
            L.s[o] += _tmp[0] * w; L.s[o + 1] += _tmp[1] * w; L.s[o + 2] += _tmp[2] * w;
            L.sw[s] += w;
          } else {
            // morph weights: sampled into a scratch buffer (a track can have any number of targets)
            if (_wtmp.length < tr.size) _wtmp = new Float32Array(tr.size * 2);
            tr.sample(a.time, _wtmp, 0);
            const wacc = (L.wacc ??= new Map());
            let e = wacc.get(s);
            if (!e || e.v.length !== tr.size) { e = { v: new Float32Array(tr.size), w: 0 }; wacc.set(s, e); }
            for (let k = 0; k < tr.size; k++) e.v[k] += _wtmp[k] * w;
            e.w += w;
          }
        }
      }
      if (!any) continue;
      const mask = L.mask;
      for (let s = 0; s < n; s++) {
        const m = mask ? (mask.get(this._nodes[s]?.name) ?? 0) : 1;
        if (m <= 0) continue;
        const qw = L.qw[s];
        if (qw > 0) {
          const o = s * 4, Q = L.q;
          const len = Math.hypot(Q[o], Q[o + 1], Q[o + 2], Q[o + 3]) || 1;
          let x = Q[o] / len, y = Q[o + 1] / len, z = Q[o + 2] / len, w4 = Q[o + 3] / len;
          const f = Math.min(1, qw) * L.weight * m;
          if (L.additive) {
            // an offset from the base: scale its angle by f, then put it in front of the base rotation
            if (w4 < 0) { x = -x; y = -y; z = -z; w4 = -w4; }
            x *= f; y *= f; z *= f; w4 = 1 + (w4 - 1) * f;
            const il = 1 / (Math.hypot(x, y, z, w4) || 1); x *= il; y *= il; z *= il; w4 *= il;
            const bx = outQ[o], by = outQ[o + 1], bz = outQ[o + 2], bw = outQ[o + 3];
            outQ[o] = w4 * bx + x * bw + y * bz - z * by;
            outQ[o + 1] = w4 * by - x * bz + y * bw + z * bx;
            outQ[o + 2] = w4 * bz + x * by - y * bx + z * bw;
            outQ[o + 3] = w4 * bw - x * bx - y * by - z * bz;
          } else {
            let bx = outQ[o], by = outQ[o + 1], bz = outQ[o + 2], bw = outQ[o + 3];
            if (bx * x + by * y + bz * z + bw * w4 < 0) { x = -x; y = -y; z = -z; w4 = -w4; }
            bx += (x - bx) * f; by += (y - by) * f; bz += (z - bz) * f; bw += (w4 - bw) * f;
            const il = 1 / (Math.hypot(bx, by, bz, bw) || 1);
            outQ[o] = bx * il; outQ[o + 1] = by * il; outQ[o + 2] = bz * il; outQ[o + 3] = bw * il;
          }
        }
        const pw = L.pw[s];
        if (pw > 0) {
          const o = s * 3, f = Math.min(1, pw) * L.weight * m, il = 1 / pw;
          if (L.additive) { outP[o] += L.p[o] * il * f; outP[o + 1] += L.p[o + 1] * il * f; outP[o + 2] += L.p[o + 2] * il * f; }
          else { outP[o] += (L.p[o] * il - outP[o]) * f; outP[o + 1] += (L.p[o + 1] * il - outP[o + 1]) * f; outP[o + 2] += (L.p[o + 2] * il - outP[o + 2]) * f; }
          drivenP[s] = 1;
        }
        const sw = L.sw[s];
        if (sw > 0 && !L.additive) {
          const o = s * 3, f = Math.min(1, sw) * L.weight * m, il = 1 / sw;
          outS[o] += (L.s[o] * il - outS[o]) * f; outS[o + 1] += (L.s[o + 1] * il - outS[o + 1]) * f; outS[o + 2] += (L.s[o + 2] * il - outS[o + 2]) * f;
          drivenS[s] = 1;
        }
      }
      if (L.wacc && !L.additive) {
        for (const [s, e] of L.wacc) {
          if (e.w <= 0) continue;
          const m = mask ? (mask.get(this._nodes[s]?.name) ?? 0) : 1;
          if (m <= 0) continue;
          const out = this._wOut.get(s), f = Math.min(1, e.w) * L.weight * m, il = 1 / e.w, k1 = Math.min(out.length, e.v.length);
          for (let k = 0; k < k1; k++) out[k] += (e.v[k] * il - out[k]) * f;
          this._wDriven.add(s);
        }
      }
    }
    for (let s = 0; s < n; s++) {
      const node = this._nodes[s];
      if (!node) continue;
      node.quaternion.set(outQ[s * 4], outQ[s * 4 + 1], outQ[s * 4 + 2], outQ[s * 4 + 3]);
      if (drivenP[s]) node.position.set(outP[s * 3], outP[s * 3 + 1], outP[s * 3 + 2]);
      if (drivenS[s]) node.scale.set(outS[s * 3], outS[s * 3 + 1], outS[s * 3 + 2]);
    }
    for (const s of this._wDriven) {
      const arr = morphArray(this._nodes[s]), out = this._wOut.get(s);
      if (arr) for (let k = 0, k1 = Math.min(arr.length, out.length); k < k1; k++) arr[k] = out[k];
    }
  }

  /** The pose keeps the pelvis centred: remove the horizontal travel that root motion hands to the caller. */
  _stripTravel(a, rm, v) {
    if (rm.mode === 'none') return;
    const t = a.time;
    if (rm.mode === 'trend') {
      const k = a.clip.duration > 0 ? t / a.clip.duration : 0;
      v[0] -= rm.netX * k; v[2] -= rm.netZ * k;
    } else { v[0] = rm.x0; v[2] = rm.z0; }
  }

  /** Removes the turning that root motion hands to the caller from the pelvis rotation. */
  _stripYaw(a, rm, q) {
    rm.yawTrack.sample(0, _tmp2, 0);
    const y0 = yawOf(_tmp2), y = yawOf(q);
    let d = y - y0;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    // q' = Ry(-d) * q
    const h = -d / 2, sy = Math.sin(h), cy = Math.cos(h);
    const x = q[0], yy = q[1], z = q[2], w = q[3];
    q[0] = cy * x + sy * z; q[1] = cy * yy + sy * w; q[2] = cy * z - sy * x; q[3] = cy * w - sy * yy;
  }

  /** Moves a scene object by the last update's root motion (object's +Z forward, rotation about Y). */
  applyRootMotion(object, rotate = true) {
    const d = this.rootDelta, a = object.rotation.y, c = Math.cos(a), s = Math.sin(a);
    object.position.x += d.x * c + d.z * s;
    object.position.z += -d.x * s + d.z * c;
    object.position.y += d.y;
    if (rotate) object.rotation.y += d.yaw;
    return object;
  }
}

void Quaternion;
