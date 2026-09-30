# SK1415 — SAS A320neo cabin simulator (Stockholm Arlanda → Copenhagen Kastrup)

A first-person passenger simulator that runs in the browser. You sit in a seat of an
SAS Airbus A320neo on Sunday 10 May 2026 and ride the whole flight in real time:
you start at gate F36 in pier F of Arlanda's Terminal 5 half an hour before departure, board
with everyone else through the jet bridge, find your seat, and then get the doors closing, a
towed pushback with the engines starting, taxi, the safety demonstration, take-off, the climb over Stockholm, cruise at FL360 over Östergötland
and Småland, the trolley service, descent over Skåne, the approach over the Øresund,
landing, taxi-in and deplaning at Terminal 3.

**Nothing is scripted.** Two simulated pilots fly the aircraft through its cockpit controls
(sidestick, rudder pedals, tiller, thrust levers, flap and gear levers, speed brake,
autopilot panel) with human reaction times; ATC picks the runways from the wind you set and
clears you when the traffic allows; the weather you set becomes wind, gusts, turbulence,
storms, lightning and microbursts in the physics. Everything you see and feel comes out of
that: the take-off run, the bumps, the go-around when the runway is still occupied, the
diversion when an engine fails.

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
| **Space** | Stand up / sit down; get back up if turbulence throws you to the floor |
| **W A S D** | Walk when standing, lean when seated (lean towards the window to look down) |
| **M** | Your phone: live flight map with altitude, speed and ETA |
| **V** | Outside camera: orbit the aircraft with the mouse, zoom with the wheel |
| **C** | Flight deck panel: autopilot modes (FMA), speed, altitude, engines, wind, and everything the pilots and ATC say |
| **P** | Take a photo (saved as a PNG, with a camera flash) |
| **U** / **F11** | Fullscreen |
| **Y** | Swallow — clears blocked ears during the descent |
| **O** | Put on / take off your oxygen mask (once the masks have dropped) |
| **+ / −** | Time speed 1× … 16× |
| **Space** (on the observer seat) | Get up again |
| **F3** or **§/`** | Debug mode (see below) |
| **Esc** | Pause, help, jump ahead to a phase, volume |

## What is simulated

**Boarding.** You start in the hold room of gate F36 at pier F with the other passengers in the
chairs, the aircraft outside the glass and the jet bridge on its L1 door. The gate agent calls the
boarding groups in Swedish and English (group 1 SkyPriority, 2 Premium and EuroBonus Silver, 3, then
4 Economy Light); your boarding pass says which is yours. When it is called you scan your pass at the
self-boarding gates and walk down the bridge, which rises from the pier floor to the door sill; the
purser greets you at the door and tells you which side your seat is on. Everyone else walks the same
way, queues in the bridge and the aisle, opens the bins and lifts their bags in, so the aisle jams
like it does. About 17 minutes later the last passenger sits down, the purser reports boarding
complete, the doors close in time for the start-up slot and the bridge pulls back. (*Skip to
Pushback* in the pause menu seats everyone at once.)

**Pushback and engine start.** The crew ask Arlanda Ground for pushback and start-up (A-CDM: the
ground controller approves both), release the brakes, and a tug pushes the aircraft through a towbar
on the nose gear: a real force in the physics, steering the nose wheel up to the towbar limit and
keeping to walking pace, straight back and then round into a turn to face west. During the push the
captain starts engine 2 (yellow hydraulics for the brakes and steering) and then engine 1: the
starter spins the core, the FADEC motors it dry, ignition above 15 % N2, fuel above 20 %, light-off
in two or three seconds, EGT peaking around 700 °C, starter cut-out at 63 %, idle at about 20 % N1
and 68 % N2 — about 45 seconds each. The headset man asks for the parking brake, disconnects, shows
the bypass pin and the tug drives off to the pier.

**The flight deck.** The cockpit door is locked from boarding to arrival, as it is on real flights
(EU Part-CAT CAT.GEN.MPA.135: only the crew, inspectors and people the operator's manual allows,
the commander deciding). At the gate after landing the captain lets you in: the nose section is
built inside with the six windows (the outside world is drawn through them), the glareshield and
FCU, six display units drawn live from the aircraft (PFD with FMA, speed and altitude tapes;
navigation display with the route ahead; E/WD with N1, EGT, N2 and fuel flow; system display),
thrust, flap and speed-brake levers, sidesticks and pedals that move with the pilots' hands, the
overhead panel and both pilots in their seats. A start-screen *what-if* option unlocks the door for
the whole flight so you can ride on the observer (jump) seat; that is not allowed on a real flight.

**Other traffic and air traffic control.** The aircraft around you are real flights from the
timetables around SK1415: Arlanda's first-wave departures (Air France AF1463 to Paris at 05:55, Swiss
LX1255 to Zürich 06:05, Lufthansa LH811 to Frankfurt 06:10, Finnair AY826 to Helsinki 06:20, then
Ryanair and SAS), arrivals on the parallel runway, the Kastrup arrivals and departures around our
landing and an SAS flight the other way on the airway at an odd flight level. Each has its own delay
for the day (most a minute or two, a long tail of later ones) and from then on nothing is timed: every
one is a point-mass aircraft with its type's mass, wing area, drag polar and thrust, pushed back from
a pier F stand, starting its engines, taxiing behind whoever is ahead, lining up, rolling, rotating at
its VR and climbing on excess thrust; arrivals fly a speed schedule down a 3° path and go around if
the runway is not free. The controllers are rules, not a script: Ground approves one pushback at a
time on the taxilane and not with traffic passing behind, gives taxi clearances ("follow the
Airbus"); Tower lines departures up in the order they reported ready and clears each one for take-off
only when the one ahead is airborne and 3 NM away (or two minutes on the same route), clears landings
only on a free runway; Copenhagen Approach keeps 4 NM between arrivals with standard speed
reductions. Everyone shares each frequency: one transmission at a time, with human reaction times
before each call and readback, and you hear only the frequency the pilots have tuned (Arlanda
Delivery 121.825, Ground 121.705, Tower 118.500, Stockholm Control 123.750, Sweden Control 134.980,
Copenhagen Approach 119.805, Kastrup Tower 118.105, Kastrup Apron 121.630; 8.33 kHz channel names).
The flight deck's TCAS shows them; you see them taxi past the window, at the holding point and in the
sky, with contrails at cruise levels.

**Hands on the controls.** Nothing in the cockpit changes by itself. Every switch, lever and knob the
pilots use — parking brake, engine masters and ENG MODE, flap and speed-brake levers, gear lever,
autobrake, FCU knobs and the AP push-button, EFIS, MCDU, the overhead's APU, bleed, anti-ice, signs
and beacon — is a job for one pilot's hand: the hand reaches the control in a time given by Fitts' law
(about 0.8–1.2 s for a switch half a metre away, with human spread), the change happens at the moment
of contact, and the arm (solved on the pilot's own skeleton) and the eyes go there. One hand does one
thing at a time; flying by hand, the pilot flying keeps the stick and levers and the other pilot works
the FCU. In the cabin the purser walks to L1 and closes and opens the door herself, bins are closed
by the crew checking the rows, and passengers reach up for their reading lights and blinds when they
get round to it.

**Debug mode (F3).** Live readouts of everything under the hood: position, air data, attitude,
angle of attack and its protections, CL/CD and forces, engines (N1, N2, EGT, fuel flow, thrust,
start state), gear struts and brakes, the tug; pilot inputs, control surfaces, fly-by-wire law,
FMA and FCU; the crew's procedure state, ATC clearances and radio; wind, turbulence, weather,
sun and clock; the cabin, boarding and incidents; frame rate, draw calls and memory; and an
error/warning log. Strip charts plot the last three minutes. Tools: pause, time scale,
fast-forward, event injection, failures, teleports (seat, flight deck, gate), cockpit door
unlock, skip boarding, a free camera (W A S D, Q/E, Shift) and force vectors drawn on the
aircraft (lift, drag, thrust, weight, ground).

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
full ground spoilers on touchdown), ailerons, the wing bending up under load and flapping in gusts, the CFM LEAP-1A
with a spinning fan and thrust reversers that open on landing, the SAS sharklets, nav
lights, double-flash strobes, the red beacon and wing scan lights at night. The ground
is built from real data — Natural Earth 1:10m coastlines, lakes (Mälaren, Vättern,
Hjälmaren, …), urban areas and motorways — projected onto a curved Earth with haze
and cloud shadows. May colours: fresh green fields and yellow rapeseed in Skåne. Arlanda
and Kastrup use the real runway coordinates (19R or 01L out, 22L or 04L in) with runway markings,
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

**The pilots.** Captain and first officer are separate agents with their own reaction times
(about 0.16–0.26 s), neuromuscular lag, a limit on how fast they move the stick, and a little
hand tremor, following the McRuer human-operator model. They fly the Airbus SOPs: after-start and
taxi flows, "clear left, clear right", FLEX or TOGA take-off (TOGA on a wet runway, in strong gusts
or with storms near the field), the standard calls (100 knots, V1, rotate, positive climb, gear up),
autopilot on, flap retraction at F and S speeds, the transition altitude, top of descent, the
approach briefing with the minima chosen from the weather (CAT I, II or III and autoland in fog), a
speed- and distance-based flap and gear schedule, speed brakes when high, the stabilised-approach
gate at 1,000 ft, the flare from about 30–40 ft with the de-crab on the rudder, reversers and
autobrake, the 70-knot call, vacating and single-engine taxi-in, engines off and the seatbelt sign
off at the stand. They decide: they switch the seatbelt sign on and off from the turbulence they feel,
ask ATC for another level in turbulence, deviate 20 NM around storm cells on the weather radar,
go around when not stabilised, when the runway is not in sight at the minima, after a bounce or when
the windshear system calls, and after two go-arounds for weather they divert. With a failure they
run the drill (ECAM actions, engine fire drill with the extinguishers, emergency descent, gear
gravity extension) and choose the nearest suitable airport.

**ATC and traffic.** Arlanda Ground and Tower, Stockholm Control, Copenhagen Approach and Kastrup
Tower on their real frequencies. The controllers pick the runways with the most headwind (19R or 01L at
Arlanda, 22L or 04L at Kastrup), clear you to taxi, hold you for a departing Norwegian 737, clear you
to line up and take off, climb you to FL100 and FL360, descend you, vector you onto the ILS, and give
the landing clearance once the Lufthansa ahead has vacated — or send you around if it has not. A
landing runway change comes if the wind changes while you are still far out.

**Physics.** The aircraft is a rigid body with six degrees of freedom, integrated at 120 Hz.
Lift, drag and side force come from angle of attack and sideslip with a real lift curve and
stall for each flap setting, spoilers, gear drag and ground effect. The LEAP-1A26 engines
lose thrust with density and Mach, spool up and down, burn fuel and can fail. Three oleo
struts (gas springs that stiffen towards the end of their stroke, damped harder in rebound),
tyres whose side force builds up with slip angle, brakes and nose-wheel steering carry it on
the ground; on pushback a tug's towbar force acts at the nose gear. Between the
pilots' hands and the control surfaces sit the Airbus fly-by-wire laws: a ground law, then the
normal law (load-factor demand with automatic trim, roll-rate command to 15°/s with bank hold to
33° and protection at 67°, a yaw damper), alpha, pitch-attitude, load-factor and high-speed
protections, alpha floor and the flare law. The autoflight system has the real modes (SRS, CLB,
OP CLB, ALT*, ALT CRZ, DES, V/S, G/S, LOC, FLARE, ROLL OUT, NAV, HDG, GA TRK), managed speeds
(green dot, S, F, VLS) and autothrust, and ILS receivers built from the runway geometry. The wings
bend: the first bending mode (about 2 Hz) lifts the tips by roughly 0.85 m in 1 g flight and makes
them flap in gusts, and the fuselage has its own bending mode, so the back of the cabin bumps more.
Nothing moves the aircraft except these forces, so a hard landing, a bounce, a tail strike or a
crash is something that happens, not something that is played.

**Weather you set, physics you feel.** Pick a preset or open the weather editor (on the start
screen, or *Weather…* in the pause menu to change it live): wind, gusts, visibility, temperature,
dew point, QNH and rain at each airport; up to three cloud layers; the jet stream; clear-air
turbulence; and thunderstorms (isolated, scattered, numerous or a squall line, where, and how
tall). The pilots read the METARs it makes, ATC picks the runways from it, and the atmosphere turns
it into physics: a logarithmic surface-layer wind profile with the Ekman veer, rising to the jet
stream; Dryden turbulence (MIL-F-8785C at low level with σw = 0.1·W20, MIL-HDBK-1797 above) with
gusts from the gust factor you set, thermals under cumulus, stronger turbulence in cloud; clear-air
turbulence patches; and thunderstorm cells with a life cycle (towering cumulus, mature, dissipating
over 30–70 minutes), updrafts, downdrafts, the gust front, rain and hail, lightning at a rate that
follows the updraft (and occasionally the aircraft itself, near the freezing level), and
microbursts under 4 km across that last 5–15 minutes. The storms drift with the mid-level wind.
You see them as towering cumulonimbus with anvils and rain shafts, flashes light the clouds from
inside, and the thunder arrives at the speed of sound. The cabin feels the specific force at each
seat, including the rotational terms and the fuselage bending.

**The cabin reacts.** Your head sways with the accelerations. Unbelted, you lift off the seat
in negative g and can hit the overhead panel; standing, your feet hold about a quarter of a
g before you stagger and fall. Crew and walking passengers are thrown about the same way,
trolleys roll when their brakes can no longer hold them, drinks tip over, overhead bins burst
open and the oxygen masks drop at a cabin altitude of 14,000 ft.

**Anything can happen** (option *Real-world events*: off, realistic, eventful, chaos; or pick
one from the pause menu). The events only break something or put something in the air; what
follows is up to the pilots and the physics. Moderate and severe clear-air turbulence, wake
turbulence, a microburst on final (the predictive windshear system or the reactive one, which
averages the F-factor over 1 km against the 0.105 threshold, calls the go-around), a runway that is
still occupied (ATC sends you around), bird strikes, lightning, a passenger taken ill (the captain
asks for priority or diverts), an engine failure before V1 (the crew rejects the take-off) or after
it (they fly on, clean up at 400 ft, run the drill and fly a circuit back to Arlanda), an engine
fire, a loss of oil pressure, a rapid decompression (emergency descent, the masks drop at 14,000 ft
cabin altitude, hypoxia if you leave yours off), a green hydraulic failure, and in chaos mode both
engines lost to birds (a glide to a forced landing, brace, evacuation down the slides) or a main gear
leg that will not lock down (go-around, checklists, spoilers and autobrake not armed, the wing held
up with aileron as long as it will go, then the nacelle on the runway and an evacuation). The captain
and purser brief you in Swedish and English as it happens. Crashes can be survivable or not,
depending on how the aircraft meets the ground.

**Flight path.** The route follows the filleted ground track for the runways in use (a
northerly takes you out on 01L and in on 04L): taxi speeds limited by curvature, thrust set in
two steps, V-speeds from the take-off weight, thrust reduction at 1,500 ft and acceleration at
3,000 ft, 250 kt below FL100, Mach 0.78 at FL360, a managed idle descent on a 3° profile with a
deceleration at FL100, and a 3° ILS glide path.

## Options

Departure time (06:00 is SK1415's real slot; later departures use representative flight
numbers), weather (nine presets — clear, fair-weather cumulus, broken and breezy, overcast with
rain, fog at Arlanda, CAT III fog at Kastrup, thunderstorms, a westerly gale, a cold northerly —
and the full editor), your seat (clickable seat map), passenger load, announcement languages,
graphics quality, time speed, spoken voices, starting at the gate (boarding, pushback and engine
start) or after pushback, and the what-if flight-deck observer seat.

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
* Turbulence: MIL-F-8785C Dryden model (scale lengths and intensities); strengths set to the
  ICAO/WMO categories (moderate: 0.5–1.0 g changes, severe: more than 1 g). Chaos-mode severe
  turbulence follows the SQ321 recorder data (TSIB preliminary report, May 2024: +1.35 g to
  −1.5 g in 0.6 s). Hypoxia: FAA AC 61-107B time of useful consciousness, halved for a rapid
  decompression (SKYbrary).
* A320 procedures and systems: CONF FULL for a one-engine-out landing, autobrake LO 1.7 m/s²
  after 4 s and MED 3 m/s² after 2 s (FlyByWire A32NX documentation), oxygen masks deploying
  at 14,000 ft cabin altitude, 11.7° tail-strike attitude on compressed gear, 7.59 m main-gear
  track, VMO 350 kt / MMO 0.82. Hydraulics: spoilers 1–5 powered green, yellow, blue, yellow,
  green; reverser 1 green, reverser 2 yellow; flaps green + yellow; slats green + blue; gear
  and normal brakes green; nose-wheel steering yellow on the A320neo.
* Accident statistics on the end screen: IATA 2024 Safety Report (7 fatal accidents in
  40.6 million flights); Airbus A320 Family Facts and Figures (176+ million flights since entry
  into service).
* Kastrup ground handling (cph.dk) and the Terminal 3 expansion; Arlanda taxi routes
  (VATSIM Scandinavia ESSA wiki); Airbus cabin chime conventions.
* Weather physics: MIL-F-8785C / MIL-HDBK-1797 Dryden turbulence (as implemented in MathWorks'
  Aerospace Blockset); FAA AC 00-24C *Thunderstorms* (20 NM avoidance, hazards); FAA and NAV CANADA
  microburst definitions (under 4 km, 5–15 minutes); ETSO-C117a / TSO-C117a reactive windshear
  (F-factor averaged over 1 km, alert at about 0.105); lightning strikes about once per aircraft per
  year (IATA, FAA, Airbus figures in the aviation press); thunder heard up to about 10 miles (US
  National Weather Service); METAR format per ICAO Annex 3.
* In-flight medical emergencies: 1 in 604 flights (Peterson et al., *NEJM* 2013).
* Abnormal gear landing: ground spoilers, anti-skid and autobrake not used with the A320 LDG WITH
  ABNORMAL L/G procedure (Airbus *Safety First* magazine, August 2010).
* ATC: Arlanda Delivery 121.825, Ground 121.700 (channel 121.705), Tower 118.500, Stockholm Control
  123.75 (OurAirports / Flight Plan Database ESSA frequency lists); Sweden Control sector L 134.980
  (LiveATC ESMS listing); Kastrup Tower (arrivals) 118.105, Copenhagen Approach West 119.805, Kastrup
  Apron (arrivals) 121.630 (VATSIM Scandinavia EKDK frequencies, OurAirports EKCH); ICAO Doc 4444 /
  Doc 9432 phraseology. Pilot model: McRuer crossover / human-operator model. Airbus
  normal law, protections and FMA modes: FlyByWire A32NX documentation.
* Wing and fuselage bending: Airbus publishes no A320 figures, so the mode frequencies (about 2 Hz and
  3.2 Hz) and the tip deflection (about 0.85 m per g) are engineering estimates.
* Airframe geometry (fuselage stations, cockpit windows, wing planform, flaps, slats and spoilers,
  sharklets, tailplane and fin, LEAP nacelle, gear positions): measured from the FlightGear A320
  family model (legoboyvdlp/a320-family on GitHub, GPL: numbers only, no code). SAS 2019 livery:
  SAS press release *SAS presents new livery* (2019).
* Aerodynamics: CLmax per configuration from the Airbus 1-g stall speeds; alpha protection,
  floor and max tables and the managed speeds (VLS, F, S, green dot) from the FlyByWire A32NX
  source (flybywiresim/aircraft, GPL: numbers and equations only); moments of inertia from the
  same; drag polar (CD0 0.017, k 0.038, gear +0.017, 124 m² wing, 4.29 m MAC) from OpenAP's
  A20N model (junzis/openap, LGPL). Engine thrust lapse after Bartel & Young, *Simplified thrust
  and fuel consumption models for modern two-shaft turbofan engines* (J. Aircraft, 2008); fuel
  flow from the ICAO engine emissions databank entry for the LEAP-1A26.
* LEAP-1A start: ignition above 15 % N2, fuel above 20 %, light-off within 2–3 s, ignition off at
  55 % and starter cut-out at 63 % N2, dry motoring for a bowed rotor up to about a minute at up to
  30 % N2 (AviationHunt *A320neo LEAP-1A engine start*, PPRuNe *A20N engine start*); engine 2 first
  for the yellow system.
* Towing: A320 towbar steering limit 95°, towing speed limit 25 km/h (A320 limitations, PPRuNe
  *push back and towing angle limits*).
* Arlanda A-CDM: Delivery gives the TSAT, Ground approves start-up and pushback; push-back is
  required for jets at the terminal stands (VATSIM Scandinavia ESSA page, Eurocontrol A-CDM
  Stockholm Arlanda). Terminal 5 piers and gates: Swedavia T5 map. Gate F36 for SK1415 is
  representative.
* SAS boarding: priority groups first (SkyPriority, then Plus/Premium and EuroBonus Silver), Go
  Light/Economy Light last (FlyerTalk, More Premium); fare families renamed Economy, Premium and
  Business from October 2025 (Live and Let's Fly). SAS A320neo seat pitch per row: seatmaps.com.
* Admission to the flight crew compartment: EU Regulation 965/2012 Part-CAT CAT.GEN.MPA.135
  (UK CAA regulatory library).
* Traffic timetable: Arlanda departures AF1463 05:55, LX1255 06:05, LH811 06:10, AY826 06:20
  (Arlanda departure boards, airportarlanda.com / flight.info); the Ryanair and SAS departures, the
  Arlanda arrivals and the Kastrup arrivals and departures around 07:00 (SK1202 from Aalborg, airBaltic
  BT131 from Riga — which in reality runs Tuesdays, Thursdays and Saturdays — SK454, D83220) are
  representative of the bank rather than the exact Sunday 10 May 2026 list. Aircraft performance
  (mass, wing area, CD0/k, static thrust) from published type data and OpenAP-style drag polars
  (numbers only).
* Separation and sequencing: 3 NM radar / 2 minutes between departures on the same route, 4 NM on
  final for medium-medium wake pairs, standard speed control (ICAO Doc 4444 §5.8, §8.7, RECAT-EU).
* Flight-deck layout for the controls the pilots reach: FCOM flight-deck description as summarised in
  Airbus A320 cockpit guides (glareshield with FCU and EFIS panels; centre panel with the gear lever
  right of the lower ECAM and the autobrake panel beside it; pedestal with MCDUs, ECAM control panel,
  RMP/ACP, thrust levers with speed brake left and flaps right, pitch trim wheels, engine masters,
  parking brake and transponder aft). Reach time: Fitts' law (Fitts 1954; MacKenzie 1992 pointing
  constants). FCTM golden rule: the PF flying manually asks the PM for FCU selections.
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
| `src/flight.js` | Routes for each runway pair with filleted turns, the return-to-Arlanda pattern, runway geometry |
| `src/physics.js` | Rigid-body flight dynamics, engines, gear, fly-by-wire laws, wing and fuselage bending |
| `src/autoflight.js` | FMGC/FCU: autopilot, flight director and autothrust modes, managed speeds, ILS |
| `src/crew.js` | The two pilots: human operator model, SOPs, callouts, decisions, abnormal drills |
| `src/atc.js` | Controllers as rules: frequencies with one voice at a time, pushback/taxi/runway sequencing, separation, clearances, runway selection |
| `src/traffic.js` | The other flights: real timetable, delays, point-mass performance, pushback, taxi, take-off, arrival, go-around |
| `src/hands.js` | Where each flight-deck control is, and Fitts'-law reach times for the pilots' hands |
| `src/cockpitdisplays.js` | PFD, ND, E/WD, SD pages, MCDU, ISIS, clock, FCU, overhead and pedestal panels drawn live |
| `src/weather.js` | The weather you set: stations, cloud layers, storms with life cycles, lightning, METARs |
| `src/atmosphere.js` | Wind profile, Dryden turbulence, clear-air turbulence, storm flows, microbursts, wake vortices |
| `src/cabinphysics.js` | What the accelerations do to people and things in the cabin |
| `src/events.js` | Physical failures and hazards, what the cabin does about them, evacuation, endings |
| `src/places.js` | Runways, airport layouts, landmarks, route waypoints, departures |
| `src/world.js` | Sky, atmosphere, curved-Earth terrain, water, clouds, weather |
| `src/scenery.js` | Airports, runway lights, parked aircraft, bridge, wind farms, traffic |
| `src/exterior.js` | Wing, flaps, slats, spoilers, engines, sharklets, fuselage and livery, tail, undercarriage, lights |
| `src/textures.js` | Procedural textures: seat backs, fabric/leather/carpet normal maps, faces |
| `src/airframe.js` | Measured A320neo geometry shared by the exterior, cabin, physics and scenery |
| `src/cabin.js` | Cabin interior, seats, windows, bins, galleys, lavatories, doors, signs |
| `src/flightdeck.js` | The flight deck: panels, live display units, levers, pilots, observer seat |
| `src/boarding.js` | Gate hold room, self-boarding gates, jet bridge, passengers boarding, doors and bridge |
| `src/debug.js` | Debug mode: readouts, strip charts, error log, tools, free camera, force vectors |
| `src/humans.js` | Procedural people, clothing, faces, poses |
| `src/people.js` | Passengers and crew behaviour, safety demo gestures, trolleys |
| `src/director.js` | The cabin's side of the flight: signs, lights, PAs, service, arrival — reacting to the crew |
| `src/speech.js` | PA scripts (Swedish/English) and text-to-speech with captions |
| `src/dialogue.js` | Your neighbour |
| `src/audio.js` | Procedural sound |
| `src/player.js` | First-person controls and your seat |
| `src/ui.js` | Start screen, HUD, captions, menus, phone map, safety card |

Fly the whole route headlessly (crew, ATC, weather and physics, about four seconds), optionally
with a failure, a seed, your own wind and the radio transcript:

```bash
node tools/flight-test.mjs storms 6000 --seed=2 --radio
node tools/flight-test.mjs gale 6000 --wind=270/30/45 --sc=efato
```

Scenarios: `efato rto engcruise fire fire2 depress dual hyd cat shear shearto gear medical medical2 ga`.
`--boarding` starts at the gate with the engines off (pushback and engine start); `--traffic` prints
the other flights' states every 30 s; `--win=<t>:<s>`
prints the gear and roll state every step within `s` seconds of time `t`.

Rebuild `dist/SK1415.html` after changing the source:

```bash
npm install
npm run build
```
