/**
 * The Ford: a small playable level that puts the engine's parts to work together.
 *
 *   input      keyboard, mouse (pointer lock) and gamepad through named actions
 *   physics    a capsule character on stairs, a ramp and a terrace; balls and barrels to push and kick; a ragdoll
 *   animation  motion-capture clips, a locomotion state machine, a punch over the upper body, a kick over all of it
 *   camera     the Director's third-person camera with mouse look, collision with walls, and cinematic shots on C
 *   story      the ferryman tells the story in assets/story/ford.story.json (press E next to him)
 *
 * This file never touches the DOM or the browser: it takes an Engine and returns the game, so the same level runs in a page
 * (demo/main.js), headless on Node with a software or real GPU (demo/screenshot.mjs) and in the tests.
 */
import {
  Mesh, BoxGeometry, PlaneGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, CapsuleGeometry, StandardMaterial, DataTexture,
  DirectionalLight, PointLight, Vector3, Quaternion,
  PlaneCollider, BoxCollider, SphereCollider, RigidBody,
  Actor, loadClipLibrary, Director, StoryRunner, StorySystem,
} from '../src/index.js';

export const SPAWN = [0, 0, 9];
const CONTROLS = 'WASD move · mouse look · Space jump · Shift walk · F punch · G kick · E talk · C camera · R reset · P pause';

const mat = (color, o = {}) => new StandardMaterial({ color, roughness: 0.88, ...o });

/** A 1 m chequered meadow, drawn here so the demo needs no image files. Mip-mapped, repeats every 4 m. */
function meadowTexture() {
  const N = 256, cell = 64, data = new Uint8Array(N * N * 4);
  let s = 20240611;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const check = ((x / cell | 0) + (y / cell | 0)) & 1 ? 0.93 : 1;
      const edge = x % cell < 2 || y % cell < 2 ? 0.86 : 1;
      const grain = 0.86 + rnd() * 0.14;
      const k = check * edge * grain, o = (y * N + x) * 4;
      data[o] = 96 * k; data[o + 1] = 128 * k; data[o + 2] = 66 * k; data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, N, N);
  t.generateMipmaps = true;
  return t;
}

/**
 * Builds the level into the engine's scene and physics world.
 * Returns what the game needs to know about it.
 */
function buildLevel(engine) {
  const { scene, physics: world } = engine;
  const level = { props: [], lanterns: [], solids: [] };

  // A solid box: a mesh and the collider that matches it. `rotZ` tilts it about Z (the ramp).
  const block = ({ size, at, rotZ = 0, material, shadow = true }) => {
    const [w, h, d] = size, [x, y, z] = at;
    const mesh = new Mesh(new BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.rotation.z = rotZ;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    scene.add(mesh);
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotZ);
    const collider = new BoxCollider({ center: new Vector3(x, y, z), half: new Vector3(w / 2, h / 2, d / 2), rotation });
    world.addCollider(collider);
    level.solids.push({ mesh, collider });
    return mesh;
  };

  // ground
  const meadow = meadowTexture();
  meadow.repeat.set(22, 22);
  const ground = new Mesh(new PlaneGeometry(88, 88), mat(0xffffff, { map: meadow, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  world.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));

  // invisible walls round the meadow
  for (const [x, z, w, d] of [[0, -22, 46, 1], [0, 22, 46, 1], [-22, 0, 1, 46], [22, 0, 1, 46]]) {
    world.addCollider(new BoxCollider({ center: new Vector3(x, 4, z), half: new Vector3(w / 2, 4, d / 2) }));
  }

  const stone = mat(0xb4ae9f, { roughness: 0.9 }), dark = mat(0x6d675d), wood = mat(0x8a6a48, { roughness: 0.8 }), roof = mat(0x7a4b3a);

  // the terrace, its stairs (18 cm risers: the capsule steps up them) and a ramp up its other side
  block({ size: [10, 0.9, 8], at: [8, 0.45, -8], material: stone });
  for (let i = 0; i < 5; i++) {
    const h = 0.18 * (i + 1);
    block({ size: [3, h, 0.35], at: [8, h / 2, -4 + 0.35 * (4.5 - i)], material: stone });
  }
  // the ramp: its top surface runs from the ground at x = -2 to the terrace edge (x = 3) at 90 cm; the slab sits below that surface
  const run = 5, rise = 0.9, tilt = Math.atan2(rise, run), len = Math.hypot(run, rise), thick = 0.2;
  block({ size: [len, thick, 5], at: [-2 + run / 2 + Math.sin(tilt) * thick / 2, rise / 2 - Math.cos(tilt) * thick / 2, -8], rotZ: tilt, material: dark });

  // three pillars of a broken colonnade
  for (const [x, z] of [[-6, 5], [6, 5], [-6, -3]]) block({ size: [0.9, 3.2, 0.9], at: [x, 1.6, z], material: stone });

  // the ferryman's hut: three walls and a roof, open toward the plaza (the camera has to find its way round it)
  block({ size: [0.3, 2.4, 5], at: [-13.85, 1.2, -1.2], material: wood });
  block({ size: [5, 2.4, 0.3], at: [-11.5, 1.2, -3.85], material: wood });
  block({ size: [5, 2.4, 0.3], at: [-11.5, 1.2, 1.45], material: wood });
  block({ size: [5.6, 0.25, 5.8], at: [-11.4, 2.55, -1.2], material: roof });
  const lantern = new PointLight(0xffb060, 14, 11);
  lantern.position.set(-12.2, 2.1, -1.2); lantern.radius = 0.12; lantern.volumetric = 0.5;
  scene.add(lantern); level.lanterns.push(lantern);
  const bulb = new Mesh(new SphereGeometry(0.1, 16, 8), new StandardMaterial({ color: 0xffd9a0, emissive: 0xffa040, emissiveIntensity: 6, roughness: 0.4 }));
  bulb.position.copy(lantern.position); scene.add(bulb);

  // boulders to climb and trees round the edge
  for (const [x, z, r] of [[-3, -12, 1.4], [14, 4, 1.0], [-16, 8, 1.8]]) {
    const rock = new Mesh(new SphereGeometry(r, 24, 14), mat(0x8f8a80, { roughness: 0.95 }));
    rock.position.set(x, r * 0.55, z); rock.scale.y = 0.75; rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
    world.addCollider(new SphereCollider(new Vector3(x, r * 0.55, z), r * 0.8));
  }
  const bark = mat(0x5b4631), leaf = mat(0x3f6b3a, { roughness: 0.9 });
  for (const [x, z, s] of [[-19, -17, 1.2], [-10, -19, 1], [3, -19, 1.3], [15, -18, 1.1], [19, -6, 1], [19, 8, 1.2], [12, 18, 1], [-4, 19, 1.3], [-17, 15, 1.1], [-20, 2, 1]]) {
    const trunk = new Mesh(new CylinderGeometry(0.22 * s, 0.3 * s, 3.2 * s, 10), bark);
    trunk.position.set(x, 1.6 * s, z); trunk.castShadow = true;
    const crown = new Mesh(new ConeGeometry(1.9 * s, 4.4 * s, 12), leaf);
    crown.position.set(x, 4.6 * s, z); crown.castShadow = true;
    scene.add(trunk, crown);
    world.addCollider(new BoxCollider({ center: new Vector3(x, 1.6 * s, z), half: new Vector3(0.25 * s, 1.6 * s, 0.25 * s) }));
  }

  // balls and barrels: rigid bodies that follow their meshes
  const addProp = (kind, at, radius, mass, color, length = 0.5) => {
    const geometry = kind === 'ball' ? new SphereGeometry(radius, 24, 14) : new CapsuleGeometry(radius, length, 6, 16);
    const mesh = new Mesh(geometry, mat(color, { roughness: kind === 'ball' ? 0.45 : 0.7 }));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const shape = kind === 'ball' ? { type: 'sphere', radius } : { type: 'capsule', radius, length };
    const body = new RigidBody({ shape, mass, position: new Vector3(...at), friction: 0.8, restitution: kind === 'ball' ? 0.45 : 0.05, object: mesh });
    world.addBody(body);
    level.props.push({ body, mesh, home: new Vector3(...at), kind });
    return body;
  };
  addProp('ball', [-2.4, 0.5, 5.5], 0.5, 25, 0xc2452f);
  addProp('ball', [2.6, 0.35, 6.2], 0.35, 8, 0x2f6fc2);
  addProp('ball', [0.8, 0.25, 3.4], 0.25, 3, 0xe0b03c);
  addProp('ball', [-4.2, 0.4, 2.2], 0.4, 14, 0x4fa35c);
  addProp('barrel', [3.8, 0.55, 1.4], 0.32, 30, 0x7a5a3a, 0.62);
  addProp('barrel', [-0.9, 0.55, -2.6], 0.32, 30, 0x7a5a3a, 0.62);
  addProp('barrel', [-5.5, 0.55, -6.8], 0.32, 30, 0x5a6a7a, 0.62);

  // the light: one sun that drives the sky and the shadows
  const sun = new DirectionalLight(0xfff1dc, 7);
  sun.position.set(-9, 13, 7); sun.castShadow = true;
  scene.add(sun);
  level.sun = sun;
  return level;
}

/**
 * Makes the game.
 * @param {Engine} engine
 * @param {object} [o]
 * @param {object} [o.ui]      { story(view|null), toast(text) }: what to draw; the DOM is main.js's business
 * @param {object} [o.audio]   anything with sfx(name): the Audio class, or nothing
 * @param {object} [o.follow]  options for the third-person camera (Director.followActor)
 */
export async function createGame(engine, { ui = {}, audio = null, follow = {} } = {}) {
  const { input, physics: world } = engine;
  const level = buildLevel(engine);
  const clips = await loadClipLibrary(engine.assets, 'assets/anim/humanoid');
  const owned = [];                                              // what this game added to the engine: dispose() takes it out again
  const add = (system) => { owned.push(system); return engine.add(system); };

  // ------------------------------------------------------------------------------------------------------ actors
  const person = (name, color, at, yaw) => {
    const actor = Actor.mannequin({ name, color, clips });
    actor.root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    add(actor);
    actor.place(at, yaw);
    actor.attachCharacter(world);
    actor.enableRagdoll();
    return actor;
  };
  const player = person('Mara', 0xc9a27a, SPAWN, 180);
  const ferryman = person('Ferryman', 0x7c93a8, [-9.4, 0, -1.2], 90);
  const dummy = person('Dummy', 0xb35c44, [3, 0, 2.5], 200);
  ferryman.lookAt(player, 0.8);

  // ------------------------------------------------------------------------------------------------------ input
  input.map({
    move: { type: 'vec2', up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], stick: 'Pad:ls' },
    look: { type: 'look', mouse: 'locked', sensitivity: 0.0022, stick: 'Pad:rs', stickSpeed: 2.8 },
    jump: ['Space', 'Pad:a'],
    walk: ['ShiftLeft', 'ShiftRight', 'Pad:lb'],
    punch: ['Mouse0', 'KeyF', 'Pad:x'],
    kick: ['Mouse2', 'KeyG', 'Pad:b'],
    talk: ['KeyE', 'Pad:y'],
    camera: ['KeyC', 'Pad:rb'],
    reset: ['KeyR', 'Pad:back'],
    pause: ['KeyP', 'Pad:start'],
  });
  // while someone talks the context is 'story', in which nothing is bound: the story reads the keys itself

  // ------------------------------------------------------------------------------------------------------ camera
  const director = add(new Director(engine));
  const followOptions = { mode: 'orbit', ...follow };
  director.followActor(player, { ...followOptions, snap: true });
  const SHOTS = [
    null,                                                                                    // 0: the gameplay camera
    () => ({ type: 'mcu', on: player, angle: 25, height: 0.05, move: 'push', dur: 6 }),
    () => ({ type: 'ws', on: player, angle: -50, height: 0.3, move: 'orbit', orbit: 60, dur: 10 }),
    () => ({ type: 'two', on: player, with: ferryman, height: 0.2, move: 'truck', dur: 8 }),
    () => ({ type: 'pov', on: player }),
  ];
  let shotIndex = 0;
  // A cinematic shot is placed relative to the actor (an angle off its face), so a stick relative to *that* camera would turn the
  // actor, which swings the camera, which turns the stick: it spins. In a shot the stick keeps the heading the view had before the cut.
  let controlYaw = 0;
  const heading = () => (director.mode === 'follow' ? director.yaw : controlYaw);

  // ------------------------------------------------------------------------------------------------------ story
  const story = StoryRunner.from(await engine.assets.json('assets/story/ford.story.json'), { seed: 7 });
  const storySystem = add(new StorySystem(story));
  story.on('enter', (view) => ui.story?.(view));
  story.on('update', (view) => ui.story?.(view));
  let talking = false;

  const game = {
    engine, level, player, ferryman, dummy, director, story, storySystem, clips,
    controls: CONTROLS,
    get talking() { return talking; },
    get shot() { return shotIndex; },
    /** The nearest thing that can be done right now: for the prompt on screen. */
    hint() {
      if (talking) return story.ended ? 'Enter: close' : '1-9, arrows + Enter or click: choose · Esc: leave';
      if (player.position.distanceTo(ferryman.position) < 2.8) return 'E: talk to the ferryman';
      return CONTROLS;
    },
    status() {
      return {
        state: player.state, speed: player.speed, grounded: player.grounded, camera: director.mode === 'follow' ? 'follow' : `shot ${shotIndex}`,
        talking, dummyDown: dummy.ragdollActive, fps: engine.stats.fps, hint: game.hint(),
      };
    },
    startTalk,
    endTalk,
    /** A choice made with the mouse or a touch (the keys are handled by the StorySystem). */
    choose(i) { if (talking) { audio?.sfx('choice'); story.choose(i); } },
    cycleShot,
    setShot,
    intro,
    reset,
    dispose() { for (const s of owned) engine.remove(s); engine.input.setContext('default'); },
  };

  function startTalk() {
    if (talking) return false;
    talking = true;
    input.setContext('story');
    player.stop(); ferryman.stop();
    player.turnTo(ferryman, 0.5); ferryman.turnTo(player, 0.5);
    player.lookAt(ferryman, 0.7); ferryman.lookAt(player, 1);
    shotIndex = 0;
    director.cut({ type: 'ots', over: player, on: ferryman, side: 'left', move: 'push', dur: 40, amount: 0.4, handheld: 0.12 }, { blend: 1 });
    story.reset();
    story.start();
    return true;
  }

  function endTalk() {
    if (!talking) return;
    talking = false;
    input.setContext('default');
    ui.story?.(null);
    story.reset();
    player.lookAt(null); ferryman.lookAt(player, 0.8);
    director.followActor(player, followOptions);
  }

  /** Cuts to camera `i`: 0 is the gameplay camera, 1..4 are the film shots in SHOTS. */
  function setShot(i, blend = 0.8) {
    if (talking) return;
    if (shotIndex === 0 && i !== 0) controlYaw = director.yaw;
    shotIndex = i;
    if (i === 0) director.followActor(player, followOptions);
    else director.cut(SHOTS[i](), { blend });
  }
  function cycleShot() { setShot((shotIndex + 1) % SHOTS.length); }

  /** The title-screen camera: a slow orbit round the player. `intro(false)` hands the camera back to the game. */
  function intro(on = true) {
    if (talking) return;
    if (on) {
      if (shotIndex === 0) controlYaw = director.yaw;
      shotIndex = 5;
      director.cut({ type: 'ws', on: player, angle: 150, height: 0.35, move: 'orbit', orbit: -45, dur: 60 }, { blend: 0 });
    } else if (shotIndex === 5) {
      shotIndex = 0;
      director.followActor(player, { ...followOptions, snap: true });
    }
  }

  function reset() {
    player.place(SPAWN, 180);
    for (const p of level.props) {
      const b = p.body;
      b.position.copy(p.home); b.quaternion.identity(); b.linearVelocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
      b.updateWorld?.(); b.wake?.();
    }
    if (dummy.ragdollActive) dummy.ragdollOff({ getUp: false, fade: 0.02 });
    dummy.place([3, 0, 2.5], 200);
    if (talking) endTalk();
    director.followActor(player, { ...followOptions, snap: true });
    shotIndex = 0;
  }

  // ------------------------------------------------------------------------------------------------------ fighting
  let dummyDownAt = -1;
  const _d = new Vector3();
  /** Who is in front of the player and within reach, nearest first. */
  const inFront = (reach, cone = 0.35) => {
    const f = player.forward(), out = [];
    const test = (target, pos) => {
      _d.copy(pos).sub(player.position); _d.y = 0;
      const dist = _d.length();
      if (dist < 1e-3 || dist > reach) return;
      if (_d.multiplyScalar(1 / dist).dot(f) < cone) return;
      out.push({ target, dist });
    };
    if (!dummy.ragdollActive && !dummy.locked) test(dummy, dummy.position);
    for (const p of level.props) test(p, p.body.position);
    return out.sort((a, b) => a.dist - b.dist);
  };

  player.on('hit', (e) => {
    const kick = e.clip === 'kick', power = kick ? 1 : 0.6, reach = kick ? 1.7 : 1.4;
    audio?.sfx(kick ? 'kick' : 'punch');
    const f = player.forward();
    for (const { target } of inFront(reach)) {
      if (target === dummy) {
        dummy.ragdollOn({ impulse: { point: dummy.chest(), vector: new Vector3(f.x * 320 * power, 90 * power, f.z * 320 * power) } });
        dummyDownAt = engine.time;
        audio?.sfx('fall');
      } else {
        const b = target.body;
        b.applyImpulse(new Vector3(f.x * 55 * power * (1 + b.mass / 60), 14 * power, f.z * 55 * power * (1 + b.mass / 60)));
      }
    }
  });
  player.on('footstep', () => audio?.sfx('step', { volume: Math.min(1, 0.3 + player.speed / 4) }));
  player.on('touchdown', (e) => { if (e.speed > 3) audio?.sfx('land'); });

  // ------------------------------------------------------------------------------------------------------ the loop
  const _v = new Vector3(), _look = { x: 0, y: 0 };
  const systems = [{
    fixedUpdate() {
      if (talking || engine.paused) return;
      if (input.pressed('jump')) player.jump();
      if (input.pressed('punch') && !player.isPlaying(1) && !player.ragdollActive) player.play('punch', { mask: 'upper' });
      if (input.pressed('kick') && !player.isPlaying(1) && !player.ragdollActive) player.play('kick');
      // the stick is relative to where the camera looks
      const m = input.vec2('move'), yaw = heading(), speed = input.down('walk') ? player.walkSpeed : player.runSpeed ?? 3.5;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -Math.cos(yaw), rz = Math.sin(yaw);
      player.move((fx * m.y + rx * m.x) * speed, (fz * m.y + rz * m.x) * speed);
    },
    update() {
      if (input.pressed('pause')) engine.paused = !engine.paused;
      if (input.pressed('reset')) reset();
      if (input.pressed('camera')) cycleShot();
      if (!talking && input.pressed('talk') && player.position.distanceTo(ferryman.position) < 2.8) startTalk();
      if (!talking && director.mode === 'follow') { input.look('look', _look); director.look(_look.x, _look.y); }
      // the dummy gets up three seconds after it was knocked down
      if (dummy.ragdollActive && dummyDownAt >= 0 && engine.time - dummyDownAt > 3) { dummyDownAt = -1; dummy.ragdollOff(); }
      // the ferryman turns his head to follow the player when he comes near
      ferryman.lookAt(talking || player.position.distanceTo(ferryman.position) < 7 ? player : null, 0.8);
    },
    lateUpdate() {
      // a tight, sharp shadow around the player
      if (engine.stage) engine.stage.shadowFocus = { center: player.chest(_v), radius: 6 };
    },
  }];
  for (const s of systems) add(s);

  // leaving a conversation: Escape at any time, Enter / Space / Escape after an ending
  const off = engine.platform.on('key', (e) => {
    if (!e.down || e.repeat || !talking) return;
    if (e.code === 'Escape' || (story.ended && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter'))) endTalk();
  });
  const dispose = game.dispose;
  game.dispose = () => { off(); dispose(); };
  return game;
}
