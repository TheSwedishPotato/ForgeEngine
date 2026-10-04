// Turns the single-file build into an artifact page (the host supplies the
// <!doctype>/<html>/<head>/<body> skeleton). Run after `vite build --mode single`.
import { readFileSync, writeFileSync } from 'node:fs';

let html = readFileSync('dist-single/index.html', 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<html[^>]*>/i, '')
  .replace(/<\/html>/i, '')
  .replace(/<head>/i, '')
  .replace(/<\/head>/i, '')
  .replace(/<body>/i, '')
  .replace(/<\/body>/i, '')
  .replace(/<meta charset="utf-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(title, '');
// Move the (inline module) script after the markup it drives.
const script = html.match(/<script type="module"[\s\S]*?<\/script>/)[0];
html = html.replace(script, '');
html = `${title}\n${html.trim()}\n${script}\n`;
writeFileSync('dist-single/zweikampf-1403.html', html);
console.log('artifact page:', (html.length / 1024).toFixed(0), 'KB');
