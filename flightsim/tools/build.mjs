// Bundles the simulator:
//   dist/SK1415.html          one self-contained page (double-click to play; three.js loads from jsDelivr)
//   dist/web/                 index.html + sim.js + style.css for hosting
//   <out>/sk1415-fragment.html body-only page for embedding (pass --fragment <dir>)
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const web = path.join(dist, 'web');
fs.mkdirSync(web, { recursive: true });
const fragArg = process.argv.indexOf('--fragment');
const fragDir = fragArg > 0 ? process.argv[fragArg + 1] : null;

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'esm', minify: true, write: false, target: 'es2020',
  external: ['three', 'three/addons/*'], legalComments: 'none',
});
const js = result.outputFiles[0].text;
fs.writeFileSync(path.join(web, 'sim.js'), js);

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
fs.writeFileSync(path.join(web, 'style.css'), css);
fs.writeFileSync(path.join(web, 'index.html'), html.replace('src="src/main.js"', 'src="sim.js"'));

// Single-file page: body content only (title, fonts, styles, import map, markup, inline module).
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const fonts = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts[^>]*>/g)].map((m) => m[0]).join('\n');
const importmap = html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0];
const app = html.slice(html.indexOf('<!--APP-->') + 10, html.indexOf('<!--/APP-->'));
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const body = `${importmap}\n${app}\n<script type="module">\n${safeJs}\n</script>\n`;
const head = `<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${title}\n${fonts}\n<style>\n${css}\n</style>`;
const standalone = `<!doctype html>\n<html lang="en">\n<head>\n${head}\n</head>\n<body>\n${body}</body>\n</html>\n`;
fs.writeFileSync(path.join(dist, 'SK1415.html'), standalone);
if (fragDir) fs.writeFileSync(path.join(fragDir, 'sk1415-fragment.html'), `${title}\n${fonts}\n<style>\n${css}\n</style>\n${body}`);
console.log(`dist/web/sim.js ${(js.length / 1024).toFixed(0)} KB · dist/SK1415.html ${(standalone.length / 1024).toFixed(0)} KB${fragDir ? ' · fragment written' : ''}`);
