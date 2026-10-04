// Renders the commercial to an MP4: every frame from the page's own renderer,
// piped as JPEGs into ffmpeg, with the soundtrack rendered by an OfflineAudioContext.
// The narrator's browser voice cannot be captured offline, so the film carries
// music, effects and the burned-in captions.
//   node tools/render.mjs [out.mp4]      (FPS=30 by default)
//   AUDIO_ONLY=1 node tools/render.mjs   re-renders only the soundtrack into an existing MP4
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { serve } from './serve.mjs';

const fps = Number(process.env.FPS || 30);
const out = resolve(process.argv[2] || new URL('../dist/golden-gauntlet-1403.mp4', import.meta.url).pathname);
await mkdir(dirname(out), { recursive: true });
const wavPath = out.replace(/\.mp4$/, '.wav');

const server = await serve(5194);
const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
for (let attempt = 1; ; attempt++) {
  await page.goto('http://localhost:5194/commercial.html?render=1');
  await page.waitForFunction(() => window.commercial);
  if (await page.evaluate(() => window.commercial.ready())) break;
  if (attempt === 4) throw new Error('fonts did not load');
}
const duration = await page.evaluate(() => window.commercial.DURATION);

console.log('soundtrack…');
await writeFile(wavPath, Buffer.from(await page.evaluate(() => window.commercial.soundtrack(48000)), 'base64'));

if (process.env.AUDIO_ONLY) {
  // Keep the rendered picture, replace the sound.
  const tmp = out.replace(/\.mp4$/, '.tmp.mp4');
  await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, '-i', wavPath, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', tmp], { stdio: 'inherit' })
    .on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  await rename(tmp, out);
  await browser.close(); server.close();
  console.log('remuxed', out);
  process.exit(0);
}

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
  '-i', wavPath,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart',
  out,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));

const frames = Math.round(duration * fps);
const t0 = Date.now();
for (let i = 0; i < frames; i++) {
  const url = await page.evaluate((t) => window.commercial.frame(t), i / fps);
  if (!ff.stdin.write(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % (fps * 5) === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
ff.stdin.end();
await done;
await browser.close();
server.close();
console.log('wrote', out);
