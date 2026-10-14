/**
 * The driver's controls: keys, the mouse and the touch screen.
 *
 * Keys: W / Up throttle, S / Down brake (and reverse from a stop), A D / Left Right steer,
 * Space handbrake, Shift + W "floor it". The controls of the car itself are in game.js.
 * Pedals and steering are smoothed as hands and feet would move them: the wheel winds at up
 * to about one and a half turns a second (less at speed), the throttle opens in a third of a
 * second and closes faster.
 */
export class Input {
  constructor(el) {
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0, active: false };
    this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.lookDelta = [0, 0]; this.zoomDelta = 1;
    this.handlers = [];
    addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      for (const h of this.handlers) h(e);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // look round: drag (mouse or one finger on the view), the wheel zooms
    let drag = null;
    el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const s = 2.4 / Math.max(innerWidth, innerHeight);
      this.lookDelta[0] += (e.clientX - drag.x) * s * 1.3; this.lookDelta[1] += (e.clientY - drag.y) * s * 1.3;
      drag.x = e.clientX; drag.y = e.clientY;
    });
    el.addEventListener('pointerup', () => { drag = null; });
    el.addEventListener('pointercancel', () => { drag = null; });
    el.addEventListener('wheel', (e) => { this.zoomDelta *= Math.exp(e.deltaY * 0.001); e.preventDefault(); }, { passive: false });
  }

  onKey(f) { this.handlers.push(f); }
  held(...codes) { return codes.some((c) => this.keys.has(c)); }

  /** Smooths the controls toward what is held; speed in m/s (the wheel winds slower fast). */
  update(dt, speed) {
    const T = this.touch;
    let st = (this.held('KeyD', 'ArrowRight') ? 1 : 0) - (this.held('KeyA', 'ArrowLeft') ? 1 : 0);
    let th = this.held('KeyW', 'ArrowUp') ? 1 : 0;
    let br = this.held('KeyS', 'ArrowDown') ? 1 : 0;
    if (T.active) { st = st || T.steer; th = Math.max(th, T.throttle); br = Math.max(br, T.brake); }
    const keyboardSteer = !T.active || !T.steer;
    if (keyboardSteer) {
      const rate = 2.6 / (1 + speed / 18);
      const target = st;
      this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
      if (!st) this.steer *= Math.exp(-dt * 3);
    } else this.steer = st;
    this.throttle += Math.max(-dt * 6, Math.min(dt * 3.2, th - this.throttle));
    this.brake += Math.max(-dt * 8, Math.min(dt * 5, br - this.brake));
    this.handbrake = this.held('Space') || T.handbrake ? 1 : 0;
  }

  takeLook() { const d = this.lookDelta; this.lookDelta = [0, 0]; return d; }
  takeZoom() { const z = this.zoomDelta; this.zoomDelta = 1; return z; }
}
