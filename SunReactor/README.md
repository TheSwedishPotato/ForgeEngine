# HELIOS-1 · Sun Reactor Main Control Room

A physics-based simulator of a power plant that holds a star in a magnetic bottle.
You sit at the main control room (MCR) of **HELIOS-1**, a deuterium-tritium spherical
tokamak, and run it from cold magnets to a burning plasma feeding the city of Solhavn
through a 400 kV grid.

Open `index.html` in any modern browser. No build step, no server, no dependencies.

## What is on the boards

| Board | What it shows |
|---|---|
| **Instructor station** (top bar) | Initial conditions IC-1/2/3, freeze, sim speed ×1–×60, malfunction insertion, explain mode, sound |
| **Annunciator panel UA-1** | 36 backlit alarm windows with the ISA-18.1 ring-back sequence: fast flash + horn → ACK → steady → slow flash when cleared → RESET. HORN SILENCE and LAMP TEST included. Tap a window for its alarm response. |
| **Plasma view CAM-07** | The plasma drawn as the star it is: Balmer-pink when cold, solar photosphere with granulation, sunspots, corona and ELM prominences when burning, inside the TF/PF coil cage. |
| **Mimic panel** | Plant flow schematic with animated flows and live tags: reactor, primary loop, pressuriser, steam generator, MSIV, relief valves, turbine, condenser, feedwater, sea water, generator breaker 52G, house load, fuel and exhaust lines. Lamp convention follows US utility practice: **red = running / open, green = stopped / closed.** |
| **Edgewise meters** | Plasma current, mean temperature, electron density, fusion power, βN, q95, CS flux, net electric output, with warning and alarm bands. |
| **SCADA OWS-2** | PROCEDURE (OP-101 start-up, self-checking), TRENDS (strip charts with crosshair), PLASMA (full power balance), PROTECTION (trip matrix), FUEL CYCLE (tritium), EVENTS (sequence-of-events recorder). |
| **Equilibrium** | Poloidal cross-section: flux surfaces coloured by temperature, double-null X-points, divertor heat load, vertical position. |
| **SOL reference** | The real Sun's core next to your plasma, live: temperature, density, pressure, power density, confinement, mass-to-energy rate, and what the Sun's own fuel would produce in this vessel. |
| **Solhavn grid** | Demand, frequency, HVDC interconnector, 12 city districts that go dark under load shedding, energy served and unserved. |
| **Benchboard C-1** | Six angled console sections, A–F, with pistol-grip switches and red/green status lamps, setpoint knobs, illuminated pushbuttons, guarded trip buttons, governor raise/lower, a synchroscope with sync lamps, and LCD readouts. Every control carries an engraved nameplate and tag number (e.g. `HS-CRY-01`). |

Turn on **EXPLAIN** and tap anything to learn what it does without operating it.

## Starting the plant (OP-101)

Load **IC-1** and follow the PROCEDURE page; each step ticks itself off.

1. Torus cryopumps on. Cryoplant on; wait for the magnets to reach 22 K.
2. PHTS pumps P-1A/P-1B, circulating water and feedwater pumps on.
3. Energise the TF coils to 3.6 T. Vertical stability AUTO. Pre-magnetise the central solenoid.
4. Arm disruption mitigation. Open the prefill valve, ECRH ≥ 2 MW. Press **INITIATE**.
5. D-D fuelling in AUTO at n/n_G 0.4, ramp the current to 23 MA.
6. NBI + ICRH + ECRH to cross the L-H threshold into H-mode.
7. RMP coils, pellets, argon seeding and divertor pumping.
8. Tritium plant on, D-T blend at 50 % tritium. Burn control AUTO, ≤ 700 MW until on line.
9. Open the MSIV, latch the turbine, run up to 3000 rpm, excitation on, synchronise, close 52G.
10. Unit master AUTO: HELIOS-1 follows Solhavn's demand.

Use ×5 or ×20 while waiting. **IC-3** starts at full power if you want to go straight to
operating, or to practise malfunctions.

## Physics and plant model (`js/engine.js`)

Volume-averaged (0-D) plasma coupled to a lumped balance-of-plant model, integrated at 50 ms.

- **Fusion:** Bosch–Hale (1992) reactivities for D-T and both D-D branches; a Gamow-form
  p-p reactivity calibrated to the Sun's core (276.5 W/m³ at 15.7 MK). Alpha heating, neutron
  power, helium ash, tritium burn and breeding.
- **Radiation:** bremsstrahlung with Z_eff, tungsten and argon line radiation.
- **Confinement:** IPB98(y,2) scaling (H98 ≈ 1.2 in H-mode for a spherical tokamak, 0.55 in
  L-mode), Martin-2008 L-H threshold with isotope effect, type-I / paced / RMP-suppressed ELMs,
  neoclassical tearing modes stabilised by ECCD.
- **Current:** Spitzer resistivity with neoclassical correction, bootstrap current, NBI and EC
  current drive, 25 V loop-voltage limit, 220 Wb central-solenoid flux budget. When the flux
  runs out the pulse ends with a controlled ramp-down.
- **Limits:** Greenwald density (MARFE), Troyon β (resistive wall mode), q95 kink, vertical
  displacement events, radiative collapse, loss of field, loss of vacuum. Disruptions are
  mitigated by shattered pellet injection only if the DMS is armed.
- **Magnets:** REBCO HTS at 20 K, cryoplant, nuclear heating, quench at 30 K.
- **Heat transport:** blanket energy multiplication, first-wall and primary-coolant heat
  capacities, pump coast-down, pressuriser, steam generator with level and three-element
  feedwater control, steam dump, relief valves, condenser vacuum, decay heat.
- **Turbine-generator:** speed governor with critical-speed band and vibration, overspeed,
  sync-check relay 25, reverse-power relay 32, loss of excitation, droop.
- **Grid:** swing equation for Solhavn frequency, a 450 MW HVDC interconnector, staged
  under-frequency load shedding, TSO restoration, daily load curve and dispatch events.

Machine: R₀ 4.0 m, a 2.2 m, κ 2.8, δ 0.5, V ≈ 1,070 m³, B_T 3.6 T, I_p 23 MA.
At full power it makes ~1.9 GW of fusion power at Q ≈ 45–50, ~720 MW gross and ~490 MW net.

This is a teaching and entertainment model, not an engineering design tool. The numbers are
the right size and the cause-and-effect is physical, but every subsystem is simplified.

## Tests

```bash
node --test SunReactor/test/engine.test.js
```

The suite checks the reactivities against Bosch–Hale's table and the Sun's core, a one-hour
full-power load-follow run, the complete OP-101 start-up performed by a scripted operator
(`test/operator.js`), and the protection responses: VDE with and without mitigation, loss of
coolant flow, cryoplant trip and quench, turbine trip with load shedding, the sync-check relay,
flux exhaustion and determinism.
