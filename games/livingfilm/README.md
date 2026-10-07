# Living Film

A story you live from the inside, like a film. Nothing is written in advance:
you say and do whatever you like, in your own words or from suggestions written
for that moment, and **Claude directs** — the places, the people and what they
feel, every shot and every line — as it happens.

Separate from *Zweikampf 1403* (`../duel1403`), which stays as it is.

## How it works

```
src/
  director.js   Claude as director: the prompt (premise, cast with feelings and secrets, the story so far,
                the last moments, what you said or did), and the checks every reply passes before it is played
  story.js      the story state (cast, scene, summary, things never forgotten, the log), the openings, saving
  main.js       the start screen, turns, playing beats with subtitles and voices, the story panel
  voice.js      optional voices from the browser's speech engine, one per character
  render/
    film.js     the projector: framing for each shot (establishing, wide, medium, two-shot, over the shoulder,
                close, insert), camera moves, depth of field, light and flicker, weather, grain, letterbox
    sets.js     28 kinds of place painted procedurally, by time of day, weather and light
    figures.js  people: figures for wide shots, faces for close-ups, expressions from each beat's emotion
    paint.js    painting helpers
  demo.js       a test reel for tooling only (?demo=1)
```

Each turn Claude returns JSON: the scene, any new or changed people (look, voice, feeling toward you,
what they want, secrets), 3–7 **beats** (a shot, a move, narration, a line, an emotion), four suggestions,
the story so far rewritten, and anything never to be forgotten. `cleanReply` checks every field against
what the film can show; unknown places map to the nearest set.

## Running

```
npm install
npm run dev            # http://127.0.0.1:5175  (?demo=1 plays the test reel without Claude)
npm test
npm run build:single   # dist-single/living-film.html, the artifact page
node tools/reel.mjs    # photographs the test reel into shots/
```

Claude answers through the page's `sample` capability when it is published on claude.ai; without it the
start screen says so (the film cannot be written without Claude).
