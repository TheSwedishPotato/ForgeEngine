import { Vector3, Vector2 } from 'three';
import { JoustSim, FIELD } from '../joust/JoustSim.js';
import { JoustAI } from '../joust/JoustAI.js';
import { HorseMesh } from '../render/HorseMesh.js';
import { RiderMesh, LanceMesh } from '../render/JoustMeshes.js';
import { JOUSTERS, SADDLES, HORSE, RULES, JOUST_SOURCES } from '../data/joust.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const FIXED = 1 / 60;
const GAITS = ['trot', 'canter', 'gallop'];
const CAMS = ['chase', 'helm', 'side'];
const _v = new Vector3(), _v2 = new Vector3(), _n = new Vector3();

/**
 * The joust as a game: the player rides rider 0, an AI rides rider 1.
 *   mouse           where your lance should strike him (the reticle)
 *   left click/Space  brace: lean into the shock (time it)
 *   W / S           spur on / rein in (trot, canter, gallop)
 *   A / D           ride your line closer to him or wider
 *   C               camera: behind, through the helm, from the side
 *   Esc             leave the lists
 */
export class JoustMode {
  constructor({ stage, audio, particles, root, config, playerColors, quality = 'high', onExit, onDone }) {
    this.stage = stage;
    this.audio = audio;
    this.particles = particles;
    this.quality = quality;
    this.onExit = onExit;
    this.onDone = onDone;
    this.config = config;
    this.playerColors = playerColors;
    this.camMode = config.joustCamera ?? 'chase';
    this.foeId = config.joustFoe ?? 'rozmberk';
    this.saddle = config.joustSaddle ?? 'hohenzeug';
    this.tilt = config.joustTilt ?? true;
    this.mouse = new Vector2(innerWidth / 2, innerHeight / 2);
    this.keys = new Set();
    this.excitement = 0;
    this.wallTime = 0;
    this.stepAcc = 0;
    this.timeScale = 1;
    this.paused = false;
    this.camPos = new Vector3();
    this.camAt = new Vector3();
    this._buildUI(root);
    this._bindInput();
    this.start();
  }

  // --- set-up -----------------------------------------------------------------------------

  start() {
    this._disposeMeshes();
    const P = this.config.player;
    const foe = JOUSTERS.find((j) => j.id === this.foeId) ?? JOUSTERS[0];
    this.foe = foe;
    const you = { name: P.name || 'You', heraldry: P.heraldry, colors: this.playerColors(P), skill: 0.85, coat: 'bay' };
    const them = { ...foe, colors: { ...foe.colors } };
    if (them.coat === you.coat) you.coat = 'chestnut';
    this.sim = new JoustSim({ riders: [you, them], seed: (Math.random() * 1e9) | 0, saddle: this.saddle, tilt: this.tilt });
    this.stage.scene.getObjectByName('joust-tilt')?.traverse((o) => { o.visible = this.tilt; });
    this.player = this.sim.a;
    this.ai = new JoustAI(this.sim, this.sim.b, { aim: foe.aim });
    this.player.ctrl.speed = HORSE.gaits.canter + 1;
    this.gaitIx = 1;
    this.horseMeshes = this.sim.horses.map((hh, i) => new HorseMesh(hh, this.sim.riders[i], { quality: this.quality }));
    this.riderMeshes = this.sim.riders.map((r) => new RiderMesh(r, { quality: this.quality }));
    this.lanceMeshes = this.sim.lances.map((l, i) => new LanceMesh(l, this.sim.riders[i].colors));
    for (const m of [...this.horseMeshes, ...this.riderMeshes, ...this.lanceMeshes]) this.stage.scene.add(m.group);
    this.sim.on((e) => this._onEvent(e));
    this.over = false;
    this.slowT = 0;
    this.replay = null;
    this.lastHoof = [0, 0];
    this._fallCheck = null;
    this._fell = false;
    this.result.hidden = true;
    this.el.hidden = false;
    this._scoreboard();
    this.log(`${foe.name}, ${foe.title}. ${SADDLES[this.saddle].native}: ${RULES.courses} courses.`, 'info');
    this.audio.fanfare();
    this._snapCamera();
  }

  _disposeMeshes() {
    for (const m of [...(this.horseMeshes ?? []), ...(this.riderMeshes ?? []), ...(this.lanceMeshes ?? [])]) m.dispose();
    this.horseMeshes = []; this.riderMeshes = []; this.lanceMeshes = [];
  }

  dispose() {
    this._disposeMeshes();
    this.stage.scene.getObjectByName('joust-tilt')?.traverse((o) => { o.visible = false; });
    this.el.remove();
    this.result.remove();
    for (const [t, f, o] of this._listeners) t.removeEventListener(f.type ?? f[0], f.fn ?? f[1], o);
    this.stage.visor = 0;
    this.stage.hurt = 0;
  }

  // --- UI ------------------------------------------------------------------------------------

  _buildUI(root) {
    this.el = h(`<div class="hud joust-hud">
      <div class="jscore">
        <div class="jside you"><b class="jname"></b><span class="jpts"></span><span class="jcourses"></span></div>
        <div class="jmid"><span class="jcourse"></span><small class="jsaddle"></small></div>
        <div class="jside foe"><b class="jname"></b><span class="jpts"></span><span class="jcourses"></span></div>
      </div>
      <div class="reticle"><i></i></div><div class="tipmark"></div>
      <div class="jgait"><b class="g"></b><span class="v"></span><span class="brace">Brace</span></div>
      <div class="log"></div>
      <div class="callout"></div><div class="subcall"></div>
      <div class="hint">Move the mouse to aim the lance · click or Space to brace as you meet · W/S spur or rein in · A/D your line · C camera · Esc leave the lists</div>
      <div class="jtouch ui-interactive"><button data-k="s">Rein</button><button data-k="w">Spur</button><button class="big" data-k="brace">Brace</button></div>
      <button class="pause-btn ui-interactive jquit">Leave</button>
    </div>`);
    this.el.querySelector('.jsaddle').textContent = SADDLES[this.saddle].name;
    this.el.querySelector('.jquit').addEventListener('click', () => this.onExit?.());
    for (const b of this.el.querySelectorAll('.jtouch button')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this._action(b.dataset.k); });
    }
    this.el.querySelector('.jtouch').hidden = !matchMedia('(pointer: coarse)').matches;
    this.logEl = this.el.querySelector('.log');
    this.reticle = this.el.querySelector('.reticle');
    this.tipmark = this.el.querySelector('.tipmark');
    root.appendChild(this.el);
    this.result = h(`<div class="screen dim ui-interactive" hidden><div class="folio narrow">
      <div class="kicker">Gestech · the joust of peace</div>
      <h1 class="title small verdict"></h1>
      <p class="lede how"></p>
      <table class="jtable"></table>
      <p class="fine src"></p>
      <div class="actions"><button class="primary" data-a="again">Ride again</button><button data-a="next">Next challenger</button><button data-a="title">Title</button></div>
    </div></div>`);
    this.result.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'again') this.start();
      else if (a === 'next') { const i = JOUSTERS.findIndex((j) => j.id === this.foeId); this.foeId = JOUSTERS[(i + 1) % JOUSTERS.length].id; this.config.joustFoe = this.foeId; this.start(); }
      else if (a === 'title') this.onExit?.();
    });
    root.appendChild(this.result);
  }

  log(text, kind = '') {
    const line = h(`<div class="line ${kind}">${esc(text)}</div>`);
    this.logEl.prepend(line);
    while (this.logEl.children.length > (innerWidth < 760 ? 3 : 5)) this.logEl.lastChild.remove();
    setTimeout(() => line.classList.add('fade'), 7000);
  }

  callout(text, sub = '', ms = 1800) {
    const c = this.el.querySelector('.callout'), s = this.el.querySelector('.subcall');
    c.textContent = text; s.textContent = sub;
    c.classList.add('show'); s.classList.toggle('show', !!sub);
    clearTimeout(this._co);
    this._co = setTimeout(() => { c.classList.remove('show'); s.classList.remove('show'); }, ms);
  }

  _scoreboard() {
    const sides = this.el.querySelectorAll('.jside');
    this.sim.riders.forEach((r, i) => {
      const s = sides[i];
      s.querySelector('.jname').textContent = r.name;
      s.querySelector('.jpts').textContent = r.score.points;
      // one mark per course: a broken lance, an attaint, a miss, a foul
      s.querySelector('.jcourses').innerHTML = r.score.courses.map((c) => `<i class="m ${c.pts < 0 ? 'foul' : c.strike?.broke ? 'broke' : c.strike ? 'att' : 'miss'}" title="${esc(c.text)}"></i>`).join('');
    });
    this.el.querySelector('.jcourse').textContent = this.sim.over ? 'The joust is done' : `Course ${this.sim.course} of ${RULES.courses}${this.sim.course > RULES.courses ? ' (extra)' : ''}`;
  }

  // --- input --------------------------------------------------------------------------------------

  _bindInput() {
    this._listeners = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); this._listeners.push([t, { type, fn }, o]); };
    on(window, 'pointermove', (e) => { this.mouse.set(e.clientX, e.clientY); });
    on(window, 'pointerdown', (e) => {
      if (e.target.closest?.('.ui-interactive')) return;
      this.mouse.set(e.clientX, e.clientY);
      if (e.button === 0 && e.pointerType !== 'touch') this._action('brace');   // on touch, a drag aims and the BRACE button braces
    });
    on(window, 'keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this._action('brace'); }
      else if (k === 'w' || k === 'arrowup') this._action('w');
      else if (k === 's' || k === 'arrowdown') this._action('s');
      else if (k === 'a' || k === 'arrowleft') this._action('a');
      else if (k === 'd' || k === 'arrowright') this._action('d');
      else if (k === 'c') this._action('cam');
      else if (k === 'escape') this.onExit?.();
    });
  }

  _action(k) {
    const p = this.player, c = p.ctrl;
    if (k === 'brace') { c.brace = true; return; }
    if (k === 'w' || k === 's') {
      this.gaitIx = Math.max(0, Math.min(2, this.gaitIx + (k === 'w' ? 1 : -1)));
      c.speed = { trot: HORSE.gaits.trot, canter: HORSE.gaits.canter + 1, gallop: HORSE.gaits.gallop }[GAITS[this.gaitIx]];
      if (k === 'w') this.audio.snort(0.6);
    }
    if (k === 'a') c.lane = Math.min(0.45, c.lane + 0.15);
    if (k === 'd') c.lane = Math.max(-0.4, c.lane - 0.15);
    if (k === 'cam') { this.camMode = CAMS[(CAMS.indexOf(this.camMode) + 1) % CAMS.length]; this.config.joustCamera = this.camMode; }
  }

  /** The point on him where you want your lance: the reticle, set by the mouse around his shield. */
  _playerAim() {
    const o = this.sim.b;
    const base = o.b.chest.localToWorld(o.ecranche.offset, new Vector3());
    const cam = this.stage.camera;
    // Mouse offset from the screen centre maps to metres on him, in the camera's plane.
    const sx = (this.mouse.x / innerWidth - 0.5) * 2, sy = -(this.mouse.y / innerHeight - 0.5) * 2;
    const right = _v.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    const k = this.camMode === 'helm' ? 0.9 : 0.75;
    base.addScaledVector(right, Math.max(-1, Math.min(1, sx)) * k);
    base.y += Math.max(-1, Math.min(1, sy)) * k * 0.9;
    return base;
  }

  // --- events ------------------------------------------------------------------------------------

  _onEvent(e) {
    const youA = (r) => r === this.player;
    switch (e.type) {
      case 'course':
        this.callout(`Course ${e.n}`, e.n > RULES.courses ? 'an extra course: the score is level' : this.sim.dir > 0 ? '' : 'they ride back the other way', 1700);
        this._scoreboard();
        this._snapCamera();
        break;
      case 'charge':
        this.audio.trumpetCall();
        this.log('The heralds sound: Laissez-les aller!', 'info');
        this.audio.crowd('ooh', 0.6);
        break;
      case 'break': {
        const L = e.lance;
        this.audio.lanceBreak(e.force);
        const dir = L.axis.clone().negate().add(new Vector3(0, 0.4, 0)).normalize();
        this.particles.splinters(e.point, dir, Math.min(1.5, e.force / 8000));
        this.stage.kick?.({ shake: youA(e.target) ? 0.55 : 0.25, aberration: 0.25 });
        this.excitement = 1;
        this.audio.crowd('roar', 0.9);
        this.slowT = 1.1;
        this.replay = { point: e.point.clone(), t: 0 };
        break;
      }
      case 'attaint':
        this.audio.lanceStrike(e.kind === 'helm' || e.zone === 'chest', 0.8);
        this.particles.sparksAt(e.point, 0.5);
        this.stage.kick?.({ shake: youA(e.target) ? 0.4 : 0.15 });
        break;
      case 'unhorse':
        this.audio.crowd('roar', 1);
        this.callout(youA(e.rider) ? 'Unhorsed!' : `${e.rider.name.split(' ')[0]} falls!`, youA(e.rider) ? 'you go over the cantle' : 'borne over his horse\'s crupper', 2500);
        this.log(`${e.rider.name} is unhorsed!`, youA(e.rider) ? 'hurt big' : 'good big');
        this.slowT = 2.2;
        this._fallCheck = e.rider;
        break;
      case 'unhelm':
        this.riderMeshes[e.rider.id].unhelm(e.by.lance.axis.clone());
        this.log(`${e.rider.name}'s helm is struck off!`, youA(e.rider) ? 'hurt big' : 'good big');
        this.audio.clang(80, true);
        break;
      case 'score':
        for (const r of e.results) this.log(`${r.rider.name}: ${r.text}${r.pts ? ` (${r.pts > 0 ? '+' : ''}${r.pts})` : ''}.`, r.pts > 0 ? (youA(r.rider) ? 'good' : 'hurt') : r.pts < 0 ? 'hurt' : '');
        this._scoreboard();
        break;
      case 'end':
        this._scoreboard();
        this.over = true;
        this.audio.crowd('roar', 1);
        setTimeout(() => this._showResult(e), 2400);
        this.callout(e.winner ? (youA(e.winner) ? 'The prize is yours' : `${e.winner.name.split(' ')[0]} wins`) : 'No victor', e.how, 2300);
        break;
      default: break;
    }
  }

  _showResult(e) {
    const won = e.winner === this.player;
    const v = this.result.querySelector('.verdict');
    v.textContent = e.winner ? (won ? 'Victory' : 'Defeat') : 'A draw';
    v.classList.toggle('win', won);
    this.result.querySelector('.how').textContent = `${e.winner ? e.winner.name + ' wins' : 'Neither man wins'}: ${e.how}.`;
    const rows = this.sim.a.score.courses.map((c, i) => {
      const d = this.sim.b.score.courses[i];
      return `<tr><td>${c.n}</td><td>${esc(c.text)} <b>${c.pts > 0 ? '+' + c.pts : c.pts || ''}</b></td><td>${esc(d?.text ?? '')} <b>${d?.pts > 0 ? '+' + d.pts : d?.pts || ''}</b></td></tr>`;
    }).join('');
    this.result.querySelector('.jtable').innerHTML = `<tr><th></th><th>${esc(this.sim.a.name)} · ${this.sim.a.score.points}</th><th>${esc(this.sim.b.name)} · ${this.sim.b.score.points}</th></tr>${rows}`;
    this.result.querySelector('.src').textContent = `Scoring after ${JOUST_SOURCES.banda.short} and ${JOUST_SOURCES.tiptoft.short}; no herald's rules from Bohemia survive for 1403. ${SADDLES[this.saddle].text}`;
    this.result.hidden = false;
    this.el.hidden = true;
    this.onDone?.(won);
  }

  // --- per frame ----------------------------------------------------------------------------------

  frame(dt) {
    this.wallTime += dt;
    const sim = this.sim;
    // Slow motion for the moment the lances meet, and for a fall.
    this.slowT = Math.max(0, this.slowT - dt);
    const target = this.slowT > 0 ? 0.22 : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * (target < this.timeScale ? 20 : 2.5));
    this.stepAcc += dt * this.timeScale;
    let n = 0;
    while (this.stepAcc >= FIXED && n < 4) {
      if (sim.phase === 'charge') this.player.ctrl.aim = this._playerAim();
      else this.player.ctrl.aim = null;
      this.ai.update();
      sim.step();
      this.stepAcc -= FIXED;
      n++;
    }
    if (n === 4) this.stepAcc = 0;
    this._sounds();
    for (const m of this.horseMeshes) m.update(dt * this.timeScale);
    for (const m of this.riderMeshes) m.update(dt * this.timeScale);
    for (const m of this.lanceMeshes) m.update();
    // a fresh lance after a break: the squire hands it up
    sim.lances.forEach((l, i) => {
      if (this.lanceMeshes[i].lance !== l) {
        this.lanceMeshes[i].dispose();
        this.lanceMeshes[i] = new LanceMesh(l, sim.riders[i].colors);
        this.stage.scene.add(this.lanceMeshes[i].group);
      }
    });
    if (this._fallCheck && !this._fallCheck.seated && this._fallCheck.b.pelvis.pos.y < 0.4 && !this._fell) { this._fell = true; this.audio.armourFall(); this.particles.dust(this._fallCheck.b.pelvis.pos.clone().setY(0.05), 1); }
    this.excitement = Math.max(0, this.excitement - dt * 0.3);
    this._camera(dt);
    this._hud();
  }

  _sounds() {
    const cam = this.stage.camera.position;
    this.sim.horses.forEach((hh, i) => {
      if (hh.speed < 0.2) return;
      // four footfalls per stride
      const beats = 4;
      const k = Math.floor(hh.phase * beats);
      if (k !== this.lastHoof[i]) {
        this.lastHoof[i] = k;
        const d = cam.distanceTo(hh.body.pos);
        const g = Math.min(1, 6 / (d + 3)) * (i === 0 && this.camMode === 'helm' ? 1.2 : 1);
        this.audio.hoof(g, hh.speed);
        if (k === 0) this.audio.tack(g);
      }
    });
  }

  _snapCamera() {
    this._camera(1, true);
  }

  _camera(dt, snap = false) {
    const cam = this.stage.camera, p = this.player, o = this.sim.b;
    const hb = p.horse.body;
    const fwd = _v.set(Math.sin(p.horse.yaw), 0, Math.cos(p.horse.yaw));
    let pos = new Vector3(), at = new Vector3(), fov = 55, mode = this.camMode;
    const meeting = this.replay && this.slowT > 0;
    if (meeting && mode !== 'helm') mode = 'impact';
    if (!p.seated && mode === 'helm') mode = 'chase';
    if (mode === 'helm') {
      const head = p.b.head;
      pos.copy(head.pos).add(_v2.set(0, 0.05, 0.1).applyQuaternion(head.q));
      at.copy(o.b.chest.pos);
      if (this.sim.phase !== 'charge' || this.sim.closing() < 1) at.copy(pos).addScaledVector(fwd, 10);
      fov = 62;
    } else if (mode === 'side') {
      const mid = new Vector3().addVectors(p.b.chest.pos, o.b.chest.pos).multiplyScalar(0.5);
      mid.x = Math.max(FIELD.center.x - 40, Math.min(FIELD.center.x + 40, mid.x));
      // above the tilt when there is one
      pos.set(mid.x, this.tilt ? 5.0 : 2.2, FIELD.center.z - FIELD.halfWidth + 1.2);
      at.set(mid.x, this.tilt ? 1.5 : 1.7, FIELD.center.z);
      fov = this.sim.closing() > 20 ? 50 : 42;
    } else if (mode === 'impact') {
      pos.copy(this.replay.point).add(_v2.set(0, 0.6, -6.5));
      at.copy(this.replay.point);
      fov = 40;
    } else {
      // behind and to the right of your horse, looking down the run at him
      const right = _n.set(-fwd.z, 0, fwd.x).negate();
      pos.copy(hb.pos).addScaledVector(fwd, -5.2).addScaledVector(right, 1.6);
      pos.y = 3.1;
      at.copy(p.seated ? o.b.chest.pos : p.b.pelvis.pos);
      if (this.sim.phase !== 'charge') at.copy(hb.pos).addScaledVector(fwd, 12).setY(2);
      if (!p.seated) { pos.copy(p.b.pelvis.pos).add(_v2.set(-4, 2.5, -4)); }
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * (mode === 'helm' ? 30 : 6));
    this.camPos.lerp(pos, k);
    this.camAt.lerp(at, mode === 'helm' ? k : 1 - Math.exp(-dt * 4));
    if (snap) this.camAt.copy(at);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camAt);
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, snap ? 1 : dt * 3); cam.updateProjectionMatrix(); }
    this.stage.focusPoint = o.b.head.pos;
    this.stage.shadowFocus = [p.b.head.pos, p.b.footL.pos, p.horse.body.pos];
    this.stage.setPeople?.(this.sim.riders.map((r) => r.ragdoll));
    this.stage.dofAmount = mode === 'impact' ? 0.8 : mode === 'helm' ? 0 : 0.25;
    this.stage.visor = mode === 'helm' && !p.helmOff ? 1 : 0;
  }

  _hud() {
    const p = this.player, sim = this.sim;
    const g = this.el.querySelector('.jgait');
    g.querySelector('.g').textContent = p.horse.gait;
    g.querySelector('.v').textContent = `${(p.horse.speed * 3.6).toFixed(0)} km/h · aiming for ${GAITS[this.gaitIx]}`;
    g.querySelector('.brace').className = 'brace' + (p.braceT > 0 ? ' on' : p.braceCool > 0 ? ' cool' : '');
    // reticle: where you want to strike; the small mark: where your lance points now
    const show = sim.phase === 'charge' && p.seated && sim.b.seated && sim.closing() > 0.5;
    this.reticle.hidden = this.tipmark.hidden = !show;
    if (!show) return;
    const cam = this.stage.camera;
    const aim = p.ctrl.aim ?? this._playerAim();
    const s = aim.clone().project(cam);
    this.reticle.style.transform = `translate(${((s.x + 1) / 2) * innerWidth}px, ${((1 - s.y) / 2) * innerHeight}px)`;
    // where the head of your lance will pass him if you hold it as it is:
    // the closest approach of the tip to the aim point along their relative motion
    const l = p.lance, o = sim.b;
    const w = l.restPoint.addScaledVector(l.axis, l.reach).sub(aim);
    const vrel = _v.subVectors(p.horse.body.vel, o.horse.body.vel).setY(0);
    const vv = vrel.lengthSq();
    if (vv > 0.01) w.addScaledVector(vrel, -w.dot(vrel) / vv);
    const t = w.add(aim).project(cam);
    this.tipmark.style.transform = `translate(${((t.x + 1) / 2) * innerWidth}px, ${((1 - t.y) / 2) * innerHeight}px)`;
  }
}

