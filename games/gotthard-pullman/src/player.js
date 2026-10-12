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
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.yaw = Math.max(-1.95, Math.min(1.95, this.yaw));
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
    });
  }

  /** The car model you are in. */
  car() { return this.game.trainGL.vehicles.find((m) => m.info?.type === this.carKind); }

  /** Places the camera (call after the train's poses are up to date). */
  update(dt, camera) {
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
