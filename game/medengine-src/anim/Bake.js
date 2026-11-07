/**
 * The clip pipeline in one place: motion capture in, game-ready clip out.
 *
 *   retarget onto a rig  ->  crop or find the loop  ->  detect events  ->  flags (loop, root motion)
 *
 * Driven by plain-data specs (assets/mocap/cmu/clips.json), so the same recipe bakes clips for the default
 * mannequin at build time and for your own character at load time:
 *
 *   const clips = bakeAll(manifest, { bvh: (file) => parseBVH(text(file), file), rig });
 */
import { Retargeter } from './Retarget.js';
import { findLoop, makeLoop } from './Loop.js';
import { makeIdleLoop, detectFootsteps, detectReach } from './Procedural.js';

/**
 * @import { AnimationClip } from './Clip.js'
 * @import { BVHData } from './BVH.js'
 * @import { RigInfo } from './Retarget.js'
 */

/**
 * One entry of a clip manifest (`assets/mocap/cmu/clips.json`): where a clip comes from and what is done to it.
 * @typedef {object} BakeSpec
 * @property {string} [source]        the BVH file (not for a procedural clip)
 * @property {{ type: 'idle', from: string, time?: number, duration?: number, intensity?: number, lookAhead?: boolean }} [procedural]
 *           a clip made by code from an earlier one in the manifest (an idle loop from a standing moment)
 * @property {number} [fps]           sampling rate of the result (30)
 * @property {boolean} [inPlace]      drop the horizontal root travel
 * @property {boolean} [groundFix]    keep planted feet on the floor (true)
 * @property {boolean} [faceForward]  turn the clip to start facing +Z (true)
 * @property {boolean | { t0?: number, t1?: number, blend?: number, fps?: number, minDuration?: number, maxDuration?: number, startBefore?: number, phase?: 'left-foot-forward' | 'right-foot-forward' | null }} [loop]
 *           make it a cycle: between a given `t0` and `t1`, or searched for (see findLoop). `false` or absent: not a loop
 * @property {[number, number]} [crop]  keep only this part, in seconds of the performance
 * @property {(string | { reach: string | string[], name?: string, from?: number, to?: number } | { time: number, name: string, data?: any })[]} [events]
 *           'footsteps', or `{ reach: bone(s), name }` for the moment a limb is farthest out, or a plain event
 * @property {'auto' | 'trend' | 'full' | 'none'} [rootMotion]
 * @property {boolean} [rootYaw]      hand the root's turning to the game too (turn-in-place clips)
 * @property {string} [credit]
 * @property {string} [description]
 */

/**
 * What the bake needs besides the spec.
 * @typedef {object} BakeContext
 * @property {(file: string) => BVHData} bvh  reads and parses a performance by the name the spec gives
 * @property {RigInfo} rig                    the character's rest pose
 * @property {Map<string, AnimationClip>} [clips]  results so far (for `procedural.from`); bakeAll fills it in
 */

/**
 * Bakes one clip from its spec.
 * @param {string} name
 * @param {BakeSpec} spec  one entry of the manifest
 * @param {BakeContext & { clips: Map<string, AnimationClip> }} ctx
 * @returns {AnimationClip}
 */
export function bakeClip(name, spec, { bvh, rig, clips }) {
  let clip;
  if (spec.procedural) {
    const p = spec.procedural;
    if (p.type !== 'idle') throw new Error(`bakeClip ${name}: unknown procedural clip "${p.type}"`);
    const src = clips.get(p.from);
    if (!src) throw new Error(`bakeClip ${name}: "${p.from}" must be baked first`);
    clip = makeIdleLoop(src, { time: p.time ?? 0, duration: p.duration ?? 4, intensity: p.intensity ?? 1, rig, lookAhead: !!p.lookAhead, name });
  } else {
    const data = bvh(spec.source);
    const rt = new Retargeter(data, rig, { fps: spec.fps ?? 30, inPlace: !!spec.inPlace, groundFix: spec.groundFix ?? true, faceForward: spec.faceForward ?? true });
    clip = rt.run(name);
    clip.meta.report = { mapped: rt.report.mapped.length, missingTarget: rt.report.missingTarget, missingSource: rt.report.missingSource };
    if (spec.loop) {
      const L = spec.loop.t0 !== undefined ? { t0: spec.loop.t0, t1: spec.loop.t1 } : findLoop(clip, rig, spec.loop);
      if (!L) throw new Error(`bakeClip ${name}: no loop found`);
      clip = makeLoop(clip, L.t0, L.t1, { name, blend: spec.loop.blend ?? 0.3, fps: spec.fps ?? 30 });
      clip.meta.loopError = L.error;
    } else if (spec.crop) {
      clip = clip.crop(spec.crop[0], spec.crop[1], spec.fps ?? 30);
      clip.name = name;
    }
  }
  clip.name = name;
  clip.meta.source = spec.source ?? spec.procedural?.from ?? '';
  if (spec.credit) clip.meta.credit = spec.credit;
  const events = [];
  for (const e of spec.events ?? []) {
    if (e === 'footsteps') events.push(...detectFootsteps(clip, rig));
    else if (e.reach) events.push(...detectReach(clip, rig, e.reach, { name: e.name ?? 'hit', from: e.from ?? 0, to: e.to ?? clip.duration }));
    else events.push({ time: e.time, name: e.name, data: e.data });
  }
  clip.events = events.sort((a, b) => a.time - b.time);
  if (spec.loop !== undefined) clip.loop = !!spec.loop;
  if (spec.procedural) clip.loop = true;
  if (spec.rootMotion) clip.rootMotion = spec.rootMotion;
  if (spec.rootYaw) clip.rootYaw = true;
  clip.meta.description = spec.description ?? '';
  return clip;
}

/**
 * Bakes a whole manifest `{ clips: { name: spec } }` in order (entries may build on earlier ones).
 * @param {{ clips: Record<string, BakeSpec> }} manifest
 * @param {BakeContext} ctx
 * @returns {Map<string, AnimationClip>}
 */
export function bakeAll(manifest, ctx) {
  const clips = new Map();
  for (const [name, spec] of Object.entries(manifest.clips)) clips.set(name, bakeClip(name, spec, { ...ctx, clips }));
  return clips;
}
