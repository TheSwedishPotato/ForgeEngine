// Turns `vite build` output (dist/) into two artifact pages for claude.ai, each with the list of
// files it needs beside it:
//   dist-artifact/film.html  + film.files.json   (the 3D film: code, humans, textures, models)
//   dist-artifact/story.html + story.files.json  (the illustrated story: code, stills)
// The host supplies <!doctype>/<html>/<head>/<body>; the page is its title, styles and body.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist'), OUT = join(ROOT, 'dist-artifact');
mkdirSync(OUT, { recursive: true });

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

function page(src, title) {
  let html = readFileSync(join(DIST, src), 'utf8');
  const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g)].map((m) => readFileSync(join(DIST, m[1]), 'utf8'));
  html = html.replace(/<link rel="stylesheet"[^>]*>/g, '').replace(/<link rel="modulepreload"[^>]*>/g, '');
  const scripts = [...html.matchAll(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
  const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
  return { text: `<title>${title}</title>\n<style>${css.join('\n')}</style>\n${body}\n${scripts.map((s) => `<script type="module" src="./${s}"></script>`).join('\n')}\n`, scripts };
}

const js = walk(join(DIST, 'assets')).filter((p) => p.endsWith('.js') && !/\/(lab|stills)-/.test(p));
const targets = {
  film: { src: 'index.html', title: 'Batman: Vesper', dirs: ['assets/humans', 'assets/tex', 'assets/models'] },
  story: { src: 'story.html', title: 'Vesper Illustrated', dirs: ['stills'] },
};
for (const [name, t] of Object.entries(targets)) {
  const p = page(t.src, t.title);
  writeFileSync(join(OUT, `${name}.html`), p.text);
  const files = {};
  for (const f of js) files[relative(DIST, f)] = relative(ROOT, f);
  for (const d of t.dirs) for (const f of walk(join(DIST, d))) files[relative(DIST, f)] = relative(ROOT, f);
  writeFileSync(join(OUT, `${name}.files.json`), JSON.stringify(files, null, 1));
  const bytes = Object.values(files).reduce((a, f) => a + statSync(join(ROOT, f)).size, 0);
  console.log(`${name}: ${Object.keys(files).length} files, ${(bytes / 1e6).toFixed(1)} MB`);
}
