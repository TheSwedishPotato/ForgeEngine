/**
 * You, aboard: walking the boat on your own feet (WASD, the mouse to look, Shift to hurry), up
 * and down her ladders (E at the foot or the head of one: the conning tower, the bridge when the
 * hatch is open, the pump room, the trunk up into your observation deck), through the watertight
 * doors when they stand open (stepping over the sill, ducking the coaming). Everything is in the
 * boat's own frame, so you stand on her deck as she rolls and pitches: the world moves, not you.
 *
 * V steps outside for a free look at her from any side (drag to turn, wheel to come closer),
 * above or under the sea.
 *
 * Your hands work the boat's controls as the crew's do: look at one within reach, then hold the
 * left button to open a valve, turn a wheel, throw a lever to its next position, switch on; the
 * right button to shut, turn back, throw back, switch off. At a person's speed: a valve's
 * handwheel goes round a turn or so a second, a big valve takes its time.
 */
import { Vector3, Quaternion, Matrix4 } from 'three';
import { DECK, AXIS, LEVELS, LADDERS, DOOR_LIST, hullRadiusAt, compartmentAt, corridorAt } from './data/layout.js';
import { HULL, FT } from './data/boat.js';
import { OBS_DECK } from './physics/mass.js';
import { fairHalf } from './render/hullGL.js';
import { CONTROLS } from './data/controls.js';

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
      if (e.code === 'KeyE' && this.mode === 'scope') { this.leaveScope(); return; }
      if (e.code === 'KeyE' && this.mode === 'walk' && !this.climb) { if (!this.takeScope()) this.ladder(); }
      if (e.code === 'KeyF' && this.mode === 'scope') this.scope.power = this.scope.power > 2 ? 1.5 : 6;
    });
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true; this._px = e.clientX; this._py = e.clientY;
      if (this.mode === 'walk' && this.aim && (document.pointerLockElement === canvas || e.button === 2 || e.shiftKey)) { this.working = e.button === 2 ? -1 : 1; this._throw = 0; }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerup', () => { this.dragging = false; this.working = 0; });
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === canvas || !this.dragging) return;
      const dx = e.clientX - this._px, dy = e.clientY - this._py;
      this._px = e.clientX; this._py = e.clientY;
      this.look(dx * 1.3, dy * 1.3);
    });
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) this.look(e.movementX, e.movementY); });
  }

  /** At a periscope in the conning tower: take it (it must be up). */
  takeScope() {
    const p = this.p;
    if (p.level !== 'ct') return false;
    const i = [10.85, 9.75].findIndex((x) => Math.abs(p.x - x) < 0.7 && Math.abs(p.z - 0.35) < 0.8);
    if (i < 0) return false;
    if (this.game.sim.plant.scopes[i] < 0.95) { this.game.sim.say(`No. ${i + 1} periscope is down: its hoist switch is on the overhead.`); return true; }
    this.mode = 'scope';
    this.scope = { i, yaw: this.yaw, pitch: 0, power: 1.5 };
    this.game.ui?.scope?.(true);
    return true;
  }
  leaveScope() { this.mode = 'walk'; this.game.ui?.scope?.(false); this.game.stage.camera.fov = 66; this.game.stage.camera.updateProjectionMatrix(); }

  look(dx, dy) {
    if (this.mode === 'scope') { const k = 0.0016 / this.scope.power; this.scope.yaw += dx * k * 3; this.scope.pitch = Math.max(-0.17, Math.min(0.17, this.scope.pitch - dy * k * 3)); return; }
    if (this.mode === 'orbit') { this.orbit.yaw -= dx * 0.004; this.orbit.pitch = Math.max(-1.2, Math.min(1.4, this.orbit.pitch + dy * 0.004)); return; }
    this.yaw += dx * this.sens;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * this.sens));
  }

  /** The control you are looking at, within reach (boat coordinates). */
  _aim(eyeY) {
    const p = this.p;
    const cp = Math.cos(this.pitch), dir = [cp * Math.cos(this.yaw), Math.sin(this.pitch), cp * Math.sin(this.yaw)];
    let best = null, bestA = 0.2;
    for (const c of CONTROLS) {
      if ((c.level ?? 'main') !== p.level) continue;
      const v = [c.pos[0] - p.x, c.pos[1] - eyeY, c.pos[2] - p.z];
      const d = Math.hypot(...v);
      if (d > 1.45 || d < 0.05) continue;
      const cos = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / d;
      const a = Math.acos(Math.max(-1, Math.min(1, cos))) - Math.atan((c.size ?? 0.05) * 1.6 / d);
      if (a < bestA) { bestA = a; best = c; }
    }
    return best;
  }

  /** Works the control in your hands (dir +1 open / on / next, -1 shut / off / back). */
  _work(dt, c, dir) {
    const ctl = this.game.sim.plant.ctl, v = ctl[c.id];
    if (c.kind === 'lever' || c.kind === 'telegraph') {
      this._throw -= dt;
      if (this._throw > 0) return;
      const st = c.states, i = st.indexOf(v), k = Math.max(0, Math.min(st.length - 1, i + dir));
      ctl[c.id] = st[k];
      this._throw = 0.55;
      return;
    }
    if (c.kind === 'switch') { ctl[c.id] = dir > 0 ? 1 : 0; this.working = 0; return; }
    if (c.kind === 'button') { ctl[c.id] = dir > 0 ? 1 : 0; return; }
    const rate = c.kind === 'valve' ? (c.rate ?? 1) / Math.max(0.1, c.turns ?? 1) : c.kind === 'wheel' ? c.rate ?? 12 : c.kind === 'rheostat' ? c.rate ?? 0.25 : c.kind === 'door' ? 1 / 3.5 : 1 / 3;
    const lo = c.kind === 'wheel' ? c.min ?? -25 : 0, hi = c.kind === 'wheel' ? c.max ?? 25 : 1;
    ctl[c.id] = Math.max(lo, Math.min(hi, (+v || 0) + dir * rate * dt));
  }

  /** What a control shows: its label and setting, as you would read it. */
  static describe(c, v) {
    if (c.kind === 'valve' || c.kind === 'door' || c.kind === 'hatch') { const k = +v || 0; return `${c.label}: ${k <= 0.001 ? 'shut' : k >= 0.999 ? 'open' : `${Math.round(k * 100)}% open`}`; }
    if (c.kind === 'switch') return `${c.label}: ${+v > 0.5 ? 'on' : 'off'}`;
    if (c.kind === 'wheel') return `${c.label}: ${Math.abs(+v || 0) < 0.5 ? 'zero' : `${Math.abs(Math.round(+v))}° ${c.id.includes('helm') ? (+v > 0 ? 'right' : 'left') : (+v > 0 ? 'rise' : 'dive')}`}`;
    if (c.kind === 'rheostat') return `${c.label}: ${Math.round((+v || 0) * 100)}%`;
    if (c.kind === 'button') return `${c.label}`;
    return `${c.label}: ${v}`;
  }

  /** How much of the view is the sea (for the eye's adaptation): outside or in the observation deck, all of it. */
  lookingAtSea() {
    if (this.mode === 'orbit' || this.mode === 'scope' || this.p.level === 'obs' || this.p.level === 'bridge') return 1;
    return 0;
  }

  /** Where you are, for the HUD. */
  where() {
    const p = this.p;
    if (this.mode === 'orbit') return 'Outside';
    if (this.mode === 'scope') return 'At the periscope';
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
    if (this.mode === 'scope') return this._scope(dt, camera);
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
    // what you are looking at, and working it
    this.aim = this._aim(LEVEL_Y[p.level] + EYE);
    if (this.aim && this.working) this._work(dt, this.aim, this.working);
    if (!this.working && this.aim?.kind === 'button') this.game.sim.plant.ctl[this.aim.id] = 0;
    const n = this.nearLadder();
    if (this.aim) { this.hint = `${Player.describe(this.aim, this.game.sim.plant.ctl[this.aim.id])}   ·   left button: ${this.aim.kind === 'valve' || this.aim.kind === 'door' || this.aim.kind === 'hatch' ? 'open' : this.aim.kind === 'switch' ? 'on' : this.aim.kind === 'wheel' ? 'turn' : 'push'}, right: ${this.aim.kind === 'valve' || this.aim.kind === 'door' || this.aim.kind === 'hatch' ? 'shut' : this.aim.kind === 'switch' ? 'off' : 'back'}`; }
    else this.hint = n ? `E: climb ${LEVEL_Y[n.to] > LEVEL_Y[p.level] ? 'up' : 'down'} to the ${n.to === 'main' ? 'main deck' : n.to === 'ct' ? 'conning tower' : n.to === 'obs' ? 'observation deck' : n.to === 'pump' ? 'pump room' : 'bridge'}` : '';
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

  /** Looking through a periscope: the eye at its head, its power 1.5 (32 degrees) or 6 (8 degrees). */
  _scope(dt, camera) {
    const P = this.game.sim.plant, S = this.scope;
    if (P.scopes[S.i] < 0.9) { this.leaveScope(); return; }
    const x = [10.85, 9.75][S.i];
    const y = HULL.periscopeDownTop - 0.06 + P.scopes[S.i] * (HULL.periscopeUpTop - HULL.periscopeDownTop);
    const fov = S.power > 2 ? 8 : 32;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const save = { x: this.p.x, z: this.p.z, yaw: this.yaw, pitch: this.pitch };
    this.p.x = x; this.p.z = 0; this.yaw = S.yaw; this.pitch = S.pitch;
    this._camera(camera, y, 0);
    Object.assign(this.p, { x: save.x, z: save.z }); this.yaw = save.yaw; this.pitch = save.pitch;
    const h = (P.g.heading + (S.yaw * 180) / Math.PI + 720) % 360;
    this.hint = `No. ${S.i + 1} periscope · bearing ${String(Math.round(h)).padStart(3, '0')} · power ${S.power} (F) · E to step back`;
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
