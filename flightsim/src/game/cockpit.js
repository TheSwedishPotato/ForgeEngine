/**
 * The cockpit: the instrument panel with working needles, gyro ball, compass and radio displays, and every control as a part
 * you operate with the mouse. Nothing here decides anything: a switch sets a value in the simulation, and the needles show what
 * the simulation's instruments read (errors and all).
 *
 * A control is { id, label, pos, r, kind, ... }:
 *   toggle  click to flip                      step   click / right-click / wheel to move one position
 *   axis    drag or wheel, a continuous lever   turn   drag or wheel, a knob that keeps turning
 *   custom  its own press / release
 */
import { Group, Mesh, PlaneGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, Quaternion, Vector3 } from '../../../medengine/src/index.js';
import { mat, paint, Batch, box, tube, disc } from './build.js';
import { PANEL, DIALS, STRIPS, STRIP_R, dialAngle, paintPanel, paintHorizon, paintRose, paintCompassBand, KEY_POS } from './panelart.js';
import { BREAKERS } from '../sim/electrical.js';

const D = Math.PI / 180, PZ = PANEL.z;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const SEL = ['OFF', 'LEFT', 'BOTH', 'RIGHT'], XPDR = ['OFF', 'STANDBY', 'ON', 'ALT', 'TEST'];
const pct = (v) => `${Math.round(v * 100)} %`, onOff = (v) => (v ? 'ON' : 'OFF');

export function buildCockpit(ac, root, fx = () => {}, { registration = 'SE-MED' } = {}) {
  const g = new Group(); g.name = 'cockpit'; root.add(g);
  const S = new Batch(), lit = [], controls = [], anims = [];
  const c = ac.ctl, e = ac.elec, eng = ac.eng, inst = ac.inst, rad = ac.radios;
  const black = mat({ color: 0x141416, roughness: 0.55 }), grey = mat({ color: 0x3b3d40, roughness: 0.6 }), chrome = mat({ color: 0xc8cace, roughness: 0.25, metalness: 0.9 });
  const glow = (color) => { const m = mat({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0 }); lit.push([m, 0.6]); return m; };
  const white = glow(0xf2f2ee), orange = glow(0xf08020), redM = mat({ color: 0xc0201c, roughness: 0.5 });
  const part = (geometry, material, x = 0, y = 0, z = 0, parent = g) => { const m = new Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m; };
  const add = (o) => { controls.push(o); return o; };
  const click = () => fx('click');

  // ---- the board itself, glareshield, pedestal
  const tex = paintPanel({ registration });
  const boardM = mat({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, roughness: 0.75 }); lit.push([boardM, 0.35]);
  part(new PlaneGeometry(1.06, 0.44), boardM, 0, 1.20, PZ);
  S.add(box(1.10, 0.025, 0.24, 0, 1.445, PZ - 0.065), black).add(box(1.10, 0.012, 0.045, 0, 1.432, PZ + 0.04, 0.45), black);
  S.add(box(0.20, 0.37, 0.20, 0, 0.80, PZ + 0.09), black).add(box(0.16, 0.05, 0.16, 0, 0.645, 0.80), black);

  // ---- needles
  const needle = (x, y, len, w, m = white, tail = 0.2, z = 0.004) => {
    const p = new Group(); p.position.set(x, y, PZ + z); g.add(p);
    part(box(w, len * (1 + tail), 0.0012, 0, len * (1 - tail) / 2, 0), m, 0, 0, 0, p);
    return p;
  };
  const N = {};
  for (const k of ['asi', 'vsi', 'tach', 'egt', 'suction', 'amps']) { const d = DIALS[k]; N[k] = needle(d.x, d.y, d.r * 0.82, d.r * 0.07); part(new CylinderGeometry(d.r * 0.09, d.r * 0.09, 0.004, 12).rotateX(Math.PI / 2), black, d.x, d.y, PZ + 0.006); }
  const A = DIALS.alt, K = DIALS.clock;
  N.alt100 = needle(A.x, A.y, A.r * 0.84, 0.0022); N.alt1k = needle(A.x, A.y, A.r * 0.52, 0.0048, white, 0.1, 0.006); N.alt10k = needle(A.x, A.y, A.r * 0.90, 0.0010, white, 0, 0.008);
  N.hour = needle(K.x, K.y, K.r * 0.5, 0.003); N.min = needle(K.x, K.y, K.r * 0.8, 0.002, white, 0.15, 0.006); N.sec = needle(K.x, K.y, K.r * 0.8, 0.0008, orange, 0.25, 0.008);
  for (const k in STRIPS) { const s = STRIPS[k]; N[k] = needle(s.x, s.y - 0.022, STRIP_R * 0.95, 0.0012, white, 0); }
  const setN = (n, scale, v) => { n.rotation.z = -dialAngle(scale, v) * D; };

  // ---- attitude indicator: a real ball behind the bezel
  const AI = { x: -0.255, y: 1.335 };
  const ballM = mat({ map: paintHorizon(), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 }); ballM.emissiveMap = ballM.map; lit.push([ballM, 0.3]);
  const aiBall = part(new SphereGeometry(0.062, 40, 24), ballM, AI.x, AI.y, PZ + 0.002 - 0.0482);
  const bezel = (x, y, r = 0.041) => S.add(new TorusGeometry(r + 0.0015, 0.0042, 8, 40).translate(x, y, PZ + 0.012), black);
  bezel(AI.x, AI.y);
  const aiPlane = new Group(); aiPlane.position.set(AI.x, AI.y, PZ + 0.019); g.add(aiPlane);
  for (const s of [-1, 1]) part(box(0.016, 0.0024, 0.0015, s * 0.018, 0, 0), orange, 0, 0, 0, aiPlane);
  part(new SphereGeometry(0.0022, 8, 6), orange, 0, 0, 0, aiPlane);
  const aiBank = new Group(); aiBank.position.set(AI.x, AI.y, PZ + 0.017); g.add(aiBank);
  part(box(0.004, 0.006, 0.001, 0, 0.0325, 0), orange, 0, 0, 0, aiBank);
  const qa = new Quaternion(), qb = new Quaternion(), AX = new Vector3(1, 0, 0), AZ = new Vector3(0, 0, 1);

  // ---- turn coordinator
  const TC = { x: -0.365, y: 1.225 };
  const tcPlane = new Group(); tcPlane.position.set(TC.x, TC.y + 0.006, PZ + 0.005); g.add(tcPlane);
  part(box(0.052, 0.003, 0.0012), white, 0, 0, 0, tcPlane); part(box(0.003, 0.010, 0.0012, 0, 0.005, 0), white, 0, 0, 0, tcPlane); part(new SphereGeometry(0.004, 10, 8), white, 0, 0, 0, tcPlane);
  const tcBall = part(new SphereGeometry(0.0038, 12, 8), black, TC.x, TC.y - 0.0218, PZ + 0.004);
  const tcFlag = part(box(0.008, 0.005, 0.001), redM, TC.x + 0.022, TC.y + 0.018, PZ + 0.004);

  // ---- heading indicator and course deviation indicator
  const rose = paintRose(512), roseM = mat({ map: rose, roughness: 0.6, emissive: 0xffffff, emissiveMap: rose, emissiveIntensity: 0 }); lit.push([roseM, 0.35]);
  const DG = { x: -0.255, y: 1.225 }, CD = { x: -0.035, y: 1.335 };
  const dgCard = part(disc(0.039, 48), roseM, DG.x, DG.y, PZ + 0.003);
  bezel(DG.x, DG.y); bezel(TC.x, TC.y); bezel(CD.x, CD.y);
  for (const k of ['asi', 'alt', 'vsi', 'tach']) bezel(DIALS[k].x, DIALS[k].y);
  part(box(0.0015, 0.026, 0.001), orange, DG.x, DG.y, PZ + 0.006); part(box(0.016, 0.0015, 0.001), orange, DG.x, DG.y + 0.003, PZ + 0.006); part(box(0.007, 0.0015, 0.001), orange, DG.x, DG.y - 0.009, PZ + 0.006);
  part(box(0.003, 0.006, 0.001), white, DG.x, DG.y + 0.037, PZ + 0.007);
  const dgBug = new Group(); dgBug.position.set(DG.x, DG.y, PZ + 0.0055); g.add(dgBug); part(box(0.007, 0.004, 0.001, 0, 0.037, 0), orange, 0, 0, 0, dgBug);
  const obsCard = part(disc(0.039, 48), roseM, CD.x, CD.y, PZ + 0.003);
  const cdiFace = paint(256, 256, (x, W) => {
    x.fillStyle = '#0b0b0c'; x.beginPath(); x.arc(W / 2, W / 2, W / 2, 0, 7); x.fill(); x.fillStyle = '#f0f0ec'; x.strokeStyle = '#f0f0ec';
    for (let i = -5; i <= 5; i++) { if (!i) continue; x.beginPath(); x.arc(W / 2 + i * 20, W / 2, 3.5, 0, 7); x.fill(); x.beginPath(); x.arc(W / 2, W / 2 + i * 20, 3.5, 0, 7); x.fill(); }
    x.lineWidth = 3; x.beginPath(); x.arc(W / 2, W / 2, 11, 0, 7); x.stroke(); x.font = 'bold 15px Arial'; x.textAlign = 'center'; x.fillText('NAV', W * 0.74, W * 0.24); x.fillText('GS', W * 0.2, W * 0.3);
  });
  const faceM = mat({ map: cdiFace, roughness: 0.6, emissive: 0xffffff, emissiveMap: cdiFace, emissiveIntensity: 0 }); lit.push([faceM, 0.35]);
  part(disc(0.0285, 40), faceM, CD.x, CD.y, PZ + 0.0045);
  part(box(0.004, 0.006, 0.001), orange, CD.x, CD.y + 0.0315, PZ + 0.006);
  const locBar = part(box(0.0013, 0.046, 0.001), white, CD.x, CD.y, PZ + 0.007), gsBar = part(box(0.046, 0.0013, 0.001), white, CD.x, CD.y, PZ + 0.0065);
  const navFlag = part(box(0.008, 0.004, 0.001), redM, CD.x + 0.014, CD.y + 0.017, PZ + 0.0075), gsFlag = part(box(0.004, 0.008, 0.001), redM, CD.x - 0.019, CD.y + 0.008, PZ + 0.0075);

  // ---- small windows of changing text: radio displays, altimeter setting, hour meters, TO/FROM
  const display = (x, y, w, h, pw, ph, draw, level = 2.2) => {
    const t = paint(pw, ph, () => {}, { mips: false, aniso: 2 });
    const m = mat({ map: t, roughness: 0.4, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: level });
    part(new PlaneGeometry(w, h), m, x, y, PZ + 0.0025);
    let last = null;
    return (key, ...a) => { if (key === last) return; last = key; t.ctx.fillStyle = '#050505'; t.ctx.fillRect(0, 0, pw, ph); draw(t.ctx, pw, ph, ...a); t.needsUpdate = true; };
  };
  const seg = (x, s, px, py, size, color = '#ff7a28') => { x.fillStyle = color; x.font = `bold ${size}px "Courier New", monospace`; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(s, px, py); };
  const navcom = display(0.165, 1.360, 0.166, 0.022, 512, 68, (x, W, H, on, a) => { if (!on) return; seg(x, a.com.active.toFixed(2), 4, H / 2, 34); seg(x, a.com.standby.toFixed(2), 134, H / 2, 26, '#c85e20'); seg(x, a.nav.active.toFixed(2), 262, H / 2, 34); seg(x, a.nav.standby.toFixed(2), 392, H / 2, 26, '#c85e20'); });
  const xpdrD = display(0.180, 1.290, 0.085, 0.016, 256, 48, (x, W, H, on, xp) => { if (!on) return; seg(x, xp.code.join(''), 70, H / 2, 38); seg(x, XPDR[xp.mode].slice(0, 3), 190, H / 2, 20, '#c85e20'); if (xp.reply) { x.fillStyle = '#ffb040'; x.beginPath(); x.arc(30, H / 2, 10, 0, 7); x.fill(); } });
  const koll = display(A.x + 0.0235, A.y, 0.017, 0.0085, 96, 48, (x, W, H, s) => seg(x, s, 4, H / 2, 34, '#f0f0ec'), 0);
  const tachH = display(DIALS.tach.x, DIALS.tach.y - 0.020, 0.022, 0.007, 128, 40, (x, W, H, s) => seg(x, s, 6, H / 2, 30, '#f0f0ec'), 0);
  const hobbs = display(-0.035, 1.122, 0.040, 0.011, 160, 44, (x, W, H, s) => seg(x, s, 8, H / 2, 32, '#f0f0ec'), 0);
  const toFrom = display(CD.x + 0.0125, CD.y - 0.011, 0.012, 0.007, 64, 36, (x, W, H, s) => seg(x, s, 6, H / 2, 26, s === 'OFF' ? '#ff4030' : '#f0f0ec'), 0);
  const lowVolt = part(new SphereGeometry(0.005, 10, 8), mat({ color: 0x401010, emissive: 0xff2010, emissiveIntensity: 0 }), -0.425, 1.378, PZ + 0.003);

  // ---- magnetic compass on the glareshield
  const band = paintCompassBand(), bandM = mat({ map: band, roughness: 0.6, emissive: 0xffffff, emissiveMap: band, emissiveIntensity: 0 }); lit.push([bandM, 0.3]);
  const CP = [0.06, 1.492, PZ - 0.03];
  const compass = part(new CylinderGeometry(0.03, 0.03, 0.02, 40, 1, true), bandM, ...CP);
  S.add(box(0.082, 0.008, 0.075, CP[0], CP[1] + 0.017, CP[2]), black).add(box(0.082, 0.008, 0.075, CP[0], CP[1] - 0.017, CP[2]), black).add(box(0.006, 0.04, 0.075, CP[0] - 0.039, CP[1], CP[2]), black)
    .add(box(0.006, 0.04, 0.075, CP[0] + 0.039, CP[1], CP[2]), black).add(box(0.082, 0.04, 0.006, CP[0], CP[1], CP[2] - 0.036), black).add(box(0.0012, 0.026, 0.001, CP[0], CP[1], CP[2] + 0.0315), white);

  // ---- makers of controls ---------------------------------------------------------------------------------------------
  /** A rocker switch. */
  const rocker = (id, label, x, y, get, set, extra = {}) => {
    const p = new Group(); p.position.set(x, y, PZ + 0.004); g.add(p);
    part(box(0.013, 0.022, 0.010), extra.red ? redM : mat({ color: 0xe8e6de, roughness: 0.5 }), 0, 0, 0, p);
    anims.push(() => { p.rotation.x = get() ? -0.28 : 0.28; });
    return add({ id, label, pos: [x, y, PZ + 0.01], r: 0.013, kind: 'toggle', get, set: (v) => { set(v); click(); }, text: () => onOff(get()), ...extra });
  };
  /** A push-pull knob on a shaft. `out()` 0..1 is how far it stands out. */
  const plunger = (id, label, x, y, o) => {
    const knob = new Group(); g.add(knob);
    part(new CylinderGeometry(0.004, 0.004, 0.10, 8).rotateX(Math.PI / 2), chrome, 0, 0, -0.05, knob);
    part(o.square ? box(o.r * 2, o.r * 1.5, 0.014) : new CylinderGeometry(o.r, o.r * 0.85, 0.016, 20).rotateX(Math.PI / 2), mat({ color: o.color ?? 0x161618, roughness: 0.45 }), 0, 0, 0, knob);
    S.add(new CylinderGeometry(0.008, 0.008, 0.012, 12).rotateX(Math.PI / 2).translate(x, y, PZ + 0.006), chrome);
    const z = () => PZ + 0.024 + o.out() * (o.travel ?? 0.06);
    anims.push(() => knob.position.set(x, y, z()));
    return add({ id, label, pos: () => [x, y, z()], r: Math.max(o.r, 0.013), ...o });
  };
  /** A round knob that turns. `angle()` in degrees is where its mark points. */
  const knob = (id, label, x, y, r, o) => {
    const k = new Group(); k.position.set(x, y, PZ + (o.z ?? 0.008)); g.add(k);
    part(new CylinderGeometry(r, r * 1.08, 0.012, 16).rotateX(Math.PI / 2), o.material ?? black, 0, 0, 0, k);
    part(box(r * 0.22, r * 0.9, 0.002, 0, r * 0.5, 0.0065), white, 0, 0, 0, k);
    if (o.angle) anims.push(() => { k.rotation.z = -o.angle() * D; });
    return add({ id, label, pos: [x, y, PZ + 0.014], r: Math.max(r, 0.009), ...o });
  };

  // ---- electrical ------------------------------------------------------------------------------------------------------
  rocker('master_alt', 'Master switch: alternator', -0.447, 1.02, () => e.masterAlt, (v) => { e.masterAlt = v; if (v) e.masterBat = true; }, { red: true });
  rocker('master_bat', 'Master switch: battery', -0.423, 1.02, () => e.masterBat, (v) => { e.masterBat = v; if (!v) e.masterAlt = false; }, { red: true });
  // ignition: OFF, R, L, BOTH, and START which springs back
  {
    const k = new Group(); k.position.set(-0.375, 1.02, PZ + 0.006); g.add(k);
    part(new CylinderGeometry(0.011, 0.012, 0.012, 20).rotateX(Math.PI / 2), chrome, 0, 0, 0, k); part(box(0.004, 0.026, 0.022, 0, 0.002, 0.015), chrome, 0, 0, 0, k);
    anims.push(() => { k.rotation.z = -(-60 + 30 * c.magKey) * D; });
    add({ id: 'ignition', label: 'Ignition', pos: [-0.375, 1.02, PZ + 0.02], r: 0.018, kind: 'custom', text: () => `${KEY_POS[c.magKey]}  (hold at BOTH to crank)`,
      press(b) { if (b === 2) c.magKey = Math.max(0, Math.min(c.magKey, 3) - 1); else c.magKey = Math.min(4, c.magKey + 1); click(); },
      release() { if (c.magKey === 4) { c.magKey = 3; click(); } }, wheel(n) { c.magKey = clamp(Math.min(c.magKey, 3) + (n > 0 ? 1 : -1), 0, 3); click(); } });
  }
  // primer: unlock, pull to fill, push to spray
  let stroke = 0;
  plunger('primer', 'Primer', -0.497, 1.02, { r: 0.010, kind: 'custom', travel: 0.07, out: () => c.primer, text: () => (c.primerLocked ? 'IN and LOCKED  (click to unlock, then click for each stroke; right-click to lock)' : 'unlocked: click for a stroke'),
    press(b) { if (b === 2) { if (c.primer < 0.02) { c.primerLocked = true; click(); } } else if (c.primerLocked) { c.primerLocked = false; click(); } else if (stroke <= 0) { stroke = 0.9; fx('primer'); } } });
  knob('panel_lt', 'Panel lights', -0.315, 1.02, 0.008, { kind: 'axis', get: () => c.panelLights, set: (v) => { c.panelLights = v; }, angle: () => -135 + 270 * c.panelLights, text: () => pct(c.panelLights) });
  knob('radio_lt', 'Radio lights', -0.283, 1.02, 0.008, { kind: 'axis', get: () => c.radioLights, set: (v) => { c.radioLights = v; }, angle: () => -135 + 270 * c.radioLights, text: () => pct(c.radioLights) });
  const L = c.lights;
  [['pitot', 'Pitot heat', () => c.pitotHeat, (v) => { c.pitotHeat = v; }], ['nav', 'Navigation lights', () => L.nav, (v) => { L.nav = v; }], ['strobe', 'Strobe lights', () => L.strobe, (v) => { L.strobe = v; }],
    ['beacon', 'Beacon', () => L.beacon, (v) => { L.beacon = v; }], ['taxi', 'Taxi light', () => L.taxi, (v) => { L.taxi = v; }], ['land', 'Landing light', () => L.land, (v) => { L.land = v; }],
    ['dome', 'Dome light', () => L.dome, (v) => { L.dome = v; }], ['avionics', 'Avionics master', () => e.avionics, (v) => { e.avionics = v; }],
  ].forEach(([id, label, get, set], i) => rocker(id, label, i === 7 ? -0.002 : -0.215 + i * 0.03, 1.02, get, set));
  BREAKERS.forEach(([id, name, amps], i) => {
    const x = -0.215 + i * 0.0215, b = part(new CylinderGeometry(0.005, 0.005, 0.012, 10).rotateX(Math.PI / 2), black, x, 1.087, PZ + 0.004);
    part(new CylinderGeometry(0.0052, 0.0052, 0.003, 10).rotateX(Math.PI / 2), white, 0, 0, -0.004, b);
    anims.push(() => { b.position.z = PZ + (e.breaker[id] ? 0.004 : 0.011); });
    add({ id: `cb_${id}`, label: `Circuit breaker: ${name} (${amps} A)`, pos: [x, 1.087, PZ + 0.01], r: 0.0095, kind: 'toggle', get: () => e.breaker[id], set: (v) => { e.breaker[id] = v; click(); }, text: () => (e.breaker[id] ? 'IN' : 'PULLED') });
  });

  // ---- engine controls -------------------------------------------------------------------------------------------------
  plunger('alt_static', 'Alternate static source', 0.035, 1.02, { r: 0.008, kind: 'toggle', travel: 0.025, out: () => (inst.altStatic ? 1 : 0), get: () => inst.altStatic, set: (v) => { inst.altStatic = v; click(); }, text: () => (inst.altStatic ? 'PULLED: cabin air' : 'IN: normal static port') });
  plunger('carb_heat', 'Carburettor heat', 0.078, 1.03, { r: 0.013, square: true, kind: 'axis', out: () => eng.carbHeat, get: () => eng.carbHeat, set: (v) => { eng.carbHeat = v; }, sens: -0.006, step: -0.25,
    text: () => `${eng.carbHeat > 0.5 ? 'HOT' : 'COLD'} ${pct(eng.carbHeat)}  carburettor ${eng.carbT.toFixed(0)} °C` });
  plunger('throttle', 'Throttle', 0.145, 1.03, { r: 0.021, kind: 'axis', travel: 0.075, out: () => 1 - eng.throttle, get: () => eng.throttle, set: (v) => { eng.throttle = v; }, step: 0.02, sens: 0.004, text: () => pct(eng.throttle) });
  plunger('mixture', 'Mixture', 0.215, 1.03, { r: 0.017, color: 0xb81c18, kind: 'axis', travel: 0.075, out: () => 1 - eng.mixture, get: () => eng.mixture, set: (v) => { eng.mixture = v; }, step: 0.01, sens: 0.004,
    text: () => (eng.mixture < 0.04 ? 'IDLE CUT-OFF' : `${pct(eng.mixture)} rich`) });
  plunger('cabin_heat', 'Cabin heat', 0.375, 1.02, { r: 0.009, kind: 'axis', travel: 0.04, out: () => c.cabinHeat, get: () => c.cabinHeat, set: (v) => { c.cabinHeat = v; }, sens: -0.006, step: -0.1, text: () => `${pct(c.cabinHeat)}  cabin ${ac.cabinT.toFixed(0)} °C` });
  plunger('cabin_air', 'Cabin air', 0.425, 1.02, { r: 0.009, kind: 'axis', travel: 0.04, out: () => c.cabinAir, get: () => c.cabinAir, set: (v) => { c.cabinAir = v; }, sens: -0.006, step: -0.1, text: () => `${pct(c.cabinAir)}  cabin ${ac.cabinT.toFixed(0)} °C` });
  // parking brake handle, under the panel
  {
    const h = part(box(0.05, 0.012, 0.012), black, -0.40, 0.966, PZ + 0.03); S.add(tube([-0.40, 0.966, PZ - 0.02], [-0.40, 0.966, PZ + 0.03], 0.004), chrome);
    anims.push(() => { h.position.z = PZ + (c.parkBrake ? 0.075 : 0.03); });
    add({ id: 'park_brake', label: 'Parking brake', pos: () => [-0.40, 0.966, h.position.z], r: 0.03, kind: 'toggle', get: () => c.parkBrake, set: (v) => { c.parkBrake = v; click(); }, text: () => (c.parkBrake ? 'SET' : 'released') });
  }
  // flaps: the lever, and the indicator that follows the flaps themselves
  {
    const lever = part(box(0.022, 0.008, 0.02), mat({ color: 0xe8e6de, roughness: 0.5 }), 0.298, 1.07, PZ + 0.012), ind = part(box(0.008, 0.002, 0.002), white, 0.312, 1.07, PZ + 0.003);
    anims.push(() => { lever.position.y = 1.070 - c.flapLever * 0.0167; ind.position.y = 1.070 - ac.flapDeg / 30 * 0.050; });
    add({ id: 'flaps', label: 'Wing flaps', pos: () => [0.298, lever.position.y, PZ + 0.02], r: 0.02, kind: 'step', min: 0, max: 3, get: () => c.flapLever, set: (v) => { c.flapLever = v; click(); }, invertWheel: true,
      text: () => `lever ${['UP', '10°', '20°', '30°'][c.flapLever]}, flaps at ${ac.flapDeg.toFixed(0)}°` });
  }
  // elevator trim wheel on the pedestal, and its pointer
  {
    const w = new Group(); w.position.set(-0.07, 0.86, PZ + 0.165); g.add(w);
    part(new CylinderGeometry(0.075, 0.075, 0.018, 28).rotateZ(Math.PI / 2), black, 0, 0, 0, w);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; part(box(0.02, 0.006, 0.008), grey, 0, 0.076 * Math.cos(a), 0.076 * Math.sin(a), w).rotation.x = a; }
    const ptr = part(box(0.01, 0.003, 0.004), white, -0.045, 0.86, PZ + 0.195);
    S.add(box(0.012, 0.11, 0.004, -0.045, 0.86, PZ + 0.191), grey);
    anims.push(() => { w.rotation.x = c.trim * 6; ptr.position.y = 0.86 - c.trim * 0.045; });
    add({ id: 'trim', label: 'Elevator trim', pos: [-0.07, 0.90, PZ + 0.225], r: 0.05, kind: 'axis', min: -1, max: 1, get: () => c.trim, set: (v) => { c.trim = v; }, sens: -0.0025, step: -0.01,
      text: () => (Math.abs(c.trim) < 0.03 ? 'TAKE-OFF' : `${Math.abs(c.trim * 100).toFixed(0)} % nose ${c.trim > 0 ? 'UP' : 'DOWN'}`) });
  }
  // fuel selector on the floor
  {
    const h = new Group(); h.position.set(0, 0.675, 0.80); g.add(h);
    part(new CylinderGeometry(0.03, 0.035, 0.012, 20), chrome, 0, 0, 0, h); part(box(0.022, 0.014, 0.085, 0, 0.012, -0.022), redM, 0, 0, 0, h);
    const ang = [180, 90, 0, -90];
    anims.push(() => { h.rotation.y = ang[ac.fuel.selector] * D; });
    add({ id: 'fuel_sel', label: 'Fuel selector', pos: [0, 0.70, 0.80], r: 0.06, kind: 'step', min: 0, max: 3, get: () => ac.fuel.selector, set: (v) => { ac.fuel.selector = v; click(); }, text: () => `${SEL[ac.fuel.selector]}   L ${ac.fuel.gallons(0).toFixed(1)} gal, R ${ac.fuel.gallons(1).toFixed(1)} gal` });
  }

  // ---- instrument knobs ------------------------------------------------------------------------------------------------
  knob('kollsman', 'Altimeter setting', A.x - 0.034, A.y - 0.034, 0.007, { kind: 'turn', turn: (n) => { inst.kollsman = clamp(Math.round((inst.kollsman + n * 0.01) * 100) / 100, 28.0, 31.0); }, text: () => `${inst.kollsman.toFixed(2)} inHg (${(inst.kollsman * 33.8639).toFixed(0)} hPa)` });
  knob('ai_adj', 'Attitude indicator: miniature aeroplane', AI.x, AI.y - 0.046, 0.006, { kind: 'turn', turn: (n) => { inst.aiAdjust = clamp(inst.aiAdjust + n * 0.5, -8, 8); }, text: () => `${inst.aiAdjust.toFixed(1)}°` });
  knob('dg_set', 'Heading indicator: set to the compass', DG.x - 0.034, DG.y - 0.034, 0.007, { kind: 'turn', turn: (n) => { inst.dg = (inst.dg + n + 360) % 360; }, text: () => `shows ${inst.dg.toFixed(0).padStart(3, '0')}°, compass reads ${inst.compass.toFixed(0).padStart(3, '0')}°` });
  knob('hdg_bug', 'Heading bug', DG.x + 0.034, DG.y - 0.034, 0.007, { kind: 'turn', material: orange, turn: (n) => { inst.bug = (inst.bug + n + 360) % 360; }, text: () => `${inst.bug.toFixed(0).padStart(3, '0')}°` });
  knob('obs', 'Course selector (OBS)', CD.x - 0.034, CD.y - 0.034, 0.007, { kind: 'turn', turn: (n) => { rad.obs = (rad.obs + n + 360) % 360; }, text: () => `${rad.obs.toFixed(0).padStart(3, '0')}°  ${rad.cdi.id ? `receiving ${rad.cdi.id}` : 'no station'}` });

  // ---- radios ----------------------------------------------------------------------------------------------------------
  const volKnob = (id, label, x, r) => knob(id, label, x, 1.338, 0.007, { kind: 'axis', get: () => (r.on ? r.vol : 0), set: (v) => { r.on = v > 0.03; r.vol = v; }, angle: () => -135 + 270 * (r.on ? r.vol : 0), text: () => (r.on ? `ON, volume ${pct(r.vol)}` : 'OFF') });
  const button = (id, label, x, y, act, text) => { part(box(0.009, 0.006, 0.006), grey, x, y, PZ + 0.004); return add({ id, label, pos: [x, y, PZ + 0.008], r: 0.007, kind: 'custom', press() { act(); click(); }, text }); };
  volKnob('com_vol', 'COM: on / volume', 0.094, rad.com);
  button('com_swap', 'COM: swap active and standby', 0.118, 1.338, () => rad.swap('com'), () => `active ${rad.com.active.toFixed(3)}`);
  knob('com_mhz', 'COM standby: MHz', 0.138, 1.338, 0.008, { kind: 'turn', turn: (n) => rad.tune('com', 'mhz', n), text: () => rad.com.standby.toFixed(3) });
  knob('com_khz', 'COM standby: kHz', 0.156, 1.338, 0.006, { kind: 'turn', turn: (n) => rad.tune('com', 'khz', n), text: () => rad.com.standby.toFixed(3) });
  volKnob('nav_vol', 'NAV: on / volume', 0.196, rad.nav);
  button('nav_swap', 'NAV: swap active and standby', 0.214, 1.338, () => rad.swap('nav'), () => `active ${rad.nav.active.toFixed(2)}`);
  knob('nav_mhz', 'NAV standby: MHz', 0.230, 1.338, 0.008, { kind: 'turn', turn: (n) => rad.tune('nav', 'mhz', n), text: () => rad.nav.standby.toFixed(2) });
  knob('nav_khz', 'NAV standby: kHz', 0.246, 1.338, 0.006, { kind: 'turn', turn: (n) => rad.tune('nav', 'khz', n), text: () => rad.nav.standby.toFixed(2) });
  const xp = rad.xpdr;
  knob('xpdr_mode', 'Transponder', 0.094, 1.279, 0.009, { kind: 'step', min: 0, max: 4, get: () => xp.mode, set: (v) => { xp.mode = v; click(); }, angle: () => -70 + 35 * xp.mode, text: () => `${XPDR[xp.mode]}, squawk ${xp.code.join('')}` });
  for (let i = 0; i < 4; i++) knob(`xpdr_${i}`, `Transponder code, digit ${i + 1}`, 0.150 + i * 0.020, 1.265, 0.006, { kind: 'turn', turn: (n) => { xp.code[i] = (xp.code[i] + Math.sign(n) + 8) % 8; }, text: () => xp.code.join('') });
  button('xpdr_ident', 'Transponder: IDENT', 0.240, 1.270, () => { xp.ident = 18; }, () => (xp.ident > 0 ? 'identifying' : ''));

  // ---- yokes, and the control lock through the pilot's one
  const yokes = [-0.255, 0.255].map((x) => {
    const y = new Group(); y.position.set(x, 1.10, PZ + 0.25); g.add(y); const b = new Batch();
    b.add(tube([0, 0, -0.26], [0, 0, 0], 0.012), chrome).add(box(0.22, 0.032, 0.032, 0, 0, 0), black).add(box(0.032, 0.11, 0.034, -0.115, 0.045, 0.005), black).add(box(0.032, 0.11, 0.034, 0.115, 0.045, 0.005), black);
    b.build(y, { cast: false });
    return y;
  });
  const lock = new Group(); lock.position.set(-0.255, 1.118, PZ + 0.07); g.add(lock);
  part(tube([0, -0.03, 0], [0, 0.03, 0], 0.003), chrome, 0, 0, 0, lock); part(box(0.07, 0.035, 0.002, 0.0, 0.05, 0), redM, 0, 0, 0, lock);
  add({ id: 'ctl_lock', label: 'Control lock', pos: [-0.255, 1.16, PZ + 0.07], r: 0.035, kind: 'toggle', get: () => c.controlLock, set: (v) => { c.controlLock = v; click(); }, text: () => (c.controlLock ? 'IN PLACE: click to remove' : 'removed'), visible: () => c.controlLock });
  // the place it lives when removed: a click on the yoke shaft puts it back
  add({ id: 'ctl_lock_in', label: 'Control lock', pos: [-0.255, 1.10, PZ + 0.07], r: 0.02, kind: 'toggle', get: () => c.controlLock, set: (v) => { if (ac.gear.onGround) { c.controlLock = v; click(); } }, text: () => 'removed: click to fit', visible: () => !c.controlLock });

  // ---- outside: the things a walk-round removes
  const tie = ac.cfg.gear.tie;
  add({ id: 'pitot_cover', label: 'Pitot tube cover', pos: [-2.95, 1.78, 0.56], r: 0.22, kind: 'toggle', exterior: true, get: () => inst.pitotCover, set: (v) => { inst.pitotCover = v; click(); }, text: () => (inst.pitotCover ? 'ON: click to remove' : 'off') });
  for (const s of [-1, 1]) add({ id: `chocks${s}`, label: 'Wheel chocks', pos: [s * 1.265, 0.15, 1.48], r: 0.38, kind: 'toggle', exterior: true, get: () => ac.gear.chocks, set: (v) => { ac.gear.chocks = v; click(); }, text: () => (ac.gear.chocks ? 'IN PLACE: click to remove' : 'removed') });
  tie.forEach((p, i) => add({ id: `tie${i}`, label: 'Tie-down ropes', pos: [p.x, p.y - 0.5, p.z], r: 0.45, kind: 'toggle', exterior: true, get: () => ac.gear.tiedown,
    set: (v) => { ac.gear.tiedown = v; if (v) ac.gear.setTiePoints(ac, tie); click(); }, text: () => (ac.gear.tiedown ? 'TIED DOWN: click to untie' : 'untied') }));

  S.build(g, { cast: false });

  // ---- every frame -----------------------------------------------------------------------------------------------------
  function update(dt) {
    if (stroke > 0) { stroke -= dt; c.primer = stroke > 0.45 ? (0.9 - stroke) / 0.45 : Math.max(0, stroke / 0.45); }
    for (const f of anims) f();
    setN(N.asi, DIALS.asi.scale, inst.kias); setN(N.vsi, DIALS.vsi.scale, inst.vsFpm / 100); setN(N.tach, DIALS.tach.scale, inst.rpm / 100);
    setN(N.egt, DIALS.egt.scale, (inst.egt * 1.8 + 32 - 1050) / 25); setN(N.suction, DIALS.suction.scale, inst.suction); setN(N.amps, DIALS.amps.scale, inst.amps);
    const ft = inst.altFt;
    N.alt100.rotation.z = -(ft % 1000) / 1000 * 2 * Math.PI; N.alt1k.rotation.z = -(ft % 10000) / 10000 * 2 * Math.PI; N.alt10k.rotation.z = -ft / 100000 * 2 * Math.PI;
    const hr = ac.weather.hour + ac.time / 3600;
    N.hour.rotation.z = -(hr % 12) / 12 * 2 * Math.PI; N.min.rotation.z = -((hr * 60) % 60) / 60 * 2 * Math.PI; N.sec.rotation.z = -Math.floor((hr * 3600) % 60) / 60 * 2 * Math.PI;
    setN(N.fuelL, STRIPS.fuelL.scale, inst.fuelL); setN(N.fuelR, STRIPS.fuelR.scale, inst.fuelR);
    setN(N.oilT, STRIPS.oilT.scale, inst.oilT > 1 ? inst.oilT * 1.8 + 32 : 60); setN(N.oilP, STRIPS.oilP.scale, inst.oilP);
    // gyros
    aiBall.quaternion.copy(qa.setFromAxisAngle(AZ, inst.aiBank)).multiply(qb.setFromAxisAngle(AX, inst.aiPitch));
    aiBank.rotation.z = inst.aiBank; aiPlane.position.y = AI.y + inst.aiAdjust * 0.0011;
    tcPlane.rotation.z = -inst.tcRate * 18 * D; tcBall.position.x = TC.x + inst.ball / 0.25 * 0.018; tcBall.position.y = TC.y - 0.0218 + Math.abs(inst.ball / 0.25) ** 2 * 0.0012; tcFlag.visible = inst.flag.tc;
    dgCard.rotation.z = inst.dg * D; dgBug.rotation.z = -(inst.bug - inst.dg) * D;
    obsCard.rotation.z = rad.obs * D;
    const cdi = rad.cdi; locBar.position.x = CD.x + clamp(cdi.needle, -1.1, 1.1) * 0.0195; gsBar.position.y = CD.y + clamp(cdi.gs, -1.1, 1.1) * 0.0195;
    navFlag.visible = cdi.navFlag; gsFlag.visible = cdi.gsFlag; gsBar.visible = !cdi.gsFlag || !cdi.isLoc;
    toFrom(cdi.navFlag ? 'OFF' : cdi.isLoc ? 'LOC' : cdi.toFrom > 0 ? 'TO' : cdi.toFrom < 0 ? 'FR' : 'OFF', cdi.navFlag ? 'OFF' : cdi.isLoc ? 'LOC' : cdi.toFrom > 0 ? 'TO' : cdi.toFrom < 0 ? 'FR' : 'OFF');
    compass.rotation.y = inst.compass * D;
    // text windows
    const r1 = e.has('RADIO1', true) && (rad.com.on || rad.nav.on), r2 = e.has('RADIO2', true) && xp.mode >= 1;
    navcom(`${r1}${rad.com.active}${rad.com.standby}${rad.nav.active}${rad.nav.standby}`, r1, rad);
    xpdrD(`${r2}${xp.code}${xp.mode}${xp.reply}`, r2, xp);
    const ks = inst.kollsman.toFixed(2); koll(ks, ks);
    const th = eng.tach.toFixed(1).padStart(6, '0'); tachH(th, th); const hb = eng.hobbs.toFixed(1).padStart(6, '0'); hobbs(hb, hb);
    // lighting: the panel's flood and post lights, dimmed by the rheostat and the bus voltage
    const lv = e.has('INST_LTS') ? c.panelLights * Math.min(1.2, e.volts / 27) ** 3 : 0;
    for (const [m, k] of lit) m.emissiveIntensity = lv * k;
    lowVolt.material.emissiveIntensity = e.masterBat && e.lowVolt ? 12 : 0;
    yokes.forEach((y) => { y.position.z = PZ + 0.25 + ac.yoke.pitch * 0.07; y.rotation.z = -ac.yoke.roll * 80 * D; });
    lock.visible = c.controlLock;
  }

  // ---- finding what the mouse is on: `o` and `d` are the ray in the aeroplane's own coordinates
  const _p = [0, 0, 0];
  function pick(o, d, exterior) {
    let best = null, bt = Infinity;
    for (const k of controls) {
      if (!!k.exterior !== exterior || (k.visible && !k.visible())) continue;
      const p = typeof k.pos === 'function' ? k.pos() : k.pos;
      const px = p[0] - o.x, py = p[1] - o.y, pz = p[2] - o.z, t = px * d.x + py * d.y + pz * d.z;
      if (t < 0.05 || t > (exterior ? 60 : 2.5)) continue;
      const m = Math.hypot(px - d.x * t, py - d.y * t, pz - d.z * t);
      if (m < k.r && t - (k.r - m) < bt) { bt = t - (k.r - m); best = k; }
    }
    return best;
  }
  let acc = 0;
  const api = {
    group: g, controls, update, pick,
    tip: (k) => { const s = k.text?.() ?? ''; return s ? `${k.label}: ${s}` : k.label; },
    press(k, b) {
      acc = 0;
      if (k.kind === 'custom') k.press?.(b);
      else if (k.kind === 'toggle') k.set(!k.get());
      else if (k.kind === 'step') k.set(clamp(k.get() + (b === 2 ? -1 : 1), k.min, k.max));
    },
    release(k) { k.release?.(); },
    drag(k, dy) {
      if (k.kind === 'axis') k.set(clamp(k.get() - dy * (k.sens ?? 0.004), k.min ?? 0, k.max ?? 1));
      else if (k.kind === 'turn') { acc -= dy * 0.2; const n = Math.trunc(acc); if (n) { acc -= n; k.turn(n); } }
    },
    wheel(k, n) {
      if (k.kind === 'custom') k.wheel?.(n);
      else if (k.kind === 'axis') k.set(clamp(k.get() + n * (k.step ?? 0.05), k.min ?? 0, k.max ?? 1));
      else if (k.kind === 'turn') k.turn(n);
      else if (k.kind === 'step') k.set(clamp(k.get() + (n > 0 !== !!k.invertWheel ? 1 : -1), k.min, k.max));
      else if (k.kind === 'toggle') k.set(n > 0);
    },
    find: (id) => controls.find((k) => k.id === id),
  };
  return api;
}
