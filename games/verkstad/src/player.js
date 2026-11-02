/**
 * You: a mechanic on your own feet. W A S D to walk (Shift: hurry), the mouse to look (click the
 * view to hold the mouse, Esc to let go, or drag), C to crouch and C again to lie on the creeper
 * (to get under a car that is on its wheels), C once more to stand. You cannot walk through the
 * car unless it is up on the lift above your head, nor through the benches, posts and walls.
 *
 * What you look at, within arm's reach (2.3 m), is what your hands and tools work on.
 */
import { Vector3, Raycaster, Vector2 } from 'three';

const EYES = [1.64, 1.0, 0.42], RAD = 0.3, REACH = 2.3;
const _v = new Vector3(), _d = new Vector3(), _r = new Raycaster(), _c = new Vector2(0, 0);

export class Player {
  constructor(game, { pos = [-1.2, 0, 3.6], yaw = 2.4 } = {}) {
    this.game = game;
    this.p = [...pos]; this.yaw = yaw; this.pitch = -0.15;
    this.pose = 0; this.eye = EYES[0];
    this.keys = new Set();
    this.bob = 0;
    this.locked = false; this.drag = null;
    this.mouse = { dx: 0, dy: 0, down: false, right: false };
    this.target = null;
    this._input();
  }

  _input() {
    const cv = this.game.canvas;
    addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return; this.keys.add(e.code); if (e.code === 'KeyC') this.pose = (this.pose + 1) % 3; });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    cv.addEventListener('mousedown', (e) => {
      if (this.game.uiOpen) return;
      if (!this.locked && e.button === 0 && !this.game.touch && !this.game.manual) { cv.requestPointerLock?.(); }
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
      if (!this.locked) this.drag = [e.clientX, e.clientY];
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; if (e.button === 2) this.mouse.right = false; this.drag = null; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === cv; });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.look(e.movementX, e.movementY); this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
      else if (this.drag) { const dx = e.clientX - this.drag[0], dy = e.clientY - this.drag[1]; this.drag = [e.clientX, e.clientY]; if (!this.mouse.down || !this.game.busyHand) this.look(dx, dy); this.mouse.dx += dx; this.mouse.dy += dy; }
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.game.wheel(Math.sign(e.deltaY), e.shiftKey); }, { passive: false });
  }

  look(dx, dy) {
    if (this.game.busyHand) return;           // turning a spanner: the mouse turns the spanner, not your head
    this.yaw -= dx * 0.0025; this.pitch = Math.max(-1.5, Math.min(1.45, this.pitch - dy * 0.0025));
  }

  /** Teleports (the dev/screenshot tool, Go to). */
  teleport(p, yaw, pitch) { this.p = [...p]; if (yaw != null) this.yaw = yaw; if (pitch != null) this.pitch = pitch; }

  update(dt, camera) {
    const g = this.game, k = this.keys;
    const speed = (k.has('ShiftLeft') ? 3.4 : 1.6) * (this.pose === 0 ? 1 : this.pose === 1 ? 0.45 : 0.35);
    let fx = 0, fz = 0;
    if (!g.uiOpen) {
      if (k.has('KeyW')) fz -= 1; if (k.has('KeyS')) fz += 1; if (k.has('KeyA')) fx -= 1; if (k.has('KeyD')) fx += 1;
      if (g.touchMove) { fx += g.touchMove[0]; fz += g.touchMove[1]; }
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) {
      fx /= Math.max(1, len); fz /= Math.max(1, len);
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      const vx = (fx * c + fz * s) * speed, vz = (-fx * s + fz * c) * speed;
      this._move(vx * dt, 0); this._move(0, vz * dt);
      this.bob += dt * speed * 4;
    }
    this.eye += (EYES[this.pose] - this.eye) * Math.min(1, dt * 6);
    camera.position.set(this.p[0], this.p[1] + this.eye + Math.sin(this.bob) * 0.012 * (this.pose === 0 ? 1 : 0), this.p[2]);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    this._aim(camera);
  }

  _blocked(x, z) {
    for (const [x0, z0, x1, z1] of this.game.workshop.colliders) if (x > x0 - RAD && x < x1 + RAD && z > z0 - RAD && z < z1 + RAD) return true;
    // the car: solid where its body is lower than your head (lying on the creeper you fit under the sills)
    const car = this.game.carBox?.();
    if (car) {
      const head = this.p[1] + this.eye + 0.12;
      const under = car.bottom > head || (this.pose === 2 && car.bottom > 0.12 && car.bottom + 0.0 > 0.14);
      const inside = x > car.x0 - RAD * 0.6 && x < car.x1 + RAD * 0.6 && z > car.z0 - RAD * 0.6 && z < car.z1 + RAD * 0.6;
      if (inside && !under && !(this.pose === 2 && car.bottom > 0.13)) return true;
    }
    return false;
  }

  _move(dx, dz) {
    const nx = this.p[0] + dx, nz = this.p[2] + dz;
    if (!this._blocked(nx, nz)) { this.p[0] = nx; this.p[2] = nz; }
    else if (this._blocked(this.p[0], this.p[2])) { this.p[0] = nx; this.p[2] = nz; }     // stuck inside something: let you out
  }

  /** What is under the crosshair, within reach: { kind: 'fast'|'part'|'item'|'world'|'loose', id, point, dist }. */
  _aim(camera) {
    const g = this.game;
    _r.setFromCamera(_c, camera);
    _r.far = REACH + 0.5;
    const list = g.pickables();
    const hits = _r.intersectObjects(list, false);
    this.target = null;
    for (const h of hits) {
      if (!h.object.visible || !visibleUp(h.object)) continue;
      if (h.distance > REACH + (h.object.userData.worldId ? 0.7 : 0)) break;
      const u = h.object.userData;
      if (u.held) continue;
      if (u.fastId) { this.target = { kind: 'fast', id: u.fastId, point: h.point, dist: h.distance }; break; }
      if (u.itemId) { this.target = { kind: 'item', id: u.itemId, point: h.point, dist: h.distance }; break; }
      if (u.looseId) { this.target = { kind: 'loose', id: u.looseId, point: h.point, dist: h.distance }; break; }
      if (u.partId) { this.target = { kind: 'part', id: u.partId, point: h.point, dist: h.distance }; break; }
      if (u.worldId) { this.target = { kind: 'world', id: u.worldId, point: h.point, dist: h.distance }; break; }
    }
  }

  /** The point a held thing sits at in front of you. */
  handPoint(out = new Vector3()) {
    const cam = this.game.stage.camera;
    cam.getWorldDirection(_d);
    return out.copy(cam.position).addScaledVector(_d, 0.55).add(_v.set(0, -0.18, 0));
  }
}

function visibleUp(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
