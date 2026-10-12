/**
 * You: a passenger in one of the cars. Seated, your eyes are where a seated adult's are
 * (1.18 m above the floor, a little forward of the chair's back); your head turns with the
 * mouse (about 110 degrees either way, 70 up and down), and it moves a little with the car:
 * the body's sway and bounce from the suspension, a lag of the neck to the car's lurches.
 */
import { Vector3, Quaternion, Euler, Matrix4 } from 'three';
import { BODY } from './render/pullman.js';

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
    this._bind();
  }

  _bind() {
    const canvas = this.game.canvas;
    canvas.addEventListener('click', () => { if (!document.pointerLockElement) canvas.requestPointerLock?.(); });
    canvas.addEventListener('wheel', (e) => { if (this.mode === 'outside') this.orbit.dist = Math.max(4, Math.min(300, this.orbit.dist * Math.exp(e.deltaY * 0.001))); });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyV') this.setOutside(this.mode !== 'outside', this.orbit ?? {});
      if (this.mode === 'outside' && e.code === 'BracketRight') this.orbit.vehicle = Math.min(this.game.trainGL.vehicles.length - 1, this.orbit.vehicle + 1);
      if (this.mode === 'outside' && e.code === 'BracketLeft') this.orbit.vehicle = Math.max(0, this.orbit.vehicle - 1);
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (this.mode === 'outside') { this.orbit.yaw -= e.movementX * 0.004; this.orbit.pitch = Math.max(-0.1, Math.min(1.4, this.orbit.pitch + e.movementY * 0.004)); return; }
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.yaw = Math.max(-1.95, Math.min(1.95, this.yaw));
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    });
  }

  /** The car model you are in. */
  car() { return this.game.trainGL.vehicles.find((m) => m.info?.type === this.carKind); }

  /** The outside camera: orbit a vehicle (index into the train) at a distance, yaw and pitch. */
  setOutside(on, { vehicle = 0, dist = 18, yaw = 0.9, pitch = 0.18 } = {}) {
    this.mode = on ? 'outside' : 'seated';
    this.orbit = { vehicle, dist, yaw, pitch };
  }

  _outside(camera) {
    const O = this.orbit, m = this.game.trainGL.vehicles[O.vehicle] ?? this.game.trainGL.vehicles[0];
    m.group.updateMatrixWorld();
    const c = new Vector3(0, 2.2, 0).applyMatrix4(m.group.matrixWorld);
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

  /** Places the camera (call after the train's poses are up to date). */
  update(dt, camera) {
    if (this.mode === 'outside') return this._outside(camera);
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
}
