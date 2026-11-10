# Skyhawk

A Cessna 172P flight simulator for the PC, built on [Med Engine 3](../medengine/README.md). You fly it yourself. Nothing about how
it flies is scripted: the aeroplane is a rigid body moved only by the forces that the air, the propeller, the engine, the
wheels and gravity put on it, and those forces are worked out from the airflow up. Every switch, knob, lever and circuit
breaker in the cockpit is a 3D part that you operate with the mouse and that does what the real one does.

- **Run it:** `npm start` in this folder (nothing to install), then open http://localhost:8080/ in a browser with WebGPU
  (Chrome or Edge 113+, Safari 26, Firefox 141+ on Windows).
- **Check it:** `npm test` flies the aeroplane against its handbook, headless, in about half a minute (19 tests).

## Flying it

Pick a start on the first card: cold and dark on the apron (tied down, chocked, pitot cover on: the full procedure is yours),
engine running, lined up on the runway, four miles out on the ILS, or in cruise. Weather and time of day are there too.

| | |
| --- | --- |
| Left mouse on a control | Click a switch. Drag a lever or knob up and down. The wheel turns knobs and moves levers finely. Right-click steps back. A label under the mouse says what it is and what it reads. |
| Right mouse drag, wheel | Look around; zoom. `V` held looks closer, `0` centres. |
| `↑ ↓ ← →` or `W S A D` | Yoke (`↓` pulls back). You push with a force, as on a real yoke: the faster you fly, the less the same push moves the surfaces. |
| `Q` `E` | Rudder pedals. They steer the nose wheel as well. |
| `Page Up` `Page Down` | Throttle |
| `Home` `End` | Elevator trim, nose down / nose up. Trim until the yoke needs no force. |
| `F` `R` | Flaps down / up a notch |
| `B` or `Space`, `,` `.`, `K` | Both brakes, left, right, parking brake |
| `Y` | The mouse becomes the yoke (`Y` or `Esc` lets go) |
| `1` `2` `3` | Cockpit, outside, tower |
| `C` `M` `F1` `H` `P` | Checklists, flight and weather, keys, read-out, pause |

A gamepad works too: left stick yoke, right stick rudder, bumpers throttle, `A` brakes, d-pad flaps, `X`/`Y` trim.

**Starting from cold**, in short (the checklists in the game have every step): outside (`2`), click the tie-down ropes, the
chocks and the pitot cover to remove them. Inside (`1`): take out the control lock; mixture in; master switch on; unlock the
primer and give it three strokes if the engine is cold, then lock it; throttle open a tenth; click the key round to BOTH and
hold it to crank; let go when it fires. Oil pressure should rise at once and the ammeter should show a charge.

## What is simulated

| | |
| --- | --- |
| **Air** | Pressure, temperature, density and humidity with height from the day's QNH, temperature and dew point. Wind with a boundary layer, veer and a wind aloft; gusts; turbulence as a field of eddies drifting with the wind, sampled across the airframe, so one wing meets a gust before the other. |
| **Aerodynamics** | The wing, tailplane and fin are cut into 27 strips. Each meets its own local air (the aeroplane's motion and rotation, wind, slipstream, the downwash of every other strip) and looks up lift, drag and moment from section data covering the full circle. A lifting-line vortex model ties the strips together and is mirrored in the ground. From that come induced drag, downwash on the tail and its change with flaps, roll damping, adverse yaw, the stall and what follows it, and ground effect. Fuselage, struts and undercarriage are drag bodies in their own local flow. |
| **Propeller** | Blade-element theory with momentum inflow, eight radial stations at eight azimuths: thrust, torque, P-factor, the sideways force, windmilling, and a swirling slipstream over the tail. Its gyroscopic moment and the engine's torque reaction act on the airframe. |
| **Engine** | A Lycoming O-320-D2J as a machine: air past the throttle plate into the manifold, a float carburettor that meters by venturi suction (so it runs rich as the air thins and you have to lean), fuel that partly wets the manifold walls (so a cold engine needs priming and can be flooded), two magnetos, friction and pumping losses, an electric starter, cylinder-head and oil temperatures, oil pressure, exhaust temperature, carburettor ice and carburettor heat, plug fouling, a vacuum pump. |
| **Fuel** | Two wing tanks with unusable fuel, the selector valve, cross-feed on BOTH, a float bowl that runs dry about a minute after the supply stops. Fuel, people and bags move the weight, the centre of gravity and the inertia. |
| **Electrics** | A 24 V battery with internal resistance and state of charge, a 60 A alternator whose output depends on engine speed, the master and avionics switches, eleven circuit breakers, every consumer drawing its current. The lights dim when the starter cranks. |
| **Controls** | Reversible controls: the elevator sits where pilot force, air load, the trim tab and its own weight balance. Electric flaps at the real rate. Control lock. |
| **Undercarriage** | Spring-and-damper legs, tyres with a brush model (real static friction, slip angles, skids), differential brakes, parking brake, a steerable castoring nose wheel, grass and asphalt, wet and dry. Hard landings collapse a leg; wing tips, tail and propeller can strike the ground. |
| **Instruments** | Pitot-static instruments with the handbook's position error, a lagging vertical-speed indicator, blocked-pitot and alternate-static behaviour. Vacuum gyros that spin up, erect, drift and tumble. An electric turn coordinator and a slip ball. A magnetic compass in a field that dips 73°: it leads and lags in turns and swings with acceleration. Stall horn worked by suction at the wing's leading edge. |
| **Radios** | NAV/COM with standby frequencies, a course deviation indicator, a VOR on the field (FRG 113.90), an ILS on runway 27 (IFRG 110.30), ATIS on 126.025 composed from the actual weather, a transponder. Line-of-sight reception. |
| **The place** | Forge Field: runway 09/27, 1200 × 23 m, ICAO markings, edge and threshold lights, a PAPI at each end that shows red and white by the angle you see it from, a windsock in the simulated wind. The sun is where the date, hour and latitude (59° N) put it. |

## Against the handbook

The numbers below are not inputs. `npm test` measures them and checks each against the Cessna 172P Pilot's Operating Handbook.

| | Handbook | Simulated |
| --- | --- | --- |
| Power at 2700 rpm, full throttle, sea level | 160 hp | 160.6 hp |
| Static rpm at full throttle | 2300 to 2420 | 2378 |
| Top speed at sea level | 123 kt | 122.7 kt at 2695 rpm |
| Cruise at 3000 ft, about 75 % power | 2500 rpm, 114 kt | 2560 rpm, 122 hp, 116 kt |
| Best rate of climb at 76 KIAS, full weight | 700 ft/min | 680 to 695 ft/min |
| Stall, flaps up, power off | 51 KCAS | 51.0 KCAS |
| Stall, flaps 30° | 46 KCAS | 47.6 KCAS |
| Glide at 65 KIAS, propeller windmilling | 9.1 : 1 | 10.3 : 1 |
| Take-off ground roll at full weight | 890 ft, short-field technique | about 1000 to 1270 ft, normal technique |

Section data, flap effectiveness, drag areas and the propeller's blade shape were adjusted until these agreed. The handbook is
the reference; the aeroplane's geometry, weights and control travels are the type's own.

## What is not done, plainly

- **It has only run on a software GPU.** Everything here was developed in headless Chromium on SwiftShader, at about two frames
  a second. It has not been run on a real graphics card, so the frame rate you will get is unmeasured, and nobody has flown it
  by hand: the control feel (key rates, mouse-yoke sensitivity, gamepad) is reasoned, not tuned. The physics takes 0.4 ms per
  1/60 s step.
- **The sound has never been heard.** It is synthesised in the browser and the code runs without errors, but the test machine
  has no audio.
- **No glass.** Med Engine 3 has no blended transparency, so the windows are open frames. The propeller at speed is drawn as an
  occasional blade.
- **The land is flat** and the countryside is a repeating texture with trees and farms on it. Clouds are the engine's sky
  layer: you cannot fly into them, and there is no fog or reduced visibility.
- **Physics:** a lifting-line model, not a flow solver. At forward loadings the power-off stall is a mush at the elevator's
  stop, as in the real aeroplane, and spins have not been checked against anything. No engine wear, detonation or fuel
  contamination. Failures are limited to what you cause: flooding, fouled plugs, carburettor and pitot ice, a flat battery, an
  empty tank, a collapsed leg, a ground strike, overload.
- **Not in it:** an autopilot, a second radio, ADF, DME, air traffic control, opening doors and windows, a pilot figure.
- **The panel** follows the 172P's layout from a labelled reference of the type and from the handbook's limits. It was not
  traced from a photograph of one particular aeroplane.

## Layout

```
flightsim/
  index.html, main.js     the page: start card, read-out, checklists, flight and weather
  serve.mjs               npm start
  src/sim/                the simulation: no graphics, runs under Node
    atmosphere.js           air, wind, gusts, turbulence, the sun
    aero.js                 strips, section data, the vortex system
    propeller.js            blade elements
    powerplant.js           engine, carburettor, fuel system
    electrical.js  gear.js  instruments.js  radios.js
    c172.js                 the aeroplane's numbers
    aircraft.js             the rigid body that puts them together
  src/game/               what you see and touch, on Med Engine 3
    airframe.js             the aeroplane as geometry, every moving part hinged
    panelart.js cockpit.js  the panel's artwork; the instruments and controls
    world.js                the airfield and the land
    sound.js  game.js  build.js
  tests/                  the handbook checks
```

In the page, `window.__sim` is `{ engine, game }`: `game.ac` is the aeroplane, `game.weather` the day, `game.reset('final')`
puts it somewhere else.
