/**
 * The aeroplane you see: a Cessna 172P built from its real dimensions - fuselage, strut-braced high wing with slotted flaps and
 * ailerons, tailplane and elevator, swept fin and rudder, tricycle undercarriage, two-blade propeller, the cabin's frame, floor
 * and seats, and the lamps. Every moving part is a separate piece on its own hinge and is driven by the simulation's state:
 * what the control surfaces show is where the air loads and the pilot have actually put them.
 *
 * Coordinates are the simulation's structural ones (x right, y up from the ground, z aft of the firewall).
 */
import {
  Group, Mesh, SphereGeometry, CylinderGeometry, TorusGeometry, PointLight, SpotLight, Matrix4, RepeatWrapping,
} from '../../../medengine/src/index.js';
import { mat, paint, loft, ring, naca, panel, tube, box, Batch, hinge } from './build.js';

const DEG = Math.PI / 180;
const Z0 = -1.05, ZL = 7.7, Y0 = 0.5, YH = 1.4;           // the side-view window the fuselage paint is drawn in

function fuselagePaint(reg) {
  return paint(2048, 1024, (c, W, H) => {
    c.fillStyle = '#f4f3ee'; c.fillRect(0, 0, W, H);
    const stripeY = (z) => (z < 3 ? 1.10 : 1.10 + (z - 3) * 0.0667);
    for (const side of ['L', 'R']) {
      c.save();
      // metres (z along, y up) to pixels for this side of the aeroplane
      if (side === 'L') c.setTransform(W / ZL, 0, 0, 0.5 * H / YH, -Z0 * W / ZL, -Y0 * 0.5 * H / YH);
      else c.setTransform(W / ZL, 0, 0, -0.5 * H / YH, -Z0 * W / ZL, H + Y0 * 0.5 * H / YH);
      const band = (dy, hw, col) => {
        c.fillStyle = col; c.beginPath();
        for (let z = -1.0; z <= 6.7; z += 0.1) c.lineTo(z, stripeY(z) + dy + hw * Math.min(1, (z + 1.1) / 0.6));
        for (let z = 6.7; z >= -1.0; z -= 0.1) c.lineTo(z, stripeY(z) + dy - hw * Math.min(1, (z + 1.1) / 0.6));
        c.fill();
      };
      band(0, 0.055, '#17386b'); band(-0.10, 0.018, '#b8232c'); band(0.085, 0.012, '#17386b');
      // registration, upright and readable from outside on both sides
      c.translate(3.95, 1.385); c.scale(side === 'L' ? 1 : -1, side === 'L' ? -1 : 1);
      c.fillStyle = '#17386b'; c.font = 'bold 0.25px Arial, Helvetica, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(reg, 0, 0);
      c.restore();
    }
  }, { repeat: [1, 1] });
}

export function buildAirframe(cfg, { registration = 'SE-MED' } = {}) {
  const root = new Group(); root.name = 'aircraft';
  const B = new Batch();
  const white = mat({ color: 0xf4f3ee, roughness: 0.32, clearcoat: 0.6 });
  const skin = mat({ map: fuselagePaint(registration), roughness: 0.32, clearcoat: 0.6 });
  const blue = mat({ color: 0x17386b, roughness: 0.35, clearcoat: 0.5 });
  const rubber = mat({ color: 0x151515, roughness: 0.9 });
  const metal = mat({ color: 0xb9bcc0, roughness: 0.35, metalness: 0.9 });
  const dark = mat({ color: 0x1b1c1e, roughness: 0.85 });
  const liner = mat({ color: 0x8d8a82, roughness: 0.9 });
  const carpet = mat({ color: 0x3a3d44, roughness: 1, detail: 'fabric' });
  const seat = mat({ color: 0x5a3b2a, roughness: 0.8, detail: 'leather' });
  const fuv = (p) => { const h = Math.min(1, Math.max(0, (p[1] - Y0) / YH)) * 0.5; return [(p[2] - Z0) / ZL, p[0] >= 0 ? h : 1 - h]; };

  // ---- fuselage: cowl, cabin tub (open above the window sills), tail cone
  B.add(loft([ring(-1.03, 1.24, 0.20, 0.17, 0.19), ring(-0.98, 1.22, 0.40, 0.26, 0.31), ring(-0.80, 1.20, 0.47, 0.29, 0.38), ring(-0.40, 1.16, 0.51, 0.33, 0.44),
    ring(0, 1.10, 0.53, 0.35, 0.46), ring(0.30, 1.07, 0.545, 0.365, 0.46)], { capStart: true, uv: fuv }), skin);
  const tub = (inset) => [[0.30, 0.545, 0.79], [0.9, 0.57, 0.84], [1.8, 0.57, 0.84], [2.7, 0.50, 0.80]].map(([z, hw, hb]) => ring(z, 1.40, hw - inset, 0, hb - inset, 16, 5, -180, 0));
  B.add(loft(tub(0), { closed: false, uv: fuv }), skin);
  B.add(loft(tub(0.02), { closed: false, flip: true }), liner);
  B.add(loft([ring(2.7, 1.02, 0.50, 0.45, 0.42), ring(3.3, 1.22, 0.36, 0.40, 0.50), ring(4.5, 1.28, 0.22, 0.27, 0.36), ring(5.6, 1.34, 0.12, 0.18, 0.22),
    ring(6.6, 1.40, 0.04, 0.10, 0.10)], { capStart: true, capEnd: true, uv: fuv }), skin);
  // cowl details: cooling inlets, the spinner's back plate
  B.add(box(0.13, 0.09, 0.03, -0.11, 1.30, -1.035), dark).add(box(0.13, 0.09, 0.03, 0.11, 1.30, -1.035), dark).add(box(0.2, 0.07, 0.03, 0, 1.08, -1.03), dark);

  // ---- wing: NACA 2412, the forward 70 % as one box from tip to tip, then the fixed and moving trailing edges
  const W = (x) => {
    const ax = Math.abs(x), c = ax <= 2.65 ? 1.63 : 1.63 + (1.13 - 1.63) * (ax - 2.65) / 2.85;
    return { le: [x, 2.0 + ax * Math.tan(1.73 * DEG), 1.02 - 0.25 * c], chord: c, twist: (1.5 - 3 * ax / 5.5) * DEG };
  };
  const wx = [-5.5, -5.0, -2.65, -0.55, 0, 0.55, 2.65, 5.0, 5.5];
  B.add(panel(naca('2412', 0, 0.70), wx.map(W)), white);
  const te = naca('2412', 0.70, 1, 6);
  B.add(panel(te, [W(-0.55), W(0), W(0.55)]), white).add(panel(te, [W(-5.5), W(-5.0)]), white).add(panel(te, [W(5.0), W(5.5)]), white);
  B.add(panel(naca('0012', 0, 1, 8), [{ le: [-5.5, 2.166, 0.74], chord: 1.13 }, { le: [-5.58, 2.17, 0.86], chord: 0.8 }]), blue);
  B.add(panel(naca('0012', 0, 1, 8), [{ le: [5.5, 2.166, 0.74], chord: 1.13 }, { le: [5.58, 2.17, 0.86], chord: 0.8 }]), blue);
  const hingeAt = (s, f, dy = 0) => [s.le[0], s.le[1] - (f * s.chord) * Math.sin(s.twist) + dy, s.le[2] + f * s.chord * Math.cos(s.twist)];
  const surface = (a, b, geometry, f, dy, material = white) => {
    const m = new Mesh(geometry, material); m.castShadow = true; m.receiveShadow = true;
    const A = hingeAt(W(a), f, dy), Bp = hingeAt(W(b), f, dy);
    return hinge(root, m, A, [Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]]);
  };
  const flapL = surface(-2.65, -0.55, panel(te, [W(-2.65), W(-0.55)]), 0.72, -0.03), flapR = surface(0.55, 2.65, panel(te, [W(0.55), W(2.65)]), 0.72, -0.03);
  const ailL = surface(-5.0, -2.65, panel(te, [W(-5.0), W(-2.65)]), 0.72, 0), ailR = surface(2.65, 5.0, panel(te, [W(2.65), W(5.0)]), 0.72, 0);
  const flapHome = [flapL.pivot.position.clone(), flapR.pivot.position.clone()];
  // struts
  for (const s of [-1, 1]) B.add(tube([s * 0.56, 0.74, 1.05], [s * 2.55, 1.96, 1.08], 0.05, { flat: 0.35 }), white);

  // ---- tailplane and elevator, fin and rudder
  const HT = (x) => { const c = 1.14 + (0.80 - 1.14) * Math.abs(x) / 1.725; return { le: [x, 1.50, 5.80 - 0.25 * c], chord: c, twist: -2.2 * DEG }; };
  B.add(panel(naca('0009', 0, 0.6, 10), [HT(-1.725), HT(0), HT(1.725)]), white);
  const elevSec = naca('0009', 0.6, 1, 5);
  const elev = [[-1.725, -0.06], [0.06, 1.725]].map(([a, b]) => {
    const m = new Mesh(panel(elevSec, [HT(a), HT(b)]), white); m.castShadow = true;
    const A = [a, 1.50, HT(a).le[2] + 0.6 * HT(a).chord], Bp = [b, 1.50, HT(b).le[2] + 0.6 * HT(b).chord];
    return hinge(root, m, A, [Bp[0] - A[0], 0, Bp[2] - A[2]]);
  });
  const FN = (y) => { const t = (y - 1.35) / 1.37, c = 1.65 + (0.80 - 1.65) * t; return { le: [0, y, 5.55 + 0.80 * t - 0.25 * c], chord: c }; };
  B.add(panel(naca('0009', 0, 0.6, 10), [FN(1.35), FN(2.72)], { vertical: true }), white);
  const rud = new Mesh(panel(naca('0009', 0.6, 1, 5), [FN(1.30), FN(2.72)], { vertical: true }), white); rud.castShadow = true;
  const rA = [0, 1.30, FN(1.30).le[2] + 0.6 * FN(1.30).chord], rB = [0, 2.72, FN(2.72).le[2] + 0.6 * FN(2.72).chord];
  const rudder = hinge(root, rud, rA, [0, rB[1] - rA[1], rB[2] - rA[2]]);

  // ---- undercarriage
  const wheel = (r, w) => {
    const g = new Group(), b = new Batch();
    b.add(new TorusGeometry(r - w / 2, w / 2, 10, 24).rotateY(Math.PI / 2), rubber);
    b.add(new CylinderGeometry(r - w * 0.8, r - w * 0.8, w * 0.7, 16).rotateZ(Math.PI / 2), metal);
    b.build(g);
    return g;
  };
  const gearW = cfg.gear.wheels;
  for (const s of [-1, 1]) B.add(tube([s * 0.50, 0.70, 1.45], [s * 1.20, 0.25, 1.48], 0.045, { r2: 0.07, flat: 0.45 }), white);
  B.add(tube([0, 0.78, -0.30], [0, 0.42, -0.19], 0.028), metal);
  const mainL = wheel(0.22, 0.15), mainR = wheel(0.22, 0.15), noseLeg = new Group(), noseWheel = wheel(0.18, 0.12);
  { const b = new Batch(); b.add(tube([0, 0.34, 0], [0, 0.10, 0], 0.022), metal).add(box(0.02, 0.22, 0.05, -0.075, 0, 0.0), white).add(box(0.02, 0.22, 0.05, 0.075, 0, 0.0), white).add(box(0.17, 0.02, 0.05, 0, 0.11, 0), white); b.build(noseLeg); }
  noseLeg.add(noseWheel); noseLeg.position.set(0, 0.10, -0.17);
  root.add(mainL, mainR, noseLeg);

  // ---- propeller
  const prop = new Group(); prop.position.set(cfg.prop.hub.x, cfg.prop.hub.y, cfg.prop.hub.z);
  const blades = new Group(), R = cfg.prop.diameter / 2;
  {
    const sec = naca('4410', 0, 1, 7), rings = [], b = new Batch();
    for (const [f, c] of [[0.14, 0.09], [0.25, 0.13], [0.45, 0.16], [0.7, 0.15], [0.9, 0.11], [1.0, 0.05]]) {
      const r = f * R, be = Math.atan(cfg.prop.pitch / (2 * Math.PI * Math.max(r, 0.12))), cb = Math.cos(be), sb = Math.sin(be);
      rings.push(sec.map(([px, py]) => [-(px - 0.35) * c * cb - py * c * sb, r, (px - 0.35) * c * sb - py * c * cb]));
    }
    const blade = loft(rings, { capEnd: true });
    b.add(blade.clone(), mat({ color: 0x1a1a1c, roughness: 0.5 })).add(blade.clone().rotateZ(Math.PI), mat({ color: 0x1b1b1d, roughness: 0.5 }));
    b.build(blades);
    const sp = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, rr = 0.165 * Math.sqrt(1 - (1 - t) ** 2.2); sp.push(ring(-0.30 + 0.33 * t, 0, rr + 0.002, rr + 0.002, rr + 0.002, 16, 2)); }
    const spinner = new Mesh(loft(sp), white); spinner.castShadow = true;
    prop.add(blades, spinner);
  }
  root.add(prop);

  // ---- the cabin: floor, firewall, frame, seats, pedals
  B.add(box(1.08, 0.03, 2.7, 0, 0.615, 1.36), carpet).add(box(1.06, 0.84, 0.02, 0, 1.04, 0.03), dark);
  for (const s of [-1, 1]) {
    B.add(tube([s * 0.54, 1.42, 0.31], [s * 0.50, 2.0, 0.86], 0.026), white).add(tube([s * 0.57, 1.40, 1.82], [s * 0.56, 1.95, 1.82], 0.03), white);
    B.add(tube([s * 0.50, 1.41, 2.68], [s * 0.47, 1.97, 2.28], 0.026), white).add(tube([s * 0.47, 1.97, 2.28], [s * 0.30, 1.60, 3.27], 0.022), white);
  }
  B.add(tube([-0.47, 1.985, 2.26], [0.47, 1.985, 2.26], 0.022), white).add(tube([-0.31, 1.61, 3.27], [0.31, 1.61, 3.27], 0.02), white);
  B.add(box(1.0, 0.03, 0.62, 0, 1.44, 3.0, -0.12), liner);                                      // the baggage shelf under the rear window
  const chair = (x, z, w) => { B.add(box(w, 0.13, 0.46, x, 0.855, z), seat).add(box(w, 0.62, 0.10, x, 1.20, z + 0.27, 0.2), seat).add(box(w * 0.8, 0.2, 0.3, x, 0.71, z), dark); };
  chair(-0.27, 1.02, 0.44); chair(0.27, 1.02, 0.44); chair(0, 1.95, 1.0);
  const pedals = [];
  for (const x of [-0.34, -0.16, 0.16, 0.34]) { const p = new Mesh(box(0.08, 0.12, 0.02, 0, 0.06, 0, -0.5), metal); p.position.set(x, 0.74, 0.20); root.add(p); pedals.push(p); }
  B.build(root);

  // ---- lamps: each is a small glowing lens, and the bright ones also light the ground
  const lens = (color, p, r = 0.03) => { const m = new Mesh(new SphereGeometry(r, 10, 8), mat({ color: 0x222222, emissive: color, emissiveIntensity: 0, roughness: 0.3 })); m.position.set(...p); root.add(m); return m; };
  const lamps = {
    navL: lens(0xff2010, [-5.56, 2.17, 0.95]), navR: lens(0x10ff40, [5.56, 2.17, 0.95]), navT: lens(0xffffff, [0, 1.48, 7.12], 0.025),
    beacon: lens(0xff1808, [0, 2.76, 6.55], 0.045), strobeL: lens(0xffffff, [-5.57, 2.17, 1.05], 0.03), strobeR: lens(0xffffff, [5.57, 2.17, 1.05], 0.03),
    land: lens(0xfff4dd, [-0.07, 0.98, -1.0], 0.05), taxi: lens(0xfff4dd, [0.07, 0.98, -1.0], 0.05),
  };
  const spot = (p, pitch, angle, dist) => { const l = new SpotLight(0xfff1dc, 0, dist, angle, 0.5); l.position.set(...p); l.target.position.set(p[0], p[1] - Math.tan(pitch) * 10, p[2] - 10); root.add(l, l.target); return l; };
  const lights = { land: spot([-0.07, 0.98, -1.05], 4 * DEG, 0.20, 260), taxi: spot([0.07, 0.98, -1.05], 9 * DEG, 0.45, 70),
    beacon: new PointLight(0xff2010, 0, 18), strobe: new PointLight(0xffffff, 0, 30), dome: new PointLight(0xffe6c0, 0, 2.2), panel: new PointLight(0xffd9a0, 0, 1.4) };
  lights.beacon.position.set(0, 2.9, 6.5); lights.strobe.position.set(0, 2.4, 1.0); lights.dome.position.set(0, 1.86, 1.25); lights.panel.position.set(-0.1, 1.47, 0.62);
  root.add(lights.beacon, lights.strobe, lights.dome, lights.panel);

  // ---- things you take off before flight: pitot cover, chocks, tie-down ropes
  const pre = { cover: new Group(), chocks: new Group(), ropes: new Group() };
  {
    const b = new Batch();
    b.add(tube([-2.95, 1.93, 0.72], [-2.95, 1.86, 0.72], 0.012), metal).add(tube([-2.95, 1.86, 0.74], [-2.95, 1.86, 0.52], 0.011), metal);
    b.build(root);
    const red = mat({ color: 0xd0201c, roughness: 0.7 }), yel = mat({ color: 0xe0b020, roughness: 0.8 }), rope = mat({ color: 0xc8b890, roughness: 1 });
    const c = new Batch(); c.add(tube([-2.95, 1.86, 0.62], [-2.95, 1.86, 0.49], 0.019), red).add(box(0.005, 0.30, 0.05, -2.95, 1.70, 0.5), red); c.build(pre.cover);
    const k = new Batch();
    for (const s of [-1, 1]) for (const dz of [-0.27, 0.27]) k.add(box(0.26, 0.09, 0.10, s * 1.265, 0.045, 1.48 + dz, dz > 0 ? 0.5 : -0.5), yel);
    k.build(pre.chocks);
    const t = new Batch(); for (const p of cfg.gear.tie) t.add(tube([p.x, p.y, p.z], [p.x * 1.02, 0.01, p.z + 0.1], 0.008, { seg: 5 }), rope); t.build(pre.ropes);
    root.add(pre.cover, pre.chocks, pre.ropes);
  }

  const tr = cfg.travel;
  let strobeT = 0;
  /** Bring every moving part into line with the simulation. `night` 0..1 scales how much the lamps matter. */
  function update(ac, dt) {
    const s = ac.surf, e = ac.elec, L = ac.ctl.lights, g = ac.gear.wheels;
    ailL.set(s.ailL); ailR.set(s.ailR);
    for (const [i, f] of [flapL, flapR].entries()) {             // the flaps run back on their tracks as they come down
      f.set(s.flap * 1.05);
      f.pivot.position.copy(flapHome[i]); f.pivot.position.z += 0.20 * Math.sin(s.flap); f.pivot.position.y -= 0.05 * Math.sin(s.flap);
    }
    elev[0].set(s.elev); elev[1].set(s.elev); rudder.set(s.rudder);
    for (const [i, p] of pedals.entries()) p.position.z = 0.20 + (i % 2 ? -1 : 1) * 0.07 * (s.rudder / tr.rudder);
    mainL.position.set(-1.265, 0.16 + g[1].comp, 1.48); mainR.position.set(1.265, 0.16 + g[2].comp, 1.48);
    mainL.rotation.x = -g[1].spin; mainR.rotation.x = -g[2].spin;
    noseLeg.position.y = 0.10 + g[0].comp; noseLeg.rotation.y = -g[0].steer; noseWheel.rotation.x = -g[0].spin;
    for (const [i, w] of [noseLeg, mainL, mainR].entries()) w.visible = !g[i].collapsed;
    const rpm = Math.abs(ac.eng.rpm);
    prop.rotation.z = -ac.prop.angle;
    blades.visible = rpm < 700 || Math.floor(ac.time * 60) % 3 === 0;       // at speed the eye only catches it now and then
    // lamps
    const t = ac.time, on = (sw, br) => (sw && e.has(br) ? Math.min(1.2, e.volts / 26) ** 3 : 0);
    const nav = on(L.nav, 'NAV_LT'), bcn = on(L.beacon, 'BCN_PITOT') * (t % 1.25 < 0.14 ? 1 : 0);
    strobeT = (strobeT + dt) % 1.1;
    const stb = on(L.strobe, 'STROBE') * (strobeT < 0.03 || (strobeT > 0.12 && strobeT < 0.15) ? 1 : 0);
    const land = on(L.land, 'LDG_LT'), taxi = on(L.taxi, 'LDG_LT');
    lamps.navL.material.emissiveIntensity = lamps.navR.material.emissiveIntensity = nav * 14; lamps.navT.material.emissiveIntensity = nav * 9;
    lamps.beacon.material.emissiveIntensity = bcn * 60; lamps.strobeL.material.emissiveIntensity = lamps.strobeR.material.emissiveIntensity = stb * 400;
    lamps.land.material.emissiveIntensity = land * 220; lamps.taxi.material.emissiveIntensity = taxi * 90;
    lights.land.intensity = land * 9000; lights.taxi.intensity = taxi * 1200; lights.beacon.intensity = bcn * 60; lights.strobe.intensity = stb * 700;
    lights.dome.intensity = on(L.dome, 'NAV_LT') * 1.6; lights.panel.intensity = on(ac.ctl.panelLights > 0.02, 'INST_LTS') * ac.ctl.panelLights * 0.5;
    pre.cover.visible = ac.inst.pitotCover; pre.chocks.visible = ac.gear.chocks; pre.ropes.visible = ac.gear.tiedown;
  }
  return { root, update, lights, lamps };
}
export { RepeatWrapping, Matrix4 };
