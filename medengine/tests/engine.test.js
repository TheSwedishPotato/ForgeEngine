import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import { Engine, Vector3, PlaneCollider, BoxCollider, RigidBody, Character, Mesh, BoxGeometry, StandardMaterial } from '../src/index.js';

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} is not within ${eps} of ${b}`);
const make = (o = {}) => Engine.create({ platform: new NodePlatform(), render: false, ...o });
const WASD = { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] };

test('create requires a platform and works without a GPU', async () => {
  await assert.rejects(() => Engine.create({}), /pass a platform/);
  const e = await make();
  assert.equal(e.stage, null);
  assert.ok(e.scene && e.camera && e.input && e.physics);
  assert.equal(e.fixedStep, 1 / 60);
});

test('the simulation advances in fixed steps whatever the frame rate', async () => {
  for (const hz of [30, 60, 75, 144, 240]) {
    const e = await make();
    const frames = hz * 5;
    for (let i = 0; i < frames; i++) e.tick(1 / hz, false);
    assert.ok(Math.abs(e.stepCount - 300) <= 1, `${hz} Hz: ${e.stepCount} steps in 5 s`);
    near(e.time, e.stepCount / 60, 1e-9, 'time is steps x fixedStep');
    assert.ok(e.alpha >= 0 && e.alpha < 1);
  }
});

test('a long stall is clipped: no spiral of death', async () => {
  const e = await make({ maxSteps: 6 });
  e.tick(2.0, false);                                    // a two second hitch
  assert.ok(e.stepCount <= 6, `${e.stepCount} steps`);
  near(e.alpha, 0, 1e-9);
  const before = e.stepCount;
  e.tick(1 / 60, false);
  assert.equal(e.stepCount, before + 1, 'back to normal at once');
});

test('pause freezes the simulation but not input, timeScale slows it down', async () => {
  const e = await make();
  const seen = [];
  e.input.map({ pause: ['KeyP'] });
  e.add({ update(dt, eng) { seen.push(dt); if (eng.input.pressed('pause')) eng.paused = !eng.paused; } });
  e.run(30, 1 / 60, { draw: false });
  assert.equal(e.stepCount, 30);
  e.platform.injectKey('KeyP', true); e.tick(1 / 60, false);        // pauses itself from update()
  e.platform.injectKey('KeyP', false);
  const steps = e.stepCount;
  e.run(30, 1 / 60, { draw: false });
  assert.equal(e.stepCount, steps, 'no steps while paused');
  assert.equal(seen[seen.length - 1], 0, 'update gets dt 0');
  e.platform.injectKey('KeyP', true); e.tick(1 / 60, false);        // input still works while paused: unpause
  assert.ok(!e.paused);
  const s2 = e.stepCount; e.timeScale = 0.5; e.run(60, 1 / 60, { draw: false });
  assert.ok(Math.abs(e.stepCount - s2 - 30) <= 1, `${e.stepCount - s2} steps at half speed`);
  e.timeScale = 0;
  const s3 = e.stepCount; e.run(10, 1 / 60, { draw: false });
  assert.equal(e.stepCount, s3);
});

test('hooks run in order: fixedUpdate, physics, afterPhysics, then update and lateUpdate once per frame', async () => {
  const e = await make();
  const log = [];
  const ball = e.physics.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.2 }, mass: 1, position: new Vector3(0, 5, 0) }));
  e.add({
    fixedUpdate(dt) { log.push(['fixed', dt, ball.position.y]); },
    afterPhysics(dt) { log.push(['after', dt, ball.position.y]); },
    update(dt) { log.push(['update', dt]); },
    lateUpdate(dt) { log.push(['late', dt]); },
  });
  const events = []; e.on('update', () => events.push('update'));
  e.tick(1 / 60, false);
  assert.deepEqual(log.map((l) => l[0]), ['fixed', 'after', 'update', 'late']);
  assert.ok(log[1][2] < log[0][2], 'the body fell between fixedUpdate and afterPhysics');
  assert.equal(log[0][1], 1 / 60);
  assert.deepEqual(events, ['update']);
  e.tick(2 / 60 + 0.001, false);                            // two steps, one update
  assert.equal(log.filter((l) => l[0] === 'fixed').length, 3);
  assert.equal(log.filter((l) => l[0] === 'update').length, 2);
});

test('event listeners get what EngineEventMap says: the step in seconds, then the engine', async () => {
  const e = await make();
  e.timeScale = 0.5;
  const got = {};
  for (const type of ['fixedUpdate', 'afterPhysics', 'update', 'lateUpdate']) e.on(type, (value, engine) => { (got[type] ??= []).push({ value, engine }); });
  e.tick(1 / 20, false);                                  // 50 ms of real time at half speed = 25 ms of game time = one 16.7 ms fixed step and some left over
  for (const type of ['fixedUpdate', 'afterPhysics']) {
    assert.equal(got[type].length, 1, `${type} fired once`);
    near(got[type][0].value, 1 / 60, 1e-12, `${type} gets the fixed step`);
    assert.equal(got[type][0].engine, e, `${type} gets the engine as its second argument`);
  }
  for (const type of ['update', 'lateUpdate']) {
    assert.equal(got[type].length, 1);
    near(got[type][0].value, 0.025, 1e-12, `${type} gets the scaled frame time`);
    assert.equal(got[type][0].engine, e);
  }
  e.pause();
  e.tick(1 / 20, false);
  assert.equal(got.fixedUpdate.length, 1, 'no fixed step while paused');
  assert.equal(got.update[1].value, 0, 'update still fires while paused, with dt 0');

  // a listener can stop listening, and an error reaches 'error' listeners as the thrown value
  const calls = [];
  const off = e.on('update', () => calls.push(1));
  off(); e.tick(1 / 60, false);
  assert.deepEqual(calls, []);
  const errors = [];
  e.on('error', (err, engine) => errors.push([err, engine]));
  e.resume();
  const orig = console.error; console.error = () => {};
  const thrown = new Error('listener test');
  e.add({ update() { throw thrown; } });
  e.start();
  await new Promise((r) => setTimeout(r, 40));
  e.stop();
  console.error = orig;
  assert.ok(errors.length >= 1);
  assert.equal(errors[0][0], thrown, 'the value is what was thrown');
  assert.equal(errors[0][1], e);
});

test('systems can be removed and get onAdd / onRemove / dispose', async () => {
  const e = await make();
  const calls = [];
  const sys = { onAdd: () => calls.push('add'), onRemove: () => calls.push('remove'), dispose: () => calls.push('dispose'), update: () => calls.push('update') };
  assert.equal(e.add(sys), sys);
  e.tick(1 / 60, false);
  e.remove(sys);
  e.tick(1 / 60, false);
  e.add(sys); e.dispose();
  assert.deepEqual(calls, ['add', 'update', 'remove', 'add', 'dispose']);
});

test('physics runs inside the loop and moves scene objects', async () => {
  const e = await make();
  e.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
  e.scene.add(mesh);
  e.physics.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 2, position: new Vector3(0, 3, 0), object: mesh }));
  e.run(30, 1 / 60, { draw: false });                       // 0.5 s of free fall: 1.22 m
  near(mesh.position.y, 3 - 0.5 * 9.81 * 0.25, 0.08, 'falling');
  e.run(180, 1 / 60, { draw: false });
  near(mesh.position.y, 0.5, 0.01, 'resting on the plane');
});

test('input edges reach fixedUpdate exactly once at 144 Hz', async () => {
  const e = await make();
  e.input.map({ jump: ['Space'] });
  let presses = 0, updates = 0;
  e.add({ fixedUpdate(dt, eng) { if (eng.input.pressed('jump')) presses++; }, update(dt, eng) { if (eng.input.pressed('jump')) updates++; } });
  for (let n = 0; n < 12; n++) {
    e.platform.injectKey('Space', true);
    for (let f = 0; f < 5; f++) e.tick(1 / 144, false);
    e.platform.injectKey('Space', false);
    for (let f = 0; f < 5; f++) e.tick(1 / 144, false);
  }
  assert.equal(presses, 12, 'every press reached the simulation once');
  assert.equal(updates, 12, 'and the frame loop');
});

test('a character walks under input; the same recorded input replays to the same place', async () => {
  const build = async () => {
    const e = await make();
    e.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
    e.physics.addCollider(new BoxCollider({ center: new Vector3(3, 0.15, -4), half: new Vector3(1, 0.15, 1) }));
    e.input.map({ move: WASD, jump: ['Space'] });
    const hero = new Character(e.physics, { position: new Vector3(0, 0, 0) });
    e.physics.addCharacter(hero);
    const wish = new Vector3();
    e.add({
      fixedUpdate(dt, eng) {
        const m = eng.input.vec2('move');
        wish.set(m.x * 4, 0, -m.y * 4);                      // forward is -Z
        if (eng.input.pressed('jump')) hero.jump();
        hero.update(dt, wish);
      },
    });
    return { e, hero };
  };
  const { e, hero } = await build();
  e.run(20, 1 / 60, { draw: false });
  near(hero.position.y, 0, 0.01);
  e.input.startRecording();
  e.platform.injectKey('KeyW', true);
  e.run(60, 1 / 60, { draw: false });
  near(hero.position.z, -4, 0.15, 'one second at 4 m/s forward');
  e.platform.injectKey('Space', true); e.run(1, 1 / 60, { draw: false }); e.platform.injectKey('Space', false);
  e.run(30, 1 / 60, { draw: false });
  e.platform.injectKey('KeyW', false); e.platform.injectKey('KeyD', true);
  e.run(60, 1 / 60, { draw: false });
  const end = hero.position.clone(), rec = JSON.parse(JSON.stringify(e.input.stopRecording()));

  const b = await build();
  b.e.run(20, 1 / 60, { draw: false });
  b.e.input.startPlayback(rec);
  b.e.run(rec.length, 1 / 60, { draw: false });
  assert.deepEqual([b.hero.position.x, b.hero.position.y, b.hero.position.z], [end.x, end.y, end.z], 'bit-identical replay');
  assert.ok(end.x > 3, 'moved right');
});

test('the real-time loop runs on the platform frame callback, survives errors, and stops', async () => {
  const e = await make();
  let thrown = 0, frames = 0;
  const errs = []; e.on('error', (x) => errs.push(x));
  const orig = console.error; console.error = () => {};
  e.add({ update() { frames++; if (frames === 3) { thrown++; throw new Error('boom'); } } });
  e.start();
  await new Promise((r) => setTimeout(r, 80));
  e.stop();
  console.error = orig;
  const n = frames;
  assert.ok(frames > 5, `${frames} frames`);
  assert.equal(thrown, 1);
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /boom/);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(frames, n, 'stopped');
  assert.ok(!e.running);
});

test('screenshot needs a renderer', async () => {
  const e = await make();
  await assert.rejects(() => e.screenshot(), /without a renderer/);
});
