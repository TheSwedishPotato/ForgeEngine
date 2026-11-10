# Platforms: browser, Node, Deno, native

Med Engine 3 is a WebGPU engine with no WebGL in it, and it does not need a browser. Everything that depends on where it runs
sits behind one class, `Platform`:

- getting a GPU;
- a drawing surface;
- the frame clock;
- keyboard, mouse and gamepad events;
- files and stored settings;
- image decoding.

The rest of the engine (math, scene, renderer, animation, physics, input, assets, story, camera) only talks to the platform it
was given.

| Platform | GPU | Surface | Input | Files | Status |
| --- | --- | --- | --- | --- | --- |
| `BrowserPlatform` (`medengine/platform/browser`) | `navigator.gpu` | a `<canvas>` that follows its CSS size and the device pixel ratio | DOM keyboard, pointer (with pointer lock), wheel and Gamepad API | `fetch`; `localStorage`; a download for `writeFile` | Tested in headless Chromium (SwiftShader) |
| `NodePlatform` (`medengine/platform/node`) | Dawn, from the optional `webgpu` package | An offscreen texture | Injected only | `node:fs`; a JSON file for storage | Tested (unit, GPU and benchmark suites) |
| `DenoPlatform` (`medengine/platform/deno`) | Deno's own WebGPU (wgpu); run with `--unstable-webgpu` | Offscreen, or a native window through `deno desktop` | Window events (keyboard, mouse); injected when headless | `Deno.readFile`; `localStorage` | Headless tested; **window untested** |

## Native: Deno, one executable, an app

Deno has WebGPU built in, so the engine runs there as a native program with no browser. `native/main.js` starts the demo level
that way:

```sh
deno run -A --unstable-webgpu native/main.js --headless --frames 120 --png ford.png   # offscreen, tested
cd native && deno task compile        # ../dist/ford: one executable with the assets inside, tested headless
cd native && deno task app            # deno desktop: a windowed app. NOT run yet (no display where this was written)
```

The windowed path uses `deno desktop` with its "raw" backend: a native window, keyboard and mouse events, and a WebGPU
surface, with no web engine. The platform code follows Deno's documentation, but has not run, so expect to fix event details
the first time. [native/README.md](../native/README.md) lists what is known. The fallback that assumes nothing is
`deno desktop --backend cef`, which shows the browser build in a Chromium window.

Why Deno rather than a Rust or C++ shell? It gives a native window, WebGPU through wgpu, file access and single-file
executables for Windows, macOS and Linux today, with the engine's code unchanged. A Rust shell over wgpu, or C++ over Dawn,
would need a JavaScript engine embedded in it to run this code. That is a much larger project, and the `Platform` class is
exactly the seam it would plug into.

## Writing a platform

Extend `Platform` and fill in what your host can do:

```js
import { Platform, Surface } from 'medengine';

class MyPlatform extends Platform {
  constructor() { super(); this.name = 'mine'; this.capabilities = { windowed: true, pointerLock: false, gamepad: false, fileWrite: true, jpeg: false }; }
  async getGPU() { return myHost.gpu; }                 // anything with requestAdapter()
  createSurface() { return new MySurface(); }           // a Surface: width, height, format, configure(gpu), getCurrentTexture(), present()
  requestFrame(cb) { return myHost.onNextFrame(cb); }
  async readFile(path) { return myHost.read(path); }    // Uint8Array
  // ... and emit what the host's window reports:
  //   this.emit('key', { code: 'KeyW', key: 'w', down: true, repeat: false })
  //   this.emit('pointer', { kind: 'move', id: 1, button: 0, buttons: 0, pointerType: 'mouse', x, y, dx, dy })
}
```

The events are:

- `key`, `pointer` and `wheel`;
- `blur` and `focus`;
- `visibility`;
- `pointerlock`;
- `gamepadconnected` and `gamepaddisconnected`;
- `close`.

`gamepads()` returns pads in the shape of the web Gamepad API. The test suites drive every platform through the same calls a
host would make (`injectKey`, `injectPointer`, `injectWheel`, `setGamepads`).

## Packaging

- **The exports map:** `medengine` (the root), plus subpaths for each part: `medengine/math`, `/scene`, `/anim`, `/physics`,
  `/input`, `/assets`, `/story`, `/human`, `/cinema`, `/audio`, `/ai` and `/platform/browser|node|deno`. Each has its
  TypeScript declarations. `sideEffects: false` lets bundlers drop what a game does not use.
- **`npm run build`** writes `dist/medengine.min.js`: the engine and the browser platform in one minified ES module, with a
  source map (`medengine/bundle`). It is for pages without a bundler.
- **One executable:** `deno compile`, as above.
