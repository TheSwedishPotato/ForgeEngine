# Living Film

A story you live from the inside, like a film. Nothing is written in advance:
you say and do whatever you like, in your own words or from suggestions written
for that moment, and **Claude directs** — the places, the people and what they
feel, every shot and every line — as it happens.

Separate from *Zweikampf 1403* (`../duel1403`), which stays as it is.

## How it works

The director runs **ORRERY** (`docs/ORRERY.md`, the full engine text): the twelve laws, the resolution
engine with its six outcome bands, the character architecture, the NPC mind with five standings
(trust, respect, fear, affection, suspicion), the world clock, the consequence and promise ledgers, the
story engine (hidden plots, threads A/B/C), the agency line, the intensity and period dials, the prose
and speech standard, the cadence (a full status update every 3–5 scenes) and director mode (`[[...]]`).

```
src/
  orrery/
    director.js  the condensed laws, the per-turn prompt (the whole tracked world goes along every time:
                 Claude remembers nothing between calls), the checks every reply passes, and the streaming call
    stream.js    reads the JSON while it is written, so the first beat plays before the reply is finished
    state.js     everything tracked, folded in turn by turn, the continuity ledger and recap, saving
    research.js  period notes researched on the web for the four stories (with sources), and the dossier and
                 place-note prompts Claude answers for every story (the page itself cannot browse)
    openings.js  Kutná Hora 1403, Murano 1499, Yorkshire 1348, Florence 1478, or your own
  stage3d/       the 3D stage on the Med Engine from ../duel1403 (imported, never changed there): places built
                 once before anyone walks in and kept, actors (Walker bodies) with gestures, work, faces that
                 move, walking within a scene, bystanders, shot framing, key light, flickering fire, weather
  sheet/         the character sheet as a Netherlandish panel (gold, brocade, ermine, blackletter): the person,
                 body and mind, skills and means, the people, the world and ledgers, the Book of chapters,
                 the full status updates, the Codex, the continuity ledger; portrait taken by the stage
  audio/score.js period music by mood (drone, lute, recorder, voices, frame drum, church modes) and the sound of
                 each place (fire, crowd, wind, rain, water, birds, crickets and owl, bells, a workshop)
  render/        the painted 2D film, used where WebGL2 is missing
  main.js        start screen, research, turns played as they stream, bubbles, choices, director commands
  demo.js        a test reel for tooling only (?demo=1)
```

## Running

```
npm install
npm run dev            # http://127.0.0.1:5175  (?demo=1 plays the test reel without Claude)
npm test
npm run build:single   # dist-single/living-film.html, the artifact page
node tools/play.mjs    # plays the demo reel headless through the whole app, into shots/
node tools/stage-shots.mjs "place=tavern&time=night" tavern   # every shot of the 3D stage
```

Claude answers through the page's `sample` capability when it is published on claude.ai; without it the
start screen says so (the film cannot be written without Claude).
