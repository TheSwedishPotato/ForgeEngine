# TypeScript

The engine is plain JavaScript (ES modules, no build step), typed with doc comments. `types/` holds TypeScript declarations
generated from those comments, so the types are the code's own and cannot drift from it:

```sh
npm run types                       # regenerate types/ (needs the typescript dev dependency)
node tools/types.mjs --check        # fail when types/ is not what the source produces
```

Every entry of the exports map has its declarations (`medengine`, `medengine/physics`, `medengine/platform/node`, ...).
Editors pick them up in JavaScript projects too, for completion and hover docs.

## Using them

- Set `"moduleResolution"` to `"bundler"`, `"node16"` or `"nodenext"`. The subpaths (`medengine/physics`) are found through the
  exports map, which the old `"node"` resolution ignores.
- The declarations mention a few browser types (`AudioContext`, `ImageBitmap`, `AbortSignal`). Include the `"DOM"` lib, or set
  `"skipLibCheck": true`.
- TypeScript 6's DOM lib already contains WebGPU's types. Adding `@webgpu/types` on top makes the two collide, so leave it out.
  The engine itself passes GPU objects around as `GPUObject`, which is `any`.

## How far the typing goes

**Fully typed, with no `any`:**

- `Stage`, `Engine` and `Director`;
- `Actor`, apart from one deliberate `any`: the payload of custom events;
- the physics `World`;
- `math/core` and `math/geometry`;
- `Humanoid`, `Procedural` and the story fuzzer.

Typed in the parts a game calls, with some `any` in internals:

- the input manager's actions;
- the animator and state machine;
- the story runner;
- materials, lights and meshes;
- the asset manager;
- the platforms' public methods.

Still loose (parameters typed `any`):

- the scene graph's internals (`Object3D` and `BufferGeometry` methods);
- collision internals;
- renderer internals;
- the glTF loader's internals;
- `Clip`.

All told: 986 `any` across 80 declaration files, and 26 files without any. These are counted by syntax tree, not by text
search.

## What keeps them honest

`npm test` runs `tests/types.test.js`. It checks that:

- `types/` is exactly what the source produces;
- the declarations compile on their own with `strict` and `skipLibCheck: false`, under both bundler and node16 resolution;
- `tests/types/usage.ts`, a realistic program, compiles cleanly. It uses the engine, physics, input, actors, the camera, the
  story, assets and math;
- the same program's fifteen deliberate mistakes are all refused. Each is marked `@ts-expect-error`: a wrong event name, a shot
  type that does not exist, a material setting with a typo, a rigid body shaped like a cube, and so on;
- that check can fail: with the declarations loosened to `any`, most of the mistakes slip through;
- the declarations name exactly the values each entry point exports at runtime;
- each subpath resolves to its declarations through the exports map;
- the finished parts stay free of `any`, and the total does not grow. Lower the ceiling in the test when you type more.

When you add code, type it in its doc comment (`@param {number} dt`, `@returns {Vector3}`, `@typedef` for option objects).
Names starting with `_` are internal and stay out of the declarations.
