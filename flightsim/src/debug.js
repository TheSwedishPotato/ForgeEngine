// Debug mode (F3 or the key left of 1): live readouts of the flight model, flight controls,
// autoflight, crew, ATC, weather, cabin and boarding; strip charts; the error log; frame
// statistics; and tools: time scale, fast-forward, event injection, failures, teleports, a free
// camera, and force vectors drawn on the aircraft.
import * as THREE from 'three';
import { SCENARIOS } from './events.js';
import { CG_POINT } from './physics.js';
import { FACADE_Z } from './boarding.js';
import { DEG, KT, FT, G, clamp } from './core.js';

const CSS = `
#dbg{position:fixed;left:8px;top:8px;bottom:8px;width:430px;z-index:60;background:rgba(8,12,18,.88);color:#cfe3ff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;border:1px solid #2b3b55;border-radius:8px;display:flex;flex-direction:column;pointer-events:auto}
#dbg[hidden]{display:none}
#dbg .bar{display:flex;flex-wrap:wrap;gap:4px;padding:6px;border-bottom:1px solid #2b3b55}
#dbg button{font:inherit;background:#17233a;color:#cfe3ff;border:1px solid #33496d;border-radius:4px;padding:2px 6px;cursor:pointer}
#dbg button.on{background:#2d5bd1;color:#fff}
#dbg .tabs button{border-radius:4px 4px 0 0}
#dbg .body{overflow:auto;padding:6px 8px;flex:1;white-space:pre}
#dbg canvas{display:block;margin:4px 8px;border:1px solid #2b3b55;background:#060a10}
#dbg h4{margin:6px 0 2px;color:#ffd166;font-size:11px}
#dbg .err{color:#ff8a80}
#dbg select{font:inherit;background:#17233a;color:#cfe3ff;border:1px solid #33496d}
`;
const TABS = ['Flight', 'Controls', 'Crew/ATC', 'World', 'Cabin', 'Perf', 'Log'];
const TRACES = [
  { k: 'ias', label: 'IAS kt', col: '#35e05a', lo: 0, hi: 350 },
  { k: 'alt', label: 'ALT ft/100', col: '#29c5ff', lo: 0, hi: 400 },
  { k: 'vs', label: 'V/S fpm/20', col: '#e94ce0', lo: -200, hi: 200 },
  { k: 'pitch', label: 'pitch °×5', col: '#ffd166', lo: -100, hi: 100 },
  { k: 'bank', label: 'bank °×2', col: '#ff8a80', lo: -100, hi: 100 },
  { k: 'alpha', label: 'α °×5', col: '#b388ff', lo: -50, hi: 100 },
  { k: 'nz', label: 'nz×100', col: '#ffffff', lo: 0, hi: 250 },
  { k: 'n1', label: 'N1 %', col: '#ffab40', lo: 0, hi: 110 },
];

export class Debug {
  constructor(S, api) {
    this.S = S; this.api = api;
    this.on = false; this.tab = 'Flight'; this.textT = 0; this.sampleT = 0;
    this.hist = []; this.errors = []; this.frames = []; this.lastT = performance.now();
    this.free = null; this.forces = null;
    this._captureErrors();
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const el = this.el = document.createElement('div'); el.id = 'dbg'; el.hidden = true;
    el.innerHTML = `<div class="bar"><b style="color:#ffd166">DEBUG</b>
      <button data-a="pause">Pause sim</button><button data-a="s0.25">×¼</button><button data-a="s1">×1</button><button data-a="s4">×4</button><button data-a="s16">×16</button><button data-a="ff60">+60 s</button><button data-a="ff600">+10 min</button>
      <button data-a="free">Free camera</button><button data-a="forces">Forces</button><button data-a="close">✕</button></div>
      <div class="bar"><select data-a="event"><option value="">Inject event…</option>${SCENARIOS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
      <button data-a="eng1">Fail eng 1</button><button data-a="eng2">Fail eng 2</button><button data-a="fire1">Fire eng 1</button><button data-a="hydg">Lose green hyd</button><button data-a="depr">Depressurise</button><button data-a="cat">CAT</button></div>
      <div class="bar"><button data-a="tpSeat">→ Seat</button><button data-a="tpDeck">→ Flight deck</button><button data-a="tpGate">→ Gate</button><button data-a="door">Unlock cockpit door</button><button data-a="board">Skip boarding</button><button data-a="clr">Clear log</button></div>
      <div class="bar tabs">${TABS.map((t) => `<button data-tab="${t}">${t}</button>`).join('')}</div>
      <canvas width="412" height="150"></canvas>
      <div class="body"></div>`;
    document.body.appendChild(el);
    this.body = el.querySelector('.body'); this.chart = el.querySelector('canvas');
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tab) { this.tab = b.dataset.tab; this.textT = 0; this._tabs(); } else this._action(b.dataset.a, b); });
    el.querySelector('select').addEventListener('change', (e) => { const id = e.target.value; if (id) { this.S.incidents.trigger(id); this.log(`event injected: ${id}`); } e.target.value = ''; });
    for (const ev of ['keydown', 'keyup', 'mousedown', 'wheel']) el.addEventListener(ev, (e) => e.stopPropagation());
    this._tabs();
  }

  // ---------------- errors ----------------
  _captureErrors() {
    const push = (kind, msg) => { this.errors.push(`${new Date().toISOString().slice(11, 19)} ${kind} ${msg}`); if (this.errors.length > 200) this.errors.shift(); };
    window.addEventListener('error', (e) => push('ERROR', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => push('REJECT', String(e.reason && (e.reason.stack || e.reason.message) || e.reason)));
    for (const k of ['error', 'warn']) { const orig = console[k].bind(console); console[k] = (...a) => { push(k.toUpperCase(), a.map((x) => (x && x.stack) || String(x)).join(' ').slice(0, 400)); orig(...a); }; }
    this.log = (m) => push('INFO', m);
  }

  toggle(v = !this.on) {
    this.on = v; this.el.hidden = !v;
    this.S.renderer.info.autoReset = !v;
    if (!v) { this._setFree(false); this._setForces(false); }
    if (v && document.pointerLockElement) { this.S._noPauseOnUnlock = true; document.exitPointerLock(); }
  }
  _tabs() { for (const b of this.el.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab); }

  _action(a, btn) {
    const S = this.S, fm = S.fm, P = S.player;
    if (a === 'close') return this.toggle(false);
    if (a === 'pause') { S.paused = !S.paused; btn.classList.toggle('on', S.paused); return; }
    if (a && a[0] === 's' && !isNaN(+a.slice(1))) { S.speed = +a.slice(1); return; }
    if (a === 'ff60' || a === 'ff600') { const n = a === 'ff60' ? 60 : 600; this.api.run(n); this.log(`fast-forward ${n} s → ${fm.phase}`); return; }
    if (a === 'free') return this._setFree(!this.free);
    if (a === 'forces') return this._setForces(!this.forces);
    if (a === 'eng1') return fm.failEngine(0, 2);
    if (a === 'eng2') return fm.failEngine(1, 2);
    if (a === 'fire1') { fm.engFire[0] = true; return; }
    if (a === 'hydg') { fm.hyd.green = false; return; }
    if (a === 'depr') return fm.depressurise(1);
    if (a === 'cat') return S.atmo.addCAT?.(4.0, 40, 15, 0.25);
    if (a === 'door') { S.cabin.cockpitDoor.locked = false; S.deckAccess = true; this.log('cockpit door unlocked'); return; }
    if (a === 'board') { if (S.boarding && !S.boarding.complete) S.boarding.skipToSeat(); return; }
    if (a === 'clr') { this.errors.length = 0; return; }
    if (a === 'tpSeat') { if (P.state === 'jump') P.leaveJump(); P.state = 'standing'; P.pos.set(0, 0, P.seat.z - 0.28); P.sitDown(); return; }
    if (a === 'tpDeck') { S.cabin.cockpitDoor.locked = false; S.cabin.cockpitDoor.target = S.cabin.cockpitDoor.open = 1; if (P.state === 'seated') { P.belt = false; P.tray = false; P.standUp(); } P.state = 'standing'; P.pos.set(0, 0, -3.75); P.yaw = 0; return; }
    if (a === 'tpGate') { if (!S.boarding || S.boarding.hidden) { this.log('the gate is gone once the aircraft has left the stand'); return; } if (P.state === 'seated') { P.belt = false; P.tray = false; P.standUp(); } P.state = 'standing'; S.boarding.playerScanned = true; P.pos.set(6, 0, FACADE_Z - 1.5); P.yaw = 2.52; }
  }

  // ---------------- free camera ----------------
  _setFree(on) {
    const S = this.S;
    if (on && !this.free) {
      const c = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 2000);
      c.position.copy(S.player.camera.position); c.rotation.order = 'YXZ';
      this.free = { cam: c, yaw: S.player.yaw, pitch: S.player.pitch, prevView: S.view };
      S.view = 'free';
    } else if (!on && this.free) { S.view = this.free.prevView === 'free' ? 'cabin' : this.free.prevView; this.free = null; }
    this.el.querySelector('[data-a="free"]').classList.toggle('on', !!this.free);
  }
  look(dx, dy) { const f = this.free; if (!f) return; f.yaw -= dx * 0.0025; f.pitch = clamp(f.pitch - dy * 0.0025, -1.5, 1.5); }
  freeCamera(dt, keys) {
    const f = this.free; if (!f) return null;
    const c = f.cam, sp = (keys.ShiftLeft ? 25 : 4) * dt;
    const fw = new THREE.Vector3(-Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch));
    const rt = new THREE.Vector3(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    if (keys.KeyW) c.position.addScaledVector(fw, sp); if (keys.KeyS) c.position.addScaledVector(fw, -sp);
    if (keys.KeyD) c.position.addScaledVector(rt, sp); if (keys.KeyA) c.position.addScaledVector(rt, -sp);
    if (keys.KeyE) c.position.y += sp; if (keys.KeyQ) c.position.y -= sp;
    c.rotation.set(f.pitch, f.yaw, 0); c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); c.updateMatrixWorld();
    return c;
  }

  // ---------------- force vectors ----------------
  _setForces(on) {
    const S = this.S;
    if (on && !this.forces) {
      const g = new THREE.Group(); g.position.set(...CG_POINT);
      const mk = (col) => { const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, col, 0.8, 0.5); a.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.stencilWrite = true; o.material.stencilRef = 1; o.material.stencilFunc = THREE.EqualStencilFunc; } o.renderOrder = 10; }); g.add(a); return a; };
      this.forces = { g, lift: mk('#35e05a'), drag: mk('#ff5252'), thrust: mk('#29c5ff'), weight: mk('#ffffff'), ground: mk('#ffd166'), side: mk('#e94ce0') };
      S.extScene.add(g);
    } else if (!on && this.forces) { S.extScene.remove(this.forces.g); this.forces = null; }
    this.el.querySelector('[data-a="forces"]').classList.toggle('on', !!this.forces);
  }
  _updateForces() {
    const F = this.forces, fm = this.S.fm, d = fm.dbgF; if (!F || !d) return;
    const W = fm.mass * G, k = 12 / W; // 12 m per aircraft weight
    const set = (a, v) => { const L = Math.hypot(v[0], v[1], v[2]); a.visible = L * k > 0.15; if (!a.visible) return; a.setDirection(new THREE.Vector3(v[0] / L, v[1] / L, v[2] / L)); a.setLength(Math.max(0.3, L * k), Math.min(1.2, L * k * 0.25), Math.min(0.7, L * k * 0.15)); };
    set(F.lift, d.lift); set(F.drag, d.drag); set(F.thrust, d.thrust); set(F.side, d.side);
    const q = new THREE.Quaternion(fm.Q.x, fm.Q.y, fm.Q.z, fm.Q.w).invert();
    const w = new THREE.Vector3(0, -W, 0).applyQuaternion(q); set(F.weight, [w.x, w.y, w.z]);
    set(F.ground, [d.ground.x, d.ground.y, d.ground.z]);
  }

  // ---------------- per frame ----------------
  beginFrame() { if (this.on) this.S.renderer.info.reset(); }
  update(realDt) {
    const now = performance.now(); this.frames.push(now - this.lastT); this.lastT = now; if (this.frames.length > 120) this.frames.shift();
    const S = this.S, fm = S.fm;
    // strip-chart samples on simulation time, kept for 3 minutes
    if (fm.t - this.sampleT >= 0.5) {
      this.sampleT = fm.t;
      this.hist.push({ t: fm.t, ias: fm.ias, alt: fm.altInd / FT / 100, vs: fm.vs / FT * 60 / 20, pitch: fm.pitch / DEG * 5, bank: fm.bank / DEG * 2, alpha: fm.alpha / DEG * 5, nz: fm.nz * 100, n1: Math.max(fm.n1[0], fm.n1[1]) * 100 });
      if (this.hist.length > 360) this.hist.shift();
    }
    if (!this.on) return;
    this._updateForces();
    this.textT -= realDt; if (this.textT > 0) return; this.textT = 0.2;
    this._drawChart();
    this.body.innerHTML = this._text();
  }

  _drawChart() {
    const c = this.chart, g = c.getContext('2d'), W = c.width, H = c.height, h = this.hist;
    g.fillStyle = '#060a10'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#1b2638'; for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, y * H / 4); g.lineTo(W, y * H / 4); g.stroke(); }
    if (h.length < 2) return;
    const t0 = h[h.length - 1].t - 180;
    TRACES.forEach((tr, i) => {
      g.strokeStyle = tr.col; g.lineWidth = 1.2; g.beginPath();
      h.forEach((p, j) => { const x = (p.t - t0) / 180 * W, y = H - (clamp(p[tr.k], tr.lo, tr.hi) - tr.lo) / (tr.hi - tr.lo) * H; if (j) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      g.fillStyle = tr.col; g.font = '9px monospace'; g.fillText(tr.label, 4 + (i % 4) * 102, 10 + Math.floor(i / 4) * 11);
    });
  }

  _text() {
    const S = this.S, fm = S.fm, a = fm.afs, c = fm.ctl, f = (x, n = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(n)), deg = (x) => f(x / DEG, 1);
    const L = [];
    const H = (t) => L.push(`<h4>${t}</h4>`);
    if (this.tab === 'Flight') {
      H('state');
      L.push(`phase ${fm.phase}  t ${f(fm.t, 0)} s  s ${f(fm.s, 0)} m  dist to go ${f((fm.m.stand - fm.s) / 1852, 1)} NM  xtk ${f(fm.xtk, 1)} m`);
      L.push(`alt ${f(fm.altInd / FT, 0)} ft ind  ${f(fm.h / FT, 0)} ft geo  AGL ${f(fm.agl / FT, 0)} ft  baro ${fm.baro ?? 'STD'}`);
      L.push(`IAS ${f(fm.ias, 1)} kt  TAS ${f(fm.tas / KT, 1)}  GS ${f(fm.gs / KT, 1)}  M ${f(fm.mach, 3)}  V/S ${f(fm.vs / FT * 60, 0)} fpm`);
      L.push(`pitch ${deg(fm.pitch)}°  bank ${deg(fm.bank)}°  hdg ${f(((fm.heading / DEG) + 360) % 360, 1)}°  trk ${f(((fm.track / DEG) + 360) % 360, 1)}°`);
      L.push(`α ${deg(fm.alpha)}°  β ${deg(fm.beta)}°  γ ${deg(fm.gamma)}°  p/q/r ${deg(fm.p)}/${deg(fm.q)}/${deg(fm.r)} °/s`);
      L.push(`α prot ${deg(fm.alphaProt)}  floor ${deg(fm.alphaFloor)}  max ${deg(fm.alphaMax)}  stall ${deg(fm.alphaStall)}  ${fm.stallWarn ? 'STALL WARN' : ''}`);
      H('aerodynamics');
      L.push(`q ${f(fm.qbar, 0)} Pa  CL ${f(fm.CL, 3)}  CD ${f(fm.CD, 4)}  L/D ${f(fm.CL / Math.max(fm.CD, 1e-4), 1)}  lift ${f(fm.lift / 1000, 1)} kN  drag ${f(fm.drag / 1000, 1)} kN`);
      L.push(`nz ${f(fm.nz, 2)}  ny ${f(fm.ny, 2)}  nx ${f(fm.nx, 2)}  buffet ${f(fm.buffet, 2)}  overspeed ${fm.overspeed}`);
      H('mass');
      L.push(`mass ${f(fm.mass, 0)} kg  fuel ${f(fm.fuel, 0)} kg  payload ${fm.payload} kg`);
      H('engines');
      for (let i = 0; i < 2; i++) L.push(`ENG${i + 1} ${fm.engineRunning[i] ? 'RUN ' : fm.engStart[i] ? 'START' : 'OFF '} N1 ${f(fm.n1[i] * 100, 1)} (cmd ${f(fm.n1Cmd[i] * 100, 1)}) N2 ${f(fm.n2[i] * 100, 1)} EGT ${f(fm.egt[i], 0)} FF ${f((fm.ff?.[i] || 0) * 3600, 0)} kg/h T ${f(fm.thrust[i] / 1000, 1)} kN ${fm.engFail[i] ? 'FAIL' + fm.engFail[i] : ''}${fm.engFire[i] ? ' FIRE' : ''} ${fm.engStart[i] ? fm.engStart[i].phase : ''}`);
      H('ground');
      L.push(`WoW ${fm.wow.map((w) => (w ? 1 : 0)).join('')}  struts ${fm.strutC.map((x) => f(x, 3)).join('/')}  steer ${deg(fm.steer)}°  brakes L${f(fm.brakeL, 2)} R${f(fm.brakeR, 2)} park ${fm.parkBrake}`);
      if (fm.tug) L.push(`tug ${fm.tug.state}  F ${f(fm.tug.F / 1000, 1)} kN  steer ${deg(fm.tug.steer)}°  along ${f(fm.tug.sAt, 1)}/${f(fm.tug.len, 1)} m`);
      if (Object.keys(fm.damage || {}).length) L.push(`<span class="err">damage ${Object.keys(fm.damage).join(', ')}</span>`);
    } else if (this.tab === 'Controls') {
      H('pilot inputs');
      L.push(`stick X ${f(c.stickX, 2)} Y ${f(c.stickY, 2)}  pedal ${f(c.pedal, 2)}  tiller ${f(c.tiller, 2)}  toe L ${f(c.brakeL, 2)} R ${f(c.brakeR, 2)}`);
      L.push(`thrust levers ${f(c.thr[0], 2)} / ${f(c.thr[1], 2)}  flap lever ${c.flapLever}  gear ${c.gearLever ? 'DOWN' : 'UP'}  speed brake ${f(c.speedbrake, 2)}  spoilers armed ${c.spoilersArmed}`);
      L.push(`autobrake ${c.autobrake}  park brake ${c.parkBrake}  masters ${c.engMaster.map((m) => (m ? 'ON' : 'OFF')).join('/')}  mode ${c.engMode}`);
      H('surfaces');
      L.push(`elevator ${deg(fm.de)}°  THS ${deg(fm.ths)}°  aileron ${deg(fm.da)}°  rudder ${deg(fm.dr)}°  spoilers ${f(fm.spoiler, 2)} gnd ${f(fm.groundSpoiler, 2)}  reverse ${f(fm.reverse, 2)}`);
      L.push(`config ${fm.cfg} → ${fm.cfgTarget}  slats ${f(fm.slat, 1)}°  flaps ${f(fm.flap, 1)}°  gear ${f(fm.gear, 2)}`);
      H('fly-by-wire');
      L.push(`law ${fm.law}  mode ${fm.fbwMode}  hyd G${fm.hyd.green ? 1 : 0} B${fm.hyd.blue ? 1 : 0} Y${fm.hyd.yellow ? 1 : 0}`);
      H('autoflight');
      const m = a.fma();
      L.push(`FMA  ${m.thr} | ${m.vert} | ${m.lat} | ${m.ap}`);
      L.push(`phase ${a.phase}  AP ${a.ap}  A/THR ${a.athr} active ${a.athrActive}  FD ${a.fd}`);
      L.push(`FCU spd ${a.fcu.spd ?? 'managed'} hdg ${a.fcu.hdg ?? 'NAV'} alt ${a.fcu.alt} vs ${a.fcu.vs ?? '—'}  target spd ${f(a.spdTarget, 0)}  n1 cmd ${f(a.n1Cmd * 100, 1)}`);
      L.push(`V1 ${f(a.v1, 0)} VR ${f(a.vr, 0)} V2 ${f(a.v2, 0)}  loc dev ${f(a.locDev, 2)} gs dev ${f(a.gsDev, 2)}`);
    } else if (this.tab === 'Crew/ATC') {
      const cr = S.crew;
      H('crew');
      L.push(`PF ${cr.pf.name}  PM ${cr.pm.name}  hands: ${cr.mode}  levers ${cr.lev.map((x) => f(x, 2)).join('/')}  brakes ${f(cr.brk, 2)}`);
      L.push(`boarding done ${!!cr.boardingDone}  diverting ${cr.diverting ? cr.diverting.rwy : '—'}  go-arounds ${cr.goArounds}  tasks ${cr.tasks.length}`);
      L.push(`procedure memory: ${Object.entries(cr.st).filter(([, v]) => v !== false && v != null).map(([k, v]) => (typeof v === 'number' ? `${k}=${f(v, 0)}` : k)).join(' ')}`);
      H('ATC');
      const at = S.atc;
      L.push(`unit ${at.unit}  runways ${at.depRwy} → ${at.arrRwy}`);
      L.push(`clearances ${Object.entries(at.cl).filter(([, v]) => v).map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(' ')}`);
      L.push(`traffic ${at.traffic.length}  queued calls ${at.queue.length}`);
      for (const m of at.msgs.slice(-8)) L.push(`  ${m.who}: ${m.text}`.slice(0, 110));
    } else if (this.tab === 'World') {
      const at = S.atmo, w = fm.wind || {};
      H('air at the aircraft');
      L.push(`wind ${f(Math.hypot(w.wx || 0, w.wz || 0) / KT, 1)} kt  vertical ${f(w.wy, 2)} m/s  turbulence σ ${f(at.sigma, 2)}  hazards ${(at.hazards || []).map((z) => z.kind).join(',') || '—'}`);
      L.push(`OAT ${f(at.oat, 1)} °C  ρ ${f(fm.air?.rho, 3)}  in cloud ${!!at.inCloud}  rain ${f(at.rain, 2)} mm/h  visibility ${f(at.visM, 0)} m`);
      L.push(`cabin alt ${f(fm.cabinAlt / FT, 0)} ft  pressurised ${fm.pressurised}`);
      H('weather');
      L.push(S.wx.metar('ARN')); L.push(S.wx.metar('CPH'));
      H('clock and sun');
      const lh = S.opts.startClock + S.director.t / 3600;
      L.push(`local ${Math.floor(lh)}:${String(Math.floor((lh % 1) * 60)).padStart(2, '0')}  sun elevation ${f(S.world.sunEl, 1)}°  night ${f(S.env?.nightK, 2)}`);
      L.push(`position x ${f(fm.pos.x, 0)} z ${f(fm.pos.z, 0)}  airport ${fm.airport || '—'}`);
    } else if (this.tab === 'Cabin') {
      const P = S.player, D = S.director, B = S.boarding;
      H('player');
      L.push(`state ${P.state}  seat ${P.seat.id}  pos ${f(P.pos.x, 2)}, ${f(P.pos.z, 2)}  eye y ${f(P.eye.y, 2)}  belt ${P.belt}  tray ${P.tray}  recline ${P.recline}`);
      L.push(`hypoxia ${f(S.hypoxia || 0, 2)}  mask ${!!P.maskOn}  fallen ${!!P.fallen}`);
      H('cabin');
      L.push(`seatbelt sign ${D.seatbelt}  lights ${f(D.lightLevel, 2)}  scene ${D.scene}  crew seated ${D.crewSeated}  demo ${D.demoDone}  check ${D.checkDone}`);
      L.push(`L1 door ${f(S.cabin.doors.L1.open, 2)}  cockpit door ${f(S.cabin.cockpitDoor.open, 2)} ${S.cabin.cockpitDoor.locked ? 'locked' : 'unlocked'}  walkers ${S.people.walkers.length}`);
      L.push(`cabin dynamics severity ${f(S.cabinDyn.severity, 2)}  nz range ${f(S.cabinDyn.minNz, 2)}..${f(S.cabinDyn.maxNz, 2)}`);
      L.push(`director marks: ${Object.keys(D.times).join(' ')}`);
      if (B) { H('boarding'); L.push(`called group ${B.called}  waiting ${B.queue.length}  walking ${B.active.length}  player group ${B.playerGroup} scanned ${B.playerScanned} aboard ${B.playerAboard}  doors closed ${B.doorClosed}  bridge ${f(B.retract, 2)}`); }
      H('incidents'); L.push(`mode ${S.incidents.mode ?? ''}  active ${(S.incidents.active || []).map((x) => x.id).join(', ') || '—'}  planned ${(S.incidents.plan || []).length}`);
    } else if (this.tab === 'Perf') {
      const fr = this.frames, avg = fr.reduce((s, x) => s + x, 0) / Math.max(1, fr.length), worst = Math.max(...fr);
      const info = S.renderer.info;
      H('frame');
      L.push(`fps ${f(1000 / avg, 1)}  frame ${f(avg, 1)} ms  worst ${f(worst, 1)} ms  speed ×${S.speed}${S.paused ? ' paused' : ''}`);
      L.push(`draw calls ${info.render.calls}  triangles ${info.render.triangles}  lines ${info.render.lines}  points ${info.render.points}`);
      L.push(`geometries ${info.memory.geometries}  textures ${info.memory.textures}  programs ${info.programs?.length ?? '—'}`);
      const pr = S.renderer.getPixelRatio(), sz = S.renderer.getDrawingBufferSize(new THREE.Vector2());
      L.push(`buffer ${sz.x}×${sz.y} (ratio ${f(pr, 2)})  quality ${S.opts.quality}`);
      if (performance.memory) L.push(`JS heap ${f(performance.memory.usedJSHeapSize / 1048576, 0)} / ${f(performance.memory.jsHeapSizeLimit / 1048576, 0)} MB`);
      H('scene'); L.push(`cabin objects ${countObj(S.cabinScene)}  exterior ${countObj(S.extScene)}  world ${countObj(S.world.scene)}`);
    } else {
      H(`log (${this.errors.length})`);
      for (const e of this.errors.slice(-120).reverse()) L.push(`<span class="${/ERROR|REJECT/.test(e) ? 'err' : ''}">${escapeHtml(e)}</span>`);
      if (!this.errors.length) L.push('no errors or warnings');
    }
    return L.join('\n');
  }
}
function countObj(sc) { let n = 0; sc.traverse(() => n++); return n; }
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
