import { Vector3, MathUtils } from 'three';
import { Stage } from '../../../../medengine/src/Stage.js';
import { Human } from '../../../../medengine/src/human/Human.js';
import { Actor } from '../../../../medengine/src/human/Actor.js';
import { Director } from '../../../../medengine/src/cinema/Director.js';
import { Weather } from '../../../../medengine/src/weather/Weather.js';
import { speechDuration } from '../../../../medengine/src/human/Face.js';
import { Overlay } from '../ui/Overlay.js';
import { CAST } from '../story/episode1.js';
import { SETS } from '../sets/index.js';

const HUMANS = './assets/humans';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The film: the story's scene API performed on the Med Engine 2 in 3D.
 */
export class Theatre3D {
  constructor(canvas, { audio, quality = 'high', auto = false } = {}) {
    this.stageE = new Stage(canvas, { quality });
    this.director = new Director(this.stageE);
    this.audio = audio;
    this.weatherC = new Weather(this.stageE, audio);
    this.ui = new Overlay(CAST);
    this.actors = {};
    this.sets = {};
    this.set = null;
    this.waiters = [];
    this.gameTime = 0;
    this.timeScale = 1;
    this.auto = auto;
    this.voices = false;
    this.running = false;
    this.stageE.composite.letterbox = 1;
    this.stageE.composite.grain = 0.03;
  }

  /** Loads every member of the cast (progress 0..1 to the callback). */
  async loadCast(onProgress, ids = ['batman', 'rook', 'nadia', 'cruz', 'marrow', 'kow', 'dez', 'deckhand']) {
    let n = 0;
    Human.prefetch(HUMANS, ids);   // every download in flight at once; building stays one by one
    for (const id of ids) {
      if (this.actors[id]) { onProgress?.(++n / ids.length, CAST[id]?.name); continue; }
      this.actors[id] = await Actor.load(this.stageE, HUMANS, id, { levels: this.stageE.r.q.renderScale < 0.6 ? 0 : 1 });
      onProgress?.(++n / ids.length, CAST[id]?.name);
      await sleep(0);
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    // minFrame (ms): while loading, draw only now and then so the loading work gets the machine
    this.minFrame = this.minFrame ?? 0;
    const frame = (now) => {
      if (this.running) requestAnimationFrame(frame);
      if (now - last < this.minFrame) return;
      const real = Math.min(0.1, (now - last) / 1000); last = now;
      this.step(real);
      this.onFrame?.(real);
    };
    requestAnimationFrame(frame);
  }

  step(real) {
    const dt = real * this.timeScale;
    this.gameTime += dt;
    for (let i = this.waiters.length - 1; i >= 0; i--) if (this.gameTime >= this.waiters[i].t) { this.waiters[i].resolve(); this.waiters.splice(i, 1); }
    for (const a of Object.values(this.actors)) if (a.root.parent) a.update(dt);
    this.set?.update?.(dt, this.gameTime, this);
    this.weatherC.update(dt);
    this._explore?.(dt);
    this._special?.(dt);
    this.director.update(dt);
    this.stageE.render(dt);
    this.frames = (this.frames ?? 0) + 1;
    if (window.__ready) window.__frames = (window.__frames ?? 0) + 1;
    if (window.__stopping && (this._stopFrames = (this._stopFrames ?? 0) + 1) > (this.stopFrames ?? 14)) window.__shotReady = true;
  }

  wait(s) { return new Promise((resolve) => this.waiters.push({ t: this.gameTime + s / (this.auto ? 3 : 1), resolve })); }

  // -------------------------------------------------------------- places
  async stage(name, opts = {}) {
    const key = name + (opts.time ? ':' + opts.time : '');
    const S = this.stageE;
    if (this.set) S.scene.remove(this.set.root);
    for (const a of Object.values(this.actors)) { a.root.removeFromParent(); a.garments.cape?.mesh.removeFromParent(); a.lookAt(null); a.clip = null; a.walk = null; }
    let set = this.sets[key];
    if (!set) { set = await SETS[name](opts); this.sets[key] = set; }
    this.set = set;
    S.scene.add(set.root);
    const r = S.r;
    if (set.sun) { r.sunDir.set(...set.sun.dir).normalize(); r.sunColor.set(...set.sun.color); r.sunIntensity = set.sun.intensity; }
    r.envIntensity = set.envIntensity ?? 1;
    r.cloudCover = set.cloudCover ?? 0.8;
    if (set.cityGlow) r.weather.cityGlow = set.cityGlow;
    Object.assign(S.volumetrics.fog, set.fog ?? {});
    Object.assign(S.exposure, set.exposure ?? {});
    S.exposure.reset = true;
    Object.assign(S.grade, { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: [1, 1, 1], highTint: [1, 1, 1], saturation: 1, contrast: 1, temperature: 0, halation: 0, exposureBias: 0 }, set.grade ?? {});
    this.director.bounds = set.bounds ?? null;
    this.weatherC.set({ ...(set.weather ?? {}) });
    this.weatherC.rebase();
    r.invalidateEnvironment();
    S.taa.reset = true;
    this.audio?.space?.(set.space ?? 'open');
  }

  _mark(m) {
    if (!m) return null;
    if (Array.isArray(m)) return { pos: m, yaw: 0 };
    return this.set?.marks?.[m] ?? null;
  }

  _point(p) {
    if (!p) return null;
    if (p.isVector3) return p;
    if (Array.isArray(p)) return new Vector3(...p);
    if (typeof p !== 'string') return null;
    if (this.actors[p]?.root.parent) return this.actors[p];
    if (p === 'rookWrist') return this.actors.rook?.bone('hand_l');
    const pt = this.set?.points?.[p];
    if (pt) return new Vector3(...pt);
    const mk = this.set?.marks?.[p];
    if (mk) return new Vector3(mk.pos[0], (mk.pos[1] ?? 0) + 1.2, mk.pos[2]);
    return null;
  }

  place(who, mark, yaw) {
    const a = this.actors[who];
    if (!a) return;
    const m = this._mark(mark) ?? { pos: [0, 0, 0], yaw: 0 };
    a.place(m.pos, yaw ?? m.yaw ?? 0);
    if (!a.root.parent) this.stageE.scene.add(a.root);
    a.setVisible(true);
    a.walk = null; a.speed = 0;
    if (a.garments.cape) { a.garments.cape.cloth.started = false; }
  }

  act(who, spec) {
    const a = this.actors[who];
    if (!a) return Promise.resolve();
    const jobs = [];
    if (spec.setVisible !== undefined) a.setVisible(spec.setVisible);
    if (spec.posture) a.posture(spec.posture);
    if (spec.emote) a.emote(spec.emote);
    if (spec.lookAt !== undefined) {
      const tp = spec.lookAt === null ? null : this._point(spec.lookAt);
      a.lookAt(tp, 1);
      // a target well behind the shoulder: turn the body, not just the head
      const P = tp?.isVector3 ? tp : tp?.position;
      if (P && !spec.walkTo && spec.turnTo === undefined) {
        const want = Math.atan2(P.x - a.position.x, P.z - a.position.z);
        const d = Math.atan2(Math.sin(want - a.yaw), Math.cos(want - a.yaw));
        if (Math.abs(d) > 1.0) jobs.push(a.turnTo(P, 0.7));
      }
    }
    if (spec.play) jobs.push(a.play(spec.play));
    if (spec.walkTo) { const m = this._mark(spec.walkTo); if (m) jobs.push(a.walkTo(new Vector3(...m.pos), { run: spec.run })); }
    if (spec.turnTo !== undefined) jobs.push(a.turnTo(typeof spec.turnTo === 'number' ? spec.turnTo : this._point(spec.turnTo)));
    return Promise.all(jobs);
  }

  cut(spec) {
    const s = { ...spec };
    if (spec.free || spec.type === 'free') { s.type = 'free'; s.pos = this._point(spec.pos); s.target = this._point(spec.target); if (!s.pos || !s.target) return; }
    s.on = this._point(spec.on) ?? this._point(spec.at);
    if (spec.with) s.with = this._point(spec.with);
    if (spec.over) s.over = this._point(spec.over);
    if (spec.focus) s.focus = this._point(spec.focus);
    if (spec.look) s.look = this._point(spec.look);
    if (spec.type === 'insert' || (!s.on?.eyes && s.on)) s.at = s.on;
    if (!s.on && s.type !== 'free') return;
    if ((s.type === 'two' && !s.with) || (s.type === 'ots' && !s.over)) s.type = 'ms';
    this.director.cut(s, { blend: spec.blend ?? 0 });
    this.stageE.shadowFocus = s.on?.eyes ? { center: s.on.chest(new Vector3()), radius: 2.2 } : null;
  }

  // -------------------------------------------------------------- sound and weather
  weather(w) { this.weatherC.set(w, 1.5); }
  music(m, i) { this.audio?.music(m, i); }
  sfx(n) { this.audio?.sfx(n); }
  sting(k) { this.audio?.sting(k); }
  ambience(a) { this.weatherC.ambienceExtra = a; }
  space(k) { this.audio?.space(k); }
  lights(m) { this.set?.lights?.(m); }
  strike(d) { this.weatherC.strike(d); }
  kick(a = 0.6) { this.director.kick(a); }

  // -------------------------------------------------------------- words
  async line(who, text, o = {}) {
    this.lineCount = (this.lineCount ?? 0) + 1;
    if (this.stopAt && this.lineCount >= this.stopAt) { this.ui.showLine(who, text, o); window.__stopping = true; this.auto = false; return new Promise(() => {}); }
    const c = CAST[who];
    const radio = o.radio || c?.radio;
    const a = this.actors[who];
    const rate = c?.voice?.rate ?? 1;
    let dur = speechDuration(text, rate);
    if (radio) this.audio?.sfx('radio', { volume: 0.5 });
    if (a?.root.parent && !radio) { a.say(text, { emotion: o.emo, duration: dur }); if (o.emo) a.emote(o.emo); }
    this.ui.showLine(who, text, { radio });
    const spoken = this.voices && !this.auto ? this.audio?.speak(text, { ...(c?.voice ?? {}), radio, key: who }) : null;
    await Promise.all([this.wait(dur), spoken ?? Promise.resolve()]);
    this.ui.clearLine();
    await this.wait(this.auto ? 0.05 : 0.28);
  }

  caption(text, dur = 3) { return this.ui.caption(text, this.auto ? 0.3 : dur); }
  objective(t) { this.ui.objective(t); }
  notify(t, kind) { this.ui.notify(t, kind); }
  thinking(on, text) { this.ui.thinking(on, text); }
  meter(m) { this.ui.meter(m); }
  fade(to, d) { return this.ui.fade(to, this.auto ? 0.05 : d); }

  async chapterCard(id, title, sub) {
    const k = id === 'prologue' ? 'PROLOGUE' : id === 'epilogue' ? 'EPILOGUE' : id.startsWith('night') ? 'NIGHT ' + id.match(/night(\d+)/)[1] : 'CHAPTER ' + id.replace('ch', '');
    this.ui.objective(null);
    await this.ui.fade(1, this.auto ? 0.05 : 0.6);
    this.audio?.sting('title');
    await this.ui.chapterCard(k, title, sub, this.auto ? 0.2 : 3.4);
    this.ui.fade(0, this.auto ? 0.05 : 1.6);
  }

  async headline(h, by) { await this.ui.headline(h, by); }

  // -------------------------------------------------------------- choices
  async choose(spec) {
    if (this.auto) { await this.wait(0.3); const o = spec.options.find((x) => x.id === spec.default) ?? spec.options[this.autoPick?.(spec) ?? 0]; return { id: o.id }; }
    this.timeScale = 0.6;
    this.audio?.sfx('choice');
    const r = await this.ui.choose(spec);
    this.timeScale = this.paused ? 0.0001 : 1;
    this.audio?.sfx('click');
    return r;
  }

  async qte(spec) {
    if (this.auto) { await this.wait(0.3); return true; }
    this.timeScale = 0.3;
    this.audio?.sfx('heartbeat');
    const ok = await this.ui.qte(spec, (i, good) => this.audio?.sfx(good ? 'success' : 'fail'));
    this.timeScale = this.paused ? 0.0001 : 1;
    return ok;
  }

  // -------------------------------------------------------------- fights
  /** Edited fight choreography: a few cuts, contact, a fall. */
  async fight(kind, who, ok = true) {
    const B = this.actors.batman, V = this.actors[who];
    if (!B || !V) return;
    // put Batman in reach of the target (between cuts)
    const vp = V.position.clone();
    const dir = new Vector3().subVectors(B.position, vp); dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(-1, 0, 0);
    dir.normalize();
    const reach = kind === 'batarang' ? 5 : 0.85;
    B.place(vp.clone().addScaledVector(dir, reach), MathUtils.radToDeg(Math.atan2(-dir.x, -dir.z)));
    V.turnTo(B.position, 0.15);
    B.posture('guard', 0.15); B.emote('determined');
    if (kind === 'batarang') {
      this.cut({ type: 'mls', on: 'batman', angle: 40 });
      B.play('throw'); this.sfx('batarang');
      await this.wait(0.45);
      this.cut({ type: 'cu', on: who, angle: -20 });
      this.sfx('clang'); V.play('flinch'); V.posture(ok ? 'fear_back' : 'gun_aim');
      await this.wait(0.7);
      if (ok) { this.cut({ type: 'ms', on: 'batman', angle: 70 }); await this.fight('takedown', who, true); }
      return;
    }
    this.cut({ type: 'ms', on: 'batman', angle: 65 + Math.random() * 30, handheld: 0.6 });
    const strike = B.play(kind === 'combo' ? 'combo' : 'punch_r');
    await this.wait(0.14); this.sfx('punch'); this.kick(0.6);
    V.play('hit');
    if (kind === 'combo') {
      await this.wait(0.3);
      this.cut({ type: 'cu', on: who, angle: 160 + Math.random() * 30, handheld: 0.8 });
      this.sfx('punch'); this.kick(0.7);
      if (!ok) {
        await this.wait(0.25);
        this.cut({ type: 'ms', on: who, angle: 40, handheld: 0.8 });
        V.play('punch_r'); await this.wait(0.15); this.sfx('punch'); B.play('hit'); this.kick(1);
        await this.wait(0.5);
        B.play('punch_l'); await this.wait(0.12); this.sfx('punch');
      }
    }
    await strike;
    this.cut({ type: 'ws', on: who, angle: 100, height: -0.3, lens: 28 });
    V.play('fall'); this.sfx('fall'); this.kick(0.5);
    V.emote('pained');
    await this.wait(0.9);
    B.posture('idle', 0.6);
  }

  // -------------------------------------------------------------- exploration
  /** Third-person: walk Batman around; E at a hotspot; C to move on once the needed ones are found. */
  explore(spec, visit) {
    const B = this.actors.batman;
    const spots = spec.spots.map((s) => ({ ...s, pos: this._point(s.at) ?? new Vector3(...(this._mark(s.at)?.pos ?? [0, 1, 0])), done: false }));
    if (this.auto) return (async () => { for (const s of spots) { await visit(s); s.done = true; } return spots.map((s) => s.id); })();
    this.ui.objective(spec.objective);
    this.director.followActor(B, { dist: 2.4, shoulder: 0.5 });
    B.posture('idle'); B.lookAt(null);
    const keys = {};
    const kd = (e) => { keys[e.key.toLowerCase()] = true; }, ku = (e) => { keys[e.key.toLowerCase()] = false; };
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    const markers = spots.map((s) => { const d = document.createElement('div'); d.className = 'ov-spot'; d.innerHTML = `<div class="dot"></div><span>${s.label}</span>`; this.ui.spots.appendChild(d); return d; });
    return new Promise((resolve) => {
      let busy = false;
      const cam = this.stageE.camera;
      this._explore = (dt) => {
        // movement relative to the camera
        const f = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
        const t = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
        if (!busy && (f || t)) {
          const fwd = new Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
          const right = new Vector3(-fwd.z, 0, fwd.x);
          const goal = B.position.clone().addScaledVector(fwd, f * 1.2).addScaledVector(right, t * 1.2);
          if (this.set.bounds) { goal.x = MathUtils.clamp(goal.x, this.set.bounds.min.x + 0.5, this.set.bounds.max.x - 0.5); goal.z = MathUtils.clamp(goal.z, this.set.bounds.min.z + 0.5, this.set.bounds.max.z - 0.5); }
          B.walk = { target: goal, speed: keys.shift ? 3.6 : 1.5, run: !!keys.shift, resolve() {}, stopDist: 0.05 };
        } else if (B.walk && !busy) B.walk = null;
        // markers
        let near = null;
        spots.forEach((s, i) => {
          const p = s.pos.clone().project(cam);
          const m = markers[i];
          m.style.display = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 ? '' : 'none';
          m.style.left = ((p.x * 0.5 + 0.5) * 100) + '%'; m.style.top = ((-p.y * 0.5 + 0.5) * 100) + '%';
          const d = Math.hypot(s.pos.x - B.position.x, s.pos.z - B.position.z);
          const isNear = d < 1.8 && !s.done;
          m.classList.toggle('near', isNear); m.classList.toggle('done', s.done);
          if (isNear) near = s;
        });
        const needDone = spec.need.every((id) => spots.find((s) => s.id === id)?.done);
        this.ui.setHint(near ? `E — ${near.label}` : needDone ? 'C — Move on' : 'WASD — Move · Shift — Run');
        if (keys.e && near && !busy) {
          busy = true; keys.e = false;
          B.turnTo(near.pos, 0.4);
          (async () => { await visit(near); near.done = true; busy = false; })();
        }
        if ((keys.c && needDone && !busy) || spots.every((s) => s.done)) {
          this._explore = null;
          removeEventListener('keydown', kd); removeEventListener('keyup', ku);
          markers.forEach((m) => m.remove());
          this.ui.setHint(null); this.ui.objective(null);
          this.director.mode = 'shot';
          resolve(spots.filter((s) => s.done).map((s) => s.id));
        }
      };
    });
  }

  // -------------------------------------------------------------- specials
  async special(name, args = {}) {
    const fn = this.set?.specials?.[name];
    if (fn) await fn(this, args);
  }

  async endCard(runner) {
    this.ui.objective(null);
    await this.ui.fade(1, this.auto ? 0.05 : 2);
    await this.ui.chapterCard('END OF EPISODE 1', 'FIRST NIGHT', 'Your choices shaped Vesper. Here is the night you made.', this.auto ? 0.2 : 4);
    this.endRunner = runner;
  }
}
