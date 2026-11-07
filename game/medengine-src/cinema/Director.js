/**
 * Med Engine virtual cinematographer.
 *
 * A shot is described the way a director would call it, and the camera works out where to stand:
 *
 *   director.cut({ type: 'cu', on: actor, angle: 25, height: 0, lens: 85, move: 'push', dur: 4, dutch: 4, handheld: 0.3 });
 *
 * Types (framings of the subject; lenses are 35 mm full-frame equivalents, the sensor 24 mm high):
 *   ecu (the eyes)  cu (the face)  mcu (head and shoulders)  ms (waist up)  mls (knees up)
 *   ws (the whole body with room around)  ews (the place, the person small in it)
 *   ots   over `over`'s shoulder onto `on`          two   `on` and `with` in one frame
 *   pov   through `on`'s eyes (looks along `look`)  insert   a hand or an object: `on` or `at`, `size` metres across
 *   free  `pos` and `target` as given
 * `on`, `over`, `with`, `at`, `look`, `focus`, `pos` and `target` take anything pointOf() does: a Vector3, [x, y, z], an Object3D,
 * an Actor (its eyes) or a function returning one of these (called every frame, so it follows).
 *
 * Common fields:
 *   angle    degrees round the subject from where it faces: 0 in front, 90 on its left, -90 on its right
 *   height   metres up (low angles are negative)
 *   lens     millimetres      aperture  f-number (for the depth-of-field lens values)      focus  what is sharp (default: `on`)
 *   frame    metres the picture should be tall at the subject, to override the type's
 *   look / lookMix   the camera leans toward a second point (a profile gets room in front of the face on its own)
 *   side     for ots: 'right' (default) puts the foreground character on the right of the frame, 'left' on the left
 *   move     over `dur` seconds: push (dolly in) pull (dolly out) crane (up) drop (down) truck (sideways) static, or
 *            orbit (the camera's `angle` grows by `orbit` degrees, which is toward the subject's left; negative goes the other way), or
 *            track (the camera follows a moving subject with a little lag);  `amount` scales the distance
 *   dutch    degrees of roll        handheld  0..1, the drift of a camera operator (default 0.08)
 *   track    false: freeze the subjects where they stand at the cut (default: the shot follows them)
 *
 * Composition: the eyes fall on the upper third; a profile gets look room in front of the face.
 *
 * Gameplay: `followActor` is a third-person camera. It stops at walls when the engine has a physics world.
 *
 *   const director = engine.add(new Director(engine));       // moves the camera after every update
 *   director.cut({ type: 'mcu', on: guard, angle: 20 });
 *   director.followActor(player, { mode: 'orbit' });          // mouse look: director.look(dx * 0.003, -dy * 0.003)
 *   player.move(...rotate the stick by director.yaw...)       // 'forward' is where the camera looks
 *
 * The depth-of-field values are written to `director.lens` (the stage's lens when there is one). Depth of field itself is not
 * a pass of the ME3 renderer yet.
 */
import { Vector3, Quaternion, MathUtils } from '../math/core.js';
import { pointOf } from '../engine/pointOf.js';

/**
 * @import { PerspectiveCamera } from '../scene/Camera.js'
 * @import { World } from '../physics/World.js'
 * @import { Engine } from '../engine/Engine.js'
 * @import { Lens } from '../Stage.js'
 * @import { Subject } from '../types.js'
 */

/** @typedef {'ecu' | 'cu' | 'mcu' | 'ms' | 'mls' | 'ws' | 'ews' | 'ots' | 'two' | 'pov' | 'insert' | 'free'} ShotType */
/** @typedef {'static' | 'push' | 'pull' | 'orbit' | 'crane' | 'drop' | 'truck' | 'track'} ShotMove */

/**
 * A shot, the way a director would call it. The camera works out where to stand. Every field is optional except what the type needs:
 * `on` for most, `over` and `on` for 'ots', `on` and `with` for 'two', `pos` and `target` for 'free'.
 *
 *   director.cut({ type: 'cu', on: actor, angle: 25, height: 0, lens: 85, move: 'push', dur: 4 });
 *
 * @typedef {object} Shot
 * @property {ShotType} [type]     the framing: ecu (the eyes), cu (the face), mcu (head and shoulders), ms (waist up, the default),
 *                                 mls (knees up), ws (the whole body), ews (the place), ots (over `over`'s shoulder onto `on`),
 *                                 two (`on` and `with`), pov (through `on`'s eyes), insert (a hand or an object), free (`pos`, `target`)
 * @property {Subject} [on]        the subject
 * @property {Subject} [over]      ots: the character in the foreground
 * @property {Subject} [with]      two: the second character
 * @property {Subject} [at]        insert: what to show, instead of `on`
 * @property {Subject} [pos]       free: where the camera stands
 * @property {Subject} [target]    free: what it looks at
 * @property {Subject} [look]      the camera leans toward this point (pov: where it looks along)
 * @property {number} [lookMix]    how far, 0..1 (0.35)
 * @property {number} [lookRoom]   scales the room a profile gets in front of the face (1)
 * @property {Subject} [focus]     what is sharp (default: `on`)
 * @property {number} [angle]      degrees round the subject from where it faces: 0 in front, 90 on its left, -90 on its right
 * @property {number} [height]     metres up (low angles are negative)
 * @property {number} [lens]       millimetres, 35 mm full-frame equivalent (the type's own, see LENS)
 * @property {number} [aperture]   f-number written to the lens for depth of field
 * @property {number} [pull]       how fast the focus follows, written to the lens (6)
 * @property {number} [frame]      metres the picture should be tall at the subject, overriding the type's (see FRAME)
 * @property {'left' | 'right'} [side]  ots: which side of the frame the foreground character is on ('right')
 * @property {number} [back]       ots: metres behind the foreground character (0.75)
 * @property {number} [shoulder]   ots: metres to the side of it (0.36)
 * @property {boolean} [flip]      two: film from the other side
 * @property {number} [size]       insert: metres across the picture (0.3)
 * @property {ShotMove} [move]     over `dur` seconds: push / pull (dolly), crane / drop (up / down), truck (sideways), orbit, or
 *                                 track (follow a moving subject with a little lag)
 * @property {number} [dur]        seconds the move takes (4)
 * @property {number} [amount]     scales the move's distance (1)
 * @property {number} [orbit]      orbit: degrees the camera travels round the subject (30)
 * @property {number} [dutch]      degrees of roll
 * @property {number} [handheld]   0..1, the drift of a camera operator (0.08)
 * @property {boolean} [track]     false: freeze the subjects where they stand at the cut (default: the shot follows them)
 */

/**
 * What `new Director(host, o)` takes.
 * @typedef {object} DirectorOptions
 * @property {() => number} [rng]            random numbers for the camera operator's drift (Math.random; seed it for replays)
 * @property {PerspectiveCamera | null} [camera]  the camera to move, when the host has none
 * @property {Lens | null} [lens]            where the depth-of-field values are written, when the host has none
 * @property {World | null} [world]          the physics world the follow camera stops at, when the host has none
 */

/**
 * What a Director drives: an Engine, a Stage, or a bare camera.
 * @typedef {{ camera: PerspectiveCamera, lens?: Lens, physics?: World | null, stage?: { lens: Lens } | null }
 *   | PerspectiveCamera} DirectorHost
 */

/**
 * What the follow camera needs from the character it follows: an Actor does.
 * @typedef {{ chest(out?: Vector3): Vector3, yaw?: number }} FollowTarget
 */

/**
 * What `director.followActor(actor, o)` takes. The defaults frame the whole body, feet to head, with room to see ahead; ME2's tighter
 * framing (it cropped the legs) is `{ dist: 2.6, height: 0.35, lens: 32 }`.
 * @typedef {object} FollowOptions
 * @property {number} [dist]      metres behind the pivot (3.2)
 * @property {number} [height]    metres above the actor's chest that the camera swings round and looks past (-0.3: the hips)
 * @property {number} [shoulder]  metres to the side (0.45; negative: the other shoulder)
 * @property {number} [pitch]     degrees: negative looks down on the actor (-8)
 * @property {number} [lens]      millimetres (28)
 * @property {number} [aim]       metres ahead of the actor the camera looks at (2.5)
 * @property {'chase' | 'orbit'} [mode]  'chase': the camera swings round behind the actor as it turns. 'orbit': only `look()` turns it
 * @property {boolean} [collide]  stop at walls (when there is a physics world; true)
 * @property {number} [radius]    how fat the camera is for that (0.2 m)
 * @property {number} [minPitch]  lowest pitch `look()` reaches, degrees (-70)
 * @property {number} [maxPitch]  highest pitch `look()` reaches, degrees (35)
 * @property {boolean} [snap]     place the camera at once instead of gliding there
 * @property {number} [handheld]  0..1, the drift of a camera operator (0.15; 0 holds the camera perfectly still)
 */

/**
 * The follow camera while it runs: the options as resolved, with the angles in radians and the heading it has now.
 * @typedef {object} FollowState
 * @property {FollowTarget} actor
 * @property {number} dist
 * @property {number} height
 * @property {number} shoulder
 * @property {number} aim
 * @property {number} lens
 * @property {'chase' | 'orbit'} mode
 * @property {boolean} collide
 * @property {number} radius
 * @property {number} handheld
 * @property {number} yaw       radians, the way the camera looks about +Y (0: toward +Z)
 * @property {number} pitch     radians
 * @property {number} minPitch  radians
 * @property {number} maxPitch  radians
 */

const { degToRad, smootherstep } = MathUtils;

/**
 * How tall (metres) the picture is at the subject for each framing.
 * @type {Record<'ecu' | 'cu' | 'mcu' | 'ms' | 'mls' | 'ws' | 'ews', number>}
 */
export const FRAME = { ecu: 0.11, cu: 0.3, mcu: 0.52, ms: 0.92, mls: 1.35, ws: 2.6, ews: 9 };
/**
 * The default lens (mm) of each shot type.
 * @type {Record<ShotType, number>}
 */
export const LENS = { ecu: 100, cu: 85, mcu: 65, ms: 50, mls: 40, ws: 32, ews: 24, ots: 50, two: 40, pov: 32, insert: 85, free: 40 };
/** Every shot type there is. @type {ShotType[]} */
export const SHOT_TYPES = /** @type {ShotType[]} */ (Object.keys(LENS));
/** Every camera move there is. @type {ShotMove[]} */
export const MOVES = ['static', 'push', 'pull', 'orbit', 'crane', 'drop', 'truck', 'track'];
const SENSOR_H = 0.024;   // full-frame height (m)

/**
 * Where a camera stands and looks.
 * @typedef {object} CameraPose
 * @property {Vector3} pos
 * @property {Vector3} target
 * @property {number} fov    vertical field of view, degrees
 * @property {number} roll   radians
 */

/**
 * Vertical field of view (degrees) of a lens of `focalMm` on a 24 mm high sensor.
 * @param {number} focalMm  focal length, 35 mm full-frame equivalent
 * @returns {number}
 */
export function vfov(focalMm) { return 2 * Math.atan(SENSOR_H / 2 / (focalMm / 1000)) * MathUtils.RAD2DEG; }

const _E = new Vector3(), _D = new Vector3(), _R = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3(), _O = new Vector3();
const _H = new Vector3(), _eye = new Vector3(), _back = new Vector3(), _dirC = new Vector3(), _f = new Vector3(), _up = new Vector3(0, 1, 0), _q = new Quaternion();

/** @returns {CameraPose} */
const pose = () => ({ pos: new Vector3(), target: new Vector3(), fov: 40, roll: 0 });
const copyPose = (a, b) => { a.pos.copy(b.pos); a.target.copy(b.target); a.fov = b.fov; a.roll = b.roll; return a; };
const finite = (p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.target.x + p.target.y + p.target.z + p.fov + p.roll);
const resolve = (x) => (typeof x === 'function' ? x() : x);
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** The way a subject faces, radians about +Y (0: toward +Z). Actors say it; other objects are read from their orientation. */
function facing(s) {
  if (!s || typeof s !== 'object' || s.isVector3 || Array.isArray(s)) return 0;
  if (typeof s.yaw === 'number') return s.yaw;
  if (s.isObject3D) { s.getWorldQuaternion(_q); _f.set(0, 0, 1).applyQuaternion(_q); return Math.atan2(_f.x, _f.z); }
  return 0;
}

/** A copy of what a subject is right now (where its eyes and chest are, which way it faces) that does not move on. */
function snapshot(x) {
  x = resolve(x);
  if (x == null) return x;
  const p = pointOf(x, new Vector3());
  if (!p) return x;
  if (typeof x === 'object' && !x.isVector3 && !Array.isArray(x)) {
    const frozen = { yaw: facing(x), eyes: (o = new Vector3()) => o.copy(p) };
    if (typeof x.chest === 'function') { const c = x.chest(new Vector3()); frozen.chest = (o = new Vector3()) => o.copy(c); }
    return frozen;
  }
  return p;
}
const SUBJECTS = ['on', 'over', 'with', 'at', 'look', 'focus', 'pos', 'target'];

function validate(S) {
  if (!S || typeof S !== 'object') throw new Error('Director.cut: pass a shot, e.g. { type: \'cu\', on: actor }');
  const type = S.type ?? 'ms';
  if (!(type in LENS)) throw new Error(`Director: unknown shot type '${type}' (use ${SHOT_TYPES.join(', ')})`);
  if (S.move != null && !MOVES.includes(S.move)) throw new Error(`Director: unknown move '${S.move}' (use ${MOVES.join(', ')})`);
  if (type === 'ots' && !S.over) throw new Error("Director: an 'ots' shot needs `over` (the character in the foreground) and `on` (the one it looks at)");
  if (type === 'two' && !S.with) throw new Error("Director: a 'two' shot needs `on` and `with`");
  if (type === 'free' && (!S.pos || !S.target)) throw new Error("Director: a 'free' shot needs `pos` and `target`");
  if (type !== 'free' && !S.on && !S.at) throw new Error(`Director: a '${type}' shot needs a subject: \`on\` (an actor, an object or a point)${type === 'insert' ? ' or `at`' : ''}`);
}

/**
 * Where the camera stands and looks for a shot, `t` seconds into it. Pure apart from reading the subjects' positions now.
 * @param {Shot} S       the shot
 * @param {number} [t]   seconds since the cut (only moves depend on it)
 * @param {CameraPose} [out]
 * @param {{ aspect?: number, bounds?: { min: Vector3, max: Vector3 } | null }} [ctx]  `aspect` frames `two` shots; `bounds` keeps the camera inside a box
 * @returns {CameraPose}  `out`
 */
export function solveShot(S, t = 0, out = pose(), { aspect = 16 / 9, bounds = null } = {}) {
  validate(S);
  const type = S.type ?? 'ms';
  out.fov = vfov(S.lens ?? LENS[type]);
  const tanH = Math.tan(degToRad(out.fov) / 2);
  const subj = resolve(S.on);
  const E = pointOf(subj, _E) ?? pointOf(resolve(S.at), _E) ?? _E.set(0, 0, 0);
  const yaw = facing(subj) + degToRad(S.angle ?? 0);
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  _D.set(sy, 0, cy);          // from the subject toward the camera
  _R.set(cy, 0, -sy);         // the camera's right when it looks back at the subject from there

  if (type === 'free') {
    pointOf(resolve(S.pos), out.pos); pointOf(resolve(S.target), out.target);
  } else if (type === 'pov') {
    out.pos.copy(E).addScaledVector(_D, 0.06);
    if (!pointOf(resolve(S.look), out.target)) out.target.copy(E).addScaledVector(_D, 5);
  } else if (type === 'ots') {
    // behind `over`, off one shoulder, looking at `on`
    const over = resolve(S.over);
    const O = typeof over.chest === 'function' ? over.chest(_O) : pointOf(over, _O);
    O.y = (typeof over.eyes === 'function' ? over.eyes(_a).y : O.y) - 0.05;
    const toS = _b.copy(E).sub(O); toS.y = 0; toS.normalize();
    const side = _c.set(toS.z, 0, -toS.x).multiplyScalar(S.side === 'left' ? -1 : 1);
    out.pos.copy(O).addScaledVector(toS, -(S.back ?? 0.75)).addScaledVector(side, S.shoulder ?? 0.36);
    out.pos.y += S.height ?? 0.08;
    out.target.copy(E).addScaledVector(side, -0.05);
    out.target.y -= 0.06;
  } else if (type === 'two') {
    const B = pointOf(resolve(S.with), _b);
    const mid = _a.copy(E).add(B).multiplyScalar(0.5);
    const span = E.distanceTo(B) + 0.9;
    const across = _c.copy(B).sub(E); across.y = 0; across.normalize();
    const k = S.flip ? -1 : 1;
    const d = (span / 2 / (tanH * aspect)) * 1.15;
    out.pos.set(mid.x - across.z * k * d, mid.y + (S.height ?? 0), mid.z + across.x * k * d);
    out.target.copy(mid); out.target.y -= 0.12;
  } else if (type === 'insert') {
    const d = (S.size ?? 0.3) / 2 / tanH;
    out.pos.copy(E).addScaledVector(_D, d); out.pos.y += S.height ?? 0.1;
    out.target.copy(E);
  } else {
    const H = S.frame ?? FRAME[type];
    const d = H / 2 / tanH;
    out.pos.copy(E).addScaledVector(_D, d);
    out.pos.y += S.height ?? 0;
    // eyes at the upper third; a profile gets room to look into
    out.target.copy(E);
    out.target.y -= H * 0.17;
    if (Math.abs(S.angle ?? 0) > 20 && type !== 'ews') out.target.addScaledVector(_R, -Math.sign(S.angle) * H * 0.18 * (S.lookRoom ?? 1));
    if (S.look) { const L = pointOf(resolve(S.look), _c); if (L) out.target.lerp(L, S.lookMix ?? 0.35); }
  }

  // moves: the camera travels from -half to +half of its distance over `dur`, eased at both ends
  const mv = S.move ?? 'static';
  if (mv !== 'static' && mv !== 'track') {
    const k = smootherstep(Math.min(1, t / Math.max(1e-3, S.dur ?? 4)), 0, 1) - 0.5, amt = S.amount ?? 1;
    const fwd = _a.copy(out.target).sub(out.pos).normalize();
    if (mv === 'push') out.pos.addScaledVector(fwd, k * 0.6 * amt * (FRAME[type] ?? 1));
    else if (mv === 'pull') out.pos.addScaledVector(fwd, -k * 0.6 * amt * (FRAME[type] ?? 1));
    else if (mv === 'crane') out.pos.y += k * 1.2 * amt;
    else if (mv === 'drop') out.pos.y -= k * 1.2 * amt;
    else if (mv === 'truck') out.pos.addScaledVector(_b.crossVectors(fwd, _up).normalize(), k * 0.8 * amt);
    else if (mv === 'orbit') {
      const rel = _b.copy(out.pos).sub(out.target).applyAxisAngle(_up, degToRad(k * (S.orbit ?? 30)));
      out.pos.copy(out.target).add(rel);
    }
  }
  if (bounds) out.pos.clamp(bounds.min, bounds.max);
  out.roll = degToRad(S.dutch ?? 0);
  return out;
}

export class Director {
  /**
   * @param {DirectorHost} host  the Engine (or a Stage, or a camera): its `camera` is moved, its stage's `lens` is written, its `physics`
   *                             world is what the follow camera stops at
   * @param {DirectorOptions} [o]
   */
  constructor(host, o = {}) {
    const { rng = Math.random, camera = null, lens = null, world = null } = o;
    host ??= /** @type {any} */ ({});
    const cam = camera ?? host.camera ?? (host.isCamera ? host : null);
    if (!cam) throw new Error('Director: pass the engine (or a Stage, or a camera) it should drive: new Director(engine)');
    /** @type {PerspectiveCamera} the camera being moved */
    this.camera = cam;
    /** @type {Lens} `{ focus, aperture, focal, amount, pull }`: the stage's lens when the host has one, else the director's own. */
    this.lens = lens ?? host.lens ?? host.stage?.lens ?? { focus: 3, aperture: 2, focal: 0.05, amount: 1, pull: 8 };
    /** @type {World | null} the physics world the follow camera stops at */
    this.world = world ?? host.physics ?? null;
    /** @type {Engine | null} the Engine, while the director is added to one */
    this.engine = null;
    /** @type {'shot' | 'follow' | 'manual'} 'shot' (a cut is playing), 'follow' (third-person gameplay camera) or 'manual' (the game moves the camera). */
    this.mode = 'manual';
    /** @type {Shot | null} the shot being played */
    this.shot = null;
    /** Seconds since the last cut. */
    this.t = 0;
    /** Seconds the last cut blends over (0: a hard cut). */
    this.blend = 0;
    /** @type {FollowState | null} the follow camera's state while `mode` is 'follow' (angles in radians) */
    this.follow = null;
    /** @type {{ min: Vector3, max: Vector3 } | null} A box the camera must stay inside. */
    this.bounds = null;
    /** Impact shake left, 0..1.5 (see kick()). */
    this.shake = 0;
    /** Number of cuts made. */
    this.cuts = 0;
    /** The poses the camera blends from, towards and currently has. */
    this.from = pose(); this.to = pose(); this.cur = pose();
    this.noiseT = rng() * 100;
    this._ctx = { aspect: 16 / 9, bounds: null };
    this._primed = false;
  }

  /** Called by the Engine when the director is added to it. @param {Engine} engine */
  onAdd(engine) { this.engine = engine; this.world ??= engine.physics ?? null; }
  onRemove() { this.engine = null; }
  /** The camera follows after every `update` of every system, so it sees the final pose of whatever it films. @param {number} dt */
  lateUpdate(dt) { this.advance(dt); }

  /** Which way the camera looks, radians about +Y (0: toward +Z): what a stick should be turned by to move "forward". */
  get yaw() {
    if (this.mode === 'follow' && this.follow) return this.follow.yaw;
    return Math.atan2(this.cur.target.x - this.cur.pos.x, this.cur.target.z - this.cur.pos.z);
  }

  /** Starts blends and follows from where the camera really is. */
  _prime() {
    if (this._primed) return;
    this._primed = true;
    const cam = this.camera;
    cam.updateWorldMatrix?.(true, false);
    this.cur.pos.copy(cam.position);
    cam.getWorldDirection(_f);                       // the camera's +Z axis: it looks the other way
    this.cur.target.copy(cam.position).addScaledVector(_f, -5);
    this.cur.fov = cam.fov ?? 40; this.cur.roll = 0;
  }

  /** The game moves the camera itself; the director leaves it alone. @returns {this} */
  manual() { this.mode = 'manual'; return this; }

  /**
   * Cuts to a new shot, or blends to it over `blend` seconds (smooth in and out, from wherever the camera is).
   * @param {Shot} spec
   * @param {{ blend?: number }} [o]  `blend`: seconds to glide from where the camera is (0: a hard cut)
   * @returns {this}
   */
  cut(spec, { blend = 0 } = {}) {
    validate(spec);
    this._prime();
    const S = { ...spec };
    if (S.track === false) for (const k of SUBJECTS) if (S[k] != null) S[k] = snapshot(S[k]);
    this._ctx.aspect = this.camera.aspect || 16 / 9; this._ctx.bounds = this.bounds;
    solveShot(S, 0, this.to, this._ctx);
    if (!finite(this.to)) throw new Error('Director.cut: the shot has no usable position (is a subject missing or NaN?)');
    this.mode = 'shot';
    this.shot = S;
    this.t = 0;
    this.blend = Math.max(0, blend);
    if (this.blend > 0) copyPose(this.from, this.cur);
    else { copyPose(this.cur, this.to); this._apply(0); }
    this.cuts++;
    this._focusShot();
    const type = S.type ?? 'ms', L = this.lens;
    L.focal = (S.lens ?? LENS[type]) / 1000;
    L.aperture = S.aperture ?? (type === 'ecu' || type === 'cu' ? 1.8 : type === 'ews' || type === 'ws' || type === 'free' ? 8 : 2.8);
    L.pull = S.pull ?? 6;
    return this;
  }

  /**
   * A third-person gameplay camera behind `actor`, over its right shoulder. The defaults frame the whole body, feet to head, with room
   * to see ahead; ME2's tighter framing (it cropped the legs) is `{ dist: 2.6, height: 0.35, lens: 32 }`.
   * @param {FollowTarget} actor  an Actor (anything with `chest()`)
   * @param {FollowOptions} [o]
   * @returns {this}
   */
  followActor(actor, { dist = 3.2, height = -0.3, shoulder = 0.45, pitch = -8, lens = 28, aim = 2.5, mode = 'chase', collide = true, radius = 0.2, minPitch = -70, maxPitch = 35, snap = false, handheld = 0.15 } = {}) {
    if (typeof actor?.chest !== 'function') throw new Error('Director.followActor: pass an Actor (something with chest())');
    if (mode !== 'chase' && mode !== 'orbit') throw new Error(`Director.followActor: mode is 'chase' or 'orbit', not '${mode}'`);
    this._prime();
    this.mode = 'follow';
    this.follow = { actor, dist, height, shoulder, aim, lens, mode, collide, radius, handheld, yaw: actor.yaw ?? 0, pitch: degToRad(pitch), minPitch: degToRad(minPitch), maxPitch: degToRad(maxPitch) };
    this.lens.focal = lens / 1000; this.lens.aperture = 4;
    if (snap) {
      this._solveFollow(this.follow, this.to);
      if (finite(this.to)) { copyPose(this.cur, this.to); this.cur.fov = vfov(lens); this.cur.roll = 0; this._apply(0); }
    }
    this._focusFollow();
    return this;
  }

  /**
   * Turns the follow camera by hand, in screen terms: `right` radians to the right, `up` radians up (a mouse: `look(dx * 0.003,
   * -dy * 0.003)`; a stick: its x and -y times dt times a speed). In 'chase' mode the camera drifts back behind the actor
   * afterwards; in 'orbit' mode it stays where it was put.
   * @param {number} right  radians to the right
   * @param {number} [up]   radians up
   * @returns {this}
   */
  look(right, up = 0) {
    const F = this.follow;
    if (!F) return this;
    F.yaw = wrapPi(F.yaw - right);                   // +yaw turns toward +X, which is the camera's left when it looks along +Z
    F.pitch = Math.max(F.minPitch, Math.min(F.maxPitch, F.pitch + up));
    return this;
  }

  /** Adds an impact: the camera shakes and settles in about half a second. @param {number} [amount] 0..1.5 (0.5) @returns {this} */
  kick(amount = 0.5) { this.shake = Math.min(1.5, this.shake + amount); return this; }

  /**
   * Moves the camera on by `dt` seconds. The engine calls this through lateUpdate when the director is added to it; call it
   * yourself when you drive the loop.
   * @param {number} dt  seconds
   * @returns {this}
   */
  advance(dt) {
    this.noiseT += dt;
    if (this.mode === 'follow' && this.follow) this._updateFollow(dt);
    else if (this.mode === 'shot' && this.shot) this._updateShot(dt);
    if (this.mode !== 'manual') this._apply(dt);
    return this;
  }

  _updateShot(dt) {
    const S = this.shot;
    this.t += dt;
    this._ctx.aspect = this.camera.aspect || 16 / 9; this._ctx.bounds = this.bounds;
    solveShot(S, this.t, this.to, this._ctx);
    if (!finite(this.to)) return;                 // a subject that went missing for a frame must not take the camera with it
    if (this.blend > 0 && this.t < this.blend) {
      const k = smootherstep(this.t / this.blend, 0, 1), F = this.from, T = this.to;
      this.cur.pos.copy(F.pos).lerp(T.pos, k);
      this.cur.target.copy(F.target).lerp(T.target, k);
      this.cur.fov = F.fov + (T.fov - F.fov) * k;
      this.cur.roll = F.roll + (T.roll - F.roll) * k;
    } else {
      // a camera operator follows a moving subject with a little lag
      const k = S.move === 'track' ? 1 - Math.exp(-4 * dt) : 1;
      this.cur.pos.lerp(this.to.pos, k); this.cur.target.lerp(this.to.target, k);
      this.cur.fov = this.to.fov; this.cur.roll = this.to.roll;
    }
    this._focusShot();
  }

  /** Focuses the lens on what the shot says (`focus`, else the subject). */
  _focusShot() {
    const S = this.shot;
    const fp = pointOf(resolve(S.focus ?? S.on ?? S.at), _c) ?? (S.type === 'free' ? this.cur.target : null);
    if (fp) this.lens.focus = this.cur.pos.distanceTo(fp);
  }

  /** The follow camera's wanted pose into `out`; true when a wall pulled it in. */
  _solveFollow(F, out) {
    const a = F.actor;
    const head = a.chest(_H); head.y += F.height;
    const sy = Math.sin(F.yaw), cy = Math.cos(F.yaw), cp = Math.cos(F.pitch), sp = Math.sin(F.pitch);
    // on a sphere round the head: behind the heading, up when the pitch looks down; `left` is the actor's left (its +X at yaw 0)
    const left = _R.set(cy, 0, -sy);
    _back.set(-sy, 0, -cy);
    out.pos.copy(head).addScaledVector(_back, F.dist * cp).addScaledVector(left, -F.shoulder);
    out.pos.y -= sp * F.dist;
    out.target.copy(head).addScaledVector(_back, -F.aim * cp).addScaledVector(left, -0.2);
    out.fov = vfov(F.lens); out.roll = 0;
    const hit = F.collide && this.world ? this._pullIn(F, out.pos) : false;
    if (this.bounds) out.pos.clamp(this.bounds.min, this.bounds.max);
    return hit;
  }

  /**
   * Pulls `pos` in along the line from the actor's head if a wall is in the way, and keeps it at least 35 cm from the head, so the
   * camera is never inside the actor (squeezed against a wall, that wins over the wall). True when it moved.
   */
  _pullIn(F, pos) {
    const eye = F.actor.chest(_eye); eye.y += 0.35;
    _dirC.copy(pos).sub(eye);
    const len = _dirC.length();
    if (len < 1e-4) return false;
    _dirC.multiplyScalar(1 / len);
    const h = this.world.sphereCast(eye, _dirC, F.radius, len);
    const t = Math.max(0.35, h ? Math.min(h.t, len) : len);
    if (Math.abs(t - len) < 1e-9) return false;
    pos.copy(eye).addScaledVector(_dirC, t);
    return true;
  }

  _updateFollow(dt) {
    const F = this.follow, a = F.actor;
    if (F.mode === 'chase') F.yaw = wrapPi(F.yaw + wrapPi((a.yaw ?? F.yaw) - F.yaw) * (1 - Math.exp(-2.2 * dt)));
    this._solveFollow(F, this.to);
    if (!finite(this.to)) return;
    const kp = 1 - Math.exp(-5 * dt), kt = 1 - Math.exp(-6 * dt);
    this.cur.pos.lerp(this.to.pos, kp);
    // a wall in the way is answered at once, wherever the glide has got to; the camera drifts back out when it clears
    if (F.collide && this.world) this._pullIn(F, this.cur.pos);
    this.cur.target.lerp(this.to.target, kt);
    this.cur.fov = this.to.fov; this.cur.roll = 0;
    this._focusFollow();
  }

  /** Focuses the lens on the actor being followed. */
  _focusFollow() { this.lens.focus = this.cur.pos.distanceTo(this.follow.actor.chest(_c)); }

  /** Writes the camera: position, aim, the operator's drift, impact shake, roll and field of view. */
  _apply(dt) {
    const cam = this.camera, c = this.cur;
    if (!finite(c)) return;
    if (this.bounds) c.pos.clamp(this.bounds.min, this.bounds.max);   // a hard limit: it holds while the camera glides or blends, too
    cam.position.copy(c.pos);
    cam.lookAt(c.target);
    // handheld: the slow drift of an operator breathing, plus impact shake
    const base = this.mode === 'follow' ? (this.follow?.handheld ?? 0.15) : (this.shot?.handheld ?? 0.08);
    const hh = base + this.shake;
    if (hh > 0) {
      const n = this.noiseT;
      const rx = (Math.sin(n * 0.9) * 0.6 + Math.sin(n * 2.3 + 1.3) * 0.3 + Math.sin(n * 5.1) * 0.1 * this.shake * 4) * 0.004 * hh;
      const ry = (Math.sin(n * 0.7 + 2) * 0.6 + Math.sin(n * 1.9) * 0.3 + Math.sin(n * 6.3 + 0.5) * 0.1 * this.shake * 4) * 0.005 * hh;
      cam.rotateX(rx); cam.rotateY(ry);
    }
    if (c.roll) cam.rotateZ(c.roll);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
  }

  dispose() { this.shot = null; this.follow = null; this.engine = null; this.world = null; this.mode = 'manual'; }
}

