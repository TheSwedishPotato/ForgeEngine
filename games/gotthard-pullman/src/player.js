/**
 * You: a passenger in one of the cars. Seated, your eyes are where a seated adult's are
 * (1.18 m above the floor, a little forward of the chair's back); your head turns with the
 * mouse (about 110 degrees either way, 70 up and down), and it moves a little with the car:
 * the body's sway and bounce from the suspension, a lag of the neck to the car's lurches.
 *
 * Get up (E) and you can walk the train: the aisles and corridors, through the gangways from
 * car to car, out onto the observation car's open platform at the back. Standing, the car's
 * lurches move you more (you balance on your feet, not in a chair's arms).
 */
import { Vector3, Quaternion, Euler, Matrix4 } from 'three';
import { BODY } from './render/pullman.js';
import { cabToModel } from './render/locomotive.js';
import { LAYOUTS, aisleZ } from './world/carLayout.js';

const _v = new Vector3(), _q = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ'), _m = new Matrix4();

export class Player {
  constructor(game, { car = 'parlor', chair = 12 } = {}) {
    this.game = game;
    this.mode = 'seated';
    this.carKind = car;
    this.chairIndex = chair;
    this.yaw = 0; this.pitch = -0.06;            // head, relative to the chair
    this.chairYaw = -0.45;                        // the revolving chair turned a little toward the window
    this.head = new Vector3();                    // head offset from the car's motion (m)
    this.headV = new Vector3();
    this.sensitivity = 0.0022;
    this.keys = new Set();
    this.walk = null;                             // { car (vehicle index), x, z, yaw, bob } while standing
    this._bind();
  }

  /** Up from the chair into the aisle, or back down when you are by your seat. */
  toggleStand({ anywhere = false } = {}) {
    const V = this.game.trainGL.vehicles;
    if (this.mode === 'seated') {
      const m = this.car(), i = V.indexOf(m);
      const chair = m.info.chairs[this.chairIndex] ?? m.info.chairs[0];
      const L = LAYOUTS[m.info.type]();
      this.walk = { car: i, x: chair.x, z: aisleZ(L, chair.x), yaw: (chair.yaw ?? 0) + this.chairYaw * Math.sign(chair.z || 1) + this.yaw, bob: 0 };
      this.mode = 'walking';
      this.yaw = 0;
    } else if (this.mode === 'walking') {
      const m = this._seatCar(), W = this.walk;
      const chair = m.info.chairs[this.chairIndex] ?? m.info.chairs[0];
      if (anywhere || (V[W.car] === m && Math.hypot(W.x - chair.x, W.z - chair.z) < 1.4)) { this.mode = 'seated'; this.walk = null; this.yaw = 0; }
    }
  }

  _bind() {
    const canvas = this.game.canvas;
    canvas.addEventListener('click', () => { if (!document.pointerLockElement) { try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* dragging still looks */ } } });
    canvas.addEventListener('wheel', (e) => { if (this.mode === 'outside') this.orbit.dist = Math.max(4, Math.min(300, this.orbit.dist * Math.exp(e.deltaY * 0.001))); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE' && this.mode === 'other' && this.inside) { this._toggleInside(); return; }
      if (e.code === 'KeyE' && this.mode === 'other') { this.mode = 'seated'; this.other = null; return; }
      if (e.code === 'KeyE' && this.mode !== 'cab') this.toggleStand();
      if (e.code === 'KeyV') this.setOutside(this.mode !== 'outside', this.orbit ?? {});
      if (e.code === 'KeyO') this.rideOther();
      if (this.mode === 'outside' && !this.game.driving?.on && e.code === 'BracketRight') this.orbit.vehicle = Math.min(this.game.trainGL.vehicles.length - 1, this.orbit.vehicle + 1);
      if (this.mode === 'outside' && !this.game.driving?.on && e.code === 'BracketLeft') this.orbit.vehicle = Math.max(0, this.orbit.vehicle - 1);
    });
    // look with the captured mouse, or by dragging it (after Esc, or in a page that cannot capture it)
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this._px = e.clientX; this._py = e.clientY; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointercancel', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === canvas || !this.dragging) return;
      const dx = e.clientX - this._px, dy = e.clientY - this._py;
      this._px = e.clientX; this._py = e.clientY;
      this._look(dx * 1.4, dy * 1.4);
    });
    document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) this._look(e.movementX, e.movementY); });
  }

  /** Turn the head (or the orbit outside) by a mouse movement in pixels. */
  _look(dx, dy) {
    if (this.mode === 'outside') { this.orbit.yaw -= dx * 0.004; this.orbit.pitch = Math.max(-0.1, Math.min(1.4, this.orbit.pitch + dy * 0.004)); return; }
    if (this.mode === 'walking') { this.walk.yaw -= dx * this.sensitivity; this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * this.sensitivity)); return; }
    const yl = this.mode === 'cab' || this.mode === 'other' ? 2.8 : 1.95;
    this.yaw = Math.max(-yl, Math.min(yl, this.yaw - dx * this.sensitivity));
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * this.sensitivity));
  }

  /** The car model you are in (walking: the one you have walked into). */
  car() { return this.mode === 'walking' && this.walk ? this.game.trainGL.vehicles[this.walk.car] : this._seatCar(); }
  _seatCar() { return this.game.trainGL.vehicles.find((m) => m.info?.type === this.carKind); }

  /** Out in the open air: the outside camera, or standing on the observation car's open platform. */
  exposed() {
    if (this.mode === 'outside' || this.mode === 'cab' || this.mode === 'other') return true;
    if (this.mode !== 'walking') return false;
    const m = this.car();
    return !!m?.info?.openRear && this.walk.x < -(BODY.bodyHalf - 1.3);
  }

  /** Walking: WASD along the floor, kept to the aisles, through the gangways. */
  _walkStep(dt) {
    const W = this.walk, V = this.game.trainGL.vehicles;
    let fwd = 0, side = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) side += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) side -= 1;
    const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.7 : 1.15) * (fwd || side ? 1 : 0);
    // the view's yaw in the car frame: 0 looks along +x (forward); + turns to the left (-z)
    const cx = Math.cos(W.yaw), cz = -Math.sin(W.yaw);
    const n = Math.hypot(fwd, side) || 1;
    let x = W.x + ((cx * fwd - cz * side) / n) * speed * dt;
    let z = W.z + ((cz * fwd + cx * side) / n) * speed * dt;
    W.bob += speed * dt * 1.9 * Math.PI;
    // where a person can stand: the aisle or corridor, the vestibules, the open platform
    let m = V[W.car];
    const L = LAYOUTS[m.info.type](), xe = BODY.bodyHalf;
    const inVest = Math.abs(x) > xe - BODY.vest;
    const open = L.openRear && x < -(xe - 1.3);
    const zc = inVest || open ? 0 : aisleZ(L, x), zw = open ? 1.1 : inVest ? 1.05 : 0.38;
    z = Math.max(zc - zw, Math.min(zc + zw, z));
    // through the gangways to the next car (the cars are 25.3 m over the buffers)
    const ahead = V[W.car - 1], behind = V[W.car + 1];
    if (x > xe + 0.25) { if (ahead?.info) { W.car -= 1; x -= 25.3; z = Math.max(-0.4, Math.min(0.4, z)); } else x = xe + 0.25; }
    if (x < -(xe + 0.25)) {
      if (L.openRear) x = Math.max(x, -(xe - 0.25));
      else if (behind?.info) { W.car += 1; x += 25.3; z = Math.max(-0.4, Math.min(0.4, z)); } else x = -(xe + 0.25);
    }
    // the platform's railing is at the end of the car (x = -12.05): stand a body's half-width inside it
    if (L.openRear) x = Math.max(x, -(xe - 0.25));
    W.x = x; W.z = z;
    return speed;
  }

  /** The outside camera: orbit a vehicle (index into the train) at a distance, yaw and pitch. */
  setOutside(on, { vehicle = 0, dist = 18, yaw = 0.9, pitch = 0.18, along = 0, height = 2.2 } = {}) {
    this.mode = on ? 'outside' : this.game.driving?.on ? 'cab' : 'seated';
    this.orbit = { vehicle, dist, yaw, pitch, along, height };
  }

  _outside(camera) {
    const O = this.orbit, m = this.game.trainGL.vehicles[O.vehicle] ?? this.game.trainGL.vehicles[0];
    m.group.updateMatrixWorld();
    const c = new Vector3(O.along ?? 0, O.height ?? 2.2, 0).applyMatrix4(m.group.matrixWorld);
    const h = m.pose.heading;
    // yaw measured from the vehicle's right side, round toward its front
    const a = O.yaw, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const dx = rx * Math.cos(a) + fx * Math.sin(a), dz = rz * Math.cos(a) + fz * Math.sin(a);
    camera.position.set(c.x + dx * O.dist * Math.cos(O.pitch), c.y + O.dist * Math.sin(O.pitch), c.z + dz * O.dist * Math.cos(O.pitch));
    // keep the eye above the ground
    const map = this.game.stage.toMap(camera.position);
    const g = this.game.terrain.heightAt(map.x, map.y) + 1.6;
    if (map.z < g) camera.position.y += g - map.z;
    camera.lookAt(c);
  }

  /** On the footplate at the driver's place (true), or back to your seat. */
  setCab(on) {
    if (on && this.mode === 'walking') this.walk = null;
    this.mode = on ? 'cab' : 'seated';
    this.yaw = 0; this.pitch = on ? -0.1 : 0;
  }

  /** The footplate: standing where the driver stands, looking ahead past the boiler. */
  _cab(dt, camera) {
    const m = this.game.trainGL.vehicles[0];
    m.group.updateMatrixWorld();
    camera.position.copy(cabToModel([0.62, 1.66, 0.2])).applyMatrix4(m.group.matrixWorld);
    _e.set(this.pitch, this.yaw - Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    m.group.getWorldQuaternion(camera.quaternion);
    camera.quaternion.multiply(_q);
  }

  /**
   * Into the front of another train on the line (the next one that is out on it now, by turns;
   * after the last, back to your seat): behind its windscreen, looking ahead as its driver does.
   */
  rideOther() {
    const G = this.game, live = G.traffic.at(G.sim.clock).map((a) => G.traffic.trains.indexOf(a.train)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (G.driving?.on) return;
    const cur = this.mode === 'other' ? this.other : -1, next = live.find((i) => i > cur);
    if (next == null) { this.mode = 'seated'; this.other = null; this.inside = null; G.sim.log?.(live.length ? 'Back in your seat.' : 'No other train is out on the line just now.'); return; }
    this.mode = 'other'; this.other = next; this.yaw = 0; this.pitch = -0.05; this.inside = null;
    const tr = G.traffic.trains[next];
    G.sim.log?.(`You ride in the ${tr.kind.name} (${tr.kind.what}). O for the next train, E back to your seat.`);
  }

  /**
   * Aboard another train as a passenger: in a window seat of one of its cars (the start screen's
   * choice), facing the way it goes; E to stand up and walk the aisle through the cars (W/S), E
   * again to sit down in the nearest seat.
   */
  rideIn(i) {
    const G = this.game, I = G.trafficGL.interior(i), first = I.seats[Math.min(1, I.seats.length - 1)];
    if (!first) return this.rideOther();
    this.mode = 'other'; this.other = i; this.yaw = 0.9; this.pitch = -0.08;      // (half toward the window)
    this.inside = { k: first.k, x: first.xs[Math.floor(first.xs.length / 2)], z: -1.0, seated: true };
    const tr = G.traffic.trains[i];
    G.sim.log?.(`You are aboard the ${tr.kind.name} (${tr.kind.what}). E to stand up and walk the aisle (W/S), E again to sit down.`);
  }

  _inside(dt, camera) {
    const G = this.game, tr = G.traffic.trains[this.other], set = G.trafficGL.sets[this.other], I = set?.interior, A = this.inside;
    if (!tr || !set || !G.traffic.at(G.sim.clock).some((a) => a.train === tr)) {
      this.mode = 'seated'; this.other = null; this.inside = null;
      G.sim.log?.(`The ${tr?.kind.name ?? 'train'} has gone off the line; you are back aboard the steam special.`);
      return;
    }
    if (!A.seated) {
      // along the aisle, through the gangways from car to car
      let fwd = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
      const dir = Math.cos(this.yaw) >= 0 ? 1 : -1;
      A.x += fwd * dir * 1.2 * dt;
      const S = I.seats.find((q) => q.k === A.k);
      if (A.x > S.x1 - 0.3) { const nx = I.seats.find((q) => q.k === A.k - 1); if (nx) { A.k = nx.k; A.x = nx.x0 + 0.4; } else A.x = S.x1 - 0.3; }
      if (A.x < S.x0 + 0.3) { const nx = I.seats.find((q) => q.k === A.k + 1); if (nx) { A.k = nx.k; A.x = nx.x1 - 0.4; } else A.x = S.x0 + 0.3; }
      A.z = 0;
    }
    const holder = set[A.k];
    holder.updateMatrixWorld();
    camera.position.set(A.seated ? A.x - 0.05 : A.x, A.seated ? 2.05 : 2.55, A.z).applyMatrix4(holder.matrixWorld);
    _e.set(this.pitch, this.yaw - Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    holder.getWorldQuaternion(camera.quaternion);
    camera.quaternion.multiply(_q);
  }

  _toggleInside() {
    const A = this.inside, I = this.game.trafficGL.sets[this.other].interior;
    if (A.seated) { A.seated = false; return; }
    const S = I.seats.find((q) => q.k === A.k);
    A.x = S.xs.reduce((a, x) => (Math.abs(x - A.x) < Math.abs(a - A.x) ? x : a), S.xs[0]);
    A.z = -1.0; A.seated = true;
  }

  /** Where you ride in the other train: its first vehicle, behind the windscreen (its frame: x forward). */
  _other(camera) {
    const G = this.game, tr = G.traffic.trains[this.other], holder = G.trafficGL.sets[this.other]?.[0];
    if (!tr || !holder || !G.traffic.at(G.sim.clock).some((a) => a.train === tr)) { this.rideOther(); return; }
    const [kind, len] = tr.kind.cars[0], sleek = tr.kind.nose === 'sleek';
    const x = kind === 'cab' ? len / 2 - (sleek ? 5.6 : 3.2) + 0.4 : len / 2 - 1.4;
    holder.updateMatrixWorld();
    camera.position.set(x, 2.5, -0.55).applyMatrix4(holder.matrixWorld);
    _e.set(this.pitch, this.yaw - Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    holder.getWorldQuaternion(camera.quaternion);
    camera.quaternion.multiply(_q);
  }

  /** Places the camera (call after the train's poses are up to date). */
  update(dt, camera) {
    if (this.mode === 'other') return this.inside ? this._inside(dt, camera) : this._other(camera);
    if (this.mode === 'outside') return this._outside(camera);
    if (this.mode === 'cab') return this._cab(dt, camera);
    if (this.mode === 'walking') return this._walking(dt, camera);
    const m = this.car();
    if (!m) return;
    const chair = m.info.chairs[this.chairIndex] ?? m.info.chairs[0];
    // the chair faces +x of the car at yaw 0; you sit a little toward its front
    const cy = (chair.yaw ?? 0) + this.chairYaw * Math.sign(chair.z || 1);
    const ex = chair.x + Math.cos(cy) * 0.05, ez = chair.z - Math.sin(cy) * 0.05;
    // the head lags the car's accelerations a little (neck), springing back
    const ride = m.ride?.felt ?? { lat: 0, vert: 0, lon: 0 };
    const k = 60, c = 2 * Math.sqrt(k) * 0.7;
    const target = _v.set(-ride.lon * 0.004, -ride.vert * 0.003, -ride.lat * 0.006);
    this.headV.addScaledVector(_v.copy(target).sub(this.head).multiplyScalar(k).addScaledVector(this.headV, -c), dt);
    this.head.addScaledVector(this.headV, dt);
    const eye = new Vector3(ex, BODY.floor + 1.18, ez).add(this.head);
    m.group.updateMatrixWorld();
    camera.position.copy(eye).applyMatrix4(m.group.matrixWorld);
    // orientation: the car's, then the chair's, then your head's
    _e.set(this.pitch, cy + this.yaw - Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    m.group.getWorldQuaternion(camera.quaternion);
    camera.quaternion.multiply(_q);
  }

  _walking(dt, camera) {
    const speed = this._walkStep(dt);
    const W = this.walk, m = this.car();
    // standing, the car's lurches move you more; the steps bob the eye
    const ride = m.ride?.felt ?? { lat: 0, vert: 0, lon: 0 };
    const k = 30, c = 2 * Math.sqrt(k) * 0.55;
    const target = _v.set(-ride.lon * 0.012, -ride.vert * 0.005, -ride.lat * 0.02);
    this.headV.addScaledVector(_v.copy(target).sub(this.head).multiplyScalar(k).addScaledVector(this.headV, -c), dt);
    this.head.addScaledVector(this.headV, dt);
    const bob = speed > 0 ? Math.abs(Math.sin(W.bob)) * 0.03 - 0.015 : 0;
    const eye = new Vector3(W.x, BODY.floor + 1.63 + bob, W.z).add(this.head);
    m.group.updateMatrixWorld();
    camera.position.copy(eye).applyMatrix4(m.group.matrixWorld);
    _e.set(this.pitch, W.yaw - Math.PI / 2, 0, 'YXZ');
    _q.setFromEuler(_e);
    m.group.getWorldQuaternion(camera.quaternion);
    camera.quaternion.multiply(_q);
  }
}
