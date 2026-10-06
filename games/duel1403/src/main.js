import { Vector3, Vector2, Raycaster } from 'three';
import { FightSim } from './game/FightSim.js';
import { KnightAI } from './game/AI.js';
import { Input } from './game/Input.js';
import { Audio } from './game/Audio.js';
import { HUD } from './game/HUD.js';
import { DebugView } from './game/DebugView.js';
import { JoustMode } from './game/JoustMode.js';
import { JoustField } from './render/JoustField.js';
import { LifeMode } from './game/LifeMode.js';
import { STARTS } from './life/data.js';
import { TownMesh } from './render/TownMesh.js';
import { Stage } from './render/Stage.js';
import { MedStage } from './render/MedStage.js';
import { Lists } from './render/Lists.js';
import { KnightMesh } from './render/KnightMesh.js';
import { CameraRig } from './render/CameraRig.js';
import { Particles } from './render/Particles.js';
import { OPPONENTS, OPPONENT_ORDER } from './data/opponents.js';
import { PRESETS } from './data/armour.js';
import { WEAPONS } from './data/weapons.js';
import { closestPtSegmentSegment } from './physics/math.js';

const params = new URLSearchParams(location.search);
const STORE = 'duel1403-config';

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { return null; }
}
function saveConfig(c) {
  try { localStorage.setItem(STORE, JSON.stringify(c)); } catch { /* storage unavailable */ }
}

const touch = matchMedia('(pointer: coarse)').matches;
const stored = loadConfig();
const quality = params.get('quality') ?? stored?.quality ?? (touch ? 'medium' : 'high');
if (stored) stored.quality = quality;
// The Med Engine is the default; ?engine=three falls back to three.js's renderer.
function makeStage() {
  const view = document.getElementById('view');
  if (params.get('engine') === 'three') return new Stage(view, { quality });
  try {
    return new MedStage(view, { quality });
  } catch (err) {
    // No WebGL2 float targets (older or mobile GPUs): the original renderer still runs.
    console.warn('Med Engine unavailable, falling back to three.js:', err);
    const fresh = view.cloneNode(false);
    view.replaceWith(fresh);
    return new Stage(fresh, { quality: quality === 'ultra' ? 'high' : quality });
  }
}
const stage = makeStage();
const lists = new Lists(stage.scene, { quality, terrain: !!stage.attachTerrain });
stage.attachTerrain?.(lists);
lists.camera = stage.camera;   // LOD selection for the detailed scenery
const field = new JoustField(stage.scene, { quality });   // the joust field south of the lists
const town = new TownMesh(stage.scene);                  // the town of Skalice on its terrace
stage.setStaticWorld?.(town.staticMeshes);              // baked for the visibility buffer and the ray tracer
const dev = new DebugView({ stage, getSim: () => sim, getAis: () => ais, getPlayer: () => player });
const particles = new Particles(stage.scene);
const rig = new CameraRig(stage.camera);
const audio = new Audio();
const input = new Input(document.body);

let sim = null, meshes = [], ais = [], player = null, foe = null;
let mode = 'menu';             // menu | intro | fight | paused | over
let time = 0, timeScale = 1, slowUntil = 0, hitStop = 0, excitement = 0;
let introT = 0, overT = 0, lastBeat = 0, lastBreath = 0;
let fightConfig = null;
let joust = null;              // the joust mode, while it runs
let life = null;               // life in the town, while it runs
let fromLife = null;           // a duel or joust entered from life: { done(result) }

const hud = new HUD(document.getElementById('ui'), {
  start: (config) => { audio.start(); saveConfig(config); newFight(config); },
  joust: (config) => startJoust(config),
  life: (config) => startLife(config),
  resume: () => setPaused(false),
  pause: () => setPaused(true),
  quit: () => toMenu(),
  rematch: () => newFight(fightConfig),
  volume: (v) => { audio.setVolume(v); saveConfig(hud.config); },
  quality: (q) => { stage.setQuality?.(q); saveConfig(hud.config); },
  yieldFight: () => { setPaused(false); if (player) { player.yielded = true; } },
});
hud.loadConfig(stored);
audio.setVolume(hud.config.volume);
if (touch) hud.enableTouch(input);

// ---------------------------------------------------------------------------

function playerColors(P) {
  const her = { bohemia: ['#8a1c1c', '#e8e2d4'], hungary: ['#8a1c1c', '#e8e2d4'], rozmberk: ['#e8e2d4', '#8a1c1c'], chequy: ['#1c3a6a', '#d8c060'], none: ['#5a4a32', '#3a2e22'] }[P.heraldry] ?? ['#5a4a32', '#3a2e22'];
  return { cloth: her[0], hose: her[1] === '#e8e2d4' ? '#7a1c1c' : her[1], accent: her[1], padding: '#d6ccb0', skin: '#e0b08a', hair: '#5a3c22' };
}

function build(config, attract = false) {
  for (const m of meshes) m.dispose();
  meshes = [];
  const P = config.player;
  const O = config.customFoe ?? OPPONENTS[config.opponent] ?? OPPONENTS.fencer;
  const A = attract ? OPPONENTS.squire : null;
  const fa = attract
    ? { name: A.name, items: A.items, weapon: A.weapon, offhand: A.offhand, colors: A.colors, heraldry: A.heraldry, skill: A.skill, height: A.body.height, mass: A.body.mass }
    : { name: P.name || 'You', items: P.items, weapon: P.weapon, offhand: WEAPONS[P.weapon].hands === 1 ? P.offhand : 'none', colors: playerColors(P), heraldry: P.heraldry, skill: 0.85, strength: 1.02, height: 1.78, mass: 78 };
  const fb = { name: O.name, title: O.title, items: O.items, weapon: O.weapon, offhand: O.offhand, colors: O.colors, heraldry: O.heraldry ?? 'none', skill: O.skill, strength: O.strength, height: O.body.height, mass: O.body.mass };
  sim = new FightSim({ fighters: [fa, fb], separation: 3.6 });
  player = sim.a;
  foe = sim.b;
  if (!attract && P.system && player.systems.includes(P.system)) player.setSystem(P.system);
  ais = attract
    ? [new KnightAI(sim.a, { style: 'liechtenauer', skill: 0.65, aggression: 0.5 }), new KnightAI(sim.b, { style: O.style, skill: O.skill, aggression: O.aggression * 0.7 })]
    : [new KnightAI(sim.b, { style: O.style, skill: O.skill, aggression: O.aggression })];
  sim.settle(1.3);
  meshes = sim.knights.map((k) => new KnightMesh(k, { quality }));
  for (const m of meshes) stage.scene.add(m.group);
  sim.damage.on(onDamage);
  sim.damage.on((e) => dev.onDamage(e));
  for (const k of sim.knights) {
    k.onStep = () => { if (mode !== 'menu') audio.step(k.profile.total > 15); if (k.attack) particles.dust(k.b.pelvis.pos.clone().setY(0.02), 0.3); };
    k.onDown = (kk, cause) => onDown(kk, cause);
    k.onDrop = (kk) => { if (mode === 'fight') { hud.log(`${kk.name} drops the ${kk.def.name.toLowerCase()}!`, 'big'); audio.crowd('ooh', 1); } };
  }
  time = 0;
}

function newFight(config) {
  fightConfig = structuredClone(config);
  build(fightConfig, false);
  mode = 'intro';
  introT = 0;
  overT = 0;
  timeScale = 1;
  hud.show('none');
  hud.showHud(true);
  hud.clearLog();
  hud.setNames(player.name, `${foe.name} — ${foe.title}`);
  input.enabled = false;
  rig.mode = config.camera ?? 'fighter';
  audio.fanfare();
  hud.callout(foe.name, foe.title, 2600);
}

// ---------------------------------------------------------------------------
// The joust

function startJoust(config) {
  audio.start();
  saveConfig(config);
  for (const m of meshes) m.dispose();
  meshes = [];
  sim = null; ais = []; player = null; foe = null;
  mode = 'joust';
  hud.show('none');
  hud.showHud(false);
  input.enabled = false;
  stage.hurt = 0;
  joust = new JoustMode({
    stage, audio, particles, root: document.getElementById('ui'), config, playerColors, quality,
    onExit: () => exitJoust(),
    onDone: () => saveConfig(hud.config),
  });
}

function exitJoust() {
  if (!joust) return;
  joust.dispose();
  joust = null;
  if (fromLife) { const back = fromLife; back.done({}); return; }
  toMenu();
}

// ---------------------------------------------------------------------------
// Life in the town

function startLife(config) {
  audio.start();
  saveConfig(config);
  for (const m of meshes) m.dispose();
  meshes = [];
  sim = null; ais = []; player = null; foe = null;
  mode = 'life';
  hud.show('none');
  hud.showHud(false);
  input.enabled = false;
  life = new LifeMode({
    stage, lists, audio, root: document.getElementById('ui'), quality, config,
    onExit: () => { life.dispose(); life = null; toMenu(); },
    onDuel: (npc, why, cb) => duelFromLife(npc, why, cb),
    onJoust: () => joustFromLife(),
  });
}

/** Hide the town's UI while a fight or joust runs, and bring it back after. */
function suspendLife(on) {
  for (const el of [life.hud, life.talkEl]) if (el) el.hidden = on || (el === life.talkEl && !life.talking);
  life.walker.mesh.visible = !on;
  for (const l of Object.values(life.people.parts)) l.group.visible = !on;
  for (const w of life.people.walkers) if (w) w.mesh.visible = false;
  life.suspended = on;
}

function duelFromLife(npc, why, cb) {
  const P = life.sim.player;
  suspendLife(true);
  const weapon = P.weapon && P.weapon !== 'none' ? P.weapon : 'dagger';
  const nWeapon = npc.armed ? (npc.role === 'captain' ? 'longsword' : 'spear') : 'dagger';
  const custom = { name: npc.fullName, title: npc.title, items: { ...npc.items }, weapon: nWeapon, offhand: 'none', colors: npc.colors, heraldry: 'none', skill: npc.armed ? 0.7 : 0.35, strength: 1, body: { height: npc.height, mass: 74 }, style: npc.armed ? 'liechtenauer' : 'brawler', aggression: 0.4 + npc.traits.temper * 0.5 };
  const c = { ...hud.config, player: { ...hud.config.player, name: P.name, items: { ...P.dress }, weapon, offhand: 'none', system: undefined }, customFoe: custom, rules: 'yield' };
  fromLife = { done: (res) => { fromLife = null; for (const m of meshes) m.dispose(); meshes = []; sim = null; ais = []; player = null; foe = null; hud.showHud(false); hud.show('none'); mode = 'life'; input.enabled = false; suspendLife(false); cb(res); } };
  newFight(c);
}

function joustFromLife() {
  suspendLife(true);
  fromLife = { done: () => { fromLife = null; mode = 'life'; suspendLife(false); } };
  startJoust({ ...hud.config, player: { ...hud.config.player, name: life.sim.player.name } });
}

function toMenu() {
  mode = 'menu';
  build(hud.config, true);
  rig.update(10, sim.a, sim.b, 'orbit');
  hud.showHud(false);
  hud.show('title');
  input.enabled = false;
}

function setPaused(p) {
  if (p && mode === 'fight') { mode = 'paused'; hud.show('pause'); }
  else if (!p && mode === 'paused') { mode = 'fight'; hud.show('none'); }
}

// ---------------------------------------------------------------------------
// Events -> presentation

function onDamage(e) {
  if (mode === 'menu') {
    if (e.type === 'hit' || e.type === 'parry' || e.type === 'clash') {
      if (e.type !== 'hit' || e.stoppedBy === 'plate') particles.sparksAt(e.point, Math.min(1.5, (e.energy ?? 20) / 40));
    }
    return;
  }
  if (e.type === 'clash' || e.type === 'parry') {
    audio.clang(e.energy, false);
    particles.sparksAt(e.point, Math.min(1.5, e.energy / 30));
    if (e.type === 'parry') {
      hud.log(`${e.defender.name} parries the ${e.blow}${e.buckler ? ' on the buckler' : ''}.`, 'parry');
      if (e.energy > 25) stage.kick({ shake: 0.15 });
    }
    return;
  }
  if (e.type !== 'hit') return;
  const isPlayer = e.defender === player;
  const mat = e.stoppedBy === 'plate' ? 'plate' : e.stoppedBy === 'mail' ? 'mail' : 'cloth';
  audio.hit(mat, e.energy, !!e.wound);
  if (mat === 'plate') particles.sparksAt(e.point, Math.min(1.5, e.energy / 40));
  if (e.wound && e.severity > 0.15) {
    const dir = new Vector3().subVectors(e.point, e.defender.b.chest.pos).setY(0.2).normalize();
    particles.blood(e.point, dir, e.severity);
    const km = meshes[e.defender.id];
    if ((e.zone === 'face' || e.zone === 'skull') && km) km.body.mark(e.point, e.severity, true);
  }
  const big = e.fatal || e.severity > 0.9 || e.concussion > 0.6 || e.fracture;
  if (!e.followUp || e.severity > 0.2 || big) hud.log(e.text, (isPlayer ? 'hurt' : 'good') + (big ? ' big' : ''));
  stage.kick({ shake: Math.min(0.6, e.energy / 150) * (isPlayer ? 1.3 : 0.7), aberration: big ? 0.4 : 0.1 });
  if (big) {
    hitStop = 0.06;
    if (e.fatal || e.severity > 1.1) { slowUntil = time + 1.2; audio.crowd('roar', 1); }
    else audio.crowd('ooh', 0.8);
    excitement = Math.min(1, excitement + 0.5);
  } else if (e.energy > 30) {
    excitement = Math.min(1, excitement + 0.15);
  }
}

function onDown(k, cause) {
  if (mode !== 'fight') return;
  audio.thud(k.totalMass * 2);
  particles.dust(k.b.pelvis.pos.clone().setY(0.05), 1);
  const what = cause === 'thrown' ? 'is thrown to the ground' : cause === 'stunned' ? 'goes down, stunned' : cause === 'blood' ? 'collapses from loss of blood' : cause === 'legs' ? 'cannot stand' : 'falls';
  hud.log(`${k.name} ${what}!`, 'big');
  audio.crowd('roar', 0.9);
  excitement = 1;
  slowUntil = time + 0.8;
}

function endFight() {
  if (mode !== 'fight') return;
  const rules = fightConfig.rules;
  const outOf = (k) => k.state === 'dead' || (k.state === 'out' && k.downTime > 2.5) || (k.state === 'down' && k.downTime > 8) || k.yielded;
  let loser = null, how = '';
  for (const k of [player, foe]) {
    const other = k === player ? foe : player;
    if (k.state === 'dead') { loser = k; how = `${k.name} is dead: ${k.deathCause === 'blood' ? 'he bled out' : k.deathCause}.`; break; }
    if (k.yielded) { loser = k; how = `${k.name} yields to ${other.name}${rules === 'death' ? ' and begs for his life' : ''}.`; break; }
    if (k.state === 'out' && k.downTime > 2.5) { loser = k; how = `${k.name} lies senseless on the ground${k.downCause === 'blood' ? ', bled white' : ''}.`; break; }
    if (k.state === 'down' && k.downTime > 8) { loser = k; how = `${k.name} cannot rise; the judges throw down their staff.`; break; }
  }
  if (!loser && rules === 'blood') {
    for (const k of [player, foe]) {
      const w = k.wounds.find((x) => x.severity > 0.25 && x.bleed > 0);
      if (w) { loser = k; how = `First blood: ${k.name}, ${w.side ? w.side + ' ' : ''}${w.zone}.`; break; }
    }
  }
  if (!loser) return;
  void outOf;
  mode = 'over';
  overT = 0;
  input.enabled = false;
  player.setParry(false);
  const won = loser === foe;
  audio.crowd('roar', 1);
  hud.callout(won ? 'Victory' : 'Defeat', how, 3500);
  if (fromLife) {
    const back = fromLife;
    setTimeout(() => back.done({ won, how, killed: foe.state === 'dead', died: player.state === 'dead' }), 3200);
    return;
  }
  setTimeout(() => {
    hud.showResult({ won, verdict: won ? 'Victory' : 'Defeat', how, you: player, foe });
  }, 3600);
}

// ---------------------------------------------------------------------------
// Aiming: a ray from the camera onto his body

const raycaster = new Raycaster();
const _ndc = new Vector2(), _c1 = new Vector3(), _c2 = new Vector3(), _far = new Vector3();

function aimAt(screen) {
  if (!screen || !foe) return null;
  _ndc.set((screen[0] / innerWidth) * 2 - 1, -(screen[1] / innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, stage.camera);
  const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
  _far.copy(ro).addScaledVector(rd, 30);
  let best = null;
  for (const b of foe.ragdoll.list) {
    for (const s of b.shapes) {
      if (s.type === 'box') continue;
      s.updateWorld();
      const a = s.type === 'sphere' ? s.wCenter : s.wA, bb = s.type === 'sphere' ? s.wCenter : s.wB;
      const d2 = closestPtSegmentSegment(ro, _far, a, bb, _c1, _c2);
      const r = s.radius + 0.02;
      if (d2 > r * r) continue;
      const t = _c1.distanceTo(ro);
      if (!best || t < best.t) best = { t, point: _c2.clone().addScaledVector(rd, -0.0), part: s.userData.part, segment: b.name };
    }
  }
  if (!best) return null;
  // Aim at the surface point under the cursor, a little inside it.
  return { point: best.point.lerp(_c1, 0.6), part: best.part };
}

// ---------------------------------------------------------------------------

function handleInput() {
  const st = input.poll();
  for (const a of st.actions) {
    if (a.type === 'pause') { setPaused(mode === 'fight'); continue; }
    if (a.type === 'camera') { rig.cycle(); hud.config.camera = rig.mode; continue; }
  }
  if (mode !== 'fight' || !player) return;
  player.intent.moveX = st.move.x;
  player.intent.moveY = st.move.y;
  player.setParry(st.parry);
  for (const a of st.actions) {
    switch (a.type) {
      case 'swipe': {
        const aim = aimAt(a.screen);
        const r = player.swipe(a.dx, a.dy, aim?.point ?? null, aim?.part ?? null);
        if (r) audio.whoosh(15);
        break;
      }
      case 'thrust': {
        const aim = aimAt(a.screen);
        player.thrust(aim?.point ?? null);
        break;
      }
      case 'guard': player.setGuard(a.index); break;
      case 'guardStep': player.cycleGuard(a.dir); break;
      case 'mode': { const l = player.toggleMode(); if (l) hud.log(l, 'info'); break; }
      case 'shove': {
        const r = player.shove();
        if (r === 'thrown') { hud.log(`You throw ${foe.name}!`, 'good big'); }
        else if (r === 'pushed') hud.log('You shove him back.', 'info');
        else if (r === 'far') hud.log('Too far to wrestle.', 'info');
        break;
      }
      case 'visor': { const v = player.toggleVisor(); if (v !== null) hud.log(v ? 'Visor down.' : 'Visor up — you see and breathe.', 'info'); break; }
      default: break;
    }
  }
}

function stepSim(dt) {
  for (const ai of ais) ai.update(dt);
  // The player rises by himself when he can.
  if (mode === 'fight' && player.state === 'down' && player.canGetUp() && player.downTime > 2.2) { player.startGetUp(); hud.log('You get to your feet.', 'info'); }
  sim.step();
  time += dt;
}

const FIXED = 1 / 60;
let acc = 0, last = performance.now(), wallTime = 0;

const manual = !!params.get('manual');
if (params.get('noui')) document.getElementById('ui').style.display = 'none';   // clean captures

function tick(dt) {
  if (!sim) return;
  if (mode !== 'paused' && dev.shouldStep()) {
    if (dev.on) dt = dev.paused ? FIXED : dt * dev.timeScale;
    if (hitStop > 0) { hitStop -= dt; dt *= 0.05; }
    timeScale = time < slowUntil ? 0.3 : timeScale + (1 - timeScale) * Math.min(1, dt * 3);
    acc += dt * timeScale;
    let n = 0;
    while (acc >= FIXED && n < 4) { stepSim(FIXED); acc -= FIXED; n++; }
    if (n === 4) acc = 0;
  }

  // Match flow.
  if (mode === 'intro') {
    introT += dt;
    rig.update(dt, player, foe, introT < 1.8 ? 'closeB' : introT < 3.4 ? 'closeA' : 'fighter');
    if (introT > 3.4 && introT - dt <= 3.4) hud.callout('Laissez-les aller!', 'let them go', 1300);
    if (introT > 4.2) { mode = 'fight'; input.enabled = true; }
  } else if (mode === 'menu') {
    rig.update(dt, sim.a, sim.b, 'orbit');
    // Keep the sparring going behind the menus.
    if (sim.a.isDown || sim.b.isDown || sim.a.yielded || sim.b.yielded) {
      overT += dt;
      if (overT > 4) { overT = 0; build(hud.config, true); }
    }
  } else if (mode === 'fight' || mode === 'paused') {
    rig.update(dt, player, foe, (player.isDown || foe.isDown) && rig.mode !== 'helm' ? 'down' : null);
    if (mode === 'fight') endFight();
  } else if (mode === 'over') {
    overT += dt;
    rig.update(dt, player, foe, overT < 3 ? 'down' : 'orbit');
  }

  // Presentation.
  for (const m of meshes) m.update(dt);
  particles.update(dt * (mode === 'paused' ? 0 : 1));
  excitement = Math.max(0, excitement - dt * 0.25);
  lists.update(dt, excitement);
  stage.sky.update(wallTime);
  // Lens: focus on the opponent (or the sparring pair behind the menus);
  // a shallow depth of field for the cinematic cameras, a hint in the fight.
  const focusOn = mode === 'menu' ? sim.b : foe;
  if (focusOn) stage.focusPoint = focusOn.b.head.pos;
  stage.shadowFocus = sim ? [sim.a.b.chest.pos, sim.b.b.chest.pos, sim.a.b.footL.pos, sim.b.b.footR.pos] : null;
  stage.dofAmount = rig.mode === 'helm' ? 0 : mode === 'menu' || mode === 'over' || (mode === 'intro' && introT < 3.4) ? 1 : 0.2;
  if (player && mode !== 'menu') {
    hud.update(player, foe);
    stage.hurt = Math.min(1, Math.max(0, player.stun - 0.3) * 1.2 + Math.max(0, 3.6 - player.blood) * 0.5);
    stage.visor = rig.mode === 'helm' && player.profile.hasVisor && player.visorDown && !player.isDown ? 1 : 0;
    if (player.blood < 3.8 && wallTime - lastBeat > 0.85) { lastBeat = wallTime; audio.heartbeat(Math.min(1, (3.8 - player.blood) * 1.2)); }
    if (player.stamina < 30 && wallTime - lastBreath > 1.3 && mode === 'fight') { lastBreath = wallTime; audio.breath((30 - player.stamina) / 30 * (player.visorDown && player.profile.hasVisor ? 1.4 : 1)); }
    hud.drawTrail(input.trail);
  } else {
    stage.hurt = 0;
    stage.visor = 0;
  }
}

function lifeTick(dt) {
  life.frame(dt);
  particles.update(dt);
  lists.update(dt, 0);
  stage.sky.update(wallTime);
}

function joustTick(dt) {
  joust.frame(dt);
  particles.update(dt * joust.timeScale);
  lists.update(dt, joust.excitement);
  stage.sky.update(wallTime);
}

/** Tooling: a fixed camera (window.duel.cam = { pos: [x,y,z], at: [x,y,z], fov }) overrides the rig. */
function applyCameraOverride() {
  const c = window.duel?.cam;
  if (!c) return;
  stage.camera.position.set(...c.pos);
  stage.camera.lookAt(...c.at);
  if (c.fov && stage.camera.fov !== c.fov) { stage.camera.fov = c.fov; stage.camera.updateProjectionMatrix(); }
  stage.dofAmount = c.dof ?? 0;
  if (stage.dof) stage.dof.amount = stage.dofAmount;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  wallTime += dt;
  if (joust) {
    if (!manual) joustTick(dt);
  } else if (life && !sim) {
    if (!manual) lifeTick(dt);
  } else {
    handleInput();
    if (!manual) tick(dt);
  }
  field.update(dt, { excitement: joust?.excitement ?? 0, focusX: joust ? (joust.sim.horses[0].body.pos.x + joust.sim.horses[1].body.pos.x) / 2 : 0, camera: stage.camera });
  applyCameraOverride();
  dev.update(dt);
  stage.render(dt, wallTime);
}

// Debug and tooling hooks.
window.duel = {
  get sim() { return sim; }, get player() { return player; }, get foe() { return foe; },
  start: (overrides = {}) => { const c = { ...hud.config, ...overrides }; audio.start(); newFight(c); },
  menu: toMenu, hud, rig, OPPONENT_ORDER, PRESETS,
  /** Tooling: advance the game by `seconds` in fixed steps (with ?manual=1). */
  advance(seconds, each = null) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      wallTime += FIXED;
      if (joust) joustTick(FIXED); else if (life && !sim) lifeTick(FIXED); else { handleInput(); tick(FIXED); }
      if (each) each(i);
    }
  },
  get joust() { return joust; },
  get life() { return life; },
  startLife: (overrides = {}) => startLife({ ...hud.config, ...overrides }),
  startJoust: (overrides = {}) => startJoust({ ...hud.config, ...overrides }),
  get mode() { return mode; },
};

toMenu();
if (params.get('fight')) {
  const c = { ...hud.config };
  if (params.get('foe')) c.opponent = params.get('foe');
  if (params.get('weapon')) { c.player = { ...c.player, weapon: params.get('weapon'), system: WEAPONS[params.get('weapon')].systems[0] }; }
  if (params.get('kit')) c.player = { ...c.player, items: { ...PRESETS[params.get('kit')].items } };
  newFight(c);
}
if (params.get('life')) {
  startLife({ ...hud.config });
  if (params.get('begin')) {
    life.begin({ name: 'Jan', sex: params.get('sex') ?? 'm', start: STARTS.find((x) => x.id === params.get('begin')) ?? STARTS[0] });
  }
}
if (params.get('joust')) {
  const c = { ...hud.config };
  if (params.get('foe')) c.joustFoe = params.get('foe');
  if (params.get('saddle')) c.joustSaddle = params.get('saddle');
  if (params.get('tilt')) c.joustTilt = params.get('tilt') !== '0';
  if (params.get('cam')) c.joustCamera = params.get('cam');
  startJoust(c);
}
requestAnimationFrame(frame);
