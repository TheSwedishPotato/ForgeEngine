// First-person passenger: seated look/lean, belt, tray, recline, walking the aisle.
import * as THREE from 'three';
import { Human, randomAppearance, POSES, composePose, HUMAN_MATS } from './humans.js';
import { CAB, rowZ, wallX } from './cabin.js';
import { clamp, damp, lerp, DEG } from './core.js';
import { colorize, mergeColored, trs } from './geom.js';

export class Player {
  constructor(cabin, scene, seatId, audio, appearance) {
    this.cabin = cabin; this.scene = scene; this.audio = audio;
    this.seat = cabin.seat(seatId);
    this.state = 'seated';
    // start looking forward and a little towards the window side
    this.initialYaw = Math.sign(this.seat.x) < 0 ? 0.45 : -0.45;
    this.yaw = 0; this.pitch = -0.08; // relative to aircraft (0 = looking forward)
    this.lean = new THREE.Vector3();
    this.leanCmd = new THREE.Vector3();
    this.belt = false; this.tray = false; this.trayK = 0; this.recline = 0; this.readingLight = false; this.gasper = false;
    this.pos = new THREE.Vector3(this.seat.x, 0, this.seat.z);
    this.eye = new THREE.Vector3();
    this.keys = {};
    this.bob = 0; this.stepAcc = 0;
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.03, 250);
    this.ray = new THREE.Raycaster(); this.ray.far = 1.5;
    this.hover = null;
    this.inLav = null;
    this._buildBody(appearance);
    this._buildTray();
    this._buildPsuHotspots();
    this.yaw = this.initialYaw;
    this.update(0, {});
  }

  _buildBody(app) {
    const h = this.body = new Human(app, { detail: 1 });
    h.setPose(composePose(POSES.stand, POSES.sit, { lShoulder: [-0.25, 0, -0.18], rShoulder: [-0.25, 0, 0.18], lElbow: [-1.0, 0.2, 0], rElbow: [-1.0, -0.2, 0] }));
    h.j.head.visible = false; h.j.neck.visible = false;
    for (const m of h.meshes) m.castShadow = true;
    this.bodyRoot = h.root;
    this.bodyRoot.position.set(this.seat.x, 0.455 - 0.84 * h.s, this.seat.z + 0.1);
    this.bodyRoot.rotation.y = Math.PI;
    this.scene.add(this.bodyRoot);
    // seatbelt halves (open lying at sides / closed across lap)
    const beltMat = HUMAN_MATS.body;
    this.beltOpen = new THREE.Mesh(mergeColored([
      { geo: new THREE.BoxGeometry(0.03, 0.006, 0.28), color: '#2b2f37', matrix: trs(-0.2, 0.47, 0.02, 0, 0.1, 0.9) },
      { geo: new THREE.BoxGeometry(0.03, 0.006, 0.28), color: '#2b2f37', matrix: trs(0.2, 0.47, 0.02, 0, -0.1, -0.9) },
      { geo: new THREE.BoxGeometry(0.055, 0.012, 0.045), color: '#b9bdc4', matrix: trs(0.2, 0.48, -0.1, 0, 0, -0.9) },
    ]), beltMat);
    this.beltClosed = new THREE.Mesh(mergeColored([
      { geo: new THREE.BoxGeometry(0.4, 0.045, 0.012), color: '#2b2f37', matrix: trs(0, 0.61, -0.1, -0.3, 0, 0) },
      { geo: new THREE.BoxGeometry(0.075, 0.055, 0.02), color: '#c8ccd3', matrix: trs(0, 0.615, -0.112, -0.3, 0, 0) },
      { geo: new THREE.BoxGeometry(0.05, 0.02, 0.005), color: '#8a9099', matrix: trs(0, 0.62, -0.124, -0.3, 0, 0) },
    ]), beltMat);
    for (const b of [this.beltOpen, this.beltClosed]) { b.position.set(this.seat.x, 0, this.seat.z); this.scene.add(b); }
    this.beltClosed.visible = false;
    this.beltOpen.userData.interact = this.beltClosed.userData.interact = { kind: 'belt', prompt: () => (this.belt ? 'Unfasten seatbelt  [B]' : 'Fasten seatbelt  [B]') };
  }

  _buildTray() {
    // tray table on the seat back in front
    const s = this.seat;
    const hingeZ = s.z - 0.762 + 0.2 + 0.1;
    this.trayPivot = new THREE.Group(); this.trayPivot.position.set(s.x, 0.73, hingeZ - 0.02);
    const mat = new THREE.MeshStandardMaterial({ color: '#d4d6da', roughness: 0.5 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.018, 0.26), mat); tray.position.set(0, 0, 0.13); tray.castShadow = true;
    this.trayPivot.add(tray); this.scene.add(this.trayPivot);
    this.trayMesh = tray;
    tray.userData.interact = { kind: 'tray', prompt: () => (this.tray ? 'Fold tray table  [F]' : 'Lower tray table  [F]') };
    // items that can sit on the tray
    this.trayItems = new THREE.Group(); tray.add(this.trayItems);
    // seat pocket (safety card)
    // seat pocket (Recaro SL3510: at the top of the seat back): safety card on the left, menu card on the right
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
    pocket.position.set(s.x - 0.09, 0.98, s.z - 0.52); this.scene.add(pocket);
    pocket.userData.interact = { kind: 'card', prompt: () => 'Read the safety card' };
    this.pocket = pocket;
    const menu = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.05), new THREE.MeshBasicMaterial({ visible: false }));
    menu.position.set(s.x + 0.09, 0.98, s.z - 0.52); this.scene.add(menu);
    menu.userData.interact = { kind: 'menu', prompt: () => 'Read the onboard menu' };
    this.menuCard = menu;
  }

  _buildPsuHotspots() {
    const s = this.seat, side = Math.sign(s.x);
    const y = CAB.binBottomY + 0.02;
    const mk = (dx, kind, prompt) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.07), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(side * (1.08 + dx), y, s.z - 0.28); this.scene.add(m);
      m.userData.interact = { kind, prompt }; return m;
    };
    const letterIdx = { A: 0, B: 1, C: 2, D: 2, E: 1, F: 0 }[s.letter];
    this.lightSpot = mk(0.22 - letterIdx * 0.11, 'light', () => (this.readingLight ? 'Reading light off' : 'Reading light on'));
    this.callSpot = mk(-0.02, 'call', () => (this.callOn ? 'Cancel attendant call' : 'Call cabin crew'));
    this.gasperSpot = mk(0.3 - letterIdx * 0.1, 'gasper', () => (this.gasper ? 'Close air vent' : 'Open air vent'));
    // glowing lens for reading light and call light
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 14), new THREE.MeshBasicMaterial({ color: '#555' }));
    this.lens.position.copy(this.lightSpot.position).add(new THREE.Vector3(0, -0.019, 0)); this.lens.rotation.x = Math.PI / 2; this.scene.add(this.lens);
    this.callLens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: '#445' }));
    this.callLens.position.copy(this.callSpot.position).add(new THREE.Vector3(0, -0.019, 0)); this.callLens.rotation.x = Math.PI / 2; this.scene.add(this.callLens);
  }

  interactables() {
    const list = [this.trayMesh, this.pocket, this.menuCard, this.lightSpot, this.callSpot, this.gasperSpot];
    if (this.state === 'seated') list.push(this.belt ? this.beltClosed : this.beltOpen);
    return list;
  }

  setBelt(v) { if (this.state !== 'seated' || v === this.belt) return; this.belt = v; v ? this.audio.seatbelt() : this.audio.seatbeltOpen(); this.onChange?.('belt', v); }
  setTray(v) { if (v === this.tray) return; if (v && this.state !== 'seated') return; this.tray = v; this.audio.tray(); this.onChange?.('tray', v); }
  setRecline(v) { this.recline = v; this.seat.recline = v ? 1 : 0; this.cabin.updateSeat(this.seat); this.audio.thump(0.15, 140); this.onChange?.('recline', v); }
  setReadingLight(v) { this.readingLight = v; this.audio.clunk(0.1); }
  setCall(v) { this.callOn = v; if (v) this.audio.chime('single'); this.onChange?.('call', v); }

  standUp() {
    if (this.state !== 'seated') return false;
    if (this.belt) return 'belt';
    if (this.tray) return 'tray';
    this.state = 'standing';
    this.pos.set(Math.sign(this.seat.x) * 0.05, 0, this.seat.z - 0.2);
    this._path = [{ x: this.seat.x * 0.5, z: this.seat.z - 0.28 }, { x: 0, z: this.seat.z - 0.28 }];
    this.pos.set(this.seat.x, 0, this.seat.z - 0.28);
    this.yaw = Math.sign(this.seat.x) * -Math.PI / 2 * -1;
    this.bodyRoot.visible = false;
    this.onChange?.('stand', true);
    return true;
  }
  sitDown() {
    if (this.state !== 'standing') return false;
    if (Math.abs(this.pos.z - (this.seat.z - 0.28)) > 0.6 || Math.abs(this.pos.x) > 0.45) return false;
    this.state = 'seated'; this.bodyRoot.visible = true; this.yaw = 0; this.pitch = -0.05;
    this.onChange?.('sit', true);
    return true;
  }

  // walkable test for standing mode
  _inLavBox(l, x, z, m = 0.18) { return x > l.x0 + m && x < l.x1 - m && z > l.z0 + m && z < l.z1 - m; }
  _walkable(x, z) {
    // inside a lavatory: walk freely inside; leave only through an open door
    for (const l of this.cabin.lavs) {
      if (this._inLavBox(l, this.pos.x, this.pos.z, 0.05)) {
        if (this._inLavBox(l, x, z)) return true;
        return l.open > 0.8 && Math.abs(x - l.cx) < 0.32 && Math.abs(z - l.doorZ) < 0.5;
      }
    }
    for (const l of this.cabin.lavs) if (l.open > 0.8 && (this._inLavBox(l, x, z) || (Math.abs(x - l.cx) < 0.32 && Math.abs(z - l.doorZ) < 0.5))) return true;
    if (Math.abs(x) < 0.22 && z > -2.9 && z < 24.95) return true;
    if (z > -2.95 && z < -1.05 && Math.abs(x) < 1.35) return true; // forward door area
    if (z > 23.6 && z < 24.9 && Math.abs(x) < 1.45) return true; // aft door area
    // own row, to get back into the seat
    const s = this.seat;
    if (Math.abs(z - (s.z - 0.28)) < 0.2 && Math.sign(x) === Math.sign(s.x) && Math.abs(x) < Math.abs(s.x) + 0.1) return true;
    return false;
  }

  currentLav() { return this.cabin.lavs.find((l) => this._inLavBox(l, this.pos.x, this.pos.z, 0.05)) || null; }

  update(dt, ctx) {
    const k = this.keys;
    if (this.state === 'seated') {
      // leaning with WASD
      this.leanCmd.set(0, 0, 0);
      const side = Math.sign(this.seat.x);
      if (k.KeyA) this.leanCmd.x -= 0.16; if (k.KeyD) this.leanCmd.x += 0.16;
      if (k.KeyW) { this.leanCmd.z -= 0.2; this.leanCmd.y -= 0.05; }
      if (k.KeyS) this.leanCmd.z += 0.06;
      // auto-lean towards the window when looking out of it
      const lookSide = -Math.sin(this.yaw);
      const winSeat = this.seat.letter === 'A' || this.seat.letter === 'F';
      if (winSeat && lookSide * side > 0.6) this.leanCmd.x += side * 0.07 * (lookSide * side - 0.6) / 0.4;
      // keep the head inside the cabin
      this.lean.x = damp(this.lean.x, this.leanCmd.x, 6, dt); this.lean.y = damp(this.lean.y, this.leanCmd.y, 6, dt); this.lean.z = damp(this.lean.z, this.leanCmd.z, 6, dt);
      const base = new THREE.Vector3(this.seat.x - side * 0.02, 1.17 - this.recline * 0.04, this.seat.z + 0.03 + this.recline * 0.08);
      const e = base.add(this.lean);
      const maxX = wallX(e.y) - 0.22;
      e.x = clamp(e.x, -maxX, maxX);
      this.eye.copy(e);
      this.pos.set(this.seat.x, 0, this.seat.z);
    } else {
      // walking
      const sp = 1.15 * (k.ShiftLeft ? 1.4 : 1);
      let fx = 0, fz = 0;
      if (k.KeyW) fz -= 1; if (k.KeyS) fz += 1; if (k.KeyA) fx -= 1; if (k.KeyD) fx += 1;
      const len = Math.hypot(fx, fz);
      let moving = false;
      if (len > 0) {
        fx /= len; fz /= len;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        const dx = (fx * cy + fz * sy) * sp * dt, dz = (-fx * sy + fz * cy) * sp * dt;
        const nx = this.pos.x + dx, nz = this.pos.z + dz;
        const blocked = ctx.blocked ? ctx.blocked(nx, nz) : false;
        if (!blocked) {
          if (this._walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; moving = true; }
          else if (this._walkable(nx, this.pos.z)) { this.pos.x = nx; moving = true; }
          else if (this._walkable(this.pos.x, nz)) { this.pos.z = nz; moving = true; }
        }
      }
      // turbulence sway
      if (ctx.bump) this.pos.x += ctx.bump * 0.02 * dt;
      this.bob += moving ? dt * 8 : 0;
      if (moving) { this.stepAcc += dt * sp; if (this.stepAcc > 0.62) { this.stepAcc = 0; this.audio.footstep(); } }
      const bobY = moving ? Math.sin(this.bob) * 0.025 : 0;
      this.eye.set(this.pos.x + (moving ? Math.cos(this.bob * 0.5) * 0.01 : 0), 1.62 + bobY, this.pos.z);
    }
    this.trayK = damp(this.trayK, this.tray ? 1 : 0, 7, dt);
    this.trayPivot.rotation.x = lerp(-Math.PI / 2 + 0.24, 0, this.trayK) * -1 * -1;
    this.trayPivot.rotation.x = -(1 - this.trayK) * (Math.PI / 2 - 0.26);
    this.beltOpen.visible = this.state === 'seated' && !this.belt; this.beltClosed.visible = this.state === 'seated' && this.belt;
    if (this.state !== 'seated') this.beltOpen.visible = true;
    this.lens.material.color.set(this.readingLight ? '#fff6dd' : '#5a5e66');
    this.callLens.material.color.set(this.callOn ? '#4db3ff' : '#4a4d58');
    const rl = this.cabin.readingLight;
    rl.intensity = this.readingLight ? 3.2 : 0;
    rl.position.copy(this.lightSpot.position).add(new THREE.Vector3(0, -0.03, 0));
    rl.target.position.set(this.seat.x, 0.6, this.seat.z - 0.3);
    // camera
    const c = this.camera;
    c.position.copy(this.eye).add(ctx.headOffset || new THREE.Vector3());
    c.rotation.set(this.pitch + (ctx.headPitch || 0), this.yaw, ctx.headRoll || 0, 'YXZ');
    c.updateMatrixWorld();
  }

  look(dx, dy) {
    const s = 0.0022 * (this.sensitivity || 1);
    this.yaw -= dx * s; this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -1.35, 1.2);
    if (this.state === 'seated') this.yaw = clamp(this.yaw, -2.7, 2.7);
    else this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  pick(objects) {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = this.state === 'seated' ? 1.35 : 1.5;
    const hits = this.ray.intersectObjects(objects, false);
    for (const h of hits) { let o = h.object; while (o && !o.userData.interact) o = o.parent; if (o) return { obj: o, hit: h, ...o.userData.interact }; }
    return null;
  }
}
