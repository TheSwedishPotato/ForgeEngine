/**
 * Where you watch from:
 *  - 'driver': in the driver's seat, at a seated eye height (a 1.75 m driver low in a DMC's
 *    bucket: about a metre above the road, a hand's breadth under the roof). Look round by
 *    dragging or with the mouse held; the head leans with the car's accelerations.
 *  - 'chase': behind and above, following on a spring.
 *  - 'orbit': walk round the car at rest (drag to circle it, wheel or pinch to zoom).
 *  - 'passenger': from the passenger seat, looking across at the dash and the time circuits.
 */
import { Vector3, Quaternion, Euler, Matrix4 } from 'three';

const _v = new Vector3(), _q = new Quaternion(), _e = new Euler(0, 0, 0, 'YXZ');

export const EYES = {
  driver: new Vector3(-0.36, 1.0, -0.39),
  passenger: new Vector3(-0.36, 1.0, 0.39),
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'driver';
    this.yaw = 0; this.pitch = -0.08;            // the head's look, relative to the car
    this.orbitYaw = 2.4; this.orbitPitch = 0.22; this.orbitDist = 7.5;
    this.chasePos = new Vector3();
    this.lean = new Vector3();
    this.fov = { driver: 68, passenger: 68, chase: 55, orbit: 45 };
    this._init = false;
  }

  setMode(m) { this.mode = m; this._init = false; if (m === 'driver' || m === 'passenger') { this.yaw = m === 'passenger' ? 0.35 : 0; this.pitch = -0.08; } }
  cycle() { const order = ['driver', 'chase', 'orbit', 'passenger']; this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]); }

  /** Look (radians): drag deltas from the input. */
  look(dx, dy) {
    if (this.mode === 'orbit' || this.mode === 'chase') { this.orbitYaw -= dx; this.orbitPitch = Math.max(-0.05, Math.min(1.2, this.orbitPitch + dy)); }
    else { this.yaw = Math.max(-2.4, Math.min(2.4, this.yaw - dx)); this.pitch = Math.max(-1.1, Math.min(0.7, this.pitch - dy)); }
  }
  zoom(f) { this.orbitDist = Math.max(3.2, Math.min(30, this.orbitDist * f)); }

  /** car: the Car (its root's world matrix), veh: the Vehicle (accelerations). */
  update(dt, car, veh) {
    const cam = this.camera;
    // the car has gone out of time: the outside view stays where it was, watching the fire
    if (this.freeze && this.mode !== 'driver' && this.mode !== 'passenger') return;
    const root = car.root, body = car.body;
    root.updateMatrixWorld(true);
    const fov = this.fov[this.mode];
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (this.mode === 'driver' || this.mode === 'passenger') {
      // the head lags the body's accelerations (forward, sideways), a few centimetres
      const k = Math.min(1, dt * 6);
      this.lean.x += (-veh.ax * 0.006 - this.lean.x) * k;
      this.lean.z += (-veh.ay * 0.007 - this.lean.z) * k;
      _v.copy(EYES[this.mode]).add(this.lean);
      _v.applyMatrix4(body.matrixWorld);
      cam.position.copy(_v);
      _q.setFromRotationMatrix(new Matrix4().extractRotation(body.matrixWorld));
      // the car's forward is +x; a camera looks down -z: turn it -90 degrees about y first
      _e.set(this.pitch, this.yaw - Math.PI / 2, 0, 'YXZ');
      cam.quaternion.copy(_q).multiply(new Quaternion().setFromEuler(_e));
      cam.near = 0.03;
    } else {
      const target = new Vector3(0, 0.75, 0).applyMatrix4(root.matrixWorld);
      let yaw = this.orbitYaw, pitch = this.orbitPitch, dist = this.orbitDist;
      if (this.mode === 'chase') {
        // behind the car, swinging round it as it turns, with a spring
        const heading = Math.atan2(-root.matrixWorld.elements[2], root.matrixWorld.elements[0]);
        yaw = heading + Math.PI + (this.orbitYaw - 2.4) * 0.5;
        pitch = 0.16 + (this.orbitPitch - 0.22) * 0.5;
        dist = 6.8;
      }
      const want = new Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
      if (!this._init || this.mode === 'orbit') { this.chasePos.copy(want); this._init = true; }
      else this.chasePos.lerp(want, 1 - Math.exp(-dt * 5));
      if (this.chasePos.y < 0.4) this.chasePos.y = 0.4;
      cam.position.copy(this.chasePos);
      cam.lookAt(target);
      cam.near = 0.08;
    }
    cam.updateProjectionMatrix();
  }
}
