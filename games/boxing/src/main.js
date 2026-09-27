import { Vector3, Quaternion } from 'three';
import { FightSim } from './game/FightSim.js';
import { DamageModel } from './game/Damage.js';
import { BoxerAI } from './game/AI.js';
import { Match } from './game/Match.js';
import { Input } from './game/Input.js';
import { Audio } from './game/Audio.js';
import { HUD, SETTINGS_DEFAULT } from './game/HUD.js';
import { Stage } from './render/Stage.js';
import { Arena } from './render/Arena.js';
import { BoxerMesh, SKIN_TONES } from './render/BoxerMesh.js';
import { CameraRig } from './render/CameraRig.js';
import { Particles } from './render/Particles.js';
import { DebugDraw } from './render/DebugDraw.js';

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------
// Settings (remembered per browser when storage is available)

function loadSettings() {
  let s = { ...SETTINGS_DEFAULT };
  try {
    const raw = localStorage.getItem('forge-boxing-settings');
    if (raw) s = { ...s, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!s._init) {
    // First run: pick a sensible quality for the device.
    s.quality = touch ? 'medium' : 'high';
    s._init = true;
  }
  if (params.get('quality')) s.quality = params.get('quality');
  return s;
}

function saveSettings(s) {
  try { localStorage.setItem('forge-boxing-settings', JSON.stringify(s)); } catch { /* ignore */ }
}

const OPPONENTS = {
  rookie: { name: 'Danny Rook', attr: { power: 0.85, speed: 0.9, chin: 0.9, stamina: 0.9 }, skin: SKIN_TONES.light, hair: '#6b4a2b' },
  pro: { name: 'Marcus Titan', attr: { power: 1, speed: 1, chin: 1, stamina: 1 }, skin: SKIN_TONES.brown, hair: '#0d0b0a' },
  contender: { name: 'Victor Kane', attr: { power: 1.06, speed: 1.05, chin: 1.1, stamina: 1.05 }, skin: SKIN_TONES.tan, hair: '#1a1410' },
  champion: { name: 'Kaz Volkov', attr: { power: 1.12, speed: 1.08, chin: 1.2, stamina: 1.1 }, skin: SKIN_TONES.light, hair: '#2a1f16' },
};

const CORNER_TIPS = [
  'Your corner: "Double up the jab, then come behind it with the right hand."',
  'Your corner: "Keep that guard up! He is timing you coming in."',
  'Your corner: "Go to the body. The head will follow."',
  'Your corner: "Move your head after you punch. Slip, then counter."',
  'Your corner: "Sit down on your punches, turn the hips over."',
  'Your corner: "Breathe. Pick your shots. Don\'t punch yourself out."',
];

// ---------------------------------------------------------------------------

const settings = loadSettings();
const stage = new Stage(document.getElementById('view'), { quality: settings.quality });
const input = new Input(document.body);
const audio = new Audio();
audio.setVolume(settings.volume);
const particles = new Particles(stage.scene);
const rig = new CameraRig(stage.camera);

let sim, arena, meshes = [], damage, match, ais = [], debug = null;
let player = null, opponent = null;
let mode = 'menu';            // menu | fight | paused | result | replay
let time = 0;                 // simulated seconds
let timeScale = 1, slowmoUntil = 0, hitStop = 0;
let recorder = null, replay = null;
let lastHeartbeat = 0;
const log = [];
// Timers in game time (so slow motion, pauses and replays stay in sync).
let timers = [];
function later(seconds, fn) {
  timers.push({ at: time + seconds, fn });
}
function runTimers() {
  if (!timers.length) return;
  const due = timers.filter((t) => t.at <= time);
  timers = timers.filter((t) => t.at > time);
  for (const t of due) t.fn();
}

const hud = new HUD(document.getElementById('ui'), {
  start: (opts) => {
    audio.start();
    Object.assign(settings, opts);
    saveSettings(settings);
    if (opts.quality !== stage.quality) {
      // A different renderer configuration needs a fresh page.
      location.reload();
      return;
    }
    rig.mode = settings.camera;
    hud.setCameraLabel(rig.mode);
    newFight(true);
  },
  resume: () => setPaused(false),
  pause: () => setPaused(true),
  cycleCamera: () => {
    rig.cycle();
    settings.camera = rig.mode;
    saveSettings(settings);
    return rig.mode;
  },
  quit: () => {
    setPaused(false);
    toMenu();
  },
  rematch: () => newFight(true),
  replay: () => startReplay(),
  volume: (v) => {
    settings.volume = v;
    audio.setVolume(v);
    saveSettings(settings);
  },
});
hud.opponentNames = Object.fromEntries(Object.entries(OPPONENTS).map(([k, v]) => [k, v.name]));
hud.applySettings(settings);
hud.setCameraLabel(settings.camera);
if (matchMedia('(pointer: coarse)').matches) hud.enableTouch(input);

// ---------------------------------------------------------------------------
// World construction

function buildFight({ playerStance = 'orthodox', difficulty = 'pro', attract = false } = {}) {
  if (meshes.length) for (const m of meshes) stage.scene.remove(m.group);
  const opp = OPPONENTS[difficulty] ?? OPPONENTS.pro;
  sim = new FightSim({
    fighters: [
      { name: attract ? 'Red' : settings.name, stance: attract ? 'orthodox' : playerStance },
      { name: attract ? 'Blue' : opp.name, stance: 'orthodox', attributes: attract ? {} : opp.attr },
    ],
  });
  if (!arena) {
    arena = new Arena(stage.scene, sim, { quality: stage.quality });
    arena._ropeRecords = sim.ropes;
  } else {
    // Ropes belong to the new sim: re-bind the existing rope meshes.
    rebindRopes();
  }
  meshes = [
    new BoxerMesh(sim.a, { skin: SKIN_TONES.medium, trunks: '#b3121f', trim: '#f4d27a', gloves: '#c0131f', name: 'FORGE', quality: stage.quality }),
    new BoxerMesh(sim.b, { skin: opp.skin, trunks: '#14307a', trim: '#e8e8e8', gloves: '#1a3fa8', name: opp.name.split(' ')[1].toUpperCase(), hair: opp.hair, quality: stage.quality }),
  ];
  for (const m of meshes) stage.scene.add(m.group);
  damage = new DamageModel(sim);
  player = sim.a;
  opponent = sim.b;
  player.isPlayer = !attract;
  ais = attract
    ? [new BoxerAI(sim.a, 'contender'), new BoxerAI(sim.b, 'contender')]
    : [new BoxerAI(sim.b, difficulty)];
  if (debug) { stage.scene.remove(debug.group); debug = null; }
  if (params.get('debug')) debug = new DebugDraw(sim.world, stage.scene);
  recorder = { frames: [], max: 60 * 5 };
  replay = null;
  if (attract) hud.setTape(settings.name, opp.name);
  else hud.setNames(sim.a.name, sim.b.name);
  for (const bx of sim.boxers) {
    bx._feetState = { L: true, R: true };
    bx._lastPunch = bx.lastPunchTime;
  }
}

function rebindRopes() {
  // Arena rope meshes were built against the first sim's rope bodies; copy
  // the geometry references onto the new sim's rope records.
  const old = arena._ropeRecords;
  sim.ropes.forEach((r, i) => {
    const o = old[i];
    if (!o || !o.mesh) return;
    Object.assign(r, { mesh: o.mesh, curve: o.curve, points: o.points, deflection: 0, deflectPoint: 0.5 });
  });
  arena._ropeRecords = sim.ropes;
  arena.sim = sim;
}

function newFight(real) {
  timers = [];
  buildFight({ playerStance: settings.stance, difficulty: settings.difficulty, attract: !real });
  match = new Match(sim, { rounds: real ? settings.rounds : 99, roundLength: real ? settings.roundLength : 9999, restLength: 8 });
  match.on(onMatchEvent);
  match.start();
  time = 0;
  timeScale = 1;
  slowmoUntil = 0;
  if (real) {
    mode = 'fight';
    hud.show('none');
    hud.showHud(true);
    rig.mode = settings.camera;
    input.enabled = true;
  } else {
    mode = 'menu';
    hud.showHud(false);
  }
}

function toMenu() {
  newFight(false);
  hud.show('menu');
  hud.getUp(false);
}

function setPaused(p) {
  if (p && mode === 'fight') {
    mode = 'paused';
    hud.show('pause');
  } else if (!p && mode === 'paused') {
    mode = 'fight';
    hud.show('none');
  }
}

// ---------------------------------------------------------------------------
// Match events -> presentation

function onMatchEvent(type, d) {
  if (mode === 'menu') {
    // Attract mode: keep it going silently.
    if (type === 'knockdown') later(6, () => { if (mode === 'menu') toMenu(); });
    return;
  }
  switch (type) {
    case 'intro':
      hud.callout(`${sim.a.name.toUpperCase()}`, `vs ${sim.b.name}`, { ms: 2800 });
      audio.crowd('roar', 0.6);
      break;
    case 'roundStart':
      hud.show('none');
      audio.bell(1);
      hud.callout(`ROUND ${d.round}`, '', { ms: 1100 });
      later(1.1, () => { if (match.state === 'fight') hud.callout('FIGHT!', '', { ms: 700, kind: 'red' }); });
      audio.say(`Round ${d.round}`);
      break;
    case 'roundEnd':
      audio.bell(3);
      hud.callout('END OF ROUND', '', { ms: 2000 });
      break;
    case 'rest':
      hud.showBetween(match, sim.a, sim.b, CORNER_TIPS[(match.round - 1) % CORNER_TIPS.length]);
      break;
    case 'knockdown': {
      const who = d.boxer === player ? 'YOU\'RE DOWN' : 'KNOCKDOWN!';
      hud.callout(who, d.count > 1 ? `knockdown ${d.count} of the round` : '', { ms: 1500, kind: 'danger' });
      audio.crowd('roar', 1);
      arena.excite(1);
      slowmoUntil = time + 1.0;
      break;
    }
    case 'count':
      hud.callout(String(d.count), '', { ms: 800, kind: 'count' });
      audio.say(String(d.count));
      break;
    case 'gettingUp':
      hud.callout('', `${d.boxer.name} is getting up`, { ms: 1500 });
      break;
    case 'resume':
      hud.callout('FIGHT!', '', { ms: 700, kind: 'red' });
      hud.getUp(false);
      break;
    case 'over': {
      const r = d;
      audio.bell(r.method === 'KO' || r.method === 'TKO' ? 6 : 3);
      audio.crowd('roar', 1.2);
      arena.excite(1);
      const big = r.method === 'KO' ? 'K.O.!' : r.method === 'TKO' ? 'T.K.O.!' : r.method === 'Draw' ? 'DRAW' : 'DECISION';
      hud.callout(big, r.winner ? `${r.winner.name} wins` : '', { ms: 3200, kind: r.method.includes('KO') ? 'danger' : '' });
      hud.getUp(false);
      input.enabled = false;
      later(3.6, () => {
        if (mode !== 'fight') return;
        mode = 'result';
        hud.showResult(r, sim.a, sim.b, r.winner === player);
      });
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Frame logic

function handleInput() {
  const st = input.poll();
  for (const a of st.actions) {
    if (a.type === 'pause') {
      if (mode === 'fight') setPaused(true);
      else if (mode === 'paused') setPaused(false);
      continue;
    }
    if (a.type === 'camera') {
      const m = rig.cycle();
      settings.camera = m;
      hud.setCameraLabel(m);
      continue;
    }
    if (a.type === 'replay' && mode === 'result') { startReplay(); continue; }
    if (a.type === 'help') { hud.el.hint.hidden = !hud.el.hint.hidden; continue; }
    if (mode !== 'fight') continue;
    if (a.type === 'mash') match.pushGetUp();
    if (!match.fighting || !player.canAct) continue;
    if (a.type === 'punch') player.throwPunch(a.punch, a.level);
    else if (a.type === 'defend') player.defend(a.move);
  }
  if (mode === 'fight' && match.fighting && player.canAct) {
    player.intent.moveX = st.move.x;
    player.intent.moveY = st.move.y;
    player.intent.block = st.block;
  } else if (mode === 'fight' && match.state !== 'count') {
    player.intent.moveX = player.intent.moveY = 0;
    player.intent.block = false;
  }
}

function snapshot() {
  for (const b of sim.world.bodies) {
    if (!b.renderPos) {
      b.renderPos = new Vector3().copy(b.pos);
      b.renderQ = new Quaternion().copy(b.q);
      b.prevPos2 = new Vector3().copy(b.pos);
      b.prevQ2 = new Quaternion().copy(b.q);
    }
    b.prevPos2.copy(b.pos);
    b.prevQ2.copy(b.q);
  }
}

function interpolate(alpha) {
  for (const b of sim.world.bodies) {
    if (!b.renderPos || b.isStatic) continue;
    b.renderPos.lerpVectors(b.prevPos2, b.pos, alpha);
    b.renderQ.slerpQuaternions(b.prevQ2, b.q, alpha);
  }
}

function fixedStep() {
  snapshot();
  const dt = sim.dt;
  if (mode === 'fight' || mode === 'menu') {
    if (match.fighting) for (const ai of ais) ai.update(dt);
    else if (match.state !== 'count') {
      for (const bx of sim.boxers) {
        bx.intent.moveX = bx.intent.moveY = 0;
        bx.intent.block = false;
      }
    }
    match.update(dt);
  }
  damage.pre();
  sim.step();
  time += dt;
  const events = damage.post();
  for (const ev of events) onPhysicsEvent(ev);
  sounds();
  record();
  runTimers();
}

function onPhysicsEvent(ev) {
  const loud = mode !== 'menu' ? 1 : 0.35;
  if (ev.kind === 'contact') {
    if (ev.zone === 'other') return;
    if (loud) audio.impact(ev.speed * loud, ev.zone, ev.force);
    const strength = Math.min(1.6, ev.speed / 8);
    if (ev.zone === 'head' && ev.speed > 3) {
      particles.burst(ev.point, ev.normal.clone().multiplyScalar(ev.defender === ev.attacker ? 1 : 1), strength, { zone: 'head', blood: ev.defender.faceDamage > 40 && Math.random() < 0.4 });
    } else if (ev.zone === 'body' && ev.speed > 3) {
      particles.burst(ev.point, ev.normal, strength * 0.7, { zone: 'body' });
    }
    if (mode === 'fight' && ev.speed > 4 && ev.zone !== 'block') {
      const toPlayer = ev.defender === player;
      stage.kick({ shake: (toPlayer ? 0.55 : 0.3) * strength, aberration: toPlayer ? 0.6 * strength : 0.2 * strength, flash: toPlayer && ev.zone === 'head' ? 0.08 * strength : 0 });
    }
    return;
  }
  // Resolved hit
  if (ev.zone === 'head' || ev.zone === 'body') {
    const m = meshes[ev.defender.id];
    m.bruise(ev.point, ev.part, ev.severity);
    m.sweat = Math.min(1, m.sweat + 0.01);
  }
  if (mode === 'menu') return;
  if (ev.zone !== 'other' && ev.speed > 1.2) hud.telemetry(ev, ev.attacker === sim.a ? 'A' : 'B');
  if (ev.zone === 'head' && ev.severity > 0.3) {
    hitStop = 0.06;
    audio.crowd('ooh', Math.min(1, ev.severity));
    arena.excite(Math.min(1, ev.severity));
  } else if (ev.liver && ev.severity > 0.4) {
    audio.crowd('ooh', 0.8);
    arena.excite(0.6);
  }
}

function sounds() {
  if (mode === 'menu') return;
  for (const bx of sim.boxers) {
    for (const side of ['L', 'R']) {
      const p = bx.feet[side].planted;
      if (p && !bx._feetState[side]) audio.step();
      bx._feetState[side] = p;
    }
    if (bx.lastPunchTime !== bx._lastPunch) {
      bx._lastPunch = bx.lastPunchTime;
      audio.whoosh(8);
    }
  }
}

function record() {
  if (!recorder) return;
  const bodies = sim.boxers.flatMap((bx) => bx.ragdoll.list);
  const f = new Float32Array(bodies.length * 7);
  bodies.forEach((b, i) => {
    f.set([b.pos.x, b.pos.y, b.pos.z, b.q.x, b.q.y, b.q.z, b.q.w], i * 7);
  });
  recorder.frames.push(f);
  if (recorder.frames.length > recorder.max) recorder.frames.shift();
}

function startReplay() {
  if (!recorder || recorder.frames.length < 30) return;
  replay = { frames: recorder.frames.slice(), t: 0, prevMode: mode };
  mode = 'replay';
  hud.show('none');
  hud.showHud(false);
  hud.callout('REPLAY', '', { ms: 1500 });
}

function updateReplay(dt) {
  const r = replay;
  r.t += dt * 22;            // ~0.37x speed
  const i = Math.min(r.frames.length - 1, Math.floor(r.t));
  const f = r.frames[i];
  const bodies = sim.boxers.flatMap((bx) => bx.ragdoll.list);
  bodies.forEach((b, k) => {
    b.renderPos.set(f[k * 7], f[k * 7 + 1], f[k * 7 + 2]);
    b.renderQ.set(f[k * 7 + 3], f[k * 7 + 4], f[k * 7 + 5], f[k * 7 + 6]);
  });
  if (i >= r.frames.length - 1) {
    mode = r.prevMode;
    replay = null;
    interpolate(1);
    if (mode === 'result') hud.show('result');
  }
}

function cameraOverride() {
  if (mode === 'menu' || mode === 'replay') return 'orbit';
  if (match && (match.state === 'intro' || match.state === 'rest')) return 'orbit';
  if (match && (match.state === 'count' || (match.state === 'over' && match.result?.method?.includes('KO')))) return 'knockdown';
  return null;
}

function presentation(dt, alpha) {
  if (mode !== 'replay') interpolate(alpha);
  for (const m of meshes) {
    m.sweat = Math.min(1, m.sweat + dt * 0.002);
    m.update();
  }
  debug?.update();
  arena.update(dt);
  particles.update(dt * (mode === 'replay' ? 0.37 : timeScale));

  rig.update(dt, player, opponent, cameraOverride());

  // Hurt vision + heartbeat
  const hurt = mode === 'fight' || mode === 'paused' ? Math.min(1, Math.max(0, (player.stun - 0.3) * 1.5)) : 0;
  stage.hurt += (hurt - stage.hurt) * Math.min(1, dt * 3);
  if (mode === 'fight' && hurt > 0.15 && time - lastHeartbeat > 0.85 - hurt * 0.3) {
    lastHeartbeat = time;
    audio.heartbeat(hurt);
  }
  audio.setIntensity(arena.excitement);

  if (mode === 'fight' || mode === 'paused' || mode === 'result') {
    hud.update(match, sim.a, sim.b);
    const down = match.state === 'count' && match.downed === player && player.state === 'down';
    hud.getUp(down, match.getUpMeter, input.lastDevice === 'touch');
  }
  stage.render(dt, time);
}

// ---------------------------------------------------------------------------
// Main loop

let last = performance.now(), acc = 0;
function loop(now) {
  const raw = Math.min(0.1, (now - last) / 1000);
  last = now;
  handleInput();
  if (mode === 'replay') {
    updateReplay(raw);
    presentation(raw, 1);
  } else {
    // slow motion / hit-stop
    let scale = 1;
    if (time < slowmoUntil) scale = 0.3;
    if (hitStop > 0) {
      hitStop -= raw;
      scale = 0.08;
    }
    timeScale = scale;
    if (mode !== 'paused' && mode !== 'result') {
      acc += raw * scale;
      let n = 0;
      while (acc >= sim.dt && n < 4) {
        fixedStep();
        acc -= sim.dt;
        n++;
      }
      if (n === 4) acc = 0;
    } else if (mode === 'result') {
      // keep the world alive behind the result card
      acc += raw;
      while (acc >= sim.dt) {
        fixedStep();
        acc -= sim.dt;
      }
    }
    presentation(raw, Math.min(1, acc / sim.dt));
  }
  requestAnimationFrame(loop);
}

// Boot into attract mode behind the menu.
toMenu();
if (params.get('autostart')) hud.h.start({ ...settings, difficulty: params.get('difficulty') ?? settings.difficulty });

// Hooks for automated screenshots / testing.
window.game = {
  get sim() { return sim; },
  get match() { return match; },
  stage,
  hud,
  log,
  settings,
  start: (opts = {}) => hud.h.start({ ...settings, ...opts }),
  stepTo(t) {
    while (time < t - 1e-9) {
      handleInput();
      fixedStep();
    }
    interpolate(1);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, player, opponent, cameraOverride());
    presentation(1 / 60, 1);
    return time;
  },
};

if (!params.get('manual')) requestAnimationFrame(loop);
