/**
 * You: on your own feet in the tower (W A S D, the mouse to look, Shift to hurry), riding the car
 * (you stand on its floor, so you go where it goes, feel it start and stop, and weigh 80 kg on
 * its load weighing), up and down the stairs (E and Q at a stairs door), out to the plaza, down
 * the pit ladder, onto the car roof from a landing (with the landing door opened by its triangle
 * key, and the car stopped below the sill, as a lift engineer does).
 *
 * Your hands: look at anything and use the left button. A button is pressed (and held while you
 * hold it), a switch flips, a key turns; a loose thing is picked up by the point you hold it and
 * comes with your hand (the wheel brings it nearer or further, the right button throws it); a door
 * panel or a lever is pulled. All with a person's strength: about 450 N.
 *
 * V steps outside for a free look at the hoistway (drag to turn, wheel to come closer, W and S to
 * go up and down, F to follow the car); clicking works from there too.
 */
import { Vector3, Raycaster, Vector2 } from 'three';
import { FLOORS, floorY, MR, PIT_Y, FACADE } from './data/spec.js';
import { PIT, LOBBY, LOBBY1 } from './render/buildingGL.js';
import { overlap } from './physics/bodies.js';
import { boxMesh } from './render/build.js';

const EYE = 1.62, RAD = 0.28, HEIGHT = 1.8, STEP = 0.42, MASS = 80, REACH = 2.4;
const _v = new Vector3(), _d = new Vector3(), _r = new Raycaster(), _m = new Vector2();

export class Player {
  constructor(game, { pos = [0.6, 0, 12.4], yaw = Math.PI / 2 + 0.1 } = {}) {
    this.game = game;
    this.mode = 'walk';
    this.p = [...pos]; this.v = [0, 0, 0];
    this.yaw = yaw; this.pitch = -0.05;
    this.keys = new Set();
    this.grounded = true; this.ground = null; this.peak = pos[1];
    this.bob = 0; this.dip = 0;
    this.orbit = { yaw: 0.6, pitch: 0.12, dist: 26, y: 8, follow: true };
    this.held = null; this.hint = ''; this.aimLabel = '';
    this.mouse = null;
    this._bind();
    const self = this;
    // you push loose things about as you walk into them (as hard as a person leans: 450 N)
    this.body = game.world.mover({ bounds: () => (this.mode === 'walk' ? [[this.p[0] - RAD, this.p[1] + 0.15, this.p[2] - RAD], [this.p[0] + RAD, this.p[1] + HEIGHT, this.p[2] + RAD]] : null), vel: () => this.v, maxPush: 450 * 0.004, mu: 0.3, cyl: { get p() { return self.p; }, r: RAD, h: HEIGHT } });
  }

  _bind() {
    const canvas = this.game.canvas;
    const locked = () => document.pointerLockElement === canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.held?.body) this.held.dist = Math.max(0.5, Math.min(3, this.held.dist - e.deltaY * 0.002));
      else if (this.mode === 'orbit') this.orbit.dist = Math.max(3, Math.min(400, this.orbit.dist * Math.exp(e.deltaY * 0.001)));
    }, { passive: true });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this._release(); });
    window.addEventListener('keydown', (e) => {
      if (e.target?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.code === 'KeyV') { this._release(); this.mode = this.mode === 'orbit' ? 'walk' : 'orbit'; if (this.mode === 'orbit' && locked()) document.exitPointerLock?.(); }
      if (e.code === 'KeyF' && this.mode === 'orbit') this.orbit.follow = !this.orbit.follow;
      if ((e.code === 'KeyE' || e.code === 'KeyQ') && this.mode === 'walk') this._spot(e.code === 'KeyE' ? 1 : -1);
    });
    canvas.addEventListener('pointerdown', (e) => {
      this._px = e.clientX; this._py = e.clientY; this.dragging = true; this._moved = 0;
      const ray = locked() || this.game.touch ? null : [e.clientX, e.clientY];
      if (e.button === 2) { if (this.held?.body) this._throw(); return; }
      if (e.button !== 0) return;
      const hit = this.game.touch ? null : this._pick(ray);      // on a touch screen the Use button is your hand
      if (hit) { this._grab(hit); return; }
      if (!locked() && this.mode === 'walk' && !this.game.touch) { this._wantLock = true; }
    });
    window.addEventListener('pointerup', (e) => {
      this.dragging = false;
      if (e.button === 0 && !this.game.touch) this._release();      // on a touch screen the Use button lets go
      if (this._wantLock && this._moved < 6) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* drag to look instead */ } }
      this._wantLock = false;
    });
    window.addEventListener('pointermove', (e) => {
      this.mouse = [e.clientX, e.clientY];
      if (locked() || !this.dragging) return;
      const dx = e.clientX - this._px, dy = e.clientY - this._py;
      this._px = e.clientX; this._py = e.clientY; this._moved += Math.abs(dx) + Math.abs(dy);
      if (this.game.touch || !this.held || this.held.control) this.look(dx * (this.game.touch ? 2 : 1.2), dy * (this.game.touch ? 2 : 1.2));
    });
    document.addEventListener('mousemove', (e) => { if (locked()) this.look(e.movementX, e.movementY); });
  }

  look(dx, dy) {
    if (this.mode === 'orbit') { this.orbit.yaw -= dx * 0.004; this.orbit.pitch = Math.max(-1.3, Math.min(1.4, this.orbit.pitch + dy * 0.004)); return; }
    this.yaw += dx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022));
  }

  // ---------------------------------------------------------------------------------------------
  // Hands

  /** What is under the crosshair (or the mouse pointer when it is free). */
  _pick(screen) {
    const cam = this.game.stage.camera;
    if (screen) _m.set((screen[0] / innerWidth) * 2 - 1, -(screen[1] / innerHeight) * 2 + 1); else _m.set(0, 0);
    _r.setFromCamera(_m, cam);
    const reach = this.mode === 'orbit' ? 500 : REACH;
    _r.far = reach;
    const o = _r.ray.origin, d = _r.ray.direction;
    const hits = _r.intersectObjects(this.game.controls.meshes, false);
    let best = hits.length ? { t: hits[0].distance, control: hits[0].object.userData.control, mesh: hits[0].object, point: hits[0].point.clone() } : null;
    const b = this.game.world.pick([o.x, o.y, o.z], [d.x, d.y, d.z], reach);
    if (b && (!best || b.t < best.t)) best = { t: b.t, body: b.body, point: new Vector3(...b.P) };
    // nothing nearer in the way? (a wall between you and a button)
    if (best) { const w = _r.intersectObjects(this.game.occluders, false)[0]; if (w && w.distance < best.t - 0.05) return null; }
    return best;
  }

  _grab(hit) {
    if (hit.body?.tool) { this.game.tools.take(hit.body); return; }
    if (hit.body) {
      const b = hit.body;
      this.held = { body: b, dist: Math.max(0.6, Math.min(2.5, hit.t)) };
      this.game.world.hand = { body: b, local: b.toLocal([hit.point.x, hit.point.y, hit.point.z]), target: [hit.point.x, hit.point.y, hit.point.z] };
      return;
    }
    const c = hit.control;
    if (c.kind === 'grab') { this.held = { control: c, mesh: hit.mesh, local: hit.mesh.worldToLocal(hit.point.clone()), dist: hit.t }; return; }
    c.down?.();
    this.game.sim.sfx(c.kind === 'switch' || c.kind === 'key' ? 'clack' : 'click', { at: [hit.point.x, hit.point.y, hit.point.z] });
    this.held = { control: c, press: true };
  }
  _release() {
    const H = this.held;
    if (!H) return;
    if (H.body) this.game.world.hand = null;
    if (H.control) H.control.up?.();
    this.held = null;
  }
  _throw() {
    const H = this.held, b = H.body, cam = this.game.stage.camera;
    cam.getWorldDirection(_d);
    const s = Math.min(9, 140 / b.mass);
    b.v = [b.v[0] + _d.x * s, b.v[1] + _d.y * s + 1, b.v[2] + _d.z * s];
    this._release();
  }

  _hands(cam) {
    const H = this.held;
    cam.getWorldDirection(_d);
    if (H?.body) {
      // your hand stops at the wall: it cannot push what it holds through one
      let reach = H.dist;
      const o = cam.position, W = this.game.world, r = Math.min(...H.body.half);
      const boxes = W.solids.map((s) => [s.min, s.max]);
      for (const m of W.movers) if (m.active && !m.maxPush && m.box) boxes.push(m.box);
      for (const [lo, hi] of boxes) {
        let t0 = 0, t1 = reach;
        for (let i = 0; i < 3; i++) {
          const oi = [o.x, o.y, o.z][i], di = [_d.x, _d.y, _d.z][i];
          if (Math.abs(di) < 1e-9) { if (oi < lo[i] || oi > hi[i]) { t0 = Infinity; break; } continue; }
          let a = (lo[i] - oi) / di, b = (hi[i] - oi) / di;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, b);
          if (t0 > t1) { t0 = Infinity; break; }
        }
        if (t0 > 0.05 && t0 < reach) reach = t0;
      }
      // and never closer than arm's length allows (it stays in front of you, not inside you)
      reach = Math.max(RAD + Math.max(...H.body.half) + 0.08, reach - r - 0.05);
      const t = _v.copy(cam.position).addScaledVector(_d, Math.min(H.dist, reach));
      this.game.world.hand.target = [t.x, t.y, t.z];
      this.hint = `Holding: ${H.body.name} · wheel: nearer / further · right button: throw · let go to drop`;
      return;
    }
    if (H?.control?.kind === 'grab') {
      const P = H.mesh.localToWorld(H.local.clone());
      const t = _v.copy(cam.position).addScaledVector(_d, H.dist);
      H.control.drag([t.x - P.x, t.y - P.y, t.z - P.z]);
      this.hint = H.control.hint?.() ?? H.control.label;
      return;
    }
    const hit = this.mode === 'walk' || this.mouse ? this._pick(document.pointerLockElement || this.game.touch ? null : this.mouse) : null;
    if (hit?.body?.tool) this.hint = `${hit.body.name} · click to put it on your tool belt`;
    else if (hit?.body) this.hint = `${hit.body.name} · hold the left button to pick it up`;
    else if (hit?.control) { const c = hit.control; this.hint = c.hint?.() ?? `${c.label} · ${c.kind === 'hold' ? 'hold the left button' : c.kind === 'grab' ? 'hold and drag' : 'click'}`; }
    else this.hint = this._nearSpot()?.label ?? '';
  }

  // ---------------------------------------------------------------------------------------------
  // Stairs, ladders and doors you go through with E or Q

  _nearSpot() {
    for (const s of this.game.buildingGL.spots) if (Math.hypot(this.p[0] - s.pos[0], this.p[2] - s.pos[2]) < 1.2 && Math.abs(this.p[1] - s.pos[1]) < 1.2) return s;
    return null;
  }
  _spot(dir) {
    const s = this._nearSpot();
    if (!s) return;
    const say = (t) => this.game.sim.say(t, 'You');
    const stairs = (n) => { const L = n === 1 ? LOBBY1 : LOBBY; this.teleport([L.x0 + 0.6, floorY(n), 12.2], 0); };
    if (s.kind === 'stairs') {
      if (dir > 0 && s.floor === FLOORS) { this.teleport([1.9, MR.floor, MR.z0 + 0.7], Math.PI / 2); say('Up the last flight and out onto the roof, into the machine room.'); }
      else if (dir > 0) { stairs(s.floor + 1); say(`Up the stairs to floor ${s.floor + 1}.`); }
      else if (s.floor > 1) { stairs(s.floor - 1); say(`Down the stairs to floor ${s.floor - 1}.`); }
    } else if (s.kind === 'mrDoor') { stairs(FLOORS); say('Down from the machine room to floor 30.'); }
    else if (s.kind === 'pitDoor' && dir > 0) { this.teleport([PIT.x1 - 0.3, PIT_Y, PIT.z1 - 0.55], -Math.PI / 2); say('Through the pit door and down the ladder into the pit. (The pit STOP switch is on the wall by the ladder.)'); }
    else if (s.kind === 'pitLadder') { this.teleport([PIT.x1 + 0.6, 0, FACADE + 1.8], 0); say('Up the pit ladder, out onto the plaza.'); }
  }

  teleport(pos, yaw) { this._release(); this.p = [...pos]; this.v = [0, 0, 0]; this.peak = pos[1]; this.grounded = true; if (yaw !== undefined) this.yaw = yaw; this.mode = 'walk'; }

  // ---------------------------------------------------------------------------------------------
  // Walking: a cylinder 0.56 m across and 1.8 m tall among the world's boxes

  _boxes() {
    const W = this.game.world, out = [];
    const lo = [this.p[0] - 3, this.p[1] - 6, this.p[2] - 3], hi = [this.p[0] + 3, this.p[1] + 4, this.p[2] + 3];
    for (const s of W.solids) if (overlap([s.min, s.max], [lo, hi])) out.push({ min: s.min, max: s.max, v: null });
    for (const m of W.movers) { if (m === this.body) continue; const box = m.bounds(); if (box && overlap(box, [lo, hi])) out.push({ min: box[0], max: box[1], v: m.vel ? m.vel() : null, car: m.car }); }
    for (const b of W.bodies) if (b.mass >= 40 && b !== this.held?.body) { const [a, c] = b.aabb(); if (overlap([a, c], [lo, hi])) out.push({ min: a, max: c, v: b.v }); }
    return out;
  }

  _walk(dt) {
    const p = this.p, k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    let f = 0, s = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) s += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) s -= 1;
    const l = Math.hypot(f, s) || 1, sp = run ? 3.0 : 1.4;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    let want = [((f * cy - s * sy) / l) * sp, ((f * sy + s * cy) / l) * sp];
    const R = this.rope;
    if (R) {
      // on the rope: forward climbs, back lowers you (Shift: faster); at the top, forward steps out
      this.peak = p[1];
      if (R.fresh && !this.grounded) R.fresh = false;
      if (p[1] >= R.y0 - 0.03 && f > 0) { want = [0, -1.0]; this.v[1] = 0; p[1] = Math.max(p[1], R.y0); }
      else { want = [(s * -sy) * 0.4, (s * cy) * 0.4]; this.v[1] = f * (run ? 1.2 : 0.5); }
      if (p[1] > R.y0 && this.v[1] > 0) { p[1] = R.y0; this.v[1] = 0; }
    }
    const acc = this.grounded ? 12 : 1.5;
    this.v[0] += (want[0] - this.v[0]) * Math.min(1, acc * dt);
    this.v[2] += (want[1] - this.v[2]) * Math.min(1, acc * dt);
    const boxes = this._boxes();
    const n = Math.max(1, Math.ceil((Math.abs(this.v[1]) * dt) / 0.12), Math.ceil((Math.hypot(this.v[0], this.v[2]) * dt) / 0.08));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      p[0] += this.v[0] * h; p[2] += this.v[2] * h;
      // out of whatever stands at body height
      for (const b of boxes) {
        if (b.max[1] <= p[1] + STEP || b.min[1] >= p[1] + HEIGHT) continue;
        const cx = Math.max(b.min[0], Math.min(b.max[0], p[0])), cz = Math.max(b.min[2], Math.min(b.max[2], p[2]));
        let dx = p[0] - cx, dz = p[2] - cz, dd = Math.hypot(dx, dz);
        if (dd >= RAD) continue;
        if (dd < 1e-6) {
          const pen = [p[0] - b.min[0], b.max[0] - p[0], p[2] - b.min[2], b.max[2] - p[2]];
          const m = pen.indexOf(Math.min(...pen));
          if (m === 0) p[0] = b.min[0] - RAD; else if (m === 1) p[0] = b.max[0] + RAD; else if (m === 2) p[2] = b.min[2] - RAD; else p[2] = b.max[2] + RAD;
        } else { p[0] = cx + (dx / dd) * RAD; p[2] = cz + (dz / dd) * RAD; }
      }
      // up and down: gravity, the ground under you (which may be the car), your head
      if (!this.grounded && !this.rope) this.v[1] -= 9.81 * h;
      const y0 = p[1];
      p[1] += this.v[1] * h;
      let top = -Infinity, under = null;
      for (const b of boxes) {
        const cx = Math.max(b.min[0], Math.min(b.max[0], p[0])), cz = Math.max(b.min[2], Math.min(b.max[2], p[2]));
        if (Math.hypot(p[0] - cx, p[2] - cz) > RAD * 0.75) continue;
        const t = b.max[1];
        const reach = this.grounded ? 0.35 : Math.max(0.02, y0 - p[1] + 0.02);
        if (t <= p[1] + STEP && t >= p[1] - reach && t > top) { top = t; under = b; }
        if (this.v[1] > 0 && b.min[1] > y0 + HEIGHT - 0.01 && b.min[1] < p[1] + HEIGHT) { p[1] = b.min[1] - HEIGHT; this.v[1] = 0; }
      }
      if (under && p[1] <= top + 0.001 + (this.grounded ? 0.35 : 0) && !(this.rope && this.v[1] > 0)) {
        if (!this.grounded) this._landed(top);
        if (this.rope && !this.rope.fresh && (under.car || p[2] < FACADE - 0.25)) { this.rope = null; this.game.sim.say(under.car ? 'Feet on the car roof: you unclip from the rope. (The rope stays hanging; use it again to climb back up.)' : 'Back in the lobby: you unclip from the rope.', 'You'); }
        p[1] = top; this.v[1] = under.v ? under.v[1] : 0; this.grounded = true; this.ground = under;
      } else { if (this.grounded) this.peak = p[1]; this.grounded = false; this.ground = null; this.peak = Math.max(this.peak, p[1]); }
    }
    if (p[1] < -80) { this.game.sim.say('You fell out of the world. Back to the lobby.', 'You'); this.teleport([0.6, 0, 12.4], Math.PI / 2); }
    // your weight (and the push you give it starting and stopping) on whatever you stand on
    const onCar = this.grounded && this.ground?.car;
    this.game.elevatorGL.playerForce = onCar ? -MASS * (9.81 + this.game.sim.hoist.ac) : 0;
    this.onCar = onCar;
    if (onCar) this.carDy = this.p[1] - this.game.sim.hoist.yc;
    this.bob += Math.hypot(this.v[0], this.v[2]) * dt * 3.2;
  }

  _landed(top) {
    const fall = this.peak - top;
    if (fall > 2.5) {
      this.game.sim.say(fall > 6 ? `You fell ${fall.toFixed(1)} m. That would have killed you: elevator hoistways are not for falling into. Back to the lobby.` : `You fell ${fall.toFixed(1)} m and land hard.`, 'You');
      this.game.sim.sfx('thump');
      if (fall > 6) { this.teleport([0.6, 0, 12.4], Math.PI / 2); }
    }
  }

  // ---------------------------------------------------------------------------------------------

  /** The rope you hang on, drawn from its anchor in the door head to your harness. */
  _drawRope() {
    const R = this.rope ?? this.ropeLeft, sc = this.game.stage.scene;
    if (!this.ropeMesh) { this.ropeMesh = boxMesh(this.game.M.paintYellow, 0.014, 1, 0.014); this.ropeMesh.geometry.translate(0, -0.5, 0); sc.add(this.ropeMesh); }
    const m = this.ropeMesh;
    m.visible = !!R;
    if (!R) return;
    const a = R.anchor, end = this.rope ? [this.p[0], this.p[1] + 1.1, this.p[2]] : [a[0], a[1] - 30, a[2] + 0.4];
    const dx = end[0] - a[0], dy = end[1] - a[1], dz = end[2] - a[2], L = Math.hypot(dx, dy, dz);
    m.position.set(a[0], a[1], a[2]); m.scale.y = Math.max(0.01, L);
    m.quaternion.setFromUnitVectors(_v.set(0, -1, 0), _d.set(dx, dy, dz).normalize());
  }

  update(dt, camera) {
    this._drawRope();
    if (this.mode === 'orbit') { this._orbit(dt, camera); this._hands(camera); return; }
    this._walk(dt);
    // the car's starts and stops in your knees
    const a = this.onCar ? this.game.sim.hoist.ac : 0;
    this.dip += (-Math.max(-2, Math.min(2, a)) * 0.012 - this.dip) * Math.min(1, dt * 6);
    const y = this.p[1] + EYE + this.dip + Math.sin(this.bob) * 0.015;
    camera.position.set(this.p[0], y, this.p[2]);
    const cp = Math.cos(this.pitch);
    camera.up.set(0, 1, 0);
    camera.lookAt(_v.set(this.p[0] + cp * Math.cos(this.yaw), y + Math.sin(this.pitch), this.p[2] + cp * Math.sin(this.yaw)));
    this._hands(camera);
  }

  _orbit(dt, camera) {
    const o = this.orbit, h = this.game.sim.hoist, k = this.keys;
    if (o.follow) o.y += (h.yc + 1.5 - o.y) * Math.min(1, dt * 4);
    if (k.has('KeyW')) { o.follow = false; o.y += dt * 8; }
    if (k.has('KeyS')) { o.follow = false; o.y -= dt * 8; }
    o.y = Math.max(-3, Math.min(MR.floor + 3, o.y));
    const t = _v.set(-0.3, o.y, 16), cp = Math.cos(o.pitch);
    camera.position.set(t.x + Math.sin(o.yaw) * cp * o.dist, t.y + Math.sin(o.pitch) * o.dist, t.z + Math.cos(o.yaw) * cp * o.dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(t);
    // you are still standing in the car while you watch it from outside: you ride with it, and it carries your weight
    if (this.onCar) { this.p[1] = h.yc + (this.carDy ?? 0); this.v[1] = h.vc; this.game.elevatorGL.playerForce = -MASS * (9.81 + h.ac); }
    else this.game.elevatorGL.playerForce = 0;
  }

  /** Where you are, for the HUD. */
  where() {
    if (this.mode === 'orbit') return 'Outside, looking on';
    const [x, y, z] = this.p, h = this.game.sim.hoist;
    if (this.onCar) return y > h.yc + 2 ? 'On the car roof' : 'In the car';
    if (y > MR.floor - 0.5) return 'Machine room';
    if (y < -1 && z > FACADE) return 'In the pit';
    if (z > FACADE + 0.1 && y > 0.5) return 'In the hoistway';
    if (z > FACADE) return 'On the plaza';
    for (let n = FLOORS; n >= 1; n--) if (y >= floorY(n) - 0.5) return n === 1 ? 'Lobby (floor 1)' : `Floor ${n} lift lobby`;
    return '';
  }
}

