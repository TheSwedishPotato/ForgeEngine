import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// The Med Engine 2 lives in ../../medengine/src (one engine for every game). One copy of three.js
// serves both. In development /claude/* is forwarded to api.anthropic.com with the
// ANTHROPIC_API_KEY of the shell that ran `npm run dev`, so the key never reaches the page.
function claudeProxy() {
  return {
    name: 'claude-proxy',
    configureServer(server) {
      server.middlewares.use('/claude', async (req, res) => {
        const key = process.env.ANTHROPIC_API_KEY;
        if (req.url === '/__status') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: !!key })); return; }
        if (!key) { res.statusCode = 503; res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: 'ANTHROPIC_API_KEY is not set where `npm run dev` runs' } })); return; }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': req.headers['anthropic-version'] ?? '2023-06-01' };
        try {
          const r = await fetch('https://api.anthropic.com' + req.url, { method: req.method, headers, body: req.method === 'GET' ? undefined : Buffer.concat(chunks) });
          res.statusCode = r.status;
          for (const h of ['content-type', 'request-id', 'retry-after']) if (r.headers.get(h)) res.setHeader(h, r.headers.get(h));
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message: e.message } })); }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 5199), strictPort: !!process.env.PORT, hmr: process.env.NOHMR ? false : undefined, fs: { allow: ['../..'] } },
  resolve: { alias: { three: fileURLToPath(new URL('./node_modules/three', import.meta.url)) }, dedupe: ['three'] },
  worker: { format: 'es' },
  plugins: [claudeProxy(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 6000, assetsInlineLimit: 0,
    rollupOptions: { input: { index: 'index.html', lab: 'lab.html' } } },
}));
