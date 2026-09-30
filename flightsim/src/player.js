// First-person passenger: seated look/lean, belt, tray, recline, walking the aisle.
import * as THREE from 'three';
import { Human, randomAppearance, POSES, composePose, HUMAN_MATS } from './humans.js';
import { CAB, rowZ, wallX, LAYOUT } from './cabin.js';
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
    // hands resting on the thighs (solved on this skeleton: fingertips about 10 cm either side of the
    // seat centre line, on top of the thighs just ahead of the hips)
    h.setPose(composePose(POSES.stand, POSES.sit, { lShoulder: [0.2, 0, 0.2], rShoulder: [0.2, 0, -0.2], lElbow: [-0.95, 0.7, 0], rElbow: [-0.95, -0.7, 0], lWrist: [0.3, 0, 0], rWrist: [0.3, 0, 0] }));
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
  // start the game standing somewhere (the gate)
  startStanding(x, z, yaw) { this.state = 'standing'; this.pos.set(x, 0, z); this.yaw = yaw; this.pitch = -0.05; this.bodyRoot.visible = false; }
  sitDown() {
    if (this.state !== 'standing') return false;
    // from the aisle next to the row, or from inside the row in front of your own seat
    const inRow = Math.sign(this.pos.x) === Math.sign(this.seat.x) && Math.abs(this.pos.x) <= Math.abs(this.seat.x) + 0.2;
    if (Math.abs(this.pos.z - (this.seat.z - 0.28)) > 0.6 || (Math.abs(this.pos.x) > 0.45 && !inRow)) return false;
    this.state = 'seated'; this.bodyRoot.visible = true; this.yaw = 0; this.pitch = -0.05;
    this.onChange?.('sit', true);
    return true;
  }

  // the flight deck's observer seat: harness on, looking over the pilots' shoulders
  sitJump(eye) {
    if (this.state !== 'standing') return false;
    this.state = 'jump'; this.jumpEye = eye.clone(); this.yaw = 0; this.pitch = -0.12; this.lean.set(0, 0, 0);
    this.audio.seatbelt(); this.onChange?.('jump', true);
    return true;
  }
  leaveJump() {
    if (this.state !== 'jump') return false;
    this.state = 'standing'; this.pos.set(this.jumpEye.x, 0, this.jumpEye.z + 0.25); this.audio.seatbeltOpen();
    return true;
  }

  // walkable test for standing mode
  _inLavBox(l, x, z, m = 0.18) { return x > l.x0 + m && x < l.x1 - m && z > l.z0 + m && z < l.z1 - m; }
  // the doorway of a lavatory: in its aft/forward wall, or (lavatory A) in its inboard side wall
  _inLavDoor(l, x, z) { return l.sideDoor ? Math.abs(x - l.doorX) < 0.45 && Math.abs(z - l.doorZ) < 0.26 : Math.abs(x - l.cx) < 0.32 && Math.abs(z - l.doorZ) < 0.5; }
  _walkable(x, z) {
    // inside a lavatory: walk freely inside; leave only through an open door
    for (const l of this.cabin.lavs) {
      if (this._inLavBox(l, this.pos.x, this.pos.z, 0.05)) {
        if (this._inLavBox(l, x, z)) return true;
        return l.open > 0.8 && this._inLavDoor(l, x, z);
      }
    }
    for (const l of this.cabin.lavs) if (l.open > 0.8 && (this._inLavBox(l, x, z) || this._inLavDoor(l, x, z))) return true;
    const F = LAYOUT;
    if (this.extraWalk && this.extraWalk(x, z)) return true;  // flight deck, jet bridge, terminal
    if (Math.abs(x) < 0.22 && z > F.aisleZ0 && z < F.aisleZ1) return true;
    if (z > F.fwdMonAftZ + 0.18 && z < rowZ(1) - 0.4 && Math.abs(x) < 1.3) return true;              // forward door area
    if (z > CAB.zFront + 0.2 && z <= F.fwdMonAftZ + 0.2 && x > -0.3 && x < 0.3) return true;        // in front of the cockpit door
    if (z > rowZ(31) + 0.5 && z < F.aftMonZ - 0.18 && Math.abs(x) < wallX(0.5, z) - 0.3) return true; // aft door area
    if (z >= F.aftMonZ - 0.2 && z < F.aftGalleyZ - 0.2 && Math.abs(x) < 0.33) return true;           // aft galley
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
      const maxX = wallX(e.y, this.seat.z) - 0.22;
      e.x = clamp(e.x, -maxX, maxX);
      this.eye.copy(e);
      this.pos.set(this.seat.x, 0, this.seat.z);
    } else if (this.state === 'jump') {
      this.leanCmd.set(0, 0, 0);
      if (k.KeyA) this.leanCmd.x -= 0.12; if (k.KeyD) this.leanCmd.x += 0.12;
      if (k.KeyW) { this.leanCmd.z -= 0.18; this.leanCmd.y += 0.04; }
      if (k.KeyS) this.leanCmd.z += 0.05;
      this.lean.x = damp(this.lean.x, this.leanCmd.x, 6, dt); this.lean.y = damp(this.lean.y, this.leanCmd.y, 6, dt); this.lean.z = damp(this.lean.z, this.leanCmd.z, 6, dt);
      this.eye.copy(this.jumpEye).add(this.lean);
      this.pos.set(this.jumpEye.x, 0, this.jumpEye.z);
    } else if (this.fallen) {
      // thrown to the floor: sitting in the aisle until Space
      this.fallT = (this.fallT || 0) + dt;
      this.eye.set(this.pos.x, 0.62, this.pos.z);
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
        // someone in the way: after a moment you squeeze past ("ursäkta")
        let blocked = ctx.blocked ? ctx.blocked(nx, nz) : false;
        this.pushT = blocked ? (this.pushT || 0) + dt : 0;
        if (this.pushT > 1.2) blocked = false;
        // never trapped: from a spot that is not walkable (a teleport, a closing door) any step is allowed
        if (!blocked && !this._walkable(this.pos.x, this.pos.z)) { this.pos.x = nx; this.pos.z = nz; moving = true; }
        else if (!blocked) {
          if (this._walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; moving = true; }
          else if (this._walkable(nx, this.pos.z)) { this.pos.x = nx; moving = true; }
          else if (this._walkable(this.pos.x, nz)) { this.pos.z = nz; moving = true; }
        }
      }
      this.bob += moving ? dt * 8 : 0;
      if (moving) { this.stepAcc += dt * sp; if (this.stepAcc > 0.62) { this.stepAcc = 0; this.audio.footstep(); } }
      const bobY = moving ? Math.sin(this.bob) * 0.025 : 0;
      const floor = this.floorAt ? this.floorAt(this.pos.x, this.pos.z) : 0; // jet bridge and terminal floors
      this.eye.set(this.pos.x + (moving ? Math.cos(this.bob * 0.5) * 0.01 : 0), floor + 1.62 + bobY, this.pos.z);
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

  getUp() { if (this.fallen && (this.fallT || 0) > 1.2) { this.fallen = false; this.audio.thump(0.2, 120); return true; } return false; }
  // turbulence knocks the drinks over: cups end up on their side in a puddle
  spill() {
    let any = false;
    for (const c of this.trayItems.children) {
      if (!['coffee', 'tea', 'water', 'soda', 'beer', 'juice', 'sparkling', 'wine'].includes(c.userData.item) || c.userData.spilled) continue;
      c.userData.spilled = true; any = true;
      for (const ch of [...c.children]) c.remove(ch);
      c.rotation.z = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); c.position.y = 0.04;
      const col = c.userData.item === 'coffee' ? '#3b2314' : c.userData.item === 'tea' ? '#8a4a1c' : c.userData.item === 'wine' ? '#5a0f1f' : '#cfe3ee';
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.07 + Math.random() * 0.04, 16), new THREE.MeshStandardMaterial({ color: col, roughness: 0.05, transparent: true, opacity: 0.85 }));
      puddle.rotation.x = -Math.PI / 2; puddle.position.set(c.position.x + 0.03, 0.0125, c.position.z + 0.02); puddle.scale.set(1.3, 1, 1);
      this.trayItems.add(puddle);
    }
    this.cup = false;
    if (any) this.audio.thump(0.2, 200);
    return any;
  }

  look(dx, dy) {
    const s = 0.0022 * (this.sensitivity || 1);
    this.yaw -= dx * s; this.pitch -= dy * s;
    this.pitch = clamp(this.pitch, -1.35, 1.2);
    if (this.state === 'seated' || this.state === 'jump') this.yaw = clamp(this.yaw, -2.7, 2.7);
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
