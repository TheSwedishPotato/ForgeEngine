# Engine and Stage

`Engine` runs a game: the loop, the systems, physics, input, assets and the renderer. `Stage` is the renderer with a scene, a
camera and the look of the current shot. The engine owns a stage, and you can use a stage on its own for tools and viewers.

```js
import { Engine } from 'medengine';
import { BrowserPlatform } from 'medengine/platform/browser';

const engine = await Engine.create({ platform: new BrowserPlatform({ canvas }), quality: 'high' });
engine.add(mySystem);
engine.start();
```

`Engine.create(options)` needs a `platform`, which can be a `BrowserPlatform`, `NodePlatform` or `DenoPlatform`
([PLATFORM.md](PLATFORM.md)). The other options:

| Option | Default | |
| --- | --- | --- |
| `render` | `true` | `false`: no GPU and no window. Use it for game logic on a server, or for tests. `engine.stage` is then `null`. |
| `quality` | `'high'` | `'low'`, `'medium'`, `'high'` or `'ultra'`. Change it while running with `engine.stage.setQuality()`. |
| `renderScale` | the quality's | Internal resolution relative to the display, 0.25 to 1.5. The temporal upscaler restores the rest. |
| `fixedStep` | `1/60` | Simulation step in seconds |
| `maxSteps` | `6` | Fixed steps allowed per frame |
| `maxFrame` | `0.1` | The longest frame that counts. After a stall the game goes on; it does not race to catch up. |
| `physics` | | `World` options: `gravity`, `substeps`, `iterations`, ... |
| `input` | | `deadzone`, and `lockOnClick` to capture the mouse on a click |
| `camera` | | The default camera: `fov` in degrees (35), `near` (0.03 m), `far` (1500 m) |
| `baseUrl` | `''` | The folder or URL that relative asset paths are resolved against |
| `assets` | | `AssetManager` options, for example `{ gltf: { castShadow: false } }` |

What you get back: `engine.scene`, `engine.camera`, `engine.input` ([INPUT.md](INPUT.md)), `engine.physics`
([PHYSICS.md](PHYSICS.md)), `engine.assets` ([ASSETS.md](ASSETS.md)) and `engine.stage`.

## The frame

Each frame the engine:

1. reads input;
2. runs as many fixed steps as the elapsed time asks for. Each step calls `fixedUpdate` on every system, steps physics, then calls `afterPhysics`;
3. calls `update`, then `lateUpdate`, on every system once;
4. draws.

Systems are plain objects with any of these hooks:

```js
engine.add({
  onAdd(engine) {},                 // when added
  fixedUpdate(dt, engine) {},       // 60 Hz, before physics: apply input to characters and bodies
  afterPhysics(dt, engine) {},      // 60 Hz, after physics: read the results
  update(dt, engine) {},            // once per frame: animation, camera, UI
  lateUpdate(dt, engine) {},        // once per frame, after every update (the Director moves the camera here)
  dispose(engine) {},
});
```

`Actor`, `Director` and `StorySystem` are systems: `engine.add(actor)` is all they need. `engine.add()` returns what it was
given, so `const director = engine.add(new Director(engine))` works.

Inside a fixed step, `input.pressed()` means "pressed since the last fixed step", so a tap is seen exactly once even when a
frame runs two steps or none. In `update` it means "since the last frame". `engine.alpha` (0..1) says how far into the next
fixed step the frame is; actors use it to draw smoothly between steps.

Time:

- `engine.timeScale` slows the game (0.2 is slow motion).
- `engine.paused` stops simulated time. Input, updates and drawing go on, with `dt` 0.
- `engine.time` is simulated seconds, and `engine.frame` and `engine.stepCount` count frames and steps.
- `engine.stats` holds the smoothed timings: `{ fps, frameMs, steps, simMs, renderMs }`.

Events carry the same values as the hooks:

```js
const off = engine.on('update', (dt, engine) => { /* ... */ });
engine.on('error', (err) => console.error(err));   // the real-time loop reports a frame that threw, and goes on
off();
```

The event names are `fixedUpdate`, `afterPhysics`, `update`, `lateUpdate`, `render` (with the real frame time, just before
drawing) and `error`.

## Driving the loop yourself

`engine.start()` and `engine.stop()` run in real time on the platform's frame callback. Tests, tools and replays step the engine
themselves:

```js
engine.run(120);                      // 120 frames of 1/60 s each: deterministic
engine.run(600, 1 / 60, { draw: false });   // simulate without drawing
await engine.runAsync(60);            // lets promises (await actor.walkTo(...)) settle between frames
engine.tick(0.016);                   // one frame of real time
```

Pictures:

- `await engine.screenshot()` returns `{ width, height, data }` (RGBA8).
- `await engine.screenshotPNG('shot.png')` writes a file on Node and Deno, and offers a download in a browser.

`engine.dispose()` frees everything, including the GPU device.

## Stage: the look of the shot

| | |
| --- | --- |
| `stage.grade` | The colour grade: lift, gamma, gain, white balance, saturation, contrast and more. Change its fields in place; the Director sets them per shot. |
| `stage.shake` | An impact kick, from 0 to 1 and more. It decays by itself. |
| `stage.shadowFocus = { center, radius }` | A tight, high-resolution shadow around the action. The demo keeps it on the player. |
| `stage.lens` | `{ focus, aperture, focal, amount, pull }`. Tracked and animated by the Director, but **no depth-of-field pass reads it yet**. |
| `stage.setQuality(name)` / `stage.quality` | Switch quality while running |
| `stage.enableGpuTiming()` / `stage.gpuTimes` | GPU milliseconds per frame and per pass ([PERFORMANCE.md](PERFORMANCE.md)) |
| `stage.renderer.wetness`, `.rain` | 0..1. Rain on surfaces: porous materials darken, puddles with ripples form (`puddles: true` materials), and water runs down walls (`streaks: true`). |
| `await stage.capture()` | The last frame as RGBA8 |

A stage on its own, for a model viewer or a tool:

```js
import { Stage } from 'medengine';
const stage = await Stage.create({ platform, quality: 'medium' });
stage.scene.add(model);
stage.render(1 / 60);
```

## The renderer, in order

Sun shadow cascades and a focus shadow → G-buffer → local lights: up to 256 point, spot and tube lights, culled per 32-pixel
tile, with spot shadows in an atlas → deferred lighting with image-based sky light and contact shadows → skin subsurface
scattering → temporal anti-aliasing and upscaling → auto exposure → bloom → film composite (tonemap, grade, grain) → sharpening.

The quality tiers set the internal resolution (ultra 1.0, high 0.77, medium 0.67, low 0.5), the shadow map size and cascade
count, and whether skin scattering, contact shadows and the focus shadow run.

Materials are `StandardMaterial` (metal-rough PBR) with a shading model in `medType`: `'skin'`, `'coat'`, `'cloth'`,
`'foliage'`, `'eye'`, `'hair'` and others. Transparency is dithered (`transparent`, `opacity`, `dither`) and smoothed by
the temporal filter. There is no blended forward pass, so there is no glass yet.
