// The benchmark page in a real browser: scenes run on the browser's own WebGPU device and canvas, and what the page shows is what it measured.
//
//   npm run test:browser
//
// Without a GPU this measures a software renderer (the page says so, and so does the test), so the numbers are only checked for being
// real and consistent, never for being fast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { skip, open, photo } from './helpers.js';

test('bench/ runs its scenes in the browser, reports them in the table and in window.benchResult, and flags a software renderer', { skip, timeout: 280000 }, async () => {
  const { page, problems, close } = await open({ path: 'bench/', query: '?auto=1&scenes=physics,lights&frames=10&warmup=2&size=256x144&quality=low', size: [900, 760] });
  try {
    await page.waitForFunction(() => window.benchResult, null, { timeout: 250000 });
    const r = await page.evaluate(() => window.benchResult);

    assert.deepEqual(r.results.map((x) => x.scene), ['lights', 'physics'], 'the scenes run in the order of the list on the page');
    assert.deepEqual(r.size, [256, 144], 'any WIDTHxHEIGHT in the address is honoured');
    assert.equal(r.quality, 'low');

    const [lights, physics] = r.results;
    assert.equal(physics.frames, 10);
    assert.equal(physics.renderer, null, 'the physics scene does not draw');
    assert.equal(physics.gpu, null);
    assert.equal(physics.bodies, 400);
    assert.ok(physics.cpu.simMs.median > 0 && physics.msPerFrame > 0 && physics.fps > 0);
    assert.equal(physics.cpu.renderMs, null, 'no frames were drawn, so there is no draw time to report');

    assert.ok(lights.renderer.drawCalls > 50 && lights.renderer.triangles > 1000, `the lights scene drew ${lights.renderer.drawCalls} calls and ${lights.renderer.triangles} triangles`);
    assert.ok(lights.renderer.lights >= 100, `${lights.renderer.lights} lights reached the renderer`);
    assert.ok(lights.cpu.renderMs.median > 0);
    assert.ok(lights.msPerFrame > 0);
    assert.deepEqual(lights.gpuErrors, [], 'no WebGPU validation errors');
    if (r.adapter.timestamps) {
      assert.ok(lights.gpu, 'the adapter has timestamp queries, so GPU time was measured');
      assert.ok(lights.gpu.frames >= 5, `${lights.gpu.frames} frames were timed`);
      assert.ok(lights.gpu.spanMs.median > 0);
      assert.equal(lights.gpu.untimed, 0);
      assert.ok(lights.gpu.passes.some((p) => p.name === 'lighting'), 'passes are named');
    } else assert.equal(lights.gpu, null, 'no timestamp queries: no GPU numbers, rather than invented ones');

    // what is on the page is what was measured
    const rows = await page.$$eval('#rows tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row[0]), ['lights', 'physics']);
    assert.equal(rows[0][6], String(lights.renderer.drawCalls), 'the draws column is the renderer\'s count');
    assert.equal(rows[1][6], '-', 'and a scene that draws nothing has none');
    assert.match(await page.textContent('#adapter'), /target: 256 × 144, quality low/);
    assert.equal(await page.isVisible('#warn'), r.adapter.software, 'the software-renderer warning is shown exactly when the adapter is one');
    assert.equal(await page.isDisabled('#save'), false, 'the results can be downloaded');
    assert.equal(await page.isDisabled('#run'), false, 'and the run can be repeated');
    await photo(page, 'browser-5-bench.png');
  } finally { await close(); }
  assert.deepEqual(problems, [], 'nothing in the console, no failed request');
});

test('bench/ says what is wrong when the browser has no WebGPU', { skip, timeout: 60000 }, async () => {
  const { page, problems, close } = await open({ path: 'bench/', gpu: false });
  try {
    await page.waitForFunction(() => /WebGPU/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    assert.equal(await page.isDisabled('#run'), true);
    assert.match(await page.textContent('#run'), /Not available/);
  } finally { await close(); }
  assert.deepEqual(problems, [], 'it explains itself on the page; it has nothing to complain about in the console');
});
