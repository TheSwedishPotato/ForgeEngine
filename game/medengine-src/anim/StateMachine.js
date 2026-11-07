/**
 * Animation state machine: states that play a clip or a blend tree, transitions between them driven by
 * parameters, cross-fades with phase sync, exit times, input-buffered triggers and "any state" transitions.
 *
 *   const sm = new StateMachine(animator);
 *   sm.addState('idle', clips.idle);
 *   sm.addState('move', new BlendTree1D({ param: 'speed', children: [
 *     { clip: clips.idle, threshold: 0 }, { clip: clips.walk, threshold: 1.4 }, { clip: clips.run, threshold: 3.5 } ] }));
 *   sm.addState('jump', clips.jump, { loop: false });
 *   sm.addTransition('idle', 'move', { when: 'speed > 0.1' });
 *   sm.addTransition('move', 'idle', { when: 'speed <= 0.1' });
 *   sm.addTransition('*', 'jump', { when: 'jump', duration: 0.1 });          // a trigger, from anywhere
 *   sm.addTransition('jump', 'move', { exitTime: 0.9, duration: 0.2 });       // when the jump has almost played out
 *   sm.set('speed', player.speed);  sm.trigger('jump');  animator.update(dt);
 *
 * The machine drives "manual" actions of the animator on one layer, so several machines can share a character
 * (a locomotion machine on layer 0, an upper-body combat machine on layer 1 with a mask).
 */

/**
 * @import { AnimationClip } from './Clip.js'
 * @import { Animator, Action } from './Animator.js'
 */

// ------------------------------------------------------------------------------------------------
// Blend trees: motions whose clips are mixed by parameters. They all synchronise on normalised time, so
// walk and run feet stay in step as long as their cycles start on the same gait event (see Loop.findLoop).

/** One clip of the mix a motion produces for the current parameters. @typedef {{ clip: AnimationClip, weight: number, timeScale: number }} MotionMix */

/**
 * One state of a machine, as `addState` returns it.
 * @typedef {object} MachineState
 * @property {string} name
 * @property {Motion} motion
 * @property {number} speed        playback speed multiplier
 * @property {string|null} speedParam  name of a parameter that multiplies the speed
 * @property {string|null} tag
 * @property {boolean} loop
 * @property {AnimationClip[]} clips
 * @property {((machine: StateMachine, state: MachineState) => void)|null} onEnter  called when the machine enters this state
 * @property {((machine: StateMachine, state: MachineState) => void)|null} onExit   called when it leaves it
 */

class Motion {
  /** Appends the clips to play and their weights (sum 1) to `out`. */
  evaluate(params, out, scale = 1) { void params; void out; void scale; }
  /** Seconds one cycle takes at the given parameters (weight-averaged). */
  duration(params) {
    const mix = [];
    this.evaluate(params, mix, 1);
    let d = 0, w = 0;
    for (const m of mix) { d += m.weight * (m.clip.duration / (m.timeScale || 1)); w += m.weight; }
    return w > 0 ? d / w : 1;
  }
  get clips() { const s = new Set(); this._collect(s); return [...s]; }
  _collect(set) { void set; }
}

export class ClipMotion extends Motion {
  constructor(clip, timeScale = 1) { super(); this.clip = clip; this.timeScale = timeScale; }
  evaluate(params, out, scale = 1) { out.push({ clip: this.clip, weight: scale, timeScale: this.timeScale }); }
  _collect(set) { set.add(this.clip); }
}

/** Mixes clips along one parameter (speed: idle -> walk -> run). */
export class BlendTree1D extends Motion {
  /** @param {{param: string, children: {clip?: AnimationClip, motion?: Motion, threshold: number, timeScale?: number}[]}} o */
  constructor({ param, children }) {
    super();
    this.param = param;
    this.children = children.map((c) => ({ motion: c.motion ?? new ClipMotion(c.clip, c.timeScale ?? 1), threshold: c.threshold })).sort((a, b) => a.threshold - b.threshold);
  }
  evaluate(params, out, scale = 1) {
    const v = params[this.param] ?? 0, C = this.children, n = C.length;
    if (n === 1 || v <= C[0].threshold) return C[0].motion.evaluate(params, out, scale);
    if (v >= C[n - 1].threshold) return C[n - 1].motion.evaluate(params, out, scale);
    let i = 0;
    while (i < n - 2 && v > C[i + 1].threshold) i++;
    const a = C[i], b = C[i + 1], t = (v - a.threshold) / (b.threshold - a.threshold);
    a.motion.evaluate(params, out, scale * (1 - t));
    b.motion.evaluate(params, out, scale * t);
  }
  _collect(set) { for (const c of this.children) c.motion._collect(set); }
}

/**
 * Mixes clips over a plane (strafing: forward/back and left/right speed). Weights use gradient-band
 * interpolation (Rune Skovbo Johansen): smooth, local, exact at each clip's own position.
 */
export class BlendTree2D extends Motion {
  /** @param {{paramX: string, paramY: string, children: {clip?: AnimationClip, motion?: Motion, x: number, y: number, timeScale?: number}[]}} o */
  constructor({ paramX, paramY, children }) {
    super();
    this.paramX = paramX; this.paramY = paramY;
    this.children = children.map((c) => ({ motion: c.motion ?? new ClipMotion(c.clip, c.timeScale ?? 1), x: c.x, y: c.y }));
  }
  weights(px, py) {
    const C = this.children, n = C.length, w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let wi = 1;
      const ix = px - C[i].x, iy = py - C[i].y;
      for (let j = 0; j < n && wi > 0; j++) {
        if (j === i) continue;
        const jx = C[j].x - C[i].x, jy = C[j].y - C[i].y, l2 = jx * jx + jy * jy;
        if (l2 < 1e-12) continue;
        wi = Math.min(wi, Math.max(0, 1 - (ix * jx + iy * jy) / l2));
      }
      w[i] = wi; sum += wi;
    }
    if (sum <= 1e-9) {                                   // outside every band: take the nearest clip
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = (px - C[i].x) ** 2 + (py - C[i].y) ** 2; if (d < bd) { bd = d; best = i; } }
      w.fill(0); w[best] = 1; return w;
    }
    for (let i = 0; i < n; i++) w[i] /= sum;
    return w;
  }
  evaluate(params, out, scale = 1) {
    const w = this.weights(params[this.paramX] ?? 0, params[this.paramY] ?? 0);
    this.children.forEach((c, i) => { if (w[i] > 1e-4) c.motion.evaluate(params, out, scale * w[i]); });
  }
  _collect(set) { for (const c of this.children) c.motion._collect(set); }
}

/** Each child's weight is its own parameter (facial expressions, additive leans). Weights are not normalised. */
export class BlendTreeDirect extends Motion {
  constructor({ children }) { super(); this.children = children.map((c) => ({ motion: c.motion ?? new ClipMotion(c.clip, c.timeScale ?? 1), param: c.param })); }
  evaluate(params, out, scale = 1) { for (const c of this.children) { const w = Math.max(0, Math.min(1, params[c.param] ?? 0)); if (w > 1e-4) c.motion.evaluate(params, out, scale * w); } }
  _collect(set) { for (const c of this.children) c.motion._collect(set); }
}

const asMotion = (m) => (m instanceof Motion ? m : new ClipMotion(m));

// ------------------------------------------------------------------------------------------------
// Conditions

const OPS = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };

/** Turns 'speed > 0.1', '!grounded', 'attack' (or a function / {param, op, value}) into a test of the machine. */
export function parseCondition(c) {
  if (typeof c === 'function') return c;
  if (c && typeof c === 'object') {
    const f = OPS[c.op ?? '=='];
    return (sm) => f(sm.params[c.param], c.value);
  }
  const s = String(c).trim();
  const m = /^([A-Za-z_][\w.]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(s);
  if (m) {
    const [, name, op, raw] = m, f = OPS[op];
    const v = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(+raw) ? +raw : raw.replace(/^['"]|['"]$/g, '');
    return (sm) => f(sm.params[name], v);
  }
  if (s.startsWith('!')) { const name = s.slice(1).trim(); return (sm) => !sm._truthy(name); }
  return (sm) => sm._truthy(s);
}

// ------------------------------------------------------------------------------------------------

let _smId = 0;

export class StateMachine {
  /**
   * @param {Animator} animator
   * @param {object} [o]
   * @param {number} [o.layer]  the animator layer this machine drives (default 0)
   * @param {number} [o.triggerLife] seconds a trigger waits for a transition that can use it (input buffer, default 0.25)
   */
  constructor(animator, { layer = 0, triggerLife = 0.25 } = {}) {
    this.animator = animator; this.layerIndex = layer;
    this.id = _smId++;
    this.params = {};
    this.triggerLife = triggerLife;
    this._triggers = new Map();
    /** @type {Map<string, MachineState>} */
    this.states = new Map();
    this.transitions = [];
    /** @type {{state:object, weight:number, fade:object|null, phase:number, loops:number, finished:boolean}[]} */
    this.active = [];
    /** @type {string|null} the state being played */
    this.current = null;
    /** @type {string|null} the state to start in (the first one added unless set) */
    this.entry = null;
    this.speed = 1;
    /** @type {((state: string, machine: StateMachine) => void)|null} fired when a state is entered */
    this.onEnter = null;
    /** @type {((state: string, machine: StateMachine) => void)|null} fired when a state is left */
    this.onExit = null;
    /** @type {((name: string, data: any, action: Action, machine: StateMachine) => void)|null} fired as the playhead of a state's clip passes a clip event */
    this.onEvent = null;
    this._controlled = new Set();
    animator._machines ??= [];
    animator._machines.push(this);
  }

  // --- definition -------------------------------------------------------------------------------

  /**
   * @param {string} name
   * @param {AnimationClip|Motion} motion  a clip or a blend tree
   * @param {object} [o]
   * @param {boolean} [o.loop]       default: the clip's flag (blend trees: true)
   * @param {number}  [o.speed]      playback speed multiplier
   * @param {string}  [o.speedParam] name of a parameter that multiplies the speed (e.g. 'attackSpeed')
   * @param {string}  [o.tag]
   * @returns {MachineState}
   */
  addState(name, motion, { loop, speed = 1, speedParam = null, tag = null } = {}) {
    const m = asMotion(motion);
    const clips = m.clips;
    const s = { name, motion: m, speed, speedParam, tag, loop: loop ?? (m instanceof ClipMotion ? m.clip.loop : true), clips, onEnter: null, onExit: null };
    this.states.set(name, s);
    if (!this.entry) this.entry = name;
    return s;
  }

  /**
   * @param {string} from  state name, or '*' for any state
   * @param {string} to
   * @param {object} [o]
   * @param {string|Function|object|Array} [o.when]  condition(s), all must hold
   * @param {number} [o.duration]   cross-fade seconds (default 0.2)
   * @param {number} [o.exitTime]   normalised time of the source state after which the transition may fire
   * @param {number} [o.offset]     normalised time to start the target at (default 0)
   * @param {boolean} [o.sync]      start the target at the source's phase (walk -> run)
   * @param {number} [o.priority]   higher wins when several transitions are ready (default 0)
   * @param {boolean} [o.interrupt] may fire while another transition is still blending (default true)
   * @param {boolean} [o.self]      an any-state transition may re-enter the state it is already in (default false)
   */
  addTransition(from, to, { when = [], duration = 0.2, exitTime = null, offset = 0, sync = false, priority = 0, interrupt = true, self = false } = {}) {
    const conds = (Array.isArray(when) ? when : [when]).map(parseCondition);
    const raw = Array.isArray(when) ? when : [when];
    const t = { from, to, conds, raw, duration, exitTime, offset, sync, priority, interrupt, self, order: this.transitions.length };
    this.transitions.push(t);
    return t;
  }

  /** Builds the machine from plain data (see docs/ANIMATION.md). `clips` maps names to AnimationClips. */
  static fromDefinition(animator, def, clips, opts = {}) {
    const sm = new StateMachine(animator, { layer: def.layer ?? 0, ...opts });
    const clip = (n) => { const c = clips[n] ?? (clips.get ? clips.get(n) : undefined); if (!c) throw new Error(`StateMachine: unknown clip "${n}"`); return c; };
    const motion = (m) => {
      if (typeof m === 'string') return new ClipMotion(clip(m));
      switch (m.type ?? 'clip') {
        case 'clip': return new ClipMotion(clip(m.clip), m.timeScale ?? 1);
        case '1d': return new BlendTree1D({ param: m.param, children: m.children.map((c) => ({ motion: motion(c.motion ?? c.clip), threshold: c.threshold })) });
        case '2d': return new BlendTree2D({ paramX: m.paramX, paramY: m.paramY, children: m.children.map((c) => ({ motion: motion(c.motion ?? c.clip), x: c.x, y: c.y })) });
        case 'direct': return new BlendTreeDirect({ children: m.children.map((c) => ({ motion: motion(c.motion ?? c.clip), param: c.param })) });
        default: throw new Error(`StateMachine: unknown motion type "${m.type}"`);
      }
    };
    Object.assign(sm.params, def.params ?? {});
    for (const s of def.states) sm.addState(s.name, motion(s.motion), { loop: s.loop, speed: s.speed, speedParam: s.speedParam, tag: s.tag });
    for (const t of def.transitions ?? []) sm.addTransition(t.from, t.to, t);
    if (def.entry) sm.entry = def.entry;
    return sm;
  }

  // --- parameters -------------------------------------------------------------------------------

  set(name, value) { this.params[name] = value; return this; }
  get(name) { return this.params[name]; }
  /** Sets a one-shot flag. It waits `triggerLife` seconds for a transition to use it, then lapses. */
  trigger(name) { this._triggers.set(name, this.triggerLife); return this; }
  resetTrigger(name) { this._triggers.delete(name); return this; }
  _truthy(name) { return this._triggers.has(name) || !!this.params[name]; }

  // --- control ----------------------------------------------------------------------------------

  get state() { return this.current; }
  /** Normalised time (0..1 per cycle) of the current state. */
  get normalizedTime() { const i = this.active.find((a) => a.state.name === this.current); return i ? i.phase : 0; }
  get isTransitioning() { return this.active.length > 1; }
  is(name) { return this.current === name; }
  isTag(tag) { return this.active.some((a) => a.state.tag === tag && a.weight > 0.5); }

  /** Switches to a state now, cross-fading over `duration` seconds. */
  play(name, { duration = 0.2, offset = 0, sync = false } = {}) {
    if (!this.states.has(name)) throw new Error(`StateMachine: no state "${name}"`);
    this._enter(this.states.get(name), duration, offset, sync);
  }

  _enter(state, duration, offset = 0, sync = false) {
    const prev = this.active.find((a) => a.state.name === this.current);
    let inst = this.active.find((a) => a.state === state);
    const phase = sync && prev ? prev.phase : offset;
    if (!inst || inst.weight <= 0.001 || duration <= 0) {
      inst = { state, weight: duration > 0 && this.active.length ? 0 : 1, fade: null, phase, loops: 0, finished: false, started: false };
      this.active = this.active.filter((a) => a.state !== state);
      this.active.push(inst);
    }
    for (const a of this.active) {
      if (a === inst) { if (duration > 0) a.fade = { from: a.weight, to: 1, t: 0, d: duration }; else { a.weight = 1; a.fade = null; } }
      else if (duration > 0) a.fade = { from: a.weight, to: 0, t: 0, d: duration };
      else { a.weight = 0; a.fade = null; }
    }
    if (prev && prev.state !== state) { prev.state.onExit?.(this, prev.state); this.onExit?.(prev.state.name, this); }
    this.current = state.name;
    state.onEnter?.(this, state); this.onEnter?.(state.name, this);
    this._prune();
  }

  _prune() {
    this.active = this.active.filter((a) => a.weight > 0.0005 || (a.fade && a.fade.to > 0) || a.state.name === this.current);
  }

  _ready(t, cur) {
    // source
    if (t.from !== '*') {
      if (!cur || t.from !== cur.state.name) return false;
    } else if (cur && t.to === cur.state.name && !t.self) return false;
    if (t.to === this.current && t.from !== '*' && !t.self) return false;
    if (!this.states.has(t.to)) return false;
    if (cur && !t.interrupt && this.isTransitioning) return false;
    if (t.exitTime !== null && cur) {
      const passed = cur.phase >= t.exitTime || cur.loops > 0;
      if (!passed) return false;
    }
    for (const c of t.conds) if (!c(this)) return false;
    return true;
  }

  /** One animator action per (state, clip): a clip used by two states keeps two independent playheads. */
  _action(clip, state) {
    let m = state._actions;
    if (!m) m = state._actions = new Map();
    let a = m.get(clip);
    if (!a) { a = this.animator.action(clip, this.layerIndex, `sm${this.id}:${state.name}`); m.set(clip, a); }
    return a;
  }

  // --- update -----------------------------------------------------------------------------------

  /** Runs transitions, advances the states and writes the actions' weights. Called by Animator.update(). */
  update(dt) {
    dt *= this.speed;
    if (!this.current && this.entry) this._enter(this.states.get(this.entry), 0);
    if (!this.current) return;
    // triggers expire
    for (const [k, life] of this._triggers) { const l = life - dt; if (l <= 0) this._triggers.delete(k); else this._triggers.set(k, l); }
    // transitions: the highest priority ready one wins; first defined breaks ties
    const cur = this.active.find((a) => a.state.name === this.current);
    let best = null;
    for (const t of this.transitions) {
      if (!this._ready(t, cur)) continue;
      if (!best || t.priority > best.priority) best = t;
    }
    if (best) {
      for (const c of best.raw) if (typeof c === 'string' && this._triggers.has(c.trim())) this._triggers.delete(c.trim());
      this._enter(this.states.get(best.to), best.duration, best.offset, best.sync);
    }
    // fades
    for (const a of this.active) if (a.fade) {
      const f = a.fade; f.t += dt;
      const k = f.t >= f.d ? 1 : (() => { const x = f.t / f.d; return x * x * (3 - 2 * x); })();
      a.weight = f.from + (f.to - f.from) * k;
      if (f.t >= f.d) { a.weight = f.to; a.fade = null; }
    }
    this._prune();
    // normalise weights over the active states
    let sum = 0;
    for (const a of this.active) sum += a.weight;
    if (sum <= 0) sum = 1;
    // zero what we controlled last frame, then set this frame's mix
    const an = this.animator;
    for (const act of this._controlled) act.weight = 0;
    this._controlled.clear();
    for (const inst of this.active) {
      const st = inst.state, w = inst.weight / sum;
      const dur = Math.max(1e-3, st.motion.duration(this.params));
      const spd = st.speed * (st.speedParam ? (this.params[st.speedParam] ?? 1) : 1);
      const dPhase = (dt * spd) / dur;
      const mix = [];
      st.motion.evaluate(this.params, mix, 1);
      // merge duplicates of one clip inside a state
      const by = new Map();
      for (const m of mix) { const e = by.get(m.clip); if (e) e.weight += m.weight; else by.set(m.clip, { ...m }); }
      const first = !inst.started;
      for (const m of by.values()) {
        const act = this._action(m.clip, st);
        act.loop = st.loop;
        act.speed = 1;
        if (first) { act.time = inst.phase * m.clip.duration; act._prev = act.time; act._started = false; act.finished = false; act.loops = 0; }
        act.weight = (this._controlled.has(act) ? act.weight : 0) + w * m.weight;
        this._controlled.add(act);
      }
      inst.started = true;
      // advance the phase (non-looping states stop at the end)
      let ph = inst.phase + dPhase;
      if (st.loop) { if (ph >= 1) { inst.loops += Math.floor(ph); ph -= Math.floor(ph); } else if (ph < 0) { inst.loops += 1; ph -= Math.floor(ph); } }
      else if (ph >= 1) { ph = 1; inst.finished = true; }
      else if (ph < 0) { ph = 0; inst.finished = true; }
      inst.phase = ph;
      // move the actions (events, root motion at the weights just set)
      for (const m of by.values()) {
        const act = this._action(m.clip, st);
        const dtClip = dPhase * m.clip.duration;
        if (act.onEvent !== this._evt) act.onEvent = this._evt ??= ((name, data, a) => this.onEvent?.(name, data, a, this));
        an.step(act, dtClip);
        // keep the action in step with the state's phase exactly (floating point drift, clamping)
        act.time = st.loop ? ph * m.clip.duration : Math.min(m.clip.duration, ph * m.clip.duration);
      }
    }
  }
}
