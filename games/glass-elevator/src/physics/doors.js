/**
 * The doors: the car's centre-opening door on its operator, and the thirty landing doors.
 *
 *  - The car door's two panels hang on rollers and are driven by a belt from the operator's
 *    motor on the car roof, under a speed controller with a profile: quick to open, slow to close,
 *    with the thrust held to 150 N and the speed so that the moving mass (both panels and, when
 *    coupled, the landing panels) carries no more than 10 J at the average closing speed.
 *  - At a floor the car door's vanes engage the landing door's rollers: the landing door's
 *    interlock lifts and its panels move with the car's. Away from the car, a landing door
 *    closes itself on its closing weight, and its interlock drops and locks it. The emergency
 *    unlocking key (the triangle in the door's head) lifts the interlock from the landing side.
 *  - Away from a floor the car door is locked (the hoistway is open outside the tower), so
 *    nobody can open it between floors; within the unlocking zone it can be pushed open by hand.
 *  - Whatever stands in the doorway pushes back on the panels: the door stalls on it and the
 *    controller reopens (the light curtain's 32 beams usually see it first).
 */
import { SPEC, FLOORS, floorY } from '../data/spec.js';

const D = SPEC.doors, T = D.panelTravel;

function friction(vFree, F, m, dt) {
  const dv = (F * dt) / m;
  if (Math.abs(vFree) <= dv) return 0;
  return vFree - Math.sign(vFree) * dv;
}

export class Doors {
  constructor() {
    this.car = { x: 0, v: 0, cmd: 'close', powered: true, nudge: false, Fext: 0, Fhand: 0, stall: 0, ke: 0, vt: 0, closeT: null, avgClose: 0, maxKE: 0 };
    this.landing = [null];
    for (let n = 1; n <= FLOORS; n++) this.landing.push({ x: 0, v: 0, locked: true, key: 0, Fhand: 0, Fext: 0 });
    this.coupled = 0;
    this.curtainBlocked = false;
    this.curtainFail = false;
  }

  get carClosed() { return this.car.x < 0.004; }
  get allLocked() { for (let n = 1; n <= FLOORS; n++) if (!this.landing[n].locked) return false; return true; }
  get carOpen() { return this.car.x > 0.995; }
  /** Clear opening (m) of the doorway. */
  get opening() { return 2 * T * Math.min(this.car.x, this.coupled ? this.landing[this.coupled].x : this.car.x); }

  step(dt, carY) {
    // the vanes reach the landing door's rollers within 12 cm of its level
    let cf = 0;
    for (let n = 1; n <= FLOORS; n++) if (Math.abs(carY - floorY(n)) < 0.12) { cf = n; break; }
    this.coupled = cf;
    const inZone = cf > 0 || this._nearAny(carY, SPEC.zones.door);
    // ---- the car door -------------------------------------------------------------------------
    const c = this.car, m = D.carPanel + (cf ? D.landingPanel : 0);
    let F = 0, vt = 0;
    if (c.powered) {
      if (c.cmd === 'open') {
        vt = Math.min(D.openSpeed, 0.03 + Math.sqrt(2 * 1.1 * (1 - c.x) * T));
        F = Math.max(-300, Math.min(300, 30 * m * (vt - c.v)));
        if (c.x >= 1) F = 25;
      } else if (c.cmd === 'close') {
        const pk = c.nudge ? 0.12 : D.closeSpeed;
        vt = -Math.min(pk, 0.025 + Math.sqrt(2 * 0.6 * c.x * T));
        F = Math.max(-D.maxForce, Math.min(D.maxForce, 30 * m * (vt - c.v)));
        if (c.x <= 0) F = -40;                       // the operator holds the door shut
      }
    }
    c.vt = vt;
    F += c.Fext + c.Fhand;
    const locked = !inZone && c.x < 0.004;            // the car door lock, away from the unlocking zone
    let v = friction(c.v + (F / m) * dt, 14, m, dt);
    if (locked && v > 0) v = 0;
    c.v = v;
    const cx0 = c.x;
    c.x += (v * dt) / T;
    // something standing in the doorway: the panels stop against it (and the door stalls, and reopens)
    const blockC = Math.max(c.block ?? 0, cf ? this.landing[cf].block ?? 0 : 0);
    if (blockC > 0 && c.x < blockC && cx0 >= blockC - 0.02) { c.x = blockC; c.v = Math.max(0, c.v); }
    if (c.x <= 0) { c.x = 0; c.v = Math.max(0, c.v); }
    if (c.x >= 1) { c.x = 1; c.v = Math.min(0, c.v); }
    // stalled against something in the doorway while closing
    if (c.powered && c.cmd === 'close' && c.x > 0.02 && c.v > vt * 0.35 && vt < -0.08) c.stall += dt; else c.stall = Math.max(0, c.stall - dt * 2);
    c.ke = 0.5 * (2 * m) * c.v * c.v;
    if (c.cmd === 'close' && c.v < 0) c.maxKE = Math.max(c.maxKE, c.ke);
    // the average closing speed, timed from fully open to closed
    if (c.cmd === 'close' && c.x > 0.995) c.closeT = 0;
    else if (c.closeT !== null && c.cmd === 'close') { c.closeT += dt; if (c.x <= 0) { c.avgClose = T / c.closeT; c.avgKE = 0.5 * 2 * m * c.avgClose * c.avgClose; c.closeT = null; } }
    else c.closeT = null;
    c.Fext = 0;
    // ---- the landing doors --------------------------------------------------------------------
    for (let n = 1; n <= FLOORS; n++) {
      const L = this.landing[n];
      L.key = Math.max(0, L.key - dt);
      if (n === cf && (c.x > 0.002 || L.x < 0.002)) {
        // coupled: the landing panels ride with the car's (their hand and obstruction forces went to the car door)
        L.x = c.x; L.v = c.v;
        L.locked = c.x < 0.002 && L.key <= 0 && !L.broken;
        L.Fhand = 0; L.Fext = 0;
        continue;
      }
      if (L.locked && (L.key > 0 || L.broken)) L.locked = false;
      if (L.locked) { L.v = 0; L.Fhand = 0; L.Fext = 0; continue; }
      // self-closing on its weight, slowed by its damper
      const Fl = -45 + L.Fhand + L.Fext - 60 * L.v;
      L.v = friction(L.v + (Fl / D.landingPanel) * dt, 10, D.landingPanel, dt);
      const lx0 = L.x;
      L.x += (L.v * dt) / T;
      if ((L.block ?? 0) > 0 && L.x < L.block && lx0 >= L.block - 0.02) { L.x = L.block; L.v = Math.max(0, L.v); }
      if (L.x >= 1) { L.x = 1; L.v = Math.min(0, L.v); }
      if (L.x <= 0) { L.x = 0; L.v = 0; if (L.key <= 0 && !L.broken) L.locked = true; }
      L.Fhand = 0; L.Fext = 0;
    }
    c.Fhand = 0;
  }

  _nearAny(y, zone) { for (let n = 1; n <= FLOORS; n++) if (Math.abs(y - floorY(n)) < zone) return true; return false; }

  /** The emergency unlocking key turned in floor n's landing door head (holds the lock off for a few seconds). */
  unlock(n) { const L = this.landing[n]; if (!L) return; L.key = 6; L.locked = false; }
}
