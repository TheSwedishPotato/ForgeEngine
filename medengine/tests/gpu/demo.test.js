// The demo level on a real WebGPU device (Dawn on Node, wgpu on Deno): the whole stack - level, physics, characters, the Director,
// the renderer - drawing what the game says it draws. Pixels are checked where the picture has to be a certain thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext, makePlatform } from './helpers.js';
import { Engine, Vector3 } from '../../src/index.js';
import { createGame } from '../../demo/game.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';
const ROOT = new URL('../../', import.meta.url).pathname;
const DT = 1 / 60;
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const px = (img, x, y) => { const o = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
/** Mean colour of a block of pixels. */
function mean(img, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) { const p = px(img, x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
  return [r / n, g / n, b / n];
}
const toScreen = (img, camera, v) => { const n = v.clone().project(camera); return { x: (n.x * 0.5 + 0.5) * img.width, y: (0.5 - n.y * 0.5) * img.height, ndc: n }; };

async function game(width = 384, height = 216) {
  const engine = await Engine.create({ platform: makePlatform({ width, height }), quality: 'low', baseUrl: ROOT });
  const g = await createGame(engine);
  engine.stage.renderer.gpu.errors.length = 0;
  return { engine, game: g, platform: engine.platform, gpu: engine.stage.renderer.gpu };
}

test('the demo level: the player is in frame whole, warm skin on the ground between sky and grass, no GPU errors', { skip, timeout: 240000 }, async () => {
  const { engine, game: g, gpu } = await game();
  engine.run(90, DT, { draw: false });
  engine.run(10, DT);
  const img = await engine.screenshot();
  assert.equal(img.width, 384);

  const p = g.player.position;
  const head = toScreen(img, engine.camera, new Vector3(p.x, p.y + g.player.height, p.z));
  const feet = toScreen(img, engine.camera, new Vector3(p.x, p.y, p.z));
  assert.ok(head.ndc.y < 0.97 && feet.ndc.y > -0.97, `head at ${head.ndc.y.toFixed(2)}, feet at ${feet.ndc.y.toFixed(2)}: the whole body is inside the frame`);
  assert.ok(Math.abs(head.ndc.x) < 0.5, 'and near the middle');
  assert.ok(head.ndc.y - feet.ndc.y > 0.7, `and large: ${(head.ndc.y - feet.ndc.y).toFixed(2)} of the frame's height`);

  const chest = toScreen(img, engine.camera, g.player.chest());
  const skin = mean(img, chest.x - 2, chest.y - 2, chest.x + 3, chest.y + 3);
  assert.ok(skin[0] > skin[2] * 1.2 && skin[0] > skin[1] && skin[0] > 60, `the chest is warm skin: ${skin.map(Math.round)}`);
  const sky = mean(img, 0, 0, img.width, img.height * 0.06);
  assert.ok(luma(sky) > 70, `sky ${sky.map(Math.round)}`);
  const grass = mean(img, img.width * 0.05, img.height * 0.9, img.width * 0.3, img.height * 0.99);
  assert.ok(grass[1] > grass[0] * 1.15 && grass[1] > grass[2] * 1.3, `grass ${grass.map(Math.round)}`);
  assert.deepEqual(gpu.errors, [], 'no WebGPU validation errors');
  engine.dispose();
});

test('the demo level: every film camera and the conversation draw a frame with something in it', { skip, timeout: 240000 }, async () => {
  const { engine, game: g, platform, gpu } = await game(320, 180);
  const key = (code, down = true) => platform.emit('key', { code, key: code, down, repeat: false });
  const tap = (code) => { key(code); engine.run(2, DT, { draw: false }); key(code, false); engine.run(2, DT, { draw: false }); };
  g.player.place([-6.9, 0, -1.2], 270);
  engine.run(60, DT, { draw: false });
  const spread = (img) => {                                  // the picture is not a flat colour: the spread of the luma over a grid of samples
    const v = [];
    for (let y = 8; y < img.height; y += 16) for (let x = 8; x < img.width; x += 16) v.push(luma(px(img, x, y)));
    const m = v.reduce((s, a) => s + a, 0) / v.length;
    return Math.sqrt(v.reduce((s, a) => s + (a - m) ** 2, 0) / v.length);
  };
  const seen = [];
  for (let shot = 1; shot <= 4; shot++) {
    tap('KeyC');
    engine.run(70, DT, { draw: false });
    assert.equal(g.shot, shot);
    assert.equal(g.director.mode, 'shot');
    engine.run(6, DT);
    const img = await engine.screenshot();
    seen.push(spread(img));
    assert.ok(seen.at(-1) > 6, `shot ${shot}: the picture has structure (spread ${seen.at(-1).toFixed(1)})`);
  }
  tap('KeyC');
  assert.equal(g.shot, 0, 'a fifth press is back to the gameplay camera');
  assert.equal(g.director.mode, 'follow');
  engine.run(60, DT, { draw: false });
  tap('KeyE');
  assert.equal(g.talking, true);
  engine.run(80, DT, { draw: false });
  engine.run(6, DT);
  const talk = await engine.screenshot();
  assert.ok(spread(talk) > 6, 'the conversation camera draws too');
  // the over-the-shoulder shot is inside the hut: the lantern is warm, so there is orange in the picture
  const warm = mean(talk, 0, 0, talk.width, talk.height);
  assert.ok(warm[0] > warm[2] * 1.3, `the hut is warm: ${warm.map(Math.round)}`);
  assert.deepEqual(gpu.errors, [], 'no WebGPU validation errors');
  engine.dispose();
});
