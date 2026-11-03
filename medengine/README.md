# Med Engine 2

The engine behind *Zweikampf 1403*, *Gotthard Pullman*, *Fleet Boat*, *Verkstan* and the other
ForgeEngine games — taken out of the duel's folder, made into its own package, and rebuilt for
cinematic, character-driven games. First game on it: **BATMAN: VESPER** (`../games/batman-vesper`).

WebGL2, JavaScript, three.js as the scene graph only: every pixel is drawn by the engine.

```
medengine/
  src/
    Stage.js              the whole frame pipeline in one object (scene, camera, lens, grade)
    Renderer.js           deferred PBR renderer (G-buffer, shadows, lighting, passes)
    human/                digital humans
      Human.js              loads built characters; Catmull-Clark subdivision at load; morph faces
      Subdivision.js        Catmull-Clark as a linear operator (stencils carry weights and shapes)
      Rig.js                the pose language and its solver (two-bone IK, pole vectors, hands)
      Moves.js              the pose and clip library (guards, punches, falls, perches, steering...)
      Face.js               emotions, blinks, saccades, lip-sync from text (52 ARKit units)
      Actor.js              posture -> gait -> clips -> breathing -> look-at -> face, garments, hand props (phone, pistol)
      Garments.js           cowl, belt, sigil, buzz cut built from the body surface; the cape
      Cloth.js              CPU Verlet cloth (capes, coat tails)
    lights/LightGrid.js   tiled point / spot / tube lights, spot-shadow atlas, volumetric lights
    passes/               SkinSSS (separable subsurface scattering), Post (film composite,
                          anamorphic streaks, grading), ScreenSpace, Volumetrics (+ fog glow,
                          local lights), TAA, DOF, motion blur, GPU particles, ...
    weather/              Rain (GPU streaks + depth-buffer splashes), Weather (rain, wind,
                          lightning with thunder, wetness)
    cinema/Director.js    the virtual cinematographer: shot grammar, lenses, moves, focus
    audio/Audio.js        procedural ambience, sfx, generative score, reverb spaces, voices
    ai/Claude.js          Claude through claude.ai (artifact `sample`), a dev proxy, or a key
    world/Kit.js          PBR materials, metre-UV geometry, glTF props, skylines, signs
  tools/human/            the character builder (MakeHuman CC0 data -> engine files)
  tests/                  node --test
```

## What changed: Med Engine 1 → 2

| | Med Engine 1 (as found) | Med Engine 2 |
| --- | --- | --- |
| **Where it lives** | inside `games/duel1403/src/engine`; other games reach in with `../../../duel1403/...` | its own package, `medengine/`, with `Stage` as the one entry point |
| **People** | capsule mannequins: no faces, ball hands | full digital humans from CC0 MakeHuman data: shaped bodies (age, sex, build, height in metres, 600+ detail targets), skins, eyes, brows, lashes, teeth, hair, fitted clothes, a 55-bone rig, **subdivided at load** (13k → 53k vertices) |
| **Faces** | none | the **52 ARKit face shapes** as GPU morph targets; emotions, blinks, saccades, **lip-sync from text** |
| **Animation** | physics ragdolls, a walker | a **pose language** with two-bone IK and pole vectors, a clip system, procedural gait with planted feet, look-at with eyes, breathing |
| **Garments** | banners, knight capes on GPU cloth | layered fitted clothes (whatever an outer layer covers is **tucked under it**: no poke-through), re-dyed materials (leather, wool), the **cowl / belt / sigil** cut from the body surface, CPU cloth capes, **hand props** (phone, pistol) on the hand bone |
| **Local lights** | 8 unshadowed point lights | **256 point, spot and fluorescent-tube lights**, culled per 32-px tile; **16 shadowed spots** in a 4096² atlas; lights scatter in fog and rain |
| **Skin** | wrapped diffuse | **separable subsurface scattering** (sum-of-Gaussians skin profile, world-scaled), pores and micro-normals, eye and hair shading |
| **Weather** | fog, mist | **rain** (40k GPU streaks lit by the tile lights, depth-buffer splashes), **wet surfaces** (porosity darkening, puddles with raindrop ripples, water running down walls), **lightning** with delayed thunder, light-pollution haze |
| **Sky** | an autumn afternoon | day, dusk, **night over a city** (cloud deck lit from below), storms, lightning in the clouds |
| **Lens** | DOF, motion blur, ACES | plus **anamorphic streaks**, halation, a **per-shot grade** (lift/gamma/gain, split toning, white balance), 2.39:1 letterbox, lens rain, film grain |
| **Camera** | an orbit rig | a **virtual cinematographer**: ECU→EWS, OTS, two-shots, POV, inserts; lenses in mm; push/pull/orbit/crane/track; handheld; focus pulls |
| **Story & AI** | per-game | a branching **story runner** (choices, timers, QTEs, negotiations with a meter, exploration, flowchart, saves) and **Claude** for free text, characters and endless continuation |
| **Sound** | per-game | an engine module: ambience beds, 25 sfx, generative score, reverb per place, optional voices |
| **Tests** | physics suites | subdivision, face, pose, layering and Claude-bridge unit tests; 1,500 random full playthroughs of the story per run; headless renders and full auto playthroughs |

## How good is it — honestly

Scored against the bar this project set itself: *a cinematic PC game in the style of Detroit:
Become Human* (Quantic Dream's engine = 10, a AAA team with performance-captured actors).

| | Med Engine 1 | Med Engine 2 |
| --- | --- | --- |
| Rendering technology (lighting, shadows, GI, post) | 6.5 | 8 |
| Characters (look) | 1 | 5.5 |
| Character performance (animation, faces) | 1.5 | 4.5 |
| Night, rain, atmosphere | 3 | 7 |
| Cinematography (camera, lens, grade) | 3 | 7.5 |
| Interactive story, choices, AI | 3 | 8 |
| Sound | 4 | 5 |
| Engineering (structure, reuse, tests) | 4 | 7 |
| **Overall** | **≈ 3 / 10** | **≈ 6.5 / 10** |

What keeps it from Detroit, plainly:
- **No motion capture.** Bodies move by authored poses and IK; it reads as staged, not acted.
  The next big step is retargeting real mocap (e.g. the CMU library) onto the rig.
- **MakeHuman faces are not scans.** With subsurface scattering, pores and good light they hold up
  in medium shots; in extreme close-ups they look like a well-made game from ~2012, not 2018.
- **Voices** are the browser's speech engine (optional) — Detroit has actors. Subtitles carry it.
- **Performance is unmeasured on real GPUs here**: every image in this repository was rendered on
  a software renderer (SwiftShader). Press **F3** in the game for live GPU timings.
- The GPU cloth from Med Engine 1 corrupted motion vectors when combined with screen-space GI on
  the software renderer; capes now run on the CPU cloth instead. The GPU path is kept for banners.

## Using it

```js
import { Stage } from 'medengine/src/Stage.js';
import { Actor } from 'medengine/src/human/Actor.js';
import { Director } from 'medengine/src/cinema/Director.js';

const stage = new Stage(canvas, { quality: 'high' });
const hero = await Actor.load(stage, './assets/humans', 'batman');
stage.scene.add(hero.root);
hero.posture('perch'); hero.emote('grim');
const director = new Director(stage);
director.cut({ type: 'cu', on: hero, angle: -25, move: 'push', dur: 5 });
// every frame: hero.update(dt); director.update(dt); stage.render(dt);
```

Characters are built from recipes (see `games/batman-vesper/characters.mjs`):

```
node medengine/tools/human/build.mjs <recipes.mjs> <outDir>     # needs the MakeHuman data, see below
```

The builder reads the MPFB data folder (`MH_DATA`, default `/opt/tools/mpfb2/src/mpfb/data`) and the
extracted asset packs (`MH_ASSETS`, default `/opt/tools/mh/x`) from
https://static.makehumancommunity.org/assets/assetpacks/index.html.

```
cd medengine && npm install && npm test
```
