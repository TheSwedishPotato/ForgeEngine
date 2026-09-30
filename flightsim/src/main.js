// SK1415 cabin simulator — boot, main loop, rendering passes and input.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { UI } from './ui.js';
import { buildRoute } from './flight.js';
import { FlightModel, GEAR_POINT } from './physics.js';
import { Atmosphere } from './atmosphere.js';
import { CabinDynamics } from './cabinphysics.js';
import { Incidents, SCENARIOS } from './events.js';
import { World } from './world.js';
import { Weather, presetWeather, STATIONS } from './weather.js';
import { ATC } from './atc.js';
import { Crew } from './crew.js';
import { Scenery } from './scenery.js';
import { Cabin, rowZ, wallX, DOORS } from './cabin.js';
import { Exterior } from './exterior.js';
import { FlightDeck } from './flightdeck.js';
import { Debug } from './debug.js';
import { Boarding, FACADE_Z } from './boarding.js';
import { COCKPIT_DOOR_Z } from './airframe.js';
import { People } from './people.js';
import { Player } from './player.js';
import { AudioEngine } from './audio.js';
import { Voice } from './speech.js';
import { Dialogue } from './dialogue.js';
import { Director } from './director.js';
import { DEPARTURES } from './places.js';
import { randomAppearance } from './humans.js';
import { setMaxAniso } from './textures.js';
import { PostFX } from './post.js';
import { VolumetricClouds } from './clouds.js';
import { sharedUniforms, clamp, lerp, damp, rng, KT, FT, DEG, vnoise1, smoothstep } from './core.js';

const ui = new UI();
const PHASE_NAMES = { boarding: 'Boarding', pushback: 'Pushback', 'go-around': 'Go-around', emergency: 'Emergency descent', forced: 'Forced landing', 'rto-stop': 'Rejected take-off', 'runway-stop': 'Stopped on the runway', parked: 'Pushback complete', 'taxi-out': 'Taxiing', lineup: 'Lining up', takeoff: 'Take-off roll', climb: 'Climbing', descent: 'Descending', flare: 'Landing', rollout: 'Landing roll', 'taxi-in': 'Taxiing to the gate', arrived: 'At the gate' };
const G_LOCAL = new THREE.Vector3(...GEAR_POINT); // main-gear contact point in aircraft coordinates
// graphics presets
const QUALITY = {
  low: { dpr: 1.0, shadows: 0, bloom: false, smaa: false, vol: 0, aniso: 4, people: 0.6 },
  medium: { dpr: 1.0, shadows: 2048, bloom: true, smaa: true, vol: 0, aniso: 8, people: 1 },
  high: { dpr: 1.5, shadows: 4096, bloom: true, smaa: true, vol: 48, aniso: 16, people: 1 },
  ultra: { dpr: 2.0, shadows: 4096, bloom: true, smaa: true, vol: 80, aniso: 16, people: 1 },
};
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
  const Q = QUALITY[o.quality] || QUALITY.high;
  // the weather you set, ATC's runways from its wind, and the air the aircraft flies through
  const seed = Math.floor(Math.random() * 1e6);
  const wx = new Weather(o.wx || presetWeather(o.weather), { seed });
  const atc = new ATC(wx, { seed, events: o.events || 'realistic' });
  const W = wx.visualAt(STATIONS.ARN.x, STATIONS.ARN.z, 0);
  const boarding = o.boarding !== false;
  // boarding starts about 30 minutes before departure; without it the game starts after pushback
  const opts = { ...o, boarding, depTime: dep.time, flight: dep.flight, startClock: dep.time + (boarding ? -31 : 4) / 60, wx, arrRwy: atc.arrRwy };
  const canvas = document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, stencil: true, powerPreference: 'high-performance' });
  // render scale: the preset's ratio, capped so the frame buffer stays within a sane pixel budget
  const dpr = window.devicePixelRatio || 1;
  const budget = { low: 2.1e6, medium: 3.7e6, high: 5.6e6, ultra: 9.0e6 }[o.quality] || 5.6e6;
  renderer.setPixelRatio(Math.min(dpr, Q.dpr, Math.sqrt(budget / (innerWidth * innerHeight))));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NoToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = Q.shadows > 0; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  setMaxAniso(Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy()));

  ui.loading(0.12, `Planning the route ARN ${atc.depRwy} → CPH ${atc.arrRwy}…`); await frame();
  const route = buildRoute(atc.depRwy, atc.arrRwy);
  atc.initTraffic(route, opts.startClock, dep.time);
  // the air and the aircraft: a rigid-body flight model flown through a turbulent atmosphere
  const atmo = new Atmosphere(wx, { seed });
  const fm = new FlightModel(route, { atmosphere: atmo, ...(boarding ? { coldStart: true, stand: route.gate } : {}) });

  ui.loading(0.2, 'Drawing Sweden and Denmark from map data…'); await frame();
  const world = new World(renderer, { weather: W, quality: o.quality, localTime: opts.startClock, volumetric: Q.vol > 0 && W.cumulus > 0 });
  ui.loading(0.45, 'Building Arlanda, Kastrup and the Øresund Bridge…'); await frame();
  const scenery = new Scenery(world, route, { quality: o.quality });
  scenery.pixelRatio = renderer.getPixelRatio();
  const vol = Q.vol > 0 && W.cumulus > 0 ? new VolumetricClouds(world, { steps: Q.vol }) : null;
  world.u.uVol.value = vol ? 1 : 0;

  ui.loading(0.62, 'Fitting 180 seats…'); await frame();
  const cabinScene = new THREE.Scene();
  cabinScene.fog = new THREE.FogExp2('#dfe4ea', 0); // condensation mist after a decompression
  const pm = new THREE.PMREMGenerator(renderer);
  const roomEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  cabinScene.environment = roomEnv;
  const cabin = new Cabin({ quality: o.quality });
  cabinScene.add(cabin.group);
  const deck = new FlightDeck(cabinScene, { seed: seed + 11 });
  const extScene = new THREE.Scene();
  const ext = new Exterior({ quality: o.quality }); extScene.add(ext.group);
  const skyEnv = makeSkyEnv(renderer);
  extScene.environment = skyEnv.texture;
  // world-frame copy so glass facades, jet bridges and parked aircraft reflect the real sky
  const worldEnv = makeSkyEnv(renderer);
  world.scene.environment = worldEnv.texture; world.scene.environmentIntensity = 0.55;
  // cabin sunlight (sunbeams through the windows)
  const sun = new THREE.DirectionalLight('#ffffff', 0);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(Q.shadows || 1024, Q.shadows || 1024);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 70 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  sun.target.position.set(0, 1, 11); cabinScene.add(sun, sun.target);

  ui.loading(0.75, 'Boarding the passengers…'); await frame();
  const voice = new Voice(ui, { voice: o.voice, lang: o.lang });
  const people = new People(cabin, cabinScene, { load: o.load, seed: (seed * 31 + o.depIndex * 7 + o.seat.length) >>> 0, playerSeat: o.seat, audio, quality: o.quality });
  const pr = rng(4242);
  const player = new Player(cabin, cabinScene, o.seat, audio, randomAppearance(pr, { female: pr() < 0.5, jacket: true, glasses: false, headphones: null }));
  player.sensitivity = o.sensitivity ?? 1; player.camera.fov = o.fov ?? 68;
  const dialogue = new Dialogue(people, voice, ui, {});
  if (Q.vol > 0) cabin.buildDust(player.seat);

  ui.loading(0.88, 'Preparing the cameras…'); await frame();
  // Window stencil: the outside world and the aircraft exterior are only shaded
  // inside the window panes, door windows and (on arrival) the open door.
  const maskScene = buildWindowMask(cabin, deck);
  const maskAll = buildFullMask();
  stencilTest(world.scene); stencilTest(extScene);
  renderer.shadowMap.autoUpdate = false;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const post = new PostFX(renderer, { width: size.x, height: size.y, quality: o.quality });
  const extCam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 600);
  S = { ui, renderer, route, fm, atmo, wx, atc, world, scenery, cabin, deck, cabinScene, ext, extScene, skyEnv, worldEnv, sun, audio, voice, people, player, dialogue, opts, Q, speed: o.speed, paused: false, fast: false, env: null, maskScene, maskAll, post, vol, extCam, orbit: { yaw: 2.4, pitch: 0.18, dist: 48 }, view: 'cabin', frameNo: 0, flash: 0 };
  const director = new Director(S);
  S.director = director;
  S.cabinDyn = new CabinDynamics(S);
  fm.onSubstep = (h) => S.cabinDyn.substep(h);
  S.incidents = new Incidents(S, o.events || 'realistic');
  // the two pilots: they fly the aircraft through its controls, talk to ATC and tell the cabin what they need
  S.crew = new Crew(fm, atc, { seed, hooks: {
    log: (m) => ui.radio(m),
    seatbelt: (on) => director.setSeatbelt(on),
    cabinReady: () => director.cabinReady(),
    emergency: (kind, d) => S.incidents.onCrew(kind, d),
  } });
  S.flashSeen = -1; S.wxT = 0;
  deck.setCrew(S.crew);
  if (boarding) {
    // at gate F36 in pier F: the player waits in the hold room with everyone else
    S.boarding = new Boarding(S, { gate: route.gate.name });
    scenery.setBoardingMode(true);
    cabin.doors.L1.open = cabin.doors.L1.target = 1;
    player.startStanding(6, FACADE_Z - 1.5, 2.52);
    people.hallZ = FACADE_Z - 1; // in the open hall people walk round you
    player.floorAt = (x, z) => (S.boarding.group.visible ? S.boarding.floorAt(x, z) : 0);
    people.floorAt = player.floorAt;
    addMasks(maskScene, S.boarding.maskMeshes, () => S.boarding.group.visible);
  }
  // the flight deck: reachable through the cockpit door when it is open
  player.extraWalk = (x, z) => {
    if (S.boarding && S.boarding.walkable(x, z)) return true;
    if (cabin.cockpitDoor.open > 0.85) return deck.walkable(x, z) || (z > COCKPIT_DOOR_Z - 0.1 && z < COCKPIT_DOOR_Z + 0.3 && Math.abs(x) < 0.3);
    return player.pos.z < COCKPIT_DOOR_Z && z < COCKPIT_DOOR_Z - 0.08 && deck.walkable(x, z); // door shut behind you
  };
  // Admission to the flight deck is the commander's decision under the operator's manual (EU Part-CAT
  // CAT.GEN.MPA.135); in flight the door stays locked. The observer-seat option is a what-if.
  S.deckAccess = !!o.deck;
  if (S.deckAccess) cabin.cockpitDoor.locked = false;

  ui.loading(0.95, 'Closing the doors…'); await frame();
  resize();
  ui.loading(1); ui.showHUD(true);
  setupInput();
  setupPause();
  S.debug = new Debug(S, { run: (n) => window.__run(n) });
  S.clock = new THREE.Clock();
  S.lastMap = 0;
  renderer.setAnimationLoop(loop);
  if (S.boarding) {
    ui.toast(`Gate ${route.gate.name}, pier F, Arlanda Terminal 5 · your boarding pass: ${opts.flight} to Copenhagen, seat ${o.seat}, group ${S.boarding.playerGroup} · wait for your group, then scan your pass at the gate`, 10);
    setTimeout(() => ui.toast('Click the view to look around · W A S D to walk · E to use things · Esc for help', 7), 10500);
  } else ui.toast('Click the view to look around · B fastens your seatbelt · Esc for help', 7);
  setTimeout(() => ui.toast('Tip: M for the flight map on your phone · T talks to your neighbour · V looks at the aircraft from outside', 7), 8000);
}

function buildWindowMask(cabin, deck) {
  const scene = new THREE.Scene();
  const mat = maskMaterial();
  cabin.group.updateMatrixWorld(true);
  const add = (src, scale = 1.06) => { const m = new THREE.Mesh(src.geometry, mat); src.matrixWorld.decompose(m.position, m.quaternion, m.scale); m.scale.multiplyScalar(scale); scene.add(m); return m; };
  for (const w of cabin.windows) add(w.pane);
  deck.group.updateMatrixWorld(true);
  for (const m of deck.maskMeshes) add(m, 1);
  const doorPanes = [];
  for (const d of Object.values(cabin.doors)) d.pivot.traverse((o) => { if (o.isMesh && o.material === cabin.paneMat) doorPanes.push({ src: o, m: add(o) }); });
  scene.userData.doorPanes = doorPanes;
  // open L1 door (shown when the door opens at the gate)
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.95), mat); hole.position.set(-wallX(1.0, DOORS.L1.z) - 0.02, 0.98, DOORS.L1.z); hole.rotation.y = Math.PI / 2; hole.visible = false; scene.add(hole);
  scene.userData.doorHole = hole;
  return scene;
}
// stencil openings that move or come and go (the jet bridge and the terminal glass)
function addMasks(scene, meshes, visible) {
  const mat = maskMaterial();
  for (const src of meshes) { const m = new THREE.Mesh(src.geometry, mat); scene.add(m); scene.userData.dynamic = scene.userData.dynamic || []; scene.userData.dynamic.push({ src, m, visible }); }
}
function maskMaterial() {
  return new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilFail: THREE.ReplaceStencilOp });
}
// A full-screen stencil write for the outside camera.
function buildFullMask() {
  const scene = new THREE.Scene();
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), maskMaterial());
  q.frustumCulled = false; scene.add(q);
  scene.userData.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
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
  for (const c of [S.player.camera, S.world.camera, S.extCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
  const size = S.renderer.getDrawingBufferSize(new THREE.Vector2());
  S.post.setSize(size.x, size.y);
}
window.addEventListener('resize', resize);

// ---------------- simulation step ----------------
function simStep(dt, render = true) {
  const { fm, director, people, cabin, player, world } = S;
  director.update(dt);
  S.incidents.update(dt);
  fm.update(dt);
  const pp = player.pos;
  people.playerBlock = player.state === 'standing' ? { x: pp.x, z: pp.z } : null;
  people.update(dt, { player: { x: player.eye.x, z: player.eye.z }, phase: fm.phase, bump: fm.bump, force: !render, crewNear: (seat) => people.crew.some((c) => Math.abs(c.z - seat.z) < 1.2 && !c.seated) });
  if (S.boarding && !S.boarding.hidden) S.boarding.update(dt);
  cabin.update(dt);
  S.deck.update(dt, S, render && player.eye.z < -2.6 && S.view === 'cabin');
  S.cabinDyn.update(dt);
  S.dialogue.playerPos = player.eye;
}

function fastForward(cond, maxSec = 5400) {
  S.fast = true; S.voice.skipAll(); S.ui.mute = true; S.dialogue.muted = true;
  const P = S.player;
  if (S.boarding && !S.boarding.complete && !cond()) S.boarding.skipToSeat();
  let t = 0;
  while (t < maxSec && !cond()) {
    if (P.state !== 'seated' && P.state !== 'jump') { P.pos.set(0, 0, P.seat.z - 0.28); P.sitDown(); }
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
  const { fm, world, cabin, ext, player, audio, people, director, ui, post } = S;
  const dt = S.paused ? 0 : realDt * S.speed;
  S.debug?.beginFrame();
  if (dt > 0) simStep(dt);
  // ---- camera & head motion ----
  const rr = fm.rollRumble;
  const tt = fm.t;
  // runway and taxiway texture through the seat, plus the head moved by the real accelerations
  const vib = ((vnoise1(tt * 31) - 0.5) * 0.006 + (vnoise1(tt * 13 + 5) - 0.5) * 0.004) * rr + (vnoise1(tt * 47 + 9) - 0.5) * 0.004 * (fm.buffet || 0);
  thumpY = Math.max(0, thumpY - realDt * 6); if (fm.thump > 0.5 && !S._thumped) { thumpY = 0.035 * fm.thump; S._thumped = true; } if (fm.thump < 0.1) S._thumped = false;
  S.cabinDyn.headOffset(shake); shake.y += vib - thumpY;
  const sf = S.cabinDyn.sfCabin;
  const freeView = S.view === 'free';
  const pKeys = player.keys; if (freeView) player.keys = {}; // WASD fly the debug camera instead
  player.update(realDt, { headOffset: shake, headRoll: clamp(-sf.x / 9.81 * 0.05, -0.08, 0.08) + (vnoise1(tt * 5 + 50) - 0.5) * 0.003 * (fm.turbLevel || 0), blocked: (x, z) => people.crew.concat(people.walkers).some((c) => c.root.visible && !c.seated && Math.abs(c.x - x) < 0.35 && Math.abs(c.z - z) < 0.45) });
  if (freeView) player.keys = pKeys;
  const outside = S.view !== 'cabin';
  const cam = freeView ? S.debug.freeCamera(realDt, pKeys) : outside ? updateOrbitCamera(realDt) : player.camera;
  // world camera = aircraft pose * aircraft-local camera
  const wc = world.camera;
  wc.fov = cam.fov;
  tmpV.copy(cam.position).sub(G_LOCAL).applyQuaternion(fm.quat).add(fm.pos);
  wc.position.copy(tmpV);
  wc.quaternion.copy(fm.quat).multiply(cam.quaternion);
  wc.updateProjectionMatrix(); wc.updateMatrixWorld();
  sharedUniforms.uViewUp.value.set(0, 1, 0).transformDirection(wc.matrixWorldInverse);
  const localH = S.opts.startClock + director.t / 3600;
  if (dt > 0) weatherTick(realDt);
  const env = S.env = world.update(dt, fm.t, fm, wc.position, wc.quaternion, localH);
  // sunshine heats the ground and drives thermals (weak under overcast, none at night)
  S.atmo.sunHeat = smoothstep(4, 45, world.sunEl ?? 0) * (world.weather.stratus ? 0.25 : 1);
  S.scenery.update(dt, fm.t, fm, env, director, S.atc);
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
  if (S.skyEnv.t > 2.5) { S.skyEnv.t = 0; S.skyEnv.update(env, sunLocal); S.extScene.environment = S.skyEnv.texture; S.worldEnv.update(env, env.sunDir); S.world.scene.environment = S.worldEnv.texture; const gm = S.scenery.mats.glass; gm.envMap = S.worldEnv.texture; gm.envMapIntensity = 1.8; }
  const humidity = S.atmo.rain > 0.3 || S.atmo.inCloud ? 1 : S.world.weather.cumulus > 0.5 ? 0.6 : S.world.weather.fog ? 0.7 : 0;
  const beacon = S.crew ? S.crew.sys.beacon : !ext.beaconOff;
  S.lights = { beacon, landing: llOn, taxi: fm.onGround && fm.gs > 1 && fm.phase !== 'pushback', nose: fm.phase === 'takeoff' || fm.phase === 'lineup' ? 'TO' : fm.onGround && fm.gs > 1 && fm.phase !== 'pushback' ? 'TAXI' : 'OFF' };
  ext.update(dt, fm.t, fm, { nightK: env.nightK, strobes: !fm.onGround || fm.phase === 'takeoff' || fm.phase === 'rollout', beacon, scan: env.nightK > 0.3 && (fm.onGround || fm.h < 3048), landing: llOn, outside, humidity: fm.h < 2500 ? humidity : 0, sunLocal, direct: sunUp ? clamp(sunI * 1.2, 0, 1) : 0, cabinLight: director.lightLevel, doorL1: cabin.doors.L1.open });
  cabin.updateDust(fm.t, sunI, sunLocal);
  // cabin sun & lights
  const sun = S.sun;
  sun.position.copy(sunLocal).multiplyScalar(40).add(sun.target.position);
  sun.color.copy(env.sunCol).multiplyScalar(1 / Math.max(0.001, sunI || 1));
  sun.intensity = sunI * 1.05;
  const daylight = clamp(env.day * (env.belowOvercast ? 0.45 : 1), 0, 1);
  let L = director.lightLevel; if (director.flicker > 0) L *= (Math.sin(director.flicker * 40) > 0 ? 1 : 0.05);
  cabin.setLighting(L, director.mood, daylight, director.scene);
  S.cabinScene.environmentIntensity = 0.1 + 0.55 * L + 0.25 * daylight;
  // window pane effects: frost at cruise, rain streaks at low level, condensation in cloud
  const pmu = cabin.paneMat.uniforms;
  // rain on the windows: what is actually falling where the aircraft is (showers under storms, rain below the cloud)
  pmu.uTime.value = fm.t; pmu.uSpeed.value = fm.v; pmu.uRain.value = damp(pmu.uRain.value, clamp(S.atmo.rain / 8, 0, 1.2), 0.5, dt || 0.0001);
  pmu.uFrost.value = damp(pmu.uFrost.value, fm.h > 9000 ? 0.85 : 0, 0.03, dt || 0.0001);
  pmu.uFog.value = damp(pmu.uFog.value, env.inCloud > 0.4 ? 0.5 : 0, 0.5, dt || 0.0001);
  pmu.uLight.value = clamp(0.25 + daylight * 0.9 + L * 0.2, 0.05, 1.2);
  // ---- audio ----
  audio.update(realDt, { n1: fm.n1, ias: fm.ias, onGround: fm.onGround, v: fm.v, agl: fm.h, gear: fm.gear, gearMoving: fm.gearMoving, flapsMoving: fm.flapsMoving, spoiler: fm.spoiler, reverse: fm.reverse, rollRumble: fm.rollRumble, bump: fm.bump, rain: pmu.uRain.value + (S.atmo.hail || 0) * 0.8, packs: true, gasper: player.gasper, doorOpen: cabin.doors.L1.open > 0.5, outside });
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  audio.setListener(cam.position, fwd, up);
  audio.babble = fm.phase === 'takeoff' || fm.phase === 'flare' ? 0.05 : fm.phase === 'arrived' ? 0.7 : 0.28;
  // ear pressure during descent
  if (fm.vs < -5 && fm.h < 6000) audio.muffle = clamp(audio.muffle + realDt * 0.004, 0, 0.55); else audio.muffle = Math.max(0, audio.muffle - realDt * 0.002);
  // ---- exposure & render ----
  const nk = env.nightK;
  const expOut = lerp(0.62, 2.6, nk) * (env.belowOvercast ? 1.35 : 1) * (env.inCloud > 0.5 ? 0.85 : 1);
  const expIn = outside ? expOut : lerp(0.66, 0.95, 1 - L) * lerp(1, 0.82, daylight);
  const preExp = expOut / expIn;
  sharedUniforms.uPreExp.value = preExp;
  const r = S.renderer;
  S.frameNo++;
  if (freeView) {
    // debug camera: the outside world and exterior; inside the fuselage or the terminal, the cabin scene too
    renderOutside(r, cam, wc, preExp);
    const p = cam.position, inFuselage = Math.abs(p.x) < 1.9 && p.y > -0.3 && p.y < 2.5 && p.z > -6.5 && p.z < 24.5;
    if (inFuselage || (S.boarding && S.boarding.group.visible && (p.x < -2 || p.z < -14))) { r.clearDepth(); r.render(S.cabinScene, cam); }
  }
  else if (outside) renderOutside(r, cam, wc, preExp); else renderCabin(r, cam, wc, preExp, L);
  S.flash = Math.max(0, S.flash - realDt * 3);
  S.flashRed = Math.max(0, (S.flashRed || 0) - realDt * 0.8);
  post.finish({ exposure: expIn, time: fm.t, night: nk, earFade: audio.muffle * 0.5 + (S.hypoxia || 0) * 0.9, flash: S.flash, red: S.flashRed, dark: S.blackout || 0, bloom: S.Q.bloom, smaa: S.Q.smaa });
  S.ui.maskOverlay(!!player.maskOn && S.view === 'cabin');
  // ---- UI ----
  if (!outside) hover(); else { S.hovered = null; ui.prompt(null); }
  const arrR = fm.route.arrRwy || S.atc.arrRwy;
  const phaseName = fm.crashed ? 'Emergency' : fm.phase === 'hold' ? `Holding short ${S.atc.depRwy}` : fm.phase === 'approach' ? `Approach ${arrR}, ${fm.airport === 'ARN' ? 'Arlanda' : 'Kastrup'}` : fm.airport === 'ARN' && fm.phase === 'taxi-in' ? 'Taxiing to the stand' : fm.airport === 'ARN' && fm.phase === 'arrived' ? 'Back at Arlanda' : (fm.phase === 'cruise' ? `Cruise FL${String(Math.round(fm.altInd / FT / 1000) * 10).padStart(3, '0')}` : PHASE_NAMES[fm.phase] || fm.phase);
  ui.hud({ flight: S.opts.flight, clock: localH, phase: phaseName, belt: director.seatbelt, speed: S.speed });
  S.lastMap -= realDt;
  if (S.lastMap <= 0 && (ui.phoneOpen() || ui.radioOpen())) { S.lastMap = 0.25; if (ui.phoneOpen()) ui.updatePhone(phoneState(localH)); ui.flightDeck(deckState()); }
  // end condition: walk out of the front door
  if (fm.phase === 'arrived' && cabin.doors.L1.open > 0.9 && !S._deckInvite && !S.deckAccess) { S._deckInvite = true; ui.toast('The captain is saying goodbye at the door — ask at the cockpit door keypad if you would like to see the flight deck', 7); }
  if (fm.phase === 'arrived' && cabin.doors.L1.open > 0.9 && player.state === 'standing' && Math.abs(player.pos.z - DOORS.L1.z) < 0.4 && player.pos.x < -0.7 && !S.ended) endFlight();
  if (S.photoPending) takePhoto();
  S.debug?.update(realDt);
}

// Cabin view: outside world only where windows are (stencil), then aircraft exterior, then the cabin.
function renderCabin(r, cam, wc, preExp, L) {
  const { post, world, cabin, maskScene: mask, vol } = S;
  r.setRenderTarget(post.rtMain); r.clear(true, true, true);
  for (const dp of mask.userData.doorPanes) { dp.src.updateMatrixWorld(); dp.src.matrixWorld.decompose(dp.m.position, dp.m.quaternion, dp.m.scale); }
  for (const dp of mask.userData.dynamic || []) { dp.m.visible = dp.visible(); if (dp.m.visible) { dp.src.updateWorldMatrix(true, false); dp.src.matrixWorld.decompose(dp.m.position, dp.m.quaternion, dp.m.scale); } }
  mask.userData.doorHole.visible = cabin.doors.L1.open > 0.05;
  if (anyWindowVisible(cam)) {
    r.render(mask, cam);
    r.setRenderTarget(post.rtWorld); r.clear(true, true, true);
    r.render(mask, cam);
    world.render(r, wc);
    r.setRenderTarget(post.rtMain);
    if (vol) vol.render(r, wc, post.rtWorld, preExp, S.fm.t); else post.blitWorld();
    r.clearDepth();
    const inDeck = cam.position.z < -3.3;
    for (const m of S.ext.cockpitGlazing) m.visible = !inDeck;
    r.render(S.extScene, cam);
    for (const m of S.ext.cockpitGlazing) m.visible = true;
  }
  if (r.shadowMap.enabled && S.frameNo % 2 === 0) r.shadowMap.needsUpdate = true;
  r.render(S.cabinScene, cam);
}

// Outside view: the whole frame is world + aircraft exterior.
function renderOutside(r, cam, wc, preExp) {
  const { post, world, maskAll, vol } = S;
  r.setRenderTarget(post.rtWorld); r.clear(true, true, true);
  r.render(maskAll, maskAll.userData.cam);
  world.render(r, wc);
  r.setRenderTarget(post.rtMain); r.clear(true, true, true);
  r.render(maskAll, maskAll.userData.cam);
  if (vol) vol.render(r, wc, post.rtWorld, preExp, S.fm.t); else post.blitWorld();
  r.clearDepth();
  r.render(S.extScene, cam);
}

function updateOrbitCamera(dt) {
  const o = S.orbit, c = S.extCam;
  const target = new THREE.Vector3(0, 0.2, 9.5);
  const ground = G_LOCAL.y + 0.4; // keep the camera above the tarmac in aircraft coordinates
  const minPitch = S.fm.onGround ? Math.asin(clamp((ground - target.y) / o.dist, -1, 1)) + 0.02 : -1.2;
  o.pitch = clamp(o.pitch, Math.max(-1.4, minPitch), 1.45);
  const cp = Math.cos(o.pitch);
  c.position.set(target.x + Math.sin(o.yaw) * cp * o.dist, target.y + Math.sin(o.pitch) * o.dist, target.z + Math.cos(o.yaw) * cp * o.dist);
  c.lookAt(target);
  c.updateMatrixWorld();
  return c;
}

function setView(v) {
  S.view = v;
  S.ui.toast(v === 'outside' ? 'Outside view · drag to orbit, scroll to zoom · V to return' : 'Back in your seat', 3);
  document.getElementById('crosshair').hidden = v === 'outside';
}

// In the claude.ai viewer the page cannot trigger downloads itself; the `downloads` capability asks the
// viewer to save the file. Anywhere else (the standalone HTML file) a plain download link is used.
let downloadsApi = null;
try { window.claude?.use?.('downloads')?.then((d) => { downloadsApi = d; }, () => {}); } catch (e) { /* not in a viewer */ }

function takePhoto() {
  S.photoPending = false;
  const canvas = S.renderer.domElement;
  const t = S.opts.startClock + S.director.t / 3600;
  const filename = `SK1415-${String(Math.floor(t)).padStart(2, '0')}${String(Math.floor((t % 1) * 60)).padStart(2, '0')}.png`;
  const say = (msg) => S.ui.toast(msg, 3);
  try {
    canvas.toBlob(async (blob) => {
      if (!blob) { say('Could not take the photo'); return; }
      if (downloadsApi) {
        try { await downloadsApi.save({ filename, data: blob }); say('Photo saved'); }
        catch (e) { say(e && e.code === 'declined' ? 'Photo not saved' : e && e.code === 'rate_limited' ? 'Finish saving the last photo first' : 'Saving photos is not available here'); }
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      say('Photo saved (if your browser allows downloads)');
    }, 'image/png'); // the bitmap is copied now, so the flash below is not in the picture
  } catch (e) { say('Could not take the photo'); }
  S.flash = 0.6;
  S.ui.showHUD(true);
}

function anyWindowVisible(cam) {
  // skip the whole outside pass when no window, door or hatch is in view
  if (cam.position.z < -3.3) return true; // in the flight deck: the windshield fills the view
  if (S.boarding && S.boarding.group.visible && cam.position.x < -2.0) return true; // in the jet bridge or the terminal
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
  const oat = S.atmo.oat;
  return { clock: localH, onGround: fm.onGround, altFt: fm.altInd / FT, gs: fm.v / KT, eta: director.eta(), hdg: ((fm.heading / DEG) + 360) % 360, oat, distKm: (route.m.stand - fm.s) / 1000, routePts: pts, flownIdx: idx, x: fm.pos.x, z: fm.pos.z };
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
  if (S.cabin.cockpitDoor.open > 0.5 && player.state === 'standing') list.push(...S.deck.interactables);
  if (S.boarding && S.boarding.group.visible) list.push(...S.boarding.interactables);
  if (people.neighbor) { const a = people.neighbor.actor; if (!a.root.userData.interact) a.root.userData.interact = { kind: 'neighbor', prompt: () => `Talk to ${people.neighbor.P.name}  [T]` }; a.root.traverse((o) => { if (o.isMesh) list.push(o); }); }
  for (const c of people.crew) { if (!c.root.userData.interact) c.root.userData.interact = { kind: 'crew', actor: c, prompt: () => `Excuse me, ${c.name}…` }; if (Math.abs(c.z - player.eye.z) < 2) c.root.traverse((o) => { if (o.isMesh) list.push(o); }); }
  return list;
}

function hover() {
  if (S.frameNo % 2) return; // picking every other frame is plenty
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
    case 'menu': ui.toggleMenuCard(); break;
    case 'light': player.setReadingLight(!player.readingLight); break;
    case 'call': player.setCall(!player.callOn); break;
    case 'gasper': player.gasper = !player.gasper; audio.clunk(0.08); break;
    case 'cockpit': {
      const cd = cabin.cockpitDoor;
      if (cd.target > 0.5) { if (player.pos.z < COCKPIT_DOOR_Z + 0.1 && player.state === 'standing') { ui.toast('Step out of the flight deck first.'); break; } cd.target = 0; audio.clunk(0.25); break; }
      if (cd.locked) { ui.toast(S.fm.onGround && ['arrived'].includes(S.fm.phase) ? 'Ask the crew — press the keypad.' : 'The cockpit door is locked for the whole flight.'); break; }
      if (player.state !== 'standing') { ui.toast('Stand up first (Space).'); break; }
      cd.target = 1; audio.clunk(0.25); break;
    }
    case 'keypad': {
      const cd = cabin.cockpitDoor;
      if (!cd.locked) { ui.toast('The door is unlocked.'); break; }
      if (S.fm.phase === 'arrived') { cd.locked = false; audio.chime('single'); ui.toast(`${S.crew.capt.name}: "Of course — come and have a look at the flight deck."`, 5); }
      else ui.toast('Nobody is admitted to the flight deck in flight or on the ground before the flight. The crew can visit you, not the other way round.', 5);
      break;
    }
    case 'egate': S.boarding.playerScan(); break;
    case 'jumpseat': {
      if (player.sitJump(S.deck.jumpEye)) { cabin.cockpitDoor.target = 0; ui.toast('Observer seat, harness on · look around with the mouse · Space to get up', 5); }
      break;
    }
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
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const pr = canvas.requestPointerLock(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* not available */ } return; }
    if (S.view === 'cabin') use(S.hovered);
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && !S.ended && !S._noPauseOnUnlock) { pause(true); S._unlockT = performance.now(); }
    S._noPauseOnUnlock = false;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (S.view === 'outside') { S.orbit.yaw -= e.movementX * 0.004; S.orbit.pitch += e.movementY * 0.004; }
    else if (S.view === 'free') S.debug.look(e.movementX, e.movementY);
    else player.look(e.movementX, e.movementY);
  });
  canvas.addEventListener('wheel', (e) => { if (S.view === 'outside') { S.orbit.dist = clamp(S.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 14, 160); e.preventDefault(); } }, { passive: false });
  // drag to look when the pointer isn't locked (e.g. inside an embedded viewer)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (document.pointerLockElement !== canvas) drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (S.view === 'outside') { S.orbit.yaw += dx * 0.006; S.orbit.pitch -= dy * 0.006; } else if (S.view === 'free') S.debug.look(-dx * 1.6, -dy * 1.6); else player.look(-dx * 1.6, -dy * 1.6);
  });
  window.addEventListener('pointerup', () => { drag = null; });
  const keyDown = (code) => {
    if (S.ui.weatherOpen()) return;
    if (S.ui.pauseOpen() && code !== 'Escape') return;
    const P = S.player, D = S.director;
    if (/^Digit[1-5]$/.test(code)) { if (ui.pickNumber(+code.slice(5))) return; }
    switch (code) {
      case 'F3': case 'Backquote': S.debug.toggle(); break;
      case 'KeyE': if (S.view === 'cabin') use(S.hovered); break;
      case 'KeyB': if (P.state === 'seated') { P.setBelt(!P.belt); ui.toast(P.belt ? 'Seatbelt fastened' : 'Seatbelt unfastened', 2); } break;
      case 'KeyF': P.setTray(!P.tray); break;
      case 'KeyR': if (P.state === 'seated') { if (!P.recline && D.seatbelt) { ui.toast('Seat backs must stay upright while the seatbelt sign is on'); break; } P.setRecline(!P.recline); } break;
      case 'KeyT': if (ui.chatOpen()) S.dialogue.close(); else openChat(); break;
      case 'KeyM': ui.togglePhone(); S.lastMap = 0; break;
      case 'KeyY': S.audio.pop(); ui.toast('*swallow* — ears cleared', 2); break;
      case 'KeyH': pause(true); break;
      case 'KeyV': setView(S.view === 'outside' ? 'cabin' : 'outside'); break;
      case 'KeyC': ui.toggleRadio(); S.lastMap = 0; break;
      case 'KeyO': toggleMask(); break;
      case 'KeyP': S.ui.showHUD(false); S.photoPending = true; S.audio.clunk(0.15); break; // the flash comes after the capture
      case 'F11': case 'KeyU': toggleFullscreen(); break;
      case 'Space': {
        if (S.view === 'outside') break;
        if (P.fallen) { if (P.getUp()) ui.toast('You get back on your feet.', 2); break; }
        if (P.state === 'jump') { P.leaveJump(); break; }
        if (P.state === 'seated') { const r = P.standUp(); if (r === 'belt') ui.toast('Unfasten your seatbelt first (B)'); else if (r === 'tray') ui.toast('Fold the tray table first (F)'); else if (r === true) { ui.toast('Walk with W A S D · Space to sit when you are back at your row', 4); if (D.seatbelt && S.fm.phase !== 'arrived') ui.toast('The seatbelt sign is on!', 3); } }
        else if (!P.sitDown()) ui.toast('Walk back to your row to sit down');
        break;
      }
      case 'Equal': case 'NumpadAdd': setSpeed(nextSpeed(1)); break;
      case 'Minus': case 'NumpadSubtract': setSpeed(nextSpeed(-1)); break;
      case 'Escape':
        if (performance.now() - (S._unlockT || 0) < 400) break; // the same Esc already released the pointer lock and paused
        if (!document.getElementById('card').hidden) { ui.toggleCard(false); break; }
        if (!document.getElementById('menucard').hidden) { ui.toggleMenuCard(false); break; }
        if (S.ui.pauseOpen()) pause(false); else pause(true);
        break;
      default: break;
    }
  };
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'F11' || e.code === 'F3') e.preventDefault();
    S.player.keys[e.code] = true;
    if (!e.repeat) keyDown(e.code);
  });
  window.addEventListener('keyup', (e) => { S.player.keys[e.code] = false; });
  ui.on('order', (id, item) => S.director.playerOrder(id, item));
  ui.on('call', (id) => S.director.callAnswer(id));
  document.getElementById('card').addEventListener('click', () => ui.toggleCard(false));
  document.getElementById('menucard').addEventListener('click', () => ui.toggleMenuCard(false));
  S.player.addItem = (id) => addTrayItem(id);
  S.player.onChange = (k, v) => { if (k === 'belt' && v) S.director.stats.belt++; };
}

function toggleFullscreen() {
  const el = document.documentElement;
  try { if (!document.fullscreenElement) el.requestFullscreen?.(); else document.exitFullscreen?.(); } catch (e) { /* not allowed here */ }
}

// Your oxygen mask: only once the masks have dropped, and only from your seat (or standing in the aisle
// holding one of the spare masks in the galley would be a stretch, so seated only).
function toggleMask() {
  const P = S.player;
  if (!S.cabin.masksDown) { S.ui.toast('The oxygen masks are stowed above you. They drop automatically if the cabin loses pressure.', 4); return; }
  if (P.state !== 'seated' && !P.maskOn) { S.ui.toast('Sit down to reach a mask.', 3); return; }
  P.maskOn = !P.maskOn; S.audio.clunk(0.15);
  S.ui.toast(P.maskOn ? 'You pull the mask down (that starts the oxygen), put it over your nose and mouth and tighten the strap.' : 'You take the mask off.', 5);
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
  m.castShadow = true; m.userData.item = id; P.trayItems.add(m);
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
  ui.setEvents(SCENARIOS, (id) => { S.incidents.trigger(id); });
  const skips = [
    { id: 'pushback', label: 'Pushback', cond: () => S.fm.phase !== 'boarding' },
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
  document.getElementById('pause-wx').onclick = () => ui.openWeather(S.wx.s, { live: true, onApply: (st) => applyWeather(st) });
  document.getElementById('vol').oninput = (e) => S.audio.setVolume(+e.target.value);
  document.getElementById('sens').value = String(S.player.sensitivity); document.getElementById('sens').oninput = (e) => { S.player.sensitivity = +e.target.value; };
  document.getElementById('fov').value = String(S.player.camera.fov); document.getElementById('fov').oninput = (e) => { S.player.camera.fov = +e.target.value; S.player.camera.updateProjectionMatrix(); };
  document.getElementById('pause-voice').checked = S.voice.enabled;
  document.getElementById('pause-voice').onchange = (e) => { S.voice.enabled = e.target.checked; if (!e.target.checked && window.speechSynthesis) speechSynthesis.cancel(); };
  document.getElementById('fullscreen').onclick = () => toggleFullscreen();
  document.getElementById('again').onclick = () => location.reload();
  document.getElementById('stay').onclick = () => { ui.hideEnd(); S.ended = false; S._endShown = true; };
}

function endFlight() {
  if (S._endShown) return;
  S.ended = true;
  const d = S.director;
  const mins = Math.round(d.t / 60);
  S.ui.showEnd({
    text: `You flew ${S.opts.flight} from Stockholm Arlanda (runway ${S.atc.depRwy}) to ${S.fm.airport === 'ARN' ? 'Stockholm Arlanda and back' : `Copenhagen Kastrup (runway ${S.fm.route.arrRwy})`} on Sunday 10 May 2026, in seat ${S.opts.seat} of SAS A320neo SE-ROX "Roar Viking". Captain ${S.crew.capt.name} and First Officer ${S.crew.fo.name} flew it by hand and by autopilot${S.crew.goArounds ? `, with ${S.crew.goArounds} go-around${S.crew.goArounds > 1 ? 's' : ''}` : ''}; touchdown at ${Math.round((S.fm.touchdownSink || 0) / FT * 60)} ft/min.`,
    items: [['Time on board', `${mins} min`], ['Distance', `${Math.round(S.fm.s / 1000 + (S.fm.airport ? 0 : 0))} km flown on this route`], ['Roughest moment', `${(S.maxG || 1).toFixed(2)} g`], ['Coffees', String(d.stats.coffee)], ['Spent on board', `${d.stats.spent} kr`], ['Chats', String(d.stats.talked)]],
  });
  if (document.pointerLockElement) { S._noPauseOnUnlock = true; document.exitPointerLock(); }
}

// ---------------- weather: follows the aircraft, can be changed live, storms flash and rumble ----------------
function weatherTick(realDt) {
  const { wx, atmo, fm, world } = S;
  S.maxG = Math.max(S.maxG || 1, fm.onGround ? 1 : fm.nz);
  S.wxT -= realDt;
  if (S.wxT <= 0) { S.wxT = 2; setVisualWeather(); }
  // lightning: the newest flash lights the clouds around it; thunder follows at the speed of sound
  const f = wx.flashes; let best = null;
  for (let i = f.length - 1; i >= 0; i--) {
    const e = f[i]; if (e.t <= S.flashSeen) break;
    const d = Math.hypot(e.x - fm.pos.x, e.y - fm.pos.y, e.z - fm.pos.z);
    if (d < 150000) { if (!best || e.t > best.t) best = { ...e, d }; if (!S.fast) S.audio.thunder(d, S.view === 'outside' ? 1 : fm.onGround ? 0.8 : 0.5); }
  }
  if (f.length) S.flashSeen = f[f.length - 1].t;
  if (best) { S.flashNow = best; S.flashT = 0; if (best.d < 4000) S.flash = Math.max(S.flash, 0.5 * (1 - best.d / 4000)); }
  const u = world.u.uFlash.value;
  if (S.flashNow) {
    S.flashT += realDt;
    const k = S.flashT < 0.35 ? S.flashNow.i * (0.6 + 0.4 * Math.sin(S.flashT * 90)) * (S.flashNow.cg ? 1.4 : 1) : 0;
    u.set(S.flashNow.x, S.flashNow.y, S.flashNow.z, Math.max(0, k));
    if (S.flashT > 0.35) S.flashNow = null;
  } else u.w = 0;
}
function setVisualWeather() {
  const V = S.wx.visualAt(S.fm.pos.x, S.fm.pos.z, S.atmo.t);
  if (S.world.setWeather(V)) stencilTest(S.world.scene);
  // volumetric cumulus appear when there is cumulus to draw
  if (S.Q.vol > 0 && V.cumulus > 0 && !S.vol) { S.vol = new VolumetricClouds(S.world, { steps: S.Q.vol }); S.world.u.uVol.value = 1; }
  if (S.vol) { const u = S.vol.mat.uniforms; u.uBase.value = V.cuBase; u.uTop.value = V.cuTop; if (V.cumulus <= 0) { S.vol = null; S.world.u.uVol.value = 0; } }
}
// New weather from the pause menu: the atmosphere, the pilots' plans and the picture all follow it.
function applyWeather(state) {
  S.wx.set(state);
  S.atmo.refresh?.();
  setVisualWeather();
  const fm = S.fm;
  if (!['flare', 'rollout'].includes(fm.phase) && !fm.onGround) S.crew._planApproach();
  S.ui.toast(`New weather: ${S.wx.metar('CPH', 4.3, S.atc.arrRwy)}`, 6);
}
// What the flight deck panel shows
function deckState() {
  const { fm, atc } = S; const f = fm.afs.fma();
  const w = S.fm.wind || {};
  const wd = Math.hypot(w.wx || 0, w.wz || 0);
  const from = ((Math.atan2(-(w.wx || 0), (w.wz || 0)) / DEG) + 360) % 360;
  return { unit: atc.unit, fma: f, ias: fm.ias, alt: fm.altInd / FT, std: fm.baro == null, vs: fm.vs / FT * 60, hdg: ((fm.heading / DEG) + 360) % 360, n1: [fm.n1[0] * 100, fm.n1[1] * 100],
    flaps: ['0', '1', '2', '3', 'FULL'][fm.ctl.flapLever] + (fm.ctl.flapLever === 1 && fm.flap > 1 ? '+F' : ''), gear: fm.gear > 0.99 ? 'DOWN' : fm.gear < 0.01 ? 'UP' : 'moving', wind: wd < 0.5 ? 'calm' : `${String(Math.round(from)).padStart(3, '0')}°/${Math.round(wd / KT)}` };
}

// dev hook for automated screenshots
window.__sim = () => S;
window.__boot = (o) => { const a = new AudioEngine(); return boot({ ...ui.opts, ...o }, a); };
window.__ff = (cond) => fastForward(cond);
window.__run = (sec, dt = 0.25) => { S.fast = true; for (let t = 0; t < sec; t += dt) simStep(dt, false); S.fast = false; };
window.__freeze = (v) => { if (!S) return; S.renderer.setAnimationLoop(v ? null : loop); };
window.__renderOnce = () => { if (S) loop(); };
window.__setView = (v) => setView(v);
window.__weather = (st) => applyWeather(st);
