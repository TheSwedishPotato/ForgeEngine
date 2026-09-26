// Passengers and cabin crew: placement, behaviours, walking, gestures, service.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Human, randomAppearance, crewAppearance, POSES, composePose, walkPose, makeProp, HUMAN_MATS } from './humans.js';
import { rowZ, ROWS, LETTERS, SEAT_X, BUSINESS_ROWS, CAB, DOORS } from './cabin.js';
import { rng, clamp, lerp, damp, dampAngle, smooth } from './core.js';
import { colorize, mergeColored, trs } from './geom.js';

const D = Math.PI / 180;
const AISLE_X = 0;

// ---------------- gesture keyframes (safety demonstration etc.) ----------------
const ARMS_DOWN = { lShoulder: [0.05, 0, -0.07], rShoulder: [0.05, 0, 0.07], lElbow: [-0.15, 0, 0], rElbow: [-0.15, 0, 0] };
export const GESTURES = {
  present: [[0, ARMS_DOWN], [0.6, { lShoulder: [-0.35, 0, -0.35], rShoulder: [-0.35, 0, 0.35], lElbow: [-0.5, 0, 0], rElbow: [-0.5, 0, 0] }], [2.2, { lShoulder: [-0.35, 0, -0.35], rShoulder: [-0.35, 0, 0.35], lElbow: [-0.5, 0, 0], rElbow: [-0.5, 0, 0] }], [3, ARMS_DOWN]],
  belt: [[0, ARMS_DOWN, { l: 'beltL', r: 'beltR' }],
    [0.8, { lShoulder: [-0.55, 0, -0.1], rShoulder: [-0.55, 0, 0.1], lElbow: [-0.9, 0.6, 0], rElbow: [-0.9, -0.6, 0] }],
    [2.5, { lShoulder: [-0.6, 0, 0.02], rShoulder: [-0.6, 0, -0.02], lElbow: [-1.2, 0.9, 0], rElbow: [-1.2, -0.9, 0] }],
    [3.5, { lShoulder: [-0.55, 0, -0.1], rShoulder: [-0.55, 0, 0.1], lElbow: [-0.9, 0.6, 0], rElbow: [-0.9, -0.6, 0] }],
    [5, { lShoulder: [-0.6, 0, 0.02], rShoulder: [-0.6, 0, -0.02], lElbow: [-1.2, 0.9, 0], rElbow: [-1.2, -0.9, 0] }],
    [6.5, { lShoulder: [-0.5, 0, -0.2], rShoulder: [-0.7, 0, 0.1], lElbow: [-1.1, 0.8, 0], rElbow: [-1.5, -0.4, 0] }],
    [9, ARMS_DOWN, { l: null, r: null }]],
  exits: [[0, ARMS_DOWN], [0.8, { lShoulder: [-1.5, 0, 0.12], rShoulder: [-1.5, 0, -0.12], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }, { turn: Math.PI }],
    [3.2, { lShoulder: [-1.5, 0, 0.12], rShoulder: [-1.5, 0, -0.12], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }, { turn: 0 }],
    [4.4, { lShoulder: [-0.05, 0, -1.5], rShoulder: [-0.05, 0, 1.5], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }],
    [7.0, { lShoulder: [-0.05, 0, -1.5], rShoulder: [-0.05, 0, 1.5], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }],
    [8.2, { lShoulder: [-1.5, 0, 0.12], rShoulder: [-1.5, 0, -0.12], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }],
    [10.5, { lShoulder: [-1.5, 0, 0.12], rShoulder: [-1.5, 0, -0.12], lElbow: [-0.05, 0, 0], rElbow: [-0.05, 0, 0] }], [11.5, ARMS_DOWN]],
  floor: [[0, ARMS_DOWN], [0.8, { lShoulder: [-0.7, 0, -0.2], rShoulder: [-0.7, 0, 0.2], lElbow: [-0.1, 0, 0], rElbow: [-0.1, 0, 0], spine: [0.25, 0, 0] }], [3.5, { lShoulder: [-0.75, 0, -0.3], rShoulder: [-0.75, 0, 0.3], spine: [0.25, 0, 0] }], [4.5, Object.assign({ spine: [0, 0, 0] }, ARMS_DOWN)]],
  mask: [[0, ARMS_DOWN, { r: 'mask' }], [1, { rShoulder: [-2.6, 0, 0.1], rElbow: [-0.2, 0, 0] }], [2.4, { rShoulder: [-2.6, 0, 0.1], rElbow: [-0.2, 0, 0] }],
    [3.6, { rShoulder: [-1.2, 0.3, 0.3], rElbow: [-2.1, -0.4, 0] }], [5, { rShoulder: [-1.2, 0.3, 0.3], rElbow: [-2.1, -0.4, 0], lShoulder: [-2.2, 0, -0.5], lElbow: [-1.3, 0, 0] }],
    [6.6, { rShoulder: [-1.2, 0.3, 0.3], rElbow: [-2.1, -0.4, 0], lShoulder: [-0.3, 0, -0.1], lElbow: [-0.4, 0, 0] }], [9, { rShoulder: [-1.2, 0.3, 0.3], rElbow: [-2.1, -0.4, 0] }], [10.5, ARMS_DOWN, { r: null }]],
  vest: [[0, ARMS_DOWN, { r: 'vest' }], [1, { rShoulder: [-1.0, 0, 0.1], rElbow: [-0.7, 0, 0], lShoulder: [-1.0, 0, -0.1], lElbow: [-0.7, 0, 0] }],
    [2.4, { rShoulder: [-2.7, 0, 0.3], rElbow: [-0.6, 0, 0], lShoulder: [-2.7, 0, -0.3], lElbow: [-0.6, 0, 0] }, { vestOn: true, r: null }],
    [3.6, { rShoulder: [-0.4, 0, 0.3], rElbow: [-1.3, -0.5, 0], lShoulder: [-0.4, 0, -0.3], lElbow: [-1.3, 0.5, 0] }],
    [6, { rShoulder: [-0.3, 0, 0.1], rElbow: [-1.5, -0.8, 0], lShoulder: [-0.3, 0, -0.1], lElbow: [-1.5, 0.8, 0] }],
    [7.5, { rShoulder: [-0.2, 0, 0.3], rElbow: [-0.3, 0, 0], lShoulder: [-0.2, 0, -0.3], lElbow: [-0.3, 0, 0] }],
    [9.5, { rShoulder: [-1.1, 0.4, 0.2], rElbow: [-2.0, -0.3, 0], lShoulder: [-0.2, 0, -0.1] }], [12, { rShoulder: [-1.1, 0.4, 0.2], rElbow: [-2.0, -0.3, 0] }], [14, ARMS_DOWN, { vestOn: false }]],
  card: [[0, ARMS_DOWN, { r: 'card' }], [1, { rShoulder: [-1.4, 0, 0.1], rElbow: [-0.9, 0, 0] }], [4, { rShoulder: [-1.4, 0, 0.1], rElbow: [-0.9, 0, 0] }], [5, ARMS_DOWN, { r: null }]],
  wave: [[0, ARMS_DOWN], [0.5, { rShoulder: [-2.4, 0, 0.4], rElbow: [-0.5, 0, 0] }], [1.0, { rShoulder: [-2.4, 0, 0.6], rElbow: [-0.8, 0, 0] }], [1.5, { rShoulder: [-2.4, 0, 0.4], rElbow: [-0.5, 0, 0] }], [2.2, ARMS_DOWN]],
  offer: [[0, ARMS_DOWN], [0.6, { rShoulder: [-1.1, 0.2, 0.3], rElbow: [-0.6, 0, 0] }], [2.5, { rShoulder: [-1.1, 0.2, 0.3], rElbow: [-0.6, 0, 0] }], [3.2, ARMS_DOWN]],
  pour: [[0, ARMS_DOWN], [0.5, { rShoulder: [-0.9, 0, 0.15], rElbow: [-0.9, 0, 0], lShoulder: [-0.7, 0, -0.1], lElbow: [-0.9, 0, 0] }], [2.5, { rShoulder: [-0.9, 0, 0.15], rElbow: [-0.9, -0.4, 0.5], lShoulder: [-0.7, 0, -0.1], lElbow: [-0.9, 0, 0] }], [3.2, ARMS_DOWN]],
  handset: [[0, ARMS_DOWN], [0.6, { rShoulder: [-0.9, 0.4, 0.4], rElbow: [-2.2, -0.2, 0] }], [100, { rShoulder: [-0.9, 0.4, 0.4], rElbow: [-2.2, -0.2, 0] }]],
};

function sampleGesture(g, t) {
  let a = g[0], b = g[g.length - 1];
  for (let i = 0; i < g.length - 1; i++) if (t >= g[i][0] && t <= g[i + 1][0]) { a = g[i]; b = g[i + 1]; break; }
  if (t >= g[g.length - 1][0]) { a = b = g[g.length - 1]; }
  const k = a === b ? 1 : smooth((t - a[0]) / (b[0] - a[0]));
  const out = {};
  const keys = new Set([...Object.keys(a[1]), ...Object.keys(b[1])]);
  for (const key of keys) {
    const va = a[1][key] || b[1][key], vb = b[1][key] || a[1][key];
    out[key] = [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k), lerp(va[2], vb[2], k)];
  }
  return out;
}

// ---------------- Actor (articulated, can walk) ----------------
export class Actor {
  constructor(app, scene, { name = '', crew = false, hiFace = false } = {}) {
    this.h = new Human(app, { detail: hiFace ? 2 : 1 });
    this.app = app; this.name = name; this.crew = crew;
    this.root = this.h.root; scene.add(this.root);
    this.x = 0; this.z = 0; this.heading = Math.PI; // facing -z (forward)
    this.targetHeading = Math.PI;
    this.tasks = []; this.task = null;
    this.walkPhase = 0; this.speed = 0;
    this.base = POSES.stand; this.gesture = null; this.gT = 0;
    this.headYaw = 0; this.headPitch = 0; this.headTarget = null;
    this.props = { l: null, r: null };
    this.seated = false; this.seatY = 0;
    this.say = null; this.sayT = 0;
    this.vest = null;
    this.h.setPose(POSES.stand);
  }
  place(x, z, heading) { this.x = x; this.z = z; if (heading !== undefined) this.heading = this.targetHeading = heading; this._apply(); }
  queue(...tasks) { this.tasks.push(...tasks); return this; }
  clear() { this.tasks = []; this.task = null; }
  busy() { return !!this.task || this.tasks.length > 0; }
  setProp(hand, kind) {
    const slot = hand === 'l' ? this.h.lHandItem : this.h.rHandItem;
    if (this.props[hand]) { slot.remove(this.props[hand]); this.props[hand] = null; }
    if (kind) {
      const k = kind.startsWith('belt') ? 'belt' : kind; const m = makeProp(k);
      if (k === 'belt') { m.scale.set(0.5, 1, 1); m.position.x = hand === 'l' ? 0.1 : -0.1; m.rotation.x = Math.PI / 2; }
      if (k === 'mask') { m.rotation.x = Math.PI; m.position.set(0, -0.02, 0.04); }
      if (k === 'vest') { m.position.set(0, -0.1, 0.1); }
      if (k === 'card') { m.rotation.x = -0.3; m.position.set(0, -0.12, 0.05); }
      if (k === 'terminal') { m.position.set(0, -0.06, 0.04); }
      if (k === 'bag') { m.position.set(0, -0.3, 0.05); }
      slot.add(m); this.props[hand] = m;
    }
  }
  setVest(on) {
    if (on && !this.vest) { this.vest = makeProp('vest'); this.vest.scale.set(1.15, 1.05, 2.5); this.vest.position.set(0, 0.14 * this.h.s, 0.02); this.h.j.chest.add(this.vest); }
    if (!on && this.vest) { this.h.j.chest.remove(this.vest); this.vest = null; }
  }
  playGesture(name) { this.gesture = GESTURES[name]; this.gName = name; this.gT = 0; this._gFlags = {}; }
  speak(text, secs = 3) { this.say = text; this.sayT = secs; }

  _apply() {
    this.root.position.set(this.x, this.seated ? this.seatY : 0, this.z);
    this.root.rotation.y = this.heading;
  }

  update(dt, world) {
    // run tasks
    if (!this.task && this.tasks.length) { this.task = this.tasks.shift(); this.task.t = 0; if (this.task.start) this.task.start(this); }
    let moving = false;
    if (this.task) {
      const T = this.task; T.t += dt;
      let done = false;
      if (T.type === 'walk') {
        const tx = T.x ?? this.x, tz = T.z;
        const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
        const spd = T.speed || 0.9;
        let block = world && world.blocked ? world.blocked(this, tz) : false;
        if (d < 0.04) done = true;
        else if (!block) {
          const step = Math.min(d, spd * dt);
          this.x += dx / d * step; this.z += dz / d * step; moving = true;
          this.targetHeading = Math.atan2(dx, dz);
        }
      } else if (T.type === 'wait') { if (T.t >= T.dur) done = true; }
      else if (T.type === 'face') { this.targetHeading = T.h; if (T.t > 0.6) done = true; }
      else if (T.type === 'gesture') { if (T.t === dt) this.playGesture(T.name); if (T.t >= (T.dur ?? GESTURES[T.name][GESTURES[T.name].length - 1][0])) done = true; }
      else if (T.type === 'call') { T.fn(this); done = true; }
      else if (T.type === 'until') { if (T.cond(this)) done = true; }
      else if (T.type === 'sit') {
        this.seated = true; this.seatY = T.y ?? 0; this.x = T.x; this.z = T.z; this.targetHeading = T.h; this.heading = T.h;
        this.base = T.pose || composePose(POSES.stand, POSES.sit, POSES.jump); done = true;
      } else if (T.type === 'stand') { this.seated = false; this.base = POSES.stand; done = true; }
      if (done) { if (T.end) T.end(this); this.task = null; }
    }
    this.heading = dampAngle(this.heading, this.targetHeading, 8, dt);
    this.speed = damp(this.speed, moving ? 1 : 0, 8, dt);
    // pose composition
    let pose = this.base;
    if (this.speed > 0.05 && !this.seated) {
      this.walkPhase += dt * 7.5 * this.speed;
      pose = composePose(POSES.stand, walkPose(this.walkPhase, this.speed, !!this.carrying));
      if (world && world.audio && Math.floor(this.walkPhase / Math.PI) !== Math.floor((this.walkPhase - dt * 7.5 * this.speed) / Math.PI) && world.near(this, 6)) world.audio.footstep();
    }
    if (this.carrying) pose = composePose(pose, { lShoulder: [-0.7, 0, -0.1], rShoulder: [-0.7, 0, 0.1], lElbow: [-0.8, 0, 0], rElbow: [-0.8, 0, 0] });
    if (this.gesture) {
      this.gT += dt;
      const g = sampleGesture(this.gesture, this.gT);
      pose = composePose(pose, g);
      // props & flags keyed on frames
      for (const kf of this.gesture) {
        if (kf[2] && this.gT >= kf[0] && !this._gFlags[kf[0]]) {
          this._gFlags[kf[0]] = true;
          const f = kf[2];
          if ('l' in f) this.setProp('l', f.l); if ('r' in f) this.setProp('r', f.r);
          if ('vestOn' in f) this.setVest(f.vestOn);
          if ('turn' in f) this.turnOffset = f.turn;
        }
      }
      if (this.gT > this.gesture[this.gesture.length - 1][0] && this.gName !== 'handset') { this.gesture = null; this.turnOffset = 0; }
    }
    this.h.blendPose(pose, Math.min(1, dt * 9));
    // head look
    if (this.headTarget) {
      const hp = this.headTarget;
      const wx = hp.x - this.x, wz = hp.z - this.z;
      let yaw = Math.atan2(wx, wz) - this.heading; yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      const dy = (hp.y ?? 1.2) - 1.55 * this.h.s; const pitch = -Math.atan2(dy, Math.hypot(wx, wz));
      this.headYaw = damp(this.headYaw, clamp(yaw, -1.1, 1.1), 6, dt); this.headPitch = damp(this.headPitch, clamp(pitch, -0.6, 0.5), 6, dt);
    } else { this.headYaw = damp(this.headYaw, 0, 4, dt); this.headPitch = damp(this.headPitch, 0, 4, dt); }
    this.h.j.neck.rotation.y += this.headYaw * 0.4; this.h.j.head.rotation.y = this.headYaw * 0.6; this.h.j.head.rotation.x += this.headPitch;
    const turnOff = this.turnOffset || 0;
    this.root.position.set(this.x, this.seated ? this.seatY : 0, this.z);
    this.root.rotation.y = this.heading + turnOff;
    if (this.sayT > 0) { this.sayT -= dt; if (this.sayT <= 0) this.say = null; }
  }
}

// ---------------- trolley ----------------
function makeCart() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(mergeColored([
    { geo: new RoundedBoxGeometry(0.3, 1.0, 0.8, 2, 0.02), color: '#c9ccd1', matrix: trs(0, 0.55, 0) },
    { geo: new THREE.BoxGeometry(0.302, 0.03, 0.6), color: '#1f3a86', matrix: trs(0, 0.95, 0) },
    { geo: new THREE.BoxGeometry(0.31, 0.02, 0.1), color: '#8b9098', matrix: trs(0, 0.8, 0.4) },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), color: '#222', matrix: trs(0.1, 0.03, 0.3, 0, 0, Math.PI / 2) },
    { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), color: '#222', matrix: trs(-0.1, 0.03, -0.3, 0, 0, Math.PI / 2) },
    // top: coffee pots, cups, drawer boxes
    { geo: new THREE.CylinderGeometry(0.06, 0.07, 0.22, 12), color: '#dfe2e6', matrix: trs(0.05, 1.16, -0.25) },
    { geo: new THREE.CylinderGeometry(0.06, 0.07, 0.22, 12), color: '#2b2f37', matrix: trs(0.05, 1.16, -0.1) },
    { geo: new THREE.BoxGeometry(0.22, 0.12, 0.25), color: '#f2f2f0', matrix: trs(0, 1.11, 0.15) },
    { geo: new THREE.CylinderGeometry(0.035, 0.03, 0.2, 8), color: '#f5f5f3', matrix: trs(-0.08, 1.15, 0.3) },
    { geo: new THREE.BoxGeometry(0.1, 0.18, 0.06), color: '#e1b24a', matrix: trs(0.08, 1.14, 0.33) },
  ]), HUMAN_MATS.body);
  body.castShadow = true; g.add(body);
  return g;
}

const MENU = [
  { id: 'coffee', name: 'Coffee', price: 0 }, { id: 'tea', name: 'Tea', price: 0 }, { id: 'water', name: 'Still water', price: 0 },
];

// ---------------- People manager ----------------
export class People {
  constructor(cabin, scene, { load = 0.85, seed = 5, playerSeat, audio, quality = 'medium' }) {
    this.cabin = cabin; this.scene = scene; this.audio = audio;
    this.r = rng(seed);
    this.playerSeat = playerSeat;
    this.pax = []; this.walkers = []; this.crew = [];
    this.bubbles = []; // {actor/pos, text}
    this.trayGeo = mergeColored([{ geo: new THREE.BoxGeometry(0.4, 0.015, 0.25), color: '#d6d8db' }]);
    this.cupGeo = mergeColored([{ geo: new THREE.CylinderGeometry(0.035, 0.027, 0.085, 10), color: '#f4f4f2', matrix: trs(0, 0.043, 0) }]);
    this.trays = new THREE.InstancedMesh(this.trayGeo, HUMAN_MATS.body, 190); this.trays.count = 0; this.trays.castShadow = true; scene.add(this.trays);
    this.cups = new THREE.InstancedMesh(this.cupGeo, HUMAN_MATS.body, 190); this.cups.count = 0; scene.add(this.cups);
    this._placePassengers(load, quality);
    this._placeNeighbor();
    this._makeCrew();
    this.carts = [];
    this.serviceLog = [];
    this.t = 0;
  }

  // Seat NPC placement (baked static bodies + animated heads)
  _placePassengers(load, quality) {
    const r = this.r;
    const ps = this.cabin.seat(this.playerSeat);
    this.neighborSeat = this._neighborSeatId(ps);
    for (const s of this.cabin.seats) {
      if (s.blocked || s.id === this.playerSeat) continue;
      if (s.id === this.neighborSeat) continue;
      const pLoad = s.business ? 0.75 : s.letter === 'B' || s.letter === 'E' ? load * 0.85 : load;
      if (r() > pLoad) continue;
      this._seatPassenger(s, randomAppearance(r));
    }
    this.cabin.refreshEmptyBelts(ps);
  }

  _neighborSeatId(ps) {
    const L = ps.letter;
    const nb = { A: 'B', B: 'A', C: 'B', D: 'E', E: 'F', F: 'E' }[L];
    let id = `${ps.row}${nb}`;
    if (ps.business && (nb === 'B' || nb === 'E')) id = `${ps.row}${L === 'A' ? 'C' : L === 'C' ? 'A' : L === 'D' ? 'F' : 'D'}`;
    return id;
  }

  _seatPassenger(s, app) {
    const h = new Human(app, { detail: 0.4 });
    const r = this.r;
    const act = r.pick(['idle', 'idle', 'phone', 'phone', 'read', 'sleep', 'window', 'laptop', 'arms']);
    const extra = act === 'phone' ? POSES.sitPhone : act === 'read' ? POSES.sitRead : act === 'sleep' ? POSES.sitSleep : act === 'laptop' ? POSES.sitLaptop : act === 'arms' ? POSES.sitArmsCrossed : {};
    h.setPose(composePose(POSES.stand, POSES.sit, extra));
    if (act === 'phone') { const p = makeProp('phone'); h.rHandItem.add(p); h.parts.push({ joint: h.j.rWrist, geo: colorize(new RoundedBoxGeometry(0.075, 0.155, 0.009, 2, 0.006).translate(0, -0.08, 0.03), '#1b1c20'), bucket: 'body' }); }
    if (act === 'read') h.parts.push({ joint: h.j.rWrist, geo: colorize(new THREE.BoxGeometry(0.15, 0.21, 0.03).translate(-0.06, -0.09, 0.05), r.pick(['#7a3b2e', '#2c4a6b', '#e8e4d8', '#3b5d3a'])), bucket: 'body' });
    // lap belt
    h.parts.push({ joint: h.j.pelvis, geo: colorize(new THREE.BoxGeometry(0.34, 0.045, 0.03).translate(0, -0.07, 0.13), '#2b2f37'), bucket: 'body' });
    const b = h.bakeStatic();
    const g = new THREE.Group(); g.add(b.body, b.head);
    const y = 0.455 - 0.84 * h.s;
    g.position.set(s.x, y, s.z + 0.1); g.rotation.y = Math.PI;
    this.scene.add(g);
    const p = { seat: s, app, group: g, head: b.head, act, lookT: r() * 5, look: null, yaw: 0, pitch: 0, sleep: act === 'sleep', tray: null, cup: null, served: false, choice: null, away: false, s: h.s };
    if (act === 'laptop') p.tray = true;
    s.occupant = p;
    this.pax.push(p);
    if (act === 'window' && (s.letter === 'A' || s.letter === 'F')) p.look = 'window';
    return p;
  }

  _placeNeighbor() {
    const s = this.cabin.seat(this.neighborSeat);
    if (!s) return;
    const r = this.r;
    const persona = r.pick(['erik', 'maja', 'linnea', 'jonas', 'ingrid', 'david', 'sofia', 'anders']);
    const P = NEIGHBOURS[persona];
    const app = randomAppearance(r, P.app);
    const a = new Actor(app, this.scene, { name: P.name, hiFace: true });
    a.seated = true; a.base = composePose(POSES.stand, POSES.sit);
    a.seatY = 0.455 - 0.84 * a.h.s; a.x = s.x; a.z = s.z + 0.1; a.heading = a.targetHeading = Math.PI;
    const belt = new THREE.Mesh(colorize(new THREE.BoxGeometry(0.34, 0.045, 0.03), '#2b2f37'), HUMAN_MATS.body); belt.position.set(0, -0.07, 0.13); a.h.j.pelvis.add(belt);
    this.neighbor = { actor: a, seat: s, persona, P };
    s.occupant = { neighbor: true, seat: s };
  }

  _makeCrew() {
    const r = this.r;
    const specs = [
      { name: 'Karin', female: true, role: 'purser' },
      { name: 'Mikkel', female: false, role: 'fwd' },
      { name: 'Sanna', female: true, role: 'mid' },
      { name: 'Amir', female: false, role: 'aft' },
    ];
    for (const sp of specs) {
      const app = crewAppearance(r, sp);
      const a = new Actor(app, this.scene, { name: sp.name, crew: true, hiFace: true });
      a.role = sp.role;
      this.crew.push(a);
    }
    const [A, B, C, Dd] = this.crew;
    // initial positions: doors closed & armed, crew doing final checks before the demo
    A.place(0.35, -2.9, 0); B.place(0, 0.6, 0);
    C.place(0, rowZ(9), 0); Dd.place(0, rowZ(24), 0);
    this.byRole = { purser: A, fwd: B, mid: C, aft: Dd };
  }

  crewNamed(role) { return this.byRole[role]; }

  // The neighbour steps into the aisle so the player can get out, then sits back down.
  neighborLetOut(player, now) {
    const n = this.neighbor; if (!n) return;
    const a = n.actor, s = n.seat, t0 = now();
    const sitPose = composePose(POSES.stand, POSES.sit);
    a.clear();
    a.queue({ type: 'stand' }, { type: 'walk', x: 0.12 * Math.sign(s.x), z: s.z - 0.3, speed: 0.6 }, { type: 'walk', x: 0, z: s.z + 0.7, speed: 0.6 },
      { type: 'until', cond: () => (player.state === 'standing' && Math.abs(player.pos.z - s.z) > 1.3) || (player.state === 'seated' && now() - t0 > 25) },
      { type: 'walk', x: 0, z: s.z - 0.3, speed: 0.6 }, { type: 'walk', x: s.x, z: s.z - 0.1, speed: 0.5 },
      { type: 'sit', x: s.x, z: s.z + 0.1, h: Math.PI, y: 0.455 - 0.84 * a.h.s, pose: sitPose });
  }

  // ------------- scripted crew routines (called by the director) -------------
  safetyDemoPositions() {
    const { purser, fwd, mid, aft } = this.byRole;
    purser.clear(); purser.queue({ type: 'walk', x: 0.6, z: -2.75 }, { type: 'face', h: 0 }, { type: 'gesture', name: 'handset', dur: 0.1 });
    fwd.clear(); fwd.queue({ type: 'walk', x: 0, z: rowZ(1) - 0.55 }, { type: 'face', h: 0 });
    mid.clear(); mid.queue({ type: 'walk', x: 0, z: rowZ(12) - 0.3 }, { type: 'face', h: 0 });
    aft.clear(); aft.queue({ type: 'walk', x: 0, z: rowZ(24) - 0.3 }, { type: 'face', h: 0 });
  }
  demoGesture(name) { for (const c of [this.byRole.fwd, this.byRole.mid, this.byRole.aft]) c.queue({ type: 'gesture', name }); }
  endDemo() { const p = this.byRole.purser; p.gesture = null; }

  // Walk the cabin checking belts/tables/blinds; issues -> callback(actor, seat, issue)
  cabinCheck(checkFn, onDone) {
    const { purser, fwd, mid, aft } = this.byRole;
    const zones = [[fwd, -0.4, rowZ(10) + 0.5], [mid, rowZ(11) - 0.2, rowZ(21) + 0.4], [aft, rowZ(22) - 0.2, rowZ(31) + 0.5]];
    let remaining = zones.length;
    for (const [c, z0, z1] of zones) {
      c.clear();
      c.queue({ type: 'walk', z: z0, x: 0, speed: 1.0 }, { type: 'face', h: 0 });
      const rows = ROWS.filter((r) => rowZ(r) >= z0 - 0.1 && rowZ(r) <= z1);
      for (const row of rows) {
        c.queue({ type: 'walk', x: 0, z: rowZ(row) - 0.35, speed: 0.55 }, { type: 'call', fn: (a) => { a.headTarget = { x: -1.2, y: 0.9, z: rowZ(row) }; } }, { type: 'wait', dur: 0.35 },
          { type: 'call', fn: (a) => { a.headTarget = { x: 1.2, y: 0.9, z: rowZ(row) }; } }, { type: 'wait', dur: 0.35 },
          { type: 'until', cond: (a) => checkFn(a, row) }, { type: 'call', fn: (a) => { a.headTarget = null; } });
      }
      c.queue({ type: 'call', fn: () => { if (--remaining === 0 && onDone) onDone(); } });
    }
  }

  crewToJumpSeats(onSeated) {
    const js = this.cabin.jumpSeats;
    const { purser, fwd, mid, aft } = this.byRole;
    const plan = [[purser, js[0]], [fwd, js[1]], [mid, js[2]], [aft, js[3]]];
    let n = plan.length;
    for (const [c, s] of plan) {
      c.clear(); c.headTarget = null; c.gesture = null;
      const approachZ = s.face > 0 ? s.z - 0.5 : s.z + 0.5;
      c.queue({ type: 'walk', x: 0, z: approachZ, speed: 1.1 }, { type: 'walk', x: s.x, z: approachZ, speed: 0.7 },
        { type: 'sit', x: s.x, z: s.z, h: s.face > 0 ? Math.PI : 0, y: 0.47 - 0.84 * c.h.s + 0.02 },
        { type: 'call', fn: () => { if (--n === 0 && onSeated) onSeated(); } });
    }
  }
  crewStand() { for (const c of this.crew) { if (c.seated) { c.clear(); c.queue({ type: 'stand' }); } } }

  // Trolley service: two carts working towards the middle. serveFn(actor, seat) returns choice & duration.
  startService(serveFn, onDone) {
    const { purser, fwd, mid, aft } = this.byRole;
    const mkCartRun = (crew1, rows, fromZ, dir, galleyZ) => {
      const cart = makeCart(); this.scene.add(cart); cart.position.set(0, 0, fromZ);
      const run = { cart, crew: crew1, rows, i: 0, dir, state: 'toStart', t: 0, seatQ: [], cur: null };
      crew1.clear(); crew1.carrying = true;
      crew1.queue({ type: 'walk', x: 0, z: fromZ - dir * 0.75, speed: 1.0 });
      this.carts.push(run);
      return run;
    };
    // aft cart serves 31 -> 14, forward cart 5 -> 12; purser serves SAS Business rows 1-4
    const econFwd = ROWS.filter((r) => r > BUSINESS_ROWS && r <= 12);
    const econAft = ROWS.filter((r) => r >= 14).reverse();
    this.cartF = mkCartRun(fwd, econFwd, rowZ(BUSINESS_ROWS + 1) - 1.0, 1, -1.5);
    this.cartA = mkCartRun(aft, econAft, rowZ(31) + 0.9, -1, 25);
    mid.clear(); mid.queue({ type: 'walk', x: 0, z: rowZ(31) + 1.4, speed: 1.0 }, { type: 'face', h: Math.PI });
    this.cartA.helper = mid;
    purser.clear(); purser.queue({ type: 'walk', x: 0, z: rowZ(1) - 0.4 });
    this.businessRun = { crew: purser, rows: ROWS.filter((r) => r <= BUSINESS_ROWS), i: 0, t: 0 };
    this.serveFn = serveFn; this.serviceDone = onDone; this.audio?.cart(true);
  }

  _updateCart(run, dt) {
    if (run.finished) return;
    const c = run.crew, cart = run.cart;
    // cart sits in front of the crew member (towards the direction of travel)
    cart.position.x = 0;
    const cz = c.z + run.dir * 0.75;
    cart.position.z = damp(cart.position.z, cz, 10, dt);
    if (run.helper) { const h = run.helper; if (!h.task && Math.abs(h.z - (cart.position.z + run.dir * 0.75)) > 0.1) h.queue({ type: 'walk', x: 0, z: cart.position.z + run.dir * 0.75, speed: 0.8 }); h.targetHeading = run.dir > 0 ? Math.PI : 0; }
    if (c.busy()) return;
    if (run.i >= run.rows.length) {
      run.finished = true; c.carrying = false;
      c.queue({ type: 'call', fn: () => { this.scene.remove(cart); } }, { type: 'walk', x: 0, z: run.dir > 0 ? -1.5 : 24.5, speed: 1 });
      if (run.helper) run.helper.queue({ type: 'walk', x: 0, z: 24.5, speed: 1 });
      if (this.carts.every((r) => r.finished)) { this.audio?.cart(false); if (this.serviceDone) this.serviceDone(); }
      return;
    }
    const row = run.rows[run.i];
    const stopZ = rowZ(row) - run.dir * 0.2 - run.dir * 0.75 + (run.dir > 0 ? -0.2 : 0.2);
    if (Math.abs(c.z - (rowZ(row) - run.dir * 0.95)) > 0.05 && run.state !== 'serving') {
      c.queue({ type: 'walk', x: 0, z: rowZ(row) - run.dir * 0.95, speed: 0.5 }, { type: 'face', h: run.dir > 0 ? Math.PI : 0 });
      run.state = 'moving'; this.audio?.cartJingle();
      return;
    }
    if (run.state !== 'serving') {
      run.state = 'serving';
      run.seatQ = this.cabin.seats.filter((s) => s.row === row && s.occupant);
    }
    const s = run.seatQ.shift();
    if (!s) { run.i++; run.state = 'next'; return; }
    const res = this.serveFn(c, s, run);
    const dur = res?.dur ?? 0;
    if (dur > 0) {
      c.queue({ type: 'call', fn: (a) => { a.headTarget = { x: s.x, y: 1.0, z: s.z }; } }, { type: 'gesture', name: res.gesture || 'pour', dur }, { type: 'call', fn: (a) => { a.headTarget = null; if (res.after) res.after(); } });
    }
  }

  _updateBusiness(dt) {
    const b = this.businessRun; if (!b || b.finished) return;
    const c = b.crew; if (c.busy()) return;
    if (b.i >= b.rows.length) { b.finished = true; c.queue({ type: 'walk', x: 0.5, z: -2.8 }); return; }
    const row = b.rows[b.i++];
    const seats = this.cabin.seats.filter((s) => s.row === row && s.occupant);
    c.queue({ type: 'walk', x: 0, z: rowZ(row) - 0.5, speed: 0.6 }, { type: 'face', h: Math.PI });
    for (const s of seats) {
      c.queue({ type: 'call', fn: (a) => { a.headTarget = { x: s.x, y: 1, z: s.z }; } }, { type: 'gesture', name: 'offer', dur: 3.2 },
        { type: 'call', fn: () => { const res = this.serveFn(c, s, null, true); if (res?.after) res.after(); } });
    }
  }

  // Trash round with a bag
  collectTrash(onDone) {
    const { fwd, aft } = this.byRole;
    let n = 2;
    for (const [c, from, to] of [[fwd, rowZ(1) - 0.5, rowZ(12) + 0.3], [aft, rowZ(31) + 0.5, rowZ(14) - 0.3]]) {
      c.clear(); c.setProp('r', 'bag');
      c.queue({ type: 'walk', x: 0, z: from, speed: 1 });
      const rows = ROWS.filter((r) => (from < to ? rowZ(r) >= from && rowZ(r) <= to : rowZ(r) <= from && rowZ(r) >= to));
      if (from > to) rows.reverse();
      for (const row of rows) c.queue({ type: 'walk', x: 0, z: rowZ(row) - 0.4, speed: 0.7 }, { type: 'call', fn: () => this._collectRow(row, c) }, { type: 'wait', dur: 0.9 });
      c.queue({ type: 'call', fn: (a) => a.setProp('r', null) }, { type: 'walk', x: 0, z: from < to ? -1.4 : 24.6, speed: 1 }, { type: 'call', fn: () => { if (--n === 0 && onDone) onDone(); } });
    }
  }
  _collectRow(row, c) {
    for (const p of this.pax) if (p.seat.row === row && p.cup && this.r() < 0.9) { p.cup = null; p.tray = p.act === 'laptop'; }
    this.refreshTrays();
    if (this.onCollectRow) this.onCollectRow(row, c);
  }

  refreshTrays() {
    let nt = 0, nc = 0;
    for (const p of this.pax) {
      if (p.away) continue;
      if (p.tray || p.cup) { this.trays.setMatrixAt(nt++, trs(p.seat.x, 0.72, p.seat.z - 0.47)); }
      if (p.cup) this.cups.setMatrixAt(nc++, trs(p.seat.x + 0.1, 0.73, p.seat.z - 0.45));
    }
    if (this.neighbor?.tray) { const s = this.neighbor.seat; this.trays.setMatrixAt(nt++, trs(s.x, 0.72, s.z - 0.47)); if (this.neighbor.cup) this.cups.setMatrixAt(nc++, trs(s.x + 0.1, 0.73, s.z - 0.45)); }
    this.trays.count = nt; this.cups.count = nc;
    this.trays.instanceMatrix.needsUpdate = true; this.cups.instanceMatrix.needsUpdate = true;
  }
  stowAllTrays() { for (const p of this.pax) { p.tray = false; if (p.act === 'laptop') p.act = 'phone'; } if (this.neighbor) this.neighbor.tray = false; this.refreshTrays(); }

  // A passenger goes to the lavatory and back
  lavVisit(p, lav, onBusy) {
    if (p.away) return false;
    const s = p.seat;
    const act = new Actor(p.app, this.scene, {});
    act.place(s.x, s.z - 0.1, Math.PI);
    p.group.visible = false; p.away = true; this.refreshTrays();
    const seats = this.cabin.seats.filter((q) => q.row === s.row);
    const doorZ = lav.doorZ + (lav.doorFace < 0 ? -0.6 : 0.6);
    act.queue({ type: 'walk', x: Math.sign(s.x) * 0.1, z: s.z - 0.35, speed: 0.5 }, { type: 'walk', x: 0, z: s.z - 0.35, speed: 0.6 },
      { type: 'walk', x: 0, z: doorZ, speed: 0.9 }, { type: 'until', cond: () => !lav.occupied },
      { type: 'call', fn: () => { lav.target = 1; lav.occupied = true; } }, { type: 'walk', x: lav.cx, z: lav.cz, speed: 0.6 },
      { type: 'call', fn: () => { lav.target = 0; act.root.visible = false; } }, { type: 'wait', dur: 60 + this.r() * 90 },
      { type: 'call', fn: () => { this.audio && this.near(act, 8) && this.audio.flush(); lav.target = 1; act.root.visible = true; } }, { type: 'wait', dur: 1.2 },
      { type: 'walk', x: 0, z: doorZ, speed: 0.6 }, { type: 'call', fn: () => { lav.target = 0; lav.occupied = false; } },
      { type: 'walk', x: 0, z: s.z - 0.35, speed: 0.9 }, { type: 'walk', x: s.x, z: s.z - 0.1, speed: 0.5 },
      { type: 'call', fn: () => { this.scene.remove(act.root); p.group.visible = true; p.away = false; this.walkers.splice(this.walkers.indexOf(act), 1); this.refreshTrays(); } });
    this.walkers.push(act);
    return true;
  }

  // Deplaning: aisle passengers stand, then shuffle out through L1
  standUpAtGate() {
    const aisleRows = [...ROWS];
    this.deplaners = [];
    const usedRows = new Set();
    for (const p of this.pax) {
      if (p.away) continue;
      const aisle = p.seat.letter === 'C' || p.seat.letter === 'D';
      if (!aisle || usedRows.has(p.seat.row) || this.r() < 0.2) continue;
      usedRows.add(p.seat.row);
      const act = new Actor(p.app, this.scene, {});
      act.place(Math.sign(p.seat.x) * 0.12, p.seat.z - 0.2, Math.PI);
      act.headTarget = { x: Math.sign(p.seat.x) * 1.2, y: 1.9, z: p.seat.z };
      p.group.visible = false; p.away = true;
      act.queue({ type: 'wait', dur: 1 + this.r() * 4 }, { type: 'gesture', name: 'mask', dur: 0.01 });
      this.deplaners.push({ act, p, out: false });
      this.walkers.push(act);
    }
    this.refreshTrays();
    for (const b of this.cabin.bins) if (this.r() < 0.7) setTimeout(() => { b.target = 1; this.audio?.binOpen(); }, 1000 + this.r() * 9000);
  }
  startDeplaning() {
    this.deplaning = true;
    // later waves: middle and window passengers stand up row by row, front to back
    const rest = this.pax.filter((p) => !p.away).sort((a, b) => a.seat.z - b.seat.z);
    rest.forEach((p, i) => setTimeout(() => {
      if (p.away || !this.deplaning) return;
      const act = new Actor(p.app, this.scene, {});
      act.place(Math.sign(p.seat.x) * 0.12, p.seat.z - 0.2, Math.PI);
      p.group.visible = false; p.away = true; this.refreshTrays();
      this.deplaners.push({ act, p, out: false }); this.walkers.push(act);
    }, 25000 + i * 3500));
  }

  near(actor, d) { return this.listener ? Math.hypot(actor.x - this.listener.x, actor.z - this.listener.z) < d : false; }

  blocked(actor, tz) {
    // keep ~0.62 m spacing to anyone ahead in the aisle. Crew only yield to crew
    // (passengers step aside for them); passengers also stop for trolleys.
    const dir = Math.sign(tz - actor.z);
    if (!dir) return false;
    const others = actor.crew ? this.crew : [...this.walkers, ...this.crew];
    for (const o of others) {
      if (o === actor || !o.root.visible || o.seated) continue;
      if (Math.abs(o.x - actor.x) > 0.35 || Math.abs(o.x) > 0.4) continue;
      const dz = (o.z - actor.z) * dir;
      if (dz > 0 && dz < 0.62) return true;
    }
    if (!actor.crew) {
      for (const run of this.carts) { if (run.finished) continue; const dz = (run.cart.position.z - actor.z) * dir; if (dz > 0 && dz < 0.75 && Math.abs(actor.x) < 0.4) return true; }
      if (this.playerBlock) { const dz = (this.playerBlock.z - actor.z) * dir; if (Math.abs(this.playerBlock.x - actor.x) < 0.35 && dz > 0 && dz < 0.6) return true; }
    }
    return false;
  }

  servicing() { return this.carts.some((r) => !r.finished); }

  windowFor(seat) {
    let best = null, bd = 9;
    for (const w of this.cabin.windows) { if (Math.sign(w.side) !== Math.sign(seat.x)) continue; const d = Math.abs(w.z - (seat.z - 0.25)); if (d < bd) { bd = d; best = w; } }
    return best;
  }
  // Cruise habits: some passengers recline, close their blinds, switch on reading lights.
  cruiseHabits(night, playerSeat) {
    for (const p of this.pax) {
      if (p.away) continue;
      if (this.r() < 0.16 && !p.seat.business) { p.seat.recline = 1; this.cabin.updateSeat(p.seat); }
      const win = p.seat.letter === 'A' || p.seat.letter === 'F';
      if (win && (p.sleep || this.r() < 0.28)) { const w = this.windowFor(p.seat); if (w && Math.abs(w.z - playerSeat.z) > 0.8) w.shadeTarget = 1; }
      if (night && (p.act === 'read' || this.r() < 0.12)) this.cabin.setReadingLight(p.seat, true);
    }
  }
  // Crew check before landing: upright seats and open blinds in a row.
  secureRow(row) {
    for (const s of this.cabin.seats) if (s.row === row) {
      if (s.recline && s !== this.cabin.seat(this.playerSeat)) { s.recline = 0; this.cabin.updateSeat(s); }
      if (s.letter === 'A' || s.letter === 'F') { const w = this.windowFor(s); if (w && s.id !== this.playerSeat) w.shadeTarget = 0; }
    }
  }

  // Idle head motion for seated NPCs & neighbour, plus deplaning shuffle
  update(dt, ctx) {
    this.t += dt;
    const r = this.r;
    this.listener = ctx.player;
    const phase = ctx.phase;
    for (const p of this.pax) {
      if (p.away) continue;
      const dx = p.seat.x - ctx.player.x, dz = p.seat.z - ctx.player.z;
      const near = dx * dx + dz * dz < 64;
      if (!near && !ctx.force) continue; // skip far heads for performance
      p.lookT -= dt;
      if (p.lookT <= 0) {
        p.lookT = 2 + r() * 8;
        const opts = p.sleep ? ['down'] : ['fwd', 'fwd', 'down', 'aisle', 'window', 'fwd'];
        let look = r.pick(opts);
        if (ctx.crewNear && ctx.crewNear(p.seat) && !p.sleep) look = 'aisle';
        p.look = look;
      }
      let yaw = 0, pitch = 0;
      const side = Math.sign(p.seat.x);
      if (p.look === 'down' || p.act === 'phone' || p.act === 'read' || p.act === 'laptop') pitch = 0.35;
      if (p.look === 'window') yaw = side * -0.7 * (p.seat.letter === 'A' || p.seat.letter === 'F' ? 1 : 0.5);
      if (p.look === 'aisle') yaw = side * 0.5;
      if (p.sleep) { pitch = 0.3; yaw = side * 0.2; }
      if (ctx.bump) pitch += ctx.bump * 0.05;
      p.yaw = damp(p.yaw, yaw, 3, dt); p.pitch = damp(p.pitch, pitch, 3, dt);
      p.head.quaternion.copy(p.head.userData.rest);
      p.head.rotateY(p.yaw); p.head.rotateX(p.pitch);
    }
    // neighbour
    if (this.neighbor) this.neighbor.actor.update(dt, this);
    for (const c of this.crew) c.update(dt, this);
    for (const w of [...this.walkers]) w.update(dt, this);
    for (const run of this.carts) this._updateCart(run, dt);
    this._updateBusiness(dt);
    // deplaning shuffle towards L1
    if (this.deplaning && this.deplaners) {
      const sorted = this.deplaners.filter((d) => !d.out).sort((a, b) => a.act.z - b.act.z);
      for (const d of sorted) {
        if (!d.act.task && !d.act.tasks.length) {
          d.act.headTarget = null;
          d.act.queue({ type: 'walk', x: 0, z: -2.3, speed: 0.7 }, { type: 'walk', x: -1.4, z: -2.3, speed: 0.7 },
            { type: 'call', fn: () => { d.out = true; d.act.root.visible = false; this.walkers.splice(this.walkers.indexOf(d.act), 1); } });
          d.act.setProp('r', this.r() < 0.6 ? 'bag' : null);
        }
      }
    }
  }
}

// ---------------- neighbour personas ----------------
export const NEIGHBOURS = {
  erik: { name: 'Erik', app: { female: false, age: 46, jacket: true, glasses: true, business: true, top: '#23304a', hairStyle: 'short' }, from: 'Uppsala', job: 'a structural engineer', why: 'a two-day project meeting in Ørestad', lang: 'sv' },
  maja: { name: 'Maja', app: { female: true, age: 27, hairStyle: 'long', top: '#c9c3b8', glasses: false }, from: 'Södermalm', job: 'a UX designer', why: 'visiting her sister who lives in Nørrebro', lang: 'sv' },
  linnea: { name: 'Linnea', app: { female: true, age: 34, hairStyle: 'ponytail', top: '#3f5b46' }, from: 'Västerås', job: 'a nurse', why: 'a long weekend with friends — they have a table booked at a restaurant in Vesterbro', lang: 'sv' },
  jonas: { name: 'Jonas', app: { female: false, age: 31, hairStyle: 'crop', headphones: '#1b1b1d', top: '#1a1b1f' }, from: 'Solna', job: 'a software developer', why: 'connecting to a flight to Chicago', lang: 'sv' },
  ingrid: { name: 'Ingrid', app: { female: true, age: 68, hairStyle: 'bob', hairColor: '#d9d6cf', glasses: true, top: '#5b3a4e' }, from: 'Lidingö', job: 'a retired teacher', why: 'visiting her grandchildren in Frederiksberg', lang: 'sv' },
  david: { name: 'David', app: { female: false, age: 39, top: '#8497b0', hairStyle: 'short', beard: '#5a3b24' }, from: 'Boston', job: 'a product manager', why: 'the last stop of a Scandinavian holiday before flying home', lang: 'en' },
  sofia: { name: 'Sofia', app: { female: true, age: 42, top: '#1d2433', jacket: true, hairStyle: 'bun', glasses: true, business: true }, from: 'Djursholm', job: 'a lawyer', why: 'a client meeting in central Copenhagen', lang: 'sv' },
  anders: { name: 'Anders', app: { female: false, age: 57, top: '#3b4150', hairStyle: 'bald', glasses: true, jacket: true }, from: 'Malmö', job: 'a pharmaceutical sales manager', why: 'going home — he commutes to Stockholm every week and lives in Malmö, just across the bridge', lang: 'sv' },
};
