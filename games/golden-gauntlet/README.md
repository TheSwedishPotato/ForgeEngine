# The Golden Gauntlet: a television commercial, anno 1403

A 66-second TV advert for Master Oldřich, *platnéř* (plate-armourer) of Platnéřská
street in Prague's Old Town. It is set in the autumn of 1403 and painted like an Early
Netherlandish panel: lead-white skies going green at the horizon, a towered city on a
river, rose bushes, vermilion brocade with marten fur, a tooled gold ground, and the
yellowed varnish and craquelure of an old oak panel. On top of the painting are the
usual pieces of a TV advert: price starbursts, lower thirds, a channel bug, a
"but wait, there's more!", a testimonial and the fine print scrolling along the bottom.

Everything is drawn and synthesised at run time in one HTML file (`commercial.html`):
Canvas 2D for the picture and WebAudio for a shawm-and-drone estampie in D dorian,
tabor, anvil, bells and a crossbow. The narration uses the browser's own
`speechSynthesis` voice, and every line also appears as a painted speech scroll
(banderole), so the advert still works with the sound off.

## Running it

Open `commercial.html` in a browser, or serve the folder:

```sh
node tools/serve.mjs          # http://localhost:5191/commercial.html
```

`?t=9.8` sets the poster frame. `?render=1` exposes `window.commercial`
(`ready()`, `frame(t)`, `soundtrack(sampleRate)`) for the tools below.

## Tools

| Script | What it does |
| --- | --- |
| `tools/serve.mjs` | Static server that sends the page as UTF-8. The page has no `<meta charset>` of its own, because the artifact host adds one. |
| `tools/shots.mjs [t…]` | Writes JPEG frames at the given times to `shots/`, plus a screenshot of the whole page. |
| `tools/render.mjs [out.mp4]` | Renders every frame (30 fps) and the offline soundtrack, then muxes them into an H.264/AAC MP4 with ffmpeg (default `dist/golden-gauntlet-1403.mp4`). |

The MP4 has the music, effects and burned-in captions. It has no narration, because
browser speech can't be recorded offline.

## The script

| Time | Scene |
| --- | --- |
| 0:00 | Ident: the gauntlet-on-quatrefoil sign over a gold ground |
| 0:05 | Oldřich in the garden before the city: "Are you tired of being run through?" |
| 0:14 | The problem: grandfather's great helm and a coat of plates, under a rain cloud |
| 0:23 | Product: the hounskull bascinet, *only 6 kop* |
| 0:31 | Product: a long sword of Passau with the running wolf, *2 kopy, scabbard included* |
| 0:38 | Demonstration: a breastplate tried against the crossbow |
| 0:47 | "But wait, there is more!": a free arming doublet before Michaelmas |
| 0:53 | Testimonial: Sir Ješek of Lomnice (*results not typical*) |
| 0:58 | The shop: arcaded house with a stepped gable, the forge going, the sign swinging |
| 1:03 | End card: "Steel you can trust your life to" |

## What is historical

- **Platnéřská street** is named after the *platnéři*, the plate-armourers who worked there.
  Master Oldřich, his shop and Sir Ješek are invented.
- **Kopa** ("threescore") was the Bohemian unit of account: 60 Prague groschen. In Czech
  it is 2 *kopy* and 6 *kop*. The prices are jokes, not quotations.
- **The hounskull bascinet** with its pointed snout visor and mail aventail was the
  knight's helmet across Europe c. 1380–1420. By then the great helm was a tournament
  piece, which is why the advert calls it out of date.
- **Passau** blades were famous and marked with the running wolf. Armour was proved
  against the crossbow before sale, and a proof mark was a selling point.
- **1403**: King Wenceslas IV was held in Vienna, and the Hungarian army of his brother
  Sigismund, with Cuman horse, campaigned in Bohemia around Kutná Hora.
- **The house**: arcaded ground floors (*podloubí*), stepped gables and glazed two-light
  windows are typical of Prague Old Town burgher houses of the period. The view into
  the shop follows Petrus Christus's *A Goldsmith in his Shop* (1449).
