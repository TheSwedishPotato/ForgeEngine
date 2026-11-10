#!/usr/bin/env node
/**
 * Builds the one-file browser build: dist/medengine.min.js (+ .map), the whole engine and the browser platform as one minified
 * ES module, for pages without a bundler and for seeing what a game downloads.
 *
 *   npm run build                    needs esbuild while it runs (npm i -D esbuild); the engine itself has no dependencies
 *   node tools/build.mjs --out dir   write somewhere else
 *
 * After building, the file is imported back and its exports are compared with its source (src/bundle.js): a build that lost or
 * renamed an export fails here rather than in a game. Games with a bundler (Vite, esbuild, Rollup) import 'medengine' instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ENTRY = path.join(ROOT, 'src', 'bundle.js');

/** The `esbuild` package, or null when it is not installed (found the way `require` finds packages, NODE_PATH included). */
export async function loadEsbuild() {
  try { return createRequire(import.meta.url)('esbuild'); } catch { return null; }
}

/**
 * Builds into `outDir` and checks the result. Returns `{ file, bytes, gzip, exports, missing, extra, inputs }`.
 * `missing` / `extra` list the export names the built file lacks or adds compared with src/bundle.js (both empty when all is well);
 * `inputs` are the source files that went in.
 */
export async function build({ esbuild, outDir = path.join(ROOT, 'dist') } = {}) {
  esbuild ??= await loadEsbuild();
  if (!esbuild) throw new Error('tools/build.mjs needs the `esbuild` package: npm i -D esbuild');
  const file = path.join(outDir, 'medengine.min.js');
  const result = await esbuild.build({
    entryPoints: [ENTRY], outfile: file, bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, sourcemap: true, legalComments: 'none', metafile: true, logLevel: 'silent',
  });
  if (result.errors.length) throw new Error(result.errors.map((e) => e.text).join('\n'));
  const code = fs.readFileSync(file);
  const built = Object.keys(await import(`${pathToFileURL(file).href}?t=${Date.now()}`)).sort();
  const source = Object.keys(await import(pathToFileURL(ENTRY).href)).sort();
  return {
    file, bytes: code.length, gzip: zlib.gzipSync(code, { level: 9 }).length, exports: built,
    missing: source.filter((n) => !built.includes(n)), extra: built.filter((n) => !source.includes(n)),
    inputs: Object.keys(result.metafile.inputs),
  };
}

async function main(argv) {
  let outDir = path.join(ROOT, 'dist');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') outDir = path.resolve(argv[++i] ?? '');
    else { console.error(`unknown option ${argv[i]}`); process.exit(2); }
  }
  const esbuild = await loadEsbuild();
  if (!esbuild) { console.error('tools/build.mjs needs the `esbuild` package: npm i -D esbuild'); process.exit(2); }
  const r = await build({ esbuild, outDir });
  if (r.missing.length || r.extra.length) {
    console.error(`the build does not export what src/bundle.js does: missing ${r.missing.join(', ') || '-'}; extra ${r.extra.join(', ') || '-'}`);
    process.exit(1);
  }
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`${path.relative(process.cwd(), r.file) || r.file}: ${kb(r.bytes)} (${kb(r.gzip)} gzipped), ${r.exports.length} exports, ${r.inputs.length} source files`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
