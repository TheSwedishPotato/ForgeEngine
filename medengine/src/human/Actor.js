/**
 * An actor: a character that is acted, not posed.
 *
 * The body plays motion-capture clips through the animation system (anim/): a locomotion state machine on layer 0 (idle, walk and
 * run blended by speed, plus jump), one-shot clips on layer 1 (a punch, a wave, over the whole body or only the upper body), and
 * the code that turns that into a performance:
 *
 *   steering   walkTo(point), turnTo(target) or move(x, z) from a controller: the actor turns toward where it goes, speeds up
 *              and slows down, and the gait follows its speed. With a physics capsule (attachCharacter) it walks on floors,
 *              slopes and stairs and is stopped by walls; without one it moves kinematically.
 *   clips      play('punch', { mask: 'upper' }) returns a promise that resolves when the clip has played; the events of the clips
 *              (footstep, hit, takeoff, land) reach `actor.on('footstep', fn)`.
 *   look-at    lookAt(target) turns neck, head and eyes to a point, an object or another actor, never twisting past what a body can.
 *   face       emote('angry'), say('Halt!') on a Human or a scan head with the 52 ARKit face units: emotions, blinks, eye darts and
 *              lip-sync (human/Face.js). Returns a promise as well.
 *   ragdoll    ragdollOn({ impulse }) hands the body to the physics world; ragdollOff() gets it up again with the get-up clip, or
 *              fades from where it lies into the state machine.
 *   props      attach(object, 'hand_r') rides a bone.
 *
 *   const actor = new Actor(humanoidOrHumanOrGltf, { clips });          // clips: { idle, walk, run, jump, punch, ... }
 *   engine.add(actor);                                                  // fixedUpdate / afterPhysics / update hooks
 *   actor.attachCharacter(engine.physics);                              // optional: collide with the level
 *   await actor.walkTo([4, 0, 2]);
 *   await actor.turnTo(enemy);
 *   actor.lookAt(enemy); actor.emote('angry');
 *   await actor.play('punch', { mask: 'upper' });
 *
 * The body is anything with the Med Engine bone names (HUMANOID_BONES: pelvis, spine_01..03, neck_01, head, eye_l, clavicle_l,
 * upperarm_l, hand_l, thigh_l, calf_l, foot_l, ball_l, ...) in a world-aligned rest pose, which is what the clips are baked for: a
 * `Humanoid`, a `Human` (MakeHuman characters), a loaded glTF scene, or any Object3D. A character faces +Z at yaw 0; `yaw` turns it
 * about +Y, so it faces (sin yaw, 0, cos yaw).
 *
 * Time: the actor moves in fixed steps (`fixedUpdate`) and is drawn between the last two steps (`update` interpolates with the
 * engine's `alpha`), so motion is smooth at any display rate. Without an Engine call `actor.step(dt)`.
 *
 * Animator layers: 0 locomotion, 1 one-shot clips (default), 2 the get-up, 3 the pose a ragdoll fades out of. Use 4 and up for your own.
 */
import { Vector3, Quaternion } from '../math/core.js';
import { Animator } from '../anim/Animator.js';
import { StateMachine, BlendTree1D } from '../anim/StateMachine.js';
import { Humanoid, HUMANOID_BONES } from '../anim/Humanoid.js';
import { RigInfo } from '../anim/Retarget.js';
import { Character } from '../physics/Character.js';
import { Ragdoll } from '../physics/Ragdoll.js';
import { Face, EMOTIONS, speechDuration } from './Face.js';
import { pointOf } from '../engine/pointOf.js';

/**
 * @import { Object3D } from '../scene/Object3D.js'
 * @import { AnimationClip } from '../anim/Clip.js'
 * @import { AssetManager } from '../assets/AssetManager.js'
 * @import { GLTFAsset } from '../assets/GLTFLoader.js'
 * @import { Engine } from '../engine/Engine.js'
 * @import { World } from '../physics/World.js'
 * @import { CharacterOptions } from '../physics/Character.js'
 * @import { RagdollOptions } from '../physics/Ragdoll.js'
 * @import { Human } from './Human.js'
 * @import { Subject, Vec3Like } from '../types.js'
 */

/**
 * What `new Actor(source, o)` takes besides the body.
 * @typedef {object} ActorOptions
 * @property {string} [name]
 * @property {Record<string, AnimationClip>} [clips]  `{ idle, walk, run, jump, getup, punch ... }`: idle and walk make the locomotion machine
 * @property {number} [radius]      capsule radius when a Character is attached (0.3 m)
 * @property {number | null} [height]  body height in metres (default: measured from the skeleton)
 * @property {number} [turnRate]    fastest turning while walking, rad/s (8)
 * @property {number | null} [walkSpeed]  m/s of the walk clip (default: measured from the clip)
 * @property {number | null} [runSpeed]   m/s of the run clip (default: measured from the clip)
 * @property {() => number} [rng]   random numbers for blinks and eye darts (Math.random; seed it for replays)
 */

/**
 * What `actor.play()` takes.
 * @typedef {object} PlayOptions
 * @property {number} [layer]     animator layer (1; layer 0 belongs to the locomotion machine)
 * @property {'upper' | 'lower' | string[] | null} [mask]  the bones the clip drives: 'upper' (spine up), 'lower' (pelvis and legs), a list of bone names (and everything below them), or null for all
 * @property {number} [fade]      seconds to fade in (0.15)
 * @property {number} [fadeOut]   seconds to fade out at the end (0.25)
 * @property {number} [speed]     playback speed (1)
 * @property {boolean} [loop]     default: the clip's own flag
 * @property {boolean} [hold]     keep the last pose instead of fading out
 * @property {((finished: boolean) => void) | null} [onEnd]  called the moment the clip is over (or replaced), in the frame it happens: a promise's
 *                                `.then` only runs when the JS stack unwinds, which a headless `engine.run()` loop never does
 */

/**
 * What an actor emits, by name. The clips name their own events (the shipped ones have footstep, hit, takeoff and land); the actor
 * adds touchdown and ragdoll. Every clip event also carries the `clip` it came from and the `weight` that clip has in the mix.
 * @typedef {object} ActorEvents
 * @property {{ foot: 'l' | 'r', position: Vector3, clip: string, weight: number }} footstep
 * @property {{ bone: string, reach: number, position: Vector3, clip: string, weight: number }} hit    a blow lands: where the fist or foot is
 * @property {{ clip: string, weight: number }} takeoff
 * @property {{ clip: string, weight: number }} land
 * @property {{ speed: number }} touchdown                       the capsule reached the ground (m/s)
 * @property {{ on: boolean }} ragdoll                           the body was handed to the physics world, or taken back
 */

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const BONE_NAMES = new Set(HUMANOID_BONES.map(([n]) => n));
const LOOK_BONES = ['neck_01', 'head', 'eye_l', 'eye_r'];
const _t = new Vector3(), _hp = new Vector3(), _d = new Vector3(), _dw = new Vector3(), _dl = new Vector3(), _f = new Vector3(), _e = new Vector3(), _ww = new Vector3();
const _q = new Quaternion(), _pw = new Quaternion(), _bw = new Quaternion(), _rq = new Quaternion(), _rqi = new Quaternion(), _id = new Quaternion(), _qa = new Quaternion(), _qb = new Quaternion();
const UP = new Vector3(0, 1, 0), DOWN = new Vector3(0, -1, 0), X = new Vector3(1, 0, 0), FWD = new Vector3(0, 0, 1);

/**
 * Horizontal speed (m/s) a clip carries its root at: net travel of the root bone over the clip's duration.
 * @param {AnimationClip} clip
 * @returns {number}
 */
export function clipSpeed(clip) { return clip.duration > 0 ? clip.rootTravel / clip.duration : 0; }

/**
 * Loads a folder of baked clips described by its manifest.json (see `bake:anim`): `{ idle, walk, run, jump, punch, ... }`.
 * @param {AssetManager} assets
 * @param {string} dir   e.g. 'assets/anim/humanoid'
 * @param {string[] | null} [names]  only these
 * @returns {Promise<Record<string, AnimationClip>>}
 */
export async function loadClipLibrary(assets, dir, names = null) {
  const root = dir.replace(/\/+$/, '');
  const manifest = await assets.json(`${root}/manifest.json`);
  const out = {};
  await Promise.all(Object.entries(manifest.clips).filter(([n]) => !names || names.includes(n)).map(async ([n, c]) => {
    const clip = await assets.clip(`${root}/${c.file}`);
    clip.name = n;
    out[n] = clip;
  }));
  return out;
}

function bodyOf(src) {
  let root, bones = {}, human = null, rig = null;
  if (src?.root?.isObject3D && src.bones && src.face && src.unitIndex) { human = src; root = src.root; bones = { ...src.bones }; rig = src.rig ?? null; }   // Human, attachScanHead
  else if (src?.root?.isObject3D && src.bones) { root = src.root; bones = { ...src.bones }; rig = src.rig ?? null; }                                  // Humanoid
  else if (src?.scene?.isObject3D) root = src.scene;                                                                                                   // a loaded glTF
  else if (src?.isObject3D) root = src;
  else throw new Error('Actor: expected a Human, a Humanoid, a loaded glTF or an Object3D with a humanoid skeleton');
  if (!Object.keys(bones).length) root.traverse((o) => { if (BONE_NAMES.has(o.name)) bones[o.name] = o; });
  for (const need of ['pelvis', 'head']) {
    if (!bones[need]) throw new Error(`Actor: the skeleton has no '${need}' bone (found: ${Object.keys(bones).slice(0, 8).join(', ') || 'none'}). Name the bones like HUMANOID_BONES, or bake the clips for this rig.`);
  }
  return { root, bones, human, rig };
}

function safeRig(root) {
  try { const r = RigInfo.fromObject3D(root); return r.bones.length ? r : null; } catch { return null; }
}

export class Actor {
  /**
   * @param {Human | Humanoid | GLTFAsset | Object3D} source  the body: anything with the Med Engine bone names
   * @param {ActorOptions} [o]
   */
  constructor(source, { name, clips = {}, radius = 0.3, height = null, turnRate = 8, walkSpeed = null, runSpeed = null, rng = Math.random } = {}) {
    const { root, bones, human, rig } = bodyOf(source);
    /** The object that holds the whole body: its position and yaw are the actor's. @type {Object3D} */
    this.root = root;
    /** The skeleton's bones by name (pelvis, spine_01, head, hand_r ...). @type {Record<string, Object3D>} */
    this.bones = bones;
    /** The packed human behind this actor (face, hair, clothes), or null. @type {Human | null} */
    this.human = human;
    /** @type {string} */
    this.name = name ?? human?.name ?? (root.name || 'actor');
    root.updateMatrixWorld(true);
    const headW = bones.head.getWorldPosition(new Vector3()), rootW = root.getWorldPosition(new Vector3());
    /** Body height in metres. */
    this.height = height ?? Math.max(0.5, (headW.y - rootW.y) * 1.09);
    /** Capsule radius in metres. */
    this.radius = radius;
    /** Fastest turning while walking, rad/s. */
    this.turnRate = turnRate;
    /** The skeleton's rest pose (what mocap is retargeted onto), or null when the bones are not real Bones. @type {RigInfo | null} */
    this.rig = rig ?? (Object.values(bones).every((b) => b.isBone) ? safeRig(root) : null);
    /** Heading in radians about +Y (0: facing +Z). @type {number} */
    this.yaw = root.rotation.y;
    /** Horizontal speed the actor is moving at (m/s). */
    this.speed = 0;
    /** The actor's own clock, seconds (it stops while the engine is paused). */
    this.time = 0;
    this.visible = true;
    /** The clips this actor can play, by name. @type {Record<string, AnimationClip>} */
    this.clips = { ...clips };
    /** Is the actor held still (getting up)? Steering resumes afterwards. */
    this.locked = false;
    // The animator takes the bones' current transforms as the rest pose: do it now, while the character is at rest.
    /** The animation mixer: layers, masks, clip events. */
    this.animator = new Animator(root);
    this.animator.registerBones(Object.keys(bones));
    this.animator.onEvent = (n, d, a) => this._onClipEvent(n, d, a);
    this._rest = Object.values(bones).map((b) => ({ b, p: b.position.clone(), q: b.quaternion.clone() }));
    // The forward axis of the bones that look: the character's +Z at rest, in each bone's own frame.
    const fwd = FWD.clone().applyQuaternion(root.getWorldQuaternion(new Quaternion()));
    this._fwdLocal = {};
    for (const n of LOOK_BONES) if (bones[n]) this._fwdLocal[n] = fwd.clone().applyQuaternion(bones[n].getWorldQuaternion(new Quaternion()).invert());
    /** The locomotion machine on layer 0 (null until idle and walk clips are known). @type {StateMachine | null} */
    this.machine = null;
    /** Metres per second of the walk clip, and of the run clip (null without one). @type {number | null} */
    this.walkSpeed = walkSpeed; this.runSpeed = runSpeed;
    /** The physics capsule (see attachCharacter), or null. @type {Character | null} */
    this.character = null;
    /** The ragdoll (built by enableRagdoll or the first ragdollOn), or null. @type {Ragdoll | null} */
    this.ragdoll = null;
    /** True while the body belongs to the physics world. */
    this.ragdollActive = false;
    /** The engine this actor was added to, or null. @type {Engine | null} */
    this.engine = null; this._world = null;
    this.gaze = { eyeOffset: [0, 0] };
    /** The face (emotions, blinks, lip-sync), or null on a body without one. @type {Face | null} */
    this.face = human ? new Face(human, this.gaze, { rng }) : null;
    /** What the actor is looking at (see lookAt). @type {Subject | null} */
    this.lookTarget = null; this.lookW = 0; this.lookWTarget = 0;
    this._gaze = FWD.clone(); this._gazeVel = new Vector3();   // look direction (a critically damped spring), in the body's frame
    this._walk = null; this._turn = null; this._wish = null; this._speech = null;
    this._shots = new Map(); this._listeners = new Map(); this._attached = []; this._timers = [];
    this._lie = new WeakMap();
    this._jump = null;
    this._prevPos = root.position.clone(); this._curPos = root.position.clone();
    this._written = root.position.clone(); this._writtenYaw = this.yaw;
    this._prevYaw = this.yaw; this._curYaw = this.yaw;
    this._move = 0;                                         // measured horizontal speed of the last fixed step
    this._landed = 0;
    if (clips.idle && clips.walk) this.setLocomotion(clips);
  }

  /**
   * A mannequin actor (tests, demos, prototypes): `Actor.mannequin({ height, color, clips })`. Takes the options of the constructor too.
   * @param {ActorOptions & { color?: number }} [o]  `color` is the mannequin's 0xRRGGBB
   * @returns {Actor}
   */
  static mannequin({ height = 1.75, color = 0xd9d3c7, name = 'mannequin', ...o } = {}) {
    const h = new Humanoid({ height, name });
    h.buildMannequin({ color });
    return new Actor(h, { height, name, ...o });
  }

  /**
   * Loads a glTF character and makes an actor of a private copy of it (so several actors can share one file). The file's animations
   * join the clips.
   * @param {Engine} engine
   * @param {string} url
   * @param {ActorOptions} [o]
   * @returns {Promise<Actor>}
   */
  static async load(engine, url, o = {}) {
    const gltf = await engine.assets.model(url);
    const actor = new Actor(engine.assets.instantiate(gltf), o);
    for (const c of gltf.animations ?? []) actor.clips[c.name] ??= c;
    return actor;
  }

  /** Where the actor stands (its root's position: write to it, or use place()). @returns {Vector3} */
  get position() { return this.root.position; }
  /** Name of the locomotion state ('idle', 'move', 'jump'), or null without a locomotion machine. @returns {string | null} */
  get state() { return this.machine?.state ?? null; }
  /** Standing on something? (Always true without a physics capsule.) @returns {boolean} */
  get grounded() { return this.character ? this.character.grounded : true; }
  /** How tense the face is, 0 calm .. 1 extreme: faster blinks, smaller eye darts. */
  get tension() { return this.face?.tension ?? 0; }
  set tension(v) { if (this.face) this.face.tension = v; }

  // ----------------------------------------------------------------------------------------------- engine hooks
  /** @param {Engine} engine */
  onAdd(engine) {
    this.engine = engine;
    if (!this.root.parent) engine.scene.add(this.root);
  }
  onRemove() { this.engine = null; }

  /**
   * One whole step without an Engine: fixed update, physics results and the per-frame update, with no interpolation.
   * @param {number} dt
   * @returns {this}
   */
  step(dt) { this.fixedUpdate(dt); this.afterPhysics(dt); this.update(dt, 1); return this; }

  // ----------------------------------------------------------------------------------------------- locomotion
  /**
   * Builds the locomotion state machine from clips: `{ idle, walk, run?, jump? }`. Called by the constructor when idle and walk
   * are given. Walk and run speeds come from the clips unless the actor was created with `walkSpeed` / `runSpeed`.
   * @param {Record<string, AnimationClip>} [clips]
   * @returns {StateMachine}
   */
  setLocomotion(clips = this.clips) {
    const { idle, walk, run, jump } = clips;
    if (!idle || !walk) throw new Error('Actor.setLocomotion: needs at least an idle and a walk clip');
    Object.assign(this.clips, clips);
    const ws = this.walkSpeed ?? (clipSpeed(walk) || 1.4), rs = run ? (this.runSpeed ?? (clipSpeed(run) || 3.5)) : 0;
    this.walkSpeed = ws; this.runSpeed = rs || null;
    const sm = this.machine = new StateMachine(this.animator, { layer: 0 });
    const children = [{ clip: idle, threshold: 0 }, { clip: walk, threshold: ws }];
    if (run) children.push({ clip: run, threshold: rs });
    sm.addState('idle', idle);
    sm.addState('move', new BlendTree1D({ param: 'speed', children }));
    sm.addTransition('idle', 'move', { when: 'speed > 0.15', duration: 0.2 });
    sm.addTransition('move', 'idle', { when: 'speed <= 0.1', duration: 0.25 });
    if (jump) {
      // The clip crouches, takes off at its 'takeoff' event and lands at its 'land' event. A physics jump leaves the ground at once,
      // so the clip starts shortly before its take-off and plays as fast as the flight lasts (see jump()).
      const at = (n) => jump.events.find((e) => e.name === n)?.time;
      const tTake = at('takeoff'), tLand = at('land');
      this._jump = { tTake, tLand };
      sm.addState('jump', jump, { loop: false, tag: 'air' });
      sm.addTransition('*', 'jump', { when: 'jump', duration: 0.1, offset: tTake !== undefined ? Math.max(0, (tTake - 0.15) / jump.duration) : 0 });
      const exit = tLand !== undefined ? Math.min(0.95, (tLand + 0.12) / jump.duration) : 0.85;
      sm.addTransition('jump', 'move', { when: 'speed > 0.15', exitTime: exit, duration: 0.2 });
      sm.addTransition('jump', 'idle', { when: 'speed <= 0.15', exitTime: exit, duration: 0.2 });
    }
    sm.set('speed', 0);
    return sm;
  }

  /**
   * Puts the actor somewhere (and turns it): no motion in between. `p`: a point, `yawDeg`: heading in degrees.
   * @param {Subject} p
   * @param {number} [yawDeg]  default: keep the heading
   * @returns {this}
   */
  place(p, yawDeg = (this.yaw * 180) / Math.PI) {
    if (!pointOf(p, _t)) throw new Error('Actor.place: expected a point: [x, y, z], a Vector3, an object or an actor');
    this.root.position.copy(_t);
    this.yaw = (yawDeg * Math.PI) / 180;
    this.root.rotation.set(0, this.yaw, 0);
    this._cancelWalk(false);
    if (this.character) { this.character.teleport(this.root.position); this.character.snapToGround(0.5); this.root.position.copy(this.character.position); }
    this._prevPos.copy(this.root.position); this._curPos.copy(this.root.position);
    this._written.copy(this.root.position); this._writtenYaw = this.yaw;
    this._prevYaw = this._curYaw = this.yaw;
    this.speed = 0; this._move = 0;
    this.root.updateMatrixWorld(true);
    return this;
  }

  /**
   * Walks (or runs) to a point on the ground; resolves `true` on arrival, `false` if something else was asked of the actor first.
   * @param {Subject} p
   * @param {{ speed?: number | null, run?: boolean, stopDist?: number }} [o]  `speed` m/s (default: the walk or run clip's), `run`: use the run speed, `stopDist`: how close counts as there, metres (0.05)
   * @returns {Promise<boolean>}
   */
  walkTo(p, { speed = null, run = false, stopDist = 0.05 } = {}) {
    if (!pointOf(p, _t)) throw new Error('Actor.walkTo: expected a point: [x, y, z], a Vector3, an object or an actor');
    const v = speed ?? (run ? Math.max(this.runSpeed ?? 3.5, 3) : (this.walkSpeed ?? 1.4));
    const tx = _t.x, tz = _t.z;
    return new Promise((resolve) => {
      this._cancelWalk(false);
      this._wish = null;
      this._walk = { target: new Vector3(tx, 0, tz), speed: v, stopDist, resolve };
    });
  }

  /**
   * Free control (a gamepad stick or keys): the desired horizontal velocity in world m/s. `move(null)` or (0, 0) stops.
   * @param {number | null} x
   * @param {number} [z]
   * @returns {this}
   */
  move(x, z) {
    if (x === null) { this._wish = null; return this; }
    this._cancelWalk(false);
    (this._wish ??= new Vector3()).set(x, 0, z);
    return this;
  }

  /** Stops walking and free control (the actor slows to a halt). @returns {this} */
  stop() { this._cancelWalk(false); this._wish = null; return this; }

  _cancelWalk(done) { const w = this._walk; if (w) { this._walk = null; w.resolve(done); } }

  /**
   * Turns to face a point, an object, an actor, or a heading in degrees, easing over `dur` seconds. Resolves `true` when done.
   * @param {Subject | number} t  a heading in degrees (0: toward +Z), or something to face
   * @param {number} [dur]        seconds (0.6)
   * @returns {Promise<boolean>}
   */
  turnTo(t, dur = 0.6) {
    let target;
    if (typeof t === 'number') target = (t * Math.PI) / 180;
    else { const p = pointOf(t, new Vector3()); if (!p) throw new Error('Actor.turnTo: expected a point, an object, an actor or a heading in degrees'); target = Math.atan2(p.x - this._curPos.x, p.z - this._curPos.z); }
    const d = wrap(target - this.yaw);
    return new Promise((resolve) => {
      this._turn?.resolve(false);
      this._turn = { from: this.yaw, d, t: 0, dur: Math.max(1e-3, dur), resolve };
    });
  }

  /**
   * Starts a jump with the given take-off speed (m/s). With a Character the capsule leaves the ground; the jump clip plays either
   * way. Returns false if the actor is not on the ground (or is a ragdoll).
   * @param {number} [speed]  take-off speed in m/s (4.4: about 1 m high)
   * @returns {boolean}
   */
  jump(speed = 4.4) {
    if (this.ragdollActive || this.locked) return false;
    if (this.character && !this.character.jump(speed)) return false;
    const st = this.machine?.states.get('jump');
    if (st) {
      const g = Math.abs(this._world?.gravity?.y ?? -9.81), J = this._jump;
      const flight = (2 * speed) / g;
      st.speed = J.tTake !== undefined && J.tLand !== undefined ? clamp((J.tLand - J.tTake) / flight, 0.5, 1.6) : 1;
      this.machine.trigger('jump');
    }
    return true;
  }

  // ----------------------------------------------------------------------------------------------- physics
  /**
   * Gives the actor a kinematic capsule in `world` (`engine.physics`): it walks on the level, steps up stairs, slides along
   * walls and pushes loose bodies. Returns the Character (jump(), grounded, landingSpeed, ...).
   * @param {World} world
   * @param {CharacterOptions} [o]
   * @returns {Character}
   */
  attachCharacter(world, o = {}) {
    if (this.character) return this.character;
    const ch = new Character(world, { radius: this.radius, height: this.height, ...o, position: this.root.position });
    world.addCharacter(ch);
    ch.snapToGround(0.5);
    this.character = ch; this._world = world;
    this._prevPos.copy(ch.position); this._curPos.copy(ch.position);
    return ch;
  }

  /**
   * Builds the ragdoll for this body (once). Call it when the level loads if the first knock-down should carry the limbs' motion;
   * ragdollOn() calls it when needed.
   * @param {World} [world]  default: the one the character is in, or the engine's
   * @param {RagdollOptions} [o]
   * @returns {Ragdoll}
   */
  enableRagdoll(world = this._world ?? this.engine?.physics, o = {}) {
    if (!world) throw new Error('Actor.enableRagdoll: needs a physics world (attachCharacter first, or pass engine.physics)');
    if (!this.ragdoll) {
      // the ragdoll measures the body in its rest pose
      const now = this._rest.map(({ b }) => ({ b, p: b.position.clone(), q: b.quaternion.clone() }));
      for (const r of this._rest) { r.b.position.copy(r.p); r.b.quaternion.copy(r.q); }
      this.root.updateMatrixWorld(true);
      this.ragdoll = new Ragdoll({ root: this.root, bones: this.bones }, world, o);
      for (const s of now) { s.b.position.copy(s.p); s.b.quaternion.copy(s.q); }
      this.root.updateMatrixWorld(true);
      this._world = world;
    }
    return this.ragdoll;
  }

  /**
   * Hands the body to the physics world. `velocity` (m/s) defaults to the capsule's; `impulse: { point, vector }` (N*s) is a hit.
   * While the ragdoll is active the animation and steering are suspended.
   * @param {{ velocity?: Vec3Like | null, impulse?: { point: Vec3Like, vector: Vec3Like } | null }} [o]
   * @returns {this}
   */
  ragdollOn({ velocity = null, impulse = null } = {}) {
    if (this.ragdollActive) return this;
    const rd = this.enableRagdoll();
    this.root.updateMatrixWorld(true);
    this._cancelWalk(false); this._turn?.resolve(false); this._turn = null; this._wish = null;
    for (const s of this._shots.values()) s.resolve(false);
    this._shots.clear();
    const v = velocity ?? (this.character ? this.character.velocity.clone() : new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(this.speed));
    if (this.character) this.character.body.enabled = false;
    rd.activate({ velocity: v, impulse });
    this.ragdollActive = true;
    this._emit('ragdoll', { on: true });
    return this;
  }

  /**
   * Takes the body back from the physics world and gets it up: the root moves under the pelvis, turns so that the clips' lying
   * posture lies the way the body does, and the `getup` clip (lying face down; `getupBack` for face up) plays from the pose the
   * ragdoll ended in. Without a get-up clip for the way the body lies (`getupBack`, face up, is not shipped) the pose fades into the
   * state machine instead: over `fade` seconds, 1.2 s by default when the body is lying down (a rise), 0.35 s when it is not.
   * Resolves `true` when the actor is on its feet (steering is held until then), `false` if something else was asked of it first.
   * @param {{ fade?: number | null, getUp?: boolean }} [o]  `fade`: seconds of the fade into the state machine when there is no get-up clip; `getUp: false` skips the get-up clip
   * @returns {Promise<boolean>}
   */
  ragdollOff({ fade = null, getUp = true } = {}) {
    if (!this.ragdollActive) return Promise.resolve(false);
    const rd = this.ragdoll, pelvis = this.bones.pelvis, root = this.root;
    root.updateMatrixWorld(true);
    const pw = pelvis.getWorldPosition(new Vector3()), qw = pelvis.getWorldQuaternion(new Quaternion());
    const lying = rd.lying();
    rd.deactivate();
    this.ragdollActive = false;
    const clip = getUp ? (lying.faceUp ? this.clips.getupBack : this.clips.getup) : null;
    // heading: turn the root so that the way the clip lies at its first frame is the way the body lies
    let yaw = root.rotation.y;
    const lie = clip ? this._lyingDirection(clip) : null;
    if (lie) yaw = Math.atan2(lying.direction.x, lying.direction.z) - Math.atan2(lie.x, lie.z);
    // the ground under the pelvis
    let floor = root.position.y;
    if (this._world) {
      const hit = this._world.raycast(_t.set(pw.x, pw.y + 0.5, pw.z), DOWN, 4, { ignore: this.character?.body ?? null });
      if (hit) floor = hit.point.y;
    }
    root.position.set(pw.x, floor, pw.z);
    root.rotation.set(0, yaw, 0);
    root.updateMatrixWorld(true);
    fade ??= !clip && pw.y - floor < 0.45 ? 1.2 : 0.35;
    // the pelvis keeps its place in the world under the moved root; everything below it follows
    const par = pelvis.parent ?? root;
    par.getWorldQuaternion(_pw);
    pelvis.quaternion.copy(_pw.invert().multiply(qw));
    pelvis.position.copy(par.worldToLocal(pw.clone()));
    root.updateMatrixWorld(true);
    this.yaw = this._prevYaw = this._curYaw = yaw;
    this._prevPos.copy(root.position); this._curPos.copy(root.position);
    this._written.copy(root.position); this._writtenYaw = root.rotation.y;
    this.speed = 0; this._move = 0; this._landed = 0;
    if (this.character) { this.character.teleport(root.position); this.character.body.enabled = true; }
    this.machine?.set('speed', 0);
    // continuity: the pose where the body lay fades out over the animation
    const a = this.animator.play(rd.snapshotClip(), { layer: 3, fade: 0, loop: true });
    a.fadeTo(0, Math.max(0.05, fade));
    this._emit('ragdoll', { on: false });
    if (!clip) return this._after(fade);
    this.locked = true;
    return this.play(clip, { layer: 2, fade: Math.min(0.2, fade), fadeOut: 0.4, onEnd: () => { this.locked = false; } });
  }

  /** Which way (unit vector in the body's frame) the head lies from the pelvis at the first frame of a clip; null for a standing clip. */
  _lyingDirection(clip) {
    let c = this._lie.get(clip);
    if (c !== undefined) return c;
    c = null;
    const rig = this.rig;
    if (rig && rig.has('head') && rig.has('pelvis')) {
      const pose = rig.sample(clip, 0), h = pose.p[rig.index.get('head')], p = pose.p[rig.index.get('pelvis')];
      const d = new Vector3(h.x - p.x, 0, h.z - p.z);
      if (d.length() > 0.2) c = d.normalize();
    }
    this._lie.set(clip, c);
    return c;
  }

  // ----------------------------------------------------------------------------------------------- clips
  /** Adds clips by name: `actor.addClips({ punch, kick })`. @param {Record<string, AnimationClip>} map @returns {this} */
  addClips(map) { Object.assign(this.clips, map); return this; }

  _clip(c) {
    const clip = typeof c === 'string' ? this.clips[c] : c;
    if (!clip) throw new Error(`Actor.play: no clip '${c}' (have: ${Object.keys(this.clips).join(', ') || 'none'})`);
    return clip;
  }

  /**
   * Plays a clip over the locomotion and returns a promise: `true` when it has played to its end, `false` if it was replaced or
   * stopped. A looping clip plays until stopped.
   * @param {string | AnimationClip} c  a clip, or the name of one of `actor.clips`
   * @param {PlayOptions} [o]
   * @returns {Promise<boolean>}
   */
  play(c, { layer = 1, mask = null, fade = 0.15, fadeOut = 0.25, speed = 1, loop, hold = false, onEnd = null } = {}) {
    if (layer === 0 && this.machine) throw new Error('Actor.play: layer 0 belongs to the locomotion machine; use layer 1 or higher');
    const clip = this._clip(c);
    const L = this.animator.layer(layer);
    if (mask === 'upper') L.setMask(['spine_01', 'clavicle_l', 'clavicle_r'], { children: true });
    else if (mask === 'lower') L.setMaskExcept(['spine_01'], { children: true });
    else if (Array.isArray(mask)) L.setMask(mask, { children: true });
    else L.setMask(null);
    this._shots.get(layer)?.resolve(false);
    const action = this.animator.play(clip, { layer, fade, loop, speed, restart: true });
    return new Promise((resolve) => this._shots.set(layer, { action, resolve: (ok) => { onEnd?.(ok); resolve(ok); }, fadeOut, hold, loop: action.loop }));
  }

  /** Fades out whatever `play()` is doing on a layer (its promise resolves `false`). @param {number} [layer] @param {number} [fade] seconds @returns {this} */
  stopClip(layer = 1, fade = 0.2) {
    const s = this._shots.get(layer);
    this._shots.delete(layer);
    this.animator.stop(layer, fade);
    s?.resolve(false);
    return this;
  }

  /** Is a one-shot clip playing on this layer? @param {number} [layer] @returns {boolean} */
  isPlaying(layer = 1) { return this._shots.has(layer); }

  // ----------------------------------------------------------------------------------------------- events
  /**
   * Subscribes to events. Clip events arrive under the names the clips give them: 'footstep' ({ foot: 'l'|'r', position }), 'hit'
   * ({ bone, reach, position }), 'takeoff', 'land'; each also carries `clip` (its name) and `weight`. The actor adds 'touchdown'
   * ({ speed }: the capsule reached the ground) and 'ragdoll' ({ on }). Returns the unsubscribe function.
   * @template {string} K
   * @param {K} type
   * @param {(data: K extends keyof ActorEvents ? ActorEvents[K] : any, actor: Actor) => void} fn
   * @returns {() => void}
   */
  on(type, fn) {
    let s = this._listeners.get(type);
    if (!s) this._listeners.set(type, s = new Set());
    s.add(fn);
    return () => s.delete(fn);
  }
  _emit(type, data) { const s = this._listeners.get(type); if (s) for (const f of [...s]) f(data, this); }

  _onClipEvent(name, data, action) {
    const s = this._listeners.get(name);
    if (!s || !s.size) return;
    // a clip that is fading out of a blend still steps through its events; only the clip that is most visible counts, once
    const w = (action?.weight ?? 1) * (action?.layer?.weight ?? 1);
    if (w < 0.2 || !this._dominant(action, name)) return;
    const out = { ...(data ?? {}), clip: action?.clip?.name, weight: w };
    const bone = data?.foot ? this.bones[`foot_${data.foot}`] : data?.bone ? this.bones[data.bone] : null;
    if (bone) out.position = bone.getWorldPosition(new Vector3());
    this._emit(name, out);
  }

  /** Among the playing clips of one layer that carry this event, is `action` the one with the most weight (the first, on a tie)? */
  _dominant(action, name) {
    const acts = action.layer.actions;
    const mine = acts.indexOf(action);
    for (let i = 0; i < acts.length; i++) {
      const o = acts[i];
      if (o === action || o.weight <= 0.0005 || !o.clip.events.some((e) => e.name === name)) continue;
      if (o.weight > action.weight + 1e-6 || (Math.abs(o.weight - action.weight) <= 1e-6 && i < mine)) return false;
    }
    return true;
  }

  // ----------------------------------------------------------------------------------------------- performance
  /**
   * Looks at an actor, a point, an object or a function returning one (`null` to look ahead again); `weight` 0..1 is how much of
   * the head turn is used. The neck, head and eyes turn toward it as far as a body can and ease back when the target is behind.
   * @param {Subject | null} t
   * @param {number} [weight]
   * @returns {this}
   */
  lookAt(t, weight = 1) {
    if (t) { this.lookTarget = t; this.lookWTarget = weight; }
    else this.lookWTarget = 0;                              // the head eases back; the target is dropped once it has
    return this;
  }

  /** Sets the facial expression (a name of human/Face.js EMOTIONS) at an intensity 0..1. Needs a Human or scan head to show. @param {string} name @param {number} [intensity] @returns {this} */
  emote(name, intensity = 1) {
    if (!(name in EMOTIONS)) throw new Error(`Actor.emote: unknown emotion '${name}' (have: ${Object.keys(EMOTIONS).join(', ')})`);
    this.face?.setEmotion(name, intensity);
    return this;
  }

  /**
   * Speaks a line: lip-sync on the face, and a promise that resolves `true` when the line is over (`false` if cut off). The
   * promise has the line's `duration` in seconds. Works without a face too (the promise still resolves on time).
   * @param {string} text
   * @param {{ emotion?: string, duration?: number, amp?: number }} [o]  `emotion`: an emotion to show while speaking; `duration`: seconds (default: estimated from the text); `amp`: mouth movement, 1 normal
   * @returns {Promise<boolean> & { duration: number }}
   */
  say(text, { emotion, duration, amp = 1 } = {}) {
    if (emotion) this.emote(emotion);
    const dur = duration ?? speechDuration(text);
    this.face?.say(text, dur, amp);
    this._speech?.resolve(false);
    const p = new Promise((resolve) => { this._speech = { t: 0, dur, resolve }; });
    return Object.assign(p, { duration: dur });
  }
  /** Cuts off the line being spoken (its promise resolves `false`). @returns {this} */
  stopSpeaking() { this.face?.stopSpeaking(); const s = this._speech; this._speech = null; s?.resolve(false); return this; }

  /**
   * Ties an object to a bone (a sword in the hand, a hat on the head). Offsets are in the bone's frame: `position: [x, y, z]` m, `rotation: [x, y, z]` radians, `scale`.
   * @template {Object3D} T
   * @param {T} object
   * @param {string} [boneName]  one of `actor.bones` (default 'hand_r')
   * @param {{ position?: Vec3Like | null, rotation?: [number, number, number] | null, scale?: number | null }} [o]  `scale` is uniform
   * @returns {T}
   */
  attach(object, boneName = 'hand_r', { position = null, rotation = null, scale = null } = {}) {
    const bone = this.bones[boneName];
    if (!bone) throw new Error(`Actor.attach: no bone '${boneName}'`);
    object.removeFromParent();
    if (position) object.position.set(position[0] ?? position.x ?? 0, position[1] ?? position.y ?? 0, position[2] ?? position.z ?? 0);
    if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
    if (scale) object.scale.setScalar(scale);
    bone.add(object);
    this._attached.push(object);
    return object;
  }
  /** Takes an attached object off its bone. @template {Object3D} T @param {T} object @returns {T} */
  detach(object) { object.removeFromParent(); const i = this._attached.indexOf(object); if (i >= 0) this._attached.splice(i, 1); return object; }

  /** World position between the eyes (for framing and eye lines). @param {Vector3} [out] @returns {Vector3} */
  eyes(out = new Vector3()) {
    const l = this.bones.eye_l, r = this.bones.eye_r;
    if (!l || !r) {
      const k = (0.08 * this.height) / 1.75, y = this.root.rotation.y;
      return this.bones.head.getWorldPosition(out).add(_e.set(Math.sin(y) * k, k, Math.cos(y) * k));
    }
    l.getWorldPosition(out); r.getWorldPosition(_e);
    return out.add(_e).multiplyScalar(0.5);
  }
  /** World position of a bone. @param {string} name  one of `actor.bones` @param {Vector3} [out] @returns {Vector3} */
  bone(name, out = new Vector3()) { return this.bones[name].getWorldPosition(out); }
  /** World position of the middle of the chest. @param {Vector3} [out] @returns {Vector3} */
  chest(out = new Vector3()) { return (this.bones.spine_03 ?? this.bones.spine_02 ?? this.bones.pelvis).getWorldPosition(out); }
  /** Unit vector the actor faces (the visible heading). @param {Vector3} [out] @returns {Vector3} */
  forward(out = new Vector3()) { const y = this.root.rotation.y; return out.set(Math.sin(y), 0, Math.cos(y)); }

  /** Shows or hides the whole body. @param {boolean} v @returns {this} */
  setVisible(v) { this.visible = v; this.root.visible = v; return this; }

  /** A promise that resolves after `seconds` of the actor's own time (it stops while the engine is paused). */
  _after(seconds) { return new Promise((resolve) => this._timers.push({ t: seconds, resolve })); }

  // ----------------------------------------------------------------------------------------------- the loop
  /** Engine hook: steering and the capsule, at the fixed rate. @param {number} dt */
  fixedUpdate(dt) {
    if (this.ragdollActive || !(dt > 0)) return;
    this._prevPos.copy(this._curPos); this._prevYaw = this._curYaw;
    this._steer(dt);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (this.character) {
      const ch = this.character;
      ch.update(dt, _ww.set(sy * this.speed, 0, cy * this.speed));
      this._curPos.copy(ch.position);
      if (ch.justLanded) { this._landed = 0.2; this._emit('touchdown', { speed: ch.landingSpeed }); }
    } else {
      this._curPos.x += sy * this.speed * dt; this._curPos.z += cy * this.speed * dt;
    }
    this._curYaw = this.yaw;
    const moved = Math.hypot(this._curPos.x - this._prevPos.x, this._curPos.z - this._prevPos.z) / dt;
    this._move += (moved - this._move) * Math.min(1, dt * 12);
  }

  /** Turning, destination, free control and the speed ramp for one fixed step. */
  _steer(dt) {
    let target = 0;
    if (!this.locked) {
      if (this._turn) {
        const T = this._turn; T.t += dt;
        const k = Math.min(1, T.t / T.dur), e = k * k * (3 - 2 * k);
        this.yaw = T.from + T.d * e;
        if (T.t >= T.dur) { this._turn = null; T.resolve(true); }
      }
      const W = this._walk;
      if (W) {
        const dx = W.target.x - this._curPos.x, dz = W.target.z - this._curPos.z, dist = Math.hypot(dx, dz);
        if (dist < W.stopDist + this.speed * 0.12) { this._walk = null; W.resolve(true); }
        else {
          const d = wrap(Math.atan2(dx, dz) - this.yaw);
          this.yaw += clamp(d, -dt * this.turnRate, dt * this.turnRate);
          target = Math.min(W.speed, 0.3 + dist * 1.6) * (Math.abs(d) > 1.2 ? 0.25 : 1);
        }
      } else if (this._wish) {
        const len = Math.hypot(this._wish.x, this._wish.z);
        if (len > 0.05) {
          const d = wrap(Math.atan2(this._wish.x, this._wish.z) - this.yaw);
          this.yaw += clamp(d, -dt * this.turnRate, dt * this.turnRate);
          target = len * clamp(Math.cos(d) * 1.4, 0, 1);
        }
      }
    }
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 5 : 7));
    if (target === 0 && this.speed < 0.01) this.speed = 0;
  }

  /** Engine hook: reads where the physics put the capsule. */
  afterPhysics() {
    if (this.ragdollActive) this.ragdoll.update();
  }

  /** If the game moved the root by hand (`actor.root.position.set(...)`), the actor goes there instead of snapping back. */
  _adopt() {
    const r = this.root;
    if (r.position.distanceToSquared(this._written) > 1e-8 || Math.abs(wrap(r.rotation.y - this._writtenYaw)) > 1e-5) this.place(r.position, (r.rotation.y * 180) / Math.PI);
  }

  /**
   * Per frame: draws the actor between its last two fixed steps, advances the animation, finishes one-shot clips, then applies
   * the face and the look-at on top of the animated pose.
   * @param {number} dt
   * @param {Engine|number} [e]  the engine (its `alpha` interpolates) or an alpha 0..1
   */
  update(dt, e) {
    const alpha = typeof e === 'number' ? e : (e?.alpha ?? this.engine?.alpha ?? 1);
    const root = this.root;
    this.time += dt;
    if (!this.ragdollActive) {
      this._adopt();
      root.position.lerpVectors(this._prevPos, this._curPos, alpha);
      root.rotation.y = this._prevYaw + wrap(this._curYaw - this._prevYaw) * alpha;
      this._written.copy(root.position); this._writtenYaw = root.rotation.y;
      if (this.machine) {
        // the legs follow the speed the body really has (a wall stops them), not the speed it was asked for
        const air = this.character ? !this.character.grounded && this._landed <= 0 : false;
        this.machine.set('speed', air ? 0 : Math.min(this.speed, this._move + 0.35));
        this.machine.set('grounded', !air);
      }
      this._landed = Math.max(0, this._landed - dt);
      this.animator.update(dt);
      this._finishShots();
    }
    root.updateMatrixWorld(true);
    this.face?.update(dt);
    this.human?.sync?.();
    if (!this.ragdollActive) { this._look(dt); this.ragdoll?.track(dt); }
    this._tick(dt);
  }

  _finishShots() {
    for (const [layer, s] of this._shots) {
      if (s.loop || !s.action.finished) continue;
      this._shots.delete(layer);
      if (!s.hold) this.animator.stop(layer, s.fadeOut);
      s.resolve(true);
    }
  }

  _tick(dt) {
    const sp = this._speech;
    if (sp) { sp.t += dt; if (sp.t >= sp.dur) { this._speech = null; sp.resolve(true); } }
    if (this._timers.length) {
      const due = [];
      this._timers = this._timers.filter((x) => { x.t -= dt; if (x.t <= 0) { due.push(x); return false; } return true; });
      for (const x of due) x.resolve(true);
    }
  }

  /** Neck, head and eyes toward the look target, on top of the animated pose. */
  _look(dt) {
    this.lookW += (this.lookWTarget - this.lookW) * Math.min(1, dt * 4);
    if (this.lookWTarget === 0 && this.lookW < 0.002) { this.lookW = 0; this.lookTarget = null; }
    const b = this.bones, head = b.head;
    const T = this.lookTarget && this.lookW > 0.002 ? pointOf(this.lookTarget, _t) : null;
    this.root.getWorldQuaternion(_rq); _rqi.copy(_rq).invert();
    let reach = 0, have = false;
    if (T) {
      head.getWorldPosition(_hp);
      _d.subVectors(T, _hp);
      if (_d.lengthSq() > 1e-8) {
        have = true;
        _d.normalize();
        _dl.copy(_d).applyQuaternion(_rqi);                                                 // the target's direction in the body's frame
        const off = Math.abs(Math.atan2(_dl.x, _dl.z));                                      // how far round the back of the body it is
        reach = this.lookW * clamp((2.6 - off) / 0.85, 0, 1);                              // full to ~100 degrees off the heading, nothing behind
      }
    }
    // the aim follows the target on a critically damped spring (it starts and stops gently, a target that jumps does not snap the head)
    const h = Math.min(dt, 0.05), w = have ? 9 : 7;
    if (h > 0) {
      _f.copy(have ? _dl : FWD).sub(this._gaze).multiplyScalar(w * w).addScaledVector(this._gazeVel, -2 * w);
      this._gazeVel.addScaledVector(_f, h);
      this._gaze.addScaledVector(this._gazeVel, h).normalize();
    }
    if (reach > 0.002) {
      _dw.copy(this._gaze).applyQuaternion(_rq);
      for (const [name, share, max] of [['neck_01', 0.4, 0.6], ['head', 1, 1.15]]) {
        const bone = b[name]; if (!bone) continue;
        bone.getWorldQuaternion(_bw);
        _f.copy(this._fwdLocal[name]).applyQuaternion(_bw);                                 // where this bone faces now
        _q.setFromUnitVectors(_f, _dw);
        const a = _q.angleTo(_id);
        _qa.copy(_id).slerp(_q, Math.min(share * reach, a > 1e-6 ? max / a : 1));
        this._rotateWorld(bone, _qa);
      }
    }
    // eyes: converge on the target from their own positions (up to ~30 degrees), plus the small darts of the face system
    const [ex, ey] = this.gaze.eyeOffset;
    for (const name of ['eye_l', 'eye_r']) {
      const eye = b[name]; if (!eye) continue;
      if (have && reach > 0.002) {
        eye.getWorldPosition(_hp);
        _d.subVectors(T, _hp);
        if (_d.lengthSq() > 1e-8) {
          _d.normalize();
          eye.getWorldQuaternion(_bw);
          _f.copy(this._fwdLocal[name]).applyQuaternion(_bw);
          _q.setFromUnitVectors(_f, _d);
          const a = _q.angleTo(_id);
          _qa.copy(_id).slerp(_q, Math.min(reach, a > 1e-6 ? 0.55 / a : 1));
          this._rotateWorld(eye, _qa);
        }
      }
      if (ex || ey) {
        _qa.setFromAxisAngle(UP, ex); _qb.setFromAxisAngle(X, -ey);
        eye.quaternion.multiply(_qa).multiply(_qb);
        eye.updateWorldMatrix(false, true);
      }
    }
  }

  /** Rotates a bone by a rotation given in world axes about its own joint (the bones below it follow). */
  _rotateWorld(bone, q) {
    bone.parent.getWorldQuaternion(_pw);
    bone.quaternion.premultiply(_pw).premultiply(q).premultiply(_pw.invert());
    bone.updateWorldMatrix(false, true);
  }

  // ----------------------------------------------------------------------------------------------- end
  /** Removes the actor from the scene and the physics world, and resolves every promise it still owes with `false`. */
  dispose() {
    this._cancelWalk(false); this._turn?.resolve(false); this._turn = null;
    for (const s of this._shots.values()) s.resolve(false);
    this._shots.clear();
    this._speech?.resolve(false); this._speech = null;
    for (const x of this._timers) x.resolve(false);
    this._timers.length = 0;
    this.ragdoll?.deactivate();
    if (this.character && this._world) this._world.removeCharacter(this.character);
    this.character = null;
    this.animator.stopAll(0);
    for (const o of this._attached) o.removeFromParent();
    this._attached.length = 0;
    this.root.removeFromParent();
    this.human?.dispose?.();
  }
}
