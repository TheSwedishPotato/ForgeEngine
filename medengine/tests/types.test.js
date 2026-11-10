// The TypeScript declarations in types/ are generated from the doc comments in src/ (tools/types.mjs). These tests hold them to
// what they promise: they are the code's own, they compile, they accept the code people write, they refuse the mistakes people
// make, they name what the package really exports, and the typing only gets better.
//
// They need the `typescript` package (npm i -D typescript) and skip, saying so, when it is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generate, verify, readDir, exportedNames, loadTypeScript } from '../tools/types.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = path.join(ROOT, 'types');
const USAGE = path.join(ROOT, 'tests', 'types', 'usage.ts');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ts = loadTypeScript();
const skip = ts ? false : 'needs the typescript package: npm i -D typescript';

const show = (diagnostics) => ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => ROOT, getCanonicalFileName: (f) => f, getNewLine: () => '\n' });
const NODE16 = () => ({ module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 });

/** Compiles `files` the way a strict TypeScript project would. `overrides` change the options. */
function compile(files, overrides = {}) {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], types: [], strict: true, noEmit: true, skipLibCheck: false, ...overrides,
  });
  return { program, diagnostics: ts.getPreEmitDiagnostics(program) };
}

/** How many `any` keywords a declaration file spells out. */
function countAny(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  let n = 0;
  (function visit(node) { if (node.kind === ts.SyntaxKind.AnyKeyword) n++; ts.forEachChild(node, visit); })(source);
  return n;
}

/** The same declaration text with every parameter and every property of a type literal typed `any`: the declarations after a careless edit. */
function loosen(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
  const f = ts.factory, any = () => f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
  const transformer = (context) => (root) => {
    const visit = (node) => {
      node = ts.visitEachChild(node, visit, context);
      if (ts.isParameter(node)) return f.updateParameterDeclaration(node, node.modifiers, node.dotDotDotToken, node.name, node.questionToken, node.type ? any() : undefined, node.initializer);
      if (ts.isPropertySignature(node)) return f.updatePropertySignature(node, node.modifiers, node.name, node.questionToken, node.type ? any() : undefined);
      return node;
    };
    return ts.visitNode(root, visit);
  };
  const result = ts.transform(source, [transformer]);
  return ts.createPrinter().printFile(result.transformed[0]);
}

test('types/ is what the source produces', { skip }, () => {
  const { files, problems, version } = generate({ ts });
  assert.equal(problems, '', `the doc comments do not compile:\n${problems}`);
  const have = readDir(TYPES);
  const names = (o) => Object.keys(o).sort();
  assert.deepEqual(names(have), names(files), 'types/ has other files than the source produces: run `npm run types`');
  const wrote = /\(typescript ([^)]+)\)/.exec(Object.values(have)[0] ?? '')?.[1];
  let stale;
  if (wrote === version) {
    stale = names(files).filter((k) => have[k] !== files[k]);
  } else {
    // another TypeScript version prints some types differently, so compare what each file exports instead of its text
    const list = (text) => [...exportedNames(text)].sort().join(' ');
    stale = names(files).filter((k) => list(have[k]) !== list(files[k]));
  }
  assert.deepEqual(stale, [], `types/ is out of date (${stale.length} file${stale.length === 1 ? '' : 's'}): run \`npm run types\``);
});

test('the declarations compile on their own, strictly, with skipLibCheck off, under bundler and node16 resolution', { skip }, () => {
  assert.equal(verify({ ts, dir: TYPES }), '', 'the declarations have errors of their own');
  const all = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.d.ts')) all.push(p); } })(TYPES);
  assert.ok(all.length >= 70, `${all.length} declaration files`);
  // node16 wants a file extension on every relative import in an ES module: a declaration that leaves it out is unusable there
  const { diagnostics } = compile(all, NODE16());
  assert.equal(show(diagnostics), '', 'the declarations do not compile under node16 resolution');
});

test('a realistic TypeScript program compiles against them, and its fifteen deliberate mistakes are all refused', { skip }, () => {
  const marked = [...fs.readFileSync(USAGE, 'utf8').matchAll(/^\s*\/\/ @ts-expect-error/gm)].length;
  assert.ok(marked >= 12, `${marked} deliberate mistakes in usage.ts`);
  // TypeScript reports a @ts-expect-error that has no error under it, so a type that went loose fails here as a type that went strict does
  for (const [label, overrides] of [['bundler', {}], ['node16', NODE16()]]) {
    const { program, diagnostics } = compile([USAGE], overrides);
    assert.equal(show(diagnostics), '', `tests/types/usage.ts does not compile (${label} resolution)`);
    const reached = program.getSourceFiles().filter((s) => s.fileName.startsWith(TYPES + path.sep)).length;
    assert.ok(reached >= 40, `the program only reached ${reached} declaration files: its imports are not reaching types/`);
  }
});

test('that check can fail: with the declarations loosened to any, most of the deliberate mistakes go unnoticed', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medengine-loose-'));
  try {
    const all = readDir(TYPES);
    for (const [name, text] of Object.entries(all)) {
      const file = path.join(dir, 'types', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, loosen(text, name));
    }
    const usage = path.join(dir, 'tests', 'types', 'usage.ts');
    fs.mkdirSync(path.dirname(usage), { recursive: true });
    fs.copyFileSync(USAGE, usage);
    const { diagnostics } = compile([usage], { skipLibCheck: true });
    const unused = diagnostics.filter((d) => d.code === 2578);               // "Unused '@ts-expect-error' directive"
    assert.ok(unused.length >= 10, `only ${unused.length} of the mistakes in usage.ts slipped through loose declarations: the program does not test the types`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the declarations name exactly the values the code exports, for the root and for every subpath', { skip }, async () => {
  const entries = Object.entries(pkg.exports).filter(([, v]) => typeof v === 'object' && v.types);
  assert.ok(entries.length >= 15, `${entries.length} entry points`);
  // the bundle is a build output (npm run build): its source is src/bundle.js, and tests/build.test.js holds the built file to it
  const source = (v) => (v.default.startsWith('./dist/') ? './src/bundle.js' : v.default);
  const { program } = compile(entries.map(([, v]) => path.join(ROOT, v.types)));
  const checker = program.getTypeChecker();
  for (const [key, v] of entries) {
    const file = program.getSourceFile(path.join(ROOT, v.types));
    const moduleSymbol = checker.getSymbolAtLocation(file);
    assert.ok(moduleSymbol, `${v.types} is not a module`);
    const declared = new Set();
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const real = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (real.flags & ts.SymbolFlags.Value) declared.add(symbol.name);       // types and interfaces exist only for the compiler
    }
    const runtime = new Set(Object.keys(await import(pathToFileURL(path.join(ROOT, source(v))).href)));
    const untyped = [...runtime].filter((n) => !declared.has(n)).sort();
    const missing = [...declared].filter((n) => !runtime.has(n)).sort();
    assert.deepEqual({ entry: key, untyped, missing }, { entry: key, untyped: [], missing: [] },
      `${key}: "untyped" is exported by the code but not declared, "missing" is declared but the code does not export it`);
    assert.ok(declared.size > 0, `${key} declares nothing`);
  }
});

test('every subpath a game can import resolves to its declarations, as TypeScript finds them through the exports map', { skip }, () => {
  const from = USAGE;                                                         // inside the package, which can import itself by name
  let checked = 0;
  for (const [label, options] of [['bundler', { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }], ['node16', NODE16()]]) {
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key === './package.json') continue;
      const specifier = key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`;
      const found = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
      assert.ok(found, `${specifier} does not resolve under ${label} resolution`);
      assert.equal(path.resolve(found.resolvedFileName), path.join(ROOT, entry.types), `${specifier} (${label}) resolves to the wrong declarations`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `${checked} subpath resolutions`);
});

test('typing only gets better: the finished parts have no any, and the total does not grow', { skip }, () => {
  // Parts that are completely typed. Adding one `any` to them fails here; when you finish another part, add it to the list.
  const finished = ['Stage', 'engine/Engine', 'cinema/Director', 'math/core', 'math/geometry', 'anim/Humanoid', 'anim/Procedural', 'physics/World', 'story/fuzz'];
  for (const part of finished) {
    const n = countAny(path.join(TYPES, `${part}.d.ts`));
    assert.equal(n, 0, `types/${part}.d.ts spells out ${n} any: type what it takes and returns in its doc comments`);
  }
  // Actor takes events with payloads of any shape, on purpose: that is its one `any`.
  assert.ok(countAny(path.join(TYPES, 'human', 'Actor.d.ts')) <= 1, 'Actor has more than its one deliberate any');
  let total = 0, files = 0;
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.d.ts')) { total += countAny(p); files++; } } })(TYPES);
  // The ceiling is where typing stood when this test was written. Lower it when you type more; it must never go up.
  const CEILING = 986;
  assert.ok(total <= CEILING, `${total} any in ${files} declaration files; the ceiling is ${CEILING}. New code needs its types in doc comments`);
});
