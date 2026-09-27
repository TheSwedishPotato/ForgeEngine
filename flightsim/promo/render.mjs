// Renders promo/film.html frame by frame and encodes promo/out/SAS-80-fan-film.mp4.
// usage: node promo/render.mjs            (needs Playwright + Chromium, ffmpeg on PATH or FFMPEG=/path)
//        python3 promo/music.py first to make the soundtrack.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'out');
const FPS = 30;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// serve the folder from a same-origin URL: images loaded from file:// would taint the canvas
await page.route('http://film.local/**', (route) => {
  const f = path.join(DIR, decodeURIComponent(new URL(route.request().url()).pathname));
  if (!f.startsWith(DIR) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
  const type = { '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png' }[path.extname(f)] || 'application/octet-stream';
  return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
});
await page.goto('http://film.local/film.html?render');
await page.evaluate(() => window.FILM.ready);
const duration = await page.evaluate(() => window.FILM.DURATION);

const music = path.join(OUT, 'music.wav');
const args = ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
if (fs.existsSync(music)) args.push('-i', music, '-c:a', 'aac', '-b:a', '192k', '-shortest');
args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', path.join(OUT, 'SAS-80-fan-film.mp4'));
const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(duration * FPS);
for (let i = 0; i < frames; i++) {
  const b64 = await page.evaluate((tt) => { window.FILM.draw(tt); return document.getElementById('c').toDataURL('image/jpeg', 0.95).split(',')[1]; }, i / FPS);
  if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 150 === 0) console.log(`frame ${i}/${frames}`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log('done:', path.join(OUT, 'SAS-80-fan-film.mp4'));
