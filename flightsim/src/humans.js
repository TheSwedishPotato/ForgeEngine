// Procedural people: articulated bodies with clothing, hair, faces and poses.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, colorize } from './geom.js';
import { faceTexture } from './textures.js';
import { clamp, lerp } from './core.js';

export const SKIN = ['#f3d6c3', '#eccab2', '#e2b99c', '#d8a888', '#c68f6c', '#a8704f', '#8a5a3c', '#5e3b27'];
export const HAIR = { blonde: '#d8b977', ash: '#b59f7c', light: '#9c7a4f', brown: '#5a3b24', dark: '#2b1d15', black: '#141110', red: '#8c3f1f', grey: '#9c9a96', white: '#d9d6cf' };
export const EYES = ['#3b5a7a', '#4d6f8f', '#5c7a4a', '#6b4a2e', '#3a2a1c', '#7b8ea3'];

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
bodyMat.envMapIntensity = 0.4;
const faceMats = new Map();
function faceMat(tex) {
  if (!faceMats.has(tex)) { const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }); m.envMapIntensity = 0.3; faceMats.set(tex, m); }
  return faceMats.get(tex);
}
export const HUMAN_MATS = { body: bodyMat };

// Random passenger appearance (skews Scandinavian but mixed).
export function randomAppearance(r, over = {}) {
  const female = over.female ?? r() < 0.5;
  const age = over.age ?? Math.round(clamp(20 + r() * 50 + (r() < 0.12 ? 15 : 0), 4, 85));
  const skinIdx = r() < 0.72 ? r.int(0, 2) : r.int(2, 7);
  const skin = SKIN[skinIdx];
  const darkish = skinIdx >= 4;
  let hairColor = darkish ? r.pick([HAIR.dark, HAIR.black, HAIR.black]) : r.pick([HAIR.blonde, HAIR.ash, HAIR.light, HAIR.brown, HAIR.brown, HAIR.dark, HAIR.red]);
  if (age > 58) hairColor = r.pick([HAIR.grey, HAIR.white, HAIR.grey, hairColor]);
  const hairStyle = female ? r.pick(['long', 'long', 'ponytail', 'bun', 'bob', 'short']) : (age > 55 && r() < 0.35 ? 'bald' : r.pick(['short', 'short', 'short', 'crop', 'curly', 'long']));
  const business = r() < 0.34 && age > 24 && age < 66;
  const tops = business ? ['#1d2433', '#2b2f36', '#3b4150', '#23304a', '#474b53'] : ['#1a1b1f', '#e9e7e2', '#6d7480', '#2e3a52', '#7a2d2d', '#a3957e', '#3f5b46', '#c9c3b8', '#34495e', '#5b3a4e', '#d6c7a1', '#8497b0'];
  const bottoms = business ? ['#1d2230', '#26282e', '#3a3d45'] : ['#27354d', '#1f2a3d', '#2a2a2e', '#4d4f55', '#6b6153', '#394d6b'];
  const a = {
    female, age, skin, eye: r.pick(EYES), hairColor, hairStyle,
    height: (female ? 1.66 : 1.80) + r.gauss() * 0.06 - (age < 14 ? 0.5 : 0),
    build: clamp(1 + r.gauss() * 0.08 + (age > 45 ? 0.05 : 0), 0.85, 1.3),
    top: r.pick(tops), bottom: bottoms[r.int(0, bottoms.length - 1)],
    shoes: r.pick(['#1b1b1d', '#f1f1ef', '#5a4636', '#2c2f38', '#d9d9d9']),
    collar: business ? r.pick(['#f4f4f2', '#dde6f0', '#f4f4f2']) : null,
    sleeves: r() < 0.9 ? 'long' : 'short',
    jacket: business || r() < 0.3,
    glasses: r() < (age > 45 ? 0.55 : 0.2),
    beard: !female && r() < 0.28 ? hairColor : null,
    headphones: r() < 0.14 ? r.pick(['#1b1b1d', '#e8e8e8', '#6b7a8f']) : null,
    earbuds: r() < 0.14,
    cap: !female && r() < 0.05 ? r.pick(['#222', '#2e3a52']) : null,
    lipstick: female && r() < 0.3,
    freckles: r() < 0.08,
    seed: Math.floor(r() * 1e6),
  };
  return Object.assign(a, over);
}

// SAS cabin crew (2025 uniform: royal & navy blue, Sunrise / Night Blue scarves).
export function crewAppearance(r, { female, name }) {
  const a = randomAppearance(r, { female, age: r.int(24, 52) });
  a.uniform = true; a.name = name;
  a.top = '#23357a';        // royal-navy blazer
  a.bottom = '#172241';     // navy trousers / skirt
  a.collar = '#f6f6f4';
  a.scarf = r() < 0.55 ? '#efc6a0' : '#1f335e'; // Sunrise or Night Blue
  a.shoes = r() < 0.3 ? '#f2f2f0' : '#141416';   // optional white trainers
  a.jacket = true; a.glasses = r() < 0.15; a.headphones = null; a.earbuds = false; a.cap = null;
  a.skirt = female && r() < 0.4;
  a.hairStyle = female ? r.pick(['bun', 'bun', 'ponytail', 'bob']) : r.pick(['short', 'crop', 'short']);
  a.beard = !female && r() < 0.2 ? a.hairColor : null;
  a.sleeves = 'long';
  return a;
}

function limb(len, r0, r1, segs = 7, flat = 1) {
  // hangs down from origin along -y
  return loft([
    { y: -len, rx: r1, rz: r1 * flat },
    { y: -len * 0.5, rx: (r0 + r1) / 2 * 1.02, rz: (r0 + r1) / 2 * flat },
    { y: -len * 0.1, rx: r0, rz: r0 * flat },
    { y: 0, rx: r0 * 0.85, rz: r0 * 0.85 * flat },
  ], segs);
}

export class Human {
  constructor(app, { detail = 1 } = {}) {
    this.app = app;
    const s = app.height / 1.75, b = app.build, f = app.female;
    this.s = s;
    const seg = detail > 0.5 ? 9 : 6;
    this.root = new THREE.Group();
    const J = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
    const j = this.j = {};
    j.pelvis = J('pelvis', this.root, 0, 0.93 * s, 0);
    j.spine = J('spine', j.pelvis, 0, 0.1 * s, 0);
    j.chest = J('chest', j.spine, 0, 0.2 * s, 0);
    j.neck = J('neck', j.chest, 0, 0.29 * s, 0.005);
    j.head = J('head', j.neck, 0, 0.085 * s, 0.012);
    const sw = (f ? 0.175 : 0.195) * s * (0.9 + b * 0.1);
    j.lShoulder = J('lShoulder', j.chest, -sw, 0.25 * s, 0); j.rShoulder = J('rShoulder', j.chest, sw, 0.25 * s, 0);
    j.lElbow = J('lElbow', j.lShoulder, 0, -0.29 * s, 0); j.rElbow = J('rElbow', j.rShoulder, 0, -0.29 * s, 0);
    j.lWrist = J('lWrist', j.lElbow, 0, -0.255 * s, 0); j.rWrist = J('rWrist', j.rElbow, 0, -0.255 * s, 0);
    const hw = (f ? 0.095 : 0.09) * s;
    j.lHip = J('lHip', j.pelvis, -hw, -0.02 * s, 0); j.rHip = J('rHip', j.pelvis, hw, -0.02 * s, 0);
    j.lKnee = J('lKnee', j.lHip, 0, -0.44 * s, 0); j.rKnee = J('rKnee', j.rHip, 0, -0.44 * s, 0);
    j.lAnkle = J('lAnkle', j.lKnee, 0, -0.42 * s, 0); j.rAnkle = J('rAnkle', j.rKnee, 0, -0.42 * s, 0);
    this.parts = []; // {geo, color, joint}
    const add = (joint, geo, color, bucket = 'body') => { colorize(geo, color); this.parts.push({ joint, geo, bucket }); return geo; };
    const skin = app.skin, top = app.top, bot = app.bottom;
    const S = (v) => v * s;
    // pelvis
    add(j.pelvis, loft([
      { y: S(-0.1), rx: S(0.14) * b, rz: S(0.1) * b },
      { y: S(-0.02), rx: S(f ? 0.175 : 0.16) * b, rz: S(0.115) * b },
      { y: S(0.1), rx: S(f ? 0.15 : 0.15) * b, rz: S(0.1) * b },
    ], seg), bot);
    // belt line
    if (!app.skirt) add(j.pelvis, loft([{ y: S(0.07), rx: S(0.153) * b, rz: S(0.103) * b }, { y: S(0.1), rx: S(0.153) * b, rz: S(0.103) * b }], seg, { capTop: false, capBottom: false }), app.uniform ? '#101010' : '#2a2320');
    // abdomen
    add(j.spine, loft([
      { y: 0, rx: S(0.148) * b, rz: S(0.098) * b },
      { y: S(0.1), rx: S(f ? 0.13 : 0.14) * b, rz: S(0.098) * b * (b > 1.1 ? 1.15 : 1) },
      { y: S(0.2), rx: S(f ? 0.14 : 0.155) * b, rz: S(0.1) * b },
    ], seg), top);
    // chest
    const chestRings = [
      { y: 0, rx: S(f ? 0.14 : 0.155) * b, rz: S(0.1) * b },
      { y: S(0.1), rx: S(f ? 0.15 : 0.17) * b, rz: S(f ? 0.124 : 0.112) * b, z: S(f ? 0.012 : 0) },
      { y: S(0.18), rx: S(f ? 0.162 : 0.185) * b, rz: S(0.106) * b },
      { y: S(0.235), rx: S(f ? 0.175 : 0.2), rz: S(0.09) },
      { y: S(0.262), rx: S(f ? 0.14 : 0.16), rz: S(0.078) },
      { y: S(0.285), rx: S(0.095), rz: S(0.066) },
      { y: S(0.302), rx: S(0.062), rz: S(0.056) },
    ];
    add(j.chest, loft(chestRings, seg), top);
    if (app.collar) {
      // shirt V at the neckline
      const v = new THREE.CircleGeometry(S(0.05), 3, -Math.PI / 2 - 0.5, 1.0);
      v.scale(1, 1.6, 1); v.translate(0, S(0.27), S(0.078)); v.rotateX(-0.12);
      add(j.chest, v, app.collar);
      const c = loft([{ y: S(0.275), rx: S(0.064), rz: S(0.058) }, { y: S(0.31), rx: S(0.058), rz: S(0.054) }], seg, { capTop: false, capBottom: false });
      add(j.chest, c, app.collar);
    }
    if (app.uniform) {
      // lapels and name badge
      for (const sx of [-1, 1]) { const l = new THREE.BoxGeometry(S(0.035), S(0.15), S(0.01)); l.rotateZ(sx * 0.35); l.translate(sx * S(0.05), S(0.2), S(0.105)); add(j.chest, l, '#1b2a63'); }
      const badge = new THREE.BoxGeometry(S(0.06), S(0.018), S(0.006)); badge.translate(S(-0.09), S(0.165), S(0.118)); add(j.chest, badge, '#d8d4c8');
      const wing = new THREE.BoxGeometry(S(0.035), S(0.008), S(0.006)); wing.translate(S(0.09), S(0.18), S(0.112)); add(j.chest, wing, '#c8a64b');
      // buttons
      for (let k = 0; k < 2; k++) { const bt = new THREE.SphereGeometry(S(0.008), 6, 4); bt.translate(0, S(0.03 + k * 0.07), S(0.118)); add(j.chest, bt, '#c9ccd4'); }
    }
    if (app.scarf) {
      const sc = loft([{ y: S(0.27), rx: S(0.075), rz: S(0.07) }, { y: S(0.305), rx: S(0.07), rz: S(0.066) }], seg, { capTop: false, capBottom: false });
      add(j.chest, sc, app.scarf);
      const knot = new THREE.ConeGeometry(S(0.035), S(0.09), 4); knot.rotateZ(Math.PI); knot.translate(S(0.025), S(0.23), S(0.09)); add(j.chest, knot, app.scarf);
    }
    // neck
    add(j.neck, loft([{ y: -S(0.02), rx: S(0.052), rz: S(0.05) }, { y: S(0.09), rx: S(0.046), rz: S(0.048) }], seg), skin);
    // head (face-textured)
    const headRings = [
      { y: S(0.0), rx: S(0.04), rz: S(0.045), z: S(0.02) },
      { y: S(0.03), rx: S(0.062), rz: S(0.078), z: S(0.012) },
      { y: S(0.08), rx: S(0.075), rz: S(0.093), z: S(0.006) },
      { y: S(0.13), rx: S(0.08), rz: S(0.099) },
      { y: S(0.18), rx: S(0.079), rz: S(0.097), z: -S(0.004) },
      { y: S(0.215), rx: S(0.063), rz: S(0.08), z: -S(0.008) },
      { y: S(0.238), rx: S(0.028), rz: S(0.036), z: -S(0.01) },
    ];
    const headGeo = loft(headRings, 16);
    const fopts = { female: f, age: app.age, eye: app.eye, seed: app.seed, beard: app.beard, lipstick: app.lipstick, freckles: app.freckles, hi: detail >= 2 };
    this.faceTex = faceTexture(skin, fopts);
    if (detail >= 1) { this.faceBlink = faceTexture(skin, { ...fopts, blink: true }); this.faceTalk = faceTexture(skin, { ...fopts, talk: true }); this.faceTalkBlink = faceTexture(skin, { ...fopts, talk: true, blink: true }); }
    this.headGeo = headGeo;
    // nose & ears
    const nose = new THREE.ConeGeometry(S(0.014), S(0.045), 4); nose.rotateX(-Math.PI / 2 - 0.35); nose.translate(0, S(0.09), S(0.098)); add(j.head, nose, skin, 'head');
    for (const sx of [-1, 1]) { const e = new THREE.SphereGeometry(S(0.022), 6, 5); e.scale(0.45, 1, 0.8); e.translate(sx * S(0.078), S(0.12), -S(0.005)); add(j.head, e, skin, 'head'); }
    this._hair(add, j.head, S, app);
    if (app.glasses) {
      const fc = app.age > 50 ? '#6b5a4a' : '#1b1b1d';
      for (const sx of [-1, 1]) { const ring = new THREE.TorusGeometry(S(0.019), S(0.0032), 4, 12); ring.translate(sx * S(0.03), S(0.132), S(0.098)); add(j.head, ring, fc, 'head'); const arm = new THREE.BoxGeometry(S(0.004), S(0.004), S(0.09)); arm.translate(sx * S(0.075), S(0.134), S(0.055)); add(j.head, arm, fc, 'head'); }
      const br = new THREE.BoxGeometry(S(0.018), S(0.004), S(0.004)); br.translate(0, S(0.135), S(0.1)); add(j.head, br, fc, 'head');
    }
    if (app.headphones) {
      const band = new THREE.TorusGeometry(S(0.092), S(0.012), 4, 16, Math.PI); band.translate(0, S(0.13), -S(0.005)); add(j.head, band, app.headphones, 'head');
      for (const sx of [-1, 1]) { const cup = new THREE.CylinderGeometry(S(0.04), S(0.04), S(0.03), 12); cup.rotateZ(Math.PI / 2); cup.translate(sx * S(0.092), S(0.115), 0); add(j.head, cup, app.headphones, 'head'); }
    } else if (app.earbuds) {
      for (const sx of [-1, 1]) { const eb = new THREE.SphereGeometry(S(0.008), 6, 4); eb.translate(sx * S(0.082), S(0.115), S(0.012)); add(j.head, eb, '#f4f4f4', 'head'); }
    }
    // arms
    const sleeve = app.sleeves === 'long' || app.uniform;
    for (const side of ['l', 'r']) {
      const sx = side === 'l' ? -1 : 1;
      const delt = new THREE.SphereGeometry(S(0.047) * b, seg, 6); delt.scale(1, 1.15, 1); delt.translate(0, -S(0.012), 0);
      add(j[side + 'Shoulder'], delt, top);
      add(j[side + 'Shoulder'], limb(S(0.29), S(0.045) * b, S(0.037) * b, seg), top);
      add(j[side + 'Elbow'], limb(S(0.255), S(0.037) * b, S(0.027), seg), sleeve ? top : skin);
      if (sleeve) add(j[side + 'Elbow'], loft([{ y: -S(0.255), rx: S(0.033), rz: S(0.033) }, { y: -S(0.22), rx: S(0.034), rz: S(0.034) }], seg, { capTop: false, capBottom: false }), app.uniform ? '#1b2a63' : top);
      const palm = new RoundedBoxGeometry(S(0.028), S(0.075), S(0.07), 2, S(0.012)); palm.translate(0, -S(0.04), S(0.004)); add(j[side + 'Wrist'], palm, skin);
      for (let k = 0; k < 4; k++) { const fg = new THREE.CapsuleGeometry(S(0.0075), S(0.045), 2, 5); fg.rotateX(0.25); fg.translate(0, -S(0.098), S(-0.022 + k * 0.0145)); add(j[side + 'Wrist'], fg, skin); }
      const thumb = new THREE.CapsuleGeometry(S(0.009), S(0.035), 2, 5); thumb.rotateX(0.6); thumb.translate(sx * -S(0.012), -S(0.035), S(0.04)); add(j[side + 'Wrist'], thumb, skin);
      // legs
      add(j[side + 'Hip'], limb(S(0.44), S(0.078) * b, S(0.052), seg), app.skirt ? skin : bot);
      add(j[side + 'Knee'], limb(S(0.42), S(0.052), S(0.036), seg), app.skirt ? '#d7b9a3' : bot);
      const shoe = new RoundedBoxGeometry(S(0.085), S(0.075), S(0.25), 2, S(0.025)); shoe.translate(0, -S(0.04), S(0.055)); add(j[side + 'Ankle'], shoe, app.shoes);
      if (app.shoes === '#f2f2f0' || app.shoes === '#f1f1ef') { const sole = new THREE.BoxGeometry(S(0.088), S(0.02), S(0.25)); sole.translate(0, -S(0.07), S(0.055)); add(j[side + 'Ankle'], sole, '#fafafa'); }
    }
    if (app.skirt) add(j.pelvis, loft([{ y: -S(0.42), rx: S(0.2), rz: S(0.16) }, { y: -S(0.1), rx: S(0.175), rz: S(0.125) }, { y: S(0.08), rx: S(0.155), rz: S(0.105) }], seg), bot);
    if (app.jacket && !app.uniform) {
      // open jacket hem
      add(j.spine, loft([{ y: -S(0.1), rx: S(0.165) * b, rz: S(0.112) * b }, { y: S(0.02), rx: S(0.158) * b, rz: S(0.108) * b }], seg, { capTop: false, capBottom: false }), top);
    }
    this._build();
  }

  _hair(add, head, S, app) {
    const hc = app.hairColor, st = app.hairStyle;
    if (app.cap) {
      const cap = new THREE.SphereGeometry(S(0.086), 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5); cap.scale(1, 0.8, 1.12); cap.translate(0, S(0.155), -S(0.005)); add(head, cap, app.cap, 'head');
      const brim = new THREE.CylinderGeometry(S(0.07), S(0.07), S(0.008), 12, 1, false, -Math.PI / 2, Math.PI); brim.scale(1, 1, 1.2); brim.translate(0, S(0.16), S(0.08)); add(head, brim, app.cap, 'head');
      return;
    }
    if (st === 'bald') {
      const fr = new THREE.SphereGeometry(S(0.084), 12, 8, Math.PI * 0.15, Math.PI * 1.7, Math.PI * 0.45, Math.PI * 0.2); fr.scale(1, 1, 1.18); fr.translate(0, S(0.1), -S(0.008)); add(head, fr, hc, 'head');
      return;
    }
    // cranium-fitted cap (unit sphere scaled to the skull), tilted back so the hairline sits above the forehead
    const thick = st === 'crop' ? 1.0 : st === 'curly' ? 1.12 : 1.05;
    const cap = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * (st === 'crop' ? 0.36 : 0.42));
    cap.rotateX(-0.5); cap.scale(S(0.086) * thick, S(0.108) * thick, S(0.109) * thick); cap.translate(0, S(0.136), -S(0.012)); add(head, cap, hc, 'head');
    // back of the head down to the nape
    const back = new THREE.SphereGeometry(1, 14, 10, Math.PI * 1.02, Math.PI * 0.96, Math.PI * 0.18, Math.PI * 0.6);
    back.scale(S(0.087) * thick, S(0.11), S(0.106) * thick); back.translate(0, S(0.128), -S(0.012)); add(head, back, hc, 'head');
    // sideburns / temples
    for (const sx of [-1, 1]) { const sb = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, Math.PI * 0.2, Math.PI * 0.5); sb.scale(S(0.012), S(0.04), S(0.035)); sb.translate(sx * S(0.079), S(0.15), -S(0.015)); add(head, sb, hc, 'head'); }
    if (st === 'curly') { for (let i = 0; i < 9; i++) { const c = new THREE.SphereGeometry(S(0.03), 6, 5); const a = i / 9 * Math.PI * 2; c.translate(Math.sin(a) * S(0.07), S(0.2) + Math.cos(a * 2) * S(0.01), Math.cos(a) * S(0.075) - S(0.01)); add(head, c, hc, 'head'); } }
    if (st === 'long' || st === 'bob') {
      const len = st === 'long' ? S(0.3) : S(0.14);
      // hair falling behind the ears and down the back
      const h = loft([
        { y: S(0.13) - len, rx: S(0.075), rz: S(0.028), z: -S(0.075) },
        { y: S(0.13) - len * 0.55, rx: S(0.092), rz: S(0.045), z: -S(0.06) },
        { y: S(0.07), rx: S(0.094), rz: S(0.075), z: -S(0.035) },
        { y: S(0.16), rx: S(0.09), rz: S(0.098), z: -S(0.016) },
      ], 14, { capTop: false });
      // open the front: squash the front-facing vertices behind the face plane
      const pa = h.attributes.position; for (let i = 0; i < pa.count; i++) { if (pa.getZ(i) > S(0.035)) pa.setZ(i, S(0.035)); }
      h.computeVertexNormals(); add(head, h, hc, 'head');
    }
    if (st === 'ponytail') { const p = new THREE.CapsuleGeometry(S(0.028), S(0.17), 3, 8); p.rotateX(0.35); p.translate(0, S(0.06), -S(0.125)); add(head, p, hc, 'head'); const tie = new THREE.SphereGeometry(S(0.032), 8, 6); tie.translate(0, S(0.15), -S(0.105)); add(head, tie, hc, 'head'); }
    if (st === 'bun') { const bn = new THREE.SphereGeometry(S(0.045), 10, 8); bn.translate(0, S(0.18), -S(0.1)); add(head, bn, hc, 'head'); }
  }

  _build() {
    // group parts by joint into meshes (articulated rig)
    const byJoint = new Map();
    for (const p of this.parts) {
      const k = p.joint;
      if (!byJoint.has(k)) byJoint.set(k, []);
      byJoint.get(k).push(p.geo);
    }
    this.meshes = [];
    for (const [joint, geos] of byJoint) {
      const clean = geos.map((g) => { const q = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(q.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) q.deleteAttribute(a); if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; });
      const m = new THREE.Mesh(mergeGeometries(clean), bodyMat);
      m.castShadow = true; m.receiveShadow = true;
      joint.add(m); this.meshes.push(m);
    }
    this.headMesh = new THREE.Mesh(this.headGeo, faceMat(this.faceTex));
    this.headMesh.castShadow = true;
    this.j.head.add(this.headMesh);
    // holdable items attach to the right hand
    this.rHandItem = new THREE.Group(); this.rHandItem.position.set(0, -0.08 * this.s, 0.03); this.j.rWrist.add(this.rHandItem);
    this.lHandItem = new THREE.Group(); this.lHandItem.position.set(0, -0.08 * this.s, 0.03); this.j.lWrist.add(this.lHandItem);
  }

  // Swap the face texture for blinking / talking (actors only).
  setExpression(blink, talk) {
    if (!this.faceBlink) return;
    const t = blink ? (talk ? this.faceTalkBlink : this.faceBlink) : (talk ? this.faceTalk : this.faceTex);
    if (this.headMesh.material.map !== t) this.headMesh.material = faceMat(t);
  }

  setPose(p) {
    for (const [k, v] of Object.entries(p)) {
      const jn = this.j[k]; if (!jn) continue;
      if (Array.isArray(v)) jn.rotation.set(v[0], v[1], v[2]);
    }
  }

  // Blend towards a pose (object of joint -> [x,y,z]) with rate.
  blendPose(p, t) {
    for (const [k, v] of Object.entries(p)) {
      const jn = this.j[k]; if (!jn || !Array.isArray(v)) continue;
      jn.rotation.x = lerp(jn.rotation.x, v[0], t); jn.rotation.y = lerp(jn.rotation.y, v[1], t); jn.rotation.z = lerp(jn.rotation.z, v[2], t);
    }
  }

  // Bake current pose into static geometry: body merged; head group kept for animation.
  bakeStatic() {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const bodyGeos = [], headGeos = [];
    const headInv = new THREE.Matrix4().copy(this.j.head.matrixWorld).invert();
    for (const p of this.parts) {
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (p.bucket === 'head') { headGeos.push(g); continue; }
      const m = new THREE.Matrix4().multiplyMatrices(inv, p.joint.matrixWorld);
      g.applyMatrix4(m); bodyGeos.push(g);
    }
    const body = new THREE.Mesh(mergeGeometries(bodyGeos), bodyMat);
    body.castShadow = true; body.receiveShadow = true;
    const headPivot = new THREE.Group();
    const hm = new THREE.Matrix4().multiplyMatrices(inv, this.j.head.matrixWorld);
    hm.decompose(headPivot.position, headPivot.quaternion, headPivot.scale);
    const extras = new THREE.Mesh(mergeGeometries(headGeos), bodyMat); extras.castShadow = true;
    const face = new THREE.Mesh(this.headGeo, faceMat(this.faceTex)); face.castShadow = true;
    headPivot.add(face, extras);
    headPivot.userData.rest = headPivot.quaternion.clone();
    return { body, head: headPivot };
  }
}

// ---------------- poses ----------------
const D = Math.PI / 180;
export const POSES = {
  stand: { pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
    lShoulder: [0.05, 0, -0.07], rShoulder: [0.05, 0, 0.07], lElbow: [-0.15, 0, 0], rElbow: [-0.15, 0, 0], lWrist: [0, 0, 0], rWrist: [0, 0, 0],
    lHip: [0, 0, 0], rHip: [0, 0, 0], lKnee: [0.02, 0, 0], rKnee: [0.02, 0, 0], lAnkle: [0, 0, 0], rAnkle: [0, 0, 0] },
  sit: { pelvis: [0, 0, 0], spine: [-10 * D, 0, 0], chest: [-4 * D, 0, 0], neck: [8 * D, 0, 0], head: [4 * D, 0, 0],
    lShoulder: [-18 * D, 0, -0.1], rShoulder: [-18 * D, 0, 0.1], lElbow: [-62 * D, 0.2, 0], rElbow: [-62 * D, -0.2, 0], lWrist: [0.2, 0, 0], rWrist: [0.2, 0, 0],
    lHip: [-86 * D, 0, -0.06], rHip: [-86 * D, 0, 0.06], lKnee: [84 * D, 0, 0], rKnee: [84 * D, 0, 0], lAnkle: [-0.05, 0, 0], rAnkle: [-0.05, 0, 0] },
  sitPhone: { lShoulder: [-30 * D, 0, -0.05], rShoulder: [-32 * D, 0, 0.05], lElbow: [-105 * D, 0.5, 0], rElbow: [-105 * D, -0.5, 0], neck: [22 * D, 0, 0], head: [12 * D, 0, 0] },
  sitRead: { lShoulder: [-25 * D, 0, -0.1], rShoulder: [-25 * D, 0, 0.1], lElbow: [-95 * D, 0.6, 0], rElbow: [-95 * D, -0.6, 0], neck: [18 * D, 0, 0], head: [10 * D, 0, 0] },
  sitSleep: { spine: [-16 * D, 0, 0], neck: [-6 * D, 0, 0.12], head: [10 * D, 0.2, 0.18], lElbow: [-45 * D, 0.1, 0], rElbow: [-45 * D, -0.1, 0] },
  sitArmsCrossed: { lShoulder: [-30 * D, 0, 0.1], rShoulder: [-30 * D, 0, -0.1], lElbow: [-100 * D, 0.9, 0], rElbow: [-100 * D, -0.9, 0] },
  sitLaptop: { lShoulder: [-35 * D, 0, -0.08], rShoulder: [-35 * D, 0, 0.08], lElbow: [-70 * D, 0.3, 0], rElbow: [-70 * D, -0.3, 0], neck: [20 * D, 0, 0], head: [8 * D, 0, 0] },
  // crew seated on a jump seat, hands under thighs (brace-ready)
  jump: { lShoulder: [-8 * D, 0, -0.12], rShoulder: [-8 * D, 0, 0.12], lElbow: [-40 * D, 0, 0], rElbow: [-40 * D, 0, 0], spine: [-2 * D, 0, 0], neck: [0, 0, 0] },
};

export function composePose(...ps) { return Object.assign({}, ...ps); }

// Walk cycle pose at phase (radians) and speed factor 0..1
export function walkPose(phase, k = 1, carrying = false) {
  const s = Math.sin(phase), c = Math.cos(phase);
  const leg = 0.42 * k;
  const p = {
    pelvis: [0, s * 0.06 * k, 0], spine: [0.04 * k, -s * 0.05 * k, 0], chest: [0, -s * 0.05 * k, 0], neck: [0, 0, 0], head: [0, s * 0.03, 0],
    lHip: [-s * leg, 0, 0], rHip: [s * leg, 0, 0],
    lKnee: [Math.max(0, c) * 0.75 * k + 0.05, 0, 0], rKnee: [Math.max(0, -c) * 0.75 * k + 0.05, 0, 0],
    lAnkle: [s * 0.15 * k, 0, 0], rAnkle: [-s * 0.15 * k, 0, 0],
  };
  if (!carrying) Object.assign(p, { lShoulder: [s * 0.3 * k, 0, -0.07], rShoulder: [-s * 0.3 * k, 0, 0.07], lElbow: [-0.25 - Math.max(0, s) * 0.2, 0, 0], rElbow: [-0.25 - Math.max(0, -s) * 0.2, 0, 0] });
  return p;
}

// Handheld props
const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
export function makeProp(kind) {
  let g;
  if (kind === 'phone') { g = colorize(new RoundedBoxGeometry(0.075, 0.155, 0.009, 2, 0.006), '#1b1c20'); }
  else if (kind === 'cup') { g = colorize(new THREE.CylinderGeometry(0.035, 0.027, 0.085, 12), '#f5f5f3'); }
  else if (kind === 'book') { g = colorize(new THREE.BoxGeometry(0.14, 0.2, 0.025), '#7a3b2e'); }
  else if (kind === 'mask') { g = colorize(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f0e7b0'); g.rotateX(-Math.PI / 2); }
  else if (kind === 'belt') { g = colorize(new THREE.BoxGeometry(0.5, 0.045, 0.006), '#3a3f49'); }
  else if (kind === 'vest') { g = colorize(new RoundedBoxGeometry(0.34, 0.4, 0.06, 2, 0.03), '#f2c230'); }
  else if (kind === 'card') { g = colorize(new THREE.BoxGeometry(0.2, 0.28, 0.004), '#e8edf3'); }
  else if (kind === 'terminal') { g = colorize(new RoundedBoxGeometry(0.08, 0.17, 0.035, 2, 0.01), '#2b2e35'); }
  else if (kind === 'bag') { g = colorize(new THREE.CylinderGeometry(0.14, 0.12, 0.45, 8, 1, true), '#e9ecef'); }
  else g = colorize(new THREE.BoxGeometry(0.05, 0.05, 0.05), '#888');
  const m = new THREE.Mesh(g, propMat); m.castShadow = true; return m;
}
