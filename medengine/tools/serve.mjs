#!/usr/bin/env node
/**
 * A small static file server for running the engine in a browser: no dependencies, no build step.
 *
 *   node tools/serve.mjs [page] [--port 8080] [--host 127.0.0.1]
 *   npm run demo                     # = node tools/serve.mjs demo
 *
 * It serves the whole package (the demo imports ../src/index.js) with the right MIME types for every asset the engine loads
 * (.js, .json, .binz, .medclip, .bvh, .glb, .png ...). WebGPU only exists in a secure context, and http://localhost counts as
 * one; a page served to another machine over plain http does not, so `--host 0.0.0.0` is for networks you trust AND a browser
 * that is told to treat the address as secure (chrome://flags/#unsafely-treat-insecure-origin-as-secure) - or put https in front.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.bvh': 'text/plain; charset=utf-8', '.medclip': 'application/octet-stream', '.binz': 'application/octet-stream',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.map': 'application/json; charset=utf-8',
};

/**
 * Starts the server.
 * @param {object} [o]
 * @param {string} [o.root]    folder to serve (default: the package)
 * @param {number} [o.port]    first port to try; if it is taken the next ones are tried (0: any free port)
 * @param {string} [o.host]    default 127.0.0.1
 * @param {string} [o.page]    what '/' redirects to, default 'demo'
 * @returns {Promise<{ server, url, port, close(): Promise<void> }>}
 */
export async function startServer({ root = ROOT, port = 8080, host = '127.0.0.1', page = 'demo' } = {}) {
  root = path.resolve(root);
  const handler = (req, res) => {
    const fail = (code, msg) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'method not allowed');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return fail(400, 'bad request'); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return fail(400, 'bad path'); }
    if (rel === '/' && page) { res.writeHead(302, { Location: `/${page.replace(/^\/+|\/+$/g, '')}/` }); return res.end(); }
    if (rel.includes('\0')) return fail(400, 'bad path');
    const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    // never leave the root, and never hand out dotfiles (.git, .env ...)
    if (file !== root && !file.startsWith(root + path.sep)) return fail(403, 'forbidden');
    if (path.relative(root, file).split(path.sep).some((p) => p.startsWith('.'))) return fail(403, 'forbidden');
    fs.stat(file, (err, st) => {
      if (err) return fail(404, `not found: ${rel}`);
      if (st.isDirectory()) {
        if (!rel.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' + url.search }); return res.end(); }
        return send(path.join(file, 'index.html'));
      }
      send(file, st);
    });
    function send(f, st) {
      const go = (stat) => {
        const type = MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        const s = fs.createReadStream(f);
        s.on('error', () => res.destroy());
        s.pipe(res);
      };
      if (st) return go(st);
      fs.stat(f, (e, stat) => (e || !stat.isFile() ? fail(404, `not found: ${rel}`) : go(stat)));
    }
  };

  const server = http.createServer(handler);
  const listen = (p) => new Promise((resolve, reject) => {
    const onError = (e) => { server.off('listening', onListening); reject(e); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListening);
    server.listen(p, host);
  });
  let tries = 0;
  for (;;) {
    try { await listen(port === 0 ? 0 : port + tries); break; } catch (e) {
      if (e.code === 'EADDRINUSE' && port !== 0 && ++tries < 20) continue;
      throw e;
    }
  }
  const actual = server.address().port;
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host === '127.0.0.1' ? 'localhost' : host;
  return {
    server, port: actual, url: `http://${shown}:${actual}/`,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

// ---- command line
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v ?? fallback; };
  const port = Number(opt('--port', process.env.PORT ?? 8080)), host = opt('--host', '127.0.0.1');
  const page = args.find((a) => !a.startsWith('-')) ?? 'demo';
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error(`serve: bad port "${port}"`); process.exit(2); }
  const s = await startServer({ port, host, page });
  console.log(`Med Engine 3 dev server: ${s.url}${page}/   (Ctrl+C to stop)`);
  if (host !== '127.0.0.1' && host !== 'localhost') console.log('note: WebGPU needs https or localhost; other machines will not get a GPU from a plain http address.');
  process.on('SIGINT', () => { s.close().then(() => process.exit(0)); });
}
