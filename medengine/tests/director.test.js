import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import {
  Engine, PerspectiveCamera, Vector3, Quaternion, MathUtils, BoxCollider, PlaneCollider, World, Object3D,
} from '../src/index.js';
import { Director, solveShot, vfov, FRAME, LENS, SHOT_TYPES, MOVES } from '../src/cinema/Director.js';
import { pointOf } from '../src/engine/pointOf.js';
import { Actor } from '../src/human/Actor.js';

const ROOT = new URL('../', import.meta.url).pathname;
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);
const nearV = (a, b, eps = 1e-6, msg = '') => { near(a.x, b.x, eps, `${msg}.x`); near(a.y, b.y, eps, `${msg}.y`); near(a.z, b.z, eps, `${msg}.z`); };
const DT = 1 / 60;
const camera = () => new PerspectiveCamera(35, 16 / 9, 0.03, 200);
/** NDC of a world point as the camera sees it now. */
const ndc = (cam, p) => { cam.updateMatrixWorld(true); return new Vector3().copy(p).project(cam); };
/** The direction a camera looks. */
const lookDir = (cam) => { cam.updateMatrixWorld(true); return new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion())); };
const quiet = { handheld: 0 };
const seeded = (s) => MathUtils.seededRandom(s);

// ---------------------------------------------------------------------------------------------------------- the maths

test('vfov is the vertical field of a lens on a 24 mm sensor', () => {
  near(vfov(50), 26.99, 0.01); near(vfov(24), 53.13, 0.01); near(vfov(85), 16.07, 0.01); near(vfov(100), 13.69, 0.01);
  assert.ok(vfov(24) > vfov(35) && vfov(35) > vfov(135));
  assert.deepEqual(FRAME, { ecu: 0.11, cu: 0.3, mcu: 0.52, ms: 0.92, mls: 1.35, ws: 2.6, ews: 9 }, 'the framings are API: changing one is a decision');
  assert.deepEqual(LENS, { ecu: 100, cu: 85, mcu: 65, ms: 50, mls: 40, ws: 32, ews: 24, ots: 50, two: 40, pov: 32, insert: 85, free: 40 });
  assert.ok(SHOT_TYPES.includes('ots') && SHOT_TYPES.includes('free') && SHOT_TYPES.length === 12);
  assert.ok(MOVES.includes('orbit') && LENS.cu === 85);
});

test('pointOf takes vectors, arrays, objects, actors, plain points and functions', () => {
  const v = new Vector3(1, 2, 3), o = new Object3D(); o.position.set(4, 5, 6); o.updateMatrixWorld(true);
  nearV(pointOf(v), v);
  nearV(pointOf([7, 8, 9]), new Vector3(7, 8, 9));
  nearV(pointOf([7, 8]), new Vector3(7, 8, 0));
  nearV(pointOf(o), new Vector3(4, 5, 6));
  nearV(pointOf({ x: 1, y: 2, z: 3 }), v);
  nearV(pointOf({ x: 1, z: 3 }), new Vector3(1, 0, 3));
  nearV(pointOf(() => [1, 1, 1]), new Vector3(1, 1, 1));
  nearV(pointOf(() => () => v), v, 1e-9, 'a function of a function');
  nearV(pointOf({ eyes: (out) => out.set(9, 9, 9) }), new Vector3(9, 9, 9));
  assert.equal(pointOf(null), null); assert.equal(pointOf({}), null); assert.equal(pointOf(() => undefined), null);
  const out = new Vector3();
  assert.equal(pointOf(v, out), out, 'writes into the vector it is given');
});

// ---------------------------------------------------------------------------------------------------------- solving a shot

test('every framing puts the camera at the distance where its height fills the frame, with the eyes on the upper third', () => {
  const E = new Vector3(0, 1.6, 0);
  for (const type of Object.keys(FRAME)) {
    const s = solveShot({ type, on: E.toArray() });
    const H = FRAME[type], d = H / 2 / Math.tan(MathUtils.degToRad(vfov(LENS[type])) / 2);
    near(s.fov, vfov(LENS[type]), 1e-9, type);
    nearV(s.pos, new Vector3(0, 1.6, d), 1e-9, `${type} position`);
    nearV(s.target, new Vector3(0, 1.6 - H * 0.17, 0), 1e-9, `${type} aim`);
    const cam = camera(); cam.fov = s.fov; cam.position.copy(s.pos); cam.lookAt(s.target); cam.updateProjectionMatrix();
    near(ndc(cam, E).y, 0.34, 1e-6, `${type}: eyes on the upper third`);
    // the picture is H tall at the subject's depth, less the little the camera's tilt toward the aim takes off (cos of 2 to 10 degrees)
    const depth = E.clone().sub(s.pos).dot(lookDir(cam));
    const visible = 2 * depth / cam.projectionMatrix.elements[5];
    assert.ok(visible <= H * (1 + 1e-9) && visible > H * 0.985, `${type}: the picture is ${visible.toFixed(4)} m tall at the subject, wanted ${H}`);
  }
  // an explicit lens and frame
  const s = solveShot({ type: 'ms', on: E.toArray(), lens: 85, frame: 0.5, height: 0.2 });
  near(s.fov, vfov(85)); near(s.pos.z, 0.25 / Math.tan(MathUtils.degToRad(vfov(85)) / 2), 1e-9); near(s.pos.y, 1.8);
});

test('the angle goes round the subject from where it faces, whether that is an actor, an object or a point', () => {
  const a = Actor.mannequin();
  const eyes = a.eyes();
  let s = solveShot({ type: 'cu', on: a });
  assert.ok(s.pos.z > eyes.z + 0.3 && Math.abs(s.pos.x) < 1e-6, 'in front of an actor that faces +Z');
  s = solveShot({ type: 'cu', on: a, angle: 90 });
  assert.ok(s.pos.x > eyes.x + 0.3 && Math.abs(s.pos.z - eyes.z) < 1e-6, 'its left is +X');
  s = solveShot({ type: 'cu', on: a, angle: -90 });
  assert.ok(s.pos.x < eyes.x - 0.3);
  a.yaw = Math.PI / 2;
  s = solveShot({ type: 'cu', on: a });
  assert.ok(s.pos.x > eyes.x + 0.3, 'turned toward +X: the front is +X');
  const o = new Object3D(); o.position.set(0, 1.6, 0); o.rotation.y = Math.PI; o.updateMatrixWorld(true);
  s = solveShot({ type: 'cu', on: o });
  assert.ok(s.pos.z < -0.3, 'an Object3D faces along its +Z, turned half round it faces -Z');
  s = solveShot({ type: 'cu', on: [0, 1.6, 0], angle: 180 });
  assert.ok(s.pos.z < -0.3, 'a point has no facing: the angle is from +Z');
});

test('a profile is given room in front of the face; a frontal view is centred', () => {
  const E = new Vector3(0, 1.6, 0), at = (angle, extra = {}) => {
    const s = solveShot({ type: 'cu', on: E.toArray(), angle, ...extra });
    const cam = camera(); cam.fov = s.fov; cam.position.copy(s.pos); cam.lookAt(s.target); cam.updateProjectionMatrix();
    return ndc(cam, E);
  };
  near(at(0).x, 0, 1e-6); near(at(15).x, 0, 1e-6, 'under 20 degrees: no look room');
  // the frame is aimed 0.18 H toward the way the face looks: that is 0.36 of the half height, and 0.36 / aspect of the half width
  const half = (0.18 * FRAME.cu) / (FRAME.cu / 2) / camera().aspect;
  near(at(90).x, half, 1e-3, 'subject right of centre, facing the left of the frame');
  near(at(-90).x, -half, 1e-3);
  near(at(90, { lookRoom: 0 }).x, 0, 1e-6, 'lookRoom 0 turns it off');
  near(at(90, { lookRoom: 2 }).x, 2 * half, 2e-3);
  // `look` leans the frame toward a second point
  const plain = solveShot({ type: 'ms', on: E.toArray() }), lean = solveShot({ type: 'ms', on: E.toArray(), look: [4, 1.6, 0] });
  nearV(lean.pos, plain.pos, 1e-12, 'the camera does not move');
  nearV(lean.target, plain.target.clone().lerp(new Vector3(4, 1.6, 0), 0.35), 1e-9, 'a third of the way toward it by default');
  nearV(solveShot({ type: 'ms', on: E.toArray(), look: [4, 1.6, 0], lookMix: 1 }).target, new Vector3(4, 1.6, 0), 1e-9, 'lookMix 1: looking at it');
  // the subject looks toward the side with room: +Z is the left of the frame for the camera on +X
  const s = solveShot({ type: 'cu', on: E.toArray(), angle: 90 });
  assert.ok(s.target.z > 0, 'the frame is centred in front of the face');
});

test('moves travel half their distance either way over their duration, eased at both ends', () => {
  const on = [0, 1.6, 0], dur = 4;
  const at = (move, t, extra = {}) => solveShot({ type: 'cu', on, move, dur, ...extra }, t);
  const base = solveShot({ type: 'cu', on });
  nearV(at('static', 0).pos, base.pos); nearV(at('track', dur).pos, base.pos, 1e-9, 'track is not a geometric move');
  for (const move of MOVES.filter((m) => m !== 'static' && m !== 'track')) nearV(at(move, dur / 2).pos, base.pos, 1e-9, `${move} passes the framed position at mid-time`);
  const H = FRAME.cu;
  const dist = (p) => p.distanceTo(base.target);
  near(dist(at('push', 0).pos) - dist(at('push', dur).pos), 0.6 * H, 1e-9, 'push');
  near(dist(at('pull', dur).pos) - dist(at('pull', 0).pos), 0.6 * H, 1e-9, 'pull');
  near(dist(at('push', dur, { amount: 2 }).pos) - dist(at('push', 0, { amount: 2 }).pos), -1.2 * H, 1e-9, 'amount doubles it');
  near(at('crane', dur).pos.y - at('crane', 0).pos.y, 1.2, 1e-9, 'crane up'); near(at('drop', dur).pos.y - at('drop', 0).pos.y, -1.2, 1e-9, 'drop');
  const right = new Vector3().crossVectors(base.target.clone().sub(base.pos).normalize(), new Vector3(0, 1, 0)).normalize();
  near(at('truck', dur).pos.clone().sub(at('truck', 0).pos).dot(right), 0.8, 1e-9, 'truck to the right');
  const a = at('orbit', 0, { orbit: 60 }).pos.clone().sub(base.target), b = at('orbit', dur, { orbit: 60 }).pos.clone().sub(base.target);
  near(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z), MathUtils.degToRad(60), 1e-9, "the camera's angle grows by `orbit`");
  assert.ok(b.x > a.x, 'positive goes toward the subject\'s left (+X for a camera in front of an actor that faces +Z)');
  near(Math.atan2(at('orbit', dur, { orbit: -60 }).pos.x - base.target.x, at('orbit', dur, { orbit: -60 }).pos.z - base.target.z), -MathUtils.degToRad(30), 1e-9, 'negative the other way');
  near(a.length(), b.length(), 1e-9, 'at a constant radius');
  // eased: a tenth of the way in time is under a hundredth of the way in space
  const total = at('crane', dur).pos.y - at('crane', 0).pos.y;
  assert.ok((at('crane', 0.1 * dur).pos.y - at('crane', 0).pos.y) / total < 0.01, 'slow start');
  assert.ok((at('crane', dur).pos.y - at('crane', 0.9 * dur).pos.y) / total < 0.01, 'slow finish');
  nearV(at('crane', 3 * dur).pos, at('crane', dur).pos, 1e-12, 'it stops at the end');
});

test('pov, ots, two, insert and free frame what they say', () => {
  const A = Actor.mannequin({ name: 'a' }), B = Actor.mannequin({ name: 'b' });
  B.root.position.set(0, 0, 3); B.root.rotation.y = Math.PI; B.root.updateMatrixWorld(true); B.yaw = Math.PI;
  // pov: six centimetres in front of the eyes, looking along the heading or at `look`
  let s = solveShot({ type: 'pov', on: A });
  nearV(s.pos, A.eyes().add(new Vector3(0, 0, 0.06)), 1e-9); nearV(s.target, A.eyes().add(new Vector3(0, 0, 5)), 1e-9); near(s.fov, vfov(32));
  s = solveShot({ type: 'pov', on: A, look: [3, 1, 3] });
  nearV(s.target, new Vector3(3, 1, 3));
  // ots: behind A, looking at B's eyes, A on the right of the frame (default) or the left
  const frame = (shot) => { const cam = camera(); cam.fov = shot.fov; cam.position.copy(shot.pos); cam.lookAt(shot.target); cam.updateProjectionMatrix(); return cam; };
  s = solveShot({ type: 'ots', over: A, on: B });
  let cam = frame(s);
  assert.ok(s.pos.z < A.chest().z, 'behind the foreground character');
  near(s.target.z, B.eyes().z, 1e-9); near(s.target.y, B.eyes().y - 0.06, 1e-9);
  near(s.pos.y, A.eyes().y - 0.05 + 0.08, 1e-9, 'a little above the shoulder');
  assert.ok(ndc(cam, A.chest()).x > 0.1, 'foreground character on the right');
  assert.ok(Math.abs(ndc(cam, B.eyes()).x) < 0.3 && Math.abs(ndc(cam, B.eyes()).y) < 0.3, 'the one looked at is near the middle');
  cam = frame(solveShot({ type: 'ots', over: A, on: B, side: 'left' }));
  assert.ok(ndc(cam, A.chest()).x < -0.1, 'foreground character on the left');
  // two: both in the frame, the pair centred, mirrored by flip
  s = solveShot({ type: 'two', on: A, with: B });
  cam = frame(s);
  for (const who of [A, B]) { const n = ndc(cam, who.eyes()); assert.ok(Math.abs(n.x) < 1 && Math.abs(n.y) < 1, 'in frame'); }
  const mid = A.eyes().add(B.eyes()).multiplyScalar(0.5);
  near(ndc(cam, mid).x, 0, 1e-6, 'the pair is centred');
  assert.ok(ndc(cam, A.eyes()).x < 0 && ndc(cam, B.eyes()).x > 0, '`on` is on the left of the frame and `with` on the right, as one reads');
  const flipped = solveShot({ type: 'two', on: A, with: B, flip: true });
  cam = frame(flipped);
  assert.ok(ndc(cam, A.eyes()).x > 0 && ndc(cam, B.eyes()).x < 0, 'flip swaps them');
  near(flipped.pos.z, s.pos.z, 1e-9); near(flipped.pos.x, -s.pos.x, 1e-9, 'the other side of the pair');
  const wide = solveShot({ type: 'two', on: A, with: [0, 1.6, 12] });
  assert.ok(wide.pos.distanceTo(new Vector3(0, 1.6, 6)) > s.pos.distanceTo(mid), 'a wider pair needs more room');
  // insert: a thing `size` metres across fills the height of the frame
  s = solveShot({ type: 'insert', at: [1, 1, 1], size: 0.3 });
  near(s.pos.z - 1, 0.15 / Math.tan(MathUtils.degToRad(vfov(85)) / 2), 1e-9); near(s.pos.y, 1.1, 1e-9); nearV(s.target, new Vector3(1, 1, 1));
  // free
  s = solveShot({ type: 'free', pos: [1, 2, 3], target: () => [4, 5, 6], lens: 24, dutch: 3 });
  nearV(s.pos, new Vector3(1, 2, 3)); nearV(s.target, new Vector3(4, 5, 6)); near(s.fov, vfov(24)); near(s.roll, MathUtils.degToRad(3));
});

test('bounds keep the camera inside a box', () => {
  const bounds = { min: new Vector3(-1, 0, -1), max: new Vector3(1, 3, 1) };
  const s = solveShot({ type: 'ws', on: [0, 1, 0] }, 0, undefined, { bounds });
  assert.ok(s.pos.z <= 1 + 1e-9, `z ${s.pos.z}`);
});

test('bad shots are refused with a message that says what to write', () => {
  assert.throws(() => solveShot({ type: 'close', on: [0, 0, 0] }), /unknown shot type 'close'.*ecu, cu/);
  assert.throws(() => solveShot({ type: 'cu', on: [0, 0, 0], move: 'zoom' }), /unknown move 'zoom'.*push/);
  assert.throws(() => solveShot({ type: 'ots', on: [0, 0, 0] }), /needs `over`/);
  assert.throws(() => solveShot({ type: 'two', on: [0, 0, 0] }), /needs `on` and `with`/);
  assert.throws(() => solveShot({ type: 'free', pos: [0, 0, 0] }), /needs `pos` and `target`/);
  assert.throws(() => solveShot({ type: 'ms' }), /needs a subject/);
  assert.throws(() => solveShot(null), /pass a shot/);
  assert.throws(() => new Director({}), /pass the engine/);
  const d = new Director(camera());
  assert.throws(() => d.cut({ type: 'cu', on: [NaN, 0, 0] }), /no usable position/);
  assert.equal(d.mode, 'manual', 'a refused cut changes nothing');
  assert.equal(d.cuts, 0);
});

// ---------------------------------------------------------------------------------------------------------- the camera

test('a cut moves the camera at once: position, aim, field of view and the lens', () => {
  const cam = camera(), d = new Director(cam, { rng: seeded(1) });
  const E = [0.5, 1.6, -2];
  assert.equal(d.cut({ type: 'cu', on: E, angle: 30, ...quiet }), d, 'chainable');
  assert.equal(d.cuts, 1); assert.equal(d.mode, 'shot');
  const want = solveShot({ type: 'cu', on: E, angle: 30 });
  nearV(cam.position, want.pos, 1e-9); near(cam.fov, vfov(85), 1e-9);
  nearV(lookDir(cam), want.target.clone().sub(want.pos).normalize(), 1e-6, 'looks at the aim');
  near(d.lens.focal, 0.085); near(d.lens.aperture, 1.8); near(d.lens.pull, 6);
  near(d.lens.focus, cam.position.distanceTo(new Vector3(...E)), 1e-9, 'focus on the subject');
  d.cut({ type: 'ews', on: E, ...quiet }); near(d.lens.aperture, 8); near(d.lens.focal, 0.024);
  d.cut({ type: 'ms', on: E, aperture: 1.4, pull: 2, focus: [0, 0, 0], ...quiet }); near(d.lens.aperture, 1.4); near(d.lens.pull, 2);
  d.advance(DT); near(d.lens.focus, cam.position.length(), 1e-9, 'focus on the point asked for');
  assert.equal(d.cuts, 3);
});

test('the shot follows a moving subject, `track: false` freezes it where it stood, and a move still plays when frozen', () => {
  const p = new Vector3(0, 1.6, 0);
  const cam = camera(), d = new Director(cam, { rng: seeded(1) });
  d.cut({ type: 'ms', on: () => p, ...quiet });
  const offset = cam.position.clone().sub(p);
  p.set(4, 1.6, -3);
  d.advance(DT);
  nearV(cam.position.clone().sub(p), offset, 1e-9, 'same offset from the new place');
  // frozen
  const frozen = camera(), f = new Director(frozen, { rng: seeded(1) });
  f.cut({ type: 'ms', on: () => p, track: false, ...quiet });
  const at = frozen.position.clone();
  p.set(-9, 1.6, 9);
  f.advance(DT);
  nearV(frozen.position, at, 1e-9, 'the camera stays');
  // frozen with a move: the push plays, still toward where the subject was
  const mv = camera(), m = new Director(mv, { rng: seeded(1) });
  p.set(0, 1.6, 0);
  m.cut({ type: 'ms', on: () => p, track: false, move: 'push', dur: 2, ...quiet });
  const start = mv.position.clone();
  p.set(50, 1.6, 50);
  for (let i = 0; i < 120; i++) m.advance(DT);
  assert.ok(mv.position.distanceTo(start) > 0.5, 'it pushed in');
  assert.ok(Math.abs(mv.position.x) < 1, 'toward the old place, not the new');
  // `track` lags behind a subject that jumps
  const lag = camera(), l = new Director(lag, { rng: seeded(1) });
  p.set(0, 1.6, 0);
  l.cut({ type: 'ms', on: () => p, move: 'track', ...quiet });
  const x0 = lag.position.x;
  p.set(3, 1.6, 0);
  l.advance(DT);
  const first = lag.position.x - x0;
  assert.ok(first > 0 && first < 0.3, `moved ${first} m of 3 in the first frame`);
  for (let i = 0; i < 180; i++) l.advance(DT);
  near(lag.position.x - x0, 3, 0.01, 'arrives');
});

test('`track: false` freezes an actor too: where it stood, which way it faced and where its chest was', () => {
  const A = Actor.mannequin(), B = Actor.mannequin();
  A.root.position.set(1, 0, 1); A.yaw = Math.PI / 2; A.root.updateMatrixWorld(true);
  B.root.position.set(1, 0, 4); B.root.updateMatrixWorld(true);
  const cu = solveShot({ type: 'cu', on: A, angle: 30 }), ots = solveShot({ type: 'ots', over: A, on: B });
  assert.ok(cu.pos.x > A.eyes().x + 0.5, 'it faces +X now, so the 30 degree camera is out on +X');
  const camA = camera(), a = new Director(camA);
  a.cut({ type: 'cu', on: A, angle: 30, track: false, ...quiet });
  nearV(camA.position, cu.pos, 1e-9, 'cut where the actor stood, facing the way it faced');
  const camB = camera(), b = new Director(camB);
  b.cut({ type: 'ots', over: A, on: B, track: false, ...quiet });
  nearV(camB.position, ots.pos, 1e-9, 'and over its chest, not its eyes');
  // everyone moves and turns: the frozen shots stay
  A.root.position.set(-5, 0, -5); A.yaw = 0; B.root.position.set(8, 0, 8);
  A.root.updateMatrixWorld(true); B.root.updateMatrixWorld(true);
  a.advance(DT); b.advance(DT);
  nearV(camA.position, cu.pos, 1e-9); nearV(camB.position, ots.pos, 1e-9);
  const live = camera(), c = new Director(live);
  c.cut({ type: 'cu', on: A, angle: 30, ...quiet });
  assert.ok(live.position.distanceTo(cu.pos) > 5, 'while a live shot has gone with them');
});

test('a blend runs from wherever the camera is, smooth at both ends, and ends exactly on the new shot', () => {
  const cam = camera(), d = new Director(cam, { rng: seeded(2) });
  cam.position.set(5, 5, 5);
  // the first cut of all blends from the real camera, not from the origin
  d.cut({ type: 'cu', on: [0, 1.6, 0], ...quiet });
  const A = cam.position.clone(), fovA = cam.fov;
  const B = solveShot({ type: 'ws', on: [10, 1.6, 0] });
  d.cut({ type: 'ws', on: [10, 1.6, 0], ...quiet }, { blend: 1 });
  nearV(cam.position, A, 1e-9, 'a blend does not jump');
  const path = [];
  for (let i = 1; i <= 60; i++) { d.advance(DT); path.push(cam.position.clone()); }
  const mid = path[29];
  nearV(mid, A.clone().lerp(B.pos, 0.5), 1e-6, 'halfway at half the time');
  near(cam.fov, vfov(32), 1e-6, 'field of view arrived');
  const total = A.distanceTo(B.pos);
  const steps = path.map((p, i) => p.distanceTo(i ? path[i - 1] : A));
  assert.ok(steps[0] < total * 0.002, `first step ${steps[0]} of ${total}`);
  assert.ok(Math.max(...steps) < total * 0.05, 'never a jump');
  for (let i = 1; i < 30; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-9, 'speeding up');
  d.advance(DT);
  nearV(cam.position, B.pos, 1e-9, 'ends exactly on the shot');
  assert.ok(fovA < cam.fov, 'a close-up widened to a wide shot');
  // blending from a camera nobody directed starts where that camera stands
  const fresh = camera(), g = new Director(fresh, { rng: seeded(2) });
  fresh.position.set(5, 5, 5);
  g.cut({ type: 'cu', on: [0, 1.6, 0], ...quiet }, { blend: 2 });
  g.advance(0.001);
  nearV(fresh.position, new Vector3(5, 5, 5), 1e-4, 'the first blend starts at the camera, not at the origin');
});

test('the camera operator: seeded drift, impact shake that settles, roll', () => {
  const sway = (rng, extra = {}, frames = 60) => {
    const cam = camera(), d = new Director(cam, { rng });
    d.cut({ type: 'ms', on: [0, 1.6, 0], ...extra });
    const want = d.cur.target.clone().sub(d.cur.pos).normalize();
    let worst = 0;
    for (let i = 0; i < frames; i++) { d.advance(DT); worst = Math.max(worst, lookDir(cam).angleTo(want)); }
    return { worst, d, cam, want };
  };
  assert.ok(sway(seeded(1), quiet).worst < 1e-6, 'handheld 0 is a locked-off camera');
  const a = sway(seeded(1)), b = sway(seeded(1)), c = sway(seeded(9));
  assert.ok(a.worst > 2e-5 && a.worst < 0.01, `default drift ${a.worst} rad`);
  assert.deepEqual(a.cam.quaternion.toArray(), b.cam.quaternion.toArray(), 'the same seed gives the same drift');
  assert.notDeepEqual(a.cam.quaternion.toArray(), c.cam.quaternion.toArray(), 'another seed another drift');
  const strong = sway(seeded(1), { handheld: 1 });
  assert.ok(strong.worst > a.worst * 3, 'handheld 1 is much more');
  // a kick
  const cam = camera(), d = new Director(cam, { rng: seeded(4) });
  d.cut({ type: 'ms', on: [0, 1.6, 0], ...quiet });
  const want = d.cur.target.clone().sub(d.cur.pos).normalize();
  d.kick(5);
  near(d.shake, 1.5, 1e-9, 'capped');
  let peak = 0;
  for (let i = 0; i < 10; i++) { d.advance(DT); peak = Math.max(peak, lookDir(cam).angleTo(want)); }
  assert.ok(peak > 0.003, `shake ${peak} rad`);
  for (let i = 0; i < 40; i++) d.advance(DT);
  near(d.shake, 0, 1e-9, 'settled in under a second');
  d.advance(DT);
  assert.ok(lookDir(cam).angleTo(want) < 1e-6, 'and the camera is steady again');
  // dutch roll
  const r = camera(), dr = new Director(r);
  dr.cut({ type: 'ms', on: [0, 1.6, 0], dutch: 10, ...quiet });
  const upAxis = new Vector3(0, 1, 0).applyQuaternion(r.getWorldQuaternion(new Quaternion()));
  const pitch = Math.asin(-lookDir(r).y);                              // the camera also looks a little down at the subject
  near(upAxis.angleTo(new Vector3(0, 1, 0)), Math.acos(Math.cos(MathUtils.degToRad(10)) * Math.cos(pitch)), 1e-6, 'rolled ten degrees about its own axis');
  near(lookDir(r).angleTo(dr.cur.target.clone().sub(dr.cur.pos).normalize()), 0, 1e-6, 'roll does not change where it looks');
});

test('manual mode leaves the camera alone', () => {
  const cam = camera(), d = new Director(cam);
  cam.position.set(1, 2, 3);
  d.advance(DT); d.advance(DT);
  nearV(cam.position, new Vector3(1, 2, 3), 0, 'untouched before any shot');
  d.cut({ type: 'ms', on: [0, 0, 0], ...quiet });
  d.manual();
  cam.position.set(9, 9, 9);
  d.advance(DT);
  nearV(cam.position, new Vector3(9, 9, 9), 0, 'untouched in manual');
});

test('a subject that goes missing for a frame does not take the camera with it', () => {
  const cam = camera(), d = new Director(cam), p = new Vector3(0, 1.6, 0);
  d.cut({ type: 'ms', on: () => p, ...quiet });
  const at = cam.position.clone();
  p.set(NaN, 1.6, 0);
  d.advance(DT);
  nearV(cam.position, at, 0, 'held');
  assert.ok(Number.isFinite(d.cur.pos.x));
  p.set(2, 1.6, 0);
  d.advance(DT);
  near(cam.position.x, 2, 1e-9, 'and found again');
});

// ---------------------------------------------------------------------------------------------------------- the gameplay camera

/** ME2's follow camera: close, and looking from the head (it cropped the legs). The geometry tests spell their numbers out with it. */
const ME2 = { dist: 2.6, height: 0.35, lens: 32 };

function follower(opts = {}, { world = null, actorYaw = 0 } = {}) {
  const cam = camera(), actor = Actor.mannequin();
  actor.yaw = actorYaw;
  const d = new Director(cam, { rng: seeded(3), world });
  d.followActor(actor, { snap: true, ...opts });
  return { cam, actor, d };
}

test('the follow camera stands behind the actor over its right shoulder and the actor is on the left of the frame', () => {
  const { cam, actor, d } = follower(ME2);
  const chest = actor.chest(), cp = Math.cos(MathUtils.degToRad(8)), sp = Math.sin(MathUtils.degToRad(8));
  const pivot = chest.clone().add(new Vector3(0, 0.35, 0));
  // the handheld drift is only a rotation, so the position is exact
  nearV(d.cur.pos, new Vector3(pivot.x - 0.45, pivot.y + 2.6 * sp, pivot.z - 2.6 * cp), 1e-9);
  nearV(d.cur.target, new Vector3(pivot.x - 0.2, pivot.y, pivot.z + 2.5 * cp), 1e-9);
  assert.ok(ndc(cam, chest).x < -0.02, `actor at ${ndc(cam, chest).x} in the frame: left of centre`);
  near(cam.fov, vfov(32)); near(d.lens.focal, 0.032); near(d.lens.aperture, 4);
  near(d.lens.focus, d.cur.pos.distanceTo(chest), 1e-6);
  near(d.yaw, 0, 1e-9, 'looking along +Z');
  // the other shoulder, a closer camera
  const alt = follower({ ...ME2, shoulder: -0.45, dist: 1.5 });
  assert.ok(ndc(alt.cam, alt.actor.chest()).x > 0.02, 'right of centre over the left shoulder');
  assert.ok(alt.d.cur.pos.distanceTo(alt.actor.chest()) < d.cur.pos.distanceTo(chest));
});

test('the default follow camera shows the whole body, feet to head, with the actor left of centre and room to see ahead', () => {
  const { cam, actor, d } = follower();
  const feet = ndc(cam, actor.position), top = ndc(cam, actor.eyes().add(new Vector3(0, 0.15, 0)));
  assert.ok(feet.y > -1 && feet.y < -0.5, `feet at ${feet.y.toFixed(2)}`);
  assert.ok(top.y < 0.7 && top.y > 0, `top of the head at ${top.y.toFixed(2)}: room above and ahead`);
  assert.ok(feet.x < -0.02 && feet.x > -0.5, `actor at ${feet.x.toFixed(2)} across`);
  near(cam.fov, vfov(28), 1e-9);
  near(d.cur.pos.distanceTo(actor.chest().add(new Vector3(0, -0.3, 0))), 3.2, 0.5, 'a few metres back');
});

test('the follow camera trails a jump a little behind, and keeps the head in the frame', () => {
  const { cam, actor, d } = follower();
  const head = () => ndc(cam, actor.eyes().add(new Vector3(0, 0.15, 0))).y;
  const top0 = head(), aim0 = d.cur.target.y, pos0 = d.cur.pos.y;
  // a sudden metre: the aim moves a tenth of the way in a frame (6 per second), the position less (5 per second, from a camera that is already above)
  actor.root.position.y = 1; actor.root.updateMatrixWorld(true);
  d.advance(DT);
  const dAim = d.cur.target.y - aim0, dPos = d.cur.pos.y - pos0;
  assert.ok(dAim > 0.05 && dAim < 0.15, `the aim rose ${dAim} m of 1`);
  assert.ok(dPos > 0.03 && dPos < 0.12, `the camera rose ${dPos} m of 1`);
  for (let i = 0; i < 300; i++) d.advance(DT);
  near(d.cur.target.y - aim0, 1, 0.01, 'and it arrives'); near(d.cur.pos.y - pos0, 1, 0.01);
  near(head(), top0, 0.02, 'with the actor back where it was in the frame');
  // a real jump: a metre in half a second
  let worst = -9;
  for (let i = 1; i <= 30; i++) { actor.root.position.y = 1 + i / 30; actor.root.updateMatrixWorld(true); d.advance(DT); worst = Math.max(worst, head()); }
  assert.ok(worst < 0.95 && worst > top0 + 0.05, `the head peaks at ${worst.toFixed(2)} (from ${top0.toFixed(2)}): the camera lags, and the head stays in`);
});

test('the gameplay camera has a little handheld drift, and none when switched off', () => {
  const drift = (opts) => {
    const { cam, d } = follower({ ...ME2, ...opts });
    const want = d.cur.target.clone().sub(d.cur.pos).normalize();
    let worst = 0;
    for (let i = 0; i < 90; i++) { d.advance(DT); worst = Math.max(worst, lookDir(cam).angleTo(want)); }
    return worst;
  };
  const normal = drift({}), still = drift({ handheld: 0 }), strong = drift({ handheld: 1 });
  assert.ok(normal > 2e-5 && normal < 0.01, `drift ${normal} rad`);
  assert.ok(still < 1e-6, `switched off: ${still}`);
  assert.ok(strong > normal * 3);
});

test("'chase' swings round behind an actor that turns; 'orbit' stays where the player put it", () => {
  const { actor, d } = follower(ME2);
  actor.yaw = Math.PI / 2;                                  // turned toward +X
  for (let i = 0; i < 20; i++) d.advance(DT);
  const early = d.follow.yaw;
  assert.ok(early > 0.1 && early < Math.PI / 2 - 0.2, `swinging: ${early} rad after a third of a second`);
  for (let i = 0; i < 240; i++) d.advance(DT);
  near(d.follow.yaw, Math.PI / 2, 0.01, 'behind the actor in the end');
  assert.ok(d.cur.pos.x < actor.chest().x - 2, `the camera is behind (at x ${d.cur.pos.x.toFixed(2)})`);
  near(d.yaw, Math.PI / 2, 0.01);
  // the angle takes the short way round
  actor.yaw = -Math.PI * 0.9; d.follow.yaw = Math.PI * 0.9;
  d.advance(DT);
  assert.ok(Math.abs(Math.abs(d.follow.yaw) - Math.PI * 0.9) < 0.1 && Math.abs(d.follow.yaw) > Math.PI * 0.9, 'through +-pi, not across zero');
  // orbit
  const o = follower({ ...ME2, mode: 'orbit' });
  o.actor.yaw = 2;
  for (let i = 0; i < 120; i++) o.d.advance(DT);
  near(o.d.follow.yaw, 0, 1e-9, 'the actor turned, the camera did not');
  o.d.look(0.5, 0);
  near(o.d.yaw, -0.5, 1e-9, 'look(right) turns the view to the right: the heading goes down');
  for (let i = 0; i < 120; i++) o.d.advance(DT);
  assert.ok(o.d.cur.pos.x > o.actor.chest().x + 0.5, 'the camera swung to the actor\'s left; it looks right');
  // pitch limits
  o.d.look(0, 10); near(o.d.follow.pitch, MathUtils.degToRad(35), 1e-9);
  o.d.look(0, -10); near(o.d.follow.pitch, MathUtils.degToRad(-70), 1e-9);
  for (let i = 0; i < 300; i++) o.d.advance(DT);
  const rel = o.d.cur.pos.clone().sub(o.actor.chest());
  near(rel.y, 0.35 + 2.6 * Math.sin(MathUtils.degToRad(70)), 0.01, 'on the sphere round the head');
  near(Math.hypot(rel.x, rel.z), Math.hypot(0.45, 2.6 * Math.cos(MathUtils.degToRad(70))), 0.01, 'and closer in on the ground');
  assert.throws(() => o.d.followActor({}), /pass an Actor/);
  assert.throws(() => o.d.followActor(o.actor, { mode: 'fly' }), /'chase' or 'orbit'/);
});

test('the follow camera stops at a wall, answers at once, and drifts back out when it clears', () => {
  const world = new World();
  world.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  const wall = new BoxCollider({ center: new Vector3(0, 2, -1.6), half: new Vector3(6, 2, 0.1) });
  world.addCollider(wall);
  const { actor, d } = follower(ME2, { world });
  const chest = actor.chest();
  assert.ok(d.cur.pos.z > -1.5 + 0.0, `behind-the-wall camera pulled to z ${d.cur.pos.z.toFixed(2)}, in front of the wall face at -1.5`);
  assert.ok(d.cur.pos.distanceTo(chest.clone().add(new Vector3(0, 0.35, 0))) >= 0.35 - 1e-6, 'never inside the head');
  // without collision it goes through
  const free = follower({ ...ME2, collide: false }, { world });
  assert.ok(free.d.cur.pos.z < -2.4, 'collide: false ignores the wall');
  // backing into the wall: the camera is squeezed between the actor and the wall, never through the wall and never inside the actor
  const walk = follower(ME2, { world });
  let squeeze = 0;
  for (let i = 0; i < 110; i++) {
    walk.actor.root.position.z -= 0.01; walk.actor.root.updateMatrixWorld(true); walk.d.advance(DT);
    assert.ok(walk.d.cur.pos.z > -1.5, `frame ${i}: camera at z ${walk.d.cur.pos.z}`);
    const head = walk.actor.chest().add(new Vector3(0, 0.35, 0));
    squeeze = walk.d.cur.pos.distanceTo(head);
    assert.ok(squeeze >= 0.35 - 1e-6, `frame ${i}: ${squeeze} m from the head`);
  }
  near(squeeze, 0.35, 1e-6, 'squeezed against the wall it stays 35 cm from the head, no closer');
  // clearing: remove the wall, the camera eases out instead of popping
  world.removeCollider(wall);
  const before = d.cur.pos.z;
  d.advance(DT);
  const one = d.cur.pos.z - before;
  assert.ok(one < 0 && one > -0.2, `one frame later it moved ${one} m: eased out, not popped`);
  for (let i = 0; i < 240; i++) d.advance(DT);
  assert.ok(d.cur.pos.z < -2.4, 'back at full distance');
  // and a wall that appears behind the actor is answered the same frame
  world.addCollider(wall);
  d.advance(DT);
  assert.ok(d.cur.pos.z > -1.5, `a wall appeared: camera at z ${d.cur.pos.z}`);
});

test('bounds hold the follow camera too', () => {
  const { d } = follower({});
  d.bounds = { min: new Vector3(-10, 0.5, -1), max: new Vector3(10, 5, 10) };
  for (let i = 0; i < 120; i++) d.advance(DT);
  assert.ok(d.cur.pos.z >= -1 - 1e-6, `camera z ${d.cur.pos.z}`);
});

// ---------------------------------------------------------------------------------------------------------- in an engine

test('added to an engine, the camera follows after every update, sees the final pose, and holds while paused', async () => {
  const engine = await Engine.create({ platform: new NodePlatform(), render: false, baseUrl: ROOT });
  const actor = Actor.mannequin();
  engine.add(actor);
  const d = engine.add(new Director(engine, { rng: seeded(5) }));
  assert.equal(d.engine, engine); assert.equal(d.world, engine.physics); assert.equal(d.camera, engine.camera);
  assert.equal(typeof d.update, 'undefined', 'only lateUpdate: the engine must not step it twice per frame');
  d.cut({ type: 'ms', on: actor, ...quiet });
  actor.walkTo([4, 0, 0], { speed: 1.4 });
  let worst = 0;
  for (let i = 0; i < 150; i++) {
    engine.tick(DT, false);
    // the camera is where the shot says for the pose the actor has *now*: no frame behind
    const want = solveShot({ type: 'ms', on: actor }, 0);
    worst = Math.max(worst, engine.camera.position.distanceTo(want.pos));
  }
  assert.ok(actor.position.x > 2, 'the actor walked');
  assert.ok(worst < 1e-6, `camera lags the actor by up to ${worst} m`);
  // paused
  actor.walkTo([-6, 0, 0], { speed: 1.4 });
  engine.run(30, DT, { draw: false });
  const at = engine.camera.position.clone(), where = actor.position.clone();
  engine.paused = true;
  for (let i = 0; i < 30; i++) engine.tick(DT, false);
  nearV(actor.position, where, 0, 'the actor holds');
  nearV(engine.camera.position, at, 0, 'and so does the camera');
  engine.paused = false;
  engine.run(30, DT, { draw: false });
  assert.ok(engine.camera.position.distanceTo(at) > 0.1, 'both go on afterwards');
  engine.remove(d);
  assert.equal(d.engine, null);
  d.dispose();
  assert.equal(d.mode, 'manual');
});

test('a director made before the engine takes the stage lens when there is one, and its own otherwise', () => {
  const lens = { focus: 1, aperture: 2, focal: 0.05, amount: 1, pull: 8 };
  const stage = { camera: camera(), lens };
  const d = new Director(stage);
  d.cut({ type: 'cu', on: [0, 1, 0] });
  assert.equal(d.lens, lens);
  near(lens.focal, 0.085);
  const own = new Director(camera());
  own.cut({ type: 'cu', on: [0, 1, 0] });
  near(own.lens.focal, 0.085);
  const eng = new Director({ camera: camera(), stage: { lens } });
  assert.equal(eng.lens, lens, 'an engine hands over its stage lens');
});
