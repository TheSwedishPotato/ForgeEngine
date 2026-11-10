// The demo in a real browser: Chromium's own WebGPU, real DOM events, the real BrowserPlatform, fetch() for assets and the HTML overlay.
// Everything else in the test suite runs headless on Node or Deno; this is the only place the browser platform is exercised.
//
//   npm run test:browser
//
// Needs Playwright with a Chromium build (an optional dev tool: the test is skipped when it is missing). Without a GPU, Chromium
// is pointed at its bundled SwiftShader Vulkan driver, which is slow (about a frame a second at this size), so the test steps the
// engine by hand and draws only a few frames. MED_REAL_GPU=1 leaves the machine's own GPU in charge. MED_SHOTS=<dir> keeps the
// page screenshots, for looking at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, launch, open as openPage, photo } from './helpers.js';

const open = (o) => openPage({ path: 'demo/', ...o });

test('the demo in Chromium: boots, plays with real key events, talks through the HTML panel, draws the level', { skip, timeout: 280000 }, async () => {
  const { page, problems, close } = await open({ query: '?quality=low&scale=0.5' });
  try {
    await page.waitForSelector('#play:not([disabled])', { timeout: 120000 });
    assert.match(await page.textContent('#status'), /low/, 'the start card says which adapter and quality it got');
    assert.equal(await page.isVisible('#splash'), true);

    // from here on the test owns the clock: a software GPU is far too slow for the real-time loop to be any use
    const run = (n, draw = false) => page.evaluate(([n, d]) => window.medengineDemo.engine.run(n, 1 / 60, { draw: d }), [n, draw]);
    const get = (fn, arg) => page.evaluate(fn, arg);
    await page.evaluate(() => window.medengineDemo.engine.stop());
    await run(60);
    await photo(page, 'browser-1-splash.png');

    // Enter starts the game: the card goes, the HUD comes
    await page.keyboard.press('Enter');
    assert.equal(await page.isVisible('#splash'), false);
    assert.equal(await page.isVisible('#hud'), true);
    assert.deepEqual(await get(() => { const e = document.getElementById('hud-times'); return { hidden: e.hidden, text: e.textContent }; }), { hidden: true, text: '' }, 'no GPU timing line unless ?gpu=1 asks for it');
    assert.equal(await get(() => window.medengineDemo.engine.stage.renderer.timer), null, 'and nothing is being measured');
    assert.equal(await get(() => window.medengineDemo.game.director.mode), 'follow', 'the title camera is handed back to the player');
    await run(30);

    // W held on a real keyboard (DOM keydown -> BrowserPlatform -> InputManager -> the game) runs the player forward
    const z0 = await get(() => window.medengineDemo.game.player.position.z);
    await page.keyboard.down('KeyW');
    await run(90);
    await page.keyboard.up('KeyW');
    const z1 = await get(() => window.medengineDemo.game.player.position.z);
    assert.ok(z0 - z1 > 3, `ran ${(z0 - z1).toFixed(2)} m forward in 1.5 s`);
    await run(60);
    assert.equal(await get(() => window.medengineDemo.game.player.state), 'idle');

    // go to the ferryman and talk: E opens the panel, which is plain DOM built from the story's view
    await get(() => { const g = window.medengineDemo.game; g.player.place([-7, 0, -1.2], 270); });
    await run(60);
    assert.match(await page.textContent('#hint'), /talk to the ferryman/i);
    await page.keyboard.press('KeyE');
    await run(10);
    assert.equal(await page.isVisible('#story'), true);
    const first = await get(() => window.medengineDemo.game.story.view.lines[0].text);
    assert.ok(first.length > 10);
    assert.ok((await page.textContent('#story')).includes(first.slice(0, 30)), 'the panel shows the story text');
    const choices = await page.locator('#story .choice').count();
    assert.equal(choices, await get(() => window.medengineDemo.game.story.view.choices.length), 'one row per choice');
    assert.ok(choices >= 1);
    const node0 = await get(() => window.medengineDemo.game.story.view.id);

    // a real mouse click on a choice moves the story on (and only once: a click is not also a key press)
    await page.locator('#story .choice').first().click();
    await run(5);
    const node1 = await get(() => window.medengineDemo.game.story.view.id);
    assert.notEqual(node1, node0, 'the click chose');
    assert.equal(await get(() => window.medengineDemo.game.story.history.length), 2, 'exactly one step: the start node and the next');

    // keys reach the story too: the number key picks, Escape leaves
    await page.keyboard.press('Escape');
    await run(5);
    assert.equal(await page.isVisible('#story'), false, 'Escape closes the conversation');
    assert.equal(await get(() => window.medengineDemo.game.talking), false);

    // R (a real key again) resets the level: back at the start, with the camera snapped behind the player and looking down the
    // meadow. That is the view to judge the picture by: next to the hut, where the talk ended, its roof fills the top of the frame.
    await page.keyboard.press('KeyR');
    await run(5);
    const back = await get(() => window.medengineDemo.game.player.position.toArray());
    assert.ok(Math.hypot(back[0], back[2] - 9) < 0.5, `R puts the player back at the start: ${back.map((v) => v.toFixed(2))}`);
    assert.equal(await get(() => window.medengineDemo.game.director.mode), 'follow');

    // look at it: the engine's own capture (one frame is drawn for it on a canvas) and the page as the compositor shows it
    await run(4, true);
    const stats = await get(async () => {
      const img = await window.medengineDemo.engine.screenshot();
      const at = (x, y) => { const o = (Math.round(y) * img.width + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
      const rows = (y0, y1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = y0 | 0; y < y1; y += 2) for (let x = 0; x < img.width; x += 2) { const p = at(x, y); r += p[0]; g += p[1]; b += p[2]; n++; } return [r / n, g / n, b / n]; };
      return { width: img.width, height: img.height, sky: rows(img.height * 0.02, img.height * 0.2), grass: rows(img.height * 0.85, img.height * 0.98), gpuErrors: window.medengineDemo.engine.stage.renderer.gpu.errors };
    });
    assert.ok(stats.width >= 200 && stats.height >= 100, `captured ${stats.width}x${stats.height}`);
    const luma = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    assert.ok(luma(stats.sky) > 70, `the sky is bright: ${stats.sky.map(Math.round)}`);
    assert.ok(stats.grass[1] > stats.grass[0] * 1.15 && stats.grass[1] > stats.grass[2] * 1.3, `the ground is green: ${stats.grass.map(Math.round)}`);
    assert.deepEqual(stats.gpuErrors, [], 'no WebGPU validation errors');
    await photo(page, 'browser-2-play.png');
  } finally { await close(); }
  assert.deepEqual(problems, [], 'nothing in the console, no failed request');
});

test('the start card says so when the browser has no WebGPU', { skip, timeout: 60000 }, async () => {
  const { page, problems, close } = await open({ gpu: false });
  try {
    await page.waitForFunction(() => document.getElementById('status').classList.contains('bad'), null, { timeout: 30000 });
    assert.match(await page.textContent('#status'), /WebGPU/);
    assert.equal(await page.isDisabled('#play'), true);
    assert.equal(await page.isVisible('#splash'), true);
    await photo(page, 'browser-3-no-webgpu.png');
  } finally { await close(); }
  // the page logs the failure itself (console.error) and that is the only thing it may log
  assert.ok(problems.every((p) => /WebGPU/.test(p)), problems.join('\n'));
});

test('opened from disk the page explains why it cannot start', { skip, timeout: 60000 }, async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(new URL('../../demo/index.html', import.meta.url).href);
    assert.match(await page.textContent('#status'), /npm run demo/);
    assert.equal(await page.isDisabled('#play'), true);
  } finally { await browser.close(); }
});

test('?gpu=1 puts the GPU time of a frame and of its costliest passes in the HUD', { skip, timeout: 280000 }, async () => {
  const { page, problems, close } = await open({ query: '?quality=low&scale=0.5&gpu=1', size: [480, 270] });
  try {
    await page.waitForSelector('#play:not([disabled])', { timeout: 120000 });
    await page.evaluate(() => window.medengineDemo.engine.stop());
    await page.keyboard.press('Enter');
    const run = (n, draw) => page.evaluate(([n, d]) => window.medengineDemo.engine.run(n, 1 / 60, { draw: d }), [n, draw]);
    const supported = await page.evaluate(() => window.medengineDemo.engine.stage.renderer.gpu.hasTimestamps);
    assert.equal(await page.isVisible('#hud-times'), true);

    if (!supported) {                                          // a browser or adapter without timestamp queries: it says so instead of showing zeros
      await run(16, false);
      assert.match(await page.textContent('#hud-times'), /no timestamp queries/);
      return;
    }
    assert.match(await page.textContent('#hud-times'), /measuring/, 'before the first frame has come back');
    await run(30, false);

    // the read-backs arrive as promises, which cannot run inside a synchronous run(): draw a few frames, then give the page a moment
    for (let batch = 0; batch < 2; batch++) {
      await run(3, true);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
    }
    // refresh the HUD and read it in the same turn, so the line and the numbers it was made from cannot have moved apart
    const got = await page.evaluate(() => {
      const e = window.medengineDemo.engine, t = e.stage.renderer.timer;
      e.run(16, 1 / 60, { draw: false });
      return { line: document.getElementById('hud-times').textContent, avg: t.avg, samples: t.samples, untimed: t.untimed, errors: e.stage.renderer.gpu.errors };
    });
    assert.ok(got.samples >= 4, `${got.samples} frames were measured`);
    assert.equal(got.untimed, 0, 'every pass of the frame has a time');

    const [head, ...top] = got.line.split(' · ');
    const span = /^gpu (\d+\.\d) ms$/.exec(head);
    assert.ok(span, `the line starts with the frame time: "${got.line}"`);
    assert.equal(span[1], got.avg.spanMs.toFixed(1), 'and it is the smoothed time the GPU spent on a frame');
    assert.ok(got.avg.spanMs > 0);
    assert.equal(top.length, 3, 'then the three costliest passes');
    const shown = top.map((t) => { const m = /^(.+) (\d+\.\d)$/.exec(t); assert.ok(m, `"${t}" is a pass and its milliseconds`); return { name: m[1], ms: m[2] }; });
    for (const { name, ms } of shown) assert.equal(ms, got.avg.passes[name]?.toFixed(1), `${name} is a pass of the frame, with its own time`);
    const smallest = Math.min(...shown.map((s) => got.avg.passes[s.name]));
    for (const [name, ms] of Object.entries(got.avg.passes)) if (!shown.some((s) => s.name === name)) assert.ok(ms <= smallest, `${name} (${ms.toFixed(2)}) is cheaper than the cheapest one shown (${smallest.toFixed(2)})`);
    assert.deepEqual(shown.map((s) => Number(s.ms)), shown.map((s) => Number(s.ms)).sort((a, b) => b - a), 'costliest first');
    for (const pass of ['gbuffer', 'lighting', 'composite']) assert.ok(pass in got.avg.passes, `the ${pass} pass is timed under its own name`);
    assert.deepEqual(got.errors, [], 'no WebGPU validation errors');
    await photo(page, 'browser-4-gpu-times.png');
  } finally { await close(); }
  assert.deepEqual(problems, [], 'nothing in the console, no failed request');
});
