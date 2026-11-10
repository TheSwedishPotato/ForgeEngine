// The demo level played with scripted keys on a headless engine: the whole stack (input, steering, physics, animation, the Director,
// the story) has to work together for any of these to pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NodePlatform } from '../src/platform/node.js';
import { Engine, Vector3, MathUtils } from '../src/index.js';
import { createGame, SPAWN } from '../demo/game.js';

const ROOT = new URL('../', import.meta.url).pathname;
const DT = 1 / 60;
const seededRandom = (s) => MathUtils.seededRandom(s);
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);

async function play({ audio = null } = {}) {
  const platform = new NodePlatform();
  const engine = await Engine.create({ platform, render: false, baseUrl: ROOT });
  const views = [];
  const game = await createGame(engine, { audio, ui: { story: (v) => views.push(v) } });
  const key = (code, down = true) => platform.emit('key', { code, key: code, down, repeat: false });
  const run = (seconds) => engine.run(Math.round(seconds / DT), DT, { draw: false });
  /** Holds keys for `seconds`, then lets go. */
  const hold = (codes, seconds) => { for (const c of [].concat(codes)) key(c); run(seconds); for (const c of [].concat(codes)) key(c, false); };
  /** Presses and releases a key over two frames. */
  const tap = (code) => { key(code); run(DT * 2); key(code, false); run(DT * 2); };
  run(1.5);                                                      // settle: the player drops onto the floor, the props rest
  return { engine, game, platform, views, key, run, hold, tap };
}

test('the level builds and settles: everyone stands on the floor, the camera is behind the player', async () => {
  const { game, engine } = await play();
  const { player, ferryman, dummy, director } = game;
  for (const a of [player, ferryman, dummy]) { near(a.position.y, 0, 0.02, `${a.name} stands on the floor`); assert.ok(a.grounded); }
  near(player.position.x, SPAWN[0], 0.05); near(player.position.z, SPAWN[2], 0.05);
  assert.equal(director.mode, 'follow');
  assert.ok(director.cur.pos.z > player.position.z + 2, 'the camera is behind the player, who faces -Z');
  near(director.yaw, Math.PI, 1e-6, 'looking along -Z');
  assert.equal(player.state, 'idle');
  assert.equal(game.level.props.length, 7);
  for (const p of game.level.props) assert.ok(p.body.position.y > 0.2 && p.body.position.y < 0.7, `${p.kind} rests on the floor at ${p.body.position.y}`);
  assert.match(game.hint(), /WASD/);
  assert.equal(game.status().state, 'idle');
  engine.dispose();
});

test('W walks away from the camera, D to its right, and Shift walks instead of runs', async () => {
  const { game, hold, run, engine } = await play();
  const { player } = game, z0 = player.position.z;
  hold('KeyW', 2);
  assert.ok(z0 - player.position.z > 4.5, `ran ${z0 - player.position.z} m forward in two seconds`);
  near(player.position.x, 0, 0.3, 'straight');
  assert.equal(player.state, 'move');
  assert.ok(player.speed > 3, `speed ${player.speed}`);
  run(1.5);
  assert.equal(player.state, 'idle', 'and stops when the key is let go');
  // the camera looks along -Z, so its right is +X
  player.place([0, 0, 9], 180);
  hold('KeyD', 1.2);
  assert.ok(player.position.x > 2, `strafed to x ${player.position.x}`);
  // walking is slower
  player.place([0, 0, 9], 180);
  hold(['ShiftLeft', 'KeyW'], 2);
  const walked = 9 - player.position.z;
  assert.ok(walked > 1.8 && walked < 3.4, `walked ${walked} m in two seconds`);
  assert.ok(player.speed < 2, `speed ${player.speed}`);
  engine.dispose();
});

test('the stick follows the camera: after the view turns, W goes the way the camera looks', async () => {
  const { game, hold, run, engine } = await play();
  const { player, director } = game;
  director.look(-Math.PI / 2, 0);                                 // the view turns a quarter to the left: from looking along -Z to looking along -X
  run(0.5);
  const yaw = director.yaw;
  near(yaw, -Math.PI / 2, 1e-6, 'looking along -X');
  const x0 = player.position.x, z0 = player.position.z;
  hold('KeyW', 1.5);
  const dx = player.position.x - x0, dz = player.position.z - z0;
  near(Math.atan2(dx, dz), yaw, 0.15, 'walked along the camera heading');
  engine.dispose();
});

test('Space jumps: up, over and down, through the jump state', async () => {
  const { game, tap, run, engine } = await play();
  const { player } = game;
  const states = new Set();
  tap('Space');
  let peak = 0;
  for (let i = 0; i < 120; i++) { engine.tick(DT, false); states.add(player.state); peak = Math.max(peak, player.position.y); }
  assert.ok(peak > 0.7 && peak < 1.4, `peak ${peak}`);
  assert.ok(states.has('jump'));
  near(player.position.y, 0, 0.02, 'landed');
  assert.ok(player.grounded);
  run(1);
  assert.equal(player.state, 'idle');
  engine.dispose();
});

test('the stairs and the ramp lead up onto the terrace', async () => {
  const { game, hold, run, engine } = await play();
  const { player } = game;
  player.place([8, 0, 0], 180);                                    // facing the stairs, 4 m from the first step
  game.director.followActor(player, { mode: 'orbit', snap: true });
  run(0.3);
  hold('KeyW', 3.2);
  near(player.position.y, 0.9, 0.06, 'on the terrace');
  assert.ok(player.position.z < -4, `z ${player.position.z}`);
  // down again, and up the ramp from its foot
  player.place([-4, 0, -8], 90);
  game.director.followActor(player, { mode: 'orbit', snap: true });
  run(0.3);
  hold('KeyW', 0.4);
  const x = player.position.x;
  assert.ok(x > -3.5 && player.position.y < 0.1, `at the foot of the ramp: x ${x}, y ${player.position.y}`);
  hold('KeyW', 2.6);
  near(player.position.y, 0.9, 0.06, 'at the top of the ramp');
  assert.ok(player.position.x > 3, `x ${player.position.x}`);
  engine.dispose();
});

test('a punch knocks the dummy down; it lies there, then gets up', async () => {
  const { game, tap, run, engine } = await play();
  const { player, dummy } = game;
  player.place([3, 0, 3.7], 180);                                  // 1.2 m south of the dummy, facing it
  run(0.3);
  assert.ok(!dummy.ragdollActive);
  tap('KeyF');
  run(0.6);
  assert.ok(dummy.ragdollActive, 'the dummy is a ragdoll');
  const lying = dummy.bone('pelvis').y;
  assert.ok(lying < 1.0, `pelvis at ${lying}`);
  run(1.5);
  assert.ok(dummy.ragdollActive, 'still down 2 seconds later');
  run(2.5);                                                        // 3 s after the hit: it starts to get up
  assert.ok(!dummy.ragdollActive, 'handed back to the animation');
  run(7);
  assert.ok(!dummy.locked && dummy.state === 'idle', 'on its feet');
  near(dummy.bone('pelvis').y, 1.0, 0.25, 'standing again');
  engine.dispose();
});

test('a punch that cannot reach does nothing, a kick reaches further, and balls fly', async () => {
  const { game, tap, run, engine } = await play();
  const { player, dummy } = game;
  player.place([3, 0, 5.5], 180);                                  // 3 m away
  run(0.3); tap('KeyF'); run(1.4);                                 // the punch plays for 1.3 s, and nothing else can start over it
  assert.ok(!dummy.ragdollActive, 'out of reach');
  // kick the red ball: stand behind it, facing -Z
  const ball = game.level.props[0].body;
  player.place([ball.position.x, 0, ball.position.z + 1.2], 180);
  run(0.3);
  const z0 = ball.position.z;
  tap('KeyG'); run(1.2);
  assert.ok(ball.position.z < z0 - 0.5, `the ball rolled from z ${z0} to ${ball.position.z}`);
  engine.dispose();
});

test('E next to the ferryman starts the story: the camera cuts, the player is held, keys choose, Escape leaves', async () => {
  const { game, tap, hold, run, views, engine } = await play();
  const { player, ferryman, director, story } = game;
  tap('KeyE');
  assert.ok(!game.talking, 'too far away to talk');
  player.place([-6.9, 0, -1.2], 270);                              // 2.5 m from him
  run(0.3);
  assert.match(game.hint(), /talk to the ferryman/);
  tap('KeyE');
  assert.ok(game.talking);
  assert.equal(director.mode, 'shot');
  assert.equal(director.shot.type, 'ots');
  assert.ok(story.view && views.at(-1) === story.view, 'the UI was shown the first scene');
  assert.equal(story.view.id, 'camp');
  assert.match(story.view.lines.map((l) => l.text).join(' '), /Grey light/);
  assert.equal(story.view.choices.length, 3);
  // held still, and the keys that move or jump the player do nothing
  const at = player.position.clone();
  hold(['KeyW', 'KeyA'], 1);
  near(player.position.distanceTo(at), 0, 0.05, 'did not move');
  // number keys choose
  tap('Digit1');
  assert.equal(story.view.id, 'ford');
  assert.ok(views.length >= 2);
  // the camera looked at the ferryman the whole time
  const look = director.cur.target.clone().sub(ferryman.eyes());
  assert.ok(look.length() < 0.5, `aimed ${look.length()} m from his eyes`);
  tap('Escape');
  assert.ok(!game.talking);
  assert.equal(director.mode, 'follow');
  assert.equal(views.at(-1), null, 'the UI was told to close');
  assert.equal(story.view, null);
  // free again
  const z = player.position.z;
  hold('KeyD', 1);
  assert.ok(Math.abs(player.position.z - z) + Math.abs(player.position.x - at.x) > 1, 'moves again');
  engine.dispose();
});

test('a whole conversation, played with the keys alone, reaches an ending that Enter closes', async () => {
  for (const seed of [1, 2, 3]) {
    const { game, tap, run, engine } = await play();
    const { player, story } = game;
    player.place([-6.9, 0, -1.2], 270);
    run(0.3);
    tap('KeyE');
    const roll = seededRandom(seed);
    let steps = 0;
    while (!story.ended && steps++ < 400) {
      const v = story.view;
      if (v.qte) {                                                 // quick-time events take the keys they ask for
        if (v.qte.mode === 'mash') for (let i = 0; i < v.qte.need; i++) tap(v.qte.key);
        else for (const k of v.qte.keys) tap(k);
        run(0.1);
        continue;
      }
      const open = v.choices.filter((c) => c.enabled);
      assert.ok(open.length, `seed ${seed}: a way on from ${v.id}`);
      tap(`Digit${open[Math.floor(roll() * open.length)].index + 1}`);
    }
    assert.ok(story.ended, `seed ${seed}: reached an ending in ${steps} steps`);
    assert.ok(game.talking, 'the ending is still on screen');
    tap('Enter');
    assert.ok(!game.talking, 'Enter closes it');
    assert.equal(game.director.mode, 'follow');
    engine.dispose();
  }
});

test('C cycles through the cinematic shots and back to the gameplay camera', async () => {
  const { game, tap, run, engine } = await play();
  const { director, player } = game;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    tap('KeyC'); run(1);
    seen.push(director.mode === 'follow' ? 'follow' : director.shot.type);
    assert.ok(Number.isFinite(director.camera.position.x + director.camera.position.y + director.camera.position.z), 'finite');
  }
  assert.deepEqual(seen, ['mcu', 'ws', 'two', 'pov', 'follow']);
  // in a shot the stick keeps the heading the view had before the cut (a camera placed off the actor's face would otherwise spin with it)
  const before = director.yaw;
  tap('KeyC'); run(1.2);
  assert.equal(director.mode, 'shot');
  const x0 = player.position.x, z0 = player.position.z;
  const key = (c, d) => engine.platform.emit('key', { code: c, key: c, down: d, repeat: false });
  key('KeyW', true); run(1.5); key('KeyW', false);
  const walked = Math.hypot(player.position.x - x0, player.position.z - z0);
  assert.ok(walked > 3, `walked ${walked} m`);
  near(Math.atan2(player.position.x - x0, player.position.z - z0), before, 0.15, 'straight along the old heading');
  engine.dispose();
});

test('R puts everything back; P freezes the world and the camera', async () => {
  const { game, tap, hold, run, engine } = await play();
  const { player, level } = game;
  hold('KeyW', 1.5);
  level.props[0].body.applyImpulse(new Vector3(40, 0, 0));
  run(1);
  tap('KeyR');
  run(0.5);
  near(player.position.x, SPAWN[0], 0.05); near(player.position.z, SPAWN[2], 0.05);
  const p = level.props[0];
  near(p.body.position.distanceTo(p.home), 0, 0.15, 'the ball is home');
  // pause
  tap('KeyP');
  assert.ok(engine.paused);
  const t = engine.time, at = player.position.clone(), cam = game.director.camera.position.clone();
  hold('KeyW', 1);
  assert.equal(engine.time, t, 'the clock stopped');
  near(player.position.distanceTo(at), 0, 1e-9); near(game.director.camera.position.distanceTo(cam), 0, 1e-9);
  tap('KeyP');
  assert.ok(!engine.paused);
  hold('KeyW', 0.5);
  assert.ok(player.position.distanceTo(at) > 0.5, 'and on again');
  engine.dispose();
});

test('the camera stays on the player\'s side of a wall: the view turned so that the hut\'s south wall is behind the player', async () => {
  const { game, engine } = await play();
  const { player, director } = game;
  player.place([-11.5, 0, 3.4], 270);                              // 1.8 m outside the middle of the south wall (its face is at z = 1.6)
  director.followActor(player, { mode: 'orbit', snap: true });
  director.look(-Math.PI / 2, 0);                                  // the view now looks along +Z, so the camera's wanted place is 3 m behind the wall
  near(director.yaw, 0, 1e-6, 'looking toward +Z');
  for (let i = 0; i < 180; i++) {
    engine.tick(DT, false);
    const c = director.camera.position, head = player.chest().add(new Vector3(0, 0.35, 0));
    assert.ok(c.z > 1.6, `frame ${i}: the camera went through the wall, to ${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}`);
    assert.ok(c.distanceTo(head) >= 0.35 - 1e-6, `frame ${i}: inside the actor`);
  }
  const c = director.camera.position;
  assert.ok(c.z > 1.75 && c.z < 2.5, `squeezed against the wall: z ${c.z}`);
  engine.dispose();
});

test('the same keys give the same game: two runs end in the same place', async () => {
  const outcome = async () => {
    const { game, hold, tap, run, engine } = await play();
    hold('KeyW', 1); tap('Space'); hold(['KeyW', 'KeyD'], 1.5); tap('KeyF'); run(0.5);
    const out = [game.player.position.toArray(), game.dummy.position.toArray(), game.level.props.map((p) => p.body.position.toArray())];
    engine.dispose();
    return out;
  };
  assert.deepEqual(await outcome(), await outcome());
});

test('sounds are asked for at the right moments (footsteps, punch, landing, choice)', async () => {
  const heard = [];
  const audio = { sfx: (name) => heard.push(name) };
  const { game, hold, tap, run, engine } = await play({ audio });
  hold('KeyW', 1);
  assert.ok(heard.filter((n) => n === 'step').length >= 2, `steps: ${heard}`);
  game.player.place([3, 0, 3.7], 180); run(0.3);
  tap('KeyF'); run(0.5);
  assert.ok(heard.includes('punch') && heard.includes('fall'), `heard ${heard}`);
  engine.dispose();
});
