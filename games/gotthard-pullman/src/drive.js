/**
 * Driving 2978 yourself. You take the driver's place on the footplate (he stands back; the
 * fireman keeps the fire and the water as before) and work the driver's controls: each key moves
 * the same valve, screw or handle the crew's hands do (Crew._setControl), at a human rate, so the
 * physics answers exactly as it does for him - the steam, the slips, the brakes, the stops.
 */

/** The train brake valve's positions, notch by notch (service: the self-lapping range). */
const BRAKE_NOTCHES = ['release', 'running', 'lap', 0, 0.2, 0.4, 0.6, 0.8, 1, 'emergency'];

export const DRIVE_KEYS = [
  ['F', 'take or hand back the controls (on the footplate)'],
  ['W / S', 'regulator open / close (hold)'],
  ['Q / A', 'reversing screw: wind forward / back (hold)'],
  ['] / [', 'train brake valve one notch on / off'],
  ['Backspace', 'emergency brake'],
  ['. / ,', 'direct (engine) brake on / off (hold)'],
  ['Space', 'whistle (hold)'],
  ['X', 'sanders (hold)'],
  ['G', 'starting valve (hold)'],
  ['C', 'cylinder drain cocks open / shut'],
  ['I', 'right injector on / off'],
  ['J', 'train heating on / off'],
  ['K', 'acknowledge a Signum warning'],
  ['1 / 2 / 3', 'quick commands: go forward / stop / go backward'],
  ['B', 'magnetic track brake on / off (also on with the emergency brake)'],
];

const HOLD = new Set(['KeyW', 'KeyS', 'KeyQ', 'KeyA', 'Period', 'Comma', 'Space', 'KeyX', 'KeyG']);

export class Driving {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.held = new Set();
    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.held.clear());
  }

  get crew() { return this.game.sim.crew; }
  get loco() { return this.game.sim.train.loco; }
  get brake() { return this.game.sim.train.brake; }

  toggle() {
    this.on = !this.on;
    this.held.clear();
    this.crew.setManual(this.on);
    this.game.player.setCab(this.on);
  }

  /** A key (or a touch button, which sends the same codes). */
  press(code, down) {
    if (code === 'KeyF') { if (down) this.toggle(); return true; }
    if (!this.on) return false;
    if (HOLD.has(code)) { if (down) this.held.add(code); else this.held.delete(code); return true; }
    if (!down) return ['BracketRight', 'BracketLeft', 'Backspace', 'KeyC', 'KeyI', 'KeyJ', 'KeyK', 'KeyB', 'Digit1', 'Digit2', 'Digit3'].includes(code);
    const c = this.loco.c, set = (n, v) => this.crew._setControl(n, v);
    switch (code) {
      case 'BracketRight': this._notch(+1); return true;
      case 'BracketLeft': this._notch(-1); return true;
      case 'Backspace': set('trainBrake', 'emergency'); return true;
      case 'KeyC': set('drainCocks', c.drainCocks ? 0 : 1); return true;
      case 'KeyI': set('injectorR', c.injector[1] ? 0 : 1); return true;
      case 'KeyJ': set('steamHeat', c.steamHeat > 0.5 ? 0 : 1); return true;
      case 'KeyK': this.game.sim.signals?.acknowledge(); return true;
      case 'KeyB': this.game.sim.train.trackBrake = !this.game.sim.train.trackBrake; this.game.sim.log?.(this.game.sim.train.trackBrake ? 'Track brake: the magnets are down on the rails.' : 'Track brake: magnets up.'); return true;
      case 'Digit1': this.quick('forward'); return true;
      case 'Digit2': this.quick('stop'); return true;
      case 'Digit3': this.quick('backward'); return true;
    }
    return false;
  }

  _key(e, down) {
    if (e.target?.tagName === 'INPUT') return;
    if (e.repeat && !HOLD.has(e.code)) return;
    if (this.press(e.code, down) && (e.code === 'Space' || e.code === 'Backspace')) e.preventDefault();
  }

  /**
   * Quick commands: the controls a driver works to get away or to stop, all at once.
   * forward / backward: brakes off (the valve to running, the engine brake off), the reversing
   * screw well into gear that way, the drain cocks shut, steam on; stop: steam off, a full service
   * application and the engine brake on. The physics then does the rest (slips, grades and all).
   */
  quick(what) {
    const set = (n, v) => this.crew._setControl(n, v), c = this.loco.c, sim = this.game.sim;
    if (what === 'stop') {
      set('regulator', 0); set('startingValve', 0); set('trainBrake', 1); set('directBrake', 1);
      sim.log?.('You: steam off, brakes on.');
      return;
    }
    const dir = what === 'backward' ? -1 : 1;
    set('trainBrake', 'running'); set('directBrake', 0); sim.train.trackBrake = false;
    if (c.reverser * dir < 0.5) set('reverser', 0.6 * dir);
    set('drainCocks', 0);
    set('regulator', Math.max(c.regulator, 0.5));
    sim.log?.(dir > 0 ? 'You: brakes off, forward gear, steam on.' : 'You: brakes off, back gear, steam on.');
  }

  /** Where the brake handle is, as a notch index. */
  notch() {
    const B = this.brake;
    if (B.handle !== 'service') return BRAKE_NOTCHES.indexOf(B.handle);
    const x = (5.0 - 0.4 - B.serviceTarget) / 1.1;
    let best = 3;
    for (let i = 3; i <= 8; i++) if (Math.abs(BRAKE_NOTCHES[i] - x) < Math.abs(BRAKE_NOTCHES[best] - x)) best = i;
    return best;
  }

  _notch(dir) {
    const i = Math.max(0, Math.min(BRAKE_NOTCHES.length - 1, this.notch() + dir));
    this.crew._setControl('trainBrake', BRAKE_NOTCHES[i]);
  }

  /** The held keys move their controls at a hand's pace. */
  update(dt) {
    if (!this.on) return;
    const c = this.loco.c, B = this.brake, set = (n, v) => this.crew._setControl(n, v), h = this.held;
    if (h.has('KeyW')) set('regulator', Math.min(1, c.regulator + 0.3 * dt));
    if (h.has('KeyS')) set('regulator', Math.max(0, c.regulator - 0.5 * dt));
    if (h.has('KeyQ')) set('reverser', Math.min(0.75, c.reverser + 0.08 * dt));      // about a turn of the screw a second
    if (h.has('KeyA')) set('reverser', Math.max(-0.75, c.reverser - 0.08 * dt));
    if (h.has('Period')) set('directBrake', Math.min(1, B.direct + 0.8 * dt));
    if (h.has('Comma')) set('directBrake', Math.max(0, B.direct - 0.8 * dt));
    set('whistle', h.has('Space') ? 1 : 0);
    set('sander', h.has('KeyX') ? 1 : 0);
    set('startingValve', h.has('KeyG') ? 1 : 0);
  }

  /** The brake handle's position in words. */
  brakeText() {
    const B = this.brake;
    if (B.handle !== 'service') return B.handle;
    return `service ${Math.round(((5.0 - 0.4 - B.serviceTarget) / 1.1) * 100)} %`;
  }
}
