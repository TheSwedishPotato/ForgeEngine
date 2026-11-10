# Performance: measuring on real hardware

**Every frame rate measured while building Med Engine 3 came from SwiftShader**, a software Vulkan driver that runs on the CPU.
Those numbers prove the benchmark works. They say nothing about how the engine runs on a graphics card. The tools below are
for measuring it on yours.

## The benchmark on Node (Dawn)

```sh
npm install                 # brings the optional `webgpu` package (Dawn)
npm run bench               # all scenes, 1280x720, quality high, 120 frames after 30 warm-up frames
npm run bench -- --scenes ford,crowd --size 1920x1080 --quality ultra --frames 300 --json results.json
```

| Scene | What it loads |
| --- | --- |
| `ford` | The demo level: the player runs circles. One sun with cascaded shadows, a lantern, three characters and seven rigid bodies. |
| `crowd` | 40 skinned characters walking in rings, each with mocap mixing over 60 bones and a capsule controller |
| `lights` | 160 point lights over a field of pillars (the tiled lighting) |
| `draws` | 3600 separate meshes in view, all casting shadows: the cost of draw calls |
| `physics` | 400 spheres and capsules tumbling in a box, with no drawing |

The columns:

| Column | Meaning |
| --- | --- |
| `ms/frame` | Wall-clock time per frame, with the CPU and GPU overlapping and no vsync |
| `cpu sim` | Input, physics, animation and update hooks |
| `cpu draw` | Recording and submitting the frame |
| `gpu span` | How long the frame occupied the GPU, from timestamp queries |
| `draws`, `triangles` | Per frame |

After the table come the most expensive GPU passes per scene. The first lines name the adapter, and a software adapter is flagged
in capitals. `--software` points Vulkan at SwiftShader, for machines without a GPU; the benchmark never does that by itself.

## In a browser

`npm run demo`, then open http://localhost:8080/bench/ to run the same scenes on a real canvas with the browser's compositor.
Results appear in a table and in `window.benchResult`. A software adapter is flagged on the page.

In the demo itself, `?gpu=1` adds a line to the HUD with the GPU time of a frame and of its three most expensive passes.
`?quality=` and `?scale=` fix the quality and the internal resolution.

## In code

```js
engine.stage.enableGpuTiming();        // false when the device lacks 'timestamp-query'
// ... a few frames later:
engine.stage.gpuTimes;                 // { spanMs, sumMs, passes: { gbuffer: 0.8, lighting: 1.4, 'shadow cascade 0': 0.3, ... } }
engine.stats;                          // { fps, frameMs, steps, simMs, renderMs }
engine.stage.renderer.stats;           // { drawCalls, triangles, items, culled, lights, shadowedLights, cpuMs }
```

Browsers round GPU timestamps to 0.1 ms unless Chrome runs with `--enable-webgpu-developer-features`, so short passes read 0.0
or 0.1 there. Dawn on Node is exact.

## What was measured here (CPU only, 2 vCPUs)

These are CPU-side numbers, so a graphics card should change them little. SwiftShader was rendering on the same two cores, so the
draw figure may be inflated:

- `physics`: 400 bodies take about **2.6 ms per step**.
- `draws`: recording 6355 draw calls (3600 meshes, plus their shadow passes) takes about **29.6 ms** of CPU per frame. Large
  scenes of separate meshes are CPU-bound here; `InstancedMesh` turns thousands of copies into one draw.

## Worth checking first on a real GPU

- Whether `high` holds 60 fps at 1080p in `ford`. Its internal resolution is 0.77 of the display, upscaled by the temporal pass.
- The cost of `lights` against `ford`: the tiled lighting with 160 lights.
- `crowd`: 40 characters. The animation is sampled and mixed on the CPU; the skinning runs in the vertex shader.
- How `cpu draw` in `draws` compares with `gpu span`. Whichever is larger is the bottleneck to work on.
