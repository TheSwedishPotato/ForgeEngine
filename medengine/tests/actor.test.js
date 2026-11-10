import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import { Engine, Vector3, Quaternion, PlaneCollider, BoxCollider, Mesh, BoxGeometry, StandardMaterial } from '../src/index.js';
import { Actor, loadClipLibrary, clipSpeed } from '../src/human/Actor.js';
import { Humanoid } from '../src/anim/Humanoid.js';

const ROOT = new URL('../', import.meta.url).pathname;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b} ± ${eps}, got ${a}`);
const flush = () => new Promise((r) => setImmediate(r));
const DT = 1 / 60;

let libraryCache = null;
async function stage({ floor = true, clips = true, actorOptions = {} } = {}) {
  const engine = await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT });
  if (floor) engine.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  libraryCache ??= await loadClipLibrary(engine.assets, 'assets/anim/humanoid');
  const actor = Actor.mannequin({ clips: clips ? libraryCache : {}, ...actorOptions });
  engine.add(actor);
  return { engine, actor, clips: libraryCache };
}
const run = (engine, seconds, dt = DT) => engine.run(Math.round(seconds / dt), dt, { draw: false });
const headForward = (actor) => new Vector3(0, 0, 1).applyQuaternion(actor.bones.head.getWorldQuaternion(new Quaternion()));
const qdiff = (a, b) => Math.min(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z), Math.abs(a.w - b.w)), Math.max(Math.abs(a.x + b.x), Math.abs(a.y + b.y), Math.abs(a.z + b.z), Math.abs(a.w + b.w)));
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize()))));

test('the clip library loads the shipped clips and measures their speed', async () => {
  const { clips } = await stage();
  assert.deepEqual(Object.keys(clips).sort(), ['bow', 'getup', 'idle', 'jump', 'kick', 'punch', 'run', 'wave', 'walk'].sort());
  near(clipSpeed(clips.walk), 1.415, 0.02, 'walk m/s');
  near(clipSpeed(clips.run), 3.525, 0.03, 'run m/s');
  assert.equal(clips.walk.name, 'walk');
});

test('an actor is made of a mannequin, finds its bones and idles', async () => {
  const { engine, actor } = await stage();
  assert.ok(actor.bones.pelvis && actor.bones.head && actor.bones.hand_r);
  near(actor.height, 1.75, 0.01);
  assert.ok(actor.machine);
  run(engine, 0.5);
  assert.equal(actor.state, 'idle');
  assert.equal(actor.speed, 0);
  assert.equal(actor.root.parent, engine.scene, 'added to the scene by engine.add');
  assert.ok(actor.eyes().y > 1.6 && actor.eyes().y < 1.8);
});

test('a source without a skeleton is refused with a helpful message', () => {
  assert.throws(() => new Actor({}), /expected a Human, a Humanoid/);
  const h = new Humanoid();
  delete h.bones.head;
  h.root.getObjectByName('head').name = 'noggin';
  assert.throws(() => new Actor(h), /no 'head' bone/);
});

test('walkTo arrives, faces the way it walked, and the gait follows the speed', async () => {
  const { engine, actor } = await stage({ floor: false });
  let arrived = null;
  actor.walkTo([4, 0, 0]).then((ok) => { arrived = ok; });
  let top = 0, state = new Set();
  const t0 = engine.time;
  for (let i = 0; i < 60 * 8 && arrived === null; i++) { engine.tick(DT, false); await flush(); top = Math.max(top, actor.speed); state.add(actor.state); }
  assert.equal(arrived, true);
  const took = engine.time - t0;
  assert.ok(took > 2.6 && took < 4.4, `${took.toFixed(2)} s for 4 m`);
  near(top, actor.walkSpeed, 0.12, 'walking speed reached');
  assert.ok(state.has('move'));
  run(engine, 1);
  near(actor.root.position.x, 4, 0.08, 'x');
  near(actor.root.position.z, 0, 0.04, 'z');
  near(Math.atan2(Math.sin(actor.yaw - Math.PI / 2), Math.cos(actor.yaw - Math.PI / 2)), 0, 0.05, 'faces +X');
  assert.equal(actor.state, 'idle');
  assert.equal(actor.speed, 0);
});

test('running blends the run clip in; the legs take the speed of the body', async () => {
  const { engine, actor } = await stage({ floor: false });
  actor.walkTo([30, 0, 0], { run: true });
  run(engine, 3);
  assert.ok(actor.speed > 3, `speed ${actor.speed}`);
  const w = (clip) => actor.animator.layer(0).actions.filter((a) => a.clip === clip).reduce((s, a) => s + a.weight, 0);
  assert.ok(w(actor.clips.run) > 0.8, `run weight ${w(actor.clips.run)}`);
  assert.ok(w(actor.clips.walk) < 0.2);
  near(actor.machine.get('speed'), actor.speed, 0.4);
  actor.stop();
  run(engine, 1.5);
  assert.equal(actor.speed, 0);
  assert.equal(actor.state, 'idle');
});

test('footsteps arrive once per step, alternating feet, also while the gait changes from walk to run', async () => {
  const { engine, actor } = await stage({ floor: false });
  const steps = [];
  actor.on('footstep', (e) => steps.push({ t: engine.time, foot: e.foot, clip: e.clip, p: e.position }));
  actor.walkTo([100, 0, 0], { speed: 1.4 });
  run(engine, 4);
  const walkSteps = steps.length;
  assert.ok(walkSteps >= 6 && walkSteps <= 9, `${walkSteps} steps in ~3.5 s of walking`);
  actor.walkTo([100, 0, 0], { run: true });
  run(engine, 4);
  assert.ok(steps.length > walkSteps + 6);
  for (let i = 1; i < steps.length; i++) {
    assert.notEqual(steps[i].foot, steps[i - 1].foot, `step ${i} repeats the foot`);
    assert.ok(steps[i].t - steps[i - 1].t > 0.15, `steps ${i - 1} and ${i} are ${(steps[i].t - steps[i - 1].t).toFixed(3)} s apart`);
  }
  assert.ok(steps.every((s) => s.p instanceof Vector3 && Number.isFinite(s.p.x)), 'position of the foot');
  assert.ok(steps.some((s) => s.clip === 'walk') && steps.some((s) => s.clip === 'run'));
});

test('turnTo eases to a heading, a point or another actor and can be interrupted', async () => {
  const { engine, actor } = await stage({ floor: false });
  let done = null;
  actor.turnTo([5, 0, 0]).then((v) => { done = v; });
  run(engine, 0.3);
  assert.equal(done, null);
  assert.ok(actor.yaw > 0.2 && actor.yaw < Math.PI / 2 - 0.1, `midway ${actor.yaw}`);
  run(engine, 0.5); await flush();
  assert.equal(done, true);
  near(actor.yaw, Math.PI / 2, 1e-6);
  const p = actor.turnTo(-90, 1);
  const q = actor.turnTo(180, 0.2);
  await flush();
  assert.equal(await p, false, 'a new turn replaces the old one');
  run(engine, 0.5);
  assert.equal(await q, true);
  near(Math.cos(actor.yaw), -1, 1e-6);
  const other = Actor.mannequin();
  other.place([0, 0, 3]);
  actor.place([0, 0, 0], 0);
  await Promise.all([actor.turnTo(other, 0.1), (async () => run(engine, 0.3))()]);
  near(actor.yaw, 0, 1e-6, 'faces +Z toward the other actor');
});

test('a one-shot clip plays over the locomotion, its promise resolves, its events fire', async () => {
  const { engine, actor } = await stage({ floor: false });
  const hits = [];
  actor.on('hit', (e) => hits.push({ t: engine.time, bone: e.bone, position: e.position }));
  let result = null;
  const t0 = engine.time;
  actor.play('punch', { mask: 'upper' }).then((v) => { result = v; });
  assert.ok(actor.isPlaying());
  run(engine, 0.6); await flush();
  assert.equal(result, null, 'still playing');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].bone, 'hand_r');
  near(hits[0].t - t0, 0.2, 0.05, 'the hit frame');
  assert.ok(hits[0].position instanceof Vector3);
  run(engine, 1); await flush();
  assert.equal(result, true);
  assert.ok(!actor.isPlaying());
  run(engine, 0.5);
  assert.equal(actor.animator.layer(1).actions.length, 0, 'the layer is clear again');
});

test('an upper-body clip leaves the legs to the locomotion', async () => {
  const A = await stage({ floor: false }), B = await stage({ floor: false });
  for (const s of [A, B]) s.actor.walkTo([100, 0, 0]);
  run(A.engine, 1); run(B.engine, 1);
  B.actor.play('punch', { mask: 'upper' });
  let armDiff = 0, legDiff = 0;
  for (let i = 0; i < 40; i++) {
    A.engine.tick(DT, false); B.engine.tick(DT, false);
    for (const n of ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r']) legDiff = Math.max(legDiff, qdiff(A.actor.bones[n].quaternion, B.actor.bones[n].quaternion));
    for (const n of ['upperarm_r', 'lowerarm_r', 'spine_02']) armDiff = Math.max(armDiff, qdiff(A.actor.bones[n].quaternion, B.actor.bones[n].quaternion));
  }
  assert.ok(legDiff < 1e-5, `legs differ by ${legDiff}`);
  assert.ok(armDiff > 0.1, `arms differ by only ${armDiff}`);
  // and a lower-body mask does the reverse
  run(A.engine, 1.5); run(B.engine, 1.5);
  B.actor.play('kick', { mask: 'lower', layer: 2 });
  let up = 0;
  for (let i = 0; i < 20; i++) { A.engine.tick(DT, false); B.engine.tick(DT, false); up = Math.max(up, qdiff(A.actor.bones.upperarm_l.quaternion, B.actor.bones.upperarm_l.quaternion)); }
  assert.ok(up < 0.05, `the arms still follow the first layer (differ by ${up})`);
});

test('a clip replaces the one before it on its layer; stopClip and dispose settle the promise', async () => {
  const { engine, actor } = await stage({ floor: false });
  const a = actor.play('punch');
  run(engine, 0.2);
  const b = actor.play('kick');
  await flush();
  assert.equal(await a, false);
  actor.stopClip(1, 0.1);
  assert.equal(await b, false);
  const c = actor.play('wave', { hold: true });
  run(engine, 3);
  assert.equal(await c, true);
  assert.equal(actor.animator.layer(1).actions.length, 1, 'hold keeps the last pose');
  actor.stopClip();
  run(engine, 0.5);
  assert.equal(actor.animator.layer(1).actions.length, 0);
  const d = actor.play('bow');
  actor.dispose();
  assert.equal(await d, false);
  assert.throws(() => actor.play('nonsense'), /no clip 'nonsense'/);
});

test('layer 0 belongs to the locomotion machine', async () => {
  const { actor } = await stage();
  assert.throws(() => actor.play('wave', { layer: 0 }), /locomotion/);
});

test('look-at turns neck, head and eyes toward a target, within what a body can do', async () => {
  const { engine, actor } = await stage({ floor: false });
  run(engine, 0.5);
  const rest = headForward(actor);
  near(angleBetween(rest, new Vector3(0, 0, 1)), 0, 0.12, 'looks ahead at first');
  const target = new Vector3(3, 1.7, 3);
  actor.lookAt(target);
  run(engine, 1.5);
  const toTarget = target.clone().sub(actor.bones.head.getWorldPosition(new Vector3()));
  const off = angleBetween(headForward(actor), toTarget);
  assert.ok(off < 0.12, `the head is ${(off * 57.3).toFixed(1)} degrees off the target`);
  // eyes converge exactly
  for (const n of ['eye_l', 'eye_r']) {
    const eye = actor.bones[n], f = new Vector3(0, 0, 1).applyQuaternion(eye.getWorldQuaternion(new Quaternion()));
    const d = target.clone().sub(eye.getWorldPosition(new Vector3()));
    assert.ok(angleBetween(f, d) < 0.05, `${n} is ${(angleBetween(f, d) * 57.3).toFixed(1)} degrees off`);
  }
  // behind the body: the head does not twist round, it stays near the front
  actor.lookAt([0, 1.7, -4]);
  run(engine, 2);
  const behind = angleBetween(headForward(actor), new Vector3(0, 0, 1));
  assert.ok(behind < 0.35, `head ${(behind * 57.3).toFixed(0)} degrees round for a target behind`);
  // a target that jumps from side to side is followed smoothly
  actor.lookAt([-3, 1.7, 2]); run(engine, 1);
  actor.lookAt([3, 1.7, 2]);
  let prev = headForward(actor), worst = 0;
  for (let i = 0; i < 60; i++) { engine.tick(DT, false); const f = headForward(actor); worst = Math.max(worst, angleBetween(prev, f)); prev = f; }
  assert.ok(worst > 0.01, 'it does turn');
  assert.ok(worst < 0.12, `largest step ${(worst * 57.3).toFixed(1)} degrees per frame`);
  actor.lookAt(null);
  run(engine, 2);
  near(angleBetween(headForward(actor), new Vector3(0, 0, 1)), 0, 0.12, 'looks ahead again');
});

test('look-at takes an actor, an object or a function', async () => {
  const { engine, actor } = await stage({ floor: false });
  const other = Actor.mannequin();
  engine.add(other);
  other.place([2, 0, 2]);
  actor.lookAt(other);
  run(engine, 1.5);
  const d = other.eyes().sub(actor.bones.head.getWorldPosition(new Vector3()));
  assert.ok(angleBetween(headForward(actor), d) < 0.12);
  const box = new Mesh(new BoxGeometry(), new StandardMaterial());
  box.position.set(-2, 1.5, 2);
  engine.scene.add(box);
  actor.lookAt(box);
  run(engine, 1.5);
  assert.ok(headForward(actor).x < -0.4);
  let k = 0;
  actor.lookAt(() => [Math.sin(k) * 3, 1.6, 3]);
  for (let i = 0; i < 120; i++) { k += 0.03; engine.tick(DT, false); }
  assert.ok(Number.isFinite(headForward(actor).x));
});

test('with a capsule the actor walks on the floor and stops at a wall; the legs stop too', async () => {
  const { engine, actor } = await stage();
  engine.physics.addCollider(new BoxCollider({ center: new Vector3(3.5, 1, 0), half: new Vector3(0.5, 1, 3) }));
  const ch = actor.attachCharacter(engine.physics);
  assert.ok(ch.grounded);
  actor.place([0, 0, 0], 90);
  let arrived = null;
  actor.walkTo([6, 0, 0]).then((v) => { arrived = v; });
  run(engine, 6);
  await flush();
  assert.equal(arrived, null, 'a wall is in the way');
  near(actor.root.position.x, 3 - actor.radius, 0.06, 'stands at the wall');
  assert.ok(actor.machine.get('speed') < 0.5, `legs still going at ${actor.machine.get('speed')} m/s`);
  near(actor.root.position.y, 0, 0.02, 'on the floor');
  actor.walkTo([0, 0, 0]);
  run(engine, 4);
  assert.ok(actor.root.position.x < 1);
});

test('a jump leaves the ground, plays the jump clip, lands and reports it', async () => {
  const { engine, actor } = await stage();
  actor.attachCharacter(engine.physics);
  actor.place([0, 0, 0]);
  run(engine, 0.3);
  const seen = [];
  actor.on('touchdown', (e) => seen.push(['touchdown', e.speed]));
  actor.on('takeoff', (e) => seen.push(['takeoff', e.clip]));
  actor.on('land', (e) => seen.push(['land', e.clip]));
  let peak = 0, states = new Set();
  assert.equal(actor.jump(), true);
  for (let i = 0; i < 90; i++) { engine.tick(DT, false); peak = Math.max(peak, actor.root.position.y); states.add(actor.state); }
  near(peak, 4.4 * 4.4 / (2 * 9.81), 0.15, 'jump height');
  assert.ok(states.has('jump'));
  assert.ok(actor.grounded);
  const t = seen.find((s) => s[0] === 'touchdown');
  assert.ok(t && t[1] > 3.5, `touchdown ${JSON.stringify(t)}`);
  assert.ok(seen.some((s) => s[0] === 'takeoff' && s[1] === 'jump'), 'the clip takes off');
  assert.ok(seen.some((s) => s[0] === 'land' && s[1] === 'jump'), 'the clip lands');
  run(engine, 2);
  assert.equal(actor.state, 'idle');
  assert.equal(actor.jump(), true);
  engine.tick(DT, false);
  assert.equal(actor.jump(), false, 'no jump in the air');
});

test('the actor is drawn between fixed steps: smooth at 144 Hz', async () => {
  const { engine, actor } = await stage({ floor: false });
  actor.walkTo([200, 0, 0], { speed: 1.4 });
  run(engine, 3, 1 / 144);
  const xs = [];
  for (let i = 0; i < 144; i++) { engine.tick(1 / 144, false); xs.push(actor.root.position.x); }
  const steps = xs.slice(1).map((x, i) => x - xs[i]);
  const lo = Math.min(...steps), hi = Math.max(...steps);
  assert.ok(lo > 0, 'always moving forward');
  assert.ok(hi / lo < 1.3, `frame-to-frame step varies ${lo.toFixed(4)} .. ${hi.toFixed(4)} m`);
  near((xs[143] - xs[0]) / (143 / 144), 1.4, 0.1, 'speed');
});

test('the same script gives the same result every time', async () => {
  const final = [];
  for (let r = 0; r < 2; r++) {
    const { engine, actor } = await stage();
    actor.attachCharacter(engine.physics);
    actor.walkTo([3, 0, 2]);
    run(engine, 2);
    actor.play('wave', { mask: 'upper' });
    actor.lookAt([5, 1.6, 5]);
    run(engine, 2);
    final.push([...actor.root.position.toArray(), actor.yaw, ...actor.bones.hand_r.getWorldPosition(new Vector3()).toArray()]);
  }
  assert.deepEqual(final[0], final[1]);
});

test('moving the root by hand moves the actor; free control follows a stick', async () => {
  const { engine, actor } = await stage({ floor: false });
  actor.root.position.set(5, 0, 5);
  run(engine, 0.5);
  near(actor.root.position.x, 5, 1e-6); near(actor.root.position.z, 5, 1e-6);
  actor.move(0, -1.4);
  run(engine, 3);
  assert.ok(actor.root.position.z < 2.5, `z ${actor.root.position.z}`);
  near(Math.cos(actor.yaw), -1, 0.05, 'turned to walk toward -Z');
  actor.move(null);
  run(engine, 1);
  assert.equal(actor.speed, 0);
});

test('a prop rides a bone', async () => {
  const { engine, actor } = await stage({ floor: false });
  const sword = new Mesh(new BoxGeometry(0.04, 0.9, 0.04), new StandardMaterial());
  actor.attach(sword, 'hand_r', { position: [0, 0.1, 0] });
  actor.play('punch');
  run(engine, 0.4);
  const hand = actor.bones.hand_r.getWorldPosition(new Vector3()), at = sword.getWorldPosition(new Vector3());
  near(hand.distanceTo(at), 0.1, 0.02);
  actor.detach(sword);
  assert.equal(sword.parent, null);
  assert.throws(() => actor.attach(sword, 'tail'), /no bone 'tail'/);
});

test('speech and emotions without a face still keep time', async () => {
  const { engine, actor } = await stage({ floor: false });
  assert.throws(() => actor.emote('nonsense'), /unknown emotion/);
  assert.doesNotThrow(() => actor.emote('angry'));
  const p = actor.say('Halt! Who goes there?');
  assert.ok(p.duration > 1.5 && p.duration < 4);
  let done = null; p.then((v) => { done = v; });
  run(engine, p.duration - 0.2); await flush();
  assert.equal(done, null);
  run(engine, 0.4); await flush();
  assert.equal(done, true);
  const q = actor.say('Stop!');
  actor.stopSpeaking();
  assert.equal(await q, false);
});

test('the engine pause holds the actor', async () => {
  const { engine, actor } = await stage({ floor: false });
  actor.walkTo([50, 0, 0]);
  run(engine, 1);
  engine.pause();
  const x = actor.root.position.x, q = actor.bones.thigh_l.quaternion.clone();
  run(engine, 1);
  assert.equal(actor.root.position.x, x);
  assert.ok(actor.bones.thigh_l.quaternion.equals(q));
  engine.resume();
  run(engine, 0.5);
  assert.ok(actor.root.position.x > x);
});

test('ragdoll: measured at rest wherever it is created, falls, lies, and gets up with the clip', async () => {
  const { engine, actor } = await stage();
  actor.attachCharacter(engine.physics);
  actor.place([0, 0, 0]);
  // built in the middle of a stride, it still measures the standing body
  const ref = Actor.mannequin();
  const refRagdoll = ref.enableRagdoll(engine.physics);
  actor.walkTo([50, 0, 0], { run: true });
  run(engine, 1.5);
  const events = [];
  actor.on('ragdoll', (e) => events.push(e.on));
  actor.ragdollOn({ impulse: { point: actor.chest(), vector: new Vector3(0, 0, 90) } });
  near(actor.ragdoll.scale, refRagdoll.scale, 1e-6, 'scale');
  assert.ok(actor.ragdollActive && !actor.character.body.enabled);
  run(engine, 4);
  const pelvisY = actor.bones.pelvis.getWorldPosition(new Vector3()).y;
  assert.ok(pelvisY < 0.35, `pelvis at ${pelvisY} m after falling`);
  assert.ok(actor.bones.head.getWorldPosition(new Vector3()).y < 0.5, 'the head is down');
  const before = new Map(Object.entries(actor.bones).map(([n, b]) => [n, b.getWorldPosition(new Vector3())]));
  const lying = actor.ragdoll.lying();
  const up = actor.ragdollOff();
  assert.ok(!actor.ragdollActive && actor.character.body.enabled);
  assert.deepEqual(events, [true, false]);
  actor.update(0, 1);
  let worst = 0;
  for (const [n, p] of before) worst = Math.max(worst, actor.bones[n].getWorldPosition(new Vector3()).distanceTo(p));
  assert.ok(worst < 0.03, `the pose jumps by ${worst} m when the ragdoll ends`);
  // the get-up clip lies the way the body lay
  const h = actor.bones.head.getWorldPosition(new Vector3()), p = actor.bones.pelvis.getWorldPosition(new Vector3());
  const dir = new Vector3(h.x - p.x, 0, h.z - p.z).normalize();
  assert.ok(Number.isFinite(dir.x) && Number.isFinite(lying.direction.x));
  let done = null; up.then((v) => { done = v; });
  run(engine, 1.5);
  assert.equal(done, null, 'still getting up');
  assert.ok(actor.locked);
  run(engine, 6); await flush();
  assert.equal(done, true);
  assert.ok(!actor.locked);
  run(engine, 1);
  assert.ok(actor.bones.head.getWorldPosition(new Vector3()).y > 1.45, `head at ${actor.bones.head.getWorldPosition(new Vector3()).y} m`);
  near(actor.root.position.y, 0, 0.03, 'standing on the floor');
  assert.equal(actor.state, 'idle');
  let again = null; actor.walkTo(actor.root.position.clone().add(new Vector3(1.5, 0, 0))).then((v) => { again = v; });
  run(engine, 3); await flush();
  assert.equal(again, true, 'walks again');
});

test('ragdoll without a get-up clip fades into the state machine', async () => {
  const { engine, actor, clips } = await stage();
  const { getup, ...rest } = clips;
  void getup;
  const a2 = Actor.mannequin({ clips: rest });
  engine.add(a2);
  a2.attachCharacter(engine.physics);
  a2.place([3, 0, 0]);
  a2.ragdollOn();
  run(engine, 2.5);
  let done = null; a2.ragdollOff({ fade: 0.5 }).then((v) => { done = v; });
  run(engine, 0.3); await flush();
  assert.equal(done, null);
  run(engine, 0.5); await flush();
  assert.equal(done, true);
  run(engine, 1);
  assert.ok(a2.bones.head.getWorldPosition(new Vector3()).y > 1.4, 'upright again');
  void actor;
});

test('dispose releases the capsule, the ragdoll and every pending promise', async () => {
  const { engine, actor } = await stage();
  const ch = actor.attachCharacter(engine.physics);
  const w = actor.walkTo([9, 0, 9]);
  const t = actor.turnTo(45);
  const s = actor.say('Hello there');
  actor.dispose();
  assert.equal(await w, false); assert.equal(await t, false); assert.equal(await s, false);
  assert.ok(!engine.physics.characters.includes(ch));
  assert.equal(actor.root.parent, null);
});
