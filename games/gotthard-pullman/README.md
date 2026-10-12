# Gotthard Pullman

Friday 11 December 2026. A steam special, Extrazug 31120, climbs the Gotthard's north ramp from
Erstfeld to Göschenen behind the SBB C 5/6 2978 "Elefant", with four heavyweight steel Pullman
cars in dark blue-green: a sleeper, a diner, a parlor car and an observation car. You ride as a
passenger, in a revolving armchair by the window. The driver and the fireman work the engine by
hand, and the other passengers get on and off at the stops. You feel the car sway and see the
snow gather on the window sill. You hear each exhaust beat come back along the train and watch
the valley change as the line climbs through the spiral tunnels.

It runs on the Med Engine, the WebGL2 deferred renderer of *Zweikampf 1403* (`games/duel1403`,
imported read-only). Its people are the 1403 game's figures, dressed for 2026.

## Ride

```bash
cd games/gotthard-pullman
npm install
npm run dev              # http://127.0.0.1:5176
npm run trip -- clear    # the whole trip headless: the crew drives, the timetable is kept or not
npm test                 # physics and people checks
```

The start screen offers six weathers, three seats (parlor, observation or dining car, right or
left side), four points to join the trip, and the picture quality.

| Key | |
| --- | --- |
| Mouse | look around (click the view; Esc releases the mouse) |
| V | step outside and orbit the train (drag; wheel to zoom; `[` `]` change vehicle) |
| M | your phone: the map of the line with the train's blue dot (wheel to zoom) |
| + / − | time faster or slower (the physics keeps up at 240 Hz) |
| P | pause |
| N | sound on or off |
| T | the travel card (time, place, next stop, delay) |
| F3 | the physics of the engine and the train |
| H | the keys |

The address can set everything directly (for testing): `?w=fog&q=high&t=10:52&car=observation&chair=5`
(weathers `clear snowfall heavy foehn fog blizzard`; `cam=out&veh=0&dist=20` starts outside).

## The trip

| Stop | Booked | Why |
| --- | --- | --- |
| Erstfeld (472 m) | dep 10:14 | boarding; the last passengers are still on the platform when you arrive |
| Gurtnellen (738 m) | 10:38 – 10:49 | waits on the loop to be overtaken by the hourly Treno Gottardo |
| Wassen (936 m) | 11:06 – 11:18 | photo stop below the church; most passengers get out |
| Göschenen (1106 m) | arr 11:34 | end of the journey at the summit tunnel's portal |

The train number is invented. Amsteg-Silenen, Gurtnellen and Wassen lost their passenger trains
long ago (Wassen in 2001); the special uses them as a heritage train would.

## What is simulated

**The engine** (`src/physics/locomotive.js`). The C 5/6 is a four-cylinder compound. Steam flows
through the regulator to the high-pressure cylinders, then to the receiver and the low-pressure
cylinders. Each cylinder end works through admission, cut-off, expansion, release and
compression (real steam: IAPWS-IF97 tables in `steamtables.js`). The exhaust goes up the blast
pipe, its draught pulls air through the fire, and the fire burns coal and boils water. The model
covers the safety valves, injectors, blower, sanders, starting valve and drain cocks. The driving
wheels have their own rotational degree of freedom against the rail. Adhesion is a creep-force
curve whose peak friction (μ) depends on the rail's state: dry, damp, wet, frost, ice or snow.
Sand raises μ. Exceed it and the engine slips.

**The train** (`src/physics/train.js`, `brakes.js`). Each vehicle is a mass with Newton's second law
and spring-damper couplings with buffer contact between vehicles. Resistances:

- Gravity on the real gradients, up to 26 ‰.
- Davis rolling resistance, raised in frost.
- Röckl curve resistance in the 280–300 m curves.
- Aerodynamic drag in the air's real density at each altitude, with the wind, and higher inside
  tunnels.

The Westinghouse-type air brake runs in the brake pipe at about 250 m/s, with each vehicle's
brake cylinder and the blocks heating up. Each passenger's 80 kg is added to the car they board.

**The crew** (`src/crew/`). Nothing on the footplate moves by itself. A hand travels to each
control in a time set by Fitts' law, then works it at a human rate. The driver opens the
regulator gradually, notches up the reverser, sands on frost, catches slips, whistles for tunnels
and stations, and brakes in stages for the stops. The fireman fires a round of shovelfuls by the
pressure and the fire and keeps the water over the crown sheet. The banker is called if the
train stalls.

**The passengers** (`src/people/passengers.js`). About sixty people with seats. Each walks the
aisle, waits a turn on the steep vestibule steps, crosses the platform and stands out at the
photo stop. The conductor gets on last and gives the right away only when everyone is aboard.

**The ride** (`src/physics/sway.js`). Track irregularities come from a PSD-shaped spectrum
(alignment, level, cross-level) passed through each car's body modes (lateral and roll ~0.8 Hz,
bounce ~1.2 Hz, pitch ~1.5 Hz). The player's head lags those accelerations.

**The weather** (`src/world/weather.js`). Air temperature by altitude, wind, falling snow, rail
condition and visibility. Each preset is a typical December day for the valley.

**The steam** (`src/render/steam.js`). Each exhaust beat leaves the chimney as a few turbulent
thermals:

- They entrain the air, so their size grows with their path while their momentum spreads over
  the growing mass.
- They rise while the dilution leaves them buoyant.
- They condense or evaporate along the mixing line between the hot exhaust and the air's
  saturation deficit.
- Their opacity is that of fine droplets, and light diffuses through the plume, which also
  shadows itself.

So the plume hangs in freezing fog and vanishes a few metres up in the dry föhn.

**The world.** Terrain comes from the Copernicus 30 m DEM, with 5 m tiles carved for the
formation, cuttings, walls and tunnel portals. Land cover is from ESA WorldCover. Forests are
species by altitude, and the snow line follows the weather. The track, catenary, tunnels and
bridges are built from the line's geometry. Buildings, roads, the Reuss and the platforms come
from OpenStreetMap/Overture. Light comes from the sun's true position for the date (NOAA), a
physically based sky, the mountains' shadows and the sky the gorge leaves. Inside the cars,
daylight enters only through the windows. The glass gathers snow, frost and grime.

**The sound** (`src/audio/sound.js`). Everything is synthesised from the physics:

- Chuffs from the exhaust beats, delayed by the 343 m/s journey back along the train.
- The whistle, safety valves, blower and air pump.
- Wheel rumble with the speed, flange squeal in tight curves, and the brake blocks before a
  stand.
- The panelling creaking with the sway and the murmur of the passengers.
- A tunnel's reverberation.

## Sources

The line, the stations and the structures

- de.wikipedia, *Gotthardbahn*: tunnels and stations, the 26 ‰ ramps. https://de.wikipedia.org/wiki/Gotthardbahn
- en.wikipedia, *Gotthard railway*. https://en.wikipedia.org/wiki/Gotthard_railway
- de.wikipedia, *Chärstelenbachbrücke*: the order south of Amsteg (Windgällentunnel, the bridge at km 47.9, Bristentunnel). https://de.wikipedia.org/wiki/Ch%C3%A4rstelenbachbr%C3%BCcke
- Röll, *Enzyklopädie des Eisenbahnwesens* (1912), "Gotthardbahn": the spiral tunnels' lengths. http://www.zeno.org/Roell-1912/A/Gotthardbahn
- Schienenverkehr Schweiz, the line Luzern/Zug – Chiasso and Bahnhof Wassen. https://www.schienenverkehr-schweiz.ch/Strecken/Bahnstrecke_Luzern_und_Zug_-_Chiasso · https://www.schienenverkehr-schweiz.ch/Bahnhof/Wassen
- Structurae, *Gotthardbahn*, and the bridges at Wassen. https://structurae.net/de/bauwerke/gotthardbahn
- Kanton Uri, inventory of bridges. https://www.ur.ch/_docn/287707/01-01-2_1_1_Bruecken.pdf
- Gotthardmodell, *Zahlen und Fakten*. https://www.gotthardmodell.ch/der-gotthard/zahlen-und-fakten/
- SOB, Treno Gottardo and Wassen. https://unterwegs.sob.ch/en/stories/wassen · https://www.myswitzerland.com/en-us/experiences/treno-gottardo/
- Gemeinde Erstfeld, figures. https://erstfeld.ch/portrait/zahlen-fakten

The engine

- C 5/6 2978 data sheet (Verein Dampflok C 5/6 2978). http://voisin.ch/c_5-6_2978/c_5-6_2978_datenblatt_d.pdf · https://www.voisin.ch/c_5-6_2978/c_5-6_2978_d.html
- en.wikipedia, *SBB C 5/6*. https://en.wikipedia.org/wiki/SBB_C_5/6
- Eurovapor, C 5/6 2969. https://www.eurovapor.ch/fahrzeuge/dampflok-elefant-2969/
- Verkehrshaus der Schweiz, collection. https://sammlung.verkehrshaus.ch/de/collection/item/116603/
- SBB Historic archive. https://www.sbbarchiv.ch/detail.aspx?id=510093
- Reference photographs: Wikimedia Commons, *SBB C 5/6 2978*. https://commons.wikimedia.org/wiki/Category:SBB_C_5/6_2978
- Lok-Report, *Dampf am Gotthard*. https://www.lok-report.de/news/europa/item/62349-schweiz-dampf-am-gotthard.html
- Didcot Railway Centre, steam locomotive controls (the footplate's fittings). https://didcotrailwaycentre.org.uk/article.php/537/steam-locomotive-controls

The cars

- The Pennsylvania Railroad's Pullman descriptions. http://prr.railfan.net/passenger/GSPEAR/GSPEAR_PRR_Pullman_Desc.htm
- Rails West, Pullman technology. http://www.railswest.com/technology/pullman.html
- Illinois Railway Museum, Pullman *Glen Alta*. https://www.irm.org/player/pullmanglenalta/

Physics

- Wheel-rail friction under contamination: LTU Tribolab for Transportstyrelsen (2021). https://www.transportstyrelsen.se/contentassets/760d1a97b3b64e4c900a31fc41cc8f0e/ltu--tribolab-report-friction-211014.pdf
- Low adhesion and sanding (Lubricants 11, 2023). https://eprints.whiterose.ac.uk/196136/1/lubricants-11-00038.pdf
- Train resistance (University of Illinois). https://www.ideals.illinois.edu/items/4799/bitstreams/18774/data.pdf
- IAPWS-IF97 steam tables; Davis (1926) rolling resistance; Röckl curve resistance; Fitts (1954) and MacKenzie (1992) for reaching; Perry & Burnfield and Winter for gait (the Walker).
- Steam plumes: Morton, Taylor & Turner (1956) on turbulent thermals (entrainment); the mixing-line (Schmidt–Appleman) argument for condensation; Magnus saturation (Alduchov & Eskridge 1996); droplet extinction 3/(2 ρw r) (Stephens 1978); diffusion through scattering layers (Bohren 1987).
- Track: Zug canton track cross-sections (B91 sleepers at 0.6 m, ballast). https://cdn.zg.ch/dam/jcr:3752755f-8855-4f8e-9acc-5ff443051ae4/11.02.04_-_FbE27_Litti-Baar_Gleis_300-400_-_Querprofil_2_signed.pdf
- Clearances and overhead line: BayEBOA §21. https://www.gesetze-bayern.de/Content/Document/BayEBOA-21 · ICE-Treff. https://www.ice-treff.de/index.php?id=65150 (the contact wire height of 5.3 m and the system height of 1.4 m are assumptions)

The land

- Copernicus DEM GLO-30 (ESA, Airbus). https://registry.opendata.aws/copernicus-dem/
- ESA WorldCover 2021 v200. https://esa-worldcover.org/
- OpenStreetMap contributors (ODbL), via Overture Maps. https://www.openstreetmap.org/copyright · https://overturemaps.org/
- Sentinel-2 imagery (Copernicus) via Earth Search, as the reference for the winter look of the valley. https://earth-search.aws.element84.com/v1/collections
- Forests of Uri: Dätwyler Stiftung. https://daetwyler-stiftung.ch/cms/upload/dokumente/medienberichte/Waldflaeche_Uri_Baumarten.pdf · Swiss National Forest Inventory. https://www.lfi.ch/en/legacy-datasets/tables?pg=1280 · waldwissen.net, altitudes of the species. https://www.waldwissen.net/de/waldwirtschaft/waldbau/gebirgswald/hoehenverbreitung-von-esche-buche-tanne
- The sun: NOAA solar position algorithm. https://gml.noaa.gov/grad/solcalc/calcdetails.html
- December climate: MeteoSwiss climate normals for Altdorf and Andermatt. https://www.meteoswiss.admin.ch/

Where the record is silent, the game says so in the code: these are estimates. They include the
whistle's pitch, the cab fittings' exact positions, the passenger numbers, the train number, and
the relative humidity of each weather.
