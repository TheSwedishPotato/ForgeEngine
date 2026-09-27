import { Vector3 } from 'three';

const _a = new Vector3(), _b = new Vector3(), _mid = new Vector3(), _pos = new Vector3(), _look = new Vector3();

/**
 * Camera modes:
 *  - 'fighter'   : over the shoulder of the player's fighter (default)
 *  - 'broadcast' : TV side angle from the ring apron
 *  - 'orbit'     : slow cinematic orbit (intros, replays, between rounds)
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'fighter';
    this.pos = new Vector3(0, 1.8, -3.5);
    this.look = new Vector3(0, 1.3, 0);
    this.orbitAngle = 0;
    this.fovTarget = 42;
    this.side = 1;
  }

  cycle() {
    this.mode = this.mode === 'fighter' ? 'broadcast' : this.mode === 'broadcast' ? 'high' : 'fighter';
    return this.mode;
  }

  update(dt, player, opponent, override = null) {
    const mode = override ?? this.mode;
    const hp = player.b.head.renderPos ?? player.b.head.pos;
    const ho = opponent.b.head.renderPos ?? opponent.b.head.pos;
    _mid.addVectors(player.center, opponent.center).multiplyScalar(0.5);
    let lerpK = 5;
    if (mode === 'fighter') {
      // behind and a little to the rear-hand side, looking past the fighter
      const f = _a.subVectors(opponent.center, player.center).setY(0);
      if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
      f.normalize();
      const left = _b.set(f.z, 0, -f.x);
      // Portrait screens pull back and widen so both fighters fit.
      const portrait = this.camera.aspect < 1;
      _pos.copy(player.center).addScaledVector(f, portrait ? -3.1 : -2.35).addScaledVector(left, -0.62 * player.ss);
      _pos.y = Math.max(portrait ? 1.95 : 1.7, hp.y + 0.42);
      _look.copy(ho).lerp(_mid, 0.25);
      _look.y = Math.max(1.05, ho.y - (portrait ? 0.3 : 0.12));
      this.fovTarget = portrait ? 58 : 44;
    } else if (mode === 'broadcast') {
      const f = _a.subVectors(opponent.center, player.center).setY(0).normalize();
      const side = _b.set(f.z, 0, -f.x);
      // stay on one side of the fight line (don't flip through the fighters)
      _pos.copy(_mid).addScaledVector(side, 4.4 * this.side);
      if (Math.abs(_pos.x) > 5.5 || Math.abs(_pos.z) > 5.5) {
        this.side *= -1;
        _pos.copy(_mid).addScaledVector(side, 4.4 * this.side);
      }
      _pos.y = 2.1;
      _look.copy(_mid).setY(1.25);
      this.fovTarget = 36;
      lerpK = 2.5;
    } else if (mode === 'high') {
      _pos.copy(_mid).add(_a.set(-3.2, 4.2, -3.2));
      _look.copy(_mid).setY(0.9);
      this.fovTarget = 40;
      lerpK = 2.5;
    } else if (mode === 'orbit') {
      this.orbitAngle += dt * 0.18;
      _pos.set(Math.sin(this.orbitAngle) * 5.2, 2.3 + Math.sin(this.orbitAngle * 0.7) * 0.4, Math.cos(this.orbitAngle) * 5.2).add(_mid);
      _look.copy(_mid).setY(1.2);
      this.fovTarget = 38;
      lerpK = 3;
    } else if (mode === 'closeup' || mode === 'closeupB') {
      // face-off portrait of one fighter
      const who = mode === 'closeup' ? player : opponent;
      const other = who === player ? opponent : player;
      const h = who.b.head.renderPos ?? who.b.head.pos;
      const f = _a.subVectors(other.center, who.center).setY(0).normalize();
      const left = _b.set(f.z, 0, -f.x);
      _pos.copy(h).addScaledVector(f, 0.85).addScaledVector(left, 0.3);
      _pos.y = h.y + 0.02;
      _look.copy(h).setY(h.y - 0.05);
      this.fovTarget = 30;
      lerpK = 4;
    } else if (mode === 'knockdown') {
      // low angle on the fallen fighter
      // low angle on the fallen fighter, from the side away from the other one
      const down = opponent.isDown ? opponent : player;
      const up = down === player ? opponent : player;
      const p = down.b.pelvis.renderPos ?? down.b.pelvis.pos;
      const away = _a.subVectors(p, up.center).setY(0);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize();
      const side = _b.set(away.z, 0, -away.x);
      _pos.copy(p).addScaledVector(away, 1.7).addScaledVector(side, 0.9);
      _pos.y = 0.95;
      // keep the camera inside the ring
      _pos.x = Math.max(-2.8, Math.min(2.8, _pos.x));
      _pos.z = Math.max(-2.8, Math.min(2.8, _pos.z));
      _look.copy(p).setY(0.3);
      this.fovTarget = 40;
      lerpK = 2;
    }
    if (mode === 'fighter') {
      // Stay inside the ropes; rise a little instead of backing through them.
      const lim = 2.95;
      const over = Math.max(0, Math.abs(_pos.x) - lim, Math.abs(_pos.z) - lim);
      _pos.x = Math.max(-lim, Math.min(lim, _pos.x));
      _pos.z = Math.max(-lim, Math.min(lim, _pos.z));
      _pos.y += over * 0.8;
    }
    const k = 1 - Math.exp(-lerpK * dt);
    this.pos.lerp(_pos, k);
    this.look.lerp(_look, Math.min(1, k * 1.6));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov += (this.fovTarget - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
    void hp;
  }

  snap() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
