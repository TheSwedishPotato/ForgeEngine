// SK1415 cabin simulator — boot, main loop, rendering passes and input.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UI } from './ui.js';
import { buildRoute, FlightModel } from './flight.js';
import { World, WEATHER } from './world.js';
import { Scenery } from './scenery.js';
import { Cabin, rowZ } from './cabin.js';
import { Exterior } from './exterior.js';
import { People } from './people.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { Voice } from './speech.js';
import { Dialogue } from './dialogue.js';
import { Director } from './director.js';
import { DEPARTURES } from './places.js';
import { randomAppearance } from './humans.js';
import { setMaxAniso } from './textures.js';
import { sharedUniforms, clamp, lerp, damp, rng, KT, FT, DEG, isa, vnoise1, smoothstep } from './core.js';

const ui = new UI();
const PHASE_NAMES = { parked: 'Pushback complete', 'taxi-out': 'Taxiing', hold: 'Holding short 19R', lineup: 'Lining up', takeoff: 'Take-off roll', climb: 'Climbing', cruise: 'Cruise FL360', descent: 'Descending', approach: 'Approach 22L', flare: 'Landing', rollout: 'Landing roll', 'taxi-in': 'Taxiing to the gate', arrived: 'At the gate' };
const G_LOCAL = new THREE.Vector3(0, -3.4, 11.5); // main-gear contact point in aircraft coordinates
let S = null;

ui.on('start', (o) => {
  const audio = new AudioEngine(); audio.start(); // must happen inside the click
  if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch (e) { /* ignore */ } }
  boot(o, audio).catch((e) => { console.error(e); ui.loading(1); alertBox(e); });
});

function alertBox(e) {
  const d = document.createElement('div'); d.className = 'overlay';
  d.innerHTML = `<div class="dialog"><h2>Something went wrong</h2><p style="margin:0">The 3D view could not start: ${String(e.message || e)}. Try the "Low" graphics setting, or a recent desktop Chrome, Edge, Firefox or Safari with WebGL 2.</p><div class="cta"><button class="btn primary" onclick="location.reload()">Reload</button></div></div>`;
  document.body.appendChild(d);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function boot(o, audio) {
  ui.showStart(false); ui.loading(0.05, 'Starting the engines…'); await frame();
  const dep = DEPARTURES[o.depIndex];
  const W = WEATHER[o.weather];
  const opts = { ...o, depTime: dep.time, flight: dep.flight, startClock: dep.time + 4 / 60, temps: W.temp };
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: o.quality !== 'low', logarithmicDepthBuffer: true, stencil: true, powerPreference: 'high-performance' });
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio(o.quality === 'low' ? Math.min(dpr, 1) * 0.8 : o.quality === 'high' ? Math.min(dpr, 2) : Math.min(dpr, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = o.quality !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  setMaxAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  ui.loading(0.12, 'Planning the route ARN → CPH…'); await frame();
  const route = buildRoute();
  const st = W.stratus;
  const fm = new FlightModel(route, { turbulence: W.turb, cloudBase: st ? st.base : W.cumulus > 0 ? W.cuBase : 1e9, cloudTop: st ? st.top : W.cumulus > 0.5 ? W.cuTop : -1 });

  ui.loading(0.2, 'Drawing Sweden and Denmark from map data…'); await frame();
  const world = new World(renderer, { weather: o.weather, quality: o.quality, localTime: opts.startClock });
  ui.loading(0.45, 'Building Arlanda, Kastrup and the Øresund Bridge…'); await frame();
  const scenery = new Scenery(world, route, { quality: o.quality });
  scenery.pixelRatio = renderer.getPixelRatio();

  ui.loading(0.62, 'Fitting 180 seats…'); await frame();
  const cabinScene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer);
  const roomEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  cabinScene.environment = roomEnv;
  const cabin = new Cabin({ quality: o.quality });
  cabinScene.add(cabin.group);
  const extScene = new THREE.Scene();
  const ext = new Exterior(); extScene.add(ext.group);
  const skyEnv = makeSkyEnv(renderer);
  extScene.environment = skyEnv.texture;
  // cabin sunlight (sunbeams through the windows)
  const sun = new THREE.DirectionalLight('#ffffff', 0);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(o.quality === 'high' ? 4096 : 2048, o.quality === 'high' ? 4096 : 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  sun.target.position.set(0, 1, 11); cabinScene.add(sun, sun.target);

  ui.loading(0.75, 'Boarding the passengers…'); await frame();
  const voice = new Voice(ui, { voice: o.voice, lang: o.lang });
  const people = new People(cabin, cabinScene, { load: o.load, seed: 1000 + o.depIndex * 7 + o.seat.length, playerSeat: o.seat, audio, quality: o.quality });
  const pr = rng(4242);
  const player = new Player(cabin, cabinScene, o.seat, audio, randomAppearance(pr, { female: pr() < 0.5, jacket: true, glasses: false, headphones: null }));
  const dialogue = new Dialogue(people, voice, ui, {});

  // Window stencil: the outside world and the aircraft exterior are only shaded
  // inside the window panes, door windows and (on arrival) the open door.
  const maskScene = buildWindowMask(cabin);
  stencilTest(world.scene); stencilTest(extScene);
  renderer.shadowMap.autoUpdate = false;
  S = { ui, renderer, route, fm, world, scenery, cabin, cabinScene, ext, extScene, skyEnv, sun, audio, voice, people, player, dialogue, opts, speed: o.speed, paused: false, fast: false, env: null, maskScene, frameNo: 0 };
  const director = new Director(S);
  S.director = director;

  ui.loading(0.92, 'Closing the doors…'); await frame();
  // compile shaders up-front to avoid hitches
  const cam0 = player.camera;
  resize();
  ui.loading(1); ui.showHUD(true);
  setupInput();
  setupPause();
  S.clock = new THREE.Clock();
  S.lastMap = 0;
  renderer.setAnimationLoop(loop);
  ui.toast('Click the view to look around · B fastens your seatbelt · Esc for help', 7);
  if (!('ontouchstart' in window)) setTimeout(() => ui.toast('Tip: press M for the flight map on your phone, T to talk to your neighbour', 6), 8000);
}

function buildWindowMask(cabin) {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp });
  cabin.group.updateMatrixWorld(true);
  const add = (src, scale = 1.06) => { const m = new THREE.Mesh(src.geometry, mat); src.matrixWorld.decompose(m.position, m.quaternion, m.scale); m.scale.multiplyScalar(scale); scene.add(m); return m; };
  for (const w of cabin.windows) add(w.pane);
  const doorPanes = [];
  for (const d of Object.values(cabin.doors)) d.pivot.traverse((o) => { if (o.isMesh && o.material === cabin.paneMat) doorPanes.push({ src: o, m: add(o) }); });
  scene.userData.doorPanes = doorPanes;
  // open L1 door (shown when the door opens at the gate)
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.0), mat); hole.position.set(-1.75, 1.0, -2.3); hole.rotation.y = Math.PI / 2; hole.visible = false; scene.add(hole);
  scene.userData.doorHole = hole;
  return scene;
}

function stencilTest(scene) {
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) { m.stencilWrite = true; m.stencilRef = 1; m.stencilFunc = THREE.EqualStencilFunc; m.stencilZPass = THREE.KeepStencilOp; m.stencilZFail = THREE.KeepStencilOp; m.stencilFail = THREE.KeepStencilOp; }
  });
}

// A small gradient-sky scene rendered into a PMREM so the wing and engines reflect the real sky.
function makeSkyEnv(renderer) {
  const scene = new THREE.Scene();
  const u = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() } };
  const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: u,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vD; uniform vec3 uZen, uHor, uGnd, uSun, uSunCol;
      void main(){ vec3 d = normalize(vD); float e = d.y;
        vec3 c = e > 0.0 ? mix(uHor, uZen, pow(e, 0.5)) : mix(uHor, uGnd, clamp(-e * 6.0, 0.0, 1.0));
        float mu = max(dot(d, uSun), 0.0); c += uSunCol * (pow(mu, 12.0) * 0.4 + pow(mu, 400.0) * 6.0);
        gl_FragColor = vec4(c, 1.0); }` }));
  scene.add(m);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = { scene, u, pm, rt: null, texture: null, t: 99 };
  env.update = (e, sunLocal) => {
    u.uZen.value.copy(e.zenith); u.uHor.value.copy(e.horizon); u.uGnd.value.setRGB(0.12, 0.13, 0.1).multiplyScalar(e.day + 0.03);
    if (e.belowOvercast) u.uGnd.value.multiplyScalar(0.6);
    u.uSun.value.copy(sunLocal); u.uSunCol.value.copy(e.sunCol).multiplyScalar(0.35);
    const old = env.rt; env.rt = pm.fromScene(scene, 0, 0.1, 1000);
    env.texture = env.rt.texture; if (old) old.dispose();
  };
  env.update({ zenith: new THREE.Color(0.2, 0.4, 0.8), horizon: new THREE.Color(0.7, 0.8, 0.9), sunCol: new THREE.Color(1, 1, 1), day: 1 }, new THREE.Vector3(0, 1, 0));
  return env;
}

function resize() {
  if (!S) return;
  const w = innerWidth, h = innerHeight;
  S.renderer.setSize(w, h);
  for (const c of [S.player.camera, S.world.camera]) { c.aspect = w / h; c.updateProjectionMatrix(); }
}
window.addEventListener('resize', resize);

// ---------------- simulation step ----------------
function simStep(dt, render = true) {
  const { fm, director, people, cabin, player, world } = S;
  director.update(dt);
  fm.update(dt);
  const pp = player.pos;
  people.playerBlock = player.state === 'standing' ? { x: pp.x, z: pp.z } : null;
  people.update(dt, { player: { x: player.eye.x, z: player.eye.z }, phase: fm.phase, bump: fm.bump, force: !render, crewNear: (seat) => people.crew.some((c) => Math.abs(c.z - seat.z) < 1.2 && !c.seated) });
  cabin.update(dt);
  S.dialogue.playerPos = player.eye;
}

function fastForward(cond, maxSec = 5400) {
  S.fast = true; S.voice.skipAll(); S.ui.mute = true; S.dialogue.muted = true;
  const P = S.player;
  let t = 0;
  while (t < maxSec && !cond()) {
    if (P.state !== 'seated') { P.pos.set(0, 0, P.seat.z - 0.28); P.sitDown(); }
    if (!P.belt) P.belt = true; if (P.tray) P.tray = false; if (P.recline) P.setRecline(false);
    for (const w of S.cabin.windows) if (Math.abs(w.z - P.seat.z) < 0.6 && Math.sign(w.side) === Math.sign(P.seat.x)) w.shadeTarget = 0;
    S.director.serviceAtPlayer = null;
    simStep(0.5, false); t += 0.5;
  }
  S.fast = false; S.ui.mute = false; S.dialogue.muted = false; S.voice.skipAll();
  S.ui.serviceMenu(false); S.ui.callMenu(false);
}

// ---------------- frame ----------------
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
let shake = new THREE.Vector3(), thumpY = 0;
function loop() {
  const realDt = Math.min(S.clock.getDelta(), 0.1);
  const { fm, world, cabin, ext, player, audio, people, director, ui } = S;
  const dt = S.paused ? 0 : realDt * S.speed;
  if (dt > 0) simStep(dt);
  // ---- camera & head motion ----
  const rr = fm.rollRumble;
  const tt = fm.t;
  const vib = (vnoise1(tt * 31) - 0.5) * 0.006 * rr + (vnoise1(tt * 13 + 5) - 0.5) * 0.004 * rr;
  thumpY = Math.max(0, thumpY - realDt * 6); if (fm.thump > 0.5 && !S._thumped) { thumpY = 0.035 * fm.thump; S._thumped = true; } if (fm.thump < 0.1) S._thumped = false;
  const turb = fm.bump * 0.022 + (vnoise1(tt * 9 + 3) - 0.5) * 0.004 * (fm.turbLevel || 0);
  const ax = clamp(fm.accel.z, -3, 3);
  shake.set((vnoise1(tt * 7 + 11) - 0.5) * 0.004 * (fm.turbLevel || 0), vib + turb - thumpY, clamp(ax * 0.009, -0.03, 0.03));
  player.update(realDt, { headOffset: shake, headRoll: (vnoise1(tt * 5 + 50) - 0.5) * 0.004 * (fm.turbLevel || 0), blocked: (x, z) => people.crew.concat(people.walkers).some((c) => c.root.visible && !c.seated && Math.abs(c.x - x) < 0.35 && Math.abs(c.z - z) < 0.45), bump: fm.bump });
  const cam = player.camera;
  // world camera = aircraft pose * cabin camera
  const wc = world.camera;
  wc.fov = cam.fov;
  tmpV.copy(cam.position).sub(G_LOCAL).applyQuaternion(fm.quat).add(fm.pos);
  wc.position.copy(tmpV);
  wc.quaternion.copy(fm.quat).multiply(cam.quaternion);
  wc.updateProjectionMatrix(); wc.updateMatrixWorld();
  sharedUniforms.uViewUp.value.set(0, 1, 0).transformDirection(wc.matrixWorldInverse);
  const localH = S.opts.startClock + director.t / 3600;
  const env = S.env = world.update(dt, fm.t, fm, wc.position, wc.quaternion, localH);
  S.scenery.update(dt, fm.t, fm, env, director);
  // landing lights on the terrain
  const llOn = (!fm.onGround && fm.h < 3048) || fm.phase === 'takeoff' || fm.phase === 'lineup' || fm.phase === 'rollout';
  world.u.uLandingLight.value = llOn ? 1 : 0;
  world.u.uLLPos.value.copy(new THREE.Vector3(0, -1.2, 6).sub(G_LOCAL).applyQuaternion(fm.quat).add(fm.pos));
  world.u.uLLDir.value.set(0, -0.12, -1).normalize().applyQuaternion(fm.quat);
  // ---- lighting in aircraft frame ----
  tmpQ.copy(fm.quat).invert();
  const sunLocal = env.sunDir.clone().applyQuaternion(tmpQ);
  const sunUp = env.sunDir.y > -0.02 && !env.belowOvercast;
  const sunI = sunUp ? (env.sunCol.r + env.sunCol.g + env.sunCol.b) / 3 : 0;
  ext.sun.position.copy(sunLocal).multiplyScalar(60); ext.sun.target.position.set(0, 0, 0);
  ext.sun.color.copy(env.sunCol).multiplyScalar(1 / Math.max(0.001, sunI || 1)); ext.sun.intensity = sunI * 1.25;
  ext.hemi.color.copy(env.zenith).lerp(env.horizon, 0.6); ext.hemi.groundColor.setRGB(0.22, 0.24, 0.2).multiplyScalar(env.day * 0.9 + 0.02); ext.hemi.intensity = 2.2;
  const apron = fm.onGround && env.nightK > 0.4 ? 0.35 : 0;
  ext.amb.color.set('#ffd9a8'); ext.amb.intensity = 0.02 + apron;
  S.skyEnv.t += realDt;
  if (S.skyEnv.t > 2.5) { S.skyEnv.t = 0; S.skyEnv.update(env, sunLocal); S.extScene.environment = S.skyEnv.texture; }
  ext.update(dt, fm.t, fm, { nightK: env.nightK, strobes: !fm.onGround || fm.phase === 'takeoff' || fm.phase === 'rollout', beacon: !ext.beaconOff, scan: env.nightK > 0.3 && (fm.onGround || fm.h < 3048) });
  // cabin sun & lights
  const sun = S.sun;
  sun.position.copy(sunLocal).multiplyScalar(40).add(sun.target.position);
  sun.color.copy(env.sunCol).multiplyScalar(1 / Math.max(0.001, sunI || 1));
  sun.intensity = sunI * 1.6;
  const daylight = clamp(env.day * (env.belowOvercast ? 0.45 : 1), 0, 1);
  let L = director.lightLevel; if (director.flicker > 0) L *= (Math.sin(director.flicker * 40) > 0 ? 1 : 0.05);
  cabin.setLighting(L, director.mood, daylight);
  S.cabinScene.environmentIntensity = 0.1 + 0.55 * L + 0.25 * daylight;
  // window pane effects: frost at cruise, rain streaks at low level, condensation in cloud
  const pm = cabin.paneMat.uniforms;
  pm.uTime.value = fm.t; pm.uSpeed.value = fm.v; pm.uRain.value = (S.world.weather.rain > 0 && fm.h < (S.world.weather.stratus?.base ?? 800) + 300) ? S.world.weather.rain : 0;
  pm.uFrost.value = damp(pm.uFrost.value, fm.h > 9000 ? 0.85 : 0, 0.03, dt || 0.0001);
  pm.uFog.value = damp(pm.uFog.value, env.inCloud > 0.4 ? 0.5 : 0, 0.5, dt || 0.0001);
  pm.uLight.value = clamp(0.25 + daylight * 0.9 + L * 0.2, 0.05, 1.2);
  // ---- audio ----
  audio.update(realDt, { n1: fm.n1, ias: fm.ias, onGround: fm.onGround, v: fm.v, agl: fm.h, gear: fm.gear, gearMoving: fm.gearMoving, flapsMoving: fm.flapsMoving, spoiler: fm.spoiler, reverse: fm.reverse, rollRumble: fm.rollRumble, bump: fm.bump, rain: pm.uRain.value * (fm.onGround || fm.h < 1500 ? 1 : 0), packs: true, gasper: player.gasper, doorOpen: cabin.doors.L1.open > 0.5 });
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  audio.setListener(cam.position, fwd, up);
  audio.babble = fm.phase === 'takeoff' || fm.phase === 'flare' ? 0.05 : fm.phase === 'arrived' ? 0.7 : 0.28;
  // ear pressure during descent
  if (fm.vs < -5 && fm.h < 6000) audio.muffle = clamp(audio.muffle + realDt * 0.004, 0, 0.55); else audio.muffle = Math.max(0, audio.muffle - realDt * 0.002);
  // ---- exposure & render ----
  const nk = env.nightK;
  const expOut = lerp(0.62, 2.6, nk) * (env.belowOvercast ? 1.35 : 1) * (env.inCloud > 0.5 ? 0.85 : 1);
  const expIn = lerp(0.82, 1.1, 1 - L) * lerp(1, 0.9, daylight);
  const r = S.renderer;
  r.setRenderTarget(null); r.clear(true, true, true);
  const mask = S.maskScene;
  for (const dp of mask.userData.doorPanes) { dp.src.updateMatrixWorld(); dp.src.matrixWorld.decompose(dp.m.position, dp.m.quaternion, dp.m.scale); }
  mask.userData.doorHole.visible = cabin.doors.L1.open > 0.05;
  if (anyWindowVisible(cam)) {
    r.render(mask, cam);
    r.toneMappingExposure = expOut;
    world.render(r, wc);
    r.clearDepth();
    r.render(S.extScene, cam);
  }
  r.toneMappingExposure = expIn;
  S.frameNo++;
  if (r.shadowMap.enabled && S.frameNo % 2 === 0) r.shadowMap.needsUpdate = true;
  r.render(S.cabinScene, cam);
  // ---- UI ----
  hover();
  ui.hud({ flight: S.opts.flight, clock: localH, phase: PHASE_NAMES[fm.phase] || fm.phase, belt: director.seatbelt, speed: S.speed });
  S.lastMap -= realDt;
  if (S.lastMap <= 0 && ui.phoneOpen()) { S.lastMap = 0.5; ui.updatePhone(phoneState(localH)); }
  // end condition: walk out of the front door
  if (cabin.doors.L1.open > 0.9 && player.state === 'standing' && player.pos.z < -1.7 && player.pos.x < -0.7 && !S.ended) endFlight();
}

function anyWindowVisible(cam) {
  // skip the whole outside pass when no window, door or hatch is in view
  if (!S._frustum) S._frustum = new THREE.Frustum();
  const f = S._frustum; const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); f.setFromProjectionMatrix(m);
  const sph = S._sph || (S._sph = new THREE.Sphere(new THREE.Vector3(), 0.35));
  for (const w of S.cabin.windows) { sph.center.copy(w.centre); if (f.intersectsSphere(sph)) return true; }
  sph.radius = 1.2;
  for (const d of Object.values(S.cabin.doors)) { sph.center.set(d.side * 1.7, 1.2, d.z); if (f.intersectsSphere(sph)) { sph.radius = 0.35; return true; } }
  sph.radius = 0.35;
  return false;
}

function phoneState(localH) {
  const { fm, route, director } = S;
  if (!S._routePts) { S._routePts = []; const t = {}; for (let s = 0; s <= route.path.length; s += 2500) { route.path.sample(s, t); S._routePts.push([t.x, t.z, s]); } }
  const pts = S._routePts; let idx = 0; while (idx < pts.length - 1 && pts[idx + 1][2] < fm.s) idx++;
  const oat = isa(fm.h).T - 273.15 + (S.opts.temps?.[0] ?? 14) - 15;
  return { clock: localH, onGround: fm.onGround, altFt: fm.h / FT + (fm.onGround ? 137 : 0), gs: fm.v / KT, eta: director.eta(), hdg: ((fm.heading / DEG) + 360) % 360, oat, distKm: (route.m.stand - fm.s) / 1000, routePts: pts, flownIdx: idx, x: fm.pos.x, z: fm.pos.z };
}

// ---------------- interaction ----------------
function interactables() {
  const { cabin, player, people } = S;
  if (!S._inter) {
    const list = [];
    cabin.group.traverse((o) => { if (o.userData.interact) list.push(o); });
    S._inter = list;
  }
  const list = [...S._inter, ...player.interactables()];
  if (people.neighbor) { const a = people.neighbor.actor; if (!a.root.userData.interact) a.root.userData.interact = { kind: 'neighbor', prompt: () => `Talk to ${people.neighbor.P.name}  [T]` }; a.root.traverse((o) => { if (o.isMesh) list.push(o); }); }
  for (const c of people.crew) { if (!c.root.userData.interact) c.root.userData.interact = { kind: 'crew', actor: c, prompt: () => `Excuse me, ${c.name}…` }; if (Math.abs(c.z - player.eye.z) < 2) c.root.traverse((o) => { if (o.isMesh) list.push(o); }); }
  return list;
}

function hover() {
  const p = S.player.pick(interactables());
  S.hovered = p;
  const locked = document.pointerLockElement === S.renderer.domElement;
  if (p && !S.ui.pauseOpen()) S.ui.prompt(`<kbd>${locked ? 'Click' : 'E'}</kbd> ${p.prompt()}`);
  else if (S.player.state === 'seated' && !S.player.belt && S.director.seatbelt && !S.fast) S.ui.prompt('<kbd>B</kbd> Fasten your seatbelt');
  else S.ui.prompt(null);
}

function use(p) {
  if (!p) return;
  const { cabin, player, audio, ui, director, people } = S;
  switch (p.kind) {
    case 'shade': { const w = p.win; w.shadeTarget = w.shadeTarget > 0.5 ? 0 : 1; audio.shade(); break; }
    case 'bin': { const b = p.bin; b.target = b.target > 0.5 ? 0 : 1; b.target ? audio.binOpen() : audio.binClose(); break; }
    case 'belt': player.setBelt(!player.belt); break;
    case 'tray': player.setTray(!player.tray); break;
    case 'card': ui.toggleCard(); break;
    case 'light': player.setReadingLight(!player.readingLight); break;
    case 'call': player.setCall(!player.callOn); break;
    case 'gasper': player.gasper = !player.gasper; audio.clunk(0.08); break;
    case 'cockpit': ui.toast('The cockpit door is locked for the whole flight.'); break;
    case 'galley': ui.toast('The galley is for crew only.'); break;
    case 'lavdoor': {
      const l = p.lav;
      const inside = player.currentLav() === l;
      if (l.occupied && !inside) { ui.toast('Occupied — someone is inside.'); break; }
      if (player.state !== 'standing') { ui.toast('Stand up first (Space).'); break; }
      l.target = l.target > 0.5 ? 0 : 1; audio.clunk(0.2);
      if (inside) { l.occupied = l.target === 0; ui.toast(l.occupied ? 'Door locked · "Occupied"' : 'Door unlocked'); l.lamp.intensity = l.occupied ? 2.5 : 0; }
      break;
    }
    case 'flush': audio.flush(); break;
    case 'sink': audio.tap(); break;
    case 'neighbor': openChat(); break;
    case 'crew': ui.callMenu(true); director.callResponder = p.actor; director.times.callAsk = director.t; break;
    default: break;
  }
}

function openChat() {
  const { dialogue, fm, ui, director, people, player } = S;
  if (!people.neighbor) return;
  const ctx = { fm, phase: fm.phase, onGround: fm.onGround, eta: formatEta(), canAskLetOut: player.state === 'seated' && !director.seatbelt && ['A', 'F', 'B', 'E'].includes(player.seat.letter) && Math.abs(people.neighbor.seat.x) < Math.abs(player.seat.x), letOut: () => letOut() };
  const items = dialogue.options(ctx);
  ui.openChat(dialogue.name, items, (it) => {
    director.stats.talked++;
    dialogue.choose(it.id, ctx);
    if (it.id === 'bye') { ui.closeChat(); return; }
    setTimeout(() => { if (ui.chatOpen()) openChat(); }, 400);
  });
}
function formatEta() { const h = S.director.eta(); const hh = Math.floor(h % 24), mm = Math.floor((h % 1) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }

function letOut() {
  S.people.neighborLetOut(S.player, () => S.director.t);
  S.ui.toast('Your neighbour steps into the aisle — press Space to stand up');
}

// ---------------- input ----------------
function setupInput() {
  const canvas = S.renderer.domElement;
  const { player, ui } = S;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock && !matchMedia('(pointer: coarse)').matches) { try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* not available */ } return; }
    use(S.hovered);
  });
  document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && !S.ended && !S._noPauseOnUnlock) pause(true); S._noPauseOnUnlock = false; });
  document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) player.look(e.movementX, e.movementY); });
  // touch / drag to look
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { drag = { x: e.clientX, y: e.clientY, moved: 0 }; } else if (document.pointerLockElement !== canvas) { drag = { x: e.clientX, y: e.clientY, moved: 0 }; } });
  window.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy); player.look(-dx * 1.6, -dy * 1.6); });
  window.addEventListener('pointerup', (e) => { if (drag && drag.moved < 6 && e.pointerType !== 'mouse') use(S.hovered); drag = null; });
  const keyDown = (code) => {
    if (S.ui.pauseOpen() && code !== 'Escape') return;
    const P = S.player, D = S.director;
    if (/^Digit[1-5]$/.test(code)) { if (ui.pickNumber(+code.slice(5))) return; }
    switch (code) {
      case 'KeyE': use(S.hovered); break;
      case 'KeyB': if (P.state === 'seated') { P.setBelt(!P.belt); ui.toast(P.belt ? 'Seatbelt fastened' : 'Seatbelt unfastened', 2); } break;
      case 'KeyF': P.setTray(!P.tray); break;
      case 'KeyR': if (P.state === 'seated') { if (!P.recline && D.seatbelt) { ui.toast('Seat backs must stay upright while the seatbelt sign is on'); break; } P.setRecline(!P.recline); } break;
      case 'KeyT': if (ui.chatOpen()) S.dialogue.close(); else openChat(); break;
      case 'KeyM': ui.togglePhone(); S.lastMap = 0; break;
      case 'KeyY': S.audio.pop(); ui.toast('*swallow* — ears cleared', 2); break;
      case 'KeyH': pause(true); break;
      case 'Space': {
        if (P.state === 'seated') { const r = P.standUp(); if (r === 'belt') ui.toast('Unfasten your seatbelt first (B)'); else if (r === 'tray') ui.toast('Fold the tray table first (F)'); else if (r === true) { ui.toast('Walk with W A S D · Space to sit when you are back at your row', 4); if (D.seatbelt && S.fm.phase !== 'arrived') ui.toast('The seatbelt sign is on!', 3); } }
        else if (!P.sitDown()) ui.toast('Walk back to your row to sit down');
        break;
      }
      case 'Equal': case 'NumpadAdd': setSpeed(nextSpeed(1)); break;
      case 'Minus': case 'NumpadSubtract': setSpeed(nextSpeed(-1)); break;
      case 'Escape': if (!document.getElementById('card').hidden) { ui.toggleCard(false); break; } if (S.ui.pauseOpen()) pause(false); else pause(true); break;
      default: break;
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    S.player.keys[e.code] = true;
    if (!e.repeat) keyDown(e.code);
  });
  window.addEventListener('keyup', (e) => { S.player.keys[e.code] = false; });
  for (const b of document.querySelectorAll('#touch button')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); S.player.keys[k] = true; keyDown(k); });
    b.addEventListener('pointerup', () => { S.player.keys[k] = false; });
    b.addEventListener('pointerleave', () => { S.player.keys[k] = false; });
  }
  ui.on('order', (id, item) => S.director.playerOrder(id, item));
  ui.on('call', (id) => S.director.callAnswer(id));
  document.getElementById('card').addEventListener('click', () => ui.toggleCard(false));
  S.player.addItem = (id) => addTrayItem(id);
  S.player.onChange = (k, v) => { if (k === 'belt' && v) S.director.stats.belt++; };
}

function addTrayItem(id) {
  const P = S.player;
  const colors = { coffee: '#f4f4f2', tea: '#f4f4f2', water: '#e9f2f7', focaccia: '#d9b16a', sandwich: '#e6cf98', bun: '#b77a3c', chocolate: '#6b3f25', crisps: '#d9453a', soda: '#c8202a', juice: '#f0a020', sparkling: '#8fd0ff', beer: '#e0b030', wine: '#7a1f32' };
  let geo;
  if (['coffee', 'tea', 'water'].includes(id)) geo = new THREE.CylinderGeometry(0.035, 0.027, 0.085, 12);
  else if (['soda', 'beer', 'sparkling', 'juice'].includes(id)) geo = new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12);
  else if (id === 'wine') geo = new THREE.CylinderGeometry(0.03, 0.035, 0.16, 12);
  else geo = new THREE.BoxGeometry(0.14, 0.04, 0.1);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[id] || '#ddd', roughness: 0.5 }));
  const n = P.trayItems.children.length;
  geo.computeBoundingBox(); const h = geo.boundingBox.max.y - geo.boundingBox.min.y;
  m.position.set(-0.12 + (n % 3) * 0.12, 0.01 + h / 2, 0.05 + Math.floor(n / 3) * 0.08);
  m.castShadow = true; P.trayItems.add(m);
  if (id === 'coffee' || id === 'tea') { const liquid = new THREE.Mesh(new THREE.CircleGeometry(0.031, 12), new THREE.MeshStandardMaterial({ color: id === 'coffee' ? '#3b2314' : '#8a4a1c', roughness: 0.2 })); liquid.rotation.x = -Math.PI / 2; liquid.position.y = h / 2 - 0.01; m.add(liquid); }
  S.ui.toast({ coffee: 'Coffee on your tray (free)', tea: 'Tea on your tray (free)', water: 'Water on your tray' }[id] || 'Added to your tray', 2.5);
}

const SPEEDS = [1, 2, 4, 8, 16];
function nextSpeed(d) { const i = SPEEDS.indexOf(S.speed); return SPEEDS[clamp(i + d, 0, SPEEDS.length - 1)]; }
function setSpeed(s) { S.speed = s; S.ui.toast(s === 1 ? 'Real time' : `Time ×${s}`, 1.5); if (s >= 8) S.voice.clearChannel('chat'); }

function pause(v) {
  S.paused = v; S.ui.showPause(v);
  if (v && document.pointerLockElement) { S._noPauseOnUnlock = true; document.exitPointerLock(); }
  if (S.audio.ctx) { v ? S.audio.ctx.suspend() : S.audio.ctx.resume(); }
  if (window.speechSynthesis) { v ? speechSynthesis.pause() : speechSynthesis.resume(); }
  if (!v) S.clock.getDelta();
}

function setupPause() {
  const { ui } = S;
  const skips = [
    { id: 'takeoff', label: 'Take-off', cond: () => S.fm.phase === 'lineup' || S.fm.phase === 'takeoff' || !S.fm.onGround },
    { id: 'cruise', label: 'Cruise', cond: () => S.fm.phase === 'cruise' || S.fm.phase === 'descent' },
    { id: 'service', label: 'Trolley service', cond: () => S.director.times.serviceStart != null },
    { id: 'descent', label: 'Descent', cond: () => S.fm.phase === 'descent' || S.fm.phase === 'approach' },
    { id: 'final', label: 'Final approach', cond: () => S.fm.m.touchdown - S.fm.s < 13000 },
    { id: 'landing', label: 'Touchdown', cond: () => S.fm.m.touchdown - S.fm.s < 2500 },
    { id: 'gate', label: 'At the gate', cond: () => S.fm.phase === 'arrived' },
  ];
  ui.setupPause(SPEEDS, S.speed, (s) => setSpeed(s), skips, (id) => {
    const sk = skips.find((x) => x.id === id);
    ui.showPause(false); ui.loading(0.5, 'Fast-forwarding…');
    setTimeout(() => { fastForward(sk.cond); ui.loading(1); pause(false); }, 50);
  });
  document.getElementById('resume').onclick = () => pause(false);
  document.getElementById('vol').oninput = (e) => S.audio.setVolume(+e.target.value);
  document.getElementById('pause-voice').checked = S.voice.enabled;
  document.getElementById('pause-voice').onchange = (e) => { S.voice.enabled = e.target.checked; if (!e.target.checked && window.speechSynthesis) speechSynthesis.cancel(); };
  document.getElementById('again').onclick = () => location.reload();
  document.getElementById('stay').onclick = () => { ui.hideEnd(); S.ended = false; S._endShown = true; };
}

function endFlight() {
  if (S._endShown) return;
  S.ended = true;
  const d = S.director;
  const mins = Math.round(d.t / 60);
  S.ui.showEnd({
    text: `You flew ${S.opts.flight} from Stockholm Arlanda to Copenhagen Kastrup on Sunday 10 May 2026, in seat ${S.opts.seat} of SAS A320neo SE-ROX "Roar Viking".`,
    items: [['Time on board', `${mins} min`], ['Distance', '557 km'], ['Cruise', 'FL360'], ['Coffees', String(d.stats.coffee)], ['Spent on board', `${d.stats.spent} kr`], ['Chats', String(d.stats.talked)]],
  });
  if (document.pointerLockElement) { S._noPauseOnUnlock = true; document.exitPointerLock(); }
}

// dev hook for automated screenshots
window.__sim = () => S;
window.__boot = (o) => { const a = new AudioEngine(); return boot({ ...ui.opts, ...o }, a); };
window.__ff = (cond) => fastForward(cond);
window.__freeze = (v) => { if (!S) return; S.renderer.setAnimationLoop(v ? null : loop); };
window.__renderOnce = () => { if (S) loop(); };
