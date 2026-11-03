// Turns `vite build` output (dist/) into two artifact pages for claude.ai, each with a folder of
// the files it needs, laid out at their published paths, and the list to publish them with:
//   dist-artifact/film.html  + dist-artifact/film/  + film.publish.json   (the 3D film)
//   dist-artifact/story.html + dist-artifact/story/ + story.publish.json  (the illustrated story)
// The host supplies <!doctype>/<html>/<head>/<body>; the page is its title, styles and body.
// Artifacts serve text, images, scripts and media but no raw binary, so binary payloads (the
// characters' .binz, glTF buffers) travel as base64 text (`x.binz.b64.txt`) and the page loads
// packed.js first, which tells the engine to read them that way (medengine/src/world/Packed.js).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeBase64 } from '../../../medengine/src/world/Packed.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist'), OUT = join(ROOT, 'dist-artifact');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const BINARY = new Set(['.binz', '.bin', '.glb']);
const TYPE = { '.gltf': 'application/json' };     // served, but not inferred from the extension

function page(src, title) {
  let html = readFileSync(join(DIST, src), 'utf8');
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) => readFileSync(join(DIST, m[1]), 'utf8'));
  html = html.replace(/<link rel="stylesheet"[^>]*>/g, '').replace(/<link rel="modulepreload"[^>]*>/g, '');
  const scripts = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
  // module scripts run in document order: packed.js sets the flag before the game's code runs
  const tags = ['packed.js', ...scripts].map((s) => `<script type="module" src="./${s}"></script>`).join('\n');
  return `<title>${title}</title>\n<style>${css.join('\n')}</style>\n${body}\n${tags}\n`;
}

const js = walk(join(DIST, 'assets')).filter((p) => p.endsWith('.js') && !/\/(lab|stills)-/.test(p));
const targets = {
  film: { src: 'index.html', title: 'Batman: Vesper', dirs: ['assets/humans', 'assets/tex', 'assets/models'] },
  story: { src: 'story.html', title: 'Vesper Illustrated', dirs: ['stills'] },
};
for (const [name, t] of Object.entries(targets)) {
  writeFileSync(join(OUT, `${name}.html`), page(t.src, t.title));
  const dir = join(OUT, name), list = [];
  const put = (rel, write) => { const to = join(dir, rel); mkdirSync(dirname(to), { recursive: true }); write(to); const e = { path: rel }; if (TYPE[extname(rel)]) e.contentType = TYPE[extname(rel)]; list.push(e); };
  put('packed.js', (to) => writeFileSync(to, 'globalThis.MED_PACKED = true;\n'));
  for (const f of [...js, ...t.dirs.flatMap((d) => walk(join(DIST, d)))]) {
    const rel = relative(DIST, f);
    if (BINARY.has(extname(f))) put(rel + '.b64.txt', (to) => writeFileSync(to, encodeBase64(new Uint8Array(readFileSync(f)))));
    else put(rel, (to) => copyFileSync(f, to));
  }
  writeFileSync(join(OUT, `${name}.publish.json`), JSON.stringify(list));
  const sizes = list.map((e) => statSync(join(dir, e.path)).size);
  console.log(`${name}: ${list.length} files, ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB (largest ${(Math.max(...sizes) / 1e6).toFixed(1)} MB)`);
}
