# Assets

`engine.assets` is an `AssetManager`. It loads everything through the platform, so the same call reads a URL in a browser and
a file on Node or Deno. Paths are resolved against the engine's `baseUrl`. Every asset is loaded once: a second
`load()` of the same path, even while the first is still loading, gets the same result.

```js
const knight = await engine.assets.load('models/knight.glb');      // the type comes from the extension
scene.add(knight.scene);
const grass = await engine.assets.load('tex/grass.png');           // a Texture
const story = await engine.assets.json('story/ford.story.json');
const clips = await loadClipLibrary(engine.assets, 'assets/anim/humanoid');

engine.assets.onProgress(({ done, total }) => bar.style.width = `${(100 * done) / total}%`);
const level = await engine.assets.loadAll({
  knight: 'models/knight.glb',
  ground: { url: 'tex/grass.png', type: 'texture' },
  walk:   'mocap/walk.bvh',
});
```

| Type | From | Gives |
| --- | --- | --- |
| `gltf` | `.glb`, `.gltf` | `GLTFAsset`: `scene`, `animations`, `clip(name)`, `materials`, `cameras`, `lights`, `warnings` |
| `obj` | `.obj` (+ `.mtl`) | a `Group` of meshes with their materials |
| `texture` | `.png`, `.jpg`, `.webp` | a `Texture`, mip-mapped. It is read as sRGB in the colour slots (`map`, `emissiveMap`) and as linear data in the others. |
| `clip` | `.medclip` | an `AnimationClip` (see [ANIMATION.md](ANIMATION.md)) |
| `bvh` | `.bvh` | `BVHData`. Retarget it with `retargetBVH`. |
| `json`, `text`, `bytes` | anything | parsed JSON, a string, a `Uint8Array` |

Node decodes PNG only. Deno decodes PNG itself, and other formats where it has `createImageBitmap`. A browser decodes every
image format it knows.

## glTF 2.0

**Supported:**

- **Scenes and nodes**, with unique names (animations find bones by name) and `extras` merged into `userData`.
- **Meshes:** triangles (strips and fans are converted), positions, normals, the first UV set, vertex colours and skin weights;
  sparse, interleaved and quantised data (`KHR_mesh_quantization`); and morph targets (positions).
- **Materials:** metal-rough PBR with base colour, metallic-roughness, normal, occlusion and emissive textures, alpha modes and
  double-sided. Also `KHR_materials_unlit`, `emissive_strength`, `clearcoat`, `sheen` and `specular`, `pbrSpecularGlossiness`
  (approximated) and `ior`. `KHR_texture_transform` works on the base colour only. `EXT_texture_webp` is supported.
- **Skins**, and **animations** of translation, rotation, scale and morph weights. Step and cubic-spline keys are baked to
  linear keys.
- **Punctual lights** (`KHR_lights_punctual`).

**Not supported.** Loading says so instead of drawing a wrong picture:

- Draco, meshopt and Basis/KTX2 compressed files. Decompress them first, for example with `npx @gltf-transform/cli`.
- glTF 1.0.
- Morph normals and tangents (ignored).
- A second UV set.
- `KHR_materials_transmission`, `volume`, `iridescence` and `anisotropy` (ignored, with a warning).
- `KHR_animation_pointer`.

An animated glTF character becomes an `Actor` with `Actor.load(engine, url)`. To share the engine's clips its bones need the
engine's names ([ANIMATION.md](ANIMATION.md)).

## Characters from Med Engine 2

`Human` loads the characters Med Engine 2's builder makes from MakeHuman data (`tools/human/build.mjs`): the body,
Catmull-Clark subdivision at load, face shapes, eyes, hair and clothes. `new Actor(human, { clips })` animates one. The loader
is tested against a synthetic character in the same format, not yet against a real MakeHuman export. `attachScanHead(gltf.scene)`
prepares a scanned head (a glTF with the 52 ARKit face shapes as morph targets) for the face system, so an actor can emote
and lip-sync with it. No scans ship.

## Cloning

`cloneModel(gltf.scene)` deep-copies a loaded model, with skeletons rebound to the copy's bones. That is how several actors
share one file. `disposeModel(root)` frees the GPU resources under `root`, shared ones included, so call it only for a model nothing else
uses.
