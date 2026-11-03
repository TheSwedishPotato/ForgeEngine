// Med Engine 2 lab: one character under night lights, for checking the human pipeline.
// ?char=rook&shot=cu|mcu|full&rain=1&debug=albedo
import { Mesh, PlaneGeometry, MeshStandardMaterial, SpotLight, PointLight, Object3D, Vector3, BoxGeometry, Color } from 'three';
import { Stage } from '../../../medengine/src/Stage.js';
import { Human } from '../../../medengine/src/human/Human.js';
import { Actor } from '../../../medengine/src/human/Actor.js';

const P = new URLSearchParams(location.search);
const log = document.getElementById('log');
const stage = new Stage(document.getElementById('c'), { quality: P.get('q') ?? 'high' });
window.stage = stage;
if (P.get('nodof')) stage.dof.enabled = false;
if (P.get('nomb')) stage.motionBlur.enabled = false;
if (P.get('notaa')) stage.taa.enabled = false;
if (P.get('nossr')) stage.screen.enabled = false;
for (const k of ['ssao', 'ssr', 'ssgi']) if (P.get('no' + k)) stage.r.q[k] = false;
const { scene, camera, r } = stage;

r.sunDir.set(0.3, 0.8, 0.4).normalize();
r.sunColor.set(0.6, 0.7, 1.0);
r.sunIntensity = 0.08;            // moonlight through cloud
r.weather.night = 1; r.weather.overcast = 0.9; r.weather.cityGlow = [0.06, 0.04, 0.025];
r.cloudCover = 1;
r.envIntensity = 1;
const rain = P.get('rain') === '1';
r.wetness = rain ? 0.9 : 0.2; r.rain = rain ? 1 : 0;
stage.rain.intensity = rain ? 0.8 : 0;
stage.volumetrics.fog = { ...stage.volumetrics.fog, density: 0.01, mist: 0.0, falloff: 0.1, maxDist: 40 };
stage.exposure.minEV = -2; stage.exposure.maxEV = 6; stage.exposure.key = 0.14;

const floorMat = new MeshStandardMaterial({ color: 0x5a5a58, roughness: 0.85 });
floorMat.userData.puddles = true;
const floor = new Mesh(new PlaneGeometry(40, 40), floorMat);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);
const wallMat = new MeshStandardMaterial({ color: 0x4d4d4c, roughness: 0.9 });
wallMat.userData.streaks = true;
const wall = new Mesh(new BoxGeometry(14, 6, 0.3), wallMat);
wall.position.set(0, 3, -2.5); scene.add(wall);

// key: a shadowed spot above and to the left of camera; rim: a fluorescent tube behind; fill: warm sodium
const key = new SpotLight(new Color(1.0, 0.92, 0.82), 14, 12, 0.5, 0.6);
key.position.set(-1.6, 3.6, 2.4); key.castShadow = true; key.userData.shadow = true; key.userData.volumetric = 0.6;
key.target.position.set(0, 1.5, 0);
if (P.get('nospotshadow')) { key.castShadow = false; key.userData.shadow = false; }
scene.add(key, key.target);
const tube = new Object3D();
tube.position.set(0.6, 2.9, -1.4);
tube.userData.light = { type: 'tube', length: 1.4, color: new Color(0.75, 0.9, 1.0), intensity: 25, range: 7 };
scene.add(tube);
const fill = new PointLight(new Color(1.0, 0.75, 0.55), 1.2, 9);
fill.position.set(2.5, 1.2, 2.0);
scene.add(fill);

const id = P.get('char') ?? 'rook';
const actor = await Actor.load(stage, './assets/humans', id, { levels: Number(P.get('levels') ?? 1) });
if (P.get('nocape') && actor.garments.cape) { actor.garments.cape.visible = false; actor.garments.cape = null; }
const human = actor.h;
scene.add(human.root);
window.actor = actor;
actor.posture(P.get('pose') ?? 'idle', 0.001);
actor.emote(P.get('emo') ?? 'neutral');
if (P.get('look')) actor.lookAt(new Vector3(...P.get('look').split(',').map(Number)));
if (P.get('say')) actor.say(P.get('say'));
for (let i = 0; i < 30; i++) actor.update(1 / 30);   // settle (cloth, face)
const head = human.bonePos('head');
const shot = P.get('shot') ?? 'mcu';
const eye = human.bonePos('eye_l').add(human.bonePos('eye_r')).multiplyScalar(0.5);
if (shot === 'cu') { camera.fov = 18; camera.position.set(eye.x + 0.25, eye.y + 0.02, eye.z + 1.6); camera.lookAt(eye.x, eye.y - 0.04, eye.z); }
else if (shot === 'chest') { camera.fov = 16; camera.position.set(eye.x + 0.3, eye.y - 0.3, eye.z + 1.7); camera.lookAt(eye.x, eye.y - 0.38, eye.z); }
else if (shot === 'full') { camera.fov = 30; camera.position.set(0.8, 1.4, 4.6); camera.lookAt(0, 0.95, 0); }
else { camera.fov = 24; camera.position.set(eye.x + 0.4, eye.y, eye.z + 2.2); camera.lookAt(eye.x, eye.y - 0.18, eye.z); }
camera.updateProjectionMatrix();
stage.lens.focus = camera.position.distanceTo(eye);
stage.lens.aperture = 2.0;
stage.lens.focal = 0.085;
stage.composite.letterbox = 1;
Object.assign(stage.grade, { lift: [0.01, 0.015, 0.025], shadowTint: [0.9, 1.0, 1.08], highTint: [1.05, 1.0, 0.94], saturation: 0.9, contrast: 1.08, halation: 0.08 });
stage.bloom.strength = 0.025;

let last = performance.now(), frames = 0;
const maxFrames = Number(P.get('frames') ?? 1e9);
// headless capture: render once more and read the canvas in the same task
window.__capture = () => { actor.update(1 / 60); stage.render(1 / 60); return stage.canvas.toDataURL('image/jpeg', 0.92); };
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  actor.update(dt);
  stage.render(dt);
  frames++;
  if (frames % 30 === 0) log.textContent = `${id} · ${r.width}x${r.height} · lights ${r.lightGrid.stats.lights} (shadowed ${r.lightGrid.stats.shadowed}) · draws ${r.stats.drawCalls} · tris ${(r.stats.triangles / 1e3).toFixed(0)}k`;
  window.__frames = frames;
  if (frames >= maxFrames) { window.__shotReady = true; return; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
void head;
// mesh sanity: any non-finite vertex is reported (window.__nan for the shot tool)
window.__nan = human.meshes.map((m) => { const a = m.geometry.attributes.position.array; let bad = 0; for (const x of a) if (!Number.isFinite(x)) bad++; const n = m.geometry.attributes.normal.array; let badN = 0; for (const x of n) if (!Number.isFinite(x)) badN++; return bad || badN ? `${m.name}: ${bad} bad positions, ${badN} bad normals of ${a.length}` : null; }).filter(Boolean);
if (window.__nan.length) console.error('NaN meshes: ' + window.__nan.join(' | '));
{ const bad = human.boneList.filter((b) => !b.quaternion.toArray().every(Number.isFinite) || !b.position.toArray().every(Number.isFinite)).map((b) => b.name);
  if (bad.length) console.error('NaN bones: ' + bad.join(','));
  console.warn('root ' + human.root.position.toArray().join(',') + ' eyes ' + actor.eyes().toArray().map((x) => x.toFixed(3)).join(',')); }
