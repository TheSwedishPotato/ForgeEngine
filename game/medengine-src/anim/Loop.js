/**
 * Making cycles: finding where a walk, run or idle repeats, and cutting it there so it loops without a seam.
 *
 *   findLoop(clip, rig, opts)   the best [t0, t1] to loop (by pose match, or anchored on a gait event)
 *   makeLoop(clip, t0, t1)      cuts the clip there and closes the small remaining gap smoothly
 *
 * Mocap performers do not repeat themselves exactly, so the end pose never equals the start pose; the
 * closing step spreads that difference over the last fraction of a second where nobody can see it.
 */
import { Quaternion, Vector3 } from '../math/core.js';
import { Track, AnimationClip } from './Clip.js';

/** @import { RigInfo } from './Retarget.js' */

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// How much each bone matters for "do these two poses look the same".
function boneWeight(name) {
  if (/^(thumb|index|middle|ring|pinky)_/.test(name)) return 0;
  if (/^eye_/.test(name)) return 0;
  if (/^(thigh|calf|foot|spine|pelvis|neck|head)/.test(name)) return 1;
  if (/^(upperarm|lowerarm|clavicle)/.test(name)) return 0.7;
  return 0.3;
}

/** Per-frame local rotations (and pelvis height) of a clip on a uniform grid; used for comparing poses. */
function sampleGrid(clip, fps) {
  const dt = 1 / fps, n = Math.floor(clip.duration * fps + 1e-6) + 1;
  const names = clip.tracks.filter((t) => t.kind === 'quaternion').map((t) => t.bone);
  const W = names.map(boneWeight);
  const tmp = new Float32Array(4), tp = new Float32Array(3);
  const rot = names.map(() => new Float32Array(n * 4));
  const py = new Float32Array(n), px = new Float32Array(n), pz = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = Math.min(clip.duration, k * dt);
    names.forEach((nm, i) => { clip.byBone.get(nm).q.sample(t, tmp, 0); rot[i].set(tmp, k * 4); });
    if (clip.rootBone && clip.byBone.get(clip.rootBone)?.p) { clip.byBone.get(clip.rootBone).p.sample(t, tp, 0); px[k] = tp[0]; py[k] = tp[1]; pz[k] = tp[2]; }
  }
  return { dt, n, names, W, rot, py, px, pz };
}

/** RMS rotation difference (radians) between frames a and b, plus pelvis height difference. */
function frameDistance(G, a, b) {
  let s = 0, ws = 0;
  for (let i = 0; i < G.names.length; i++) {
    const w = G.W[i];
    if (!w) continue;
    const R = G.rot[i];
    const d = Math.abs(R[a * 4] * R[b * 4] + R[a * 4 + 1] * R[b * 4 + 1] + R[a * 4 + 2] * R[b * 4 + 2] + R[a * 4 + 3] * R[b * 4 + 3]);
    const ang = 2 * Math.acos(Math.min(1, d));
    s += w * ang * ang; ws += w;
  }
  return Math.sqrt(s / (ws || 1)) + 4 * Math.abs(G.py[a] - G.py[b]);
}

/**
 * Looks for the cycle in a clip.
 * @param {AnimationClip} clip
 * @param {RigInfo|null} rig  needed only for `phase`
 * @param {object} [o]
 * @param {number} [o.fps]          search grid (default 30)
 * @param {number} [o.minDuration]  shortest cycle in seconds (default 0.5)
 * @param {number} [o.maxDuration]  longest cycle (default: the whole clip)
 * @param {'left-foot-forward'|'right-foot-forward'|null} [o.phase]  start cycles on a gait event, so that
 *        a walk and a run begin on the same foot and can be blended
 * @param {number} [o.startBefore]  the cycle must start within this many seconds of the clip start (default 60% of it)
 * @returns {{t0:number, t1:number, error:number}|null}
 */
export function findLoop(clip, rig, o = {}) {
  const fps = o.fps ?? 30, G = sampleGrid(clip, fps);
  const minF = Math.max(2, Math.round((o.minDuration ?? 0.5) * fps)), maxF = Math.min(G.n - 1, Math.round((o.maxDuration ?? clip.duration) * fps));
  const startMax = Math.floor(Math.min(G.n - 1 - minF, (o.startBefore ?? clip.duration * 0.6) * fps));
  const dist = (a, b) => frameDistance(G, a, b) + 0.5 * frameDistance(G, Math.min(G.n - 1, a + 2), Math.min(G.n - 1, b + 2));
  if (o.phase && rig) {
    const foot = o.phase === 'left-foot-forward' ? 'foot_l' : 'foot_r';
    const fi = rig.index.get(foot), pi = rig.index.get('pelvis');
    if (fi !== undefined && pi !== undefined) {
      const f = new Float32Array(G.n);
      const pose = { q: null, p: null };
      for (let k = 0; k < G.n; k++) {
        const s = rig.sample(clip, k * G.dt, pose.q ? pose : null); pose.q = s.q; pose.p = s.p;
        f[k] = s.p[fi].z - s.p[pi].z;
      }
      let lo = Infinity, hi = -Infinity;
      for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const thr = lo + (hi - lo) * 0.7, peaks = [];
      for (let k = 1; k < G.n - 1; k++) if (f[k] >= thr && f[k] >= f[k - 1] && f[k] > f[k + 1]) {
        // sub-frame refinement is not needed: the closing step absorbs a few milliseconds
        if (!peaks.length || k - peaks[peaks.length - 1] > minF / 2) peaks.push(k);
      }
      let best = null;
      for (let i = 0; i + 1 < peaks.length; i++) {
        const a = peaks[i], b = peaks[i + 1], len = b - a;
        if (len < minF || len > maxF) continue;
        const e = dist(a, b);
        if (!best || e < best.error) best = { t0: a * G.dt, t1: b * G.dt, error: e };
      }
      if (best) return best;
    }
  }
  // generic: any pair; prefer the shortest cycle among the near-best ones
  const cands = [];
  for (let a = 0; a <= startMax; a++) for (let b = a + minF; b <= Math.min(G.n - 1, a + maxF); b++) cands.push({ a, b, e: dist(a, b) });
  if (!cands.length) return null;
  let emin = Infinity;
  for (const c of cands) emin = Math.min(emin, c.e);
  const ok = cands.filter((c) => c.e <= emin * 1.25 + 0.01);
  ok.sort((x, y) => (x.b - x.a) - (y.b - y.a) || x.e - y.e);
  const c = ok[0];
  return { t0: c.a * G.dt, t1: c.b * G.dt, error: c.e };
}

/**
 * Cuts `clip` to [t0, t1] and makes it loop: the last key equals the first, and the small difference between the
 * performer's start and end poses is spread over the final `blend` seconds.
 * @returns {AnimationClip}
 */
export function makeLoop(clip, t0, t1, { fps = 30, blend = 0.3, name = clip.name } = {}) {
  const dt = 1 / fps, n = Math.max(2, Math.round((t1 - t0) * fps)), m = Math.max(1, Math.min(n - 1, Math.round(blend * fps)));
  const q0 = new Quaternion(), qn = new Quaternion(), d = new Quaternion(), id = new Quaternion(), q = new Quaternion();
  const tracks = clip.tracks.map((tr) => {
    const s = tr.size, out = new Float32Array((n + 1) * s);
    for (let k = 0; k <= n; k++) tr.sample(Math.min(clip.duration, t0 + k * dt), out, k * s);
    if (tr.kind === 'quaternion') {
      q0.fromArray(out, 0); qn.fromArray(out, n * 4);
      if (q0.dot(qn) < 0) { qn.x = -qn.x; qn.y = -qn.y; qn.z = -qn.z; qn.w = -qn.w; }
      d.copy(q0).multiply(qn.clone().invert());                      // takes the end pose to the start pose
      for (let k = n - m; k <= n; k++) {
        const w = smooth((k - (n - m)) / m);
        q.fromArray(out, k * 4);
        q.premultiply(id.identity().slerp(d, w));
        q.toArray(out, k * 4);
      }
      q0.toArray(out, n * 4);
    } else if (tr.kind === 'position') {
      // positions: close the gap in height; the horizontal travel is the clip's root motion and stays
      const dy = out[1] - out[n * 3 + 1];
      for (let k = n - m; k <= n; k++) out[k * 3 + 1] += dy * smooth((k - (n - m)) / m);
      // and a cut that starts mid-travel still starts at the clip's own horizontal origin
      if (tr.bone === clip.rootBone) {
        const f = tr.sample(0, new Float32Array(3)), sx = f[0] - out[0], sz = f[2] - out[2];
        for (let k = 0; k <= n; k++) { out[k * 3] += sx; out[k * 3 + 2] += sz; }
      }
    }
    return new Track(tr.bone, tr.kind, out, null, dt, tr.size);
  });
  const c = new AnimationClip(name, tracks, {
    duration: n * dt, loop: true, rootBone: clip.rootBone, additive: clip.additive,
    events: clip.events.filter((e) => e.time >= t0 && e.time <= t1).map((e) => ({ ...e, time: e.time - t0 })),
    meta: { ...clip.meta, loopFrom: t0, loopTo: t1 }, rootMotion: 'trend', rootYaw: false,
  });
  return c;
}

void Vector3;
