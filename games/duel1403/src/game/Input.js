/**
 * Keyboard, mouse and touch, merged into one intent.
 *
 *  Move           W A S D / arrows / left stick on touch
 *  Cut            drag the mouse (or a finger) across the screen in the
 *                 direction the blade should travel; where you drag over him
 *                 is what you aim at
 *  Thrust         click / tap on the spot you want the point to go
 *  Parry          hold the right mouse button, Space, or the PARRY button
 *  Keys for blows U I O / J K L / M , (the key's place = where the blow comes from; K thrusts)
 *  Guards         1–8, or Q / E to step through them
 *  F  half-sword (long sword) / hammer-or-axe / face-or-beak
 *  G  wrestle (shove, throw)    V  visor up/down    C  camera    Esc  pause
 */
const KEY_BLOWS = {
  KeyU: [1, -1], KeyI: [0, -1], KeyO: [-1, -1],
  KeyJ: [1, 0], KeyL: [-1, 0],
  KeyM: [1, 1], Comma: [-1, 1],
};

export class Input {
  constructor(root) {
    this.keys = new Set();
    this.actions = [];
    this.enabled = true;
    this.touch = { move: { x: 0, y: 0 }, parry: false };
    this.mouseParry = false;
    this.drag = null;
    this.trail = [];

    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      const c = e.code;
      if (KEY_BLOWS[c]) this.actions.push({ type: 'swipe', dx: KEY_BLOWS[c][0], dy: KEY_BLOWS[c][1], screen: null });
      else if (c === 'KeyK') this.actions.push({ type: 'thrust', screen: null });
      else if (/^Digit[1-8]$/.test(c)) this.actions.push({ type: 'guard', index: Number(c.slice(5)) - 1 });
      else if (c === 'KeyQ') this.actions.push({ type: 'guardStep', dir: -1 });
      else if (c === 'KeyE') this.actions.push({ type: 'guardStep', dir: 1 });
      else if (c === 'KeyF') this.actions.push({ type: 'mode' });
      else if (c === 'KeyG') this.actions.push({ type: 'shove' });
      else if (c === 'KeyV') this.actions.push({ type: 'visor' });
      else if (c === 'KeyC') this.actions.push({ type: 'camera' });
      else if (c === 'Escape' || c === 'KeyP') this.actions.push({ type: 'pause' });
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouseParry = false; });

    // Pointer swipes on the play area (mouse and touch alike).
    const area = root;
    area.addEventListener('contextmenu', (e) => e.preventDefault());
    area.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.ui-interactive')) return;
      if (e.button === 2) { this.mouseParry = true; return; }
      if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.38) return; // left side: joystick
      if (e.button !== 0) return;
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), pts: [[e.clientX, e.clientY]] };
      this.trail = [[e.clientX, e.clientY, performance.now()]];
    });
    addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.drag.pts.push([e.clientX, e.clientY]);
      this.trail.push([e.clientX, e.clientY, performance.now()]);
    });
    addEventListener('pointerup', (e) => {
      if (e.button === 2) { this.mouseParry = false; return; }
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      const len = Math.hypot(dx, dy);
      if (len < 18) {
        this.actions.push({ type: 'thrust', screen: [e.clientX, e.clientY] });
      } else {
        // aim: the middle of the stroke
        const mid = d.pts[Math.floor(d.pts.length / 2)];
        this.actions.push({ type: 'swipe', dx: dx / len, dy: -dy / len, screen: mid, from: [d.x0, d.y0], to: [e.clientX, e.clientY] });
      }
    });
    addEventListener('pointercancel', () => { this.drag = null; });
  }

  press(action) {
    this.actions.push(action);
  }

  poll() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (Math.abs(this.touch.move.x) > Math.abs(x)) x = this.touch.move.x;
    if (Math.abs(this.touch.move.y) > Math.abs(y)) y = this.touch.move.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const parry = k.has('Space') || this.mouseParry || this.touch.parry;
    const actions = this.actions;
    this.actions = [];
    const meta = new Set(['pause', 'camera']);
    return { move: { x, y }, parry, actions: this.enabled ? actions : actions.filter((a) => meta.has(a.type)) };
  }
}
