/**
 * Clips made by code rather than captured: a breathing idle, and event detection for captured clips.
 */
import { Quaternion, Vector3 } from '../math/core.js';
import { Track, AnimationClip } from './Clip.js';

/**
 * @import { RigInfo } from './Retarget.js'
 * @import { ClipEvent } from './Clip.js'
 */

const DEG = Math.PI / 180;
const _q = new Quaternion(), _o = new Quaternion(), _a = new Float32Array(4);

/**
 * Local rotations that put the head level and facing where the chest faces (the neck half way), for the pose of `source` at `time`.
 * @returns {{neck_01: number[], head: number[]}|null}
 */
function levelHead(source, rig, time) {
  const ci = rig.index.get('spine_03'), ni = rig.index.get('neck_01'), hi = rig.index.get('head');
  if (ci === undefined || ni === undefined || hi === undefined) return null;
  const pose = rig.sample(source, time), Qc = pose.q[ci];
  const f = new Vector3(0, 0, 1).applyQuaternion(Qc);
  const head = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(f.x, f.z)).multiply(rig.restWorldQ[hi]);
  const neck = Qc.clone().slerp(head, 0.5);
  return { neck_01: Qc.clone().invert().multiply(neck).toArray(), head: neck.clone().invert().multiply(head).toArray() };
}

/**
 * A seamless idle: hold one pose of `source` (a standing moment in any clip) and give it breath, weight shift
 * and a little life. Every oscillation completes a whole number of periods in `duration`, so it loops exactly.
 *
 * @param {AnimationClip} source  a clip that contains a calm standing pose
 * @param {object} [o]
 * @param {number} [o.time]       where in `source` to take the pose (seconds)
 * @param {number} [o.duration]   loop length (default 4 s: one breath every 4 s)
 * @param {number} [o.intensity]  1 = a relaxed adult, 2 = heaving after a sprint
 * @param {number} [o.fps]        sampling rate (30)
 * @param {string} [o.name]       name of the new clip ('idle')
 * @param {RigInfo | null} [o.rig]  the skeleton `source` was baked for (needed for `lookAhead`)
 * @param {boolean} [o.lookAhead]  level the head and turn it to where the chest faces (the performer may have been looking over a
 *                                 shoulder at the moment you chose; an idle should look ahead)
 */
export function makeIdleLoop(source, { time = 0, duration = 4, intensity = 1, fps = 30, name = 'idle', rig = null, lookAhead = false } = {}) {
  const n = Math.round(duration * fps), dt = 1 / fps, w = (2 * Math.PI) / (n * dt), I = intensity;
  // [bone, axis (0 x pitch, 1 y turn, 2 z roll), amplitude in degrees, phase in radians, harmonic]
  const motion = [
    ['spine_01', 0, 0.45, 0, 1], ['spine_02', 0, 0.7, 0.1, 1], ['spine_03', 0, 1.0, 0.2, 1],
    ['clavicle_l', 2, 0.8, 0.3, 1], ['clavicle_r', 2, -0.8, 0.3, 1],
    ['neck_01', 0, -0.5, 0.5, 1], ['head', 0, -0.7, 0.7, 1], ['head', 1, 1.2, 1.4, 1],
    ['spine_02', 2, 0.7, 1.0, 1], ['pelvis', 2, -0.5, 1.0, 1],
    ['upperarm_l', 2, 0.35, 0.6, 1], ['upperarm_r', 2, -0.35, 0.6, 1],
    ['lowerarm_l', 0, 0.8, 0.9, 1], ['lowerarm_r', 0, 0.8, 0.5, 1],
  ];
  const tracks = [];
  const base = new Float32Array(4);
  const level = lookAhead && rig ? levelHead(source, rig, time) : null;
  const byBone = new Map();
  for (const m of motion) { if (!byBone.has(m[0])) byBone.set(m[0], []); byBone.get(m[0]).push(m); }
  for (const tr of source.tracks) {
    if (tr.kind === 'position') {
      tr.sample(time, base, 0);
      const v = new Float32Array((n + 1) * 3);
      for (let k = 0; k <= n; k++) {
        const t = k * dt;
        v[k * 3] = base[0] + 0.004 * I * Math.sin(w * t + 1.0);          // weight shifts side to side
        v[k * 3 + 1] = base[1] + 0.003 * I * Math.sin(w * t * 2 + 0.2);  // and the body rises with each breath
        v[k * 3 + 2] = base[2];
      }
      tracks.push(new Track(tr.bone, 'position', v, null, dt));
      continue;
    }
    tr.sample(time, base, 0);
    if (level && level[tr.bone]) for (let k = 0; k < 4; k++) base[k] = level[tr.bone][k];
    const v = new Float32Array((n + 1) * 4), list = byBone.get(tr.bone);
    for (let k = 0; k <= n; k++) {
      _q.set(base[0], base[1], base[2], base[3]);
      if (list) for (const [, axis, amp, ph, harm] of list) {
        const a = amp * I * DEG * Math.sin(w * k * dt * harm + ph), s = Math.sin(a / 2), c = Math.cos(a / 2);
        _o.set(axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, c);
        _q.premultiply(_o);
      }
      _q.toArray(v, k * 4);
    }
    tracks.push(new Track(tr.bone, 'quaternion', v, null, dt));
  }
  return new AnimationClip(name, tracks, { duration: n * dt, loop: true, rootBone: source.rootBone, rootMotion: 'trend', meta: { procedural: 'idle', from: source.name, time } });
}

/**
 * Finds the moments each foot lands: where the ankle drops to within `tolerance` metres of the lowest
 * point of its stride. Returns events named `footstep` with `data: { foot: 'l' | 'r' }`.
 *
 * @param {AnimationClip} clip
 * @param {RigInfo} rig
 * @param {object} [o]
 * @param {number} [o.tolerance]  how close to the lowest point of its stride the ankle must come, metres (0.045)
 * @param {number} [o.fps]        sampling rate of the search (60)
 * @param {string} [o.name]       name of the events ('footstep')
 * @returns {ClipEvent[]}
 */
export function detectFootsteps(clip, rig, { tolerance = 0.045, fps = 60, name = 'footstep' } = {}) {
  const dt = 1 / fps, n = Math.floor(clip.duration * fps) + 1, events = [];
  const pose = rig.sample(clip, 0);
  const y = { l: new Float32Array(n), r: new Float32Array(n) };
  const fi = { l: rig.index.get('foot_l'), r: rig.index.get('foot_r') };
  if (fi.l === undefined || fi.r === undefined) return events;
  for (let k = 0; k < n; k++) { rig.sample(clip, k * dt, pose); y.l[k] = pose.p[fi.l].y; y.r[k] = pose.p[fi.r].y; }
  for (const f of ['l', 'r']) {
    const Y = y[f];
    let lo = Infinity, hi = -Infinity;
    for (const v of Y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi - lo < 0.06) continue;                        // this foot never leaves the floor in this clip
    // a landing is the ankle coming down to the floor after a swing: it must first rise past the middle of
    // its range (so heel-strike rocking cannot count twice), then drop to within `tolerance` of the lowest point.
    const thr = lo + tolerance, swing = lo + (hi - lo) * 0.5;
    // loops are run twice so a foot that is mid-swing at the start is in the right state; only the second pass counts
    let airborne = false;
    for (let pass = 0; pass < (clip.loop ? 2 : 1); pass++) {
      for (let k = 0; k < n; k++) {
        if (Y[k] >= swing) airborne = true;
        else if (airborne && Y[k] <= thr) { airborne = false; if (pass === (clip.loop ? 1 : 0)) events.push({ time: k * dt, name, data: { foot: f } }); }
      }
    }
  }
  return events.sort((a, b) => a.time - b.time);
}

/**
 * One event at the moment `bone` (a name, or a list: the farthest one counts) is farthest from the pelvis: the peak of a
 * punch or kick, the frame the hit lands.
 * @param {AnimationClip} clip
 * @param {RigInfo} rig
 * @param {string | string[]} bone  a bone name, or several (the farthest one counts)
 * @param {object} [o]
 * @param {string} [o.name]   name of the event ('hit')
 * @param {number} [o.from]   start of the search in seconds (0)
 * @param {number} [o.to]     end of the search (the end of the clip)
 * @param {number} [o.fps]    sampling rate of the search (60)
 * @returns {ClipEvent[]}  one event, `data: { bone, reach }`; none when the bones are not in the rig
 */
export function detectReach(clip, rig, bone, { name = 'hit', from = 0, to = clip.duration, fps = 60 } = {}) {
  const bones = (Array.isArray(bone) ? bone : [bone]).filter((b) => rig.index.has(b)), pi = rig.index.get('pelvis');
  if (!bones.length || pi === undefined) return [];
  const pose = rig.sample(clip, 0);
  let best = -1, bt = from, bb = bones[0];
  for (let t = from; t <= to + 1e-9; t += 1 / fps) {
    rig.sample(clip, t, pose);
    for (const b of bones) { const d = pose.p[rig.index.get(b)].distanceTo(pose.p[pi]); if (d > best) { best = d; bt = t; bb = b; } }
  }
  return [{ time: bt, name, data: { bone: bb, reach: best } }];
}

void _a;
