import { Vector3 } from 'three';

const _a = new Vector3(), _b = new Vector3(), _mid = new Vector3(), _pos = new Vector3(), _look = new Vector3();

/**
 * Camera modes:
 *  'fighter'  over the shoulder of the player's fighter (default)
 *  'side'     from the barrier, square to the fight line
 *  'helm'     through the player's own eyes (with the visor overlay)
 *  'orbit'    slow cinematic orbit (menus, intros, the end)
 *  'down'     low on whoever has fallen
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'fighter';
    this.pos = new Vector3(0, 1.9, -4.5);
    this.look = new Vector3(0, 1.3, 0);
    this.orbitAngle = 0.6;
    this.fovTarget = 45;
    this.side = 1;
  }

  cycle() {
    this.mode = this.mode === 'fighter' ? 'side' : this.mode === 'side' ? 'helm' : 'fighter';
    return this.mode;
  }

  update(dt, player, opponent, override = null) {
    const mode = override ?? this.mode;
    const hp = player.b.head.pos;
    const ho = opponent.b.head.pos;
    _mid.addVectors(player.center, opponent.center).multiplyScalar(0.5);
    let lerpK = 5;
    const f = _a.subVectors(opponent.center, player.center).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const left = _b.set(f.z, 0, -f.x);
    const portrait = this.camera.aspect < 1;
    if (mode === 'fighter') {
      // three-quarter view from the right: your hands and blade in front of you stay in sight
      _pos.copy(player.center).addScaledVector(f, portrait ? -3.2 : -2.3).addScaledVector(left, portrait ? -1.5 : -1.75);
      _pos.y = Math.max(portrait ? 2.25 : 2.0, hp.y + 0.45);
      _look.copy(ho).lerp(_mid, 0.3);
      _look.y = Math.max(1.0, ho.y - 0.25);
      this.fovTarget = portrait ? 62 : 48;
    } else if (mode === 'side') {
      _pos.copy(_mid).addScaledVector(left, 5.0 * this.side);
      _pos.y = 1.8;
      _look.copy(_mid).setY(1.2);
      this.fovTarget = portrait ? 60 : 40;
      lerpK = 2.5;
    } else if (mode === 'helm') {
      _pos.copy(hp).addScaledVector(f, 0.12).setY(hp.y + 0.03);
      _look.copy(ho).setY(ho.y - 0.25);
      this.fovTarget = portrait ? 75 : 62;
      lerpK = 20;
    } else if (mode === 'orbit') {
      this.orbitAngle += dt * 0.12;
      _pos.set(Math.sin(this.orbitAngle) * 6.2, 2.4 + Math.sin(this.orbitAngle * 0.7) * 0.5, Math.cos(this.orbitAngle) * 6.2).add(_mid);
      _look.copy(_mid).setY(1.2);
      this.fovTarget = 40;
      lerpK = 2;
    } else if (mode === 'closeA' || mode === 'closeB') {
      const who = mode === 'closeA' ? player : opponent;
      const other = who === player ? opponent : player;
      const h = who.b.head.pos;
      const ff = _a.subVectors(other.center, who.center).setY(0).normalize();
      const l2 = _b.set(ff.z, 0, -ff.x);
      _pos.copy(h).addScaledVector(ff, 1.3).addScaledVector(l2, 0.45);
      _pos.y = h.y - 0.05;
      _look.copy(h).setY(h.y - 0.15);
      this.fovTarget = 32;
      lerpK = 3;
    } else if (mode === 'down') {
      const down = opponent.isDown ? opponent : player;
      const up = down === player ? opponent : player;
      const p = down.b.pelvis.pos;
      const away = _a.subVectors(p, up.center).setY(0);
      if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
      away.normalize();
      const side = _b.set(away.z, 0, -away.x);
      _pos.copy(p).addScaledVector(away, 1.8).addScaledVector(side, 1.1);
      _pos.y = 1.0;
      _look.copy(p).setY(0.4);
      this.fovTarget = 42;
      lerpK = 2;
    }
    const k = 1 - Math.exp(-lerpK * dt);
    this.pos.lerp(_pos, k);
    this.look.lerp(_look, Math.min(1, k * 1.6));
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov += (this.fovTarget - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }

  snap() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
