// DenoPlatform (headless): run with   deno test -A --unstable-webgpu tests/deno/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../gpu/helpers.js';                       // points Vulkan at the software driver when there is no GPU
import { DenoPlatform } from '../../src/platform/deno.js';
import { InputManager } from '../../src/input/index.js';
import { Engine } from '../../src/index.js';

const skip = typeof Deno === 'undefined' ? 'needs Deno' : false;

test('headless platform: files, PNG round trip, storage', { skip }, async () => {
  const p = new DenoPlatform({ headless: true });
  assert.equal(p.name, 'deno'); assert.equal(p.capabilities.windowed, false);
  const dir = await Deno.makeTempDir();
  const file = `${dir}/sub/pixels.png`;
  const data = new Uint8Array(6 * 4 * 4).map((_, i) => (i * 29) & 255);
  const png = await p.encodePNG({ width: 6, height: 4, data });
  await p.writeFile(file, png);                                      // creates the folder
  assert.ok(await p.exists(file)); assert.ok(!(await p.exists(`${dir}/nope`)));
  assert.deepEqual(await p.listDir(`${dir}/sub`), ['pixels.png']);
  const img = await p.decodeImage(await p.readFile(file), 'image/png');
  assert.deepEqual([img.width, img.height], [6, 4]);
  assert.deepEqual(Array.from(img.data), Array.from(data));
  assert.equal(await p.readText(file).then((t) => typeof t), 'string');
  p.storage.set('k', 'v'); assert.equal(p.storage.get('k'), 'v'); p.storage.remove('k'); assert.equal(p.storage.get('k'), null);
  await Deno.remove(dir, { recursive: true });
});

test('headless platform: injected input reaches an InputManager, the engine runs and draws', { skip }, async () => {
  const p = new DenoPlatform({ headless: true, width: 160, height: 90 });
  const input = new InputManager(p);
  input.map({ jump: ['Space', 'Pad:a'] });
  p.injectKey('Space', true); input.advance(1 / 60);
  assert.ok(input.pressed('jump'));
  p.injectKey('Space', false); p.setGamepads([{ index: 0, id: 'x', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })) }]);
  input.advance(1 / 60);
  assert.ok(input.down('jump'), 'a pad button counts');
  input.dispose();

  const engine = await Engine.create({ platform: new DenoPlatform({ headless: true, width: 160, height: 90 }), quality: 'low' });
  engine.run(6);
  const img = await engine.screenshot();
  assert.equal(img.width, 160);
  assert.ok(img.data.some((v, i) => i % 4 < 3 && v > 40), 'the sky is not black');
  assert.deepEqual(engine.stage.renderer.gpu.errors, []);
  engine.dispose();
});

test('a windowed platform without Deno.BrowserWindow explains itself', { skip }, async () => {
  const p = new DenoPlatform({ headless: false });
  assert.throws(() => p.createSurface(), /BrowserWindow/);
});
