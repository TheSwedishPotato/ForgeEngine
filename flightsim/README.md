# SK1415 — SAS A320neo cabin simulator (Stockholm Arlanda → Copenhagen Kastrup)

A first-person passenger simulator that runs in the browser. You sit in a seat of an
SAS Airbus A320neo on Sunday 10 May 2026 and ride the whole flight in real time:
pushback is done, the engines are running, and from there you get taxi, the safety
demonstration, take-off from runway 19R, the climb over Stockholm, cruise at FL360
over Östergötland and Småland, the trolley service, descent over Skåne, the approach
to runway 22L over the Øresund, landing, taxi-in and deplaning at Terminal 3.

## Play

This is a **desktop PC game**: mouse and keyboard, WebGL 2, and a dedicated GPU is
recommended for the High and Ultra presets.

* **Easiest:** open `dist/SK1415.html` in a desktop browser (Chrome, Edge, Firefox or
  Safari with WebGL 2). It is one self-contained file; it only needs internet access to
  load three.js from jsDelivr and the fonts from Google Fonts.
* **From source:** serve this folder over HTTP (ES modules don't load from `file://`):

  ```bash
  cd flightsim
  npx http-server -p 8080 -c-1 .   # then open http://localhost:8080
  ```

Headphones recommended — every sound is synthesised live with the Web Audio API.
Announcements and voices use the browser's text-to-speech (Swedish needs a Swedish
system voice; captions are always shown).

### Controls

| Key | Action |
| --- | --- |
| Mouse (click the view first) | Look around (sensitivity and field of view are in the pause menu) |
| Click or **E** | Use what you look at: window shade, overhead bin, reading light, call button, air vent, safety card, lavatory door, flush |
| **B** | Fasten / unfasten your seatbelt |
| **F** | Tray table |
| **R** | Recline (only when the seatbelt sign is off) |
| **T** | Talk to the passenger next to you (then **1–5** to answer) |
| **Space** | Stand up / sit down |
| **W A S D** | Walk when standing, lean when seated (lean towards the window to look down) |
| **M** | Your phone: live flight map with altitude, speed and ETA |
| **V** | Outside camera: orbit the aircraft with the mouse, zoom with the wheel |
| **P** | Take a photo (saved as a PNG, with a camera flash) |
| **U** / **F11** | Fullscreen |
| **Y** | Swallow — clears blocked ears during the descent |
| **+ / −** | Time speed 1× … 16× |
| **Esc** | Pause, help, jump ahead to a phase, volume |

## What is simulated

**Aircraft and cabin.** A320neo in SAS layout: 180 Recaro slim-line seats, 3-3,
rows 1–31 without row 13, SAS Business in rows 1–4 with the middle seat blocked and a
curtain, over-wing exits at rows 11–12, 8 exits in total, forward lavatory and galley,
aft galley with two lavatories, overhead bins that open, PSUs with row labels, reading
lights and gaspers, fasten-seatbelt and no-smoking signs, floor path lighting, EXIT
signs, window shades, deep window reveals with the little bleed hole in the inner pane,
frost on the pane at cruise and rain beads at low level. Sunlight comes through the
windows and moves across the cabin as the aircraft turns.

**Graphics.** HDR rendering in half-float buffers with filmic ACES tone mapping,
bloom, SMAA anti-aliasing, subtle grain, vignette and lens fringing. Cumulus are true
volumetric clouds, ray-marched through 3D Perlin-Worley noise with light scattering,
the "powder" effect and aerial perspective. The cabin uses normal-mapped seat fabric,
leather headrests and carpet, soft shadows from the sun through the windows, and dust
motes drifting in the sunbeams. Four quality presets: Low, Medium, High and Ultra
(render scale, shadow-map size, volumetric step count).

**Mood lighting.** The LED coves change with the flight: a Swedish blue-and-yellow
boarding scene, warm light after the demo, a sunset scene on evening flights and the
Danish red-and-white on arrival.

**Your aircraft from outside.** SE-ROX *Roar Viking* in the 2019 livery: grey fuselage,
the blue belly sweeping up into the tail, tone-on-tone "SAS" titles, "Scandinavian" on
the belly, SkyTeam logo and Swedish flag, painted door and hatch outlines, and blue
sharklets. The undercarriage retracts the way the real one does: the main legs fold
inboard so the wheels sit in the belly bays, and the nose leg folds forward. The tail
logo lights come on with the gear down or the slats out, the cabin windows glow warm
after dark, and the aircraft casts a soft contact shadow that follows the sun. Flap-edge
vortices condense on humid approaches.

**Outside.** The wing moves: slats, Fowler flaps, spoilers (speed brakes in the descent,
full ground spoilers on touchdown), ailerons, wing flex in turbulence, the CFM LEAP-1A
with a spinning fan and thrust reversers that open on landing, the SAS sharklets, nav
lights, double-flash strobes, the red beacon and wing scan lights at night. The ground
is built from real data — Natural Earth 1:10m coastlines, lakes (Mälaren, Vättern,
Hjälmaren, …), urban areas and motorways — projected onto a curved Earth with haze
and cloud shadows. May colours: fresh green fields and yellow rapeseed in Skåne. Arlanda
and Kastrup use the real runway coordinates (19R out, 22L in) with runway markings,
edge/centreline/approach lights and PAPIs, terminals with glass that reflects the sky
and interiors that light up at dusk, floodlit aprons, piers and parked aircraft. Ground
crew walk back from the pushback at Arlanda, with a baggage train, catering truck, fuel
bowser and ground power unit working the stands. At Kastrup a marshaller brings you in,
the belt loader and baggage carts arrive after the engines stop, cranes stand over the
Terminal 3 expansion, and LN-RKR, SAS's all-blue 80th-anniversary A330, is at pier C. On the
approach you see the Øresund Bridge, Peberholm, Saltholm, Malmö's Turning Torso and the
Middelgrunden and Lillgrund wind farms. Sun and moon positions are computed for the
actual date, time and position.

**People.** About 150 passengers (you pick the load), four cabin crew in the 2025 SAS
uniform (royal and navy blue, "Sunrise" or "Night Blue" scarf). Faces blink, and mouths move
when someone talks. The crew do the safety
demonstration in sync with the Swedish/English PA, walk the cabin checking belts, trays
and blinds (they will ask *you* too, and the aircraft waits until your belt is on), sit
on their jump seats for take-off and landing, run two trolleys (coffee and tea are free,
the rest of the menu is card only; the *Flavors by SAS* menu is in your seat pocket),
collect rubbish, answer your call button, and wave
goodbye at the door. Passengers look out of the window, sleep, read, use phones and
laptops, go to the lavatory, unbuckle too early after landing and stand in the aisle.
Your neighbour has a personality and something to say about the flight.

**Sound.** LEAP-1A fan whine (18-blade passing frequency) and buzz-saw tones at take-off
thrust, jet roar that is louder further aft, airflow, packs, tyre rumble and the
thump-thump of centreline lights, gear and flap motors, speed-brake and gear rumble,
Airbus cabin chimes, seatbelt clicks, trolley, coffee pouring, the vacuum toilet flush,
rain, cabin murmur and blocked ears on the descent.

**Flight.** A kinematic A320neo model on a filleted ground track: taxi speeds limited by
curvature, 50 % N1 stabilisation then FLEX thrust, rotation at 144 kt, gear up, thrust
reduction at 1,500 ft, flap retraction, 250 kt below FL100, Mach 0.78 at FL360, idle
descent on a 3° profile with a deceleration segment at FL100, configuration changes and
gear on the approach, a 3° glide path with flare, reversers and autobrake, and a
single-engine taxi-in.

## Options

Departure time (06:00 is SK1415's real slot; later departures use representative flight
numbers), weather (clear, fair-weather cumulus, broken clouds, overcast with rain, morning
fog), your seat (clickable seat map), passenger load, announcement languages, graphics
quality, time speed and spoken voices.

## Sources

* SAS A320neo: 180 seats, 3-3 Recaro slim-line, 30" pitch — seat-map sites (aerolopa,
  seatmaps.com) and SAS press material; CFM LEAP-1A26 engines (SAS/CFM orders).
* 2025 SAS crew uniform: royal and navy blue with "Sunrise" / "Night Blue" scarves (SAS
  press release, February 2025).
* Coffee and tea complimentary, buy-on-board menu, card only; Starlink Wi-Fi free for
  EuroBonus members from March 2026 (SAS).
* SK1415 ARN 06:00 → CPH 07:15 (published 2026 schedule).
* 2019 SAS livery and the 2026 80th-anniversary A330 (SAS press releases, Simple Flying).
* Cabin mood lighting and the A320neo cabin (The Points Guy, More Premium); Recaro SL3510
  seats; *Flavors by SAS* buy-on-board menu.
* A320 exterior lighting: logo lights on the tailplane, switched with NAV and lit only with
  the main gear compressed or the slats out (FlyByWire A32NX documentation).
* Kastrup ground handling (cph.dk) and the Terminal 3 expansion; Arlanda taxi routes
  (VATSIM Scandinavia ESSA wiki); Airbus cabin chime conventions.
* Runways: OurAirports `runways.csv` (ESSA 01L/19R, 01R/19L, 08/26; EKCH 04L/22R,
  04R/22L, 12/30). Terrain: Natural Earth 1:10m (public domain), rebuilt with
  `tools/build_geodata.py`.

Menu prices, crew and pilot names, terminal and taxiway layouts are representative, not
exact. This is a fan-made simulation and is not affiliated with SAS, Airbus, CFM, Swedavia
or Copenhagen Airports.

## Code map

| File | What it does |
| --- | --- |
| `src/main.js` | Boot, main loop, render passes (world → clouds → own aircraft → cabin), input, outside camera, photos |
| `src/post.js` | HDR buffers, bloom, tone mapping and grade, SMAA |
| `src/clouds.js` | Ray-marched volumetric cumulus |
| `src/flight.js` | Route with filleted turns and the flight model |
| `src/places.js` | Runways, airport layouts, landmarks, route waypoints, departures |
| `src/world.js` | Sky, atmosphere, curved-Earth terrain, water, clouds, weather |
| `src/scenery.js` | Airports, runway lights, parked aircraft, bridge, wind farms, traffic |
| `src/exterior.js` | Wing, flaps, slats, spoilers, engines, sharklets, fuselage and livery, tail, undercarriage, lights |
| `src/textures.js` | Procedural textures: seat backs, fabric/leather/carpet normal maps, faces |
| `src/cabin.js` | Cabin interior, seats, windows, bins, galleys, lavatories, doors, signs |
| `src/humans.js` | Procedural people, clothing, faces, poses |
| `src/people.js` | Passengers and crew behaviour, safety demo gestures, trolleys |
| `src/director.js` | The flight timeline: signs, lights, PAs, service, arrival |
| `src/speech.js` | PA scripts (Swedish/English) and text-to-speech with captions |
| `src/dialogue.js` | Your neighbour |
| `src/audio.js` | Procedural sound |
| `src/player.js` | First-person controls and your seat |
| `src/ui.js` | Start screen, HUD, captions, menus, phone map, safety card |

Rebuild `dist/SK1415.html` after changing the source:

```bash
npm install
npm run build
```
