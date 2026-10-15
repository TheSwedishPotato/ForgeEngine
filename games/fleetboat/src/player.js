/**
 * You, aboard: walking the boat on your own feet (WASD, the mouse to look, Shift to hurry), up
 * and down her ladders (E at the foot or the head of one: the conning tower, the bridge when the
 * hatch is open, the pump room, the trunk up into your observation deck), through the watertight
 * doors when they stand open (stepping over the sill, ducking the coaming). Everything is in the
 * boat's own frame, so you stand on her deck as she rolls and pitches: the world moves, not you.
 *
 * V steps outside for a free look at her from any side (drag to turn, wheel to come closer),
 * above or under the sea.
 */
import { Vector3, Quaternion, Matrix4 } from 'three';
import { DECK, AXIS, LEVELS, LADDERS, DOOR_LIST, hullRadiusAt, compartmentAt, corridorAt } from './data/layout.js';
import { HULL, FT } from './data/boat.js';
import { OBS_DECK } from './physics/mass.js';
import { fairHalf } from './render/hullGL.js';

const EYE = 1.62;
const _v = new Vector3(), _d = new Vector3(), _u = new Vector3(), _m = new Matrix4(), _q = new Quaternion();
const LEVEL_Y = { main: DECK, ct: LEVELS.ct.y, bridge: HULL.bridgeDeck, pump: LEVELS.pump.y, obs: LEVELS.obs.y };

export class Player {
  constructor(game, { level = 'obs', x = OBS_DECK.x - 0.6, z = 0.3, yaw = 0.9 } = {}) {
    this.game = game;
    this.mode = 'walk';
    this.p = { level, x, z };
    this.yaw = yaw; this.pitch = -0.05;
    this.bob = 0;
    this.keys = new Set();
    this.sens = 0.0022;
    this.orbit = { yaw: 2.4, pitch: 0.18, dist: 70, target: new Vector3() };
    this.climb = null;
    this.hint = '';
    this._bind();
  }

  _bind() {
    const canvas = this.game.canvas;
    canvas.addEventListener('click', () => { if (!document.pointerLockElement && this.mode === 'walk') { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag to look */ } } });
    canvas.addEventListener('wheel', (e) => { if (this.mode === 'orbit') this.orbit.dist = Math.max(8, Math.min(600, this.orbit.dist * Math.exp(e.deltaY * 0.001))); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyV') this.mode = this.mode === 'orbit' ? 'walk' : 'orbit';
      if (e.code === 'KeyE' && this.mode === 'walk' && !this.climb) this.ladder();
    });
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this._px = e.clientX; this._py = e.clientY; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === canvas || !this.dragging) return;
      const dx = e.clientX - this._px, dy = e.clientY - this._py;
      this._px = e.clientX; this._py = e.clientY;
      this.look(dx * 1.3, dy * 1.3);
    });
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) this.look(e.movementX, e.movementY); });
  }

  look(dx, dy) {
    if (this.mode === 'orbit') { this.orbit.yaw -= dx * 0.004; this.orbit.pitch = Math.max(-1.2, Math.min(1.4, this.orbit.pitch + dy * 0.004)); return; }
    this.yaw += dx * this.sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * this.sens));
  }

  /** How much of the view is the sea (for the eye's adaptation): outside or in the observation deck, all of it. */
  lookingAtSea() {
    if (this.mode === 'orbit' || this.p.level === 'obs' || this.p.level === 'bridge') return 1;
    return 0;
  }

  /** Where you are, for the HUD. */
  where() {
    const p = this.p;
    if (this.mode === 'orbit') return 'Outside';
    if (p.level === 'obs') return 'Observation deck';
    if (p.level === 'ct') return 'Conning tower';
    if (p.level === 'bridge') return 'Bridge';
    if (p.level === 'pump') return 'Pump room';
    return compartmentAt(p.x)?.name ?? '';
  }

  /** The ladder within reach, if any, and where it leads. */
  nearLadder() {
    const p = this.p;
    for (const L of LADDERS) {
      if (L.from !== p.level && L.to !== p.level) continue;
      if (Math.hypot(p.x - L.x, p.z - L.z) < 0.8) return { L, to: L.from === p.level ? L.to : L.from };
    }
    return null;
  }

  /** Climbs the ladder at hand (the hatch above must be open). */
  ladder() {
    const n = this.nearLadder();
    if (!n) return false;
    const ctl = this.game.sim.plant.ctl;
    if (n.L.hatch && (+ctl[`hatch.${n.L.hatch}`] || 0) < 0.6) { this.game.sim.say(`The ${n.L.hatch === 'ctUpper' ? 'upper' : n.L.hatch === 'ctLower' ? 'lower' : ''} hatch is shut.`); return false; }
    const up = LEVEL_Y[n.to] > LEVEL_Y[this.p.level];
    const h = Math.abs(LEVEL_Y[n.to] - LEVEL_Y[this.p.level]);
    this.climb = { from: this.p.level, to: n.to, t: 0, T: 0.8 + h * 0.75, x: n.L.x - (up ? 0.05 : 0.05), z: n.L.z, y0: LEVEL_Y[this.p.level], y1: LEVEL_Y[n.to] };
    return true;
  }

  /** Can you stand at boat x, z on this level? Returns the corrected position. */
  _confine(level, x0, z0, x, z) {
    const L = LEVELS[level];
    x = Math.max(L.x0, Math.min(L.x1, x));
    if (level === 'main') {
      // the hull's breadth at the shoulders, less a margin for the equipment along the sides
      const r = hullRadiusAt(x), y = DECK + 1.2;
      const half = Math.min(corridorAt(x, 'main') + 0.55, Math.sqrt(Math.max(0, r * r - (y - AXIS) ** 2)) - 0.45);
      z = Math.max(-half, Math.min(half, z));
      // the bulkheads: through the doors only, and only when they are open
      for (const d of DOOR_LIST) {
        const crossing = (x0 - d.x) * (x - d.x) <= 0 && Math.abs(x - x0) > 0;
        const near = Math.abs(x - d.x) < 0.22;
        if (!crossing && !near) continue;
        const open = (+this.game.sim.plant.ctl[`door.${d.i}`] || 0) > 0.55;
        if (open && Math.abs(z) < 0.2) { z = Math.max(-0.2, Math.min(0.2, z)); continue; }
        // held on your own side
        x = x0 > d.x ? Math.max(x, d.x + 0.23) : Math.min(x, d.x - 0.23);
      }
    } else if (level === 'bridge') {
      const half = Math.max(0.1, fairHalf(x) - 0.3);
      z = Math.max(-half, Math.min(half, z));
    } else {
      const half = corridorAt(x, level);
      z = Math.max(-half, Math.min(half, z));
    }
    return [x, z];
  }

  update(dt, camera) {
    const g = this.game, boat = g.boatGL;
    if (this.mode === 'orbit') return this._orbit(dt, camera);
    const p = this.p;
    if (this.climb) {
      const c = this.climb;
      c.t += dt;
      const k = Math.min(1, c.t / c.T);
      p.x = c.x; p.z = c.z;
      const y = c.y0 + (c.y1 - c.y0) * k;
      if (k >= 1) { p.level = c.to; this.climb = null; p.x = c.x + (c.y1 > c.y0 ? 0.0 : 0.0) + (c.to === 'main' || c.to === 'pump' ? 0.45 : 0.45); }
      this._camera(camera, y + EYE, 0);
      return;
    }
    // walking
    const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const sp = (run ? 2.6 : 1.35) * dt;
    let f = 0, s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    const l = Math.hypot(f, s) || 1;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const nx = p.x + ((f * cy - s * sy) / l) * sp, nz = p.z + ((f * sy + s * cy) / l) * sp;
    const [cx, cz] = this._confine(p.level, p.x, p.z, nx, nz);
    const moved = Math.hypot(cx - p.x, cz - p.z);
    p.x = cx; p.z = cz;
    this.bob += moved * 3.2;
    const n = this.nearLadder();
    this.hint = n ? `E: climb ${LEVEL_Y[n.to] > LEVEL_Y[p.level] ? 'up' : 'down'} to the ${n.to === 'main' ? 'main deck' : n.to === 'ct' ? 'conning tower' : n.to === 'obs' ? 'observation deck' : n.to === 'pump' ? 'pump room' : 'bridge'}` : '';
    // ducking through a door's coaming
    let duck = 0;
    if (p.level === 'main') for (const d of DOOR_LIST) duck = Math.max(duck, Math.max(0, 1 - Math.abs(p.x - d.x) / 0.5) * 0.32);
    this._camera(camera, LEVEL_Y[p.level] + EYE - duck + Math.sin(this.bob) * 0.012, duck);
    void boat;
  }

  _camera(camera, y, duck) {
    const boat = this.game.boatGL, p = this.p;
    const M = boat.inner.matrixWorld;
    camera.position.set(p.x, y, p.z).applyMatrix4(M);
    // the look direction and up in the boat's frame, into the world
    const cp = Math.cos(this.pitch - duck * 0.6), d = _d.set(cp * Math.cos(this.yaw), Math.sin(this.pitch - duck * 0.6), cp * Math.sin(this.yaw));
    _q.setFromRotationMatrix(_m.extractRotation(M));
    d.applyQuaternion(_q);
    camera.up.set(0, 1, 0).applyQuaternion(_q);
    camera.lookAt(_v.copy(camera.position).add(d));
  }

  _orbit(dt, camera) {
    const boat = this.game.boatGL, o = this.orbit;
    boat.toWorld(0, 6.5, 0, o.target);
    const k = this.keys;
    if (k.has('KeyW')) o.dist = Math.max(8, o.dist * (1 - dt));
    if (k.has('KeyS')) o.dist = Math.min(600, o.dist * (1 + dt));
    const cp = Math.cos(o.pitch);
    camera.position.set(o.target.x + Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z + Math.cos(o.yaw) * cp * o.dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(o.target);
  }
}

export { LEVEL_Y, EYE, FT };
