# Med Engine 3, native

The engine runs outside the browser on [Deno](https://deno.com), which has WebGPU built in (wgpu, the same library Firefox
uses). `main.js` here starts the demo level, The Ford, with `DenoPlatform` instead of `BrowserPlatform`. Nothing else changes:
the level is `demo/game.js`, the same file the web page runs.

Needs Deno 2.9 or newer.

| What | Command (from this folder) | Tested here? |
| --- | --- | --- |
| Render offscreen and save a picture | `deno task shot` | yes |
| One executable file, assets inside | `deno task compile` (writes `../dist/ford`, about 100 MB: the Deno runtime is in it) | yes, run headless from another folder |
| A window from source | `deno task ford` | no (no display where this was written) |
| An app with a window (`.app`, `.exe`, Linux binary) | `deno task app` (`deno desktop`) | no |

Options for `main.js`: `--headless`, `--frames N`, `--png FILE`, `--size 1280x720`, `--quality low|medium|high|ultra`.

The compile and app tasks pass `--no-check`, and so does `npm run test:deno`. The engine is JavaScript, and `npm test` checks its
types. Deno's own check stops on this folder: it sees the `package.json` and asks for `@types/node`.

## The window: what is known and what is not

`deno.json` asks `deno desktop` for its **raw** backend: Deno opens a native window and hands the engine its keyboard and mouse
events and a WebGPU surface, with no web engine in between. `DenoPlatform` is written against Deno's documentation of that
backend, but it has not run, so treat it as a first draft:

- the event field names are the likeliest thing to need a fix (the documentation says they "mirror their browser equivalents");
- the raw backend does not document gamepads, pointer lock, fullscreen or the cursor, so `DenoPlatform` reports
  `capabilities.gamepad = false` and `pointerLock = false`, and `main.js` turns the view whenever the mouse moves instead of
  waiting for a pointer lock;
- the conversation with the ferryman is HTML in the browser; in a window its lines are printed to the terminal.

If the raw backend gives trouble, `deno desktop --backend cef` opens a Chromium window on the same page the browser build
uses (`demo/index.html` with `BrowserPlatform`): full WebGPU, gamepads and pointer lock, at the cost of a bigger app.

## Without a GPU

Deno finds Vulkan drivers through `VK_ICD_FILENAMES`. On a machine without a GPU, point it at the SwiftShader driver that
comes with every Chromium or Playwright download (`node tools/software-gpu.mjs` prints where it is). It is slow, and its
timings say nothing about real GPUs.
