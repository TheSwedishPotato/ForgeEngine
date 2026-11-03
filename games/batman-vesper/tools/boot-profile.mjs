// Times the film's start-up phases (window.__mark) headless:  node tools/boot-profile.mjs [high|low]
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright');
const server = await createServer({ root: process.cwd(), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => { if (m.text().startsWith('[boot]')) console.log(m.text()); });
await p.addInitScript(() => {
  const t0 = performance.now(); window.__mark = (s) => console.log('[boot]', s, Math.round(performance.now() - t0));
});
await p.goto(server.resolvedUrls.local[0] + 'index.html?q=' + (process.argv[2] ?? 'high'));
await p.waitForFunction(() => document.getElementById('menu')?.classList.contains('on'), null, { timeout: 600000 });
await p.evaluate(() => window.__mark('menu on'));
await b.close(); await server.close();
