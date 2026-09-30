// The A320neo flight deck behind the cockpit door: the shell with its six windows, the glareshield
// and FCU, six display units (PFD, ND, E/WD, SD), both MCDUs, the standby instrument and clock, the
// overhead panel and the pedestal - every one of them drawn from the live state of the aircraft,
// its systems, the crew's switch positions, ATC and the other traffic - plus thrust, flap and
// speed-brake levers, sidesticks, pedals and trim wheels that move with the pilots' hands, the two
// pilots, and the third-occupant (jump) seat.
// Layout measured from the FlightGear A320 flight deck and the FlyByWire A32NX panel
// photographs: displays at z -5.6, FCU at z -5.44, pedestal from -5.5 to -4.6, overhead panel from
// -4.7 to -4.2, pilots' eyes about 1.2 m above the floor at x = -/+0.54.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { fusPoint, fusHalfWidthAt, COCKPIT_PANES, COCKPIT_DOOR_Z, paneOutline } from './airframe.js';
import { canvasTex } from './textures.js';
import { Human, crewAppearance, POSES, composePose } from './humans.js';
import { rng, clamp, lerp, smoothstep, DEG, KT, FT, project } from './core.js';
import { ROUTE_AIR } from './places.js';
import { drawPFD, drawND, drawEWD, drawSD, drawMCDU, drawISIS, drawClock, drawFCU, drawOverhead, drawPedestal } from './cockpitdisplays.js';

const Z0 = -6.02, Z1 = COCKPIT_DOOR_Z;       // flight deck from the windshield to the cockpit door
const EYE = { z: -4.85, y: 1.2, x: 0.54 };
const FEMALE = /Karin|Maria|Sofie|Emma/;
const VFE = [350, 230, 215, 200, 185, 177];  // VMO and the A320 flap placard speeds, kt (CONF 1, 1+F, 2, 3, FULL)
const FREQ_NAMES = { 'Arlanda Delivery': '121.825', 'Arlanda Ground': '121.705', 'Arlanda Tower': '118.500', 'Stockholm Control': '123.750', 'Sweden Control': '134.980', 'Copenhagen Approach': '119.805', 'Kastrup Tower': '118.105', 'Kastrup Apron': '121.630' };
const NEXT_UNIT = { 'Arlanda Delivery': 'Arlanda Ground', 'Arlanda Ground': 'Arlanda Tower', 'Arlanda Tower': 'Stockholm Control', 'Stockholm Control': 'Sweden Control', 'Sweden Control': 'Copenhagen Approach', 'Copenhagen Approach': 'Kastrup Tower', 'Kastrup Tower': 'Kastrup Apron', 'Kastrup Apron': 'Kastrup Apron' };

// A canvas that becomes a texture and is redrawn by one of the draw functions
class Screen {
  constructor(w, h, draw, arg) { this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h; this.g = this.c.getContext('2d'); this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4; this.fn = draw; this.arg = arg; }
  draw(d) { this.fn(this.g, d, this.arg); this.tex.needsUpdate = true; }
}

// ---------------- the flight deck ----------------
export class FlightDeck {
  constructor(scene, { seed = 3, crew = null } = {}) {
    this.group = new THREE.Group(); this.group.name = 'flightdeck'; scene.add(this.group);
    this.r = rng(seed);
    this.maskMeshes = []; this.interactables = [];
    this.mats = {
      lining: new THREE.MeshStandardMaterial({ color: '#8d959f', roughness: 0.75 }),
      panel: new THREE.MeshStandardMaterial({ color: '#4a5563', roughness: 0.6 }),
      dark: new THREE.MeshStandardMaterial({ color: '#23272e', roughness: 0.7 }),
      floor: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.95 }),
      seat: new THREE.MeshStandardMaterial({ color: '#2d3440', roughness: 0.85 }),
      metal: new THREE.MeshStandardMaterial({ color: '#b8bdc4', roughness: 0.35, metalness: 0.7 }),
    };
    this.screens = [];
    this._shell(); this._panels(); this._pedestal(); this._overhead(); this._seats(); this._lights();
    if (crew) this.setCrew(crew);
    this.t = 0; this.drawT = 0; this.slowT = 0;
    this.brkT = [15, 15, 15, 15]; this.fuelUsed = [0, 0]; this.iasTrend = 0; this._ias = null; this._cabAlt = null; this.cabVS = 0; this.et = 0;
  }
  _add(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; this.group.add(m); return m; }
  _screen(w, h, draw, arg, sizeX, sizeY, x, y, z, rx, emissive = true) {
    const s = new Screen(w, h, draw, arg);
    const mat = emissive ? new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: s.tex, roughness: 0.55 });
    const m = this._add(new THREE.PlaneGeometry(sizeX, sizeY), mat, x, y, z); m.rotation.x = rx; s.mesh = m; this.screens.push(s); return s;
  }

  _shell() {
    const M = this.mats;
    const LIN = -0.06, U0 = -0.45;
    const alpha = canvasTex(2048, 2048, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
      for (const pane of COCKPIT_PANES) {
        const o = paneOutline(pane, 0.985, 24);
        g.beginPath(); o.pts.forEach(([z, u], i) => { const X = (z - Z0) / (Z1 - Z0) * w, Y = h - (u - U0) / (1 - U0) * h; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); g.fill();
      }
    }, { srgb: false });
    const mat = M.lining.clone(); mat.alphaMap = alpha; mat.alphaTest = 0.5; mat.side = THREE.DoubleSide;
    const NZ = 60, NA = 90, P = new THREE.Vector3();
    for (const side of [-1, 1]) {
      const pos = [], uv = [], idx = [];
      for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NA; i++) {
        const z = lerp(Z0, Z1, j / NZ), u = lerp(U0, 1, i / NA);
        fusPoint(z, side, u, P, LIN); pos.push(P.x, Math.max(0, P.y), P.z); uv.push(j / NZ, i / NA);
      }
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; this.group.add(m);
    }
    // floor
    const fl = new THREE.Shape(); const N = 16;
    for (let i = 0; i <= N; i++) { const z = lerp(Z0 + 0.3, Z1, i / N); const x = fusHalfWidthAt(z, 0.02) - 0.08; if (i) fl.lineTo(x, z); else fl.moveTo(x, z); }
    for (let i = N; i >= 0; i--) { const z = lerp(Z0 + 0.3, Z1, i / N); fl.lineTo(-(fusHalfWidthAt(z, 0.02) - 0.08), z); }
    const fg = new THREE.ShapeGeometry(fl); fg.rotateX(Math.PI / 2); this._add(fg, M.floor, 0, 0.005, 0);
    // reveals (dark window surrounds from the lining to the skin) and the stencil openings
    const reveal = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.8, side: THREE.DoubleSide });
    const mm = new THREE.MeshBasicMaterial({ visible: false });
    for (const side of [-1, 1]) for (const pane of COCKPIT_PANES) {
      const inner = paneOutline(pane, 0.985, 16).pts, outer = paneOutline(pane, 1.0, 16).pts, n = inner.length;
      const rp = [], ri = [];
      for (let k = 0; k < n; k++) { fusPoint(inner[k][0], side, inner[k][1], P, LIN - 0.005); rp.push(P.x, P.y, P.z); fusPoint(outer[k][0], side, outer[k][1], P, 0.01); rp.push(P.x, P.y, P.z); }
      for (let k = 0; k < n; k++) { const a = 2 * k, b = 2 * ((k + 1) % n); ri.push(a, a + 1, b, b, a + 1, b + 1); }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri); rg.computeVertexNormals();
      this.group.add(new THREE.Mesh(rg, reveal));
      // opening: a fan over the pane, 3.5 cm inside the skin, a little larger than the lining hole
      const o = paneOutline(pane, 1.0, 16), mp = [], mi = [];
      fusPoint(o.cz, side, o.cu, P, -0.035); mp.push(P.x, P.y, P.z);
      for (const [z, u] of o.pts) { fusPoint(z, side, u, P, -0.035); mp.push(P.x, P.y, P.z); }
      for (let k = 0; k < o.pts.length; k++) mi.push(0, 1 + k, 1 + (k + 1) % o.pts.length);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3)); g.setIndex(mi);
      const m = new THREE.Mesh(g, mm); this.group.add(m); this.maskMeshes.push(m);
    }
  }

  _panels() {
    const M = this.mats;
    // main instrument panel, tilted back 12 degrees, and the glareshield above it
    const panel = this._add(new THREE.BoxGeometry(1.9, 0.62, 0.08), M.panel, 0, 0.62, -5.66); panel.rotation.x = -0.21;
    this._add(new RoundedBoxGeometry(2.0, 0.07, 0.42, 2, 0.02), M.dark, 0, 0.96, -5.66);
    // FCU with the EFIS panels, drawn live (windows, managed dots, mode lights)
    this.fcu = this._screen(1024, 128, drawFCU, null, 1.5, 0.19, 0, 0.905, -5.448, -0.1, false);
    // master warning and caution lights on the glareshield
    this.masterLights = [];
    for (const x of [-0.66, 0.66]) for (const [dx, col] of [[-0.035, '#ff2020'], [0.035, '#ffb000']]) {
      const m = this._add(new THREE.PlaneGeometry(0.05, 0.03), new THREE.MeshBasicMaterial({ color: '#221', toneMapped: false }), x + dx, 0.93, -5.45); m.rotation.x = -0.1;
      this.masterLights.push({ m, col, warn: dx < 0 });
    }
    // display units: captain PFD, ND; centre E/WD over SD; first officer ND, PFD
    const du = (draw, x, y) => this._screen(512, 512, draw, null, 0.2, 0.2, x, y, -5.615 + (0.66 - y) * 0.21, -0.21);
    this.pfd = [du(drawPFD, -0.73, 0.66), du(drawPFD, 0.73, 0.66)];
    this.nd = [du(drawND, -0.49, 0.66), du(drawND, 0.49, 0.66)];
    this.ewd = du(drawEWD, 0, 0.72);
    this.sd = this._screen(512, 512, drawSD, null, 0.19, 0.19, 0, 0.47, -5.52, -0.55);
    // standby instrument and clock
    this.isis = this._screen(256, 256, drawISIS, null, 0.085, 0.085, -0.2, 0.735, -5.61, -0.21);
    this.clock = this._screen(256, 128, drawClock, null, 0.09, 0.045, -0.9, 0.55, -5.585, -0.21);
    // MCDUs on the forward pedestal
    this.mcdu = [this._screen(256, 256, drawMCDU, 'capt', 0.17, 0.2, -0.17, 0.35, -5.33, -0.9), this._screen(256, 256, drawMCDU, 'fo', 0.17, 0.2, 0.17, 0.35, -5.33, -0.9)];
    // rudder pedals
    this.pedals = [];
    for (const px of [-0.54, 0.54]) for (const dx of [-0.1, 0.1]) { const p = this._add(new THREE.BoxGeometry(0.08, 0.2, 0.03), M.metal, px + dx, 0.18, -5.78); p.rotation.x = -0.5; this.pedals.push({ m: p, dx }); }
    // sidesticks on the side consoles
    this.sticks = [];
    for (const side of [-1, 1]) {
      this._add(new THREE.BoxGeometry(0.34, 0.6, 1.1), M.panel, side * 1.02, 0.3, -5.0);
      const pivot = new THREE.Group(); pivot.position.set(side * 0.93, 0.62, -5.02); this.group.add(pivot);
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.13, 4, 8), M.dark); grip.position.y = 0.09; pivot.add(grip);
      this.sticks.push({ pivot, side });
    }
  }

  _pedestal() {
    const M = this.mats;
    this._add(new THREE.BoxGeometry(0.46, 0.66, 1.0), M.panel, 0, 0.33, -5.02);
    // top of the pedestal: radio panel, lever quadrants, engine masters, ENG MODE, trim, park brake, transponder
    this.ped = this._screen(512, 1024, drawPedestal, null, 0.46, 0.92, 0, 0.662, -5.0, -Math.PI / 2, false);
    // thrust levers: pivot at the quadrant, travel from max reverse through idle to TOGA
    this.thrLevers = [];
    for (const x of [-0.07, 0.07]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.62, -5.12); this.group.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), M.metal); arm.position.y = 0.1; pivot.add(arm);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.05), M.dark); knob.position.y = 0.2; pivot.add(knob);
      this.thrLevers.push(pivot);
    }
    const mkLever = (x, z, col) => { const pivot = new THREE.Group(); pivot.position.set(x, 0.64, z); this.group.add(pivot); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.11, 0.018), M.metal); arm.position.y = 0.055; pivot.add(arm); const k = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); k.position.y = 0.11; pivot.add(k); return pivot; };
    this.flapLever = mkLever(0.16, -5.28, '#d9dde2');
    this.sbLever = mkLever(-0.16, -5.28, '#8a8f97');
    // pitch trim wheels either side of the thrust levers, turning with the stabiliser
    this.trimWheels = [];
    const stripe = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#1b1d22'; g.fillRect(0, 0, w, h); g.fillStyle = '#e8eaee'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 8); });
    for (const x of [-0.235, 0.235]) { const m = this._add(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 28), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), x, 0.58, -4.85); m.rotation.z = Math.PI / 2; this.trimWheels.push(m); }
    // landing gear lever and its three indicator lights; autobrake buttons
    // on the centre panel right of the SD (FCOM): gear lever with its wheel-shaped knob, the gear
    // indicator triangles above, the autobrake LO/MED/MAX push-buttons between SD and lever
    const pz = (y) => -5.6 + (0.66 - y) * 0.21;
    const lv = new THREE.Group(); lv.position.set(0.25, 0.52, pz(0.52) + 0.02); lv.rotation.x = -0.21; this.group.add(lv);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.06), this.mats.metal); stem.position.z = 0.03; lv.add(stem);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 16), new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.5 })); wheel.rotation.x = Math.PI / 2; wheel.position.z = 0.065; lv.add(wheel);
    this.gearLever = lv;
    this.gearLights = [0, 1, 2].map((i) => { const m = this._add(new THREE.PlaneGeometry(0.02, 0.016), new THREE.MeshBasicMaterial({ color: '#111', toneMapped: false }), 0.225 + (i - 1) * 0.026, 0.61, pz(0.61) + 0.003); m.rotation.x = -0.21; return m; });
    this.abLights = ['LO', 'MED', 'MAX'].map((k, i) => { const y = 0.565 - i * 0.022; const m = this._add(new THREE.PlaneGeometry(0.03, 0.016), new THREE.MeshBasicMaterial({ color: '#112', toneMapped: false }), 0.155, y, pz(y) + 0.003); m.rotation.x = -0.21; return { k, m }; });
  }

  _overhead() {
    // hangs about 12 cm under the crown lining from just behind the windshield to above the seats,
    // sloping up about 20 degrees; only its lower face carries the panels
    this.ovh = new Screen(1024, 1024, drawOverhead);
    const face = new THREE.MeshStandardMaterial({ map: this.ovh.tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: this.ovh.tex, emissiveIntensity: 0.25 });
    const m = this._add(new THREE.BoxGeometry(0.82, 0.08, 0.8), [this.mats.panel, this.mats.panel, this.mats.panel, face, this.mats.panel, this.mats.panel], 0, 1.74, -4.66);
    m.rotation.x = -0.34;
    this.screens.push(this.ovh);
  }

  _seats() {
    const M = this.mats;
    const seat = (x, z, face = 0) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; this.group.add(g);
      const add = (geo, px, py, pz, rx = 0) => { const m = new THREE.Mesh(geo, M.seat); m.position.set(px, py, pz); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
      add(new RoundedBoxGeometry(0.5, 0.1, 0.5, 2, 0.03), 0, 0.46, 0);
      add(new RoundedBoxGeometry(0.48, 0.62, 0.1, 2, 0.03), 0, 0.84, 0.27, 0.12);
      add(new RoundedBoxGeometry(0.26, 0.17, 0.09, 2, 0.03), 0, 1.24, 0.31, 0.12);
      add(new THREE.CylinderGeometry(0.05, 0.08, 0.4, 8), 0, 0.2, 0);
      for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.06, 0.05, 0.36, 2, 0.02), s * 0.28, 0.7, 0.05);
      return g;
    };
    seat(-EYE.x, -4.7); seat(EYE.x, -4.7);
    // third occupant seat behind the centre pedestal, facing forward
    this.jumpSeat = seat(0, -4.1);
    this.jumpSeat.scale.set(0.85, 0.95, 0.85);
    const hot = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.45), new THREE.MeshBasicMaterial({ visible: false })); hot.position.set(0, 0.6, -4.1); this.group.add(hot);
    hot.userData.interact = { kind: 'jumpseat', prompt: () => 'Sit on the observer (jump) seat' };
    this.interactables.push(hot);
    this.jumpEye = new THREE.Vector3(0, 1.2, -4.02);
  }

  _lights() {
    this.dome = new THREE.PointLight('#fff1dc', 0.6, 4, 1.5); this.dome.position.set(0, 1.9, -4.6); this.group.add(this.dome);
    this.panelGlow = new THREE.PointLight('#bcd4ff', 0.25, 1.6, 2); this.panelGlow.position.set(0, 0.8, -5.3); this.group.add(this.panelGlow);
  }

  setCrew(crew) {
    this.pilots = [];
    const r = this.r;
    for (const [p, x] of [[crew.capt, -EYE.x], [crew.fo, EYE.x]]) {
      const app = crewAppearance(r, { female: FEMALE.test(p.name), name: p.name });
      app.top = '#f3f4f6'; app.scarf = null; app.jacket = false; // jackets off in the seat: white shirt
      const h = new Human(app, { detail: 2 });
      h.root.position.set(x, 0.49 - 0.84 * h.s, -4.62); h.root.rotation.y = Math.PI;
      this.group.add(h.root);
      this.pilots.push({ h, p, x, look: 0, lookT: 2 + r() * 4, lookTgt: 0, pitchTgt: 0 });
    }
  }

  // Arm (and a little lean of the upper body) that puts the fingertips on a control, solved on the
  // pilot's own skeleton by coordinate descent, once per reach
  _solveArm(pl, side, to, base) {
    const h = pl.h, S = side === 'r' ? 'r' : 'l', hand = S === 'r' ? h.rHandItem : h.lHandItem;
    const T = new THREE.Vector3(to[0], to[1], to[2]), W = new THREE.Vector3();
    const x0 = [-1.2, S === 'r' ? 0.15 : -0.15, -0.6, -0.1];         // shoulder x, shoulder z, elbow x, spine x
    const lo = [-2.9, -1.4, -2.4, -0.45], hi = [0.6, 1.4, 0, 0.1];
    const pose = (x) => ({ ...base, spine: [x[3], 0, 0], [S + 'Shoulder']: [x[0], 0, x[1]], [S + 'Elbow']: [x[2], S === 'r' ? -0.25 : 0.25, 0], [S + 'Wrist']: [0.25, 0, 0] });
    const err = (x) => {
      h.setPose(pose(x)); h.root.updateMatrixWorld(true);
      hand.getWorldPosition(W); this.group.worldToLocal(W);
      return W.distanceToSquared(T) + 0.004 * x[3] * x[3];
    };
    let x = x0.slice(), e = err(x);
    for (let step = 0.5; step > 0.004; step *= 0.5) {
      let better = true;
      while (better) {
        better = false;
        for (let i = 0; i < 4; i++) for (const d of [step, -step]) {
          const y = x.slice(); y[i] = clamp(y[i] + d, lo[i], hi[i]);
          const f = err(y); if (f < e) { e = f; x = y; better = true; }
        }
      }
    }
    const p = pose(x), out = { spine: p.spine };
    for (const j of [S + 'Shoulder', S + 'Elbow', S + 'Wrist']) out[j] = p[j];
    return out;
  }

  // Per frame: levers, sticks and pilots always; the screens only while someone can see them
  update(dt, S, visible) {
    this.t += dt;
    const fm = S.fm, afs = fm.afs, c = fm.ctl;
    for (let i = 0; i < 2; i++) this.thrLevers[i].rotation.x = -0.75 * clamp(c.thr[i], -1, 1);
    this.flapLever.rotation.x = -c.flapLever * 0.18;
    this.sbLever.rotation.x = -(c.speedbrake || 0) * 0.5 + (c.spoilersArmed ? 0.12 : 0);
    for (const s of this.sticks) { s.pivot.rotation.x = -c.stickY * 0.3; s.pivot.rotation.z = -c.stickX * 0.3; }
    for (const p of this.pedals) p.m.position.z = -5.78 + (p.dx < 0 ? 1 : -1) * c.pedal * 0.04;
    for (const w of this.trimWheels) w.rotation.x = fm.ths * 40;
    this.gearLever.position.y = c.gearLever ? 0.495 : 0.545;
    for (const l of this.gearLights) l.material.color.set(fm.gear > 0.99 ? '#22dd33' : fm.gear > 0.01 ? '#ff2b2b' : '#111');
    for (const a of this.abLights) a.m.material.color.set(c.autobrake === a.k ? (fm.abActive ? '#22dd33' : '#33b7ff') : '#112');
    // brakes heat with the work they do and cool towards the outside air
    const oat = fm.air ? fm.air.T - 273.15 : 15;
    for (let i = 0; i < 4; i++) { const b = i < 2 ? fm.brakeL : fm.brakeR; const P = (fm.onGround ? b : 0) * 0.3 * fm.mass * 9.81 / 4 * fm.gs; this.brkT[i] += (P / 1.2e5 - (this.brkT[i] - oat) * 0.0025) * dt; }
    for (let i = 0; i < 2; i++) this.fuelUsed[i] += (fm.ff?.[i] || 0) * dt;
    if (dt > 0) { const a = this._ias == null ? 0 : (fm.ias - this._ias) / dt; this._ias = fm.ias; this.iasTrend += (a * 10 - this.iasTrend) * Math.min(1, dt * 1.5); const ca = fm.cabinAlt / FT; if (this._cabAlt != null) this.cabVS += ((ca - this._cabAlt) / dt * 60 - this.cabVS) * Math.min(1, dt * 0.5); this._cabAlt = ca; }
    if (!fm.onGround) this.et += dt;
    // master warning / caution, flashing
    const warn = fm.engFire.some(Boolean) || fm.stallWarn || fm.overspeed || fm.cabinAlt > 9550 * FT;
    const caution = !warn && (fm.engFail.some(Boolean) || !fm.hyd.green || !fm.hyd.yellow || !fm.hyd.blue);
    const blink = Math.floor(this.t * 2) % 2 === 0;
    for (const l of this.masterLights) l.m.material.color.set((l.warn ? warn : caution) && blink ? l.col : '#221');
    // pilots: heads scan the instruments and look out; the pilot flying's hand on the stick when flying by hand
    if (this.pilots) for (const pl of this.pilots) {
      pl.lookT -= dt; if (pl.lookT < 0) { pl.lookT = 1.5 + this.r() * 5; pl.lookTgt = (this.r() - 0.5) * 1.2; pl.pitchTgt = this.r() < 0.5 ? -0.25 : 0.05; }
      pl.look += (pl.lookTgt - pl.look) * Math.min(1, dt * 3);
      const pf = S.crew && S.crew.pf === pl.p;
      const manual = !afs.ap && pf && !fm.onGround;
      const onLevers = pf && (fm.phase === 'takeoff' || fm.phase === 'flare' || fm.phase === 'rollout' || (fm.phase === 'approach' && fm.agl < 300));
      const rest = { lShoulder: [0.2, 0, 0.2], rShoulder: [0.2, 0, -0.2], lElbow: [-0.95, 0.7, 0], rElbow: [-0.95, -0.7, 0], lWrist: [0.3, 0, 0], rWrist: [0.3, 0, 0] }; // hands on the thighs
      // the outboard hand on the sidestick grip, the inboard hand on the thrust levers (solved once)
      if (!pl._grip) {
        const base = composePose(POSES.stand, POSES.sit, rest), sd = pl.x < 0 ? -1 : 1;
        const noSpine = (o) => { delete o.spine; return o; };
        pl._grip = { stick: noSpine(this._solveArm(pl, sd < 0 ? 'l' : 'r', [sd * 0.93, 0.74, -5.0], base)), lever: noSpine(this._solveArm(pl, sd < 0 ? 'r' : 'l', [sd * 0.04, 0.8, -5.1], base)) };
      }
      const armOut = pl._grip.stick, lever = pl._grip.lever;
      // a hand reaching for, holding and letting go of a switch (crew.press): the arm goes to the control
      let reach = {}, look = null;
      const hd = pl.p.hand;
      if (hd && hd.to) {
        const k = hd.ph === 'reach' ? smoothstep(0, 1, hd.t / Math.max(hd.dur, 1e-3)) : hd.ph === 'hold' ? 1 : 1 - smoothstep(0, 1, hd.t / Math.max(hd.dur, 1e-3));
        const base = composePose(POSES.stand, POSES.sit, rest);
        if (hd._pose === undefined) hd._pose = this._solveArm(pl, hd.side, hd.to, base);
        const tgt = hd._pose;
        for (const j of Object.keys(tgt)) { const a = base[j] || [0, 0, 0], b = tgt[j]; reach[j] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
        // eyes on the switch while reaching
        const dx = hd.to[0] - pl.x, dy = hd.to[1] - 1.2, dz = hd.to[2] + 4.7;
        look = [Math.atan2(-dy, Math.hypot(dx, dz)) * 0.8 * k, Math.atan2(-dx, -dz) * k];
      }
      const lk = look ? { neck: [look[0] * 0.5, look[1] * 0.5, 0], head: [look[0] * 0.5, look[1] * 0.5, 0] } : { neck: [pl.pitchTgt * 0.6, pl.look * 0.6, 0], head: [pl.pitchTgt * 0.4, pl.look * 0.4, 0] };
      pl.h.setPose(composePose(POSES.stand, POSES.sit, rest, manual ? armOut : {}, onLevers ? lever : {}, reach, lk));
    }
    if (!visible) return;
    this.drawT -= dt; this.slowT -= dt;
    if (this.drawT > 0) return;
    this.drawT = 0.12;
    const d = this._data(S);
    for (const s of [...this.pfd, ...this.nd, this.ewd, this.fcu, this.isis, this.clock]) s.draw(d);
    if (this.slowT <= 0) { this.slowT = 0.8; for (const s of [this.sd, this.ped, this.ovh, ...this.mcdu]) s.draw(d); }
  }

  // Everything the screens and panels show, from the simulation
  _data(S) {
    const fm = S.fm, afs = fm.afs, c = fm.ctl, air = fm.air || {}, crew = S.crew || {}, sys = crew.sys || {}, D = S.director || {}, atc = S.atc;
    const deg = (a) => ((a / DEG) + 360) % 360;
    const w = fm.wind || {}; const wd = Math.hypot(w.wx || 0, w.wz || 0); const from = ((Math.atan2(-(w.wx || 0), (w.wz || 0)) / DEG) + 360) % 360;
    const sat = (air.T ?? 288) - 273.15, tat = sat + (air.T ?? 288) * 0.2 * fm.mach * fm.mach;
    const localH = (S.opts?.startClock ?? 6) + (D.t ?? fm.t) / 3600, utcH = ((localH - 2) % 24 + 24) % 24; // CEST = UTC + 2 in May
    const hh = Math.floor(utcH), mm = Math.floor((utcH % 1) * 60), ss = Math.floor((utcH * 3600) % 60);
    const utc = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, utcSec = String(ss).padStart(2, '0');
    const cfg = fm.cfgTarget, running = fm.engineRunning.slice(), starting = fm.engStart.map((s) => !!s);
    const appr = crew.appr || {};
    const inApproach = ['approach', 'flare', 'go-around'].includes(fm.phase) || (fm.phase === 'descent' && fm.m.touchdown - fm.s < 60000);
    const ilsTuned = !!afs.approachRwy && (inApproach || afs.latArmed === 'LOC' || afs.lat === 'LOC' || afs.lat === 'LOC*');
    const hd = fm.heading, rel = (x, z) => { const dx = x - fm.pos.x, dz = z - fm.pos.z; return [dx * Math.cos(hd) + dz * Math.sin(hd), dx * Math.sin(hd) - dz * Math.cos(hd)]; };
    // ND range the crew select for the phase of flight
    const altFt = fm.altInd / FT;
    const range = fm.onGround ? 10 : inApproach ? (fm.m.touchdown - fm.s < 20000 ? 10 : 20) : altFt < 10000 ? 20 : altFt < 25000 ? 40 : 80;
    // flight plan ahead
    const tp = {}, route = [];
    for (let s = fm.s; s < Math.min(fm.s + range * 1852 * 1.6, fm.route.path.length); s += Math.max(250, range * 60)) { fm.route.path.sample(s, tp); route.push(rel(tp.x, tp.z)); }
    const wpts = this._waypoints(fm).filter((w) => w.s > fm.s + 50).slice(0, 6).map((w) => ({ name: w.name, p: rel(w.x, w.z), s: w.s }));
    const to = wpts[0];
    const gsMs = Math.max(fm.gs, 60), eta = to ? (localH - 2 + (to.s - fm.s) / gsMs / 3600) : 0;
    const etaStr = to ? `${String(Math.floor(((eta % 24) + 24) % 24)).padStart(2, '0')}${String(Math.floor((eta % 1) * 60)).padStart(2, '0')}` : '';
    const arr = fm.route.arr, dest = { name: fm.airport === 'ARN' ? 'ESSA' : 'EKCH', x: arr ? arr.thr.x : 0, z: arr ? arr.thr.y : 0 };
    // TCAS: the other aircraft within 10 NM and 9,900 ft
    const tcas = [];
    for (const t of atc?.traffic || []) {
      if (t.x == null || !t.airborne) continue;
      const dxy = Math.hypot(t.x - fm.pos.x, t.z - fm.pos.z); if (dxy > 18520) continue;
      const relAlt = (t.y - fm.h) / FT; if (Math.abs(relAlt) > 9900) continue;
      tcas.push({ p: rel(t.x, t.z), rel: relAlt, vs: (t.vs || 0) / FT * 60, ta: !fm.onGround && dxy < 6 * 1852 && Math.abs(relAlt) < 850 });
    }
    // weather radar
    const wx = [];
    if (S.wx?.cells && !fm.onGround) for (const cell of S.wx.cells) { const st = S.wx.stage(cell, fm.t); if (!st.alive) continue; const p = rel(cell.x, cell.z); if (p[1] < -2000 || Math.hypot(p[0], p[1]) > range * 1852 * 1.2) continue; wx.push([p[0], p[1], cell.R, st.rain * (0.6 + cell.k)]); }
    // thrust limit shown above the N1 gauges
    const idle = 0.2, tla = Math.max(c.thr[0], c.thr[1]);
    const lim = fm.onGround && fm.phase !== 'takeoff' ? 'FLX' : tla > 0.98 || afs._toga > 0 ? 'TOGA' : fm.engFail.some(Boolean) ? 'MCT' : afs.phase === 'TAKEOFF' ? (tla > 0.98 ? 'TOGA' : 'FLX') : 'CLB';
    const limVal = { TOGA: 1, FLX: 0.8, MCT: 0.8, CLB: 0.6 }[lim];
    const limN1 = afs._leverN1 ? afs._leverN1(limVal, idle) * 100 : 90;
    // memos: take-off memo on the ground after engine start, landing memo below 2,000 ft
    const memo = [], memoRight = [];
    for (let i = 0; i < 2; i++) if (fm.engFire[i]) memo.push({ t: `ENG ${i + 1} FIRE`, c: '#ff2b2b' }); else if (fm.engFail[i]) memo.push({ t: `ENG ${i + 1} FAIL`, c: '#ffae00' });
    if (!fm.pressurised) memo.push({ t: 'CAB PR EXCESS CAB ALT', c: '#ff2b2b' });
    if (!fm.hyd.green) memo.push({ t: 'HYD G SYS LO PR', c: '#ffae00' });
    if (fm.stallWarn) memo.push({ t: 'STALL', c: '#ff2b2b' });
    if (!memo.length) {
      if (fm.onGround && running[0] && running[1] && !['takeoff', 'rollout', 'taxi-in', 'arrived'].includes(fm.phase)) {
        const ok = (v, a, b) => (v ? { t: a } : { t: b, c: '#29c5ff' });
        memo.push({ t: 'T.O' }, ok(c.autobrake === 'MAX', 'AUTO BRK MAX', 'AUTO BRK.......MAX'), ok(D.seatbelt, 'SIGNS ON', 'SIGNS.........ON'), ok(D.crewSeated, 'CABIN READY', 'CABIN.......CHECK'), ok(c.spoilersArmed, 'SPLRS ARM', 'SPLRS.........ARM'), ok(c.flapLever >= 1, 'FLAPS T.O', 'FLAPS.........T.O'));
      } else if (!fm.onGround && fm.agl < 2000 * FT && inApproach) {
        const ok = (v, a, b) => (v ? { t: a } : { t: b, c: '#29c5ff' });
        memo.push({ t: 'LDG' }, ok(fm.gear > 0.99, 'LDG GEAR DN', 'LDG GEAR.......DN'), ok(D.seatbelt, 'SIGNS ON', 'SIGNS.........ON'), ok(D.times?.crewSeatedLdg != null, 'CABIN READY', 'CABIN.......CHECK'), ok(c.spoilersArmed, 'SPLRS ARM', 'SPLRS.........ARM'), ok(cfg >= 4, 'FLAPS FULL', 'FLAPS........FULL'));
      }
    }
    if (c.parkBrake) memoRight.push({ t: 'PARK BRK' });
    if (D.seatbelt) memoRight.push({ t: 'SEAT BELTS' });
    memoRight.push({ t: 'NO SMOKING' });
    if (sys.apuAvail) memoRight.push({ t: 'APU AVAIL' });
    if (sys.apuBleed) memoRight.push({ t: 'APU BLEED' });
    if (sys.engAI) memoRight.push({ t: 'ENG A.ICE' });
    if (sys.wingAI) memoRight.push({ t: 'WING A.ICE' });
    if (c.spoilersArmed && !memo.length) memoRight.push({ t: 'GND SPLRS ARMED' });
    if (fm.tug && fm.tug.state !== 'off') memoRight.push({ t: 'NW STRG DISC' });
    // ECAM system display page: engine start, the doors at the gate, wheels on the ground and with the gear down, cruise; a failure calls its own page
    let sdPage = 'CRUISE';
    if (!fm.pressurised) sdPage = 'CAB PRESS'; else if (!fm.hyd.green || !fm.hyd.yellow || !fm.hyd.blue) sdPage = 'HYD'; else if (starting[0] || starting[1] || fm.engFail.some(Boolean) || fm.engFire.some(Boolean)) sdPage = 'ENG';
    else if (fm.onGround && !running[0] && !running[1]) sdPage = 'DOOR/OXY';
    else if (fm.onGround && fm.phase !== 'takeoff') sdPage = 'WHEEL';
    else if (fm.phase === 'takeoff' || (fm.phase === 'climb' && fm.agl < 1500 * FT)) sdPage = 'ENG';
    else if (fm.gear > 0.5 && !fm.onGround) sdPage = 'WHEEL';
    const unit = atc?.unit || 'Arlanda Ground';
    const pfdIdx = afs.fma();
    return {
      // PFD
      fma: pfdIdx, athr: afs.athr, athrActive: afs.athrActive, ap1: afs.ap, fd: afs.fd,
      capability: inApproach && appr.cat ? (appr.autoland ? (appr.cat === 'CAT III' ? 'CAT3 DUAL' : 'CAT2') : 'CAT1') : '', dh: inApproach && appr.cat ? (appr.cat === 'CAT I' ? `DA ${Math.round((appr.dh || 0) / FT + (fm.airport === 'ARN' ? 137 : 17))}` : appr.dh ? `DH ${Math.round(appr.dh / FT)}` : 'NO DH') : '', dhFt: (appr.dh || 0) / FT,
      ias: fm.ias, iasTrend: this.iasTrend, mach: fm.mach, alt: altFt, vs: fm.vs / FT * 60, pitch: fm.pitch, bank: fm.bank, beta: fm.beta || 0,
      hdg: deg(fm.heading), trk: deg(fm.track), hdgSel: afs.fcu.hdg, onGround: fm.onGround, radioAlt: fm.agl / FT,
      fdPitch: (afs.gammaCmd || 0) + (fm.alpha || 0) - fm.pitch, fdRoll: (afs.bankCmd || 0) - fm.bank,
      spd: afs.spdTarget, spdManaged: afs.fcu.spd == null, vls: afs.vls ? afs.vls(Math.min(5, Math.round(fm.cfgf ?? 0))) : 0, vmax: VFE[cfg] ?? 350, v1: afs.v1, vr: afs.vr,
      gdot: afs.greenDot?.(), sSpd: afs.sSpeed?.(), fSpd: afs.fSpeed?.(), cfg,
      altTarget: afs.fcu.alt, altTargetStr: fm.baro == null && afs.fcu.alt >= 6000 ? `FL${String(Math.round(afs.fcu.alt / 100)).padStart(3, '0')}` : String(afs.fcu.alt), altManaged: !!afs.fcu.altManaged && ['CLB', 'DES', 'ALT CST'].includes((pfdIdx.vert || '').split(' · ')[0]),
      std: fm.baro == null, qnh: fm.baro ? Math.round(fm.baro) : 1013,
      ilsTuned, locValid: afs.locValid, gsValid: afs.gsValid, locDev: afs.locDots || 0, gsDev: afs.gsDots || 0, ilsId: afs.approachRwy ? `${afs.approachRwy.id} 110.${afs.approachRwy.id === '22L' ? '50' : '30'}` : '',
      warn: fm.stallWarn ? 'STALL' : fm.overspeed ? 'OVERSPEED' : '', pfdMsg: fm.agl < 400 * FT && !fm.onGround && fm.gear < 0.9 && inApproach ? 'GEAR NOT DOWN' : '',
      // ND
      gs: fm.gs / KT, tas: fm.tas / KT, windTxt: wd < 0.5 ? '' : `${String(Math.round(from)).padStart(3, '0')}°/${Math.round(wd / KT)}`, windArrow: wd > 1, windFrom: from,
      range, route, wpts, toName: to?.name, toDist: to ? (to.s - fm.s) / 1852 : 0, eta: etaStr, destName: dest.name, destP: rel(dest.x, dest.z), tcas, wx, tcasMode: fm.phase === 'lineup' || !fm.onGround ? 'TA/RA' : 'STBY',
      // E/WD
      thrLimit: lim, thrLimitN1: limN1, n1: fm.n1.map((n) => n * 100), n1Cmd: fm.n1Cmd.map((n) => n * 100), n2: fm.n2, egt: fm.egt, ff: fm.ff || [0, 0],
      fail: fm.engFail, fire: fm.engFire, running, starting, startPhase: fm.engStart.map((s) => s?.phase), fob: fm.fuel,
      slat: fm.slat, flap: fm.flap, flapsMoving: fm.flapsMoving, cfgLabel: ['0', '1', '1+F', '2', '3', 'FULL'][cfg] || '0', memo, memoRight,
      // SD
      sdPage, doors: { L1: S.cabin?.doors?.L1?.open || 0 }, cockpitDoor: S.cabin?.cockpitDoor?.open || 0, cargoOpen: fm.phase === 'boarding' || fm.phase === 'arrived',
      slidesArmed: D.times ? (D.times.boardDone != null || !S.boarding) && D.times.beltOffGate == null && fm.phase !== 'arrived' : false,
      gear: fm.gear, brakeTemp: this.brkT, autobrake: c.autobrake, parkBrake: c.parkBrake, steer: fm.steer / DEG, towing: !!(fm.tug && fm.tug.state !== 'off'), spoilerOut: fm.groundSpoiler || 0,
      fuelUsed: this.fuelUsed, oilQt: fm.n2.map((n, i) => 17.6 - n * 1.2 - this.fuelUsed[i] * 0.0001), oilPsi: fm.n2.map((n) => (n > 0.1 ? 20 + 60 * n : 0)), vibN1: fm.n1.map((n) => n * 0.35), vibN2: fm.n2.map((n) => n * 0.45),
      startValve: fm.engStart.map((s) => !!s && !s.cut), startPsi: fm.engStart.map((s) => (s && !s.cut ? 34 : 0)), ign: fm.engStart.map((s) => !!s && s.phase !== 'crank' && fm.n2[0] < 0.55),
      hyd: fm.hyd, dP: fm.pressurised ? Math.max(0, Math.min(8.3, (fm.h - fm.cabinAlt) / 1200)) : 0, cabAlt: fm.cabinAlt / FT, cabVS: this.cabVS, ldgElev: fm.airport === 'ARN' ? 137 : 17, packs: true, cabinT: [22, 23, 23],
      tat, sat, utc, utcSec, gw: fm.mass, gwcg: 27.0, et: `${String(Math.floor(this.et / 3600)).padStart(2, '0')}:${String(Math.floor(this.et / 60) % 60).padStart(2, '0')}`,
      // MCDUs
      ...this._mcdu(S, wpts, etaStr),
      // FCU
      fcuSpd: afs.fcu.spd ? String(Math.round(afs.fcu.spd)) : afs.fcu.mach ? `.${Math.round(afs.fcu.mach * 100)}` : '---', machMode: !!afs.fcu.mach || (fm.mach > 0.7 && afs.fcu.spd == null), fcuHdg: afs.fcu.hdg != null ? String(Math.round(afs.fcu.hdg)).padStart(3, '0') : '---', hdgManaged: afs.fcu.hdg == null,
      fcuAlt: String(afs.fcu.alt).padStart(5, '0'), fcuVs: afs.vert === 'V/S' ? `${afs.fcu.vs >= 0 ? '+' : '-'}${String(Math.abs(Math.round((afs.fcu.vs || 0) / 100))).padStart(2, '0')}oo` : '-----',
      locArmed: afs.latArmed === 'LOC' || (afs.lat || '').startsWith('LOC'), apprArmed: afs.vertArmed === 'G/S' || (afs.vert || '').startsWith('G/S'), lsOn: ilsTuned,
      // overhead
      masks: !!S.cabinDyn?.masks, anyEngine: running[0] || running[1], agentDisch: crew.st?.fireAgent || [false, false],
      extPwrAvail: fm.phase === 'boarding' || fm.phase === 'arrived', apuMaster: !!sys.apuMaster, apuAvail: !!sys.apuAvail, apuStarting: !!sys.apuMaster && !sys.apuAvail, apuBleed: !!sys.apuBleed,
      engAI: !!sys.engAI, wingAI: !!sys.wingAI, strobe: fm.onGround && !['lineup', 'takeoff'].includes(fm.phase) ? 'AUTO' : 'ON', beacon: S.lights?.beacon ?? (running[0] || running[1]), nav: true,
      taxiLt: S.lights?.taxi, landLt: S.lights?.landing, noseLt: S.lights?.nose, seatBelts: !!D.seatbelt, emerLt: D.times ? D.times.boardDone != null || !S.boarding : true, dome: (S.env?.nightK ?? 0) > 0.5, wipers: (S.atmo?.rain ?? 0) > 1 && fm.ias < 230,
      // pedestal
      rmpActive: FREQ_NAMES[unit] || '121.705', rmpStby: FREQ_NAMES[NEXT_UNIT[unit]] || '', rmpUnit: unit.toUpperCase(), flapLever: c.flapLever, speedbrake: c.speedbrake || 0, spoilersArmed: c.spoilersArmed, thr: c.thr,
      masters: c.engMaster, startFault: [false, false], engMode: c.engMode, ths: fm.ths, rudTrim: 0, squawk: atc?.squawk || '2000', xpdrMode: 'AUTO', wxrOn: !fm.onGround || fm.phase === 'lineup' || fm.phase === 'takeoff',
    };
  }

  // Waypoints along our route: the runway, the FMS's latitude/longitude waypoints (LL01...), the destination runway
  _waypoints(fm) {
    if (this._wp && this._wpRoute === fm.route) return this._wp;
    const out = [], path = fm.route.path;
    const add = (name, x, z) => { const s = path.locate({ x, y: z }); out.push({ name, x, z, s }); };
    const dep = fm.route.dep, arr = fm.route.arr;
    if (dep && !fm.airport) { const e = dep.end; add(`RW${dep.id}`, dep.thr.x + (e.x - dep.thr.x) * 0.9, dep.thr.y + (e.y - dep.thr.y) * 0.9); }
    if (!fm.airport) ROUTE_AIR.forEach(([lat, lon], i) => { const p = project(lat, lon); add(`LL${String(i + 1).padStart(2, '0')}`, p.x, p.z); });
    if (arr) add(`RW${arr.id}`, arr.thr.x, arr.thr.y);
    out.sort((a, b) => a.s - b.s);
    this._wp = out; this._wpRoute = fm.route;
    return out;
  }

  // Pages on the two MCDUs, chosen as the pilots would for the phase of flight
  _mcdu(S, wpts, eta) {
    const fm = S.fm, afs = fm.afs, crew = S.crew || {}, appr = crew.appr || {}, W = '#ffffff', B = '#29c5ff', G = '#35e05a', M = '#e94ce0', A = '#ffae00';
    const fl = (ft) => `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
    const ground = fm.onGround && !['rollout', 'taxi-in', 'arrived'].includes(fm.phase);
    const perfTO = { title: 'TAKE OFF', lines: [['V1', 'FLP RETR', W, true], [`${Math.round(afs.v1)}`, `F=${Math.round(afs.fSpeed?.() || 0)}`, B], ['VR', 'SLT RETR', W, true], [`${Math.round(afs.vr)}`, `S=${Math.round(afs.sSpeed?.() || 0)}`, B], ['V2', 'CLEAN', W, true], [`${Math.round(afs.v2)}`, `O=${Math.round(afs.greenDot?.() || 0)}`, B], ['TRANS ALT', 'FLAPS/THS', W, true], ['5000', '1/UP0.5', B], ['THR RED/ACC', 'ENG OUT ACC', W, true], [`${Math.round(afs.thrRedAgl / FT)}/${Math.round(afs.accAgl / FT)}`, `${Math.round(afs.accAgl / FT)}`, B]] };
    const fpln = { title: `SK1415  ${fm.airport === 'ARN' ? 'ESSA/ESSA' : 'ESSA/EKCH'}`, lines: [] };
    for (const w of wpts.slice(0, 5)) { const d = (w.s - fm.s) / 1852; fpln.lines.push([w.name, `${Math.round(d)}NM`, G]); fpln.lines.push([`  ${Math.round(afs.spdTarget || 250)}/${w.name.startsWith('RW') ? String(fm.airport === 'ARN' ? 137 : 17) : fl(afs.crzFt)}`, '', G, true]); }
    fpln.lines.push([`DEST ${fm.airport === 'ARN' ? 'ESSA' : 'EKCH'}${fm.route.arr ? fm.route.arr.id : ''}`, eta, W]);
    const dist = (fm.m.touchdown - fm.s) / 1852;
    const prog = { title: `${afs.phase || 'CRZ'}  ${fl(afs.crzFt)}`, lines: [['CRZ', 'OPT   REC MAX', W, true], [fl(afs.crzFt), 'FL370  FL390', M], ['', '', W], ['VDEV', 'BRG/DIST', W, true], [['descent', 'approach'].includes(fm.phase) ? `${Math.round(((fm.h - fm.descentProfile?.(fm.m.touchdown - fm.s)) || 0) / FT / 10) * 10}FT` : '----', `TO ${fm.airport === 'ARN' ? 'ESSA' : 'EKCH'}/${Math.round(dist)}`, G], ['', '', W], ['GPS PRIMARY', '', G]] };
    const q = Math.round(fm.airport === 'ARN' ? S.wx?.s.arn.qnh : S.wx?.s.cph.qnh) || 1013;
    const st = fm.airport === 'ARN' ? S.wx?.s.arn : S.wx?.s.cph;
    const perfAppr = { title: 'APPR', lines: [['QNH', 'FLP RETR', W, true], [`${q}`, `F=${Math.round(afs.fSpeed?.() || 0)}`, B], ['TEMP', 'SLT RETR', W, true], [`${Math.round(st?.temp ?? 15)}°`, `S=${Math.round(afs.sSpeed?.() || 0)}`, B], ['MAG WIND', 'CLEAN', W, true], [`${String(Math.round(st?.wdir ?? 0)).padStart(3, '0')}°/${Math.round(st?.wspd ?? 0)}`, `O=${Math.round(afs.greenDot?.() || 0)}`, B], ['VAPP', 'VLS', W, true], [`${Math.round(afs.vappFor?.() || 137)}`, `${Math.round(afs.vls?.(5) || 0)}`, G], [appr.cat === 'CAT I' ? 'BARO' : 'RADIO', 'LDG CONF', W, true], [appr.cat === 'CAT I' ? `${Math.round((appr.dh || 0) / FT + (fm.airport === 'ARN' ? 137 : 17))}` : appr.dh ? `${Math.round(appr.dh / FT)}` : 'NO', 'FULL', B]] };
    let capt, fo;
    if (ground) { capt = perfTO; fo = fpln; }
    else if (['descent', 'approach', 'flare'].includes(fm.phase)) { capt = perfAppr; fo = fpln; }
    else if (fm.phase === 'climb') { capt = prog; fo = fpln; }
    else { capt = fpln; fo = prog; }
    if (fm.engFail.some(Boolean)) capt = { title: 'ENG OUT', lines: [['', '', A], ['CHECK', 'EO CLR', A], ['MAX CONT', `${Math.round(fm.afs.greenDot?.() || 0)}KT`, B]] };
    return { mcduCapt: capt, mcduFo: fo };
  }

  // what the player can reach standing: from the cockpit door to behind the pilots' seats
  walkable(x, z) { return z > -3.95 && z < COCKPIT_DOOR_Z + 0.1 && Math.abs(x) < 0.34; }
}
