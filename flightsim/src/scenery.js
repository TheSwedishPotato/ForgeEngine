// Airports (Arlanda, Kastrup), landmarks around the Øresund and other traffic.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARN, CPH, ARN_LAYOUT, CPH_LAYOUT, RUNWAYS, runwayGeom, LANDMARKS } from './places.js';
import { project, curveMaterial, rng, clamp, lerp, DEG, CURVE_GLSL, sharedUniforms, smoothstep } from './core.js';
import { GEO } from '../data/geodata.js';
import { canvasTex, glowTex, rr } from './textures.js';
import { colorize } from './geom.js';
import { REGION } from './world.js';
import { Human, randomAppearance, POSES, composePose } from './humans.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
const lp = (lat, lon) => { const p = project(lat, lon); return V2(p.x, p.z); };

// ---------------- textures ----------------
function runwayTexture(len, ids) {
  const W = 128, H = 8192, mpx = len / H; // metres per pixel along
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#3d3e40'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    const Y = (m) => m / mpx; // metres from the 'a' end (canvas top)
    const X = (m) => (m + 22.5) / 45 * W; // across, -22.5..22.5
    // rubber deposits in both touchdown zones
    for (const [a, b] of [[250, 900], [len - 900, len - 250]]) { const gr = g.createLinearGradient(0, Y(a), 0, Y(b)); gr.addColorStop(0, 'rgba(15,15,15,0)'); gr.addColorStop(0.5, 'rgba(15,15,15,0.55)'); gr.addColorStop(1, 'rgba(15,15,15,0)'); g.fillStyle = gr; g.fillRect(X(-9), Y(a), X(9) - X(-9), Y(b) - Y(a)); }
    g.fillStyle = '#e9e9e4';
    g.fillRect(X(-22), 0, X(-21.1) - X(-22), H); g.fillRect(X(21.1), 0, X(22) - X(21.1), H); // edge lines
    for (let m = 90; m < len - 90; m += 50) g.fillRect(X(-0.45), Y(m), Math.max(1.5, X(0.45) - X(-0.45)), Y(30));
    const endMarks = (from, dir) => {
      // piano keys
      for (let k = 0; k < 6; k++) for (const s of [-1, 1]) { const x0 = s * (3 + k * 3.4); g.fillRect(X(Math.min(x0, x0 + s * 1.8)), Y(from + dir * 6) - (dir < 0 ? Y(30) : 0), Math.abs(X(1.8) - X(0)), Y(30)); }
      // aiming point & touchdown zone
      for (const s of [-1, 1]) {
        g.fillRect(X(s > 0 ? 6 : -16), Y(from + dir * 400) - (dir < 0 ? Y(60) : 0), X(10) - X(0), Y(60));
        for (const [dist, n] of [[150, 3], [300, 2], [600, 2], [750, 1], [900, 1]]) for (let k = 0; k < n; k++) g.fillRect(X(s * (6 + k * 3.5) + (s < 0 ? -2 : 0)), Y(from + dir * dist) - (dir < 0 ? Y(22) : 0), X(1.8) - X(0), Y(22));
      }
    };
    endMarks(0, 1); endMarks(len, -1);
    // designators (drawn rotated so they read from the approach)
    const num = (txt, m, flip) => { g.save(); g.translate(W / 2, Y(m)); g.scale(1, (H / len) / (W / 45) * 1); if (flip) g.rotate(Math.PI); g.font = 'bold 16px Arial'; g.textAlign = 'center'; g.fillText(txt, 0, 6); g.restore(); };
    num(ids[0], 60, true); num(ids[1], len - 60, false);
  }, { mips: true });
}

function taxiTexture() {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#48494b'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.fillStyle = '#d8b020'; g.fillRect(w / 2 - 2, 0, 4, h);
    g.fillStyle = 'rgba(216,176,32,0.8)'; g.fillRect(2, 0, 2, h); g.fillRect(w - 4, 0, 2, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h / 2, w, 1);
  }, { repeat: true });
}

function concreteTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8d8f8f'; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(30,30,30,0.15)'; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 20, 8, Math.random() * 3, 0, 7); g.fill(); }
  }, { repeat: true });
}

function facadeTexture(kind = 'glass') {
  return canvasTex(256, 128, (g, w, h) => {
    if (kind === 'glass') {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6f8597'); gr.addColorStop(1, '#3d4e5c'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(220,230,240,0.35)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h);
      g.fillStyle = 'rgba(30,35,40,0.6)'; g.fillRect(0, h * 0.48, w, 3);
    } else if (kind === 'office') {
      g.fillStyle = '#b7b3aa'; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h; y += 16) for (let x = 4; x < w; x += 12) { g.fillStyle = Math.random() < 0.15 ? '#e8d7a0' : '#2f3b46'; g.fillRect(x, y, 8, 9); }
    } else if (kind === 'hangar') {
      g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.2)'; for (let x = 0; x < w; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    }
  }, { repeat: true });
}

// ---------------- generic airliner ----------------
export const LIVERIES = {
  sas: { body: '#d3d6db', belly: '#1d3a86', tail: '#1d3a86', engine: '#b9bdc4', nose: null, title: '#1d3a86' },
  norwegian: { body: '#f4f4f4', belly: '#f4f4f4', tail: '#d81e2c', engine: '#f4f4f4', nose: '#d81e2c', title: '#1b2a4a' },
  lufthansa: { body: '#f2f2f2', belly: '#f2f2f2', tail: '#0a1d3d', engine: '#0a1d3d', nose: null, title: '#0a1d3d' },
  klm: { body: '#6fb7e8', belly: '#f5f5f5', tail: '#6fb7e8', engine: '#6fb7e8', nose: null, title: '#0c3d7a' },
  finnair: { body: '#f5f5f5', belly: '#f5f5f5', tail: '#0b1560', engine: '#f5f5f5', nose: null, title: '#0b1560' },
  airfrance: { body: '#f7f7f7', belly: '#f7f7f7', tail: '#f7f7f7', engine: '#f7f7f7', nose: null, title: '#0b2a6b', tailStripes: ['#0b2a6b', '#e1262d'] },
  ryanair: { body: '#f5f5f5', belly: '#073590', tail: '#073590', engine: '#073590', nose: null, title: '#073590' },
  braathens: { body: '#f7f7f7', belly: '#f7f7f7', tail: '#d6d6d6', engine: '#f7f7f7', nose: null, title: '#e7bd4a' },
  // LN-RKR, the all-blue 80th-anniversary A330 with the Scandinavian flag band (2026)
  anniversary: { body: '#1d3a86', belly: '#1d3a86', tail: '#1d3a86', engine: '#1d3a86', nose: null, title: '#ffffff', band: true },
};

export function makeAirliner(liv, { len = 37.6, span = 35.8, seed = 1, curved = true } = {}) {
  const parts = [];
  const add = (geo, color) => { colorize(geo, color); parts.push(geo.index ? geo.toNonIndexed() : geo); };
  const R = 1.98, L = len;
  // fuselage (along -z = nose)
  const bodyPts = [];
  const prof = [[0, -L / 2], [0.9, -L / 2 + 0.6], [1.6, -L / 2 + 2.0], [1.95, -L / 2 + 4.2], [R, -L / 2 + 6], [R, L / 2 - 9], [1.6, L / 2 - 5], [0.9, L / 2 - 1.8], [0.35, L / 2]];
  for (const [r, z] of prof) bodyPts.push(new THREE.Vector2(r, z));
  const upper = new THREE.LatheGeometry(bodyPts, 20, 0, Math.PI); upper.rotateX(Math.PI / 2); upper.rotateZ(-Math.PI / 2);
  const lower = new THREE.LatheGeometry(bodyPts, 20, Math.PI, Math.PI); lower.rotateX(Math.PI / 2); lower.rotateZ(-Math.PI / 2);
  // LatheGeometry revolves around Y; after rotateX(90) the axis is z; split into top/bottom halves
  upper.rotateZ(Math.PI / 2); lower.rotateZ(Math.PI / 2);
  add(upper, liv.body); add(lower, liv.belly);
  if (liv.nose) { const n = new THREE.SphereGeometry(1.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); n.rotateX(-Math.PI / 2); n.scale(1, 1, 2.6); n.translate(0, 0, -L / 2 + 5.2); add(n, liv.nose); }
  // cockpit windows band
  const cw = new THREE.BoxGeometry(2.2, 0.35, 1.2); cw.translate(0, 0.95, -L / 2 + 3.0); add(cw, '#1a1f28');
  // window line
  const wl = new THREE.BoxGeometry(4.02, 0.22, L - 16); wl.translate(0, 0.35, 1.5); add(wl, '#2a2f38');
  // wings
  const wing = new THREE.Shape();
  wing.moveTo(0, -3.2); wing.lineTo(span / 2, 2.8); wing.lineTo(span / 2, 4.3); wing.lineTo(0, 4.2); wing.closePath();
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.35, bevelEnabled: false }); wg.rotateX(Math.PI / 2); wg.translate(0, -0.7, 1.0);
  const wg2 = wg.clone(); wg2.scale(-1, 1, 1);
  wg.rotateZ(0.08); wg2.rotateZ(-0.08);
  add(wg, '#c7cad0'); add(wg2, '#c7cad0');
  // winglets
  for (const s of [-1, 1]) { const wlg = new THREE.BoxGeometry(0.12, 2.2, 1.4); wlg.translate(s * span / 2, 1.2, 3.6); add(wlg, liv.tail); }
  // engines
  for (const s of [-1, 1]) { const e = new THREE.CylinderGeometry(1.05, 0.9, 4.2, 14); e.rotateX(Math.PI / 2); e.translate(s * 5.8, -1.9, -2.2); add(e, liv.engine); const inlet = new THREE.CylinderGeometry(0.85, 0.85, 0.1, 14); inlet.rotateX(Math.PI / 2); inlet.translate(s * 5.8, -1.9, -4.3); add(inlet, '#1c1e22'); }
  // horizontal stabiliser
  const hs = new THREE.Shape(); hs.moveTo(0, 0); hs.lineTo(6.2, 2.4); hs.lineTo(6.2, 3.6); hs.lineTo(0, 3.4); hs.closePath();
  const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.2, bevelEnabled: false }); hg.rotateX(Math.PI / 2); hg.translate(0, 0.9, L / 2 - 6.5); const hg2 = hg.clone(); hg2.scale(-1, 1, 1);
  add(hg, liv.body); add(hg2, liv.body);
  // vertical fin
  const vf = new THREE.Shape(); vf.moveTo(0, 0); vf.lineTo(5.6, 6.2); vf.lineTo(7.4, 6.2); vf.lineTo(6.6, 0); vf.closePath();
  const vg = new THREE.ExtrudeGeometry(vf, { depth: 0.3, bevelEnabled: false }); vg.rotateY(-Math.PI / 2); vg.translate(0.15, 1.6, L / 2 - 8.2);
  add(vg, liv.tail);
  if (liv.tailStripes) { const st = new THREE.BoxGeometry(0.34, 3.5, 0.5); st.rotateX(-0.7); st.translate(0, 5.0, L / 2 - 3.2); add(st, liv.tailStripes[0]); const st2 = st.clone(); st2.translate(0, 0, 0.6); add(st2, liv.tailStripes[1]); }
  // titles
  const tl = new THREE.BoxGeometry(4.03, 0.5, 7); tl.translate(0, 0.95, -L / 2 + 11); add(tl, liv.title);
  if (liv.band) { // red / white / blue flag band around the centre fuselage
    for (const [dz, col] of [[-0.9, '#e8323c'], [0, '#ffffff'], [0.9, '#2a4fb5']]) { const ring = new THREE.CylinderGeometry(R + 0.02, R + 0.02, 0.8, 24, 1, true); ring.rotateX(Math.PI / 2); ring.translate(0, 0, L * 0.05 + dz); add(ring, col); }
    const eighty = new THREE.BoxGeometry(0.34, 2.2, 2.6); eighty.rotateX(-0.7); eighty.translate(0, 4.6, L / 2 - 4.2); add(eighty, '#ffffff');
  }
  // gear
  for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 10); g.rotateZ(Math.PI / 2); g.translate(s * 3.8, -3.2, 2.5); add(g, '#1c1c1c'); }
  const ng = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10); ng.rotateZ(Math.PI / 2); ng.translate(0, -3.3, -L / 2 + 5.5); add(ng, '#1c1c1c');
  const strut = new THREE.BoxGeometry(0.2, 1.8, 0.2); strut.translate(0, -2.4, -L / 2 + 5.5); add(strut, '#d9d9d9');
  const merged = mergeGeometries(parts);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
  if (curved) curveMaterial(mat);
  const m = new THREE.Mesh(merged, mat);
  // origin: ground contact under the cabin floor reference
  m.position.y = 0;
  const grp = new THREE.Group(); m.position.y = 3.4; grp.add(m);
  return grp;
}

// ---------------- lights (point sprites) ----------------
class LightField {
  constructor() {
    this.pos = []; this.col = []; this.size = []; this.kind = [];
  }
  add(x, y, z, color, size = 1, kind = 0) { const c = new THREE.Color(color); this.pos.push(x, y, z); this.col.push(c.r, c.g, c.b); this.size.push(size); this.kind.push(kind); }
  build(u) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('kind', new THREE.Float32BufferAttribute(this.kind, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uTex: { value: glowTex() }, uNightVis: { value: 1 }, uTime: u.uTime, uPx: { value: 1 }, uCamPos: u.uCamPos, uFog: u.uInCloud }, { uViewUp: sharedUniforms.uViewUp, uPreExp: sharedUniforms.uPreExp }),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        #include <common>
        attribute vec3 color; attribute float size; attribute float kind; varying vec3 vCol; varying float vA;
        uniform float uNightVis; uniform float uTime; uniform float uPx; uniform vec3 uCamPos; uniform float uFog;
        ${CURVE_GLSL}
        #include <logdepthbuf_pars_vertex>
        void main(){
          vec4 mv = curveView(modelViewMatrix * vec4(position, 1.0));
          float d = length(mv.xyz);
          vCol = color; vA = 1.0;
          if (kind > 0.5 && kind < 1.5) { // sequenced flashers ("rabbit"), size encodes order
            float ph = fract(uTime * 2.0 - size * 0.05); vA = step(ph, 0.08) * 3.0;
          } else if (kind > 1.5 && kind < 2.5) { // PAPI: white above its angle, red below
            vec3 wp = (modelMatrix * vec4(position,1.0)).xyz; vec3 dv = uCamPos - wp;
            float ang = degrees(atan(dv.y, length(dv.xz)));
            vCol = ang > size ? vec3(1.0, 0.97, 0.9) : vec3(1.0, 0.08, 0.05);
          } else if (kind > 2.5) { // beacon / obstruction flashing red
            vA = step(fract(uTime * 0.8 + size), 0.3);
          }
          float px = clamp(1800.0 / d, 1.2, 9.0) * uPx;
          vA *= clamp(3000.0 / d, 0.25, 1.0) * uNightVis * exp(-d * uFog / 60.0);
          gl_PointSize = px * (kind > 1.5 && kind < 2.5 ? 1.6 : 1.0);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uPreExp; varying vec3 vCol; varying float vA;
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vCol * t.r * vA * 2.5 * uPreExp, 1.0); }`,
    });
    const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = 3;
    return p;
  }
}

// ---------------- Scenery ----------------
export class Scenery {
  constructor(world, route, opts) {
    this.world = world; this.scene = world.scene; this.route = route;
    this.quality = opts.quality || 'medium';
    this.r = rng(42);
    this.u = world.u;
    this.lights = new LightField();
    this.animated = [];
    this.traffic = [];
    this.mats = {
      runway: null,
      taxi: curveMaterial(new THREE.MeshStandardMaterial({ map: taxiTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      concrete: curveMaterial(new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })),
      glass: curveMaterial(new THREE.MeshStandardMaterial({ map: facadeTexture('glass'), roughness: 0.2, metalness: 0.5 })),
      office: curveMaterial(new THREE.MeshStandardMaterial({ map: facadeTexture('office'), roughness: 0.7 })),
      hangar: curveMaterial(new THREE.MeshStandardMaterial({ map: facadeTexture('hangar'), roughness: 0.6 })),
      roof: curveMaterial(new THREE.MeshStandardMaterial({ color: '#8e9296', roughness: 0.8 })),
      white: curveMaterial(new THREE.MeshStandardMaterial({ color: '#e8e9ea', roughness: 0.55 })),
      bridge: curveMaterial(new THREE.MeshStandardMaterial({ color: '#b8bbbd', roughness: 0.6 })),
      tree: curveMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })),
      jetway: curveMaterial(new THREE.MeshStandardMaterial({ color: '#c9cbce', roughness: 0.5, metalness: 0.3 })),
      dark: curveMaterial(new THREE.MeshStandardMaterial({ color: '#2d3036', roughness: 0.8 })),
      vehicle: curveMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })),
    };
    this.sun = new THREE.DirectionalLight('#ffffff', 2); this.sun.position.set(0, 1, 0); this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight('#bfd4ff', '#4d5540', 0.6); this.scene.add(this.hemi);
    this._airportARN();
    this._airportCPH();
    this._landmarks();
    this._traffic();
    this.lightPoints = this.lights.build(this.u); this.scene.add(this.lightPoints);
  }

  // A ground-crew figure in a hi-vis vest, baked static, optionally with ear defenders.
  _worker(p, heading, { pose = 'stand', female = false, wands = false } = {}) {
    const app = randomAppearance(this.r, { female, age: this.r.int(22, 55), top: '#f3d90a', bottom: '#2a2f3a', jacket: false, glasses: false, headphones: '#2b2f37', cap: null, earbuds: false });
    const h = new Human(app, { detail: 0.4 });
    const poses = {
      stand: composePose(POSES.stand, { lShoulder: [0.05, 0, -0.1], rShoulder: [0.05, 0, 0.1] }),
      wands: composePose(POSES.stand, { lShoulder: [-2.4, 0, -0.5], rShoulder: [-2.4, 0, 0.5], lElbow: [-0.3, 0, 0], rElbow: [-0.3, 0, 0] }),
      lift: composePose(POSES.stand, { spine: [0.35, 0, 0], lShoulder: [-1.1, 0, -0.2], rShoulder: [-1.1, 0, 0.2], lElbow: [-0.6, 0, 0], rElbow: [-0.6, 0, 0] }),
    };
    h.setPose(poses[pose] || poses.stand);
    const b = h.bakeStatic();
    const g = new THREE.Group(); g.add(b.body, b.head);
    for (const m of [b.body, b.head]) m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); curveMaterial(o.material); } });
    if (wands) for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), this.mats.vehicle); colorize(w.geometry, '#ff9a1a'); w.position.set(sx * 0.35, 1.95, 0.1); g.add(w); }
    g.position.set(p.x, 0, p.y); g.rotation.y = -heading * DEG; this.scene.add(g);
    return g;
  }

  // Apron vehicles from coloured boxes: tug, baggage tractor + carts, belt loader, catering truck, fuel bowser, GPU.
  _vehicle(kind) {
    const parts = [];
    const B = (w, h, d, x, y, z, c) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); colorize(g, c); parts.push(g.toNonIndexed()); };
    const wheel = (x, z, r = 0.45) => { const g = new THREE.CylinderGeometry(r, r, 0.3, 10); g.rotateZ(Math.PI / 2); g.translate(x, r, z); colorize(g, '#1b1b1d'); parts.push(g.toNonIndexed()); };
    if (kind === 'tractor') { B(1.6, 0.9, 2.6, 0, 0.9, 0, '#e8eaea'); B(1.4, 0.9, 1.2, 0, 1.7, 0.4, '#e8eaea'); B(1.2, 0.5, 1.0, 0, 1.95, 0.4, '#233047'); wheel(-0.8, 0.9); wheel(0.8, 0.9); wheel(-0.8, -0.9); wheel(0.8, -0.9); }
    else if (kind === 'cart') { B(1.5, 0.15, 3.0, 0, 0.6, 0, '#7a8089'); B(1.5, 1.6, 0.06, 0, 1.4, -1.47, '#7a8089'); B(0.06, 1.6, 3.0, -0.72, 1.4, 0, '#7a8089'); B(1.5, 0.06, 3.0, 0, 2.2, 0, '#7a8089'); for (let i = 0; i < 5; i++) B(0.55, 0.35, 0.7, -0.3 + (i % 2) * 0.6, 0.95 + Math.floor(i / 2) * 0.4, -0.9 + (i % 3) * 0.9, ['#2d3a5a', '#7a2d2d', '#1a1a1a', '#5a4a3a', '#33455a'][i]); wheel(-0.6, 0.9, 0.3); wheel(0.6, 0.9, 0.3); wheel(-0.6, -0.9, 0.3); wheel(0.6, -0.9, 0.3); }
    else if (kind === 'belt') { B(1.7, 0.9, 3.4, 0, 0.9, 0, '#e8eaea'); B(1.3, 0.9, 1.1, 0, 1.75, -1.0, '#e8eaea'); const belt = new THREE.BoxGeometry(0.9, 0.2, 6.5); belt.rotateX(-0.42); belt.translate(0, 2.4, 2.2); colorize(belt, '#2b2f37'); parts.push(belt.toNonIndexed()); wheel(-0.85, 1.0); wheel(0.85, 1.0); wheel(-0.85, -1.0); wheel(0.85, -1.0); }
    else if (kind === 'catering') { B(2.4, 2.6, 6.5, 0, 2.3, 0.5, '#f2f2f0'); B(2.2, 1.6, 1.6, 0, 1.4, -3.4, '#f2f2f0'); B(2.0, 0.6, 1.4, 0, 2.2, -3.3, '#233047'); wheel(-1.1, -2.6, 0.5); wheel(1.1, -2.6, 0.5); wheel(-1.1, 1.8, 0.5); wheel(1.1, 1.8, 0.5); }
    else if (kind === 'fuel') { const t = new THREE.CylinderGeometry(1.1, 1.1, 7, 16); t.rotateX(Math.PI / 2); t.translate(0, 1.9, 0.8); colorize(t, '#d9dde2'); parts.push(t.toNonIndexed()); B(2.3, 1.6, 1.8, 0, 1.5, -4.0, '#e0392d'); wheel(-1.1, -3.2, 0.5); wheel(1.1, -3.2, 0.5); wheel(-1.1, 1.5, 0.5); wheel(1.1, 1.5, 0.5); wheel(-1.1, 2.7, 0.5); wheel(1.1, 2.7, 0.5); }
    else if (kind === 'gpu') { B(1.3, 1.2, 2.4, 0, 0.9, 0, '#f3d90a'); B(1.1, 0.3, 0.6, 0, 1.6, 0.6, '#2b2f37'); wheel(-0.6, 0.7, 0.3); wheel(0.6, 0.7, 0.3); wheel(-0.6, -0.7, 0.3); wheel(0.6, -0.7, 0.3); }
    else if (kind === 'tug') { B(2.6, 1.2, 6.0, 0, 0.9, 0, '#e9e9e4'); B(2.2, 1.0, 1.6, 0, 1.9, 1.8, '#e9e9e4'); B(2.0, 0.5, 1.4, 0, 2.15, 1.8, '#233047'); B(2.4, 0.5, 1.0, 0, 0.5, -3.2, '#4a4f58'); wheel(-1.2, 2.0, 0.55); wheel(1.2, 2.0, 0.55); wheel(-1.2, -2.0, 0.55); wheel(1.2, -2.0, 0.55); }
    else if (kind === 'crane') { B(1.8, 46, 1.8, 0, 23, 0, '#f2c230'); B(1.6, 1.6, 34, 0, 46, 14, '#f2c230'); B(1.4, 1.4, 9, 0, 46, -6, '#f2c230'); B(2.2, 2.2, 2.4, 0, 45.8, -9.5, '#5a5f68'); B(1.8, 2.0, 2.0, 0, 44, 1.5, '#2b2f37'); const cab = new THREE.CylinderGeometry(0.03, 0.03, 30, 4); cab.rotateX(Math.PI / 2 - 0.9); cab.translate(0, 55, 8); colorize(cab, '#333'); parts.push(cab.toNonIndexed()); }
    const m = new THREE.Mesh(mergeGeometries(parts), this.mats.vehicle);
    this.scene.add(m);
    return m;
  }
  // place a vehicle at a runway-frame position with a heading
  _place(m, frame, u, v, hdg) { const p = frame.to(u, v); m.position.set(p.x, 0, p.y); m.rotation.y = -hdg * DEG; return m; }
  // straight-line drive between two frame points, looping or one-shot
  _drive(m, frame, from, to, hdg, speed, { loop = true, start = 0, dwell = 8 } = {}) {
    const a = frame.to(from[0], from[1]), b = frame.to(to[0], to[1]); const len = a.distanceTo(b);
    m.rotation.y = -hdg * DEG;
    this.animated.push({ m, a, b, len, speed, loop, start, dwell, hdg });
    m.position.set(a.x, 0, a.y);
  }

  // Airport ground texture: painted in a runway-aligned box. draw(g, M) where M maps (u,v) runway frame -> px.
  _groundTexture(frame, centreUV, size, N, draw) {
    const tex = canvasTex(N, N, (g) => {
      g.clearRect(0, 0, N, N);
      const M = (u, v) => [(v - centreUV[1]) / size * N + N / 2, (u - centreUV[0]) / size * N + N / 2];
      draw(g, M, N / size);
    }, { srgb: true });
    tex.flipY = false;
    const centre = frame.to(centreUV[0], centreUV[1]);
    // shader box local: l.x along world-rotated axis; we map canvas x -> v axis, canvas y -> u axis
    return { tex, centre };
  }

  _registerGround(i, frame, centreUV, size, N, draw) {
    const { tex, centre } = this._groundTexture(frame, centreUV, size, N, draw);
    // canvas x runs along frame.v, canvas y along frame.u
    this.world.setAirportTexture(i, tex, centre, size, frame.v, frame.u);
  }

  _poly(g, M, pts, fill) { g.beginPath(); pts.forEach(([u, v], i) => { const [x, y] = M(u, v); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }); g.closePath(); g.fillStyle = fill; g.fill(); }
  _rect(g, M, u0, v0, u1, v1, fill) { this._poly(g, M, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], fill); }
  _noiseFill(g, N, base, amp, alpha = 1) {
    const img = g.getImageData(0, 0, N, N); const d = img.data; const r = this.r;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { const n = (r() - 0.5) * amp; d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n * 0.6, 0, 255); }
    g.putImageData(img, 0, 0);
  }

  // World-space box building aligned to a frame direction.
  _building(frame, u, v, len, depth, h, mat, roofMat = this.mats.roof, lenAlongU = true) {
    const g = new THREE.BoxGeometry(lenAlongU ? depth : len, h, lenAlongU ? len : depth);
    // scale uv so facade texture repeats every ~12 m horizontally and 8 m vertically
    const uv = g.attributes.uv, nrm = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) { const ax = Math.abs(nrm.getX(i)) > 0.5 ? (lenAlongU ? len : depth) : (lenAlongU ? depth : len); uv.setXY(i, uv.getX(i) * ax / 24, uv.getY(i) * h / 8); }
    const m = new THREE.Mesh(g, [mat, mat, roofMat, roofMat, mat, mat]);
    const p = frame.to(u, v);
    m.position.set(p.x, h / 2, p.y);
    m.rotation.y = -Math.atan2(frame.u.x, -frame.u.y);
    this.scene.add(m);
    return m;
  }

  _runway(rwDef) {
    const rw = runwayGeom(rwDef);
    const tex = runwayTexture(rw.len, rwDef.ids);
    const mat = curveMaterial(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    mat.map.anisotropy = 8;
    const g = new THREE.PlaneGeometry(rw.width, rw.len, 1, 8); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    const c = rw.a.clone().add(rw.b).multiplyScalar(0.5);
    m.position.set(c.x, 0.05, c.y);
    m.rotation.y = -Math.atan2(rw.dir.x, -rw.dir.y) + Math.PI;
    this.scene.add(m);
    // lights along the runway
    const L = this.lights;
    const at = (d, off) => { const p = rw.a.clone().addScaledVector(rw.dir, d); const n = V2(-rw.dir.y, rw.dir.x); p.addScaledVector(n, off); return p; };
    for (let d = 0; d <= rw.len; d += 60) for (const s of [-1, 1]) { const p = at(d, s * 23.5); const endZone = d < 600 || d > rw.len - 600; L.add(p.x, 0.4, p.y, endZone ? '#ffd27a' : '#fff4dc', 1); }
    for (let d = 15; d < rw.len; d += 15) { const p = at(d, 0); const fromEnd = Math.min(d, rw.len - d); const red = fromEnd < 300 || (fromEnd < 900 && Math.floor(d / 15) % 2 === 0); L.add(p.x, 0.15, p.y, red ? '#ff3b2a' : '#f3f6ff', 0.8); }
    for (const [d, col] of [[0, '#34ff6a'], [rw.len, '#34ff6a']]) for (let o = -21; o <= 21; o += 3) { const p = at(d, o); L.add(p.x, 0.3, p.y, col, 1); }
    return rw;
  }

  _approachLights(frame) {
    const L = this.lights;
    for (let d = 30; d <= 900; d += 30) {
      const p = frame.to(-d, 0); L.add(p.x, 1 + d * 0.002, p.y, '#fff2d8', 1);
      for (const o of [-1.5, 1.5]) { const q = frame.to(-d, o); L.add(q.x, 1, q.y, '#fff2d8', 1); }
      if (d % 150 === 0) for (let o = -15; o <= 15; o += 1.5) { const q = frame.to(-d, o); L.add(q.x, 1, q.y, '#fff2d8', 1); }
      if (d >= 300) { const q = frame.to(-d, 0); L.add(q.x, 1.5, q.y, '#ffffff', (900 - d) / 30, 1); }
    }
    // PAPI (left of runway, 300 m in)
    const ang = [2.5, 2.83, 3.17, 3.5];
    ang.forEach((a, i) => { const p = frame.to(320, -(34 + i * 9)); L.add(p.x, 1, p.y, '#ffffff', a, 2); });
  }

  _taxiRibbon(s0, s1, width = 23) {
    const path = this.route.path; const pts = []; const t = {};
    for (let s = s0; s <= s1; s += 4) { path.sample(s, t); pts.push([t.x, t.z, t.dx, t.dz, s]); }
    const pos = [], uv = [], idx = [];
    pts.forEach(([x, z, dx, dz, s], i) => {
      const nx = -dz, nz = dx;
      pos.push(x + nx * width / 2, 0.08, z + nz * width / 2, x - nx * width / 2, 0.08, z - nz * width / 2);
      uv.push(0, (s - s0) / 23, 1, (s - s0) / 23);
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mats.taxi); this.scene.add(m);
    // green centreline lights & blue edge lights
    for (let k = 0; k < pts.length; k += 4) { const [x, z, dx, dz] = pts[k]; this.lights.add(x, 0.12, z, '#3dff8a', 0.6); if (k % 8 === 0) for (const s of [-1, 1]) this.lights.add(x - dz * s * 12.5, 0.4, z + dx * s * 12.5, '#3a6bff', 0.6); }
  }

  _apron(frame, u0, v0, u1, v1) {
    const a = frame.to(u0, v0), b = frame.to(u1, v1);
    const lu = Math.abs(u1 - u0), lv = Math.abs(v1 - v0);
    const g = new THREE.PlaneGeometry(lv, lu); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * lv / 30, uv.getY(i) * lu / 30);
    const m = new THREE.Mesh(g, this.mats.concrete);
    const c = frame.to((u0 + u1) / 2, (v0 + v1) / 2);
    m.position.set(c.x, 0.06, c.y); m.rotation.y = -Math.atan2(frame.u.x, -frame.u.y);
    this.scene.add(m);
  }

  _parked(frame, u, v, hdg, liv, scale = 1) {
    const a = makeAirliner(LIVERIES[liv], { len: 37.6 * scale, span: 35.8 * Math.min(1.1, scale) });
    const p = frame.to(u, v);
    a.position.set(p.x, 0, p.y);
    a.rotation.y = -hdg * DEG;
    this.scene.add(a);
    return a;
  }

  _jetway(frame, pierU, pierV, doorU, doorV, pierSideSign) {
    // tunnel from the pier face to the aircraft L1 door (approximate)
    const a = frame.to(pierU, pierV), b = frame.to(doorU, doorV);
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(2.6, 2.8, len); const m = new THREE.Mesh(g, this.mats.jetway);
    m.position.set((a.x + b.x) / 2, 4.8, (a.y + b.y) / 2); m.rotation.y = -Math.atan2(b.x - a.x, -(b.y - a.y)) + Math.PI;
    m.lookAt(b.x, 4.8, b.y);
    this.scene.add(m);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), this.mats.dark);
    const lp2 = a.clone().lerp(b, 0.75); leg.position.set(lp2.x, 1.7, lp2.y); this.scene.add(leg);
  }

  // A jet bridge whose cab is docked against our forward left door; its interior is
  // what you see when the door opens.
  _dockedJetBridge(f, doorU, doorV, pierU) {
    // interiors are lit by their own ceiling lights
    const inner = curveMaterial(new THREE.MeshBasicMaterial({ color: '#a9aaa6', side: THREE.BackSide }));
    const floorM = curveMaterial(new THREE.MeshBasicMaterial({ color: '#3c414c' }));
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const outer = this.mats.jetway;
    const floorY = 3.36, H = 2.4, W = 2.7;
    const X = new THREE.Vector3(f.u.x, 0, f.u.y), Y = new THREE.Vector3(0, 1, 0);
    const Z = new THREE.Vector3(-f.v.x, 0, -f.v.y); // outward from the left side of the aircraft
    const basis = new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)); // right-handed; box is symmetric along z
    const door = f.to(doorU, doorV);
    const mk = (len, cx, cz, angle = 0) => {
      const g = new THREE.Group();
      // both ends open: one faces the aircraft door, the other continues into the next section
      const inside = new THREE.Mesh(new THREE.BoxGeometry(W, H, len), [inner, inner, inner, hidden, hidden, hidden]);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, H + 0.2, len), [outer, outer, outer, outer, hidden, hidden]);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.05, len), floorM); fl.rotation.x = -Math.PI / 2; fl.position.y = -H / 2 + 0.02;
      const lights = [0.25, 0.75].map((k) => { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.8), new THREE.MeshBasicMaterial({ color: '#fff4e0' })); l.rotation.x = Math.PI / 2; l.position.set(0, H / 2 - 0.02, (k - 0.5) * len); return l; });
      g.add(inside, shell, fl, ...lights);
      g.position.set(cx, floorY + H / 2, cz);
      return g;
    };
    // cab (4 m) straight out from the door, then the tunnel angled back to the pier
    const cabLen = 4.2;
    const cabC = new THREE.Vector3(door.x, 0, door.y).addScaledVector(Z, cabLen / 2);
    const cab = mk(cabLen, cabC.x, cabC.z); cab.quaternion.setFromRotationMatrix(basis); this.scene.add(cab);
    const cabEnd = new THREE.Vector3(door.x, 0, door.y).addScaledVector(Z, cabLen);
    const pierPt = f.to(pierU, doorV - 12);
    const tv = new THREE.Vector3(pierPt.x - cabEnd.x, 0, pierPt.y - cabEnd.z); const tl = tv.length(); tv.normalize();
    const tun = mk(tl + 0.3, (cabEnd.x + pierPt.x) / 2, (cabEnd.z + pierPt.y) / 2);
    tun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(Y, tv), Y, tv)); this.scene.add(tun);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, floorY, 0.6), this.mats.dark); leg.position.set(cabEnd.x, floorY / 2, cabEnd.z); this.scene.add(leg);
  }

  _trees(frame, fn, count, seed) {
    const r = rng(seed);
    const cone = new THREE.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
    const cone2 = new THREE.ConeGeometry(0.8, 0.8, 7); cone2.translate(0, 0.72, 0);
    const trunk = new THREE.CylinderGeometry(0.08, 0.1, 0.25, 5); trunk.translate(0, 0.12, 0);
    colorize(cone, '#1f3320'); colorize(cone2, '#243b22'); colorize(trunk, '#4a3a2a');
    const g = mergeGeometries([cone.toNonIndexed(), cone2.toNonIndexed(), trunk.toNonIndexed()]);
    const im = new THREE.InstancedMesh(g, this.mats.tree, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let n = 0;
    for (let k = 0; k < count * 6 && n < count; k++) {
      const pt = fn(r); if (!pt) continue;
      const h = 14 + r() * 12, w = h * (0.22 + r() * 0.1);
      s.set(w, h, w); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28); p.set(pt.x, 0, pt.y);
      m.compose(p, q, s); im.setMatrixAt(n, m);
      c.setHSL(0.28 + r() * 0.06, 0.35 + r() * 0.2, 0.55 + r() * 0.5); im.setColorAt(n, c);
      n++;
    }
    im.count = n; im.frustumCulled = false; this.scene.add(im);
  }

  _airportARN() {
    const f = ARN.frame, L = ARN_LAYOUT;
    const rws = RUNWAYS.ESSA.map((r) => this._runway(r));
    this._approachLights(f);
    // ground texture 12 km box centred between runways
    const centre = [1800, -600], size = 12000;
    this._registerGround(0, f, centre, size, 2048, (g, M, s) => {
      // base: forest with glades
      g.fillStyle = '#18261a'; g.fillRect(0, 0, 2048, 2048);
      // airfield grass (aerodrome area)
      this._poly(g, M, [[-900, 400], [-900, -2300], [4300, -2300], [4300, 500]], '#6f7f45');
      this._poly(g, M, [[-600, -1300], [-600, -3200], [3200, -3200], [3200, -1300]], '#687a40');
      // runways & strips drawn darker
      for (const rw of rws) {
        const a = rw.a, b = rw.b;
        const toUV = (p) => { const d = p.clone().sub(f.o); return [d.dot(f.u), d.dot(f.v)]; };
        const [ua, va] = toUV(a), [ub, vb] = toUV(b);
        const du = ub - ua, dv = vb - va, l = Math.hypot(du, dv), nu = -dv / l * 30, nv = du / l * 30;
        this._poly(g, M, [[ua + nu, va + nv], [ub + nu, vb + nv], [ub - nu, vb - nv], [ua - nu, va - nv]], '#4a4b4d');
      }
      // taxiways (parallel to 19R, links)
      this._rect(g, M, -120, L.taxiwayZ - 12, 3350, L.taxiwayZ + 12, '#4c4d4f');
      this._rect(g, M, -120, -12 - 40, -60, L.taxiwayZ + 12, '#4c4d4f');
      for (const uu of [900, 1580, 2300, 3000]) this._rect(g, M, uu - 12, -60, uu + 12, L.taxiwayZ, '#4c4d4f');
      this._rect(g, M, 1100, -700, 2700, -1250, '#7c7e80'); // aprons
      this._rect(g, M, 1520, -400, 1760, -950, '#7c7e80');
      this._rect(g, M, 400, -1400, 1000, -1800, '#7c7e80');
      // terminals & roads & car parks
      this._rect(g, M, 1400, -1250, 1900, -1500, '#6a6c70');
      this._rect(g, M, 700, -1500, 2800, -1560, '#555658');
      this._rect(g, M, 1000, -1560, 2600, -1900, '#5e6062');
      this._noiseFill(g, 2048, 0, 22);
      // forest texture speckle outside the aerodrome
      const r = this.r; g.globalAlpha = 0.5;
      for (let i = 0; i < 40000; i++) { const x = r() * 2048, y = r() * 2048; g.fillStyle = r() < 0.5 ? '#0f1a10' : '#2a3a22'; g.fillRect(x, y, 2, 2); }
      g.globalAlpha = 1;
    });
    // taxi ribbons along our taxi-out route and the runway entry
    this._taxiRibbon(0, this.route.m.lineup - 30);
    // aprons near pier F
    this._apron(f, 1480, -420, 1740, -960);
    // Terminal 5 & piers
    const T5 = L.terminal5;
    this._building(f, T5.u, T5.v, T5.len, T5.depth, 22, this.mats.glass);
    this._building(f, L.terminal4.u, L.terminal4.v, L.terminal4.len, L.terminal4.depth, 16, this.mats.glass);
    this._building(f, L.terminal2.u, L.terminal2.v, L.terminal2.len, L.terminal2.depth, 16, this.mats.glass);
    // Pier F: runs across v from v0 to v1 at u0
    const pf = L.pierF;
    this._building(f, pf.u0, (pf.v0 + pf.v1) / 2, Math.abs(pf.v1 - pf.v0), pf.width, 12, this.mats.glass, this.mats.roof, false);
    const pe = L.pierE; this._building(f, pe.u0, (pe.v0 + pe.v1) / 2, Math.abs(pe.v1 - pe.v0), pe.width, 11, this.mats.glass, this.mats.roof, false);
    // Sky City hotel & offices, car parks, hangars
    this._building(f, 1350, -1620, 160, 40, 30, this.mats.office);
    this._building(f, 2000, -1650, 200, 60, 18, this.mats.office);
    this._building(f, 3500, -700, 120, 90, 26, this.mats.hangar);
    this._building(f, 3700, -950, 100, 80, 22, this.mats.hangar);
    this._building(f, 600, -1700, 140, 60, 14, this.mats.office);
    // control tower (83 m)
    const tp = f.to(L.tower.u, L.tower.v);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.5, 72, 16), this.mats.white); tw.position.set(tp.x, 36, tp.y); this.scene.add(tw);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(8, 6.5, 8, 16), this.mats.glass); cab.position.set(tp.x, 76, tp.y); this.scene.add(cab);
    this.lights.add(tp.x, 84, tp.y, '#ff2a1a', 0.2, 3);
    // parked aircraft at pier F north side (nose south, +u), south side (nose north)
    const livs = ['sas', 'sas', 'norwegian', 'lufthansa', 'sas', 'finnair', 'klm', 'sas', 'airfrance', 'sas'];
    let k = 0;
    for (let v = pf.v0 - 40; v > pf.v1 + 30; v -= 55) {
      const skipOurs = Math.abs(v - L.startStandV) < 30;
      if (!skipOurs) { this._parked(f, pf.u0 - 10 - 26, v, f.heading, livs[k % livs.length]); this._jetway(f, pf.u0 - 10, v - 8, pf.u0 - 10 - 12, v - 2.5, 1); }
      this._parked(f, pf.u0 + 10 + 26, v + 20, (f.heading + 180) % 360, livs[(k + 3) % livs.length]);
      this._jetway(f, pf.u0 + 10, v + 28, pf.u0 + 10 + 12, v + 22.5, -1);
      k++;
    }
    for (let v = pe.v0 + 40; v < pe.v1 - 20; v += 52) { this._parked(f, pe.u0 - 36, v, f.heading, livs[(k++) % livs.length]); }
    // pushback tug near our position
    const tug = new THREE.Mesh(colorize(new THREE.BoxGeometry(2.6, 1.6, 5.5), '#e9e9e4'), this.mats.vehicle);
    const tp2 = f.to(1580, L.startStandV - 28); tug.position.set(tp2.x, 0.8, tp2.y); tug.rotation.y = -f.heading * DEG; this.scene.add(tug);
    this.tug = { mesh: tug, start: tp2.clone(), dir: f.u.clone().negate() };
    // ground crew walking back to the pier after pushback, headset man waving us off
    const w1 = this._worker(f.to(1560, L.startStandV - 20), f.heading + 90, { pose: 'stand' });
    this._drive(w1, f, [1560, L.startStandV - 20], [1640, L.startStandV - 20], f.heading + 90, 1.2, { loop: false, start: 15 });
    const w2 = this._worker(f.to(1548, L.startStandV - 26), f.heading + 100, { pose: 'wands' });
    this._drive(w2, f, [1548, L.startStandV - 26], [1640, L.startStandV - 30], f.heading + 90, 1.1, { loop: false, start: 40 });
    // a baggage train and a catering truck working the neighbouring stands, a fuel bowser at the pier
    const bt = this._vehicle('tractor'); const carts = [this._vehicle('cart'), this._vehicle('cart'), this._vehicle('cart')];
    this._drive(bt, f, [1700, -420], [1700, -940], f.heading + 90, 5.5, { loop: true, dwell: 20 });
    carts.forEach((c, i) => this._drive(c, f, [1700 - 4.2 * (i + 1), -420], [1700 - 4.2 * (i + 1), -940], f.heading + 90, 5.5, { loop: true, dwell: 20 }));
    this._place(this._vehicle('catering'), f, pf.u0 + 22, L.startStandV - 62, f.heading + 180);
    this._place(this._vehicle('fuel'), f, pf.u0 - 48, L.startStandV - 128, f.heading + 90);
    this._place(this._vehicle('gpu'), f, pf.u0 - 20, L.startStandV - 4, f.heading);
    // forest around the airfield
    const n = this.quality === 'low' ? 6000 : this.quality === 'high' ? 26000 : 15000;
    const inAerodrome = (u, v) => (u > -950 && u < 4350 && v < 450 && v > -2350) || (u > -650 && u < 3250 && v < -1250 && v > -3250);
    this._trees(f, (r) => {
      const u = -2500 + r() * 9000, v = -3800 + r() * 5600;
      if (inAerodrome(u, v)) return null;
      if (v > 450 && v < 700 && u > -2000 && u < 4000 && r() < 0.6) return null;
      return f.to(u, v);
    }, n, 11);
    // traffic departing ahead of us on 19R
    const dep = makeAirliner(LIVERIES.norwegian, { len: 39.5, span: 35.8 });
    this.scene.add(dep); dep.visible = false;
    this.traffic.push({ obj: dep, kind: 'arn-departure', frame: f });
    // arrival on 01R/19L... landing southbound on 19L
    const arr = makeAirliner(LIVERIES.sas, { len: 44.5, span: 35.8 }); this.scene.add(arr); arr.visible = false;
    this.traffic.push({ obj: arr, kind: 'arn-arrival', rw: runwayGeom(RUNWAYS.ESSA[1]) });
  }

  _airportCPH() {
    const f = CPH.frame, L = CPH_LAYOUT;
    const rws = RUNWAYS.EKCH.map((r) => this._runway(r));
    this._approachLights(f);
    const centre = [1400, 600], size = 12000;
    // project NE coastline & manual islands into the CPH texture
    const toUV = (lat, lon) => { const p = project(lat, lon); const d = V2(p.x, p.z).sub(f.o); return [d.dot(f.u), d.dot(f.v)]; };
    this._registerGround(1, f, centre, size, 2048, (g, M) => {
      // sea marker everywhere first (forced water)
      g.fillStyle = '#0000ff'; g.fillRect(0, 0, 2048, 2048);
      // land from Natural Earth
      g.fillStyle = '#56663a'; g.beginPath();
      for (const poly of GEO.land) for (const ring of poly) {
        let x = 0, y = 0, first = true, inside = false;
        const pts = []; for (let i = 0; i < ring.length; i += 2) { x += ring[i]; y += ring[i + 1]; pts.push([y / 1e4, x / 1e4]); }
        if (!pts.some(([la, lo]) => la > 55.45 && la < 55.8 && lo > 12.4 && lo < 13.1)) continue;
        pts.forEach(([la, lo], i) => { const [u, v] = toUV(la, lo); const [px, py] = M(u, v); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
        g.closePath();
      }
      g.fill('evenodd');
      // Peberholm & Saltholm
      const island = (pts, col) => this._poly(g, M, pts.map(([la, lo]) => toUV(la, lo)), col);
      island(LANDMARKS.saltholm, '#6d7a45');
      island(LANDMARKS.peberholm, '#7d8255');
      // airport platform (reclaimed land) and grass
      this._poly(g, M, [[-700, -600], [-700, 1700], [4200, 1700], [4200, -600]], '#6c7a45');
      // runways shoulders & taxiways
      for (const rw of rws) {
        const a = rw.a.clone().sub(f.o), b = rw.b.clone().sub(f.o);
        const ua = a.dot(f.u), va = a.dot(f.v), ub = b.dot(f.u), vb = b.dot(f.v);
        const du = ub - ua, dv = vb - va, l = Math.hypot(du, dv), nu = -dv / l * 30, nv = du / l * 30;
        this._poly(g, M, [[ua + nu, va + nv], [ub + nu, vb + nv], [ub - nu, vb - nv], [ua - nu, va - nv]], '#4a4b4d');
      }
      this._rect(g, M, -200, L.parallelV - 12, 3800, L.parallelV + 12, '#4c4d4f');
      this._rect(g, M, -100, 700, 1100, L.terminalV - 40, '#7c7e80'); // aprons
      this._rect(g, M, -300, L.terminalV - 40, 1400, L.terminalV + 120, '#66686b');
      this._rect(g, M, -400, L.terminalV + 120, 1500, L.terminalV + 500, '#5a5c5e');
      // Kastrup/Tårnby urban area north-west
      this._poly(g, M, [[-2500, 1700], [-2500, 5000], [3000, 5000], [3000, 1800]], '#6b6b68');
      this._noiseFill(g, 2048, 0, 18);
    });
    // our taxi-in ribbon
    this._taxiRibbon(this.route.m.exit - 120, this.route.m.stand);
    this._apron(f, 150, 700, 720, L.terminalV - 30);
    // terminal & piers
    this._building(f, 500, L.terminalV + 60, 1100, 80, 20, this.mats.glass, this.mats.roof, true);
    for (const p of L.piers) {
      this._building(f, p.u, L.terminalV - p.len / 2, p.len, 22, 11, this.mats.glass, this.mats.roof, false);
    }
    // hangars & cargo
    this._building(f, 2600, 1400, 200, 90, 25, this.mats.hangar);
    this._building(f, 2900, 1100, 160, 90, 24, this.mats.hangar);
    // tower
    const tp = f.to(1300, 1700);
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 60, 16), this.mats.white); tw.position.set(tp.x, 30, tp.y); this.scene.add(tw);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 6, 7, 16), this.mats.glass); cab.position.set(tp.x, 63, tp.y); this.scene.add(cab);
    // parked aircraft along piers (noses towards pier)
    const livs = ['sas', 'norwegian', 'sas', 'klm', 'sas', 'lufthansa', 'finnair', 'sas', 'braathens', 'airfrance', 'ryanair'];
    let k = 0;
    for (const p of L.piers) {
      for (let v = L.terminalV - 70; v > L.terminalV - p.len + 20; v -= 55) {
        for (const side of [-1, 1]) {
          const u = p.u + side * (11 + 26);
          if (Math.abs(u - (L.standU + 4)) < 30 && Math.abs(v - L.standV) < 70) continue; // our stand and its neighbours
          const hdg = side < 0 ? f.heading : (f.heading + 180) % 360;
          this._parked(f, u, v, hdg, livs[k++ % livs.length]);
          this._jetway(f, p.u + side * 11, v - 8 * side, u + side * -12, v - 2.5 * side, side);
        }
      }
    }
    // jet bridge waiting at our stand
    // the 80th-anniversary A330 (LN-RKR) on the long-haul pier C, nose to the pier, plus a Terminal 3
    // construction site with tower cranes (the DKK 5 bn T3 expansion runs until 2027)
    const pc = L.piers.find((p) => p.name === 'C');
    const a330 = makeAirliner(LIVERIES.anniversary, { len: 63.7, span: 60.3 });
    const ap = f.to(pc.u + 11 + 32, L.terminalV - 250); a330.position.set(ap.x, 0, ap.y); a330.rotation.y = -((f.heading + 180) % 360) * DEG; a330.scale.set(1.35, 1.3, 1); this.scene.add(a330);
    for (const [u, v] of [[-120, L.terminalV + 260], [-40, L.terminalV + 330], [60, L.terminalV + 300]]) this._place(this._vehicle('crane'), f, u, v, this.r() * 360);
    // ground handling for our arrival: marshaller ahead of the stand, then a belt loader, baggage train and GPU
    this.cphCrew = {
      marshaller: this._worker(f.to(L.standU + 32, L.standV), (f.heading + 180) % 360, { pose: 'wands', wands: true }),
      loader1: this._worker(f.to(L.standU + 60, L.standV + 40), f.heading, { pose: 'lift' }),
      loader2: this._worker(f.to(L.standU + 62, L.standV + 44), f.heading + 40, { pose: 'stand' }),
      belt: this._vehicle('belt'), tractor: this._vehicle('tractor'), carts: [this._vehicle('cart'), this._vehicle('cart')], gpu: this._vehicle('gpu'),
    };
    this._place(this.cphCrew.belt, f, L.standU + 60, L.standV + 40, f.heading + 180); this._place(this.cphCrew.gpu, f, L.standU + 22, L.standV + 12, f.heading);
    this._place(this.cphCrew.tractor, f, L.standU + 70, L.standV + 48, f.heading + 90); this.cphCrew.carts.forEach((c, i) => this._place(c, f, L.standU + 70 - 4.2 * (i + 1), L.standV + 48, f.heading + 90));
    for (const o of [this.cphCrew.belt, this.cphCrew.tractor, ...this.cphCrew.carts, this.cphCrew.loader1, this.cphCrew.loader2]) o.visible = false;
    // jet bridge docked at our L1 door (door is 2.3 m ahead of the cabin origin, on the left side)
    const pierB = L.piers.find((p) => p.name === 'B');
    // the route ends at the main-gear point, 11.5 m behind the cabin origin: door L1 is 13.8 m ahead of it
    this._dockedJetBridge(f, L.standU + 13.8, L.standV - 2.02, pierB.u - 11);
    // departing traffic on 22R during our approach
    const dep = makeAirliner(LIVERIES.lufthansa, { len: 37.6 }); this.scene.add(dep); dep.visible = false;
    this.traffic.push({ obj: dep, kind: 'cph-departure', rw: runwayGeom(RUNWAYS.EKCH[0]) });
  }

  _landmarks() {
    const M = this.mats;
    // --- Øresund Bridge: Peberholm -> Lernacken, cable-stayed main span with 204 m pylons
    const A = lp(...LANDMARKS.oresundBridgeW), B = lp(...LANDMARKS.oresundBridgeE);
    const dir = B.clone().sub(A); const len = dir.length(); dir.normalize();
    const nrm = V2(-dir.y, dir.x);
    const mid = 0.62; // main span location along the bridge
    const deckH = (t) => { const d = Math.abs(t - mid) * len; return 10 + 47 * Math.max(0, 1 - Math.max(0, d - 245) / 2600); };
    const segs = 60; const pos = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, p = A.clone().addScaledVector(dir, t * len), h = deckH(t);
      for (const [o, dh] of [[-12, 0], [12, 0], [12, -3.5], [-12, -3.5]]) pos.push(p.x + nrm.x * o, h + dh, p.y + nrm.y * o);
      if (i > 0) { const a = (i - 1) * 4, b = i * 4; for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; idx.push(a + k, b + k, a + k2, a + k2, b + k, b + k2); } }
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dg.setIndex(idx); dg.computeVertexNormals();
    const deck = new THREE.Mesh(dg, M.bridge); deck.material = M.bridge.clone(); curveMaterial(deck.material); deck.material.side = THREE.DoubleSide; this.scene.add(deck);
    // piers every 140 m
    const pierG = new THREE.BoxGeometry(8, 1, 5); pierG.translate(0, 0.5, 0);
    const piers = new THREE.InstancedMesh(pierG, M.bridge, 70); let pn = 0;
    const m4 = new THREE.Matrix4();
    for (let d = 140; d < len - 60; d += 140) { const t = d / len; if (Math.abs(t - mid) * len < 260) continue; const p = A.clone().addScaledVector(dir, d); const h = deckH(t) - 3.5; m4.makeScale(1, h, 1).setPosition(p.x, 0, p.y); piers.setMatrixAt(pn++, m4); }
    piers.count = pn; this.scene.add(piers);
    // pylons (twin legs) and cables
    const cablePos = [];
    for (const s of [-1, 1]) {
      const pc = A.clone().addScaledVector(dir, mid * len + s * 245);
      for (const o of [-13, 13]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(5, 204, 6), M.bridge); leg.position.set(pc.x + nrm.x * o, 102, pc.y + nrm.y * o); leg.rotation.y = -Math.atan2(dir.x, -dir.y); this.scene.add(leg);
        for (let c = 1; c <= 10; c++) for (const sgn of [-1, 1]) {
          const top = 110 + c * 8.5; const q = pc.clone().addScaledVector(dir, sgn * (c * 22 + 10));
          cablePos.push(pc.x + nrm.x * o, top, pc.y + nrm.y * o, q.x + nrm.x * o, deckH(mid) - 1, q.y + nrm.y * o);
        }
        this.lights.add(pc.x + nrm.x * o, 206, pc.y + nrm.y * o, '#ff2a1a', Math.random(), 3);
      }
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cablePos, 3));
    const cm = curveMaterial(new THREE.LineBasicMaterial({ color: '#d9dcdf' }));
    const cables = new THREE.LineSegments(cg, cm); this.scene.add(cables);
    // deck lights at night
    for (let d = 0; d < len; d += 60) { const t = d / len; const p = A.clone().addScaledVector(dir, d); for (const o of [-11, 11]) this.lights.add(p.x + nrm.x * o, deckH(t) + 9, p.y + nrm.y * o, '#ffc97a', 0.7); }
    // --- Turning Torso (190 m, 9 twisting cubes)
    const tt = lp(...LANDMARKS.turningTorso);
    for (let i = 0; i < 9; i++) {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(24, 19.5, 24), M.white);
      cube.position.set(tt.x, 11 + i * 20.3, tt.y); cube.rotation.y = i * (Math.PI / 2) / 8; this.scene.add(cube);
    }
    this.lights.add(tt.x, 192, tt.y, '#ff2a1a', 0.5, 3);
    // --- wind farms
    const turbines = [];
    const md = LANDMARKS.middelgrunden;
    for (let i = 0; i < md.n; i++) { const t = i / (md.n - 1); const la = lerp(md.a[0], md.b[0], t), lo = lerp(md.a[1], md.b[1], t) + Math.sin(t * Math.PI) * md.bulge; turbines.push({ p: lp(la, lo), hub: 64, rotor: 38 }); }
    const lg = LANDMARKS.lillgrund;
    for (let i = 0; i < lg.rows; i++) for (let j = 0; j < lg.cols; j++) turbines.push({ p: lp(lg.c[0] + (i - lg.rows / 2) * lg.spacing * 0.75, lg.c[1] + (j - lg.cols / 2) * lg.spacing * 1.6 + i * 0.001), hub: 68.5, rotor: 46.5 });
    const towerG = new THREE.CylinderGeometry(1.6, 2.4, 1, 10); towerG.translate(0, 0.5, 0);
    const towers = new THREE.InstancedMesh(towerG, M.white, turbines.length);
    const bladeG = new THREE.BoxGeometry(1.4, 1, 0.3); bladeG.translate(0, 0.5, 0);
    const rotorG = mergeGeometries([0, 1, 2].map((k) => bladeG.clone().rotateZ(k * Math.PI * 2 / 3).toNonIndexed()));
    this.rotors = new THREE.InstancedMesh(rotorG, M.white, turbines.length);
    turbines.forEach((t, i) => {
      m4.makeScale(1, t.hub, 1).setPosition(t.p.x, 0, t.p.y); towers.setMatrixAt(i, m4);
      this.lights.add(t.p.x, t.hub + 3, t.p.y, '#ff2a1a', i * 0.013, 3);
    });
    this.turbines = turbines;
    this.scene.add(towers, this.rotors); towers.frustumCulled = this.rotors.frustumCulled = false;
    // --- ships in the sound
    const shipG = mergeGeometries([colorize(new THREE.BoxGeometry(22, 8, 150), '#2d3440').toNonIndexed(), colorize(new THREE.BoxGeometry(18, 10, 30).translate(0, 9, 50), '#e9e9e9').toNonIndexed()]);
    const ships = [[55.67, 12.73, 20], [55.55, 12.85, 200], [55.72, 12.78, 350], [55.62, 12.83, 10]];
    for (const [la, lo, h] of ships) { const s = new THREE.Mesh(shipG, M.vehicle); const p = lp(la, lo); s.position.set(p.x, 2, p.y); s.rotation.y = -h * DEG; this.scene.add(s); }
    // --- city blocks (Copenhagen, Malmö) near the approach
    this._city(lp(...LANDMARKS.copenhagen), 6500, this.quality === 'low' ? 900 : 2200, 1);
    this._city(lp(...LANDMARKS.malmo), 5000, this.quality === 'low' ? 600 : 1500, 2);
    this._city(lp(59.33, 18.06), 9000, this.quality === 'low' ? 800 : 2000, 3);
  }

  _city(c, radius, n, seed) {
    const r = rng(seed * 991);
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const uv = g.attributes.uv;
    const im = new THREE.InstancedMesh(g, this.mats.office, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * radius;
      const x = c.x + Math.cos(a) * d, z = c.y + Math.sin(a) * d;
      const lt = this.world.geo.landData; const N = this.world.geo.N;
      const ix = Math.floor((x - REGION.x0) / (REGION.x1 - REGION.x0) * N), iz = Math.floor((z - REGION.z0) / (REGION.z1 - REGION.z0) * N);
      if (ix < 0 || iz < 0 || ix >= N || iz >= N || lt[(iz * N + ix) * 2] < 160) continue;
      const hgt = (8 + r() * 18) * (1 + 1.5 * Math.max(0, 1 - d / radius) ** 2);
      s.set(15 + r() * 30, hgt, 15 + r() * 40); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.floor(r() * 4) * Math.PI) / 2 + 0.4);
      p.set(x, 0, z); m.compose(p, q, s); im.setMatrixAt(k, m);
      col.setHSL(0.08, 0.1 + r() * 0.1, 0.55 + r() * 0.35); im.setColorAt(k, col); k++;
    }
    im.count = k; im.frustumCulled = false; this.scene.add(im);
  }

  _traffic() {
    // high-altitude opposite-direction traffic with contrail
    const t = makeAirliner(LIVERIES.finnair, { len: 44.5 });
    t.scale.setScalar(1); this.scene.add(t); t.visible = false;
    const trailG = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); trailG.rotateX(Math.PI / 2); trailG.translate(0, 0, 0.5);
    const trailM = curveMaterial(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }));
    const trails = [new THREE.Mesh(trailG, trailM), new THREE.Mesh(trailG, trailM)];
    trails.forEach((m) => { this.scene.add(m); m.visible = false; });
    this.traffic.push({ obj: t, kind: 'cruise-crossing', trails });
  }

  update(dt, simT, fm, env, director) {
    const u = this.u;
    this.sun.position.copy(env.sunDir).multiplyScalar(1000).add(fm.pos); this.sun.target.position.copy(fm.pos);
    this.sun.color.copy(env.sunCol).multiplyScalar(1 / 3.2); this.sun.intensity = 3.0;
    this.hemi.color.copy(env.zenith).lerp(env.horizon, 0.5); this.hemi.intensity = 1.6;
    this.hemi.groundColor.setRGB(0.18, 0.2, 0.14).multiplyScalar(env.day + 0.05);
    const lm = this.lightPoints.material.uniforms;
    lm.uNightVis.value = lerp(0.035, 1.0, smoothstep(0.1, 0.9, env.nightK + (env.belowOvercast ? 0.25 : 0)));
    lm.uPx.value = this.pixelRatio || 1;
    // turbine rotors
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    if (this.turbines && Math.hypot(fm.pos.x - this.turbines[0].p.x, fm.pos.z - this.turbines[0].p.y) < 60000) {
      this.turbines.forEach((t, i) => {
        e.set(0, 0.6, simT * 1.6 + i * 0.7); q.setFromEuler(e);
        m4.compose(new THREE.Vector3(t.p.x, t.hub, t.p.y), q, new THREE.Vector3(1.2, t.rotor, 1));
        this.rotors.setMatrixAt(i, m4);
      });
      this.rotors.instanceMatrix.needsUpdate = true;
    }
    // pushback tug drives away at the start
    if (this.tug) {
      const k = clamp((simT - 8) / 60, 0, 1);
      const p = this.tug.start.clone().addScaledVector(this.tug.dir, k * 160);
      this.tug.mesh.position.set(p.x, 0.8, p.y);
    }
    for (const tr of this.traffic) this._updateTraffic(tr, simT, fm, director);
    // apron vehicles and walking ground crew
    for (const a of this.animated) {
      const T = simT - a.start; if (T < 0) continue;
      const cycle = a.len / a.speed + a.dwell;
      let t = a.loop ? T % (2 * cycle) : Math.min(T, a.len / a.speed);
      let k, back = false;
      if (a.loop) { if (t < cycle) k = clamp(t / (a.len / a.speed), 0, 1); else { k = 1 - clamp((t - cycle) / (a.len / a.speed), 0, 1); back = true; } } else k = clamp(t / (a.len / a.speed), 0, 1);
      a.m.position.set(a.a.x + (a.b.x - a.a.x) * k, 0, a.a.y + (a.b.y - a.a.y) * k);
      a.m.rotation.y = -(a.hdg + (back ? 180 : 0)) * DEG;
    }
    // Kastrup: the marshaller guides us in, then the loaders arrive at the forward hold
    if (this.cphCrew) {
      const parkedT = director?.times?.parked;
      const c = this.cphCrew;
      c.marshaller.visible = fm.phase === 'taxi-in' || (parkedT != null && simT - parkedT < 25);
      const show = parkedT != null && simT - parkedT > 30;
      for (const o of [c.belt, c.tractor, ...c.carts, c.loader1, c.loader2]) o.visible = show;
      if (show) { const k = clamp((simT - parkedT - 30) / 45, 0, 1); const f = CPH.frame; const p = f.to(CPH_LAYOUT.standU + 60 - 40 * (1 - k), CPH_LAYOUT.standV + 40 + 60 * (1 - k)); c.belt.position.set(p.x, 0, p.y); }
    }
  }

  _updateTraffic(tr, simT, fm, director) {
    const o = tr.obj;
    if (tr.kind === 'arn-departure') {
      const t0 = director?.times?.arnTrafficRoll; // departure roll start (sim seconds)
      if (t0 == null) { // waiting on the runway (lined up)
        const p = ARN.frame.to(40, 0); o.visible = fm.phase === 'taxi-out' || fm.phase === 'hold'; o.position.set(p.x, 0, p.y); o.rotation.set(0, -ARN.frame.heading * DEG, 0); return;
      }
      const t = simT - t0; if (t > 150) { o.visible = false; return; }
      o.visible = true;
      const s = 0.5 * 2.0 * Math.min(t, 36) ** 2 + (t > 36 ? 72 * (t - 36) : 0);
      const p = ARN.frame.to(40 + s, 0);
      const air = Math.max(0, s - 1500);
      const h = air > 0 ? Math.min(air * 0.14, 2000) : 0;
      o.position.set(p.x, h, p.y); o.rotation.set(0, -ARN.frame.heading * DEG, 0);
      o.rotateX(air > 0 ? Math.min(0.26, air / 700) : 0);
    } else if (tr.kind === 'arn-arrival') {
      // lands on 19L around the time we taxi north
      const t = simT - 150; if (t < -60 || t > 60) { o.visible = false; return; }
      o.visible = true; const rw = tr.rw;
      const thr = rw.b, dir = rw.a.clone().sub(rw.b).normalize();
      const v = t < 0 ? 72 : Math.max(15, 72 - t * 2.2);
      const s = t < 0 ? t * 72 : 72 * t - 1.1 * t * t;
      const p = thr.clone().addScaledVector(dir, s + 350);
      const h = t < 0 ? -s * Math.tan(3 * DEG) : 0;
      o.position.set(p.x, h, p.y); o.rotation.set(0, -Math.atan2(dir.x, -dir.y), 0); o.rotateX(t < 0 ? 0.04 : 0);
    } else if (tr.kind === 'cph-departure') {
      const t0 = director?.times?.cphTraffic; if (t0 == null) { o.visible = false; return; }
      const t = simT - t0; if (t < 0 || t > 110) { o.visible = false; return; }
      o.visible = true; const rw = tr.rw; const dir = rw.a.clone().sub(rw.b).normalize();
      const s = t * t * 1.0; const p = rw.b.clone().addScaledVector(dir, 100 + s);
      const air = Math.max(0, s - 1600); const h = Math.min(air * 0.13, 1500);
      o.position.set(p.x, h, p.y); o.rotation.set(0, -Math.atan2(dir.x, -dir.y), 0); o.rotateX(air > 0 ? 0.25 : 0);
    } else if (tr.kind === 'cruise-crossing') {
      const t0 = director?.times?.crossing; if (t0 == null) { o.visible = false; tr.trails.forEach((m) => (m.visible = false)); return; }
      const t = simT - t0; if (t < -40 || t > 60) { o.visible = false; tr.trails.forEach((m) => (m.visible = false)); return; }
      // passes on the left, 1000 ft above, opposite direction
      const hd = fm.heading;
      const fwd = V2(Math.sin(hd), -Math.cos(hd)), left = V2(-fwd.y, fwd.x).negate();
      const rel = 230 + 230; // closing speed m/s
      const along = -t * rel;
      const p = V2(fm.pos.x, fm.pos.z).addScaledVector(fwd, along).addScaledVector(left, 1800);
      o.visible = true; o.position.set(p.x, fm.pos.y + 305 - 3.4, p.y); o.rotation.set(0, -hd + Math.PI, 0);
      tr.trails.forEach((m, i) => {
        m.visible = true;
        const off = (i ? 1 : -1) * 5.8;
        const side = V2(-Math.cos(hd + Math.PI), -Math.sin(hd + Math.PI));
        m.position.set(p.x + fwd.x * 20 + side.x * off, fm.pos.y + 305 - 1.5, p.y + fwd.y * 20 + side.y * off);
        m.rotation.set(0, -hd, 0);
        m.scale.set(2.2, 2.2, 2500);
      });
    }
  }
}
