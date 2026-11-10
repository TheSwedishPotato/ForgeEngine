#!/usr/bin/env node
/**
 * Serves the simulator to a browser: `npm start`, then open the address it prints. Nothing to install or build; the page loads
 * the engine's source straight from ../medengine. WebGPU needs a secure context, which http://localhost is.
 *
 *   node serve.mjs [--port 8080] [--host 127.0.0.1]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../medengine/tools/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const serve = (o = {}) => startServer({ root: path.resolve(here, '..'), page: 'flightsim', ...o });

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
  const s = await serve({ port: Number(arg('--port', process.env.PORT ?? 8080)), host: arg('--host', '127.0.0.1') });
  console.log(`Skyhawk is at ${s.url}flightsim/   (Ctrl+C to stop)`);
  process.on('SIGINT', () => s.close().then(() => process.exit(0)));
}
