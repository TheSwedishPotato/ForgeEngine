/**
 * The story runner: a branching, data-driven interactive story with choices, timers, quick-time events, negotiations with a
 * meter, free exploration, a flowchart of where you have been, and save / load.
 *
 *   const story = StoryRunner.from(await assets.json('story/ford.story.json'), { seed: 7 });
 *   story.on('enter', (view) => ui.show(view));
 *   story.start();
 *   ui.onChoice((i) => story.choose(i));          // view.choices[i]
 *   engine.add({ update: (dt) => story.update(dt) });   // timers and QTE windows tick in game time (or use StorySystem)
 *
 * The story itself is plain JSON (see docs/STORY.md for the full format and `assets/story/ford.story.json` for an example):
 *
 *   node types   scene (text + choices), timed (a scene that picks for you when the clock runs out), qte (a key sequence or button
 *                mash against the clock), negotiation (options move a meter toward a win or a lose line), explore (a place with
 *                things to look at and ways out), branch (conditions, no text), random (weighted), end (an ending)
 *   conditions   expressions: "gold >= 5 and not has('key')"           (see Expr.js: safe, no eval)
 *   effects      statements:  "gold -= 5", "met_king = true", "give key"
 *   text         "plain {gold} gold" with {expressions}, an array of lines, lines with a speaker, lines with an `if`
 *
 * Everything the runner does is deterministic for a given seed and sequence of inputs (the random numbers come from a seeded
 * generator stored in the save), so playthroughs can be recorded, replayed and fuzzed (see fuzz.js).
 */
import { compileExpr, compileStatement } from './Expr.js';
import { normalizeStory, storyGraph } from './Story.js';

/** @import { StoryData, NormalizedStory, Flowchart } from './Story.js' */

/**
 * One line of text a node shows.
 * @typedef {object} StoryLine
 * @property {string | null} speaker
 * @property {string} text
 */

/**
 * One button the UI draws. Pick it with `runner.choose(choice.index)`.
 * @typedef {object} StoryChoice
 * @property {number} index
 * @property {string} text
 * @property {boolean} enabled        false when it is shown greyed out (its condition does not hold)
 * @property {string | null} hint     why it is disabled
 * @property {boolean} [implicit]     the automatic "continue" button of a scene that only has a `goto`
 */

/**
 * The clock of a timed node.
 * @typedef {{ total: number, left: number }} StoryTimerView
 */

/**
 * A quick-time event: pressing one key `need` times against the clock (mash), or a sequence of keys, each within a window.
 * @typedef {{ mode: 'mash', key: string, count: number, need: number, total: number, left: number }
 *   | { mode: 'sequence', keys: string[], index: number, window: number, left: number, misses: number, allowMisses: number }} StoryQteView
 */

/**
 * The meter of a negotiation.
 * @typedef {object} StoryMeterView
 * @property {string} name
 * @property {number} value
 * @property {number} min
 * @property {number} max
 * @property {number} win     reaching this wins
 * @property {number} lose    reaching this loses
 * @property {number} round   rounds played
 * @property {number} rounds  rounds there are
 */

/**
 * What a UI draws for the current node: text, choices and whatever the node type adds. `runner.view` is the latest one.
 * @typedef {object} StoryView
 * @property {string} id
 * @property {string} type          'scene', 'timed', 'qte', 'negotiation', 'explore' or 'end'
 * @property {string | null} title
 * @property {StoryLine[]} lines
 * @property {StoryChoice[]} choices
 * @property {string | null} message   a note from what just happened (a check's result, a reply)
 * @property {StoryTimerView | null} timer   timed nodes
 * @property {StoryQteView | null} qte       quick-time events
 * @property {StoryMeterView | null} meter   negotiations
 * @property {{ ending: string } | null} ended   end nodes
 */

/**
 * What each story event carries. A listener gets the data and the runner.
 * @typedef {object} StoryEventMap
 * @property {StoryView} enter     a node was entered
 * @property {StoryView} update    the view changed without leaving the node (a timer, a quick-time step, a negotiation round)
 * @property {{ node: string, index: number, id: string, text: string }} choice  a choice was picked
 * @property {{ name: string, from: number, to: number, round: number, risky: boolean }} meter  a negotiation option moved the meter
 * @property {{ hit: boolean, count?: number, key?: string, index?: number }} qte  a key was pressed in a quick-time event
 * @property {{ node: string }} timeout  a timed node ran out
 * @property {{ ending: string, node: string }} end  the story reached an ending
 */

/**
 * A saved game: plain JSON, keep it anywhere (localStorage, a file, a cloud save).
 * @typedef {object} StorySave
 * @property {1} v           format version
 * @property {string} title
 * @property {string | null} node
 * @property {Record<string, any>} vars
 * @property {[string, number][]} items
 * @property {Record<string, number>} visits
 * @property {string[]} used
 * @property {string[]} taken
 * @property {string[]} history
 * @property {number} time
 * @property {number} seed
 * @property {number} rng             the state of the random number generator
 * @property {Record<string, any> | null} timer
 * @property {Record<string, any> | null} qte
 * @property {Record<string, any> | null} neg
 * @property {string | null} message
 * @property {{ endings: string[] }} meta
 * @property {{ ending: string, node: string } | null} ended
 * @property {{ node: string | null, speaker?: string | null, text: string, note?: boolean }[]} transcript
 */

const norm = (k) => String(k).toLowerCase().replace(/^(key|digit|numpad)/, '');
const MAX_HOPS = 64;

/** mulberry32: a small seeded generator whose whole state is one integer (so saves can hold it). */
class Rng {
  constructor(seed) { this.s = seed | 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export class StoryRunner {
  /**
   * Normalises and validates `data`; throws with every problem listed when the story is broken.
   * @param {StoryData | string} data  the story, or its JSON text
   * @param {{ seed?: number, functions?: Record<string, Function> }} [opts]
   * @returns {StoryRunner}
   */
  static from(data, opts = {}) {
    const story = normalizeStory(data);
    return new StoryRunner(story, opts);
  }

  /**
   * @param {NormalizedStory} story   a normalised story (use StoryRunner.from for raw JSON)
   * @param {object} [o]
   * @param {number} [o.seed]        random seed (default 1)
   * @param {Record<string,Function>} [o.functions]  extra expression functions: (env, ...args) => value
   */
  constructor(story, { seed = 1, functions = {} } = {}) {
    this.story = story;
    this.seed = seed >>> 0;
    this.functions = functions;
    this.listeners = new Map();
    /** Stops timers and QTE windows (a pause menu). */
    this.paused = false;
    /** Endings reached in earlier runs (kept by reset(), written to saves): `ended('name')` in expressions. */
    this.meta = { endings: new Set() };
    this._env = null;
    this.reset();
  }

  // ---------------------------------------------------------------------------------------------- state
  /**
   * Back to the start state (variables, items, history). Endings seen are kept unless `forgetEndings`.
   * @param {boolean} [forgetEndings]
   * @returns {this}
   */
  reset(forgetEndings = false) {
    if (forgetEndings) this.meta.endings.clear();
    const s = this.story;
    /** @type {Record<string, any>} the story's variables */
    this.vars = { ...s.vars };
    /** @type {Map<string, number>} what the player holds, and how many */
    this.items = new Map(Object.entries(s.items));
    /** @type {Record<string, number>} how often each node was entered */
    this.visits = {};
    /** @type {Set<string>} choices marked `once` that were taken */
    this.used = new Set();
    /** @type {Set<string>} the `from>to` links that were followed */
    this.taken = new Set();
    /** @type {string[]} the nodes entered, in order */
    this.history = [];
    /** @type {{ node: string | null, speaker?: string | null, text: string, note?: boolean }[]} the text shown so far (the latest 300 lines) */
    this.transcript = [];
    /** Seconds of game time since start. */
    this.time = 0;
    /** @type {string | null} the id of the node being shown */
    this.node = null;
    /** @type {{ ending: string, node: string } | null} set when an end node was reached */
    this.ended = null;
    /** @type {StoryView | null} what the UI should draw now */
    this.view = null;
    /** @type {string | null} */
    this.message = null;
    this._rng = new Rng(this.seed);
    this._timer = null; this._qte = null; this._neg = null;
    this._visible = [];
    this._env = {
      vars: this.vars, items: this.items, visits: this.visits, used: this.used,
      rng: () => this._rng.next(),
      fns: { ended: (e, name) => this.meta.endings.has(String(name)), ...this.functions },
    };
    return this;
  }

  /**
   * Seeds the generator again (for a fresh playthrough with other dice).
   * @param {number} seed
   * @returns {this}
   */
  reseed(seed) { this.seed = seed >>> 0; this._rng = new Rng(this.seed); return this; }

  get env() { return this._env; }

  /**
   * Listens to a story event; returns a function that stops listening.
   * @template {keyof StoryEventMap} K
   * @param {K} type
   * @param {(data: StoryEventMap[K], runner: StoryRunner) => void} fn
   * @returns {() => void}
   */
  on(type, fn) {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(fn);
    return () => s.delete(fn);
  }
  _emit(type, data) { const s = this.listeners.get(type); if (s) for (const f of s) f(data, this); }

  /**
   * Evaluates a condition against the current state.
   * @param {string} expr
   * @returns {boolean}
   */
  test(expr) { return !!compileExpr(expr).run(this._env); }
  /**
   * Evaluates an expression to a value.
   * @param {string} expr
   * @returns {any}
   */
  value(expr) { return compileExpr(expr).run(this._env); }
  /**
   * Runs effect statements.
   * @param {string[] | undefined} statements
   */
  run(statements) { for (const s of statements ?? []) compileStatement(s).run(this._env); }

  // ---------------------------------------------------------------------------------------------- flow
  /**
   * Begins the story at `story.start` (or `node`).
   * @param {string} [node]
   * @returns {StoryView}
   */
  start(node = this.story.start) {
    this.reset();
    this._enter(node);
    return this.view;
  }

  _def(id) {
    const n = this.story.nodes[id];
    if (!n) throw new Error(`story: no node '${id}'`);
    return n;
  }

  _enter(id) {
    let hops = 0;
    for (;;) {
      if (++hops > MAX_HOPS) throw new Error(`story: more than ${MAX_HOPS} automatic nodes in a row at '${id}' (a loop of branch / random nodes?)`);
      const n = this._def(id);
      if (this.node !== null) this.taken.add(`${this.node}>${id}`);
      this.node = id;
      this.visits[id] = (this.visits[id] ?? 0) + 1;
      this.history.push(id);
      this._timer = this._qte = this._neg = null;
      this.run(n.on);
      if (n.type === 'branch') {
        const hit = n.cases.find((c) => c.if === undefined || this.test(c.if));
        const to = hit ? hit.goto : n.else;
        if (hit) this.run(hit.do);
        if (to === undefined) throw new Error(`story: branch '${id}' matched nothing and has no 'else'`);
        id = to;
        continue;
      }
      if (n.type === 'random') {
        const opts = n.options.filter((o) => o.if === undefined || this.test(o.if));
        if (!opts.length) throw new Error(`story: random node '${id}' has no option whose condition holds`);
        let r = this._rng.next() * opts.reduce((s, o) => s + (o.weight ?? 1), 0);
        let pick = opts[opts.length - 1];
        for (const o of opts) { r -= o.weight ?? 1; if (r < 0) { pick = o; break; } }
        this.run(pick.do);
        id = pick.goto;
        continue;
      }
      this._setup(n);
      this._present(n);
      this._emit('enter', this.view);
      if (n.type === 'end') {
        this.ended = { ending: n.ending, node: id };
        this.meta.endings.add(n.ending);
        this._emit('end', this.ended);
      }
      return this.view;
    }
  }

  /** Per-type state that exists while a node is active. */
  _setup(n) {
    switch (n.type) {
      case 'timed': this._timer = { total: n.seconds, left: n.seconds }; break;
      case 'qte':
        if (n.mash) this._qte = { mode: 'mash', count: 0, need: n.mash.count, key: n.mash.key, total: n.mash.seconds, left: n.mash.seconds, misses: 0 };
        else this._qte = { mode: 'sequence', index: 0, window: n.window, left: n.window, misses: 0, allow: n.allowMisses };
        break;
      case 'negotiation': {
        const m = n.meter;
        if (!(m.name in this.vars) || m.reset !== false || (this.visits[this.node] ?? 0) <= 1) this.vars[m.name] = m.start;
        this._neg = { round: 0 };
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------------------------------------- presenting
  _fill(text) {
    return text.replace(/\{\{|\}\}|\{([^{}]+)\}/g, (m, expr) => {
      if (m === '{{') return '{';
      if (m === '}}') return '}';
      let v;
      try { v = compileExpr(expr).run(this._env); } catch { return m; }
      return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    });
  }

  _lines(def, defaultSpeaker) {
    const out = [];
    for (const l of def === undefined ? [] : Array.isArray(def) ? def : [def]) {
      if (typeof l === 'string') out.push({ speaker: defaultSpeaker ?? null, text: this._fill(l) });
      else if (l && (l.if === undefined || this.test(l.if))) out.push({ speaker: l.speaker ?? defaultSpeaker ?? null, text: this._fill(l.text ?? '') });
    }
    return out;
  }

  /** Turns the node + state into the view a UI draws. */
  _present(n) {
    const lines = this._lines(n.text, n.speaker);
    const v = { id: this.node, type: n.type, title: n.title ?? null, lines, choices: [], message: this.message, timer: null, qte: null, meter: null, ended: null };
    this.message = null;
    this._visible = [];
    const addChoice = (c, text, extra = {}) => {
      const id = c.id ?? `${this.node}#${c.__i}`;
      if (c.once && this.used.has(id)) return;
      const ok = c.if === undefined || this.test(c.if);
      if (!ok && c.show !== 'disabled') return;
      const shown = { index: this._visible.length, text: this._fill(text), enabled: ok, hint: ok ? null : (c.hint ? this._fill(c.hint) : null), ...extra };
      this._visible.push({ def: c, id });
      v.choices.push(shown);
    };
    switch (n.type) {
      case 'scene': case 'timed':
        if (n.choices.length) for (const c of n.choices) addChoice(c, c.text);
        else if (n.goto !== undefined) addChoice({ goto: n.goto, __i: 0 }, this.story.continueText, { implicit: true });
        if (n.type === 'timed') v.timer = { total: this._timer.total, left: this._timer.left };
        break;
      case 'explore':
        for (const c of n.spots) addChoice(c, c.text);
        break;
      case 'negotiation': {
        for (const c of n.options) addChoice(c, c.text);
        const m = n.meter;
        v.meter = { name: m.name, value: this.vars[m.name], min: m.min, max: m.max, win: n.win, lose: n.lose, round: this._neg.round, rounds: n.rounds };
        break;
      }
      case 'qte': v.qte = this._qteView(n); break;
      case 'end': v.ended = { ending: n.ending }; break;
      default: break;
    }
    this.view = v;
    for (const l of lines) this.transcript.push({ node: this.node, ...l });
    if (this.transcript.length > 300) this.transcript.splice(0, this.transcript.length - 300);
    return v;
  }

  _qteView(n) {
    const q = this._qte;
    return q.mode === 'mash'
      ? { mode: 'mash', key: q.key, count: q.count, need: q.need, total: q.total, left: q.left }
      : { mode: 'sequence', keys: n.keys.slice(), index: q.index, window: q.window, left: q.left, misses: q.misses, allowMisses: q.allow };
  }

  /** Re-renders the current view after a state change that does not leave the node. */
  _refresh() {
    const n = this._def(this.node);
    const keep = this.transcript.length;
    this._present(n);
    this.transcript.length = keep;                         // a refresh is not new text
    this._emit('update', this.view);
  }

  // ---------------------------------------------------------------------------------------------- input
  /**
   * Picks `view.choices[i]` (a scene choice, an explore spot or a negotiation option). Returns the new view.
   * @param {number} i
   * @returns {StoryView}
   */
  choose(i) {
    if (this.node === null) throw new Error('story: not started (call start() or load())');
    if (this.ended) throw new Error('story: it is over (call start() or load())');
    const n = this._def(this.node);
    if (n.type === 'qte') throw new Error('story: this is a quick-time event: use input(key)');
    const vis = this._visible[i];
    if (!vis) throw new Error(`story: no choice ${i} (have ${this._visible.length})`);
    const shown = this.view.choices[i];
    if (!shown.enabled) throw new Error(`story: choice ${i} is not available${shown.hint ? ` (${shown.hint})` : ''}`);
    const c = vis.def;
    if (c.once) this.used.add(vis.id);
    this._emit('choice', { node: this.node, index: i, id: vis.id, text: shown.text });
    if (n.type === 'negotiation') return this._negotiate(n, c);
    this.run(c.do);
    let to = c.goto;
    if (c.check !== undefined) {
      const ok = this.test(c.check);
      to = ok ? (c.success ?? c.goto) : (c.fail ?? c.goto);
      this._note(ok ? c.passText : c.failText);
    }
    if (c.say !== undefined) this._note(c.say);
    if (to === undefined) {                                // stays here (explore spot / a check with no target)
      this._refresh();
      return this.view;
    }
    return this._enter(to);
  }

  _note(text) {
    if (text === undefined || text === null) return;
    const t = this._fill(text);
    this.message = this.message ? `${this.message} ${t}` : t;
    this.transcript.push({ node: this.node, speaker: null, text: t, note: true });
  }

  _negotiate(n, o) {
    const m = n.meter;
    let d = o.delta ?? 0, risky = false;
    if (o.risk !== undefined && this._rng.next() < o.risk) { d = o.riskDelta ?? -Math.abs(d); risky = true; }
    const before = this.vars[m.name];
    this.vars[m.name] = Math.min(m.max, Math.max(m.min, before + d));
    this.run(o.do);
    this._neg.round++;
    this._note(risky ? (o.failText ?? o.reply) : o.reply);
    this._emit('meter', { name: m.name, from: before, to: this.vars[m.name], round: this._neg.round, risky });
    const v = this.vars[m.name];
    if (v >= n.win) return this._enter(n.onWin);
    if (v <= n.lose) return this._enter(n.onLose);
    if (this._neg.round >= n.rounds) return this._enter(n.onTimeout ?? (v >= (n.win + n.lose) / 2 ? n.onWin : n.onLose));
    this._refresh();
    return this.view;
  }

  /**
   * A key for a quick-time event. Names are compared loosely: 'KeyA', 'a' and 'A' are the same key. Returns whether it was the key asked for.
   * @param {string} code
   * @returns {boolean}
   */
  input(code) {
    if (this.node === null || this.ended) return false;
    const n = this._def(this.node);
    if (n.type !== 'qte') return false;
    const q = this._qte;
    if (q.mode === 'mash') {
      if (norm(code) !== norm(q.key)) return false;
      q.count++;
      this._emit('qte', { hit: true, count: q.count });
      if (q.count >= q.need) this._enter(n.success); else this._refresh();
      return true;
    }
    const want = n.keys[q.index], ok = norm(code) === norm(want);
    this._emit('qte', { hit: ok, key: code, index: q.index });
    if (ok) {
      q.index++; q.left = q.window;
      if (q.index >= n.keys.length) this._enter(n.success); else this._refresh();
    } else this._miss(n);
    return ok;
  }

  _miss(n) {
    const q = this._qte;
    q.misses++; q.left = q.window ?? q.left;
    if (q.mode === 'sequence' && q.misses > q.allow) this._enter(n.fail); else this._refresh();
  }

  /**
   * Advances the clock: timers, QTE windows.
   * @param {number} dt  seconds of game time
   */
  update(dt) {
    if (this.paused || this.ended || this.node === null) return;
    this.time += dt;
    const n = this._def(this.node);
    if (n.type === 'timed' && this._timer) {
      this._timer.left -= dt;
      if (this._timer.left <= 0) { this._timeout(n); return; }
      this.view.timer.left = this._timer.left;
    } else if (n.type === 'qte' && this._qte) {
      const q = this._qte;
      q.left -= dt;
      if (q.mode === 'mash') { if (q.left <= 0) { this._enter(n.fail); return; } }
      else {
        // every window that runs out is a miss; a long frame can run out several
        let guard = 0;
        while (q.left <= 0 && guard++ < 16) {
          const over = -q.left;
          this._miss(n);
          if (this.node !== n.id) return;
          q.left = q.window - over;
        }
        if (q.left <= 0) q.left = 1e-3;
      }
      this.view.qte = this._qteView(n);
    }
  }

  _timeout(n) {
    this._emit('timeout', { node: this.node });
    const t = n.timeout;
    if (typeof t === 'number') {
      const c = this._visible[t];
      if (c && this.view.choices[t].enabled) { this.choose(t); return; }
      const first = this.view.choices.findIndex((x) => x.enabled);
      if (first >= 0) { this.choose(first); return; }
    }
    this._enter(typeof t === 'string' ? t : n.fail);
  }

  /** The nodes visited so far, in order. */
  get path() { return this.history.slice(); }

  // ---------------------------------------------------------------------------------------------- flowchart
  /**
   * The story graph with what has been visited: `{ nodes: [{id, type, label, visits, current}], edges: [{from, to, label, taken}] }`.
   * @returns {Flowchart}
   */
  flowchart() {
    const g = storyGraph(this.story);
    return {
      nodes: g.nodes.map((n) => ({ ...n, visits: this.visits[n.id] ?? 0, current: n.id === this.node })),
      edges: g.edges.map((e) => ({ ...e, taken: this.taken.has(`${e.from}>${e.to}`) })),
    };
  }

  // ---------------------------------------------------------------------------------------------- saves
  /**
   * A plain JSON-able object. Keep it anywhere (localStorage, a file, a cloud save).
   * @returns {StorySave}
   */
  save() {
    return {
      v: 1, title: this.story.title, node: this.node, vars: { ...this.vars }, items: [...this.items], visits: { ...this.visits },
      used: [...this.used], taken: [...this.taken], history: this.history.slice(-400), time: this.time,
      seed: this.seed, rng: this._rng.s,
      timer: this._timer && { ...this._timer }, qte: this._qte && { ...this._qte }, neg: this._neg && { ...this._neg },
      message: this.view?.message ?? null, meta: { endings: [...this.meta.endings] }, ended: this.ended && { ...this.ended },
      transcript: this.transcript.slice(-60),
    };
  }

  /**
   * Restores a save() object. Throws when it belongs to another story.
   * @param {StorySave} data
   * @returns {StoryView | null}  the view, or null when the save was made before start()
   */
  load(data) {
    if (!data || data.v !== 1) throw new Error('story: unknown save format');
    if (data.title !== this.story.title) throw new Error(`story: this save is from "${data.title}", not "${this.story.title}"`);
    if (data.node !== null && !this.story.nodes[data.node]) throw new Error(`story: the save refers to a node that no longer exists ('${data.node}')`);
    this.reset();
    Object.assign(this.vars, data.vars);
    this.items.clear(); for (const [k, n] of data.items) this.items.set(k, n);
    Object.assign(this.visits, data.visits);
    this.used = this._env.used = new Set(data.used);
    this.taken = new Set(data.taken ?? []);
    this.history = data.history.slice();
    this.time = data.time;
    this.seed = data.seed >>> 0;
    this._rng = new Rng(data.rng);
    this._timer = data.timer ?? null; this._qte = data.qte ?? null; this._neg = data.neg ?? null;
    this.meta.endings = new Set(data.meta?.endings ?? []);
    this.transcript = (data.transcript ?? []).slice();
    this.node = data.node;
    this.ended = data.ended ?? null;
    if (this.node === null) return null;                    // saved before start(): only the endings seen carry over
    const keep = this.transcript.length;
    this._present(this._def(this.node));
    this.transcript.length = keep;
    this.view.message = data.message ?? null;
    this._emit('enter', this.view);
    return this.view;
  }
}
