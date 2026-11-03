# BATMAN: VESPER — Episode 1: First Night

*Every Earth gets a Batman. This one is just beginning.*

An interactive film for PC on the **Med Engine 2** (`../../medengine`). Third person, cinematic:
cameras that cut like a film, letterboxed, subtitled, in the rain. The story moves with what you
choose, what you say and how you fight — and when you type your own words, **Claude** answers
as the people you are talking to. After the ending, the city keeps going: **Night Two** and every
night after are written live by Claude from the state you left Vesper in.

Two ways to see the same story:
- `index.html` — **the film** (3D, the Med Engine)
- `story.html` — **the illustrated story**, in the style of the reference app: a character over the
  scene, a narration card, "Type what should happen next…", suggestions to tap. Same script, same
  choices, same Claude; pictures rendered by the engine and painted (`tools/stills.mjs`).

## The story

Earth-V. Vesper City, a port where it never stops raining. Noah Vale, the absent heir of Vale
Maritime, crouches on a gargoyle of St. Brigid's Cathedral in a suit he has never worn outside.
Mags Holloway, his late father's friend, is in his ear. Then the police scanner: a woman forced into
a van, Harrow Street parking, level B3. Eleven minutes until the police arrive.

| | Chapter | Where | What can change |
| --- | --- | --- | --- |
| Prologue | **Gargoyle** | St. Brigid's roof, 23:47 | how ready you are; whether you take the plans, or tip off Detective Cruz |
| 1 | **Level B3** | the parking garage | stealth, darkness or walking into the light; QTE fights; the hostage standoff with Rook (a live negotiation meter); what you do with him |
| 2 | **The Ledger** | the garage roof | Nadia's notebook, the name Vale on the charters; publish now or wait; Cruz: talk, give her Rook, or vanish |
| 3 | **The Fall** | the ledge (if Rook was taken) | interrogate Rook over a forty-metre drop: fear or his daughter; let him go, turn him, or let go of him |
| 4 | **Black Water** | the harbour, a storm | the Nightjar against the swell; board, cut her engines, or call in Cruz's boats |
| 5 | **The Ferryman** | the MV Acheron | the people in container VTX-4471 or the man who drowned your parents; the rail, the sea, the code |
| Epilogue | **Dawn** | St. Brigid's, morning | the headline you earned; Cruz's phone; what this city needs |

Outcomes the flowchart tracks: Nadia safe or hurt; Rook an informant, arrested, fled or dead;
the Ferryman arrested, drowned or escaped; Batman's code; whether the city sees a guardian,
a rumour or a monster; Cruz a stranger or an ally.

## Controls

| | |
| --- | --- |
| **1–4** or click | choose (some choices are timed) |
| type + **Enter** | say or do anything (Claude) |
| letters on screen | quick-time events (slow motion) |
| **WASD**, **Shift** | walk, run (exploration) · **E** examine · **C** move on |
| **Esc** | pause · **F3** engine statistics |

## Run it

```bash
cd games/batman-vesper
npm install
npm run dev                         # http://127.0.0.1:5199  (the film)   /story.html (the illustrated story)
ANTHROPIC_API_KEY=… npm run dev     # Claude through the dev server (the key never reaches the page)
npm test                            # 1,500 random playthroughs + engine tests
npm run build                       # dist/
```

On claude.ai (published as an artifact) Claude runs on the viewer's own account, with no key:
[the film](https://claude.ai/artifact/AL9ReyHU79hj5yf7JGxNSL) ·
[the illustrated story](https://claude.ai/artifact/6RhX5eAbZhrVwyGS2XSRma) (private until shared).
`npm run build:artifact` packs both pages (`dist-artifact/`): artifacts serve no raw binary, so
the cast and model buffers travel as base64 text that the engine decodes (`medengine/src/world/Packed.js`).
Offline, the authored options carry the whole episode; free text falls back to a keyword match.

Development flags: `?auto=1` (plays itself), `?chapter=ch1`, `?q=ultra|high|medium|low`,
`?cast=batman,rook` (load part of the cast), `?stopAt=N` (freeze on line N, for screenshots).

## Tools

```
node tools/shot.mjs "index.html?auto=1&chapter=ch1&stopAt=5" shots/x.jpg     # a frame of the film, headless
node tools/stills.mjs                                                       # the illustrated story's pictures
npm run humans                                                              # rebuild the cast (MakeHuman data)
node tools/hosted.mjs . story shots/hosted.png                              # a packed page under artifact-host conditions
```

## Structure

```
characters.mjs          the cast as Med Engine human recipes
src/story/episode1.js   the screenplay, written once against the scene API
src/story/Runner.js     the scene API: state, choices, Claude free text, negotiations, Night Two
src/theatre3d/          the film: actors, shots, fights, exploration, specials
src/theatre2d/          the illustrated story
src/sets/               cathedral, garage (B3), roof, harbour/Acheron, vehicles
src/ui/Overlay.js       subtitles, choices, QTEs, meter, chapter cards, the paper, the flowchart
```

See `CREDITS.md` for the assets (MakeHuman CC0/CC-BY, Poly Haven CC0). Fan project; non-commercial.
