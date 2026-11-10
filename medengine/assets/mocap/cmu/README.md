# Motion capture data

These BVH files are short excerpts of the **CMU Graphics Lab Motion Capture Database**, as converted by
cgspeed (the MotionBuilder-friendly BVH release), trimmed to 30 fps and two decimals with `tools/trim-bvh.mjs`.

> The data used in this project was obtained from mocap.cs.cmu.edu.
> The database was created with funding from NSF EIA-0196217.

> CMU places no restrictions on the use of the original dataset, and I (Bruce) place no additional
> restrictions on the use of this particular BVH conversion.

| file | source clip | what it is |
|---|---|---|
| `walk_07_01.bvh` | CMU 07_01 | walking |
| `run_09_01.bvh` | CMU 09_01 | running |
| `jump_16_01.bvh` | CMU 16_01 | standing jump |
| `bow_113_02.bvh` | CMU 113_02 | a formal bow |
| `getup_139_16.bvh` | CMU 139_16 | getting up from lying face down |
| `fight_141_14.bvh` | CMU 141_14 | punches and kicks |
| `wave_141_16.bvh` | CMU 141_16 | waving |

`clips.json` is the recipe that turns these into the game-ready clips in `assets/anim/humanoid/`
(`npm run bake:anim`): which part of each file to use, where the walk and run loop, which events to mark.
