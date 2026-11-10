// The one-file browser build (npm run build -> dist/medengine.min.js). Needs esbuild (npm i -D esbuild) and skips, saying so,
// when it is not installed. Builds into a temporary folder, so the dist/ you have is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, loadEsbuild, ENTRY } from '../tools/build.mjs';

const esbuild = await loadEsbuild();
const skip = esbuild ? false : 'needs the esbuild package: npm i -D esbuild';

test('the browser build is one module with every export of the engine and the browser platform, and nothing for Node', { skip, timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medengine-build-'));
  try {
    const r = await build({ esbuild, outDir: dir });
    assert.deepEqual({ missing: r.missing, extra: r.extra }, { missing: [], extra: [] }, 'the built file exports what src/bundle.js exports');
    for (const name of ['Engine', 'Stage', 'Actor', 'Director', 'World', 'InputManager', 'AssetManager', 'StoryRunner', 'BrowserPlatform']) {
      assert.ok(r.exports.includes(name), `${name} is in the build`);
    }
    assert.ok(r.exports.length > 150, `${r.exports.length} exports`);
    // a page loads this file: none of the Node or Deno platform code (file system, Dawn) may be in it
    const sources = r.inputs.map((f) => f.split(path.sep).join('/'));
    assert.ok(sources.some((f) => f.endsWith('src/platform/browser.js')));
    assert.deepEqual(sources.filter((f) => /src\/platform\/(node|deno)\.js$|node_modules\//.test(f)), [], 'no Node or Deno platform code');
    assert.ok(!/\bfrom\s*["']node:|import\(\s*["']node:/.test(fs.readFileSync(r.file, 'utf8')), 'no node: imports');
    assert.ok(fs.existsSync(`${r.file}.map`), 'with a source map');
    // a size guard, so a build that suddenly drags in something big is noticed (it was 462 KB, 158 KB gzipped, when written)
    assert.ok(r.bytes < 700 * 1024 && r.gzip < 240 * 1024, `${(r.bytes / 1024).toFixed(0)} KB, ${(r.gzip / 1024).toFixed(0)} KB gzipped`);
    assert.ok(path.isAbsolute(ENTRY));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
