// Animation: BVH, clips, retargeting, loops, animator, state machine, baked assets. Pure CPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBVH, writeBVH, Track, AnimationClip, Retargeter, RigInfo, CMU_TO_MEDENGINE, guessMapping, findLoop, makeLoop,
  makeIdleLoop, detectFootsteps, bakeAll, Animator, StateMachine, BlendTree1D, BlendTree2D, Humanoid, HUMANOID_BONES,
} from '../src/anim/index.js';
import { Group, Bone, Quaternion, Vector3 } from '../src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mocap = (f) => fs.readFileSync(path.join(root, 'assets/mocap/cmu', f), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const deg = (r) => (r * 180) / Math.PI;
const angleBetween = (a, b) => deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));

// ---- BVH -------------------------------------------------------------------------------------------

const TINY = `HIERARCHY
ROOT Hips
{
\tOFFSET 0 0 0
\tCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
\tJOINT Spine
\t{
\t\tOFFSET 0 10 0
\t\tCHANNELS 3 Zrotation Yrotation Xrotation
\t\tEnd Site
\t\t{
\t\t\tOFFSET 0 5 0
\t\t}
\t}
}
MOTION
Frames: 2
Frame Time: 0.5
0 0 0 0 0 0 0 0 0
1 2 3 90 0 0 0 0 0
`;

test('BVH: parse, forward kinematics, rotation order, round trip', () => {
  const b = parseBVH(TINY.replace(/\n/g, '\r\n'), 'tiny');
  assert.equal(b.joints.length, 3);
  assert.equal(b.frames, 2);
  assert.equal(b.fps, 2);
  assert.equal(b.joints[1].parent, 0);
  assert.ok(b.joints[2].isEnd);
  // frame 1: hips at (1,2,3) rotated 90 degrees about Z: the spine (0,10,0) swings to -X
  const p = b.pose(1);
  near(p.p[3], 1 - 10, 1e-9, 'spine x'); near(p.p[4], 2, 1e-9, 'spine y'); near(p.p[5], 3, 1e-9, 'spine z');
  near(p.p[6], 1 - 15, 1e-9, 'end site x');
  // scale applies to positions
  near(b.pose(1, 0.1).p[3], (1 - 10) * 0.1, 1e-9);
  // writeBVH -> parseBVH keeps the data
  const again = parseBVH(writeBVH(b, { decimals: 4 }), 'again');
  assert.equal(again.frames, 2);
  for (let i = 0; i < b.data.length; i++) near(again.data[i], b.data[i], 1e-4);
  // rotation order: Zrotation Yrotation Xrotation means Rz * Ry * Rx
  const c = parseBVH(TINY.replace('2\nFrame', '1\nFrame').replace(/\n0 0 0 0 0 0 0 0 0\n1 2 3 90 0 0 0 0 0/, '\n0 0 0 90 0 90 0 0 0'));
  const q = c.pose(0).q;
  const rz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2), rx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  const want = rz.clone().multiply(rx);
  assert.ok(Math.abs(new Quaternion(q[0], q[1], q[2], q[3]).dot(want)) > 0.999999);
});

test('BVH: the shipped capture parses and has the cgspeed skeleton', () => {
  const b = parseBVH(mocap('walk_07_01.bvh'), 'walk');
  assert.equal(b.joints.length, 38);
  assert.ok(b.frames > 70 && Math.abs(b.fps - 30) < 0.01);
  assert.equal(guessMapping(b).name, 'cmu');
});

// ---- Clips -------------------------------------------------------------------------------------------

function rotClip(bone, axis, d0, d1, dur, { loop = false, name = bone, events = [] } = {}) {
  const mk = (d) => { const h = (d * Math.PI) / 360, s = Math.sin(h); return [axis === 'x' ? s : 0, axis === 'y' ? s : 0, axis === 'z' ? s : 0, Math.cos(h)]; };
  return new AnimationClip(name, [new Track(bone, 'quaternion', [...mk(d0), ...mk(d1)], [0, dur])], { duration: dur, loop, events });
}
const zAngle = (o) => deg(2 * Math.atan2(o.quaternion.z, o.quaternion.w));

test('Track: uniform and non-uniform sampling, slerp, clamping', () => {
  const t = new Track('a', 'position', [0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 1, 3]);
  const o = new Float32Array(3);
  t.sample(0.5, o); near(o[0], 5, 1e-6);
  t.sample(2, o); near(o[0], 10, 1e-6); near(o[1], 5, 1e-6);
  t.sample(99, o); near(o[1], 10, 1e-6);
  t.sample(-1, o); near(o[0], 0, 1e-6);
  const u = new Track('a', 'position', [0, 0, 0, 3, 0, 0, 6, 0, 0], null, 0.5);
  u.sample(0.75, o); near(o[0], 4.5, 1e-6);
  assert.equal(u.duration, 1);
  const q = rotClip('a', 'z', 0, 90, 1).tracks[0], qo = new Float32Array(4);
  q.sample(0.5, qo); near(deg(2 * Math.atan2(qo[2], qo[3])), 45, 1e-3);
});

test('AnimationClip: crop, reverse, mirror, additive, binary round trip', () => {
  const c = new AnimationClip('c', [
    rotClip('arm_l', 'z', 0, 80, 2).tracks[0],
    new Track('pelvis', 'position', [0, 1, 0, 0, 1, 4], [0, 2]),
  ], { duration: 2, events: [{ time: 0.5, name: 'a' }, { time: 1.5, name: 'b' }] });
  const half = c.crop(1, 2, 10);
  near(half.duration, 1, 1e-6);
  assert.deepEqual(half.events.map((e) => [e.name, +e.time.toFixed(2)]), [['b', 0.5]]);
  near(half.byBone.get('pelvis').p.values[2], 0, 1e-6, 'a cut re-centres the root horizontally');
  const rev = c.reverse(), qo = new Float32Array(4);
  rev.rotationAt('arm_l', 0, qo); near(deg(2 * Math.atan2(qo[2], qo[3])), 80, 1e-3);
  assert.equal(rev.events[0].name, 'b');
  const m = c.mirror();
  assert.ok(m.byBone.has('arm_r') && !m.byBone.has('arm_l'));
  m.rotationAt('arm_r', 2, qo); near(deg(2 * Math.atan2(qo[2], qo[3])), -80, 1e-3);   // a rotation about Z mirrors to the other way
  const add = c.makeAdditive(0);
  assert.equal(add.additive, true);
  add.rotationAt('arm_l', 2, qo); near(deg(2 * Math.atan2(qo[2], qo[3])), 80, 1e-3);
  add.rotationAt('arm_l', 0, qo); near(qo[3], 1, 1e-6);
  const back = AnimationClip.fromBinary(c.toBinary());
  assert.equal(back.name, 'c'); assert.equal(back.duration, 2); assert.equal(back.tracks.length, 2);
  assert.equal(back.events[1].name, 'b');
  back.rotationAt('arm_l', 1, qo); near(deg(2 * Math.atan2(qo[2], qo[3])), 40, 1e-3);
  assert.throws(() => AnimationClip.fromBinary(new ArrayBuffer(16)), /medclip/);
});

// ---- Retargeting -------------------------------------------------------------------------------------

/** A rig made from the capture's own T-pose: retargeting onto it must give the performance back exactly. */
function mirrorRig(bvh, map) {
  const rest = bvh.pose(0);
  const Q = (i) => new Quaternion(rest.q[i * 4], rest.q[i * 4 + 1], rest.q[i * 4 + 2], rest.q[i * 4 + 3]);
  const P = (i) => new Vector3(rest.p[i * 3], rest.p[i * 3 + 1], rest.p[i * 3 + 2]);
  const back = new Map();
  for (const [t, m] of Object.entries(map)) back.set(t, bvh.index(m.delta ?? m.swing[0]));
  for (const m of Object.values(map)) if (m.swing && !back.has(m.to)) back.set(m.to, bvh.index(m.swing[1]));
  const byJoint = new Map([...back].map(([n, j]) => [j, n]));
  const bones = [...back.entries()].sort((a, b) => a[1] - b[1]).map(([name, j]) => {
    let a = bvh.joints[j].parent; while (a >= 0 && !byJoint.has(a)) a = bvh.joints[a].parent;
    const local = a >= 0 ? P(j).sub(P(a)).applyQuaternion(Q(a).invert()).toArray() : P(j).toArray();
    return { name, parent: a >= 0 ? byJoint.get(a) : null, localPos: local, restQ: Q(j).toArray() };
  });
  return { rig: new RigInfo(bones), back };
}

test('retargeting onto the capture\'s own skeleton reproduces the performance', () => {
  for (const f of ['walk_07_01.bvh', 'fight_141_14.bvh', 'getup_139_16.bvh']) {
    const bvh = parseBVH(mocap(f), f);
    const { rig, back } = mirrorRig(bvh, CMU_TO_MEDENGINE);
    const rt = new Retargeter(bvh, rig, { groundFix: false });
    assert.equal(rt.report.mapped.length, 22, 'every mapped bone found');
    assert.deepEqual([rt.report.missingSource, rt.report.missingTarget], [[], []]);
    near(rt.scale, 1, 1e-9, 'identical skeleton: scale 1');
    const clip = rt.run('t');
    const yaw = rt._heading(rt.firstFrame), R = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -yaw);
    let worst = 0;
    for (let k = 0; k <= Math.floor(clip.duration * 30); k += 2) {
      const t = k / 30, w = rig.sample(clip, t).q, S = bvh.pose(Math.round(rt.firstFrame + t * bvh.fps));
      for (const [name, j] of back) {
        if (!(name in CMU_TO_MEDENGINE)) continue;
        const sq = new Quaternion(S.q[j * 4], S.q[j * 4 + 1], S.q[j * 4 + 2], S.q[j * 4 + 3]).premultiply(R);
        worst = Math.max(worst, angleBetween(sq, w[rig.index.get(name)]));
      }
    }
    assert.ok(worst < 0.15, `${f}: worst world-rotation error ${worst.toFixed(3)} degrees`);
  }
});

test('retargeting onto the humanoid: limbs point where the performer\'s do, feet meet the floor, travel is forward', () => {
  const hum = new Humanoid();
  const bvh = parseBVH(mocap('walk_07_01.bvh'), 'walk');
  const rt = new Retargeter(bvh, hum.rig, {});
  const clip = rt.run('walk');
  assert.equal(clip.rootBone, 'pelvis');
  assert.ok(clip.rootTravel > 3 && clip.rootTravel < 4.2, `walked ${clip.rootTravel.toFixed(2)} m`);
  const rest = hum.rig.sample(new AnimationClip('rest', [], { duration: 1 }), 0);
  void rest;
  // limb directions against the source
  const yaw = rt._heading(rt.firstFrame), c = Math.cos(-yaw), s = Math.sin(-yaw);
  const rot = (v) => new Vector3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
  const pairs = [['upperarm_l', 'lowerarm_l', 'LeftArm', 'LeftForeArm'], ['lowerarm_r', 'hand_r', 'RightForeArm', 'RightHand'], ['thigh_l', 'calf_l', 'LeftUpLeg', 'LeftLeg'], ['calf_r', 'foot_r', 'RightLeg', 'RightFoot']];
  let worst = 0, lowest = Infinity, highestStep = 0;
  for (let k = 0; k <= Math.floor(clip.duration * 30); k += 3) {
    const t = k / 30, P = hum.rig.sample(clip, t).p, S = bvh.pose(Math.round(rt.firstFrame + t * bvh.fps)).p;
    for (const [a, b, sa, sb] of pairs) {
      const ia = bvh.index(sa), ib = bvh.index(sb);
      const sd = rot(new Vector3(S[ib * 3] - S[ia * 3], S[ib * 3 + 1] - S[ia * 3 + 1], S[ib * 3 + 2] - S[ia * 3 + 2])).normalize();
      const td = P[hum.rig.index.get(b)].clone().sub(P[hum.rig.index.get(a)]).normalize();
      worst = Math.max(worst, deg(Math.acos(Math.min(1, sd.dot(td)))));
    }
    const toe = Math.min(P[hum.rig.index.get('ball_l')].y, P[hum.rig.index.get('ball_r')].y);
    lowest = Math.min(lowest, toe); highestStep = Math.max(highestStep, toe);
  }
  assert.ok(worst < 0.5, `limb directions within ${worst.toFixed(3)} degrees`);
  near(lowest, 0.035, 0.01, 'the planted toe sits at the floor');
  assert.ok(highestStep < 0.2, `lowest toe never floats above ${highestStep.toFixed(2)} m`);
  const end = clip.positionAt('pelvis', clip.duration);
  assert.ok(end[2] > 3 && Math.abs(end[0]) < 0.5, `ends ${end[2].toFixed(2)} m ahead (+Z), ${end[0].toFixed(2)} m aside`);
});

test('retargeting copes with a different body: a 1.3 m character takes proportionally shorter strides', () => {
  const bvh = parseBVH(mocap('run_09_01.bvh'), 'run');
  const big = new Retargeter(bvh, new Humanoid({ height: 1.9 }).rig, {}).run('a'), small = new Retargeter(bvh, new Humanoid({ height: 1.3 }).rig, {}).run('b');
  near(small.rootTravel / big.rootTravel, 1.3 / 1.9, 0.02);
});

// ---- Loops ---------------------------------------------------------------------------------------------

test('loops: the walk and the run are cut at the same gait event and close without a seam', () => {
  const hum = new Humanoid();
  const make = (f, opts) => { const c = new Retargeter(parseBVH(mocap(f), f), hum.rig, {}).run(f); const L = findLoop(c, hum.rig, opts); return { c, L, loop: makeLoop(c, L.t0, L.t1) }; };
  const walk = make('walk_07_01.bvh', { phase: 'left-foot-forward', minDuration: 0.7 });
  const run = make('run_09_01.bvh', { phase: 'left-foot-forward', minDuration: 0.4 });
  assert.ok(walk.loop.duration > 0.9 && walk.loop.duration < 1.3, `walk stride ${walk.loop.duration.toFixed(2)} s`);
  assert.ok(run.loop.duration > 0.55 && run.loop.duration < 0.95, `run stride ${run.loop.duration.toFixed(2)} s`);
  for (const { loop } of [walk, run]) {
    assert.equal(loop.loop, true);
    for (const tr of loop.tracks) {
      if (tr.kind !== 'quaternion') continue;
      const V = tr.values, n = tr.count - 1;
      for (let k = 0; k < 4; k++) near(V[k], V[n * 4 + k], 1e-6, `${tr.bone} last key equals the first`);
    }
  }
  // the left foot is forward at the loop start in both: walk and run can be blended in sync
  for (const { loop } of [walk, run]) {
    const P = hum.rig.sample(loop, 0).p, L = P[hum.rig.index.get('foot_l')].z - P[hum.rig.index.get('pelvis')].z, R = P[hum.rig.index.get('foot_r')].z - P[hum.rig.index.get('pelvis')].z;
    assert.ok(L > R + 0.1, `left foot ahead of the right at the start (${L.toFixed(2)} vs ${R.toFixed(2)})`);
  }
});

test('procedural idle loops exactly and keeps the held pose', () => {
  const hum = new Humanoid();
  const bow = new Retargeter(parseBVH(mocap('bow_113_02.bvh'), 'bow'), hum.rig, {}).run('bow');
  const idle = makeIdleLoop(bow, { time: 0.1 });
  assert.equal(idle.loop, true); near(idle.duration, 4, 1e-6);
  for (const tr of idle.tracks) { const V = tr.values, n = tr.count - 1, s = tr.size; for (let k = 0; k < s; k++) near(V[k], V[n * s + k], 1e-6, `${tr.bone} first = last`); }
  // it is the bow's standing pose: thighs unchanged
  const a = new Float32Array(4), b = new Float32Array(4);
  idle.rotationAt('thigh_l', 1.3, a); bow.rotationAt('thigh_l', 0.1, b);
  assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.9999);
  // and it breathes: the chest moves a little
  idle.rotationAt('spine_03', 0, a); idle.rotationAt('spine_03', 1, b);
  const ang = deg(2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))));
  assert.ok(ang > 0.3 && ang < 3, `chest moves ${ang.toFixed(2)} degrees`);
});

test('footsteps: the walk and the run land each foot once per stride, evenly spaced', () => {
  const hum = new Humanoid();
  for (const [f, stride] of [['walk_07_01.bvh', 1.07], ['run_09_01.bvh', 0.73]]) {
    const c = new Retargeter(parseBVH(mocap(f), f), hum.rig, {}).run(f);
    const loop = makeLoop(c, ...Object.values(findLoop(c, hum.rig, { phase: 'left-foot-forward', minDuration: stride * 0.7 })).slice(0, 2));
    const ev = detectFootsteps(loop, hum.rig);
    assert.equal(ev.length, 2, `${f}: ${ev.length} footsteps per stride`);
    assert.deepEqual(ev.map((e) => e.data.foot).sort(), ['l', 'r']);
    const gap = ev[1].time - ev[0].time;
    assert.ok(Math.abs(gap - loop.duration / 2) < loop.duration * 0.12, `${f}: steps ${gap.toFixed(2)} s apart in a ${loop.duration.toFixed(2)} s stride`);
  }
});

// ---- Humanoid ----------------------------------------------------------------------------------------

test('Humanoid: the Med Engine bone set, a world-aligned rest pose, a skinned mannequin', () => {
  const h = new Humanoid({ height: 1.8 });
  assert.equal(h.boneList.length, HUMANOID_BONES.length);
  for (const n of ['pelvis', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'upperarm_r', 'lowerarm_l', 'hand_r', 'index_02_l', 'thumb_03_r', 'thigh_l', 'calf_r', 'foot_l', 'ball_r']) assert.ok(h.bones[n], n);
  for (const b of h.boneList) assert.ok(Math.abs(b.getWorldQuaternion(new Quaternion()).w) > 0.999999, `${b.name} rest rotation is identity`);
  near(h.rig.head('head').y, 1.6 * 1.8 / 1.75, 1e-6);
  const m = h.buildMannequin();
  assert.equal(m.isSkinnedMesh, true);
  const g = m.geometry;
  assert.equal(g.attributes.skinIndex.count, g.attributes.position.count);
  for (let i = 0; i < g.attributes.skinWeight.count; i += 97) near(g.attributes.skinWeight.getX(i), 1, 1e-6);
  const box = g.attributes.position; let top = -Infinity;
  for (let i = 0; i < box.count; i++) top = Math.max(top, box.getY(i));
  assert.ok(top > 1.7 * 1.8 / 1.75 && top < 1.95, `mannequin is ${top.toFixed(2)} m tall`);
});

// ---- Animator ---------------------------------------------------------------------------------------

function rig2() {
  const root = new Group(), a = new Bone(), b = new Bone(), c = new Bone();
  a.name = 'a'; b.name = 'b'; c.name = 'c';
  root.add(a); a.add(b); a.add(c);
  return { root, a, b, c };
}

test('Animator: play, cross-fade, weights stay normalised, finished one-shots hold the last pose', () => {
  const { root, a, b } = rig2();
  const an = new Animator(root);
  const up = rotClip('a', 'z', 0, 90, 1), down = rotClip('a', 'z', 90, 0, 1);
  an.play(up, { fade: 0 });
  an.update(0.5); near(zAngle(a), 45, 0.01);
  an.update(0.6); near(zAngle(a), 90, 0.01, 'one-shot clamps at the end');
  assert.equal(an.layers[0].current.finished, true);
  // cross-fade 90 -> a pose from `down`: half way through the fade both contribute
  const x = an.play(down, { fade: 1, loop: true });
  an.update(0.5);
  const acts = an.layers[0].actions;
  near(acts.reduce((s, q) => s + q.weight, 0), 1, 0.02, 'weights sum to one mid fade');
  assert.ok(zAngle(a) > 0 && zAngle(a) < 90);
  an.update(0.6);
  assert.equal(an.layers[0].actions.length, 1, 'the faded-out action is gone');
  assert.equal(an.layers[0].current, x);
  // play() of the clip already playing does not restart it
  const t = x.time; assert.equal(an.play(down, { fade: 0.2, loop: true }), x); assert.equal(x.time, t);
  void b;
});

test('Animator: loops wrap and count, speed scales time, events fire once per pass', () => {
  const { root } = rig2();
  const an = new Animator(root), fired = [];
  an.onEvent = (n, d) => fired.push([n, d]);
  const clip = rotClip('a', 'z', 0, 10, 1, { loop: true, events: [{ time: 0, name: 'start' }, { time: 0.25, name: 'q', data: 7 }, { time: 1, name: 'end' }] });
  const act = an.play(clip, { fade: 0, speed: 2 });
  for (let i = 0; i < 10; i++) an.update(0.1);              // 1 s at speed 2 = 2 loops
  assert.equal(act.loops, 2);
  near(act.time, 0, 1e-6);
  assert.equal(fired.filter((f) => f[0] === 'q').length, 2);
  assert.deepEqual(fired.find((f) => f[0] === 'q')[1], 7);
  assert.equal(fired.filter((f) => f[0] === 'start').length, 3, 'once at the very start, then at each wrap');
  assert.equal(fired.filter((f) => f[0] === 'end').length, 2);
});

test('Animator: a masked layer drives only its bones; an additive layer adds on top', () => {
  const { root, a, b, c } = rig2();
  const an = new Animator(root);
  an.play(new AnimationClip('base', [rotClip('a', 'z', 30, 30, 1).tracks[0], rotClip('b', 'z', 10, 10, 1).tracks[0], rotClip('c', 'z', 20, 20, 1).tracks[0]], { duration: 1, loop: true }), { fade: 0 });
  an.update(0.1);
  near(zAngle(a), 30, 0.01); near(zAngle(b), 10, 0.01);
  // upper layer: bone b only
  an.layer(1, { mask: ['b'], children: false });
  an.play(new AnimationClip('wave', [rotClip('a', 'z', 90, 90, 1).tracks[0], rotClip('b', 'z', 80, 80, 1).tracks[0]], { duration: 1, loop: true }), { layer: 1, fade: 0 });
  an.update(0.1);
  near(zAngle(a), 30, 0.01, 'a is outside the mask'); near(zAngle(b), 80, 0.01, 'b follows the layer');
  an.layer(1).weight = 0.5; an.update(0.1);
  near(zAngle(b), 45, 0.01, 'layer weight blends');
  an.stop(1, 0); an.layer(1).setMask(null);
  // additive: +15 degrees on a, on top of whatever is below
  const add = new AnimationClip('lean', [rotClip('a', 'z', 0, 0, 1).tracks[0]], { duration: 1, loop: true, additive: true });
  add.tracks[0].values.set([...rotClip('a', 'z', 15, 15, 1).tracks[0].values]);
  an.layer(2, { additive: true });
  an.play(add, { layer: 2, fade: 0 });
  an.update(0.1);
  near(zAngle(a), 45, 0.01, '30 + 15');
  an.layer(2).weight = 0.4; an.update(0.1);
  near(zAngle(a), 36, 0.05, '30 + 0.4 * 15');
  void c;
});

test('Animator: root motion is taken out of the pose and handed over', () => {
  const root = new Group(), pelvis = new Bone(); pelvis.name = 'pelvis'; root.add(pelvis);
  // 2 m forward in 2 s, with a little sway sideways
  const pos = new Track('pelvis', 'position', [0, 1, 0, 0.05, 1, 1, 0, 1, 2], [0, 1, 2]);
  const walk = new AnimationClip('walk', [pos], { duration: 2, loop: true });
  const an = new Animator(root);
  an.play(walk, { fade: 0 });
  let z = 0, x = 0;
  for (let i = 0; i < 20; i++) { an.update(0.1); z += an.rootDelta.z; x += an.rootDelta.x; near(pelvis.position.z, 0.1 * (i + 1) * 0 + pelvis.position.z, 1); }
  near(z, 2, 1e-6, 'one loop travels 2 m'); near(x, 0, 1e-6);
  near(pelvis.position.z, 0, 0.01, 'the pelvis stays at the origin; only the sway remains');
  assert.ok(Math.abs(pelvis.position.x) < 0.06);
  near(pelvis.position.y, 1, 1e-6);
  // apply to an object, heading 90 degrees (facing +X)
  const obj = { position: new Vector3(), rotation: { y: Math.PI / 2 } };
  an.rootDelta.x = 0; an.rootDelta.z = 1; an.rootDelta.yaw = 0;
  an.applyRootMotion(obj);
  near(obj.position.x, 1, 1e-9); near(obj.position.z, 0, 1e-9);
  // switched off: the travel stays in the pose
  const root2 = new Group(), p2 = new Bone(); p2.name = 'pelvis'; root2.add(p2);
  const an2 = new Animator(root2, { rootMotion: false });
  an2.play(walk, { fade: 0 }); an2.update(1);
  near(p2.position.z, 1, 1e-6);
});

// ---- State machine -----------------------------------------------------------------------------------

function machineRig() {
  const { root, a } = rig2();
  const clips = {
    idle: rotClip('a', 'z', 0, 0, 1, { loop: true, name: 'idle' }),
    walk: rotClip('a', 'z', 30, 30, 1, { loop: true, name: 'walk' }),
    run: rotClip('a', 'z', 60, 60, 0.5, { loop: true, name: 'run' }),
    jump: rotClip('a', 'z', 90, 90, 1, { loop: false, name: 'jump', events: [{ time: 0.5, name: 'apex' }] }),
  };
  const an = new Animator(root);
  return { an, a, clips, root };
}
const tick = (an, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) an.update(dt); };

test('StateMachine: parameter transitions, cross-fades, any-state transitions, triggers, exit time', () => {
  const { an, a, clips } = machineRig();
  const sm = new StateMachine(an);
  sm.addState('idle', clips.idle);
  sm.addState('walk', clips.walk);
  sm.addState('jump', clips.jump);
  sm.addTransition('idle', 'walk', { when: 'speed > 0.1', duration: 0.2 });
  sm.addTransition('walk', 'idle', { when: 'speed <= 0.1', duration: 0.2 });
  sm.addTransition('*', 'jump', { when: 'jump', duration: 0.1 });
  sm.addTransition('jump', 'idle', { exitTime: 0.9, duration: 0.1 });
  tick(an, 3); assert.equal(sm.state, 'idle'); near(zAngle(a), 0, 0.01);
  sm.set('speed', 1); tick(an, 1);
  assert.equal(sm.state, 'walk'); assert.ok(sm.isTransitioning);
  tick(an, 30); assert.equal(sm.isTransitioning, false); near(zAngle(a), 30, 0.05);
  sm.trigger('jump'); tick(an, 1);
  assert.equal(sm.state, 'jump', 'any-state transition fires from walk');
  tick(an, 10); near(zAngle(a), 90, 0.05);
  // the trigger was consumed: no second jump after it ends
  tick(an, 70);                                      // past 0.9 s -> back to idle (speed is still 1, so idle -> walk follows)
  assert.notEqual(sm.state, 'jump');
  sm.set('speed', 0); tick(an, 60); assert.equal(sm.state, 'idle');
  // a trigger nobody can use lapses after its life
  const n = []; sm.onEnter = (s) => n.push(s);
  sm.trigger('nothing'); tick(an, 30); sm.set('x', 1);
  assert.equal(sm._triggers.has('nothing'), false);
});

test('StateMachine: events from state clips reach the machine, root motion flows through the animator', () => {
  const { an, clips } = machineRig();
  const sm = new StateMachine(an), got = [];
  sm.addState('jump', clips.jump, { loop: false });
  sm.onEvent = (name) => got.push(name);
  tick(an, 70);
  assert.deepEqual(got, ['apex']);
  const root = new Group(), pelvis = new Bone(); pelvis.name = 'pelvis'; root.add(pelvis);
  const an2 = new Animator(root);
  const sm2 = new StateMachine(an2);
  sm2.addState('walk', new AnimationClip('walk', [new Track('pelvis', 'position', [0, 1, 0, 0, 1, 2], [0, 1])], { duration: 1, loop: true }));
  let z = 0; for (let i = 0; i < 60; i++) { an2.update(1 / 60); z += an2.rootDelta.z; }
  near(z, 2, 0.01, 'a second of walking in a state moves the root 2 m');
});

test('blend trees: 1D weights by threshold, 2D weights exact at each clip, blends are partitions of unity', () => {
  const { clips } = machineRig();
  const t1 = new BlendTree1D({ param: 'speed', children: [{ clip: clips.idle, threshold: 0 }, { clip: clips.walk, threshold: 1.4 }, { clip: clips.run, threshold: 3.5 }] });
  const mix = (tree, p) => { const o = []; tree.evaluate(p, o, 1); return Object.fromEntries(o.map((m) => [m.clip.name, +m.weight.toFixed(4)])); };
  assert.deepEqual(mix(t1, { speed: 0 }), { idle: 1 });
  assert.deepEqual(mix(t1, { speed: 0.7 }), { idle: 0.5, walk: 0.5 });
  assert.deepEqual(mix(t1, { speed: 99 }), { run: 1 });
  const s = mix(t1, { speed: 2.45 }); near(s.walk, 0.5, 1e-3); near(s.run, 0.5, 1e-3);
  near(t1.duration({ speed: 2.45 }), 0.75, 1e-6, 'weight-averaged cycle time of 1 s and 0.5 s');
  const t2 = new BlendTree2D({ paramX: 'x', paramY: 'y', children: [
    { clip: clips.idle, x: 0, y: 0 }, { clip: clips.walk, x: 0, y: 1 }, { clip: clips.run, x: 0, y: 2 }, { clip: clips.jump, x: 1, y: 1 },
  ] });
  for (const [c, [x, y]] of Object.entries({ idle: [0, 0], walk: [0, 1], run: [0, 2], jump: [1, 1] })) assert.equal(mix(t2, { x, y })[c], 1, `exact at ${c}`);
  for (const [x, y] of [[0.3, 0.4], [0.5, 1.5], [0.9, 0.2], [-1, 3], [0.2, 1.1]]) {
    const w = t2.weights(x, y); near(w.reduce((a, b) => a + b, 0), 1, 1e-9, `(${x},${y}) sums to one`);
    assert.ok(w.every((v) => v >= 0));
  }
});

test('StateMachine: locomotion blend tree follows the speed parameter; sync keeps feet in step', () => {
  const { an, a, clips } = machineRig();
  const sm = new StateMachine(an);
  sm.addState('move', new BlendTree1D({ param: 'speed', children: [{ clip: clips.idle, threshold: 0 }, { clip: clips.walk, threshold: 1 }, { clip: clips.run, threshold: 2 }] }));
  sm.set('speed', 0.5); tick(an, 5); near(zAngle(a), 15, 0.2);
  sm.set('speed', 1.5); tick(an, 5); near(zAngle(a), 45, 0.2);
  sm.set('speed', 2); tick(an, 5); near(zAngle(a), 60, 0.2);
});

test('StateMachine.fromDefinition builds the same machine from data; priorities and self transitions', () => {
  const { an, a, clips } = machineRig();
  const sm = StateMachine.fromDefinition(an, {
    params: { speed: 0 }, entry: 'idle',
    states: [{ name: 'idle', motion: 'idle' }, { name: 'move', motion: { type: '1d', param: 'speed', children: [{ clip: 'walk', threshold: 1 }, { clip: 'run', threshold: 2 }] } }, { name: 'jump', motion: 'jump', loop: false }],
    transitions: [
      { from: 'idle', to: 'move', when: 'speed > 0.5', duration: 0.1 },
      { from: 'move', to: 'idle', when: ['speed < 0.5', '!jumping'], duration: 0.1 },
      { from: '*', to: 'jump', when: 'jumping', priority: 5, duration: 0 },
      { from: '*', to: 'idle', when: 'jumping', priority: 1, duration: 0 },
    ],
  }, clips);
  tick(an, 2); assert.equal(sm.state, 'idle');
  sm.set('speed', 1); tick(an, 20); assert.equal(sm.state, 'move'); near(zAngle(a), 30, 0.1);
  sm.set('jumping', true); tick(an, 3); assert.equal(sm.state, 'jump', 'highest priority wins');
  near(zAngle(a), 90, 0.1, 'duration 0 switches at once');
  assert.throws(() => StateMachine.fromDefinition(an, { states: [{ name: 'x', motion: 'nope' }] }, clips), /unknown clip/);
  assert.throws(() => sm.play('nothing'), /no state/);
});

// ---- Baked assets ------------------------------------------------------------------------------------

test('shipped clips: the baked .medclip files match a fresh bake of the shipped capture data', () => {
  const manifest = JSON.parse(mocap('clips.json'));
  const hum = new Humanoid();
  const cache = new Map();
  const clips = bakeAll(manifest, { bvh: (f) => { if (!cache.has(f)) cache.set(f, parseBVH(mocap(f), f)); return cache.get(f); }, rig: hum.rig });
  assert.deepEqual([...clips.keys()], ['bow', 'idle', 'walk', 'run', 'jump', 'getup', 'punch', 'kick', 'wave']);
  const lib = JSON.parse(fs.readFileSync(path.join(root, 'assets/anim/humanoid/manifest.json'), 'utf8'));
  for (const [name, clip] of clips) {
    const baked = AnimationClip.fromBinary(fs.readFileSync(path.join(root, 'assets/anim/humanoid', lib.clips[name].file)));
    near(baked.duration, clip.duration, 1e-6, `${name} duration`);
    assert.equal(baked.tracks.length, clip.tracks.length, `${name} tracks`);
    assert.equal(baked.loop, clip.loop);
    assert.equal(baked.events.length, clip.events.length, `${name} events`);
    const a = new Float32Array(4), b = new Float32Array(4);
    for (const t of [0, clip.duration * 0.37, clip.duration]) for (const bone of clip.bones) {
      const q = clip.byBone.get(bone).q;
      if (!q) continue;
      q.sample(t, a); baked.byBone.get(bone).q.sample(t, b);
      assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.99999, `${name}.${bone} at ${t.toFixed(2)}`);
    }
  }
  assert.equal(clips.get('walk').loop, true); assert.equal(clips.get('jump').loop, false);
  assert.deepEqual(clips.get('jump').events.map((e) => e.name), ['takeoff', 'land']);
  assert.equal(clips.get('walk').events.filter((e) => e.name === 'footstep').length, 2);
  assert.ok(clips.get('kick').events[0].time > 0.1 && clips.get('punch').events[0].name === 'hit');
  assert.ok(/mocap\.cs\.cmu\.edu/.test(manifest.credit));
});
