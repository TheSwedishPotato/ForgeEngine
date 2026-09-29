// Boarding at Arlanda: the gate hold room in pier F, the self-boarding gates, the jet bridge to door
// L1, the passengers boarding group by group and stowing their bags, the purser at the door, and
// the doors closing and the bridge pulling back before pushback.
//
// Everything here is built in the aircraft's own frame (x right, y up from the cabin floor, z aft),
// because the aircraft stands still at the gate: the hold room's glass and the bridge's windows are
// stencil openings like the cabin windows, so the real apron, pier and our own A320 show through them.
// Geometry: nose-in stand, main gear 25 m from pier F's west facade; bridge floor rising 0.9 m from
// the door sill (3.5 m above the apron) to the pier's upper floor.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DOORS, LAYOUT, rowZ, wallX, BUSINESS_ROWS } from './cabin.js';
import { canvasTex } from './textures.js';
import { Actor } from './people.js';
import { POSES, composePose } from './humans.js';
import { MAIN_GEAR } from './airframe.js';
import { rng, clamp, lerp, fmtClock } from './core.js';

const DZ = DOORS.L1.z;
export const FACADE_Z = MAIN_GEAR.z - 25;         // pier F west facade in aircraft coordinates
const LOUNGE_Y = 0.9;                             // pier floor above the cabin floor
const HALL = { x0: -34, x1: 24, z0: FACADE_Z - 20, z1: FACADE_Z };
const CAB = { x0: -4.7, x1: -2.02, z0: DZ - 1.2, z1: DZ + 1.2, h: 2.3 };
const TUN = { a: new THREE.Vector2(-3.55, DZ - 1.2), b: new THREE.Vector2(-7.0, FACADE_Z), w: 2.3, h: 2.35 };
const GATE = { x: -7.0, z: FACADE_Z - 1.6 };       // the self-boarding gates, just inside the facade
const GROUPS = { 1: 'Group 1 · SkyPriority (Business, EuroBonus Gold and Diamond)', 2: 'Group 2 · Premium and EuroBonus Silver', 3: 'Group 3', 4: 'Group 4 · Economy Light' };

export class Boarding {
  constructor(S, { seed = 11, gate = 'F36' } = {}) {
    this.S = S; this.r = rng(seed); this.gate = gate;
    this.group = new THREE.Group(); this.group.name = 'boarding'; S.cabinScene.add(this.group);
    this.maskMeshes = []; this.interactables = [];
    this.t = 0; this.called = 0; this.complete = false; this.playerScanned = false; this.playerAboard = false;
    this.queue = []; this.active = []; this.retract = 0; this.doorClosed = false;
    this._buildHall(); this._buildBridge();
    this._seatPassengers();
  }

  // ---------------- geometry ----------------
  _mat(color, rough = 0.8, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra }); }
  _box(w, h, d, x, y, z, mat, parent = this.group) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m; }
  _mask(geo, x, y, z, ry = 0, parent = this.group) { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false })); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); this.maskMeshes.push(m); return m; }

  _buildHall() {
    const H = HALL, y0 = LOUNGE_Y, top = y0 + 4.2, g = this.group;
    const tile = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#b9bcbf'; c.fillRect(0, 0, w, h); const r = rng(3); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = `hsl(210,4%,${68 + r() * 6}%)`; c.fillRect(i * 128 + 1, j * 128 + 1, 126, 126); } }, { repeat: true });
    tile.repeat.set((H.x1 - H.x0) / 1.2, (H.z1 - H.z0) / 1.2);
    const carpet = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#4a4f57'; c.fillRect(0, 0, w, h); const r = rng(5); for (let i = 0; i < 3000; i++) { c.fillStyle = r() < 0.5 ? '#434850' : '#535861'; c.fillRect(r() * w, r() * h, 2, 2); } }, { repeat: true });
    carpet.repeat.set(10, 5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0, H.z1 - H.z0), this._mat('#ffffff', 0.35, { map: tile, envMapIntensity: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set((H.x0 + H.x1) / 2, y0, (H.z0 + H.z1) / 2); g.add(floor);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(34, 11), this._mat('#ffffff', 0.95, { map: carpet }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(-8, y0 + 0.004, FACADE_Z - 10); g.add(rug);
    // ceiling with light strips
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0, H.z1 - H.z0), this._mat('#e9eaeb', 0.9)); ceil.rotation.x = Math.PI / 2; ceil.position.set((H.x0 + H.x1) / 2, top, (H.z0 + H.z1) / 2); g.add(ceil);
    const lampM = new THREE.MeshBasicMaterial({ color: '#fff7e8' });
    for (let x = H.x0 + 3; x < H.x1; x += 6) for (let z = H.z0 + 2.5; z < H.z1; z += 5) { const l = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.25), lampM); l.rotation.x = Math.PI / 2; l.position.set(x, top - 0.01, z); g.add(l); }
    // west facade: floor-to-ceiling glass on steel mullions, the bridge doorway at the gate
    const steel = this._mat('#6d737b', 0.4, { metalness: 0.6 });
    this._box(H.x1 - H.x0, 0.3, 0.2, (H.x0 + H.x1) / 2, y0 + 0.15, H.z1, steel);
    this._box(H.x1 - H.x0, 0.4, 0.2, (H.x0 + H.x1) / 2, top - 0.2, H.z1, steel);
    for (let x = H.x0; x <= H.x1; x += 1.8) if (Math.abs(x - TUN.b.x) > 1.3) this._box(0.08, top - y0, 0.14, x, (y0 + top) / 2, H.z1, steel);
    this._box(H.x1 - H.x0, 0.06, 0.1, (H.x0 + H.x1) / 2, y0 + 2.3, H.z1, steel);
    // the glass: stencil openings either side of the bridge door, and a door frame
    const bx = TUN.b.x, dw = 1.25;
    const wL = bx - dw - H.x0, wR = H.x1 - (bx + dw);
    this._mask(new THREE.PlaneGeometry(wL, top - y0 - 0.7), H.x0 + wL / 2, (y0 + 0.3 + top - 0.4) / 2, H.z1 + 0.02);
    this._mask(new THREE.PlaneGeometry(wR, top - y0 - 0.7), bx + dw + wR / 2, (y0 + 0.3 + top - 0.4) / 2, H.z1 + 0.02);
    this._mask(new THREE.PlaneGeometry(2 * dw, top - y0 - 2.6), bx, top - 0.4 - (top - y0 - 2.6) / 2, H.z1 + 0.02);
    this._box(0.15, 2.3, 0.3, bx - dw, y0 + 1.15, H.z1, steel); this._box(0.15, 2.3, 0.3, bx + dw, y0 + 1.15, H.z1, steel);
    // east wall (towards the pier's other side) and the two ends: solid, with a band of clerestory glass
    const wall = this._mat('#d7d9db', 0.85);
    const east = this._box(H.x1 - H.x0, top - y0, 0.2, (H.x0 + H.x1) / 2, (y0 + top) / 2, H.z0, wall);
    for (const x of [H.x0, H.x1]) this._box(0.2, top - y0, H.z1 - H.z0, x, (y0 + top) / 2, (H.z0 + H.z1) / 2, wall);
    void east;
    // columns
    for (let x = H.x0 + 9; x < H.x1; x += 12) for (const z of [H.z0 + 4, H.z1 - 7]) this._box(0.5, top - y0, 0.5, x, (y0 + top) / 2, z, this._mat('#cfd2d5', 0.6));
    // gate sign and flight information screens
    const now = this.S.opts;
    const fids = canvasTex(1024, 512, (c, w, h) => {
      c.fillStyle = '#0d1d3a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd200'; c.font = 'bold 150px Arial'; c.fillText(this.gate, 40, 160);
      c.fillStyle = '#ffffff'; c.font = 'bold 72px Arial'; c.fillText(now.flight || 'SK1415', 380, 110); c.fillText(fmtClock(now.depTime ?? 6), 760, 110);
      c.font = '64px Arial'; c.fillText('København / Copenhagen', 380, 200);
      c.fillStyle = '#9fb3d6'; c.font = '46px Arial'; c.fillText('SAS · Scandinavian Airlines', 40, 300);
      this._fidsStatus = (st) => { c.fillStyle = '#0d1d3a'; c.fillRect(0, 340, w, 172); c.fillStyle = st.col; c.font = 'bold 84px Arial'; c.fillText(st.text, 40, 440); };
      this._fidsStatus({ text: 'Gate open', col: '#35e05a' });
    });
    this.fidsTex = fids;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: fids, toneMapped: false }));
    scr.position.set(GATE.x - 3.6, y0 + 2.3, FACADE_Z - 2.6); scr.rotation.y = Math.PI; g.add(scr);
    this._box(2.3, 1.2, 0.08, GATE.x - 3.6, y0 + 2.3, FACADE_Z - 2.55, this._mat('#1b1d22', 0.5));
    const sign = canvasTex(512, 256, (c, w, h) => { c.fillStyle = '#1a1c21'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd200'; c.font = 'bold 170px Arial'; c.textAlign = 'center'; c.fillText(this.gate, w / 2, 190); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false }));
    sm.position.set(GATE.x, top - 0.9, FACADE_Z - 3.2); sm.rotation.y = Math.PI; g.add(sm);
    const sm2 = sm.clone(); sm2.rotation.y = 0; sm2.position.z -= 0.02; g.add(sm2);
    // gate desk
    const deskM = this._mat('#e8e6e1', 0.5);
    this._box(2.4, 1.05, 0.7, GATE.x - 3.6, y0 + 0.525, FACADE_Z - 3.4, deskM);
    this._box(2.5, 0.05, 0.8, GATE.x - 3.6, y0 + 1.07, FACADE_Z - 3.4, this._mat('#2b3a67', 0.4));
    // self-boarding gates: two lanes with glass flaps and a scanner
    this.flaps = [];
    for (const dx of [-0.55, 0.55]) {
      const lane = GATE.x + dx;
      for (const sx of [-0.4, 0.4]) this._box(0.18, 1.0, 1.3, lane + sx, y0 + 0.5, GATE.z, this._mat('#c9ccd0', 0.35, { metalness: 0.4 }));
      const scanner = this._box(0.16, 0.05, 0.16, lane - 0.4, y0 + 1.04, GATE.z - 0.35, this._mat('#101216', 0.3));
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#2a6cff' })); glow.rotation.x = -Math.PI / 2; glow.position.set(lane - 0.4, y0 + 1.07, GATE.z - 0.35); g.add(glow);
      scanner.userData.interact = { kind: 'egate', prompt: () => (this.playerScanned ? 'Boarding pass accepted' : 'Scan your boarding pass') };
      this.interactables.push(scanner);
      const flapM = new THREE.MeshStandardMaterial({ color: '#a8c4d8', roughness: 0.1, transparent: true, opacity: 0.45 });
      const flaps = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(lane + s * 0.31, y0 + 0.55, GATE.z); g.add(p); const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.02), flapM); f.position.x = -s * 0.15; p.add(f); return { p, s }; });
      this.flaps.push({ lane, flaps, open: 0, until: 0, glow });
    }
    // rope lanes to the gates
    const post = this._mat('#b8bdc3', 0.3, { metalness: 0.7 }), belt = this._mat('#27365e', 0.6);
    for (let k = 0; k < 6; k++) for (const dx of [-1.1, 1.1]) { const z = GATE.z - 1.2 - k * 1.1; this._box(0.06, 1.0, 0.06, GATE.x + dx, y0 + 0.5, z, post); if (k) this._box(0.03, 0.06, 1.1, GATE.x + dx, y0 + 0.93, z + 0.55, belt); }
    // waiting-area seating: rows of black chairs on steel beams facing the apron
    this.chairs = [];
    const seatM = this._mat('#24272d', 0.7), legM = this._mat('#9aa0a7', 0.35, { metalness: 0.7 });
    const chairGeo = new RoundedBoxGeometry(0.5, 0.08, 0.48, 2, 0.02), backGeo = new RoundedBoxGeometry(0.5, 0.45, 0.07, 2, 0.02);
    const nx = 12;
    for (let row = 0; row < 7; row++) for (const block of [-22, -1]) {
      const z = FACADE_Z - 5.5 - row * 1.6, x0 = block - nx * 0.28;
      this._box(nx * 0.56, 0.06, 0.1, block, y0 + 0.3, z - 0.05, legM);
      for (let i = 0; i < nx; i++) {
        const x = x0 + 0.28 + i * 0.56;
        const s = new THREE.Mesh(chairGeo, seatM); s.position.set(x, y0 + 0.43, z); g.add(s);
        const b = new THREE.Mesh(backGeo, seatM); b.position.set(x, y0 + 0.7, z - 0.26); b.rotation.x = -0.12; g.add(b);
        this.chairs.push({ x, z, used: false });
      }
      for (const lx of [x0 + 0.3, x0 + nx * 0.56 - 0.3]) this._box(0.06, 0.3, 0.4, lx, y0 + 0.15, z, legM);
    }
  }

  _buildBridge() {
    const g = this.bridge = new THREE.Group(); this.group.add(g);
    const inner = this._mat('#c9cbc7', 0.85), floorM = this._mat('#3c414c', 0.95), outer = this._mat('#9ea3a8', 0.6), rubber = this._mat('#1d1f22', 0.9);
    const lampM = new THREE.MeshBasicMaterial({ color: '#fff4e0' });
    // cab against the door, a bellows canopy round the door frame
    const C = CAB, cw = C.x1 - C.x0, cd = C.z1 - C.z0;
    const cab = new THREE.Group(); g.add(cab); this.cab = cab;
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), floorM); fl.rotation.x = -Math.PI / 2; fl.position.set((C.x0 + C.x1) / 2, 0.005, (C.z0 + C.z1) / 2); cab.add(fl);
    this._box(cw, 0.05, cd, (C.x0 + C.x1) / 2, C.h, (C.z0 + C.z1) / 2, inner, cab);
    this._box(0.08, C.h, cd, C.x0, C.h / 2, (C.z0 + C.z1) / 2, inner, cab);
    this._box(cw, C.h, 0.08, (C.x0 + C.x1) / 2, C.h / 2, C.z1, inner, cab);
    // forward wall: open where the tunnel leaves
    this._box(0.55, C.h, 0.08, C.x1 - 0.275, C.h / 2, C.z0, inner, cab);
    for (const s of [-1, 1]) this._box(0.25, C.h + 0.1, 0.3, C.x1 + 0.05, C.h / 2, DZ + s * 0.62, rubber, cab);
    this._box(0.25, 0.3, 1.5, C.x1 + 0.05, C.h - 0.05, DZ, rubber, cab);
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), lampM); cl.rotation.x = Math.PI / 2; cl.position.set((C.x0 + C.x1) / 2, C.h - 0.03, DZ); cab.add(cl);
    // cab side window looking aft along the fuselage
    this._mask(new THREE.PlaneGeometry(1.2, 0.8), C.x0 + 1.1, 1.3, C.z1 - 0.05, 0, cab);
    // tunnel: rising from the cab to the pier, a band of windows each side
    const d = TUN.b.clone().sub(TUN.a), L = d.length(), ang = Math.atan2(d.x, d.y); // rotation about y so +z runs along the tunnel
    const tun = new THREE.Group(); tun.position.set(TUN.a.x, 0, TUN.a.y); tun.rotation.y = ang; g.add(tun);
    const pitch = Math.atan2(LOUNGE_Y, L);
    const body = new THREE.Group(); body.rotation.x = -pitch; tun.add(body);
    const W = TUN.w, Hh = TUN.h;
    const tfl = new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorM); tfl.rotation.x = -Math.PI / 2; tfl.position.set(0, 0.005, L / 2); body.add(tfl);
    this._box(W, 0.05, L, 0, Hh, L / 2, inner, body);
    for (const s of [-1, 1]) {
      this._box(0.08, 0.95, L, s * W / 2, 0.475, L / 2, inner, body);
      this._box(0.08, 0.45, L, s * W / 2, Hh - 0.225, L / 2, inner, body);
      for (let z = 0; z <= L; z += 1.5) this._box(0.1, Hh, 0.12, s * W / 2, Hh / 2, z, inner, body);
      this._mask(new THREE.PlaneGeometry(L, Hh - 1.4), s * (W / 2 + 0.03), 0.95 + (Hh - 1.4) / 2, L / 2, Math.PI / 2, body);
    }
    for (let z = 1; z < L; z += 2.5) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.0), lampM); l.rotation.x = Math.PI / 2; l.position.set(0, Hh - 0.03, z); body.add(l); }
    // outside skin (seen from the lounge and the cabin windows)
    const none = new THREE.MeshBasicMaterial({ visible: false });
    const skin = new THREE.Mesh(new THREE.BoxGeometry(W + 0.25, Hh + 0.25, L), [outer, outer, outer, outer, none, none]);
    skin.position.set(0, Hh / 2, L / 2); body.add(skin);
    // legs down to the apron
    const leg = this._mat('#3a3f47', 0.7);
    this._box(0.5, 3.5, 0.5, C.x0 + 0.4, -1.75, DZ, leg, g);
    this._box(0.5, 3.8, 0.5, TUN.a.x + d.x * 0.6 / 1, -1.9, TUN.a.y + d.y * 0.6, leg, g);
  }

  // ---------------- walking ----------------
  // where people can stand, and the floor height there
  inTunnel(x, z, margin = 0.25) {
    const a = TUN.a, b = TUN.b, ex = b.x - a.x, ez = b.y - a.y, L2 = ex * ex + ez * ez;
    const u = ((x - a.x) * ex + (z - a.y) * ez) / L2;
    if (u < -0.05 || u > 1.02) return null;
    const px = a.x + ex * u, pz = a.y + ez * u;
    return Math.hypot(x - px, z - pz) < TUN.w / 2 - margin ? clamp(u, 0, 1) : null;
  }
  floorAt(x, z) {
    if (z < FACADE_Z - 0.05) return LOUNGE_Y;
    const u = this.inTunnel(x, z, 0);
    if (u != null && x < CAB.x1 - 0.3) return LOUNGE_Y * clamp(u, 0, 1);
    return 0;
  }
  walkable(x, z) {
    if (!this.group.visible) return false;
    const H = HALL;
    // hold room, with the gate line passable only through a lane after scanning
    if (z < FACADE_Z - 0.3 && z > H.z0 + 0.4 && x > H.x0 + 0.4 && x < H.x1 - 0.4) {
      if (z > GATE.z - 0.7 && z < GATE.z + 0.7) return this.playerScanned && Math.abs(x - GATE.x) < 0.9;
      if (z >= GATE.z + 0.7) return Math.abs(x - GATE.x) < 1.1;
      return true;
    }
    if (!this.playerScanned && !this.playerAboard) return false;
    if (z >= FACADE_Z - 0.3 && z < FACADE_Z + 0.6 && Math.abs(x - TUN.b.x) < 0.9) return true;
    if (this.inTunnel(x, z) != null) return true;
    if (x > CAB.x0 + 0.3 && x < CAB.x1 && z > CAB.z0 + 0.3 && z < CAB.z1 - 0.3) return true;
    if (this.S.cabin.doors.L1.open > 0.8 && x > -2.4 && x < -1.1 && Math.abs(z - DZ) < 0.35) return true;
    return false;
  }
  // the route from the gate to door L1
  bridgePath() { return [[GATE.x, GATE.z + 0.9], [TUN.b.x, FACADE_Z + 0.5], [lerp(TUN.a.x, TUN.b.x, 0.5), lerp(TUN.a.y, TUN.b.y, 0.5)], [TUN.a.x + 0.1, TUN.a.y + 0.3], [-3.2, DZ], [-1.3, DZ], [0, DZ]]; }

  // ---------------- passengers ----------------
  _seatPassengers() {
    const S = this.S, P = S.people, r = this.r;
    const chairs = [...this.chairs].sort(() => r() - 0.5);
    for (const p of P.pax) {
      p.group.userData.home = { pos: p.group.position.clone(), rot: p.group.rotation.y };
      p.boardGroup = p.seat.business ? 1 : r() < 0.12 ? 1 : r() < 0.15 ? 2 : r() < 0.75 ? 3 : 4;
      p.bag = r() < (p.boardGroup === 4 ? 0.2 : 0.8);
      p.trayHome = p.tray; p.tray = false;
      const c = chairs.pop();
      if (c) { c.used = true; p.group.position.set(c.x, LOUNGE_Y + 0.455 - 0.84 * p.s, c.z + 0.1); p.group.rotation.y = 0; }
      else { p.group.position.set(-30 + r() * 20, LOUNGE_Y + 0.455 - 0.84 * p.s, FACADE_Z - 16); }
      p.inLounge = true;
      this.queue.push(p);
    }
    // the neighbour waits in the hold room too
    const nb = P.neighbor;
    if (nb) {
      const c = chairs.pop() || { x: 0, z: FACADE_Z - 8 };
      nb.home = { x: nb.actor.x, z: nb.actor.z, y: nb.actor.seatY };
      nb.actor.place(c.x, c.z + 0.1, 0); nb.actor.seatY = LOUNGE_Y + 0.455 - 0.84 * nb.actor.h.s;
      nb.boardGroup = 3; nb.inLounge = true;
      this.queue.push({ neighbor: nb, boardGroup: 3, seat: nb.seat });
    }
    P.refreshTrays();
    // boarding order within each group: roughly random, as it is at the gate
    this.queue.sort((a, b) => a.boardGroup - b.boardGroup || r() - 0.5);
    this.playerGroup = S.player.seat.business ? 1 : 3;
  }

  _walkIn(p) {
    const S = this.S, people = S.people;
    const nb = p.neighbor;
    const act = nb ? nb.actor : new Actor(p.app, S.cabinScene, {});
    if (!nb) { act.place(p.group.position.x, p.group.position.z + 0.3, 0); p.group.visible = false; }
    act.seated = false; act.base = POSES.stand; act.boarding = true;
    const seat = p.seat, bag = nb ? true : p.bag;
    if (bag) act.setProp('r', 'bag');
    const x = act.x, edge = x < -11 ? (x < -22 ? -25.9 : -18.1) : (x < -1 ? -4.9 : 2.9); // out along the row to the nearest gangway
    const pts = [[x, act.z + 0.55], [edge, act.z + 0.55], [edge, FACADE_Z - 4.6], [GATE.x + (this.r() < 0.5 ? -0.55 : 0.55), GATE.z - 1.0]];
    for (const q of pts) act.queue({ type: 'walk', x: q[0], z: q[1], speed: 1.0 });
    act.queue({ type: 'wait', dur: 1.2 + this.r() * 1.5 }, { type: 'call', fn: () => this._beep(act.x, false) });
    for (const q of this.bridgePath()) act.queue({ type: 'walk', x: q[0], z: q[1], speed: 0.9 });
    // down the aisle to the row, stow the bag, sit
    act.queue({ type: 'walk', x: 0, z: seat.z - 0.3, speed: 0.75 });
    if (bag) act.queue({ type: 'face', h: seat.x < 0 ? -Math.PI / 2 : Math.PI / 2 }, { type: 'call', fn: () => this._openBin(seat) }, { type: 'gesture', name: 'stow' }, { type: 'wait', dur: 1 + this.r() * 3 });
    act.queue({ type: 'walk', x: seat.x * 0.9, z: seat.z - 0.28, speed: 0.5 });
    if (nb) {
      act.queue({ type: 'sit', x: nb.home.x, z: nb.home.z, h: Math.PI, y: nb.home.y, pose: composePose(POSES.stand, POSES.sit) },
        { type: 'call', fn: () => { act.boarding = false; act.setProp('r', null); this._done(p); } });
    } else {
      act.queue({ type: 'call', fn: () => {
        const h = p.group.userData.home; p.group.position.copy(h.pos); p.group.rotation.y = h.rot; p.group.visible = true; p.inLounge = false; p.tray = p.trayHome;
        S.cabinScene.remove(act.root); people.walkers.splice(people.walkers.indexOf(act), 1); people.refreshTrays(); this._done(p);
      } });
      people.walkers.push(act);
    }
    this.active.push(p);
  }
  _done(p) { p.boarded = true; this.active.splice(this.active.indexOf(p), 1); if (p.neighbor) p.neighbor.inLounge = false; }
  _openBin(seat) { const z = seat.z - 0.3, b = this.S.cabin.bins.find((q) => q.side === Math.sign(seat.x) && z >= q.z0 - 0.05 && z <= q.z1 + 0.05); if (b && b.target < 0.5) { b.target = 1; if (Math.abs(this.S.player.eye.z - z) < 8) this.S.audio.binOpen?.(); } }
  _beep(x, player) {
    const f = this.flaps.sort((a, b) => Math.abs(a.lane - x) - Math.abs(b.lane - x))[0];
    f.until = this.t + 3.5; f.glow.material.color.set('#35e05a');
    if (player || Math.hypot(this.S.player.eye.x - x, this.S.player.eye.z - GATE.z) < 12) this.S.audio.beep?.();
  }

  // ---------------- the gate's timeline ----------------
  pa(text, sv) {
    const S = this.S;
    if (S.fast) return;
    S.audio.chime?.('hilo');
    const speaker = { name: `Gate ${this.gate}`, gender: 'f', pitch: 1.08, rate: 1.03 };
    S.voice.say([{ text: sv, lang: 'sv', speaker, pa: true }, { text, lang: 'en', speaker, pa: true }], { priority: 2, channel: 'pa' });
    S.ui.radio?.({ kind: 'cabin', who: `Gate ${this.gate}`, text });
  }
  callGroup(n) {
    this.called = n;
    const lines = {
      1: ['SAS flight SK1415 to Copenhagen is now ready for boarding. We welcome passengers travelling with small children or needing extra time, and SkyPriority passengers, group 1.', 'SAS flyg SK1415 till Köpenhamn är nu klart för ombordstigning. Vi välkomnar resenärer med små barn eller som behöver extra tid, och SkyPriority, grupp 1.'],
      2: ['We now welcome boarding group 2 for SK1415 to Copenhagen.', 'Vi välkomnar nu grupp 2 för SK1415 till Köpenhamn.'],
      3: ['Boarding group 3 for SK1415 to Copenhagen, you are welcome to the gate. Please have your boarding pass ready.', 'Grupp 3 för SK1415 till Köpenhamn, välkommen fram till gaten. Ha ditt boardingkort redo.'],
      4: ['All remaining passengers for SK1415 to Copenhagen, group 4, you are welcome to board.', 'Alla övriga resenärer till Köpenhamn med SK1415, grupp 4, välkomna ombord.'],
    }[n];
    this.pa(lines[0], lines[1]);
    this._fidsStatus?.({ text: `Boarding · group ${n}`, col: '#ffd200' }); this.fidsTex.needsUpdate = true;
    if (n === this.playerGroup) this.S.ui.toast(`Your boarding group is called (${GROUPS[n]}) — scan your boarding pass at the gate`, 7);
  }

  playerScan() {
    const S = this.S;
    if (this.playerScanned) return;
    if (this.called < this.playerGroup) { S.audio.beep?.(); S.ui.toast(`Not yet — the pass says ${GROUPS[this.playerGroup]}. Group ${this.called || '—'} is boarding.`, 5); return; }
    this.playerScanned = true; this._beep(S.player.pos.x, true);
    S.ui.toast(`Boarding pass accepted · seat ${S.player.seat.id} · walk down the jet bridge`, 5);
  }

  update(dt) {
    const S = this.S, P = S.player;
    this.t += dt;
    const t = this.t;
    // group calls: boarding opens a minute in, a new group every few minutes (or when the gate queue runs dry)
    const next = this.called + 1;
    const due = next === 1 ? 50 : next === 2 ? 170 : next === 3 ? 260 : 620;
    if (next <= 4 && t > due) this.callGroup(next);
    // passengers leave their chairs for the gate, about one every 5-7 s (scanning and the queue in the bridge set the pace)
    this._nextPax = (this._nextPax ?? 55) - dt;
    if (this._nextPax <= 0 && this.queue.length && this.queue[0].boardGroup <= this.called && this.active.length < 40) {
      this._nextPax = 4 + this.r() * 4;
      this._walkIn(this.queue.shift());
    }
    // gate flaps
    for (const f of this.flaps) { const tgt = t < f.until ? 1 : 0; f.open += clamp(tgt - f.open, -dt * 3, dt * 3); for (const q of f.flaps) q.p.rotation.y = q.s * f.open * 1.45; if (t > f.until) f.glow.material.color.set('#2a6cff'); }
    // the player on board
    if (!this.playerAboard && P.pos.z > DZ - 1 && P.pos.x > -1.3) { this.playerAboard = true; this._greet(); }
    // everyone aboard: final call for a player still in the terminal, then the gate is closed
    if (!this.queue.length && !this.active.length && !this.everyoneAboard) { this.everyoneAboard = t; }
    if (this.everyoneAboard && !this.playerAboard && !this._finalCall && t - this.everyoneAboard > 20) {
      this._finalCall = t;
      this.pa(`This is the final call for passenger in seat ${P.seat.id} travelling to Copenhagen on SK1415. Please proceed to gate ${this.gate} immediately.`, `Sista utrop för resenär på plats ${P.seat.id} till Köpenhamn med SK1415. Vänligen gå omedelbart till gate ${this.gate}.`);
    }
    if (this._finalCall && !this.playerAboard && t - this._finalCall > 150) { S.ui.toast('The gate agent walks you down the jet bridge to the aircraft.', 5); this.skipToSeat(); }
    // doors close once everyone including the player is seated
    // (A-CDM: the doors close in time for the target start-up approval time, a few minutes before departure)
    const clock = S.opts.startClock + S.director.t / 3600, tsat = (S.opts.depTime ?? 6) - 7 / 60;
    if (this.everyoneAboard && P.state === 'seated' && !this.doorClosed && !this._closeT && clock >= tsat) { this._closeT = t + (S.fast ? 5 : 25); }
    if (this._closeT && t > this._closeT && !this.doorClosed) this._closeDoors();
    if (this.doorClosed) {
      this.retract = Math.min(1, this.retract + dt / 30);
      const k = this.retract;
      this.bridge.position.set(-k * 2.2, 0, 0); this.cab.rotation.y = 0;
    }
    if (this.doorClosed && S.fm.phase !== 'boarding' && this.group.visible && P.pos.z > DZ - 1) this.hide();
  }

  _greet() {
    const S = this.S, pur = S.people.crewNamed('purser');
    const side = S.player.seat.x < 0 ? 'left' : 'right';
    const row = S.player.seat.row;
    const where = row <= 8 ? 'just here at the front' : row <= 20 ? 'in the middle' : 'towards the back';
    S.director.crewLine(pur, `God morgon, välkommen ombord! ${S.player.seat.id} is on the ${side}, ${where}.`);
  }

  _closeDoors() {
    const S = this.S;
    this.doorClosed = true; this.complete = true;
    S.cabin.doors.L1.target = 0; S.audio.doorThud?.();
    for (const b of S.cabin.bins) b.target = 0;
    this._fidsStatus?.({ text: 'Gate closed', col: '#ff5a4a' }); this.fidsTex.needsUpdate = true;
    const pur = S.people.crewNamed('purser');
    S.director.crewLine(pur, 'Boarding completed, doors closing.');
    S.ui.radio?.({ kind: 'cabin', who: 'Purser', text: 'Cockpit, cabin: boarding completed, all passengers on board, doors closed.' });
    if (S.crew) S.crew.boardingDone = true;
    S.director.boardingDone();
  }

  // the player goes straight to the seat; the rest of the cabin fills up at once
  skipToSeat() {
    const S = this.S, P = S.player;
    this.playerScanned = true; this.playerAboard = true;
    if (this.called < 4) for (let n = this.called + 1; n <= 4; n++) this.called = n;
    while (this.queue.length) { const p = this.queue.shift(); this._seatNow(p); }
    for (const p of [...this.active]) this._seatNow(p);
    if (P.state !== 'seated') { P.state = 'standing'; P.pos.set(0, 0, P.seat.z - 0.28); P.sitDown(); }
    this.everyoneAboard = this.everyoneAboard || this.t;
  }
  _seatNow(p) {
    const S = this.S, people = S.people;
    if (p.neighbor) { const a = p.neighbor.actor; a.clear(); a.setProp('r', null); a.seated = true; a.base = composePose(POSES.stand, POSES.sit); a.seatY = p.neighbor.home.y; a.place(p.neighbor.home.x, p.neighbor.home.z, Math.PI); a.boarding = false; p.neighbor.inLounge = false; }
    else {
      const w = people.walkers.find((a) => a.app === p.app);
      if (w) { S.cabinScene.remove(w.root); people.walkers.splice(people.walkers.indexOf(w), 1); }
      const h = p.group.userData.home; p.group.position.copy(h.pos); p.group.rotation.y = h.rot; p.group.visible = true; p.inLounge = false; p.tray = p.trayHome;
    }
    p.boarded = true; const i = this.active.indexOf(p); if (i >= 0) this.active.splice(i, 1);
    people.refreshTrays();
  }

  hide() {
    this.hidden = true; this.group.visible = false;
    for (const m of this.maskMeshes) m.visible = false;
    this.S.scenery?.showOurJetway?.(true);
  }
}
