/**
 * Keyboard + mouse, gamepad and touch input, merged into one intent:
 *   move {x: right, y: forward}, block, and a queue of discrete actions.
 */
const KEY_PUNCH = {
  KeyJ: 'jab', KeyK: 'cross', KeyU: 'leadHook', KeyI: 'rearHook', KeyN: 'leadUppercut', KeyM: 'rearUppercut',
  Digit1: 'jab', Digit2: 'cross', Digit3: 'leadHook', Digit4: 'rearHook', Digit5: 'leadUppercut', Digit6: 'rearUppercut',
};
const KEY_DEFENSE = { KeyQ: 'slipLeft', KeyE: 'slipRight', KeyC: 'duck', KeyZ: 'pull' };

export class Input {
  constructor(root) {
    this.keys = new Set();
    this.actions = [];
    this.mouse = { left: false, right: false };
    this.touch = { move: { x: 0, y: 0 }, block: false, body: false };
    this.gamepadIndex = null;
    this.padPrev = [];
    this.bodyToggle = false;
    this.lastDevice = 'keyboard';
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      this.keys.add(e.code);
      const body = e.shiftKey || this.touch.body;
      if (KEY_PUNCH[e.code]) this.actions.push({ type: 'punch', punch: KEY_PUNCH[e.code], level: body ? 'body' : 'head' });
      else if (KEY_DEFENSE[e.code]) this.actions.push({ type: 'defend', move: KEY_DEFENSE[e.code] });
      else if (e.code === 'KeyV') this.actions.push({ type: 'camera' });
      else if (e.code === 'Escape' || e.code === 'KeyP') this.actions.push({ type: 'pause' });
      else if (e.code === 'KeyH') this.actions.push({ type: 'help' });
      else if (e.code === 'KeyR') this.actions.push({ type: 'replay' });
      if (e.code === 'Space') this.actions.push({ type: 'mash' });
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    root.addEventListener('mousedown', (e) => {
      if (e.target.closest && e.target.closest('.ui-interactive')) return;
      this.lastDevice = 'keyboard';
      const body = e.shiftKey;
      if (e.button === 0) this.actions.push({ type: 'punch', punch: 'jab', level: body ? 'body' : 'head' });
      if (e.button === 2) this.actions.push({ type: 'punch', punch: 'cross', level: body ? 'body' : 'head' });
      if (e.button === 1) this.actions.push({ type: 'punch', punch: 'leadHook', level: body ? 'body' : 'head' });
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.lastDevice = 'gamepad';
    });
    addEventListener('gamepaddisconnected', () => {
      this.gamepadIndex = null;
    });
  }

  /** Touch buttons call this. */
  press(action) {
    this.lastDevice = 'touch';
    if (action.type === 'punch') action.level = this.touch.body ? 'body' : 'head';
    this.actions.push(action);
  }

  _pollGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return null;
    const b = gp.buttons.map((x) => x.pressed);
    const was = (i) => !!this.padPrev[i];
    const edge = (i) => b[i] && !was(i);
    const upper = b[5];          // RB: uppercut modifier
    const body = (gp.buttons[7]?.value ?? 0) > 0.4;   // RT: body shots
    const level = body ? 'body' : 'head';
    if (edge(2)) this.actions.push({ type: 'punch', punch: upper ? 'leadUppercut' : 'jab', level });
    if (edge(3)) this.actions.push({ type: 'punch', punch: upper ? 'rearUppercut' : 'cross', level });
    if (edge(0)) this.actions.push({ type: 'punch', punch: upper ? 'leadUppercut' : 'leadHook', level });
    if (edge(1)) this.actions.push({ type: 'punch', punch: upper ? 'rearUppercut' : 'rearHook', level });
    if (edge(9)) this.actions.push({ type: 'pause' });
    if (edge(8)) this.actions.push({ type: 'camera' });
    if (b.some((x, i) => x && !was(i))) {
      this.lastDevice = 'gamepad';
      this.actions.push({ type: 'mash' });
    }
    // Right stick: head movement.
    const rx = gp.axes[2] ?? 0, ry = gp.axes[3] ?? 0;
    const stick = Math.hypot(rx, ry) > 0.6 ? (Math.abs(rx) > Math.abs(ry) ? (rx < 0 ? 'slipLeft' : 'slipRight') : (ry > 0 ? 'duck' : 'pull')) : null;
    if (stick && stick !== this.padStick) this.actions.push({ type: 'defend', move: stick });
    this.padStick = stick;
    this.padPrev = b;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    return { x: dz(gp.axes[0] ?? 0), y: -dz(gp.axes[1] ?? 0), block: (gp.buttons[6]?.value ?? 0) > 0.4 || b[4] };
  }

  /** Returns this frame's state and clears the action queue. */
  poll() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let block = k.has('Space') || k.has('KeyL') || k.has('ShiftRight');
    const pad = this._pollGamepad();
    if (pad) {
      if (Math.abs(pad.x) > Math.abs(x)) x = pad.x;
      if (Math.abs(pad.y) > Math.abs(y)) y = pad.y;
      block = block || pad.block;
    }
    if (Math.abs(this.touch.move.x) > Math.abs(x)) x = this.touch.move.x;
    if (Math.abs(this.touch.move.y) > Math.abs(y)) y = this.touch.move.y;
    block = block || this.touch.block;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const actions = this.actions;
    this.actions = [];
    const meta = new Set(['pause', 'camera', 'replay', 'help']);
    return { move: { x, y }, block, actions: this.enabled ? actions : actions.filter((a) => meta.has(a.type)) };
  }
}
