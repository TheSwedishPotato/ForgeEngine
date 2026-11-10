// A realistic piece of game code, written the way a TypeScript project using Med Engine would write it, and compiled by
// tests/types.test.js with `strict` against the generated declarations in types/. It is never run: what it proves is that
// the declarations accept the code people write and refuse the mistakes people make.
//
// Lines marked `@ts-expect-error` are mistakes. TypeScript reports a marker that has no error under it, so a declaration that
// goes too loose (an `any` where a type belongs) fails the test as surely as one that goes too strict.
import {
  Engine, Actor, Director, Vector3, Quaternion, Matrix4, Euler, Color, MathUtils,
  Mesh, BoxGeometry, PlaneGeometry, StandardMaterial, DirectionalLight, PointLight,
  World, PlaneCollider, BoxCollider, RigidBody, Character, StateMachine, Animator, AnimationClip,
  StoryRunner, InputManager, AssetManager,
} from '../../types/index.js';
import type { Shot, FollowOptions, StoryView, StoryData, ActionDef, EngineEventMap, RayHit, Subject, QualityName } from '../../types/index.js';
import { NodePlatform } from '../../types/platform/node.js';
import { Platform } from '../../types/index.js';

const story: StoryData = {
  title: 'The Ford',
  start: 'shore',
  vars: { coins: 3 },
  nodes: {
    shore: { text: 'The river is wide.', choices: [{ text: 'Pay the ferryman', if: 'coins >= 1', do: ['coins -= 1'], goto: 'across' }] },
    across: { type: 'end', ending: 'crossed', text: 'You cross.' },
  },
};

const actions: Record<string, ActionDef> = {
  jump: ['Space', 'Pad:a'],
  attack: { type: 'button', bindings: ['Mouse0', 'Pad:rt'] },
  move: { type: 'vec2', up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], stick: 'Pad:ls' },
  look: { type: 'look', mouse: 'locked', sensitivity: 0.0022, stick: 'Pad:rs', stickSpeed: 2.8 },
  zoom: { type: 'axis', positive: ['KeyE'], negative: ['KeyQ'], wheel: true },
};

export async function main(): Promise<number> {
  // ---- the engine: headless here, `new BrowserPlatform()` in a page
  const platform: Platform = new NodePlatform({ width: 640, height: 360 });
  const engine = await Engine.create({ platform, quality: 'low', physics: { gravity: new Vector3(0, -9.81, 0), substeps: 4 }, input: { deadzone: 0.2 } });
  const { scene, physics: world, input } = engine;
  const quality: QualityName = 'medium';
  engine.stage?.setQuality(quality);

  // ---- events: the listener's first argument depends on the event
  const dts: number[] = [];
  const off = engine.on('update', (dt, e) => { dts.push(dt); if (e.frame > 600) e.stop(); });
  engine.on('error', (err) => { console.error(err instanceof Error ? err.message : err); });
  const step: EngineEventMap['fixedUpdate'] = engine.fixedStep;
  off();

  // ---- the scene
  const floor = new Mesh(new PlaneGeometry(40, 40), new StandardMaterial({ color: 0x6f8f55, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const crate = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial({ color: new Color(0xb4ae9f), metalness: 0.1, emissive: 0x220000, emissiveIntensity: 2 }));
  crate.position.set(2, 0.5, -3);
  crate.castShadow = true;
  scene.add(crate);
  const sun = new DirectionalLight(0xfff2dd, 7);
  sun.position.set(5, 10, 4);
  const lamp = new PointLight(0xffb060, 14, 11);
  lamp.volumetric = 0.5;
  scene.add(sun, lamp);

  // ---- physics
  world.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  const ball = world.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.4 }, mass: 5, position: new Vector3(0, 3, 0), friction: 0.8 }));
  ball.applyImpulse(new Vector3(0, 0, 10), new Vector3(0, 3, 0));
  const barrel = new RigidBody({ shape: { type: 'capsule', radius: 0.3, length: 0.6 }, mass: 30, object: crate });
  world.addBody(barrel);
  const origin = new Vector3(0, 5, 0), down = new Vector3(0, -1, 0);
  const hit: RayHit | null = world.raycast(origin, down, 20, { bodies: false });
  if (hit) {
    const height: number = hit.point.y;
    const up: Vector3 = hit.normal;
    if (height < 0 || up.y < 0) return -1;
  }
  const clear: boolean = !world.overlapSphere(new Vector3(0, 1, 0), 0.3, { bodies: true, ignore: barrel });
  const sweep = world.sphereCast(new Vector3(0, 1.6, 4), new Vector3(0, 0, -1), 0.2, 3);
  if (sweep?.startsInside) return -2;
  const doorway = new BoxCollider({ center: new Vector3(3, 1, 0), half: new Vector3(1, 1, 0.2) });
  const seen: string[] = [];
  const trigger = world.addTrigger(doorway, { onEnter: (who) => seen.push(who instanceof Character ? 'someone walked in' : 'something rolled in'), onExit: () => seen.push('out') });
  world.removeTrigger(trigger);
  const hero = world.addCharacter(new Character(world, { position: new Vector3(0, 0, 5), radius: 0.3, height: 1.75 }));
  hero.update(1 / 60, new Vector3(0, 0, -2));
  const standing: Vector3 = hero.position;

  // ---- input
  input.map(actions);
  input.map({ pause: ['Escape'] }, 'always');
  input.setContext('default');
  const move = input.vec2('move');
  const wish = new Vector3(move.x, 0, -move.y).multiplyScalar(4);
  if (input.pressed('jump') && hero.grounded) hero.jump(4.4);
  const turn = input.look('look');
  const rebound: string[] | Record<string, string[]> = input.bindings('jump');
  input.rebind('jump', ['KeyJ']).resetBindings('attack');
  const picked: Promise<string | null> = input.captureNext();

  // ---- an actor, a camera and a shot
  const actor = engine.add(Actor.mannequin({ height: 1.8, color: 0xc9a27a, name: 'hero', radius: 0.3 }));
  actor.place(new Vector3(0, 0, 5), 180).attachCharacter(world);
  actor.on('footstep', (e) => { const foot: 'l' | 'r' = e.foot; return foot; });
  const arrived: Promise<boolean> = actor.walkTo([2, 0, -3], { run: true, stopDist: 0.1 });
  const target: Subject = actor;
  const director = engine.add(new Director(engine));
  const follow: FollowOptions = { dist: 3, height: -0.3, shoulder: 0.4, collide: true };
  director.followActor(actor, follow).look(turn.x, turn.y);
  const closeUp: Shot = { type: 'cu', on: target, angle: 25, lens: 85, move: 'push', dur: 4 };
  director.cut(closeUp, { blend: 1 }).kick(0.5);
  const clip: Promise<boolean> = actor.play('punch', { layer: 1, mask: 'upper', fade: 0.1, onEnd: (finished) => { void finished; } });

  // ---- the animation parts on their own
  const animator = new Animator(actor.root);
  const machine = new StateMachine(animator);
  const state = machine.addState('idle', new AnimationClip('idle', [], { duration: 1, loop: true }));
  state.onEnter = (m, s) => { void m.current; void s.name; };
  machine.onEvent = (name, data, action) => { void name; void data; void action.weight; };

  // ---- the story
  const runner = StoryRunner.from(story, { seed: 7 });
  runner.on('enter', (view: StoryView) => { const labels: string[] = view.choices.map((c) => c.text); void labels; });
  runner.on('meter', (m) => m.to - m.from);
  runner.on('end', (e) => e.ending);
  const first = runner.start();
  if (first.choices[0]?.enabled) runner.choose(first.choices[0].index);
  runner.load(runner.save());

  // ---- assets
  const assets: AssetManager = engine.assets;
  const loaded = await assets.loadAll({ knight: 'models/knight.glb', ground: { url: 'tex/grass.png', srgb: true } }, { onProgress: (p) => { void (p.done / p.total); } });
  void loaded;

  // ---- the math
  const m = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0, 'YXZ')), new Vector3(1, 1, 1));
  const p = new Vector3(0, 0, 1).applyMatrix4(m).add(wish).normalize();
  const mid = new Quaternion().slerp(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1), 0.5);
  const tint = new Color(0xff8040).lerp(new Color('skyblue'), 0.25);
  const clamped: number = MathUtils.clamp(p.length() * 4, 0, 1);

  // ---- mistakes the compiler has to catch
  // @ts-expect-error Engine.create needs a platform
  await Engine.create();
  // @ts-expect-error an 'update' listener gets the time step, a number
  engine.on('update', (dt: string) => dt.length);
  // @ts-expect-error there is no engine event of that name
  engine.on('explode', () => {});
  // @ts-expect-error quality is low, medium, high or ultra
  engine.stage?.setQuality('extreme');
  // @ts-expect-error a shot type is one of the film terms
  director.cut({ type: 'closeup', on: actor });
  // @ts-expect-error a rigid body is a sphere or a capsule
  new RigidBody({ shape: { type: 'cube', radius: 1 } });
  // @ts-expect-error a trigger's onEnter is a function
  world.addTrigger(doorway, { onEnter: 5 });
  // @ts-expect-error a raycast mask is a number
  world.raycast(origin, down, 10, { mask: 'all' });
  // @ts-expect-error an action is a list of bindings or an object with a type
  input.map({ jump: 5 });
  // @ts-expect-error story views have no such field
  runner.on('enter', (v) => v.nonsense);
  // @ts-expect-error a clip is named by a string or is a clip
  actor.play(5);
  // @ts-expect-error materials know their settings, so a typo is caught
  new StandardMaterial({ rougness: 0.4 });
  // @ts-expect-error a vector is made of numbers
  new Vector3('1', 2, 3);
  // @ts-expect-error an Euler order is one of the six
  new Euler(0, 0, 0, 'ABC');
  // @ts-expect-error a story needs its nodes
  StoryRunner.from({ start: 'a' });
  // @ts-expect-error a light's intensity is a number
  new PointLight(0xffffff, 'bright');

  return dts.length + step + (clear ? 1 : 0) + standing.y + (Array.isArray(rebound) ? rebound.length : 0) + clamped + mid.w + tint.r + arrived.constructor.length + clip.constructor.length + picked.constructor.length + (engine instanceof Engine ? 1 : 0) + (world instanceof World ? 1 : 0) + (input instanceof InputManager ? 1 : 0);
}
