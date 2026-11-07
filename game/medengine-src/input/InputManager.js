/**
 * Input: keyboard, mouse / touch and gamepads behind named actions the player can rebind.
 *
 *   const input = new InputManager(platform);
 *   input.map({
 *     jump:   ['Space', 'Pad:a'],                                                  // a button: any of these
 *     attack: { type: 'button', bindings: ['Mouse0', 'Pad:rt'] },
 *     save:   ['Ctrl+KeyS'],                                                       // chords use '+'
 *     move:   { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], stick: 'Pad:ls' },
 *     look:   { type: 'look', mouse: 'locked', sensitivity: 0.0022, stick: 'Pad:rs', stickSpeed: 2.8 },
 *     zoom:   { type: 'axis', positive: ['KeyE'], negative: ['KeyQ'], wheel: true },
 *   });
 *
 *   // once per rendered frame (the Engine does this for you):
 *   input.advance(dt);
 *   if (input.pressed('jump')) character.jump();       // in update() or in fixedUpdate(): each sees a press once
 *   const { x, y } = input.vec2('move');      // x: right is +, y: forward is +, length <= 1
 *   const look = input.look('look');          // radians this step: x right is +, y up is +
 *
 * Binding names
 *   keyboard   `KeyboardEvent.code`: 'KeyW', 'Space', 'ArrowUp', 'ShiftLeft', 'Digit1' ...; 'Shift' 'Ctrl' 'Alt' 'Meta'
 *              mean either side
 *   mouse      'Mouse0' (left) 'Mouse1' (middle) 'Mouse2' (right) 'Mouse3' 'Mouse4', 'WheelUp', 'WheelDown'
 *   gamepad    'Pad:a' 'Pad:b' 'Pad:x' 'Pad:y' 'Pad:lb' 'Pad:rb' 'Pad:lt' 'Pad:rt' 'Pad:back' 'Pad:start' 'Pad:l3' 'Pad:r3'
 *              'Pad:up' 'Pad:down' 'Pad:left' 'Pad:right' (the d-pad) 'Pad:home'; stick directions as buttons
 *              'Pad:lx+' 'Pad:lx-' 'Pad:ly+' 'Pad:ly-' (and 'r' for the right stick); a whole axis 'Pad:lx' (for `axis`
 *              actions). Whole sticks are written `stick: 'Pad:ls'` / `'Pad:rs'` in vec2 and look actions.
 *              'Pad1:a' only listens to controller number 1 (default: any controller).
 *   chords     'Ctrl+KeyS', 'Shift+Mouse0' - every part must be down. A chord does not mute its plain key.
 *
 * Timing: events that arrive between two `advance()` calls are never lost; the next advance reports them. A key pressed and
 * released within one advance is still seen as one press (and its release the next time).
 *
 * Two cadences: a game draws at the display's rate and simulates at a fixed one (60 Hz), so a one-frame "pressed" flag
 * would be missed by the simulation on frames without a fixed step, or seen twice on frames with two. Like Godot, the
 * manager keeps a second, latched view of every edge and look delta for fixed steps: the Engine brackets each fixed
 * step with beginFixed() / endFixed(), and inside it `pressed()`, `released()`, `look()`, `keyPressed()`,
 * `mousePressed()` ... report what happened since the previous fixed step - exactly once. Levels (`down`, `vec2`,
 * `value`, `axis`) are the same in both.
 */

export const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
const PAD_AXES = { lx: 0, ly: 1, rx: 2, ry: 3 };
const MODS = { Shift: ['ShiftLeft', 'ShiftRight'], Ctrl: ['ControlLeft', 'ControlRight'], Control: ['ControlLeft', 'ControlRight'], Alt: ['AltLeft', 'AltRight'], Meta: ['MetaLeft', 'MetaRight'] };
const PRESS = 0.5;                      // analog value at which a button counts as held
const CAPTURE_AXIS = 0.6;               // stick push that rebinding accepts
const PERSIST_KEYS = ['bindings', 'positive', 'negative', 'up', 'down', 'left', 'right', 'stick', 'mouse', 'sensitivity', 'stickSpeed', 'invertY', 'wheel'];
const SPLIT = /\+(?=[A-Za-z])/;         // a '+' that joins chord parts (a trailing '+' is a stick direction)

/**
 * Radial dead zone with rescaling, so the stick reads 0 at the edge of the zone and 1 at full deflection.
 * @param {number} x  stick x, -1..1
 * @param {number} y  stick y, -1..1
 * @param {number} dz  the dead zone, 0..1
 * @param {Vec2Value} [out]
 * @returns {Vec2Value}
 */
export function radialDeadzone(x, y, dz, out = { x: 0, y: 0 }) {
  const m = Math.hypot(x, y);
  if (m <= dz) { out.x = 0; out.y = 0; return out; }
  const s = (Math.min(m, 1) - dz) / (1 - dz) / m;
  out.x = x * s; out.y = y * s;
  return out;
}

function parsePart(str) {
  if (MODS[str]) return { kind: 'key', codes: MODS[str] };
  let m;
  if ((m = /^Mouse(\d)$/.exec(str))) return { kind: 'mouse', n: +m[1] };
  if (str === 'WheelUp' || str === 'WheelDown') return { kind: 'wheel', dir: str === 'WheelUp' ? 1 : -1 };
  if ((m = /^Pad(\d*):(.+)$/.exec(str))) {
    const pad = m[1] === '' ? -1 : +m[1], name = m[2];
    let a;
    if ((a = /^([lr][xy])([+-])$/.exec(name))) return { kind: 'padaxis', pad, axis: PAD_AXES[a[1]], sign: a[2] === '+' ? 1 : -1 };
    if ((a = /^([lr][xy])$/.exec(name))) return { kind: 'padaxis', pad, axis: PAD_AXES[a[1]], sign: 0 };
    if (name === 'ls' || name === 'rs') return { kind: 'padstick', pad, stick: name === 'ls' ? 0 : 2 };
    const bi = PAD_BUTTONS.indexOf(name);
    if (bi >= 0) return { kind: 'padbutton', pad, index: bi };
    throw new Error(`Unknown gamepad control '${str}'`);
  }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(str)) throw new Error(`Bad input binding '${str}'`);
  return { kind: 'key', codes: [str] };
}

function parseBinding(src) {
  if (typeof src !== 'string' || !src) throw new Error(`Bad input binding '${src}'`);
  const parts = src.split(SPLIT).map(parsePart);
  return { src, parts, wheel: parts.some((p) => p.kind === 'wheel') };
}

const KEY_LABELS = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Del',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta',
  Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', CapsLock: 'Caps', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins',
};
const PAD_LABELS = { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', back: 'Back', start: 'Start', l3: 'L3', r3: 'R3', up: 'D-pad ↑', down: 'D-pad ↓', left: 'D-pad ←', right: 'D-pad →', home: 'Home' };

function labelPart(s) {
  let m;
  if (KEY_LABELS[s]) return KEY_LABELS[s];
  if ((m = /^Key([A-Z])$/.exec(s))) return m[1];
  if ((m = /^Digit(\d)$/.exec(s))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(s))) return `Num ${m[1]}`;
  if ((m = /^Mouse(\d)$/.exec(s))) return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][+m[1]] ?? s;
  if (s === 'WheelUp') return 'Wheel ↑';
  if (s === 'WheelDown') return 'Wheel ↓';
  if ((m = /^Pad\d*:(.+)$/.exec(s))) {
    const n = m[1];
    if (PAD_LABELS[n]) return PAD_LABELS[n];
    if (n === 'ls' || n === 'rs') return `${n === 'ls' ? 'Left' : 'Right'} Stick`;
    const ax = /^([lr])([xy])([+-]?)$/.exec(n);
    if (ax) {
      const arrow = ax[2] === 'x' ? (ax[3] === '+' ? '→' : ax[3] === '-' ? '←' : '↔') : (ax[3] === '+' ? '↓' : ax[3] === '-' ? '↑' : '↕');
      return `${ax[1] === 'l' ? 'Left' : 'Right'} Stick ${arrow}`;
    }
  }
  return s;
}

/**
 * A readable name for a binding string, for prompts and settings screens: 'Ctrl+KeyS' -> 'Ctrl + S'.
 * @param {string} binding
 * @returns {string}
 */
export function bindingLabel(binding) { return binding.split(SPLIT).map(labelPart).join(' + '); }

/**
 * What `new InputManager()` takes (and Engine's `input` option).
 * @typedef {object} InputOptions
 * @property {number} [deadzone]      stick dead zone, 0..1 (0.18)
 * @property {boolean} [lockOnClick]  capture the pointer when the canvas is clicked, for mouse-look (false)
 */

/** @import { Platform, PlatformGamepad } from '../platform/Platform.js' */

/**
 * A button: held or not (a key, a mouse button, a pad button, or a chord such as 'Ctrl+KeyS'). `type` may be left out.
 * @typedef {object} ButtonAction
 * @property {'button'} [type]
 * @property {string[]} bindings  any of these presses it
 * @property {string} [context]   the group of actions it belongs to (default: the context given to `map`)
 */

/**
 * A number from -1 to 1 made of two sets of buttons, a pad axis or a stick direction, and optionally the mouse wheel.
 * @typedef {object} AxisAction
 * @property {'axis'} type
 * @property {string[]} [positive]
 * @property {string[]} [negative]
 * @property {string} [stick]    a whole pad axis: 'Pad:lx', 'Pad:ly', 'Pad:rx' or 'Pad:ry'
 * @property {boolean} [wheel]   the mouse wheel adds to it
 * @property {string} [context]
 */

/**
 * A movement vector (x right, y forward, length at most 1) from four sets of buttons and/or a stick.
 * @typedef {object} Vec2Action
 * @property {'vec2'} type
 * @property {string[]} [up]
 * @property {string[]} [down]
 * @property {string[]} [left]
 * @property {string[]} [right]
 * @property {string} [stick]    'Pad:ls' or 'Pad:rs'
 * @property {string} [context]
 */

/**
 * The change of view each step, in radians (x right, y up), from the mouse and/or a stick.
 * @typedef {object} LookAction
 * @property {'look'} type
 * @property {'locked' | 'always' | 'drag' | false} [mouse]  when the mouse turns the view: only while the pointer is locked, always, or only while a button is dragged
 * @property {number} [sensitivity]  radians per pixel of mouse movement (0.0022)
 * @property {string} [stick]        'Pad:ls' or 'Pad:rs'
 * @property {number} [stickSpeed]   radians per second at full deflection
 * @property {boolean} [invertY]
 * @property {string} [context]
 */

/**
 * One input action: a list of bindings is shorthand for a button.
 * @typedef {string[] | ButtonAction | AxisAction | Vec2Action | LookAction} ActionDef
 */

/**
 * A pair of numbers: a movement vector or a change of view.
 * @typedef {{ x: number, y: number }} Vec2Value
 */

/**
 * The player's bindings as plain JSON (see `serialize` and `load`).
 * @typedef {{ version: 1, actions: Record<string, Record<string, any>> }} InputBindings
 */

/**
 * A recording of everything fed to the manager (see `startRecording`): plain JSON.
 * @typedef {{ version: 1, length: number, init: Record<string, any>, log: { k: number, type: string, data: any }[] }} InputRecording
 */

const newMove = () => ({ all: [0, 0], locked: [0, 0], drag: [0, 0] });
const _v = { x: 0, y: 0 }, _r = { x: 0, y: 0 };

export class InputManager {
  /**
   * @param {Platform} platform
   * @param {InputOptions} [o]
   */
  constructor(platform, { deadzone = 0.18, lockOnClick = false } = {}) {
    this.platform = platform;
    this.deadzone = deadzone;
    this.lockOnClick = lockOnClick;
    this.time = 0;                       // seconds of simulation time seen through advance()
    this.tick = 0;                       // number of advance() calls
    this.context = 'default';

    // physical state
    this.keys = new Set();               // keys down right now
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0, wheel: 0, buttons: 0 };    // wheel: notches this step, up is +
    this.pointers = new Map();           // pointers that are pressed: id -> { x, y, type, button }
    this.pointerLocked = false;
    this.pads = [];                      // controllers polled at the last step: { index, id, axes, buttons(0..1) }

    // what happened since the last step
    this._pKeys = new Set(); this._rKeys = new Set();
    this._pMouse = 0; this._rMouse = 0; this._pwheel = 0;
    this._mv = newMove();
    // this step's view
    this.keysPressed = new Set(); this.keysReleased = new Set();
    this._tapMouse = 0; this._relMouse = 0; this._wheel = 0; this._step = newMove();
    this._padPressed = new Set();
    // the latched view for fixed steps (cleared by endFixed)
    this._inFixed = false;
    this._lKeysP = new Set(); this._lKeysR = new Set(); this._lMouseP = 0; this._lMouseR = 0; this._lPad = false;

    this._last = new Map();              // last position per pointer, for the movement fallback
    this._primary = null;                // the touch that drives the cursor
    this.actions = new Map();
    this._capture = null;
    this._rec = null; this._play = null; this._playPads = null; this._lastPadKey = null;

    const pass = (type) => (e) => this._ingest(type, e);
    this._unsub = [
      platform.on('key', pass('key')),
      platform.on('pointer', pass('pointer')),
      platform.on('wheel', pass('wheel')),
      platform.on('blur', pass('blur')),
      platform.on('visibility', (e) => { if (e.hidden) this._ingest('blur', {}); }),
      platform.on('pointerlock', pass('pointerlock')),
    ];
  }

  dispose() { for (const u of this._unsub) u(); this._unsub = []; }

  // ------------------------------------------------------------------------------------------ events

  _ingest(type, e) {
    if (this._play) return;                          // a replay owns the input
    this._apply(type, e);
  }

  _apply(type, e) {
    if (this._rec && type !== 'pads') this._rec.push({ k: this.tick - this._recStart, type, data: { ...e } });
    switch (type) {
      case 'key': this._onKey(e); break;
      case 'pointer': this._onPointer(e); break;
      case 'wheel': this._onWheel(e); break;
      case 'blur': this._releaseAll(); break;
      case 'pointerlock': this.pointerLocked = !!e.locked; break;
      case 'pads': this._playPads = e; break;
    }
  }

  _onKey(e) {
    const c = e.code;
    if (e.down) {
      if (e.repeat && !this.keys.has(c)) return;     // auto-repeat of a key that rebinding swallowed
      if (this._captureHit(c)) return;
      if (!this.keys.has(c)) { this.keys.add(c); this._pKeys.add(c); }
    } else {
      if (this.keys.delete(c)) this._rKeys.add(c);
      // macOS sends no keyup for other keys while Cmd is held: let go of everything when it comes up
      if (c === 'MetaLeft' || c === 'MetaRight') for (const k of [...this.keys]) { this.keys.delete(k); this._rKeys.add(k); }
    }
  }

  _addMove(dx, dy) {
    const mv = this._mv;
    mv.all[0] += dx; mv.all[1] += dy;
    if (this.pointerLocked) { mv.locked[0] += dx; mv.locked[1] += dy; }
    if (this.pointers.size) { mv.drag[0] += dx; mv.drag[1] += dy; }
  }

  _onPointer(e) {
    const m = this.mouse, touch = e.pointerType === 'touch', id = e.id;
    if (e.kind === 'down') {
      this.pointers.set(id, { x: e.x, y: e.y, type: e.pointerType, button: e.button || 0 });
      this._last.set(id, [e.x, e.y]);
      if (touch && this._primary === null) this._primary = id;
    }
    const primary = !touch || id === this._primary;

    if (e.kind === 'move') {
      const last = this._last.get(id);
      let dx = e.dx || 0, dy = e.dy || 0;
      if (!dx && !dy && last && !this.pointerLocked) { dx = e.x - last[0]; dy = e.y - last[1]; }
      if (primary) this._addMove(dx, dy);
      if (last) { last[0] = e.x; last[1] = e.y; } else this._last.set(id, [e.x, e.y]);
      const p = this.pointers.get(id); if (p) { p.x = e.x; p.y = e.y; }
    }
    if (primary) { m.x = e.x; m.y = e.y; }

    if (e.kind === 'down') {
      if (primary) {
        const bit = 1 << (e.button || 0);
        if (!this._captureHit(`Mouse${e.button || 0}`) && !(m.buttons & bit)) { m.buttons |= bit; this._pMouse |= bit; }
        if (this.lockOnClick && !touch && !this.pointerLocked) this.platform.setPointerLock(true);
      }
    } else if (e.kind === 'up') {
      if (primary) {
        const bit = 1 << (e.button || 0);
        if (m.buttons & bit) { m.buttons &= ~bit; this._rMouse |= bit; }
      }
      if (!e.buttons) this._endPointer(id, touch);
    } else if (e.kind === 'cancel') {
      if (primary && m.buttons) { this._rMouse |= m.buttons; m.buttons = 0; }
      this._endPointer(id, touch);
    }
  }

  /** A pressed pointer is over. A touch ceases to exist; a mouse keeps its position and goes on hovering. */
  _endPointer(id, touch) {
    this.pointers.delete(id);
    if (touch) this._last.delete(id);
    if (id === this._primary) this._primary = null;
  }

  _onWheel(e) {
    const unit = e.mode === 1 ? 3 : e.mode === 2 ? 1 : 100;       // a notch is ~100 px, 3 lines, or a page
    const notches = -e.dy / unit;                                   // scrolling away from you (up) is positive
    if (notches && this._captureHit(notches > 0 ? 'WheelUp' : 'WheelDown')) return;
    this._pwheel += notches;
  }

  _releaseAll() {
    for (const c of this.keys) this._rKeys.add(c);
    this.keys.clear();
    this._rMouse |= this.mouse.buttons; this.mouse.buttons = 0;
    this.pointers.clear(); this._last.clear(); this._primary = null;
  }

  // ------------------------------------------------------------------------------------------ the step

  /**
   * Call once per frame with its duration in seconds (the Engine does). Also fine once per fixed step in a headless loop.
   * @param {number} [dt]
   */
  advance(dt = 1 / 60) {
    const p = this._play;
    if (p) {
      if (this.tick - p.base >= p.length) this._endPlayback();
      else while (p.i < p.log.length && p.log[p.i].k <= this.tick - p.base) { const ev = p.log[p.i++]; this._apply(ev.type, ev.data); }
    }
    this.tick++; this.time += dt;
    this._pollPads();
    // what arrived since the last step is this step's view
    this.keysPressed = this._pKeys; this.keysReleased = this._rKeys;
    this._pKeys = new Set(); this._rKeys = new Set();
    this._tapMouse = this._pMouse; this._relMouse = this._rMouse; this._pMouse = 0; this._rMouse = 0;
    this._step = this._mv; this._mv = newMove();
    this._wheel = this._pwheel; this._pwheel = 0;
    const m = this.mouse;
    m.dx = this._step.all[0]; m.dy = this._step.all[1]; m.wheel = this._wheel;
    for (const k of this.keysPressed) this._lKeysP.add(k);
    for (const k of this.keysReleased) this._lKeysR.add(k);
    this._lMouseP |= this._tapMouse; this._lMouseR |= this._relMouse;
    if (this._padPressed.size) this._lPad = true;
    for (const a of this.actions.values()) this._evaluate(a, dt);
  }

  /** The Engine calls this before a fixed step: edges and look deltas now mean "since the previous fixed step". */
  beginFixed() { this._inFixed = true; }
  /** ...and this after it: what the step has seen is consumed. */
  endFixed() {
    this._inFixed = false;
    this._lKeysP.clear(); this._lKeysR.clear(); this._lMouseP = 0; this._lMouseR = 0; this._lPad = false;
    for (const a of this.actions.values()) { a.lPressed = false; a.lReleased = false; a.lx = 0; a.ly = 0; }
  }

  _pollPads() {
    const raw = this._play ? (this._playPads || []) : (this.platform.gamepads() || []);
    const prev = this.pads;
    this.pads = raw.filter(Boolean).map((p) => ({
      index: p.index, id: p.id,
      axes: Array.from(p.axes || []),
      buttons: (p.buttons || []).map((b) => (typeof b === 'number' ? b : (b.value ?? (b.pressed ? 1 : 0)))),
    }));
    this._padPressed = new Set();
    for (const p of this.pads) {
      const q = prev.find((x) => x.index === p.index);
      p.buttons.forEach((v, i) => {
        if (v >= PRESS && !(q && q.buttons[i] >= PRESS)) {
          this._padPressed.add(`${p.index}:${i}`);
          if (i < PAD_BUTTONS.length) this._captureHit(`Pad:${PAD_BUTTONS[i]}`);
        }
      });
      if (this._capture) {
        for (let ax = 0; ax < 4; ax++) {
          const v = p.axes[ax] || 0, was = q ? (q.axes[ax] || 0) : 0;
          if (Math.abs(v) >= CAPTURE_AXIS && Math.abs(was) < CAPTURE_AXIS) { this._captureHit(`Pad:${'lr'[ax >> 1]}${'xy'[ax & 1]}${v > 0 ? '+' : '-'}`); break; }
        }
      }
    }
    if (this._rec && !this._play) {
      const snap = this.pads.map((p) => ({ index: p.index, id: p.id, axes: p.axes.slice(), buttons: p.buttons.slice() }));
      const key = JSON.stringify(snap);
      if (key !== this._lastPadKey) { this._lastPadKey = key; this._rec.push({ k: this.tick - this._recStart - 1, type: 'pads', data: snap }); }
    }
  }

  // ------------------------------------------------------------------------------------------ raw state

  /**
   * Is the key down (or was it tapped during this step)?
   * @param {string} code  a KeyboardEvent.code such as 'KeyW'
   * @returns {boolean}
   */
  keyDown(code) { return this.keys.has(code) || this.keysPressed.has(code); }
  /** @param {string} code @returns {boolean} */
  keyPressed(code) { return (this._inFixed ? this._lKeysP : this.keysPressed).has(code); }
  /** @param {string} code @returns {boolean} */
  keyReleased(code) { return (this._inFixed ? this._lKeysR : this.keysReleased).has(code); }
  /** @param {number} [n]  0 left, 1 middle, 2 right @returns {boolean} */
  mouseDown(n = 0) { return !!(this.mouse.buttons & (1 << n)) || !!(this._tapMouse & (1 << n)); }
  /** @param {number} [n] @returns {boolean} */
  mousePressed(n = 0) { return !!((this._inFixed ? this._lMouseP : this._tapMouse) & (1 << n)); }
  /** @param {number} [n] @returns {boolean} */
  mouseReleased(n = 0) { return !!((this._inFixed ? this._lMouseR : this._relMouse) & (1 << n)); }
  /**
   * Controller number `i` (its `gamepad.index`), or null.
   * @param {number} [i]
   * @returns {PlatformGamepad | null}
   */
  pad(i = 0) { return this.pads.find((p) => p.index === i) ?? null; }
  /**
   * Did anything at all go down this step? ("press any key")
   * @returns {boolean}
   */
  anyPressed() {
    if (this._inFixed) return this._lKeysP.size > 0 || this._lMouseP !== 0 || this._lPad;
    return this.keysPressed.size > 0 || this._tapMouse !== 0 || this._padPressed.size > 0;
  }

  /**
   * Asks the platform to lock (or release) the pointer for mouse look. Browsers need a click first.
   * @param {boolean} [on]
   */
  lockPointer(on = true) { this.platform.setPointerLock(on); }

  // ------------------------------------------------------------------------------------------ actions

  /**
   * Defines actions. An array is shorthand for a button with those bindings. Actions belong to a context ('default'
   * unless given); only those of the current context, and of the context 'always', respond.
   * @param {Record<string, ActionDef>} defs  action name -> definition
   * @param {string} [context]
   * @returns {this}
   */
  map(defs, context = 'default') {
    for (const [name, def] of Object.entries(defs)) {
      const d = Array.isArray(def) ? { type: 'button', bindings: [...def] } : { type: 'button', ...def };
      const a = {
        name, def: d, defaults: JSON.parse(JSON.stringify(d)), context: d.context ?? context, compiled: null,
        held: false, prev: false, pressed: false, released: false, pulse: false, value: 0, x: 0, y: 0,
        lastPress: -Infinity, consumed: true, downAt: 0, lastHold: 0, lPressed: false, lReleased: false, lx: 0, ly: 0,
      };
      this._compile(a);
      this.actions.set(name, a);
    }
    return this;
  }

  _compile(a) {
    const d = a.def, c = {};
    const list = (arr) => (arr || []).map(parseBinding);
    const one = (s, kind, sign) => {
      if (!s) return null;
      const p = parseBinding(s).parts[0];
      if (p.kind !== kind || (sign !== undefined && p.sign !== sign)) throw new Error(`'${s}' is not valid as ${kind === 'padstick' ? 'a stick (Pad:ls / Pad:rs)' : 'a whole axis (Pad:lx ...)'}`);
      return p;
    };
    try {
      switch (d.type) {
        case 'button': c.bindings = list(d.bindings); break;
        case 'axis': c.positive = list(d.positive); c.negative = list(d.negative); c.stick = one(d.stick, 'padaxis', 0); break;
        case 'vec2': c.up = list(d.up); c.down = list(d.down); c.left = list(d.left); c.right = list(d.right); c.stick = one(d.stick, 'padstick'); break;
        case 'look':
          c.stick = one(d.stick, 'padstick');
          if (d.mouse !== undefined && d.mouse !== false && !['locked', 'always', 'drag'].includes(d.mouse)) throw new Error(`look.mouse must be 'locked', 'always', 'drag' or false`);
          break;
        default: throw new Error(`unknown action type '${d.type}'`);
      }
    } catch (e) { throw new Error(`Input action '${a.name}': ${e.message}`); }
    a.compiled = c;
  }

  /**
   * Switches which group of actions responds ('always' actions respond everywhere).
   * @param {string} name
   */
  setContext(name) { this.context = name; }
  _active(a) { return a.context === this.context || a.context === 'always'; }

  _partValue(p) {
    switch (p.kind) {
      case 'key': for (const c of p.codes) if (this.keys.has(c) || this.keysPressed.has(c)) return 1; return 0;
      case 'mouse': return this.mouseDown(p.n) ? 1 : 0;
      case 'wheel': return this._wheel * p.dir > 0.01 ? 1 : 0;
      case 'padbutton': {
        let v = 0;
        for (const pad of this.pads) { if (p.pad >= 0 && pad.index !== p.pad) continue; const b = pad.buttons[p.index] || 0; if (b > v) v = b; }
        return v;
      }
      case 'padaxis': {
        if (p.sign === 0) return Math.abs(this._bipolar(p));
        let v = 0;
        for (const pad of this.pads) {
          if (p.pad >= 0 && pad.index !== p.pad) continue;
          const s = (pad.axes[p.axis] || 0) * p.sign;
          if (s > this.deadzone) v = Math.max(v, (s - this.deadzone) / (1 - this.deadzone));
        }
        return v;
      }
      case 'padstick': { this._stickVec(p, _v); return Math.min(1, Math.hypot(_v.x, _v.y)); }
    }
    return 0;
  }

  /** The most deflected stick among the controllers `p` listens to, after the radial dead zone. */
  _stickVec(p, out) {
    out.x = 0; out.y = 0;
    let best = 0;
    for (const pad of this.pads) {
      if (p.pad >= 0 && pad.index !== p.pad) continue;
      radialDeadzone(pad.axes[p.stick] || 0, pad.axes[p.stick + 1] || 0, this.deadzone, _r);
      const m = _r.x * _r.x + _r.y * _r.y;
      if (m > best) { best = m; out.x = _r.x; out.y = _r.y; }
    }
    return out;
  }

  /** A single stick axis, -1..1 with its dead zone. */
  _bipolar(p) {
    let best = 0;
    for (const pad of this.pads) {
      if (p.pad >= 0 && pad.index !== p.pad) continue;
      const raw = pad.axes[p.axis] || 0, mag = Math.abs(raw);
      if (mag > this.deadzone) {
        const v = Math.sign(raw) * (mag - this.deadzone) / (1 - this.deadzone);
        if (Math.abs(v) > Math.abs(best)) best = v;
      }
    }
    return best;
  }

  _bindingValue(b) { let v = 1; for (const p of b.parts) { const x = this._partValue(p); if (x < v) v = x; if (v === 0) break; } return v; }
  _anyValue(list) { let v = 0; for (const b of list) { const x = this._bindingValue(b); if (x > v) v = x; } return v; }

  _evaluate(a, dt) {
    const prev = a.held, d0 = a.def;
    a.prev = prev; a.pulse = false;
    if (!this._active(a)) { a.held = false; a.value = 0; a.x = 0; a.y = 0; }
    else {
      const c = a.compiled, d = a.def;
      switch (d.type) {
        case 'button': {
          let v = 0;
          for (const b of c.bindings) { const x = this._bindingValue(b); if (x > v) v = x; if (x > 0 && b.wheel) a.pulse = true; }
          a.value = v; a.held = v >= PRESS;
          break;
        }
        case 'axis': {
          let v = this._anyValue(c.positive) - this._anyValue(c.negative);
          if (d.wheel) v += Math.max(-1, Math.min(1, this._wheel));
          if (c.stick) v += this._bipolar(c.stick);
          a.value = Math.max(-1, Math.min(1, v)); a.held = Math.abs(a.value) >= PRESS;
          break;
        }
        case 'vec2': {
          let x = this._anyValue(c.right) - this._anyValue(c.left), y = this._anyValue(c.up) - this._anyValue(c.down);
          if (c.stick) { this._stickVec(c.stick, _v); x += _v.x; y -= _v.y; }        // a stick's y is down-positive
          const m = Math.hypot(x, y);
          if (m > 1) { x /= m; y /= m; }
          a.x = x; a.y = y; a.value = Math.min(1, m); a.held = m > 1e-3;
          break;
        }
        case 'look': {
          const mode = d.mouse === undefined ? 'locked' : d.mouse, sens = d.sensitivity ?? 0.0022;
          let x = 0, y = 0;
          if (mode) { const mv = this._step[mode === 'always' ? 'all' : mode]; x = mv[0] * sens; y = -mv[1] * sens; }
          if (d.invertY) y = -y;
          if (c.stick) { this._stickVec(c.stick, _v); const sp = (d.stickSpeed ?? 2.8) * dt; x += _v.x * sp; y += (d.invertY ? _v.y : -_v.y) * sp; }
          a.x = x + 0; a.y = y + 0;                                   // (+ 0 turns -0 into 0)
          a.value = Math.hypot(x, y); a.held = a.value > 0;
          break;
        }
      }
    }
    a.pressed = a.held && (!prev || a.pulse);              // each wheel notch is its own press
    a.released = !a.held && prev;
    if (a.pressed) { a.lastPress = this.time; a.consumed = false; a.lPressed = true; if (!prev) a.downAt = this.time; }
    if (a.released) { a.lastHold = this.time - a.downAt; a.lReleased = true; }
    if (d0.type === 'look') { a.lx += a.x; a.ly += a.y; }
  }

  _get(name) {
    const a = this.actions.get(name);
    if (!a) throw new Error(`Unknown input action '${name}'`);
    return a;
  }

  /**
   * Is the action held?
   * @param {string} name
   * @returns {boolean}
   */
  down(name) { return this._get(name).held; }
  /**
   * Did it go down since the last frame (inside a fixed step: since the last fixed step)?
   * @param {string} name
   * @returns {boolean}
   */
  pressed(name) { const a = this._get(name); return this._inFixed ? a.lPressed : a.pressed; }
  /**
   * Did it go up (or was its context switched away while held)? Same cadence rules as pressed().
   * @param {string} name
   * @returns {boolean}
   */
  released(name) { const a = this._get(name); return this._inFixed ? a.lReleased : a.released; }
  /**
   * Analog value: a button 0..1 (how far a trigger is pulled), an axis -1..1, a vec2 its length.
   * @param {string} name
   * @returns {number}
   */
  value(name) { return this._get(name).value; }
  /** @param {string} name @returns {number} */
  axis(name) { return this._get(name).value; }
  /**
   * A movement vector: x right, y forward, length <= 1.
   * @param {string} name
   * @param {Vec2Value} [out]
   * @returns {Vec2Value}
   */
  vec2(name, out = { x: 0, y: 0 }) { const a = this._get(name); out.x = a.x; out.y = a.y; return out; }
  /**
   * Change of view since the last frame (inside a fixed step: since the last fixed step), radians: x right, y up.
   * @param {string} name
   * @param {Vec2Value} [out]
   * @returns {Vec2Value}
   */
  look(name, out = { x: 0, y: 0 }) {
    const a = this._get(name);
    if (this._inFixed) { out.x = a.lx; out.y = a.ly; } else { out.x = a.x; out.y = a.y; }
    return out;
  }
  /**
   * Seconds the action has been held (0 when not held).
   * @param {string} name
   * @returns {number}
   */
  heldTime(name) { const a = this._get(name); return a.held ? this.time - a.downAt : 0; }
  /**
   * How long the last hold lasted - read it on the step `released()` is true.
   * @param {string} name
   * @returns {number}
   */
  lastHold(name) { return this._get(name).lastHold; }

  /**
   * Was the action pressed within the last `window` seconds and not yet consumed? A jump pressed just before landing
   * still counts; call consume() when you act on it.
   * @param {string} name
   * @param {number} [window]  seconds
   * @returns {boolean}
   */
  buffered(name, window = 0.15) { const a = this._get(name); return !a.consumed && this.time - a.lastPress <= window; }
  /** @param {string} name */
  consume(name) { this._get(name).consumed = true; }

  // ------------------------------------------------------------------------------------------ rebinding

  /**
   * The bindings of a button action, or of one `part` ('up', 'positive' ...) of a composite one.
   * @param {string} name
   * @param {string | null} [part]  for a composite action: 'up', 'down', 'left', 'right', 'positive' or 'negative'
   * @returns {string[] | Record<string, string[]>}  a list for a button (or a part); every part for a composite action asked without one
   */
  bindings(name, part = null) {
    const a = this._get(name), d = a.def;
    if (d.type === 'button') return [...d.bindings];
    if (part) return [...(d[part] || [])];
    const out = {};
    for (const k of ['positive', 'negative', 'up', 'down', 'left', 'right']) if (d[k]) out[k] = [...d[k]];
    return out;
  }

  /**
   * Replaces the bindings of an action (of `part` for a composite one). Throws on a malformed binding.
   * @param {string} name
   * @param {string[]} bindings  such as ['KeyW', 'ArrowUp']
   * @param {string | null} [part]  for a composite action: 'up', 'down', 'left', 'right', 'positive' or 'negative'
   * @returns {this}
   */
  rebind(name, bindings, part = null) {
    const a = this._get(name), d = a.def;
    if (d.type !== 'button' && !part) throw new Error(`rebind('${name}'): say which part - a ${d.type} action has several`);
    const key = d.type === 'button' ? 'bindings' : part;
    const old = d[key];
    d[key] = [...bindings];
    try { this._compile(a); } catch (e) { d[key] = old; this._compile(a); throw e; }
    return this;
  }

  /**
   * Puts the bindings of one action (or of all) back to what map() gave them.
   * @param {string | null} [name]  an action (default: all of them)
   * @returns {this}
   */
  resetBindings(name = null) {
    for (const a of name ? [this._get(name)] : this.actions.values()) {
      a.def = JSON.parse(JSON.stringify(a.defaults));
      this._compile(a);
    }
    return this;
  }

  /**
   * Which actions use `binding` ('KeyW')? Names like 'jump' or 'move.up'.
   * @param {string} binding
   * @returns {string[]}
   */
  conflicts(binding) {
    const out = [];
    for (const a of this.actions.values()) {
      for (const key of ['bindings', 'positive', 'negative', 'up', 'down', 'left', 'right']) if (a.def[key]?.includes(binding)) out.push(key === 'bindings' ? a.name : `${a.name}.${key}`);
    }
    return out;
  }

  /**
   * Resolves with the next key, mouse button, wheel notch, controller button or stick push, named as a binding string
   * ('KeyJ', 'Mouse2', 'Pad:b', 'Pad:lx-'), and swallows that input. Escape cancels (null) unless `allowEscape`.
   * @param {{ allowEscape?: boolean }} [o]
   * @returns {Promise<string | null>}
   */
  captureNext({ allowEscape = false } = {}) {
    if (this._capture) this._capture.resolve(null);
    return new Promise((resolve) => { this._capture = { resolve, allowEscape }; });
  }
  _captureHit(binding) {
    const c = this._capture;
    if (!c) return false;
    this._capture = null;
    c.resolve(binding === 'Escape' && !c.allowEscape ? null : binding);
    return true;
  }
  get capturing() { return !!this._capture; }

  /**
   * The player's bindings as plain JSON (for a settings file).
   * @returns {InputBindings}
   */
  serialize() {
    const out = {};
    for (const [name, a] of this.actions) { const d = {}; for (const k of PERSIST_KEYS) if (a.def[k] !== undefined) d[k] = JSON.parse(JSON.stringify(a.def[k])); out[name] = d; }
    return { version: 1, actions: out };
  }
  /**
   * Applies saved bindings to the actions that exist. Unknown actions and malformed entries are ignored.
   * @param {InputBindings} json
   * @returns {this}
   */
  load(json) {
    for (const [name, d] of Object.entries(json?.actions || {})) {
      const a = this.actions.get(name);
      if (!a || !d || typeof d !== 'object') continue;
      const old = a.def, next = { ...old };
      for (const k of PERSIST_KEYS) if (d[k] !== undefined) next[k] = d[k];
      a.def = next;
      try { this._compile(a); } catch { a.def = old; this._compile(a); }
    }
    return this;
  }
  /**
   * Stores the bindings with the platform (localStorage in a browser).
   * @param {string} [key]
   */
  save(key = 'medengine.input') { this.platform.storage.set(key, JSON.stringify(this.serialize())); }
  /**
   * Loads stored bindings; false when there were none.
   * @param {string} [key]
   * @returns {boolean}
   */
  restore(key = 'medengine.input') {
    const s = this.platform.storage.get(key);
    if (!s) return false;
    try { this.load(JSON.parse(s)); return true; } catch { return false; }
  }

  // ------------------------------------------------------------------------------------------ record and replay

  /** Records everything that is fed to the manager from now on. stopRecording() returns a JSON-able log. */
  startRecording() {
    this._recStart = this.tick; this._lastPadKey = null;
    this._rec = [];
    this._recInit = { keys: [...this.keys], buttons: this.mouse.buttons, x: this.mouse.x, y: this.mouse.y, locked: this.pointerLocked };
  }
  /**
   * Ends the recording and returns the log (plain JSON).
   * @returns {InputRecording}
   */
  stopRecording() {
    const rec = { version: 1, length: this.tick - this._recStart, init: this._recInit, log: this._rec };
    this._rec = null;
    return rec;
  }
  /**
   * Replays a recording: until it ends only the recorded input is seen (live input is ignored).
   * @param {InputRecording} rec
   */
  startPlayback(rec) {
    this._releaseAll();
    this._pKeys.clear(); this._rKeys.clear(); this._pMouse = this._rMouse = 0; this._mv = newMove(); this._pwheel = 0;
    const i = rec.init || {};
    for (const k of i.keys || []) this.keys.add(k);
    this.mouse.buttons = i.buttons || 0; this.mouse.x = i.x || 0; this.mouse.y = i.y || 0; this.pointerLocked = !!i.locked;
    this._playPads = null;
    this._play = { log: rec.log, i: 0, base: this.tick, length: rec.length };
  }
  _endPlayback() { this._play = null; this._playPads = null; this._releaseAll(); }
  get playing() { return !!this._play; }
}
