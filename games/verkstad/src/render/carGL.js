/**
 * A car in 3D, built from its assembly: every part its own group (so it can come off and be carried
 * away), every fastener its own little mesh (so a socket can find it), the panels on their hinges,
 * the engine and what is bolted to it rocking on the mounts with every firing (and more with every
 * misfire), the instrument cluster drawn live from the simulation.
 *
 * Picking: each mesh carries userData { partId } or { fastId }, and the game raycasts against
 * `pickables`.
 */
import { Group, Mesh, BoxGeometry, CylinderGeometry, CanvasTexture, SRGBColorSpace, MeshStandardMaterial, Color, PlaneGeometry, DoubleSide } from 'three';
import { BodyShape } from '../car/body.js';
import { meshGroup, splitGroups, fastenerGeometry } from './geo.js';
import { paintMat } from './mats.js';

const ENGINE_MOUNTED = /^(engine|oilcap|dipstick|drainplug|oilfilter|plug\d|coil\d|distcap|rotor|distributor|belt|alternator|tensioner|thermohousing|thermostat|manifold|starter)$/;

export class CarGL {
  constructor(customer, M) {
    this.c = customer; this.A = customer.A; this.S = customer.S; this.M = M;
    this.spec = this.A.spec;
    this.root = new Group(); this.root.name = 'car';
    this.paint = paintMat(this.A.paint);
    this.paint.side = DoubleSide;
    this.groups = new Map();        // partId -> Group
    this.fastMeshes = new Map();    // fastId -> Mesh
    this.pickables = [];
    this.glassMeshes = [];          // drawn by render/carGlass.js, see-through, not by the deferred pass
    this.mat = (m) => (m === 'paint' ? this.paint : m === 'clusterScreen' ? this.clusterMat : this.M[m] ?? this.M.steel);
    this._cluster();
    this.engineGroup = new Group();
    const lay = this.A.layout;
    this.enginePivot = [0, lay.engY - 0.1, lay.engZ];
    this.engineGroup.position.set(...this.enginePivot);
    this.root.add(this.engineGroup);
    if (this.spec.body !== 'f1') this._body();
    for (const p of this.A.parts.values()) this._part(p);
    this._items();
    this.spin = { FL: 0, FR: 0, RL: 0, RR: 0 };
  }

  // ---- building -----------------------------------------------------------------------------------

  _body() {
    const B = (this.body = new BodyShape(this.spec));
    const P = B.P;
    const panels = B.panels();
    const glass = this.M.glass, paint = this.paint;
    const inPanel = (z, s) => panels.some((r) => z > r.z[0] - 0.006 && z < r.z[1] + 0.006 && s > r.s[0] - 0.006 && s < r.s[1] + 0.006);
    const add = (geo, grp, partId) => {
      for (const { geo: g, mat } of splitGroups(geo)) {
        const m = new Mesh(g, mat === 1 ? glass : paint);
        m.castShadow = mat !== 1; m.receiveShadow = true; m.userData.partId = partId;
        if (mat === 1) { m.userData.forgeSkip = true; this.glassMeshes.push(m); }
        grp.add(m); this.pickables.push(m);
      }
    };
    // the shell: everything that is not a panel, and the two end faces
    const shell = new Group(); shell.userData.partId = 'body';
    add(B.patch(P.rear, P.front, 0, 2, [0, 0, 0], (z, s) => !inPanel(z, s)), shell, 'body');
    add(B.cap(true), shell, 'body');
    if (!P.hatch) add(B.cap(false), shell, 'body');
    // the floor pan, the bulkhead, the wheel houses, the grille, bumpers, mirrors, plates
    const d = this.spec.dims, volvo = this.spec.id === 'volvo240';
    const extra = [
      { t: 'box', s: [d.width - 0.12, 0.02, P.cowl - P.trunkF - 0.1], p: [0, 0.25, (P.cowl + P.trunkF) / 2 - 0.05], m: 'carpet' },
      { t: 'box', s: [d.width - 0.15, 0.55, 0.02], p: [0, 0.55, P.cowl - 0.12], m: 'paintBlack' },
      ...[this.spec.dims.wheelbase / 2, -this.spec.dims.wheelbase / 2].flatMap((z) => [1, -1].map((sx) => ({ t: 'box', s: [0.02, 0.36, 0.78], p: [sx * (d.width / 2 - 0.3), this.spec.wheels.tyreR + 0.2, z], m: 'blackPlastic' }))),
      ...(volvo
        ? [{ t: 'box', s: [0.62, 0.22, 0.03], p: [0, 0.62, P.front + 0.005], m: 'chrome' }, { t: 'box', s: [0.58, 0.18, 0.03], p: [0, 0.62, P.front + 0.01], m: 'blackPlastic' }]
        : [{ t: 'box', s: [0.6, 0.06, 0.03], p: [0, 0.64, P.front - 0.02], m: 'blackPlastic' }, { t: 'box', s: [0.7, 0.14, 0.04], p: [0, 0.42, P.front - 0.02], m: 'blackPlastic' }]),
    ];
    shell.add(meshGroup(extra, this.mat));
    this._tagPick(shell, 'body');
    this.root.add(shell); this.groups.set('body', shell);
    // the panels on their hinges
    for (const r of panels) {
      const h = B.hinge(r.id);
      const grp = new Group(); grp.position.set(...h.pivot); grp.userData.hinge = h;
      const pid = r.id;                    // hood, trunk, doorFL, doorFR, doorRL, doorRR: the assembly's part ids
      add(B.patch(r.z[0], r.z[1], r.s[0], r.s[1], h.pivot), grp, pid);
      if (r.id === 'trunk' && P.hatch) add(B.cap(false, h.pivot), grp, pid);
      if (r.id.startsWith('doorF')) {     // the door mirror and handles
        const side = r.id.endsWith('L') ? 1 : -1, st = B.station(r.z[1] - 0.1);
        grp.add(meshGroup([{ t: 'box', s: [0.16, 0.1, 0.07], p: [side * 0.09, st[2] + 0.02 - h.pivot[1], -0.12], m: volvo ? 'blackPlastic' : 'paint' }], this.mat));
      }
      if (r.id.startsWith('door')) { const side = r.id.endsWith('L') ? 1 : -1, st = B.station((r.z[0] + r.z[1]) / 2); grp.add(meshGroup([{ t: 'box', s: [0.02, 0.025, 0.14], p: [side * 0.01, st[2] - 0.08 - h.pivot[1], r.z[0] - h.pivot[2] + 0.18], m: volvo ? 'chrome' : 'paint' }], this.mat)); }
      this._tagPick(grp, pid);
      this.root.add(grp); this.groups.set(pid, grp);
    }
    // bumpers and plates
    const bump = (z, dir) => [{ t: 'box', s: [d.width - 0.08, volvo ? 0.14 : 0.2, volvo ? 0.12 : 0.1], p: [0, volvo ? 0.44 : 0.4, z + dir * (volvo ? 0.05 : 0.0)], m: volvo ? 'blackPlastic' : 'paint' }];
    for (const [id, z, dir] of [['bumperF', P.front, 1], ['bumperR', P.rear, -1]]) {
      const g = meshGroup([...bump(z, dir), { t: 'box', s: [0.52, 0.11, 0.01], p: [0, volvo ? 0.6 : (dir > 0 ? 0.42 : 0.62), z + dir * (volvo ? 0.115 : 0.055)], m: 'plateMat' }], (m) => (m === 'plateMat' ? this._plateMat() : this.mat(m)));
      this._tagPick(g, id); this.root.add(g); this.groups.set(id, g);
    }
  }

  _plateMat() {
    if (this.plateMat) return this.plateMat;
    const c = document.createElement('canvas'); c.width = 256; c.height = 56;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 256, 56); g.fillStyle = '#1f3f9a'; g.fillRect(0, 0, 26, 56);
    g.fillStyle = '#f2d21a'; g.font = '700 12px Inter, Arial'; g.fillText('S', 8, 46);
    g.fillStyle = '#111'; g.font = '700 38px Arial, Helvetica, sans-serif'; g.textBaseline = 'middle'; g.fillText(this.c.plate, 36, 30);
    g.strokeStyle = '#111'; g.lineWidth = 3; g.strokeRect(1, 1, 254, 54);
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
    return (this.plateMat = new MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.4, metalness: 0.2 }));
  }

  _tagPick(grp, partId) { grp.traverse((o) => { if (o.isMesh) { o.userData.partId ??= partId; if (!this.pickables.includes(o)) this.pickables.push(o); } }); }

  _part(p) {
    if (p.panel && p.panel !== 'f1' && this.spec.body !== 'f1') return;     // drawn with the body
    if (!p.g.length && !p.fasteners.length) return;
    const grp = meshGroup(p.g, this.mat);
    grp.position.set(...p.pos);
    grp.rotation.set(...p.rot);
    grp.userData.partId = p.id;
    this._tagPick(grp, p.id);
    for (const fid of p.fasteners) {
      const f = this.A.fast(fid);
      const g = fastenerGeometry(f);
      if (!g) continue;
      const m = new Mesh(g, f.drive === 'pin' ? this.M.chrome : f.size >= 30 && f.drive === 'hex' ? this.M.titanium : this.M.steel);
      m.userData.fastId = fid; m.castShadow = true;
      grp.add(m); this.fastMeshes.set(fid, m); this.pickables.push(m);
    }
    if (ENGINE_MOUNTED.test(p.id) && this.spec.body !== 'f1') {
      grp.position.set(p.pos[0] - this.enginePivot[0], p.pos[1] - this.enginePivot[1], p.pos[2] - this.enginePivot[2]);
      this.engineGroup.add(grp);
    } else this.root.add(grp);
    grp.userData.home = { parent: grp.parent, pos: grp.position.clone(), rot: grp.rotation.clone() };
    this.groups.set(p.id, grp);
    if (p.kind === 'erslight') this.ersMesh = grp.children[0];
    if (p.kind === 'diag') { const led = grp.children.find((m) => m.material === this.M.redLens); if (led) { led.material = this.M.redLens.clone(); this.diagLed = led; } }
  }

  /** Things customers leave in cars: a small parcel with its label, where they left it. */
  _items() {
    const lay = this.A.layout, zF = this.spec.dims.wheelbase / 2;
    const at = { airbox: lay.air ? [lay.air[0], lay.air[1] + 0.02, lay.air[2]] : [0, 0.6, 1], underseat: [0.37, 0.32, zF - 1.55], glovebox: [-0.37, 0.8, zF - 1.1], boot: [0.2, 0.5, -this.spec.dims.wheelbase / 2 - 0.5], enginebay: [-0.3, 0.75, zF + 0.4], socket: [0.0, 0.72, zF - 1.2] };
    this.itemMeshes = new Map();
    for (const it of this.A.items) {
      const m = new Mesh(new BoxGeometry(0.06, 0.04, 0.08), this.M.cardboard);
      if (/coin/.test(it.label)) { m.geometry = new CylinderGeometry(0.0125, 0.0125, 0.002, 20); m.material = this.M.copper; }
      if (/nest/.test(it.label)) { m.geometry = new BoxGeometry(0.14, 0.05, 0.12); m.material = this.M.filterPaper; }
      m.position.set(...(at[it.location] ?? [0, 0.6, 0]));
      m.userData.itemId = it.id;
      this.root.add(m); this.pickables.push(m); this.itemMeshes.set(it.id, m);
    }
  }

  _cluster() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 192;
    this.clusterCanvas = c; this.clusterG = c.getContext('2d');
    this.clusterTex = new CanvasTexture(c); this.clusterTex.colorSpace = SRGBColorSpace;
    this.clusterMat = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(1, 1, 1), emissiveMap: this.clusterTex, emissiveIntensity: 1.4, roughness: 0.3 });
  }

  _drawCluster() {
    const g = this.clusterG, S = this.S, L = S.lamps ?? {}, G = S.gauges ?? { rpm: 0, coolant: 10, volts: 0 };
    const key = `${Math.round(G.rpm / 50)}|${Math.round(G.coolant)}|${Object.values(L).join()}|${this.A.state.ignition}|${Math.floor(performance.now() / 400) % 2}`;
    if (key === this._ck) return;
    this._ck = key;
    g.fillStyle = '#050607'; g.fillRect(0, 0, 512, 192);
    if (this.A.state.ignition < 1) { this.clusterTex.needsUpdate = true; return; }
    const dial = (cx, val, max, label) => {
      g.strokeStyle = '#d8d8d0'; g.lineWidth = 3; g.beginPath(); g.arc(cx, 100, 70, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      for (let i = 0; i <= 8; i++) { const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5; g.beginPath(); g.moveTo(cx + Math.cos(a) * 60, 100 + Math.sin(a) * 60); g.lineTo(cx + Math.cos(a) * 70, 100 + Math.sin(a) * 70); g.stroke(); }
      const a = Math.PI * 0.75 + Math.min(1, val / max) * Math.PI * 1.5;
      g.strokeStyle = '#ff5a1f'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, 100); g.lineTo(cx + Math.cos(a) * 62, 100 + Math.sin(a) * 62); g.stroke();
      g.fillStyle = '#9a9a92'; g.font = '600 14px Arial'; g.textAlign = 'center'; g.fillText(label, cx, 150);
    };
    dial(100, G.rpm, 7000, 'x1000 r/min');
    dial(412, 0, 220, 'km/h');
    // temperature
    const t = Math.max(0, Math.min(1, (G.coolant - 40) / 90));
    g.fillStyle = '#333'; g.fillRect(230, 30, 52, 8); g.fillStyle = t > 0.85 ? '#ff3020' : '#d8d8d0'; g.fillRect(230, 30, 52 * t, 8);
    g.fillStyle = '#9a9a92'; g.font = '600 12px Arial'; g.textAlign = 'center'; g.fillText('TEMP', 256, 54);
    // the warning lamps
    const lamp = (x, y, on, col, txt) => { g.fillStyle = on ? col : '#1a1a1a'; g.fillRect(x, y, 44, 22); g.fillStyle = on ? '#000' : '#333'; g.font = '700 11px Arial'; g.fillText(txt, x + 22, y + 15); };
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    lamp(190, 70, L.battery, '#ff2a1a', 'BATT'); lamp(240, 70, L.oil, '#ff2a1a', 'OIL'); lamp(290, 70, L.brake, '#ff2a1a', 'BRAKE');
    lamp(190, 100, L.engine && (!L.engineFlash || blink), '#ffa21a', 'ENGINE'); lamp(240, 100, L.tpms, '#ffa21a', 'TYRE'); lamp(290, 100, L.epb || L.bulb, '#ffa21a', L.epb ? 'EPB' : 'BULB');
    this.clusterTex.needsUpdate = true;
  }

  // ---- each frame -------------------------------------------------------------------------------

  update(dt) {
    const A = this.A, st = A.state;
    // hinges: doors, bonnet, boot
    for (const [id, grp] of this.groups) {
      const h = grp.userData.hinge; if (!h) continue;
      const target = id === 'hood' ? (st.hoodOpen ? 1.1 : st.hoodLatch ? 0.04 : 0) * (this.spec.id === 'volvo240' ? 1.1 : 1) : id === 'trunk' ? (st.trunkOpen ? 1.2 : 0) : (st.doors[id.slice(4)] ?? 0) * 1.1;
      grp.userData.ang = (grp.userData.ang ?? 0) + (target - (grp.userData.ang ?? 0)) * Math.min(1, dt * 4);
      const a = grp.userData.ang * h.sign;
      if (h.axis === 'x') grp.rotation.x = a; else grp.rotation.y = a;
    }
    // parts that are off the car are the world's (game.js moves them); fasteners that are out are in the tray
    for (const [fid, m] of this.fastMeshes) { const f = A.fast(fid); m.visible = !f.out && !f.snapped; }
    // the engine on its mounts: rocks with the firing, more when it runs rough
    const E = this.S.E;
    if (E.running || E.omega > 1) {
      const rough = this.S.roughness;
      const amp = 0.0012 + Math.min(0.03, rough * 0.0006);
      const w = E.theta * (this.spec.engine.cyl / 2);
      const a = Math.sin(w) * amp * (E.running ? 1 : 0.6) + E.roll * 25;
      if (this.spec.engine.longitudinal) this.engineGroup.rotation.z = a; else this.engineGroup.rotation.x = a;
      this.engineGroup.position.y = this.enginePivot[1] + Math.sin(w * 2) * amp * 0.02;
    } else { this.engineGroup.rotation.set(0, 0, 0); this.engineGroup.position.set(...this.enginePivot); }
    // wheels spun by hand (or driven)
    for (const k of ['FL', 'FR', 'RL', 'RR']) {
      const w = this.S.wheelSpin[k];
      this.spin[k] += w * dt;
      const g = this.groups.get('wheel' + k);
      if (g && !A.part('wheel' + k).removed) g.rotation.x = this.spin[k];
      const dg = this.groups.get('disc' + k);
      if (dg && !A.part('disc' + k).removed) dg.rotation.x = this.spin[k];
    }
    if (this.ersMesh) { const safe = st.ersSafe; this.ersMesh.material = safe ? this._ersGreen ??= this.M.ersLight.clone() : this.M.ersLight; if (safe) this.ersMesh.material.emissive.setRGB(0.1, 1, 0.2); }
    if (this.diagLed) this.diagLed.material.emissiveIntensity = this.S.diagLed ? 6 : 0;
    for (const it of A.items) { const m = this.itemMeshes.get(it.id); if (m && it.found && m.parent === this.root) m.visible = false; }
    this._drawCluster();
  }

  /** The world matrix of a part's home position (where it goes back to). */
  homeOf(partId) { return this.groups.get(partId)?.userData.home; }

  /** A fresh copy of a part's model (a new part off the shelf), not yet on the car. */
  buildPart(p) {
    const grp = meshGroup(p.g, this.mat);
    for (const fid of p.fasteners) {
      const f = this.A.fast(fid), g = fastenerGeometry(f);
      if (!g) continue;
      const m = new Mesh(g, this.M.steel); m.userData.fastId = fid; m.castShadow = true; grp.add(m);
    }
    grp.traverse((o) => { if (o.isMesh && !o.userData.fastId) o.userData.partId = p.id; });
    return grp;
  }

  /** Makes this group the part's model on the car (a new part replacing the old one). */
  adopt(p, grp) {
    const old = this.groups.get(p.id);
    if (old === grp) return;
    grp.userData.home = old?.userData.home;
    grp.userData.partId = p.id;
    this.pickables = this.pickables.filter((m) => { let o = m; while (o) { if (o === old) return false; o = o.parent; } return true; });
    grp.traverse((o) => { if (o.isMesh) { this.pickables.push(o); if (o.userData.fastId) this.fastMeshes.set(o.userData.fastId, o); else o.userData.partId = p.id; } });
    this.groups.set(p.id, grp);
  }
}
