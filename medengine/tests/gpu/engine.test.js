// The Engine end to end with a renderer: scene, physics and the loop drawing real frames headless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuContext, makePlatform } from './helpers.js';
import {
  Engine, Mesh, BoxGeometry, PlaneGeometry, SphereGeometry, StandardMaterial, DirectionalLight, Vector3, PlaneCollider, RigidBody,
} from '../../src/index.js';
import { HeadlessSurface } from '../../src/platform/node.js';
import { TEX } from '../../src/gpu/Device.js';

const ctx = await gpuContext();
const skip = ctx ? false : 'WebGPU not available';
const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
const px = (img, x, y) => { const o = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };

test('Engine: a falling ball is simulated, drawn and captured', { skip }, async () => {
  const engine = await Engine.create({ platform: makePlatform({ width: 320, height: 180 }), quality: 'low' });
  const gpu = engine.stage.renderer.gpu;
  gpu.errors.length = 0;
  const { scene, camera } = engine;
  const ground = new Mesh(new PlaneGeometry(40, 40), new StandardMaterial({ color: 0x808080, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const ball = new Mesh(new SphereGeometry(0.5, 32, 16), new StandardMaterial({ color: 0xcc3322, roughness: 0.4 }));
  ball.castShadow = true; scene.add(ball);
  const sun = new DirectionalLight(0xfff0dd, 7); sun.position.set(-4, 8, 5); sun.castShadow = true; scene.add(sun);
  engine.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  engine.physics.addBody(new RigidBody({ shape: { type: 'sphere', radius: 0.5 }, mass: 1, position: new Vector3(0, 4, 0), object: ball }));
  camera.position.set(0, 1.4, 5); camera.lookAt(0, 0.8, 0);
  engine.stage.fitCamera();

  engine.run(10, 1 / 60);                                   // mid-air
  assert.ok(ball.position.y < 4 && ball.position.y > 3, `ball at ${ball.position.y}`);
  engine.run(200, 1 / 60, { draw: false });                 // simulate without drawing
  engine.run(12, 1 / 60);                                   // settle the temporal filters
  assert.ok(Math.abs(ball.position.y - 0.5) < 0.02, `ball rests at ${ball.position.y}`);
  const img = await engine.screenshot();
  assert.equal(img.width, 320);
  assert.deepEqual(gpu.errors, [], 'no GPU validation errors');
  const sky = px(img, 160, 6), ballPx = px(img, 160, 180 - 180 * 0.5 * 0.86);
  assert.ok(luma(sky) > 50, `sky ${sky}`);
  assert.ok(ballPx[0] > ballPx[2] * 1.5, `the ball is red: ${ballPx}`);
  assert.ok(engine.stats.fps > 0 && engine.stats.renderMs >= 0);
  const png = await engine.screenshotPNG();
  assert.equal(png[1], 80);                                  // 'P' of the PNG signature
  engine.dispose();
});

/** A surface that behaves like a canvas: the texture belongs to one frame and is gone once the frame is presented. */
class OneFrameSurface extends HeadlessSurface {
  constructor(o) { super(o); this.transient = true; this.handedOut = []; }
  _make() { /* no persistent texture */ }
  getCurrentTexture() {
    if (!this._cur) {
      this._cur = this.gpu.texture({ label: 'one-frame', size: [this.width, this.height], format: this.format, usage: TEX.RENDER | TEX.COPY_SRC | TEX.BINDING });
      this.handedOut.push(this._cur);
    }
    return this._cur;
  }
  present() { this._cur?.destroy(); this._cur = null; }
}

function redBallScene(engine) {
  const { scene, camera } = engine;
  const ground = new Mesh(new PlaneGeometry(40, 40), new StandardMaterial({ color: 0x808080, roughness: 0.9 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const ball = new Mesh(new SphereGeometry(0.5, 32, 16), new StandardMaterial({ color: 0xcc3322, roughness: 0.4 }));
  ball.position.set(0, 0.5, 0); ball.castShadow = true; scene.add(ball);
  const sun = new DirectionalLight(0xfff0dd, 7); sun.position.set(-4, 8, 5); sun.castShadow = true; scene.add(sun);
  camera.position.set(0, 1.4, 5); camera.lookAt(0, 0.8, 0);
  engine.stage.fitCamera();
}

test('Engine.screenshot on a surface whose texture lives for one frame (a canvas) returns the frame that was drawn', { skip }, async () => {
  const surface = new OneFrameSurface({ width: 192, height: 108 });
  const engine = await Engine.create({ platform: makePlatform({ width: 192, height: 108 }), surface, quality: 'low' });
  const gpu = engine.stage.renderer.gpu;
  gpu.errors.length = 0;
  redBallScene(engine);
  engine.run(14, 1 / 60);
  assert.equal(surface._cur, null, 'the frame was presented, so its texture is gone');
  const before = surface.handedOut.length;
  const img = await engine.screenshot();
  assert.equal(surface.handedOut.length, before + 1, 'screenshot drew exactly one more frame');
  assert.equal(img.width, 192); assert.equal(img.height, 108);
  assert.deepEqual(gpu.errors, [], 'no GPU validation errors');
  const sky = px(img, 96, 4), ballPx = px(img, 96, 108 * 0.5);
  assert.ok(luma(sky) > 50, `sky ${sky}`);
  assert.ok(ballPx[0] > ballPx[2] * 1.5 && ballPx[0] > 60, `the ball is red: ${ballPx}`);
  // two at once get the same picture, and a second call after that works too
  const [a, b] = await Promise.all([engine.screenshot(), engine.screenshot()]);
  assert.equal(a.data.length, b.data.length);
  assert.notEqual(a.data.buffer, b.data.buffer, 'each caller owns its bytes');
  assert.equal((await engine.screenshot()).width, 192);
  assert.deepEqual(gpu.errors, []);
  engine.dispose();
});

test('Stage.setQuality while running: the internal resolution follows, frames keep drawing, nothing is invalid', { skip }, async () => {
  const engine = await Engine.create({ platform: makePlatform({ width: 256, height: 144 }), quality: 'high' });
  const r = engine.stage.renderer, gpu = r.gpu;
  gpu.errors.length = 0;
  redBallScene(engine);
  engine.run(6, 1 / 60);
  const hi = { w: r.width, shadow: r.q.shadowSize };
  assert.equal(hi.w, Math.round(256 * 0.77));
  for (const [name, scale] of [['low', 0.5], ['medium', 0.67], ['ultra', 1], ['high', 0.77]]) {
    engine.stage.setQuality(name);
    assert.equal(engine.stage.quality, name);
    assert.equal(r.width, Math.round(256 * scale), `${name}: internal width`);
    engine.run(6, 1 / 60);
    const img = await engine.screenshot();
    assert.ok(luma(px(img, 128, 4)) > 50, `${name}: still draws the sky`);
    const ball = px(img, 128, 144 * 0.5);
    assert.ok(ball[0] > ball[2] * 1.4, `${name}: the ball is red ${ball}`);
  }
  engine.stage.setQuality('no-such-quality');
  assert.equal(engine.stage.quality, 'high', 'an unknown name changes nothing');
  assert.deepEqual(gpu.errors, [], 'no GPU validation errors across every switch');
  engine.dispose();
});

test('Engine.dispose releases the GPU device quietly, leaves a surface it was handed alone, and can be called twice', { skip }, async () => {
  const mine = new OneFrameSurface({ width: 64, height: 36 });
  let handedInDestroyed = false;
  mine.destroy = () => { handedInDestroyed = true; };
  const engine = await Engine.create({ platform: makePlatform({ width: 64, height: 36 }), surface: mine, quality: 'low' });
  const gpu = engine.stage.renderer.gpu;
  redBallScene(engine);
  engine.run(3, 1 / 60);
  const pending = engine.stage.capture();                      // a capture nobody will ever draw
  const logged = [], original = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    engine.dispose();
    engine.dispose();
    const info = await Promise.race([gpu.device.lost, new Promise((r) => setTimeout(() => r(null), 5000))]);
    assert.ok(info, 'the device reported its loss');
    assert.equal(info.reason, 'destroyed');
    assert.equal(gpu.lost.reason, 'destroyed');
  } finally { console.error = original; }
  assert.deepEqual(logged, [], 'destroying it ourselves is not an error to log');
  assert.equal(handedInDestroyed, false, 'a surface the caller made is the caller\'s to destroy');
  await assert.rejects(pending, /disposed/);
});

test('Engine.dispose destroys the surface the engine made itself', { skip }, async () => {
  const engine = await Engine.create({ platform: makePlatform({ width: 64, height: 36 }), quality: 'low' });
  const surface = engine.stage.surface, destroy = surface.destroy.bind(surface);
  let destroyed = 0;
  surface.destroy = () => { destroyed++; destroy(); };
  engine.dispose();
  engine.dispose();
  assert.equal(destroyed, 1, 'once, however many times dispose is called');
});
