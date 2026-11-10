/**
 * Med Engine 3 as a native program on Deno: the demo level (The Ford) in a window of its own, or headless.
 *
 *   deno run -A --unstable-webgpu native/main.js --headless --frames 120 --png ford.png      render offscreen, save a picture
 *   deno run -A --unstable-webgpu native/main.js                                            a window when Deno can open one
 *   deno compile -A --unstable-webgpu --include assets --output ford native/main.js          one executable file (see README)
 *   cd native && deno desktop main.js                                                        an app with a window (see README)
 *
 * Options: --headless, --frames N (headless: frames to run, 120), --png FILE (headless: save the last frame), --size WxH (1280x720),
 * --quality low|medium|high|ultra (high).
 *
 * STATUS: the headless mode runs here, from source and as a `deno compile` executable. The window needs `deno desktop` (Deno 2.9's
 * "raw" backend) and could not be tried where this was written (no display); see native/README.md.
 *
 * This file only puts the parts together: the level is demo/game.js, the same code the browser page and the tests run.
 */
import { Engine } from '../src/index.js';
import { DenoPlatform } from '../src/platform/deno.js';
import { createGame } from '../demo/game.js';

const args = Deno.args;
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback; };
const [width, height] = (/^(\d+)x(\d+)$/.exec(value('size', '1280x720')) ?? [0, 1280, 720]).slice(1).map(Number);

const platform = new DenoPlatform({ headless: has('headless') ? true : undefined, title: 'Med Engine 3 · The Ford', width, height });
const engine = await Engine.create({ platform, quality: value('quality', 'high'), baseUrl: new URL('../', import.meta.url).href });

// The browser page shows the conversation in HTML. A native window has no HTML, so the lines go to the terminal.
const story = (view) => {
  if (!view) return;
  for (const line of view.lines) console.log(line.speaker ? `${line.speaker}: ${line.text}` : line.text);
  view.choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.text}${c.enabled ? '' : ' (not now)'}`));
};
const game = await createGame(engine, { ui: { story } });
// The demo turns the view with the mouse while the pointer is locked. A raw Deno window has no pointer lock (see README), so here
// the view turns whenever the mouse moves.
if (!platform.capabilities.pointerLock) engine.input.map({ look: { type: 'look', mouse: 'always', sensitivity: 0.0022, stick: 'Pad:rs', stickSpeed: 2.8 } });

if (platform.headless) {
  const frames = Math.max(1, Number(value('frames', 120)) | 0);
  const settle = Math.min(frames, 8);                               // the temporal filter wants a few drawn frames
  engine.run(frames - settle, 1 / 60, { draw: false });
  engine.run(settle);
  const png = value('png', null);
  if (png) { await engine.screenshotPNG(png); console.log(`${png}: ${width}x${height}, ${frames} frames, ${engine.stage.renderer.gpu.errors.length} GPU errors`); }
  game.dispose?.();
  engine.dispose();
} else {
  platform.setTitle('Med Engine 3 · The Ford  —  WASD move · mouse look · Space jump · F punch · G kick · E talk · C camera');
  engine.start();
}
