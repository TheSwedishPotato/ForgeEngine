import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

test('the exports map points at files that exist (only the bundle is a build output), and every part says where its types are', () => {
  const targets = [];
  for (const [key, v] of Object.entries(pkg.exports)) {
    for (const [cond, t] of typeof v === 'string' ? [['default', v]] : Object.entries(v)) targets.push([key, cond, t]);
  }
  assert.ok(targets.length >= 12, 'a real map');
  for (const [key, cond, t] of targets) {
    if (t.startsWith('./dist/')) continue;                         // made by `npm run build`
    assert.ok(fs.existsSync(path.join(ROOT, t)), `"${key}" (${cond}) points at ${t}, which does not exist`);
    if (cond === 'types') assert.ok(t.endsWith('.d.ts'), `"${key}": the types condition must be a declaration file`);
  }
  // TypeScript only finds the types of a subpath through a `types` condition, and it has to come first
  for (const [key, v] of Object.entries(pkg.exports)) {
    if (key === './package.json') continue;
    assert.equal(typeof v, 'object', `"${key}" needs { types, default }: without a types condition TypeScript sees no declarations for it`);
    assert.deepEqual(Object.keys(v), ['types', 'default'], `"${key}": types first, then default`);
  }
});

test('every part imports on its own in Node, and everything a part exports reaches the root', async () => {
  const root = await import(pathToFileURL(path.join(ROOT, pkg.exports['.'].default)).href);
  let parts = 0;
  for (const [key, entry] of Object.entries(pkg.exports)) {
    const v = typeof entry === 'string' ? entry : entry.default;
    if (key.startsWith('./platform/') || !v.startsWith('./src/') || key === '.') continue;
    const mod = await import(pathToFileURL(path.join(ROOT, v)).href);
    assert.ok(Object.keys(mod).length > 0, `${key} exports nothing`);
    for (const name of Object.keys(mod)) assert.ok(name in root, `${key} exports ${name}, which is missing from the root (two parts exporting one name drop it)`);
    parts++;
  }
  assert.ok(parts >= 10, `${parts} parts`);
  for (const k of ['browser', 'node', 'deno']) {
    const p = await import(pathToFileURL(path.join(ROOT, pkg.exports[`./platform/${k}`].default)).href);
    assert.ok(Object.keys(p).length > 0, `platform/${k}`);
  }
});

test('the root has what a game needs', async () => {
  const root = await import(pathToFileURL(path.join(ROOT, 'src/index.js')).href);
  const need = ['Engine', 'Stage', 'Renderer', 'Platform', 'Object3D', 'Mesh', 'PerspectiveCamera', 'Vector3', 'Matrix4', 'Quaternion',
    'Animator', 'StateMachine', 'AnimationClip', 'World', 'Character', 'Ragdoll', 'BoxCollider', 'PlaneCollider', 'InputManager',
    'AssetManager', 'StoryRunner', 'Human', 'Actor', 'Face', 'Director', 'attachScanHead', 'loadClipLibrary', 'pointOf', 'Audio', 'Claude'];
  for (const n of need) assert.ok(n in root, `${n} is not exported`);
});

test('the engine owns its stack: no dependencies, and no code from outside but Node builtins and the optional webgpu', () => {
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'no dependencies');
  assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), ['webgpu'], 'only the optional Node GPU binding');
  assert.equal(pkg.peerDependenciesMeta.webgpu.optional, true);
  const bare = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])([^\s'"./][^\s'"]*)\1/g;
  const seen = new Map();
  for (const file of [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tools'))]) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(bare)) {
      const spec = m[2];
      if (spec.startsWith('node:') || spec.includes('$')) continue;
      if (!seen.has(spec)) seen.set(spec, []);
      seen.get(spec).push(path.relative(ROOT, file));
    }
  }
  for (const [spec, files] of seen) {
    const ok = spec === 'webgpu' ? files.every((f) => f === path.join('src', 'platform', 'node.js'))
      : spec === 'esbuild' ? files.every((f) => f.startsWith('tools')) : spec === 'medengine' || spec.startsWith('medengine/');   // the package by its own name
    assert.ok(ok, `unexpected import of '${spec}' in ${files.join(', ')}`);
  }
  assert.ok(!seen.has('three'), 'three.js is gone');
});
