/**
 * The 3D stage: the Med Engine rendering the story's places and people.
 *
 * Places are built once (places.js) and kept, each at its own spot in the
 * world, shown when the story is there. The hour and the weather set the
 * sun (or the moon), the clouds, the window light and the rain or snow.
 * Actors (actor.js) take their marks, walk, gesture and speak. For each
 * beat the camera frames a shot as a director would (establishing, wide,
 * medium, two-shot, over the shoulder, close, insert), moves through it
 * (push in, pull out, pan, tilt, drift), and the lens focuses on the face
 * that matters.
 */
import { Raycaster, DirectionalLight, PointLight, Vector3, InstancedMesh, BoxGeometry, MeshBasicMaterial, Object3D, Color } from 'three';
import { MedStage } from './engine.js';
import { buildPlace, INDOOR } from './places.js';
import { Actor } from './actor.js';

const LIGHT = {
  dawn: { dir: [0.75, 0.22, 0.35], color: [1.0, 0.72, 0.52], power: 4.2, window: [1.6, 1.15, 0.85] },
  day: { dir: [0.35, 0.85, 0.35], color: [1.0, 0.96, 0.9], power: 7.5, window: [1.5, 1.48, 1.38] },
  dusk: { dir: [-0.78, 0.2, 0.32], color: [1.0, 0.58, 0.32], power: 3.8, window: [1.4, 0.8, 0.45] },
  night: { dir: [0.25, 0.55, -0.5], color: [0.5, 0.62, 1.0], power: 0.5, window: [0.06, 0.08, 0.16] },
};
const CLOUD = { clear: 0.2, wind: 0.4, fog: 0.85, rain: 0.92, storm: 0.98, snow: 0.88 };
const FOV = { establishing: 46, wide: 40, medium: 30, 'two-shot': 34, 'over-shoulder': 28, close: 21, insert: 34 };

/** Clothes and hair for an actor, from the look the director gave them. */
/** Dyed cloth of the time was rich but rarely black; very dark picks are lifted so they read on film. */
function cloth(hex, min = 0.2) {
  const c = new Color(hex ?? '#6a5a40'), hsl = {}; c.getHSL(hsl);
  if (hsl.l < min) c.setHSL(hsl.h, hsl.s, min);
  return '#' + c.getHexString();
}

export function walkerOptions(c, id) {
  const L = c.look ?? {};
  const f = c.sex === 'f';
  const st = L.hairStyle;
  const items = { head: st === 'hood' ? 'hood' : st === 'cap' || st === 'hat' ? 'armingCap' : 'bareHead', under: L.build === 'broad' && !f ? 'gambeson' : (c.rich ? 'armingDoublet' : 'shirt'), legs: 'hose', feet: 'shoes', hands: c.gloves ? 'gloves' : 'bareHands' };
  const headwear = f ? (st === 'veil' ? 'kerchief' : st === 'hood' ? null : st === 'short' ? 'kerchief' : 'braid') : null;
  const height = (f ? 1.6 : 1.72) + (L.build === 'broad' ? 0.04 : L.build === 'stout' ? -0.02 : 0) + ((c.age ?? 30) < 15 ? -0.25 : 0);
  return { id, name: c.name ?? id, height, items, colors: { skin: L.skin, hair: L.hair, cloth: cloth(L.clothes, 0.24), hose: f ? cloth(L.clothes, 0.2) : cloth(L.hose ?? L.accent ?? '#4a3a2a', 0.18) }, female: f, headwear, beard: f ? 0 : L.beard ?? 0, texSize: 1024 };
}

export class Stage3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.stage = new MedStage(canvas, { quality });
    this.scene = this.stage.scene; this.camera = this.stage.camera; this.r = this.stage.r;
    this.sun = new DirectionalLight(0xffffff, 1);
    this.scene.add(this.sun, this.sun.target);
    // the key light a film crew would set: soft, beside the lens, warm by fire and cool by moon
    this.key = new PointLight(0xffd8b0, 0, 7, 2);
    this.scene.add(this.key);
    this.places = new Map();     // id -> { spec, built, offset }
    this.actors = new Map();     // cast id -> Actor
    this.here = null;
    this.t = 0;
    this.cam = { from: null, to: null, t0: 0, dur: 1, fov: 34, look: new Vector3() };
    this._weather();
  }

  /** Build a place if it is new (before anyone walks in); kept for good. */
  ensurePlace(spec) {
    let P = this.places.get(spec.id);
    if (P) return P;
    const built = buildPlace(spec);
    const offset = this.places.size * 400;
    built.group.position.x = offset;
    built.group.visible = false;
    this.scene.add(built.group);
    const flames = [];
    built.group.traverse((o) => { if (o.userData.flame) flames.push(o); });
    P = { spec, built, offset, flames };
    this.places.set(spec.id, P);
    return P;
  }

  /** Go to a place, at an hour, in a weather. */
  enter(spec, { time = 'day', weather = 'clear' } = {}) {
    const P = this.ensurePlace(spec);
    if (this.here && this.here !== P) this.here.built.group.visible = false;
    P.built.group.visible = true;
    this.here = P;
    const L = LIGHT[time] ?? LIGHT.day;
    const d = new Vector3(...L.dir).normalize();
    this.sun.position.set(P.offset + d.x * 50, d.y * 50, d.z * 50);
    this.sun.target.position.set(P.offset, 0, 0);
    this.r.sunColor.set(...L.color); this.r.sunIntensity = L.power; this.r.cloudCover = CLOUD[weather] ?? 0.4; this.r._envDirty = true;
    P.built.group.traverse((o) => { if (o.userData.window) o.material.color.setRGB(...L.window); });
    for (const l of P.built.lights) l.L.intensity = l.base = l.power * (time === 'day' && !P.built.indoor ? 0.4 : 1);
    const indoorNight = P.built.indoor && (time === 'night' || time === 'dusk');
    this.keyPower = P.built.indoor ? (indoorNight ? 2.2 : 1.6) : time === 'night' ? 1.2 : 0.6;
    this.key.color.set(indoorNight ? 0xffc890 : time === 'night' ? 0x9fb4ff : 0xfff0e0);
    this.weather = INDOOR.has(spec.type) ? 'clear' : weather;
    for (const a of this.actors.values()) a.mesh.visible = false;
    this.stage.taa.reset = true;
    return P;
  }

  /** An actor for someone in the cast (made once, re-dressed if their look changed). */
  actor(id, c) {
    let a = this.actors.get(id);
    const key = JSON.stringify(c.look ?? {}) + c.sex;
    if (a && a.lookKey !== key) { this.scene.remove(a.mesh); a = null; }
    if (!a) { a = new Actor(walkerOptions(c, id)); a.lookKey = key; this.scene.add(a.mesh); this.actors.set(id, a); }
    a.mesh.visible = true;
    return a;
  }

  /** Put the people present on marks: a named mark if asked for, else a free standing place. */
  block(present, at = {}) {
    const P = this.here; if (!P) return;
    const B = P.built, used = new Set();
    for (const [i, id] of present.entries()) {
      const a = this.actors.get(id); if (!a) continue;
      a.mesh.visible = true;
      const want = at[id];
      let m = want && (B.marks[want] ?? Object.entries(B.marks).find(([k]) => k.startsWith(want))?.[1]);
      if (!m || used.has(m)) m = B.stands.find((s) => !used.has(s)) ?? B.stands[i % B.stands.length];
      used.add(m);
      const x = P.offset + m.x, z = m.z;
      if (a.placed !== P) { a.place(x, z, m.yaw, m.posture); a.placed = P; } else if (Math.hypot(a.pos.x - x, a.pos.z - z) > 0.3) a.walkTo(x, z, m.yaw, m.posture);
    }
  }

  /** Frame a beat. on: ids in shot; who: the speaker; you: the player's actor id. */
  shot(beat, { you = 'you', dur = 5 } = {}) {
    const P = this.here; if (!P) return;
    const B = P.built, off = P.offset;
    const A = (id) => this.actors.get(id);
    const head = (a) => (a?.b?.head?.pos ? a.b.head.pos.clone() : new Vector3(a?.pos.x ?? off, 1.55, a?.pos.z ?? 0));
    const subj = A(beat.who) ?? A(beat.on.find((i) => i !== you)) ?? null;
    let eye = new Vector3(), look = new Vector3();
    const kind = beat.shot;
    const W = B.bounds.W, D = B.bounds.D;
    if (kind === 'establishing' || !subj && kind !== 'insert') {
      if (B.indoor) { eye.set(off + W / 2 - 0.6, Math.min(2.3, B.bounds.H - 0.4), D / 2 - 0.6); look.set(off - W * 0.15, 1.2, -D * 0.25); }
      else { eye.set(off + 3, 3.4, 11); look.set(off, 2.2, -6); }
    } else if (kind === 'insert') {
      const l = B.lights.find((x) => x.kind !== 'window') ?? { x: 0, y: 1, z: 0 };
      look.set(off + l.x, l.y - 0.2, l.z); eye.copy(look).add(new Vector3(0.6, 0.35, 1.0));
    } else {
      const h = head(subj);
      // who the subject is talking to: the player, else the next person in shot
      const partner = subj.id !== you && A(you)?.mesh.visible ? A(you) : A(beat.on.find((i) => i !== subj.id && A(i)));
      if (partner) { subj.faceTo(partner.pos); partner.faceTo(subj.pos); }
      // the side of the face to film: toward the partner, or the way they face
      const toward = partner ? partner.pos.clone().sub(subj.pos).setY(0) : new Vector3(Math.sin(subj.yawWant ?? subj.yawNow), 0, Math.cos(subj.yawWant ?? subj.yawNow));
      if (toward.lengthSq() < 1e-4) toward.set(0, 0, 1);
      toward.normalize();
      const across = new Vector3(toward.z, 0, -toward.x);
      if (kind === 'close') { eye.copy(h).addScaledVector(toward, 1.2).addScaledVector(across, 0.36); eye.y = h.y + 0.03; look.copy(h); look.y -= 0.05; }
      else if (kind === 'medium') { eye.copy(h).addScaledVector(toward, 2.0).addScaledVector(across, 0.75); eye.y = h.y - 0.05; look.copy(h); look.y -= 0.28; }
      else if (kind === 'over-shoulder' && partner) {
        const me = head(partner);
        eye.copy(me).addScaledVector(toward, 0.45).addScaledVector(across, 0.38); eye.y = me.y + 0.1; look.copy(h); look.y -= 0.04;
      } else if (kind === 'two-shot') {
        const other = A(beat.on.find((i) => i !== beat.who && i !== subj.id)) ?? A(you);
        const h2 = other ? head(other) : h.clone().add(new Vector3(1, 0, 0));
        const mid = h.clone().add(h2).multiplyScalar(0.5), ab = h2.clone().sub(h).setY(0);
        const perp = new Vector3(-ab.z, 0, ab.x).normalize(); if (perp.z < 0) perp.negate();
        eye.copy(mid).addScaledVector(perp, ab.length() * 1.1 + 1.8); eye.y = 1.55; look.copy(mid).y -= 0.25;
      } else { // wide
        const ids = beat.on.length ? beat.on : [subj.id];
        const c = new Vector3(); let n = 0;
        for (const i of ids) { const a = A(i); if (a) { c.add(a.pos); n++; } }
        c.multiplyScalar(1 / Math.max(1, n));
        eye.set(c.x + 1.2, 1.75, c.z + 6.2); look.set(c.x, 1.25, c.z);
      }
    }
    if (B.indoor) { eye.x = Math.max(off - W / 2 + 0.55, Math.min(off + W / 2 - 0.55, eye.x)); eye.z = Math.max(-D / 2 + 0.55, Math.min(D / 2 - 0.55, eye.z)); eye.y = Math.min(B.bounds.H - 0.25, Math.max(0.4, eye.y)); }
    // no one else's head or hands in front of the lens on a near shot: try the other side, then wider angles
    if (subj && (kind === 'close' || kind === 'medium' || kind === 'over-shoulder')) {
      const others = [...this.actors.values()].filter((a) => a.mesh.visible && a !== subj && !(kind === 'over-shoulder' && a === A(you)));
      const blocked = (e) => others.some((a) => [1.0, 1.3, a.b?.head?.pos?.y ?? 1.55].some((y) => {
        const p = new Vector3(a.pos.x, y, a.pos.z), ab = look.clone().sub(e), t = Math.max(0, Math.min(1, p.clone().sub(e).dot(ab) / ab.lengthSq()));
        return e.clone().addScaledVector(ab, t).distanceTo(p) < 0.32;
      }));
      if (blocked(eye)) {
        const r = eye.clone().sub(look);
        for (const ang of [-0.7, 0.5, -1.1, 0.9, -1.5]) {
          const c = Math.cos(ang), s2 = Math.sin(ang), e = new Vector3(look.x + r.x * c - r.z * s2, eye.y, look.z + r.x * s2 + r.z * c);
          if (!blocked(e)) { eye.copy(e); break; }
        }
      }
    }
    // nothing between the lens and what it looks at: come in front of any wall, beam or post
    {
      const ray = new Raycaster(), d = eye.clone().sub(look), len = d.length();
      ray.set(look, d.normalize()); ray.far = len;
      const hit = ray.intersectObject(B.group, true).find((h) => h.object.isMesh && !h.object.parent?.userData.flame && h.distance > 0.35);
      if (hit) eye.copy(look).addScaledVector(d, Math.max(0.4, hit.distance - 0.25));
    }
    // the move through the shot
    const v = look.clone().sub(eye), side = new Vector3(-v.z, 0, v.x).normalize();
    const from = { eye: eye.clone(), look: look.clone() }, to = { eye: eye.clone(), look: look.clone() };
    const k = Math.min(0.6, v.length() * 0.12);
    switch (beat.move) {
      case 'push-in': from.eye.addScaledVector(v.clone().normalize(), -k); to.eye.addScaledVector(v.clone().normalize(), k * 0.6); break;
      case 'pull-out': from.eye.addScaledVector(v.clone().normalize(), k * 0.6); to.eye.addScaledVector(v.clone().normalize(), -k); break;
      case 'pan-left': from.eye.addScaledVector(side, 0.35); to.eye.addScaledVector(side, -0.35); break;
      case 'pan-right': from.eye.addScaledVector(side, -0.35); to.eye.addScaledVector(side, 0.35); break;
      case 'tilt-up': from.look.y -= 0.5; break;
      case 'drift': from.eye.addScaledVector(side, 0.12); to.eye.addScaledVector(side, -0.12); break;
      default: break;
    }
    this.cam = { from, to, t0: this.t, dur, fov: FOV[kind] ?? 34, subject: subj, kind };
    this.stage.dofAmount = kind === 'close' || kind === 'over-shoulder' ? 1.0 : kind === 'medium' ? 0.6 : kind === 'insert' ? 0.9 : 0.25;
  }

  /** Where a world point is on screen (CSS px), or null behind the camera. */
  project(p) {
    const v = p.clone().project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, on: Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
  }

  _weather() {
    const geo = new BoxGeometry(0.012, 0.5, 0.012);
    this.rain = new InstancedMesh(geo, new MeshBasicMaterial({ color: new Color(0.7, 0.75, 0.85), transparent: true, opacity: 0.35 }), 900);
    this.rain.frustumCulled = false; this.rain.visible = false;
    this.drops = Array.from({ length: 900 }, () => new Vector3(Math.random() * 30 - 15, Math.random() * 12, Math.random() * 30 - 15));
    this.scene.add(this.rain);
    this._o = new Object3D();
  }

  frame(dt) {
    this.t += dt;
    const c = this.cam;
    if (c.from) {
      const u = Math.min(1, (this.t - c.t0) / c.dur), e = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(c.from.eye, c.to.eye, e);
      const look = c.from.look.clone().lerp(c.to.look, e);
      this.camera.lookAt(look);
      if (Math.abs(this.camera.fov - c.fov) > 0.01) { this.camera.fov += (c.fov - this.camera.fov) * Math.min(1, dt * 6); this.camera.updateProjectionMatrix(); }
      this.stage.focusPoint = c.subject?.b?.head?.pos ?? look;
      // key light up and to one side of the lens, nearer for close shots
      const near = c.kind === 'close' || c.kind === 'over-shoulder' ? 0.6 : c.kind === 'medium' ? 0.8 : 1;
      const d = look.clone().sub(this.camera.position);
      this.key.position.copy(this.camera.position).addScaledVector(d, 0.35).add(new Vector3(-d.z, 0, d.x).normalize().multiplyScalar(0.9)).setY(this.camera.position.y + 0.6);
      this.key.intensity = (this.keyPower ?? 1) * near * (c.kind === 'establishing' || c.kind === 'insert' ? 0.3 : 1);
    }
    // fire breathes: the flames sway and the light flickers with them
    if (this.here) {
      const t = this.t;
      for (const f of this.here.flames) { const k = f.userData.flame.seed; f.scale.set(1 + Math.sin(t * 9 + k) * 0.06, 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(t * 13.7 + k * 2) * Math.sin(t * 5.3 + k)), 1 + Math.cos(t * 8 + k) * 0.06); }
      for (const l of this.here.built.lights) if (l.kind !== 'window') l.L.intensity = (l.base ?? l.power) * (0.86 + 0.1 * Math.sin(t * 11 + l.x) * Math.sin(t * 4.3 + l.z) + 0.04 * Math.sin(t * 23 + l.x));
    }
    const pts = [];
    for (const a of this.actors.values()) if (a.mesh.visible) { a.tick(dt, this.t); if (a.b?.head?.pos) pts.push(a.b.head.pos); }
    this.stage.shadowFocus = pts.length ? pts : null;
    // rain or snow, around the camera
    const w = this.weather;
    this.rain.visible = w === 'rain' || w === 'storm' || w === 'snow';
    if (this.rain.visible) {
      const snow = w === 'snow', cp = this.camera.position, o = this._o;
      this.rain.material.opacity = snow ? 0.8 : 0.35;
      for (const [i, d] of this.drops.entries()) {
        d.y -= dt * (snow ? 0.9 : 9) ; if (snow) d.x += Math.sin(this.t + i) * dt * 0.3;
        if (d.y < 0) { d.y += 12; d.x = Math.random() * 30 - 15; d.z = Math.random() * 30 - 15; }
        o.position.set(cp.x + d.x, d.y, cp.z + d.z); o.scale.set(snow ? 3 : 1, snow ? 0.06 : 1, snow ? 3 : 1); o.rotation.z = w === 'storm' ? 0.3 : 0; o.updateMatrix();
        this.rain.setMatrixAt(i, o.matrix);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
    this.stage.render(dt, this.t);
  }
}
