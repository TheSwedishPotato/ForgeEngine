// The stills studio: renders the illustrated story's pictures with the 3D engine.
//   window.renderStill({ kind: 'portrait', who, emo, bg: 0|1 })  -> JPEG data URL (black or white backdrop,
//                                                                    for difference matting)
//   window.renderStill({ kind: 'plate', set, time, cam: { pos, target, fov }, lights }) -> JPEG data URL
import { Mesh, PlaneGeometry, MeshBasicMaterial, SpotLight, PointLight, Object3D, Color, Vector3 } from 'three';
import { Stage } from '../../../medengine/src/Stage.js';
import { Actor } from '../../../medengine/src/human/Actor.js';
import { SETS } from './sets/index.js';

const canvas = document.getElementById('c');
const stage = new Stage(canvas, { quality: 'ultra' });
const { r, scene, camera } = stage;
window.stage = stage;
const actors = {};
let current = null;

const EMO = {
  neutral: { face: 'neutral', pose: 'idle' }, grim: { face: 'grim', pose: 'stand_wide' }, angry: { face: 'angry', pose: 'idle_tense' },
  fury: { face: 'fury', pose: 'guard' }, afraid: { face: 'afraid', pose: 'fear_back' }, desperate: { face: 'desperate', pose: 'hostage_hold' },
  sad: { face: 'sad', pose: 'head_down' }, smirk: { face: 'smirk', pose: 'arms_crossed' }, determined: { face: 'determined', pose: 'stand_wide' },
  cold: { face: 'cold', pose: 'idle' }, worried: { face: 'worried', pose: 'idle_tense' }, contempt: { face: 'contempt', pose: 'arms_crossed' },
  surprised: { face: 'surprised', pose: 'fear_back' }, pained: { face: 'pained', pose: 'idle_tense' },
};

function studioLook() {
  // clean frames: no lens tricks, no bloom bleeding into the matte
  stage.composite.letterbox = 0; stage.composite.grain = 0; stage.composite.vignette = 0; stage.composite.lensRain = 0;
  stage.bloom.enabled = false; stage.anamorphic.enabled = false; stage.dof.enabled = false; stage.motionBlur.enabled = false;
  r.q.ssgi = false;
  Object.assign(stage.grade, { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: [1, 1, 1], highTint: [1, 1, 1], saturation: 1, contrast: 1, temperature: 0, halation: 0, exposureBias: 0 });
}

let studio = null;
function buildStudio() {
  if (studio) return studio;
  const g = new Object3D();
  const back = new Mesh(new PlaneGeometry(30, 20), new MeshBasicMaterial({ color: 0x000000 }));
  back.position.set(0, 3, -6);
  g.add(back);
  // the same three lights for everyone: a cool key from high left, a warm rim from behind right,
  // a soft cool fill (night-in-the-city portraiture)
  const key = new SpotLight(new Color(0.85, 0.9, 1.0), 26, 14, 0.6, 0.8); key.position.set(-2.2, 3.4, 2.8); key.target.position.set(0, 1.4, 0); key.userData.shadow = true;
  const rim = new SpotLight(new Color(1.0, 0.68, 0.4), 40, 12, 0.5, 0.6); rim.position.set(2.4, 2.8, -2.6); rim.target.position.set(0, 1.4, 0);
  const rim2 = new SpotLight(new Color(0.6, 0.75, 1.0), 26, 12, 0.5, 0.6); rim2.position.set(-2.6, 2.2, -2.4); rim2.target.position.set(0, 1.3, 0);
  const fill = new PointLight(new Color(0.55, 0.62, 0.8), 1.4, 10); fill.position.set(1.6, 1.4, 3.2);
  g.add(key, key.target, rim, rim.target, rim2, rim2.target, fill);
  studio = { g, back };
  return studio;
}

async function frames(n, update) {
  for (let i = 0; i < n; i++) { update?.(1 / 30); stage.render(1 / 30); await new Promise((r2) => setTimeout(r2, 0)); }
}

window.renderStill = async (spec) => {
  if (current) { scene.remove(current); current = null; }
  for (const a of Object.values(actors)) a.root.removeFromParent();
  if (spec.kind === 'portrait') {
    studioLook();
    const S = buildStudio();
    S.back.material.color.setScalar(spec.bg ? 1 : 0);
    scene.add(S.g); current = S.g;
    r.sunIntensity = 0; r.weather.night = 1; r.weather.overcast = 1; r.wetness = 0; r.rain = 0; stage.rain.intensity = 0;
    r.envIntensity = 0.35; stage.volumetrics.enabled = false;
    stage.exposure.minEV = 0; stage.exposure.maxEV = 0;   // fixed exposure: both mattes must match
    const a = actors[spec.who] ??= await Actor.load(stage, './assets/humans', spec.who, { levels: 1 });
    scene.add(a.root);
    const e = EMO[spec.emo] ?? EMO.neutral;
    a.place([0, 0, 0], spec.yaw ?? 12);
    a.posture(e.pose, 0.001); a.emote(e.face, 1);
    a.lookAt(new Vector3(0.25, 1.6, 4), 1);
    a.face.blinkT = 99; a.rig.eyeOffset = [0, 0];
    for (let i = 0; i < 40; i++) a.update(1 / 30);
    a.face.saccadeT = 99;
    const eyes = a.eyes();
    // tall frame: from mid-thigh to above the head
    camera.aspect = canvas.width / canvas.height; camera.fov = 26;
    camera.position.set(0.15, eyes.y - 0.42, 4.6);
    camera.lookAt(0, eyes.y - 0.48, 0);
    camera.updateProjectionMatrix();
    stage.lens.focus = 4.6;
    stage.exposure.reset = true;
    await frames(spec.frames ?? 14, (dt) => { a.face.update(0); void dt; });
  } else {
    // a background plate: an empty set, its own weather and grade
    stage.bloom.enabled = true; stage.anamorphic.enabled = true; stage.dof.enabled = false; stage.motionBlur.enabled = false; stage.volumetrics.enabled = true;
    stage.composite.letterbox = 0; stage.composite.grain = 0.01; stage.composite.vignette = 0.25;
    const key = spec.set + (spec.time ? ':' + spec.time : '');
    const set = (window.__sets ??= {})[key] ??= await SETS[spec.set]({ time: spec.time });
    scene.add(set.root); current = set.root;
    if (set.sun) { r.sunDir.set(...set.sun.dir).normalize(); r.sunColor.set(...set.sun.color); r.sunIntensity = set.sun.intensity; }
    const w = set.weather ?? {};
    r.weather.night = w.night ?? 1; r.weather.overcast = w.overcast ?? 0.9; r.weather.lightning = spec.lightning ?? 0;
    if (set.cityGlow) r.weather.cityGlow = set.cityGlow;
    r.rain = w.rain ?? 0; r.wetness = w.wetness ?? Math.min(1, (w.rain ?? 0) * 1.4 + 0.25); stage.rain.intensity = w.rain ?? 0;
    r.envIntensity = set.envIntensity ?? 1;
    Object.assign(stage.volumetrics.fog, set.fog ?? {});
    Object.assign(stage.exposure, set.exposure ?? {}); stage.exposure.reset = true;
    Object.assign(stage.grade, set.grade ?? {});
    if (spec.lights) set.lights?.(spec.lights);
    r.invalidateEnvironment();
    camera.aspect = canvas.width / canvas.height; camera.fov = spec.cam.fov ?? 50;
    camera.position.set(...spec.cam.pos); camera.lookAt(...spec.cam.target); camera.updateProjectionMatrix();
    let t = 0;
    await frames(spec.frames ?? 16, (dt) => { t += dt; set.update?.(dt, t, { stageE: stage }); });
  }
  stage.render(1 / 30);
  return canvas.toDataURL('image/jpeg', 0.95);
};
window.__ready = true;
