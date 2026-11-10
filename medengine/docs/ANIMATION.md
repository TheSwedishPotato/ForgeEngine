# Animation: motion capture, clips, the state machine, actors

```
BVH capture ──retarget──► AnimationClip ──bake──► .medclip ──load──► Animator (layers, masks) ◄── StateMachine
                                                                        ▲
                                                               Actor (locomotion, play(), look-at, face, ragdoll)
```

## The skeleton

Everything is retargeted onto **one skeleton with fixed bone names** (`HUMANOID_BONES`): `pelvis`, `spine_01`..`spine_03`,
`neck_01`, `head`, `eye_l/r`, `clavicle_l/r`, `upperarm_l/r`, `lowerarm_l/r`, `hand_l/r` with three bones per finger
(`thumb_01_l` .. `pinky_03_r`), `thigh_l/r`, `calf_l/r`, `foot_l/r` and `ball_l/r`.
The rest pose is world-aligned. The character faces +Z, its left is +X, and its height is in metres.

`Humanoid` builds that skeleton at any height, and `buildMannequin()` dresses it as the jointed wooden mannequin of the demo.
Med Engine 2's MakeHuman characters (`Human`) use the same names. A glTF character, or one from scanned data, must bring
bones with these names in a world-aligned rest pose, or have clips baked for its own rig (`bakeAll` with its `RigInfo`).

## Motion capture to clips

```sh
npm run bake:anim          # assets/mocap/cmu/*.bvh + clips.json  ->  assets/anim/humanoid/*.medclip + manifest.json
```

`clips.json` is the recipe. Each entry names a BVH `source`, and can add:

- `crop: [t0, t1]`: keep only this part, in seconds of the performance;
- `loop`: find a seamless cycle. `{ phase: 'left-foot-forward', minDuration }` starts it on a heel strike;
- `events`: `'footsteps'` (detected from the feet), `{ reach: ['hand_l', 'hand_r'], name: 'hit' }` (the moment a limb is
  furthest out), or `{ time, name, data }`;
- `rootMotion`: `'auto'`, `'trend'`, `'full'` or `'none'`, which says how the root's travel becomes the character's movement;
- `inPlace`, `groundFix` and `faceForward` (all default true except `inPlace`);
- `procedural: { type: 'idle', from: 'bow', time }`: an idle made from a held pose of another clip.

The retargeter (`retargetBVH(bvh, rig, options)`, or the `Retargeter` class) maps the source skeleton's bones by name.
`CMU_TO_MEDENGINE` and `MIXAMO_TO_MEDENGINE` are ready-made maps, and `guessMapping(bvh)` picks one. It transfers rotations as offsets from each skeleton's rest pose, scales the root's travel by leg length, keeps planted
feet on the floor, and turns the clip to start facing +Z.

The shipped clips are `idle`, `walk`, `run`, `jump` (with `takeoff` and `land` events), `punch` and `kick` (with `hit`
events), `bow`, `wave` and `getup` (face down). The walk and run have `footstep` events. Load them all with:

```js
const clips = await loadClipLibrary(engine.assets, 'assets/anim/humanoid');   // { idle, walk, run, ... }
```

`AnimationClip` can be changed in code: `crop()`, `reverse()`, `mirror()` (left and right swapped), `makeAdditive()` and
`clone()`. `toBinary()` / `AnimationClip.fromBinary()` read and write the `.medclip` format.

## Animator: layers and masks

```js
const animator = new Animator(root);                      // the object whose bones it drives
animator.layer(1, { mask: ['spine_01'], children: true });  // layer 1 only drives the spine and everything above it
const action = animator.play(clip, { layer: 1, fade: 0.15 });
action.onFinish = () => { /* ... */ };
```

Layers are mixed in order, and each layer can be partial (a bone mask) or `additive` (a breathing clip on top of anything).
Clip events reach `animator.onEvent(name, data, action)`.

## StateMachine

```js
const sm = new StateMachine(animator, { layer: 0 });
sm.addState('idle', clips.idle);
sm.addState('move', new BlendTree1D({ param: 'speed', children: [
  { clip: clips.walk, threshold: 1.4 }, { clip: clips.run, threshold: 3.6 } ] }));
sm.addState('jump', clips.jump, { loop: false });
sm.addTransition('idle', 'move', { when: 'speed > 0.1' });
sm.addTransition('move', 'idle', { when: 'speed <= 0.1', duration: 0.3 });
sm.addTransition('*', 'jump', { when: 'jump', duration: 0.1 });       // a trigger, from any state
sm.addTransition('jump', 'idle', { exitTime: 0.9 });
sm.set('speed', 2.2);
sm.trigger('jump');
```

Conditions (`when`) can be a string (`'speed > 0.1'`, `'grounded'`, `'!grounded'`), an object
`{ param, op, value }`, a function `(machine) => boolean`, or a list in which all must hold. A trigger waits `triggerLife`
seconds for a transition to use it.

Transition options are `duration`, `exitTime`, `offset`, `sync` (start the target at the source's phase, as walk → run does),
`priority`, `interrupt` and `self`.

Motions can be clips, `BlendTree1D`, `BlendTree2D` (gradient-band weights, for strafing) or `BlendTreeDirect` (each child
weighted by its own parameter). States can have `speed`, `speedParam` and `tag`, and the hooks `onEnter`, `onExit` and
`onEvent`.

The same machine can be built from plain data with `StateMachine.fromDefinition(animator, def, clips)`:

```json
{
  "layer": 0,
  "params": { "speed": 0 },
  "entry": "idle",
  "states": [
    { "name": "idle", "motion": "idle" },
    { "name": "move", "motion": { "type": "1d", "param": "speed",
        "children": [ { "clip": "walk", "threshold": 1.4 }, { "clip": "run", "threshold": 3.6 } ] } },
    { "name": "jump", "motion": "jump", "loop": false }
  ],
  "transitions": [
    { "from": "idle", "to": "move", "when": "speed > 0.1" },
    { "from": "move", "to": "idle", "when": "speed <= 0.1", "duration": 0.3 },
    { "from": "*", "to": "jump", "when": "jump", "duration": 0.1 },
    { "from": "jump", "to": "idle", "exitTime": 0.9 }
  ]
}
```

A motion in the data can be a clip name, `{ "type": "clip", "clip", "timeScale" }`, `{ "type": "1d", "param", "children": [{ "clip"
or "motion", "threshold" }] }`, `{ "type": "2d", "paramX", "paramY", "children": [{ "clip", "x", "y" }] }` or
`{ "type": "direct", "children": [{ "clip", "param" }] }`.

## Actor

`Actor` puts it all together for a character. With `idle` and `walk` clips (and optionally `run` and `jump`) it builds its own
locomotion machine on layer 0 and measures the clips' speeds, so the feet match the ground speed.

```js
const hero = engine.add(Actor.mannequin({ clips, height: 1.8 }));     // or new Actor(human | glTF | Object3D, { clips })
hero.attachCharacter(engine.physics);         // a physics capsule: stairs, slopes, walls, pushing things
hero.place([0, 0, 5], 180);                   // where, and the heading in degrees (0 faces +Z)

hero.move(x, z);                              // free control: the wanted velocity in m/s (a stick)
await hero.walkTo([2, 0, -3], { run: true }); // resolves true on arrival, false if something else was asked first
await hero.turnTo(otherActor);
hero.jump();
await hero.play('punch', { mask: 'upper' });  // over the locomotion; 'upper', 'lower', a bone list, or null for all
hero.lookAt(otherActor, 0.8);                 // head, neck and eyes
hero.emote('happy', 0.7);                     // needs a face (Human or scan head)
await hero.say('Hello there.');               // lip-sync on the face, a promise for when the line is over
hero.on('footstep', (e) => console.log(e.foot, e.position));   // also hit, takeoff, land, touchdown, ragdoll
hero.ragdollOn({ impulse: { point, vector } });         // the body goes to the physics world
await hero.ragdollOff();                      // and gets up: the get-up clip when lying face down, a procedural rise face up
```

`Actor.load(engine, 'hero.glb', { clips })` loads a glTF character as a private copy, so several actors can share one file.
`actor.attach(sword, 'hand_r', { position, rotation })` ties props to bones.

`actor.step(dt)` runs an actor without an engine.

## Limits

- Feet slide a little: the median foot speed while planted is about 0.1 to 0.17 m/s. There is no foot IK yet, so uneven
  ground is not followed.
- The idle is a held pose animated by code, not a capture.
- There is no get-up clip for lying face up: the procedural rise is used.
- No faces ship. `emote()` and `say()` need a `Human` with face shapes, or a scanned head prepared with `attachScanHead()`.
