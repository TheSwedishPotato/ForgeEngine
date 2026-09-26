/*
 * HELIOS-1 main control room: builds the boards, binds every control to the plant
 * engine, runs the annunciator sequence, SCADA pages, mimic animation and sound.
 */
(function () {
  'use strict';
  const E = window.HeliosEngine, R = window.HeliosRender;
  const $ = sel => document.querySelector(sel);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const fmt = R.fmt;
  const DT = 0.05;

  let s;                       // plant state
  let speed = 1, frozen = false, explain = false;
  let hist = [], lastSample = -1;
  const ui = { controls: [], meters: [], tiles: {}, flows: [], flowOff: {}, tab: 'trend', lastEventCount: 0, infoUntil: 0 };

  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } return null; }

  // ================================================================ AUDIO
  const snd = {
    ctx: null, on: false, horn: null, hornGain: null,
    init() {
      if (this.ctx) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        const g = this.ctx.createGain(); g.gain.value = 0;
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        const o1 = this.ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 466;
        const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 587;
        o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.ctx.destination);
        o1.start(); o2.start();
        this.hornGain = g;
      } catch (e) { this.ctx = null; }
    },
    setHorn(active, now) {
      if (!this.hornGain) return;
      const want = this.on && active && Math.floor(now / 330) % 2 === 0 ? 0.035 : 0;
      this.hornGain.gain.setTargetAtTime(want, this.ctx.currentTime, 0.01);
    },
    blip(freq, dur, type, vol) {
      if (!this.on || !this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + dur);
    },
    click() { this.blip(1400, 0.035, 'square', 0.03); this.blip(180, 0.05, 'triangle', 0.05); },
    chime() { this.blip(1046, 0.4, 'sine', 0.05); },
    thump() { this.blip(55, 1.2, 'sine', 0.25); this.blip(90, 0.6, 'sawtooth', 0.06); }
  };

  // ================================================================ INFO BAR
  function info(title, text, warn) {
    $('#infoTitle').textContent = title;
    $('#infoText').textContent = text;
    $('#infobar').classList.toggle('warn', !!warn);
    ui.infoUntil = performance.now() + 9000;
    $('#infobar').hidden = false;
  }

  // ============================================================ CONTROLS
  // Every control has a tag number, an engraved nameplate and an explanation.
  const sw = (id, tag, label, pos, get, set, lamp, desc, o) => Object.assign({ type: 'sw', id, tag, label, pos, get, set, lamp, desc }, o);
  const knob = (id, tag, label, unit, min, max, step, get, set, desc, o) => Object.assign({ type: 'knob', id, tag, label, unit, min, max, step, get, set, desc }, o);
  const pb = (id, tag, label, lens, act, lit, desc, o) => Object.assign({ type: 'pb', id, tag, label, lens, act, lit, desc }, o);
  const guard = (id, tag, label, lens, act, desc) => ({ type: 'guard', id, tag, label, lens, act, desc });
  const sel = (id, tag, label, opts, get, set, desc) => ({ type: 'sel', id, tag, label, opts, get, set, desc });
  const hold = (id, tag, label, lens, act, desc) => ({ type: 'hold', id, tag, label, lens, act, desc });
  const lcd = (id, label, fn, desc) => ({ type: 'lcd', id, label, fn, desc });
  const cmd = name => st => { const r = E.command(st, name); if (!r.ok) info('COMMAND REFUSED', r.msg, true); else if (r.msg) info('ACTION', r.msg); return r; };

  const SECTIONS = [
    { title: 'A · MAGNETS & CRYOGENICS', items: [
      sw('cryo', 'HS-CRY-01', 'Cryoplant 20 K He refrigerator', ['STOP', 'START'], st => st.mag.cryoCmd, (st, v) => { st.mag.cryoCmd = v; }, st => st.mag.cryoOn,
        'Cools the REBCO high-temperature superconducting magnets to 20 K. Start it first: the TF supply will not energise above 23 K. If it trips at full power the coils warm ~0.7 K/s and quench at 30 K.'),
      sw('tf', 'HS-TF-01', 'TF coil power supply', ['OFF', 'ON'], st => st.mag.tfCmd, (st, v) => { st.mag.tfCmd = v; }, st => st.mag.tfOn,
        'Energises the 12 toroidal-field coils. The field ramps at 0.04 T/s to the setpoint. Switching off with plasma present will collapse the field and disrupt the plasma.'),
      knob('btset', 'SP-TF-01', 'TF field setpoint', 'T', 0, 3.6, 0.1, st => st.mag.BTset, (st, v) => { st.mag.BTset = v; },
        'Toroidal field on axis. 3.6 T is rated. Lower field lowers q95 and raises βN; breakdown needs at least 3.2 T and ECRH needs ~3.1 T for resonance.'),
      sw('vs', 'HS-VS-01', 'Vertical stability control', ['OFF', 'AUTO'], st => st.mag.vsCmd, (st, v) => { st.mag.vsCmd = v; }, st => st.mag.vsCmd && !st.malf.vs,
        'Fast feedback on the in-vessel coils. An elongated (κ = 2.8) plasma is vertically unstable: without this loop it drifts into the wall in under a second (a vertical displacement event).'),
      pb('premag', 'PB-CS-01', 'Central solenoid pre-magnetise', 'PRE-<br>MAG', cmd('premag'), st => st.mag.flux >= 215 ? 'w' : null,
        'Charges the central solenoid to +220 Wb of poloidal flux before a pulse. The flux is spent driving the plasma current; when it runs out the pulse must end. Lamp lit = charged.', { blink: st => st.mag.premag && st.mag.flux < 215 && !st.pl.on }),
      guard('magdump', 'PB-MAG-99', 'Magnet fast discharge', 'DUMP', cmd('magDump'),
        'Emergency discharge of the TF coils into dump resistors (quench protection). Destroys the plasma equilibrium if pressed during a pulse.'),
      lcd('coilT', 'COIL TEMP', st => [fmt(st.mag.coilT, 1), 'K', st.mag.coilT > 24 ? 'alarm' : ''], 'Hottest TF coil winding temperature. Quench at 30 K.'),
      lcd('bt', 'B TOROIDAL', st => [fmt(st.mag.BT, 2), 'T'], 'Measured toroidal field on the magnetic axis.'),
      lcd('flux', 'CS FLUX', st => [fmt(st.mag.flux, 0), 'Wb', st.mag.flux < 40 && st.pl.on ? 'alarm' : ''], 'Remaining central-solenoid flux (volt-seconds).')
    ] },
    { title: 'B · VACUUM, FUEL & TRITIUM', items: [
      sw('vac', 'HS-VAC-01', 'Torus cryopumps', ['STOP', 'START'], st => st.vac.pumpCmd, (st, v) => { st.vac.pumpCmd = v; }, st => st.vac.pumpCmd,
        'Pumps the vacuum vessel (250 m³/s) and exhausts helium ash and unburnt fuel from the divertor to the tritium plant.'),
      sw('prefill', 'HS-GAS-00', 'Prefill gas valve D₂', ['CLOSE', 'OPEN'], st => st.vac.prefillCmd, (st, v) => { st.vac.prefillCmd = v; }, st => st.vac.prefillCmd,
        'Admits a trickle of deuterium before breakdown. Aim for 1–15 mPa in the vessel. Closes automatically when the plasma forms.'),
      sel('blend', 'HS-FU-02', 'Fuel blend select', [['DD', 'D-D'], ['DT', 'D-T'], ['HH', 'H-H SUN']], st => st.fuel.blend, (st, v) => { st.fuel.blend = v; },
        'Which isotopes the gas valves and pellets deliver. D-D for commissioning, D-T for power, H-H is the real Sun\'s fuel (the p-p chain): watch the fusion power fall to essentially zero.'),
      sw('fauto', 'HS-FU-01', 'Fuelling control mode', ['MAN', 'AUTO'], st => st.fuel.auto, (st, v) => { st.fuel.auto = v; if (v) st.fuel.integ = st.fuel.flow; }, st => st.fuel.auto,
        'AUTO: density feedback holds n/n_G at the setpoint. MAN: the gas flow knob sets the fuelling rate directly.'),
      knob('ng', 'SP-FU-01', 'Density setpoint n/n_G', '', 0.2, 1.2, 0.01, st => st.fuel.nG, (st, v) => { st.fuel.nG = v; },
        'Target line density as a fraction of the Greenwald limit n_G = Ip/(πa²). Above ~0.9 confinement degrades; above 1.12 the plasma risks a MARFE density-limit disruption. Burn control moves this knob in AUTO.', { fmt: v => v.toFixed(2) }),
      knob('manflow', 'SP-FU-03', 'Gas flow (manual)', 'Pa·m³/s', 0, 200, 1, st => st.fuel.manFlow, (st, v) => { st.fuel.manFlow = v; },
        'Total fuelling rate used when fuelling is in MAN. 1 Pa·m³/s ≈ 5.3×10²⁰ atoms/s.'),
      knob('tfrac', 'SP-FU-02', 'Tritium fraction', '%', 0, 100, 1, st => st.fuel.tFrac * 100, (st, v) => { st.fuel.tFrac = v / 100; },
        'Share of tritium in the D-T blend. 50 % maximises fusion power (n_D·n_T is largest).'),
      sw('pellet', 'HS-PEL-01', 'Pellet injector', ['OFF', 'ON'], st => st.fuel.pelletCmd, (st, v) => { st.fuel.pelletCmd = v; }, st => st.fuel.pelletCmd && !st.malf.pellet,
        'Fires frozen D-T pellets into the core: 85 % fuelling efficiency versus ~20 % for gas in H-mode, and paces ELMs so they stay small.'),
      knob('pump', 'SP-DIV-01', 'Divertor pump speed', '%', 0, 100, 1, st => st.fuel.pumpSpeed, (st, v) => { st.fuel.pumpSpeed = v; },
        'Exhaust rate from the divertor. Too low and helium ash accumulates, diluting the fuel and choking the burn.'),
      knob('seed', 'SP-DIV-02', 'Argon seeding', '%', 0, 100, 1, st => st.fuel.seed, (st, v) => { st.fuel.seed = v; },
        'Puffs argon into the divertor so it radiates the exhaust heat before it reaches the targets. Too much adds core radiation and can cause a radiative collapse.'),
      sw('isp', 'HS-TRI-01', 'Tritium plant (isotope sep.)', ['STOP', 'START'], st => st.tri.ispCmd, (st, v) => { st.tri.ispCmd = v; }, st => st.tri.ispCmd && !st.malf.isp,
        'Recovers unburnt tritium from the exhaust (99.95 %) and extracts tritium bred in the lithium blanket back to the store. Without it the store drains fast.'),
      knob('li', 'SP-BB-01', 'Blanket Li-6 enrichment', '%', 30, 90, 1, st => st.fuel.liEnrich, (st, v) => { st.fuel.liEnrich = v; },
        'Lithium-6 fraction in the breeding blanket. Sets the tritium breeding ratio (TBR); above 1.0 the plant makes more tritium than it burns.'),
      lcd('vesP', 'VESSEL P', st => [st.vac.P.toExponential(1), 'Pa'], 'Vacuum vessel neutral pressure.'),
      lcd('fflow', 'FUEL FLOW', st => [fmt(st.fuel.flow, 1), 'Pa·m³/s'], 'Actual total fuelling rate (gas + pellets).'),
      lcd('tstore', 'T₂ STORE', st => [fmt(st.tri.store, 0), 'g', st.tri.store < 200 ? 'alarm' : ''], 'Tritium in the storage beds.')
    ] },
    { title: 'C · PLASMA CONTROL SYSTEM', items: [
      pb('init', 'PB-PCS-01', 'Plasma initiation (breakdown)', 'INITIATE', cmd('initiate'), st => (!st.pl.on && st.d.permissives && st.d.permissives.every(p => p.ok)) ? 'w' : (st.pl.on ? 'g' : null),
        'Swings the central solenoid to induce ~10 V around the torus while ECRH assists, ionising the prefill gas into a 1 MA plasma. Lamp white = all permissives met, green = plasma present.'),
      knob('ipset', 'SP-PCS-01', 'Plasma current setpoint', 'MA', 0, 24, 0.5, st => st.pl.IpSet, (st, v) => { st.pl.IpSet = v; },
        'Target plasma current. Higher current confines better and raises the density limit, but costs flux. Rated 23 MA.'),
      knob('ramp', 'SP-PCS-02', 'Current ramp rate', 'MA/s', 0.05, 1, 0.05, st => st.pl.ramp, (st, v) => { st.pl.ramp = v; },
        'How fast the PCS changes the plasma current. Faster ramps consume more flux and supply power.', { fmt: v => v.toFixed(2) }),
      sw('burn', 'HS-PCS-03', 'Burn control', ['MAN', 'AUTO'], st => st.pl.burnAuto, (st, v) => { st.pl.burnAuto = v; }, st => st.pl.burnAuto,
        'AUTO: the PCS trims the density setpoint (fuelling must be in AUTO) to hold the fusion power setpoint. With the unit master in AUTO the setpoint follows Solhavn demand.'),
      knob('pfset', 'SP-PCS-03', 'Fusion power setpoint', 'MW', 0, 2600, 50, st => st.pl.PfusSet, (st, v) => { st.pl.PfusSet = v; },
        'Fusion power the burn controller aims for. Keep ≤ 700 MW until the generator is on line: the steam dump can only take half the steam.'),
      sw('nbi', 'HS-NBI-01', 'Neutral beam injection', ['OFF', 'ON'], st => st.heat.nbiCmd, (st, v) => { st.heat.nbiCmd = v; }, st => st.heat.nbiP > 0.5,
        '1 MeV deuterium beams: heating plus current drive. Interlocked off below 1×10¹⁹ m⁻³ so beams do not shine through and burn the far wall. Wall-plug efficiency 33 %.'),
      knob('nbiset', 'SP-NBI-01', 'NBI power', 'MW', 0, 50, 1, st => st.heat.nbiSet, (st, v) => { st.heat.nbiSet = v; }, 'Injected neutral-beam power.'),
      sw('ec', 'HS-EC-01', 'ECRH / ECCD gyrotrons', ['OFF', 'ON'], st => st.heat.ecCmd, (st, v) => { st.heat.ecCmd = v; }, st => st.heat.ecP > 0.5,
        '170 GHz microwaves at the electron cyclotron resonance. Needed to assist breakdown, drives current, and ≥ 10 MW stabilises neoclassical tearing modes.'),
      knob('ecset', 'SP-EC-01', 'ECRH power', 'MW', 0, 40, 1, st => st.heat.ecSet, (st, v) => { st.heat.ecSet = v; }, 'Gyrotron power launched into the plasma.'),
      sw('ic', 'HS-IC-01', 'ICRH antennas', ['OFF', 'ON'], st => st.heat.icCmd, (st, v) => { st.heat.icCmd = v; }, st => st.heat.icP > 0.5,
        'Ion cyclotron radio-frequency heating: bulk ion heating, no current drive. Useful to cross the L-H threshold.'),
      knob('icset', 'SP-IC-01', 'ICRH power', 'MW', 0, 30, 1, st => st.heat.icSet, (st, v) => { st.heat.icSet = v; }, 'RF power coupled by the ICRH antennas.'),
      sw('rmp', 'HS-RMP-01', 'ELM control coils (RMP)', ['OFF', 'ON'], st => st.heat.rmpCmd, (st, v) => { st.heat.rmpCmd = v; }, st => st.heat.rmpCmd && !st.malf.rmp,
        'Resonant magnetic perturbations suppress edge-localised modes. Unmitigated type-I ELMs erode the divertor and flush tungsten into the core.'),
      pb('soft', 'PB-PCS-09', 'Controlled ramp-down', 'SOFT<br>STOP', cmd('softStop'), st => st.pl.rampDown ? 'a' : null,
        'Ends the pulse gracefully: heating and fuelling fade, current ramps down, the plasma lands softly. The normal way to shut down.', { style: 'amber' }),
      lcd('ip', 'PLASMA Ip', st => [fmt(st.pl.Ip, 2), 'MA'], 'Measured plasma current (Rogowski coil).'),
      lcd('vl', 'LOOP VOLT', st => [st.pl.on ? fmt((st._vApplied || 0) * 1000, 1) : '0.0', 'mV'], 'Loop voltage applied by the central solenoid.'),
      lcd('mode', 'CONFINEMENT', st => [st.pl.on ? (st.pl.hmode ? 'H-MODE' : 'L-MODE') : '—', '', st.pl.hmode ? 'good' : ''], 'H-mode: an edge transport barrier roughly doubles energy confinement.')
    ] },
    { title: 'D · HEAT TRANSPORT & STEAM', items: [
      sw('pa', 'HS-PHT-1A', 'PHTS pump P-1A', ['STOP', 'START'], st => st.htx.pumpACmd, (st, v) => { st.htx.pumpACmd = v; }, st => st.htx.fA > 0.5,
        'Primary heat transport pump: 5,500 kg/s of 15.5 MPa water through the blanket and first wall.'),
      sw('pbb', 'HS-PHT-1B', 'PHTS pump P-1B', ['STOP', 'START'], st => st.htx.pumpBCmd, (st, v) => { st.htx.pumpBCmd = v; }, st => st.htx.fB > 0.5,
        'Second primary pump. Both are needed at full fusion power; on one pump the first wall runs ~50 °C hotter.'),
      knob('pspd', 'SP-PHT-01', 'PHTS pump speed', '%', 20, 100, 1, st => st.htx.speed, (st, v) => { st.htx.speed = v; }, 'Pump speed. Pumping power follows the cube of speed.'),
      sw('cw', 'HS-CW-01', 'Circulating water pumps', ['STOP', 'START'], st => st.htx.cwCmd, (st, v) => { st.htx.cwCmd = v; }, st => st.htx.cwCmd && !st.malf.cw,
        'Sea-water cooling for the condenser. Without it condenser vacuum is lost and the turbine trips.'),
      sw('fwa', 'HS-FW-A', 'Feedwater pump FW-A', ['STOP', 'START'], st => st.htx.fwACmd, (st, v) => { st.htx.fwACmd = v; }, st => st.htx.fwACmd && !st.malf.fwA, 'Feeds the steam generator (800 kg/s).'),
      sw('fwb', 'HS-FW-B', 'Feedwater pump FW-B', ['STOP', 'START'], st => st.htx.fwBCmd, (st, v) => { st.htx.fwBCmd = v; }, st => st.htx.fwBCmd && !st.malf.fwB, 'Second feedwater pump. Both are needed above ~60 % power.'),
      sw('fwauto', 'HS-FW-01', 'FW regulating valve', ['MAN', 'AUTO'], st => st.htx.fwAuto, (st, v) => { st.htx.fwAuto = v; }, st => st.htx.fwAuto,
        'AUTO: three-element control (steam flow, feed flow, level) holds the steam generator at 50 %.'),
      knob('fwpos', 'SP-FW-01', 'FW valve position (MAN)', '%', 0, 100, 1, st => st.htx.fwPos * 100, (st, v) => { st.htx.fwPos = v / 100; }, 'Feedwater regulating valve demand in MAN.'),
      sw('msiv', 'HS-MS-01', 'Main steam isolation valve', ['CLOSE', 'OPEN'], st => st.htx.msivCmd, (st, v) => { st.htx.msivCmd = v; }, st => st.htx.msiv > 0.95,
        'Connects the steam generator to the turbine and steam dump. Strokes in 5 s.'),
      sw('dauto', 'HS-MS-02', 'Steam dump control', ['MAN', 'AUTO'], st => st.htx.dumpAuto, (st, v) => { st.htx.dumpAuto = v; }, st => st.htx.dumpAuto,
        'AUTO: dumps steam to the condenser to hold 7.0 MPa. Capacity is 50 % of full steam flow.'),
      knob('dman', 'SP-MS-02', 'Steam dump position (MAN)', '%', 0, 100, 1, st => st.htx.dumpMan, (st, v) => { st.htx.dumpMan = v; }, 'Steam dump valve demand in MAN.'),
      lcd('thot', 'T HOT LEG', st => [fmt(st.htx.Thot || st.htx.Tavg, 0), '°C'], 'Blanket outlet temperature.'),
      lcd('sgl', 'SG LEVEL', st => [fmt(st.htx.sgL, 1), '%', st.htx.sgL < 30 || st.htx.sgL > 75 ? 'alarm' : ''], 'Steam generator narrow-range level.'),
      lcd('sgp', 'STEAM P', st => [fmt(st.htx.sgP, 2), 'MPa'], 'Main steam pressure.')
    ] },
    { title: 'E · TURBINE-GENERATOR & GRID', items: [
      pb('treset', 'PB-TG-01', 'Turbine latch / reset', 'LATCH', cmd('turbReset'), st => st.tg.tripped ? 'a' : 'g',
        'Resets the trip and opens the stop valves. Lamp amber = tripped, green = latched.'),
      guard('ttrip', 'PB-TG-99', 'Turbine trip', 'TRIP', cmd('turbTrip'), 'Closes all turbine stop valves instantly.'),
      pb('runup', 'PB-TG-02', 'Run-up to 3000 rpm', 'RUN-UP', cmd('runup'), st => (!st.tg.breaker && st.tg.speedSet >= 2990 && st.tg.rpm < 2990) ? 'w' : null,
        'Accelerates the turbine at 25 rpm/s to synchronous speed, passing quickly through the critical-speed band (1250–1650 rpm).'),
      hold('glower', 'PB-TG-03', 'Governor lower', 'LOWER', st => E.command(st, 'govLower'), 'Lowers the speed reference (off line) or load reference (on line, takes the unit master out of AUTO).'),
      hold('graise', 'PB-TG-04', 'Governor raise', 'RAISE', st => E.command(st, 'govRaise'), 'Raises the speed reference (off line) or load reference (on line).'),
      sw('exc', 'HS-EX-01', 'Excitation field breaker 41', ['OFF', 'ON'], st => st.tg.excCmd, (st, v) => { st.tg.excCmd = v; }, st => st.tg.excCmd && !st.malf.exc,
        'Energises the generator rotor so it produces 24 kV. Required before synchronising; loss of excitation trips 52G.'),
      { type: 'synchro', id: 'synchro', tag: 'SYNC-25', label: 'Synchroscope', desc: 'Pointer turns at the slip frequency. Clockwise = generator FAST. Close 52G slowly turning FAST, just before 12 o\'clock. The two lamps go dark when in phase.' },
      pb('asyn', 'PB-SY-01', 'Auto-synchroniser', 'AUTO<br>SYNC', cmd('autoSync'), st => st.tg.autoSync ? 'w' : (st.tg.breaker ? 'g' : null),
        'Trims speed to +3 rpm and closes 52G automatically at the right phase angle.'),
      { type: 'brk', id: 'brk', tag: 'HS-52G', label: 'Generator breaker 52G', desc: 'Connects HELIOS-1 to the Solhavn grid. CLOSE is supervised by the sync-check relay (25): slip < 0.2 Hz, angle < 15°, voltage within 5 %. Red lamp = closed.' },
      sw('unit', 'HS-UM-01', 'Unit master (load-follow)', ['MAN', 'AUTO'], st => st.tg.unitAuto, (st, v) => { st.tg.unitAuto = v; }, st => st.tg.unitAuto,
        'AUTO: the turbine load reference and, with burn control in AUTO, the fusion power follow Solhavn\'s demand.'),
      lcd('rpm', 'SPEED', st => [fmt(st.tg.rpm, 0), 'rpm', st.tg.rpm > 3200 ? 'alarm' : ''], 'Turbine-generator shaft speed.'),
      lcd('gen', 'GENERATOR', st => [fmt(st.tg.breaker ? st.tg.Pgen : 0, 0), 'MW'], 'Gross electrical output.'),
      lcd('lref', 'LOAD REF', st => [st.tg.breaker ? fmt(st.tg.loadRef, 0) : fmt(st.tg.speedSet, 0), st.tg.breaker ? 'MW' : 'rpm'], 'Governor reference: speed when off line, load when on line.')
    ] },
    { title: 'F · SAFETY SYSTEMS', cls: 'safety', items: [
      guard('fpss', 'PB-CSS-99', 'Fast plasma shutdown FPSS', 'FPSS', cmd('fpss'),
        'Central Safety System manual trip: shattered pellets and massive gas injection radiate the plasma energy evenly and suppress runaway electrons. Arm the DMS first or it becomes an unmitigated disruption.'),
      sw('dms', 'HS-DMS-01', 'Disruption mitigation (SPI)', ['SAFE', 'ARMED'], st => st.safety.dmsArmed, (st, v) => { st.safety.dmsArmed = v; }, st => st.safety.dmsArmed && !st.malf.dms,
        'Arms the shattered-pellet injectors. When armed, any disruption is mitigated automatically.', { red: true }),
      lcd('dfw', 'FIRST WALL', st => [fmt(Math.min(100, st.dmg.fw), 1), '% dmg', st.dmg.fw > 10 ? 'alarm' : ''], 'Accumulated first-wall damage from disruptions and runaway electrons.'),
      lcd('ddiv', 'DIVERTOR', st => [fmt(Math.min(100, st.dmg.div), 1), '% dmg', st.dmg.div > 10 ? 'alarm' : ''], 'Divertor target erosion from ELMs, heat flux and disruptions.'),
      lcd('dmag', 'MAGNETS', st => [fmt(Math.min(100, st.dmg.mag), 1), '% dmg', st.dmg.mag > 5 ? 'alarm' : ''], 'Magnet stress from quenches and halo-current forces.'),
      lcd('dcount', 'DISRUPTIONS', st => [String(st.pl.dCount), ''], 'Disruptions and fast shutdowns this session.')
    ] }
  ];

  // ------------------------------------------------------- widget builders
  function nameplate(def, red) { return '<div class="np' + (red ? ' red' : '') + '"><span>' + def.label + (def.type === 'knob' && def.unit ? '<small>' + def.unit + '</small>' : '') + '</span></div><div class="tagno">' + def.tag + '</div>'; }

  function act(def, fn) {
    if (explain) { info(def.tag + ' · ' + def.label.toUpperCase(), def.desc); return; }
    snd.init(); snd.click();
    fn();
  }

  function buildSwitch(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<div class="lamps"><i class="lamp g" title="' + def.pos[0] + '"></i><i class="lamp r" title="' + def.pos[1] + '"></i></div>' +
      '<button class="pistol' + (def.red ? ' red' : '') + '" aria-label="' + def.label + '"><span class="esc"></span><span class="grip"></span></button>' +
      '<div class="pos"><button data-v="0">' + def.pos[0] + '</button><button data-v="1">' + def.pos[1] + '</button></div>' + nameplate(def);
    const btn = n.querySelector('.pistol');
    btn.addEventListener('click', () => act(def, () => def.set(s, !def.get(s))));
    n.querySelectorAll('.pos button').forEach(b => b.addEventListener('click', () => act(def, () => def.set(s, b.dataset.v === '1'))));
    const lg = n.querySelector('.lamp.g'), lr = n.querySelector('.lamp.r'), grip = n.querySelector('.grip'), posB = n.querySelectorAll('.pos button');
    def.update = () => {
      const v = !!def.get(s), st = !!def.lamp(s);
      grip.style.setProperty('--rot', v ? '45deg' : '-45deg');
      lr.classList.toggle('on', st); lg.classList.toggle('on', !st);
      posB[0].classList.toggle('act', !v); posB[1].classList.toggle('act', v);
      btn.setAttribute('aria-pressed', String(v));
    };
    return n;
  }

  function buildSelector(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<div class="lamps"><i class="lamp w"></i></div><button class="pistol" aria-label="' + def.label + '"><span class="esc"></span><span class="grip"></span></button>' +
      '<div class="pos">' + def.opts.map(o => '<button data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div>' + nameplate(def);
    const angles = [-45, 0, 45];
    n.querySelector('.pistol').addEventListener('click', () => act(def, () => {
      const i = def.opts.findIndex(o => o[0] === def.get(s));
      def.set(s, def.opts[(i + 1) % def.opts.length][0]);
    }));
    n.querySelectorAll('.pos button').forEach(b => b.addEventListener('click', () => act(def, () => def.set(s, b.dataset.v))));
    const grip = n.querySelector('.grip'), posB = n.querySelectorAll('.pos button'), lamp = n.querySelector('.lamp');
    def.update = () => {
      const i = def.opts.findIndex(o => o[0] === def.get(s));
      grip.style.setProperty('--rot', angles[i] + 'deg');
      posB.forEach((b, k) => b.classList.toggle('act', k === i));
      lamp.classList.toggle('on', true);
    };
    return n;
  }

  function knobTicks() {
    let t = '';
    for (let i = 0; i <= 10; i++) {
      const a = (-135 + i * 27) * Math.PI / 180, r1 = 29, r2 = i % 5 === 0 ? 23 : 25.5;
      t += '<line x1="' + (31 + Math.sin(a) * r1).toFixed(1) + '" y1="' + (31 - Math.cos(a) * r1).toFixed(1) + '" x2="' + (31 + Math.sin(a) * r2).toFixed(1) + '" y2="' + (31 - Math.cos(a) * r2).toFixed(1) + '" stroke="#1b211e" stroke-width="' + (i % 5 === 0 ? 2 : 1.2) + '"/>';
    }
    return '<svg viewBox="0 0 62 62" aria-hidden="true">' + t + '</svg>';
  }

  function buildKnob(def) {
    const n = el('div', 'ctl');
    const f = def.fmt || (v => (def.step < 1 ? v.toFixed(def.step < 0.1 ? 2 : 1) : v.toFixed(0)));
    n.innerHTML = '<div class="knob" tabindex="0" role="slider" aria-label="' + def.label + '" aria-valuemin="' + def.min + '" aria-valuemax="' + def.max + '">' + knobTicks() + '<div class="cap"></div></div>' +
      '<div class="setv"><button aria-label="Decrease ' + def.label + '">−</button><div class="lcd"><span class="v"></span></div><button aria-label="Increase ' + def.label + '">+</button></div>' + nameplate(def);
    const k = n.querySelector('.knob'), cap = n.querySelector('.cap'), v = n.querySelector('.v');
    const setV = x => { const q = Math.round(clamp(x, def.min, def.max) / def.step) * def.step; def.set(s, +q.toFixed(4)); };
    const [minus, plus] = n.querySelectorAll('.setv button');
    const bump = dir => act(def, () => setV(def.get(s) + dir * def.step));
    minus.addEventListener('click', () => bump(-1));
    plus.addEventListener('click', () => bump(1));
    k.addEventListener('keydown', e => {
      const big = (def.max - def.min) / 10;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); bump(1); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); bump(-1); }
      else if (e.key === 'PageUp') { e.preventDefault(); act(def, () => setV(def.get(s) + big)); }
      else if (e.key === 'PageDown') { e.preventDefault(); act(def, () => setV(def.get(s) - big)); }
    });
    let drag = null;
    k.addEventListener('pointerdown', e => {
      if (explain) { act(def, () => {}); return; }
      snd.init();
      drag = { y: e.clientY, x: e.clientX, v0: def.get(s) };
      k.setPointerCapture(e.pointerId);
    });
    k.addEventListener('pointermove', e => {
      if (!drag) return;
      const dd = (drag.y - e.clientY) + (e.clientX - drag.x) * 0.5;
      setV(drag.v0 + dd / 160 * (def.max - def.min));
    });
    const end = () => { if (drag) { drag = null; snd.click(); } };
    k.addEventListener('pointerup', end); k.addEventListener('pointercancel', end);
    def.update = () => {
      const x = def.get(s);
      cap.style.setProperty('--rot', (-135 + 270 * (x - def.min) / (def.max - def.min)) + 'deg');
      v.textContent = f(x);
      k.setAttribute('aria-valuenow', String(x));
    };
    return n;
  }

  function buildPB(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<button class="pb' + (def.style ? ' ' + def.style : '') + '" aria-label="' + def.label + '">' + def.lens + '</button>' + nameplate(def);
    const b = n.querySelector('.pb');
    b.addEventListener('click', () => act(def, () => def.act(s)));
    def.update = () => {
      const lit = def.lit ? def.lit(s) : null;
      b.classList.remove('lit-w', 'lit-a', 'lit-g', 'lit-r');
      if (lit) b.classList.add('lit-' + lit);
      b.classList.toggle('blink', !!(def.blink && def.blink(s)));
    };
    return n;
  }

  function buildHold(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<button class="pb black" aria-label="' + def.label + '">' + def.lens + '</button>' + nameplate(def);
    const b = n.querySelector('.pb');
    let timer = null, t0 = 0;
    const stop = () => { clearInterval(timer); timer = null; b.classList.remove('pressed'); };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (explain) { act(def, () => {}); return; }
      act(def, () => def.act(s));
      b.classList.add('pressed'); t0 = performance.now();
      timer = setInterval(() => { const held = performance.now() - t0; def.act(s); if (held > 1500) { def.act(s); def.act(s); } }, 120);
    });
    b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(def, () => def.act(s)); } });
    def.update = () => {};
    return n;
  }

  function buildGuard(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<div class="guard"><button class="mush" aria-label="' + def.label + '">' + def.lens + '</button><div class="cover" role="button" tabindex="0" aria-label="Lift guard over ' + def.label + '">LIFT</div></div>' + nameplate(def, true);
    const g = n.querySelector('.guard'), cover = n.querySelector('.cover'), mush = n.querySelector('.mush');
    let tm = null;
    const open = () => {
      if (explain) { act(def, () => {}); return; }
      g.classList.add('open'); snd.init(); snd.click();
      clearTimeout(tm); tm = setTimeout(() => g.classList.remove('open'), 6000);
    };
    cover.addEventListener('click', open);
    cover.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    mush.addEventListener('click', () => { if (!g.classList.contains('open')) { open(); return; } act(def, () => def.act(s)); g.classList.remove('open'); });
    def.update = () => {};
    return n;
  }

  function buildLcd(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<div class="lcd"><span class="k">' + def.label + '</span><span class="v"></span></div>';
    n.title = def.desc;
    const box = n.querySelector('.lcd'), v = n.querySelector('.v');
    n.addEventListener('click', () => { if (explain) info(def.label, def.desc); });
    def.update = () => {
      const [val, unit, cls] = def.fn(s);
      v.innerHTML = val + (unit ? '<small>' + unit + '</small>' : '');
      box.className = 'lcd' + (cls ? ' ' + cls : '');
    };
    return n;
  }

  function buildSynchro(def) {
    const n = el('div', 'ctl wide');
    let ticks = '';
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, r2 = i % 6 === 0 ? 40 : 44;
      ticks += '<line x1="' + (60 + Math.sin(a) * 48).toFixed(1) + '" y1="' + (60 - Math.cos(a) * 48).toFixed(1) + '" x2="' + (60 + Math.sin(a) * r2).toFixed(1) + '" y2="' + (60 - Math.cos(a) * r2).toFixed(1) + '" stroke="#222" stroke-width="' + (i % 6 === 0 ? 2 : 1) + '"/>';
    }
    n.innerHTML = '<div class="synchro"><svg viewBox="0 0 120 120" role="img" aria-label="Synchroscope">' +
      '<circle cx="60" cy="60" r="56" fill="#1b211e"/><circle cx="60" cy="60" r="50" fill="#f1efe4"/>' + ticks +
      '<path d="M54,8 L66,8 L60,20 Z" fill="#b3170f"/>' +
      '<text x="96" y="64" font-size="9" font-weight="700" text-anchor="middle" fill="#333" font-family="Barlow Condensed">FAST</text>' +
      '<text x="24" y="64" font-size="9" font-weight="700" text-anchor="middle" fill="#333" font-family="Barlow Condensed">SLOW</text>' +
      '<path d="M70,78 A20,20 0 0 0 80,62" fill="none" stroke="#555" stroke-width="1.5" marker-end="url(#arrow)"/>' +
      '<g id="synNeedle"><line x1="60" y1="66" x2="60" y2="16" stroke="#111" stroke-width="3" stroke-linecap="round"/></g><circle cx="60" cy="60" r="5" fill="#111"/>' +
      '<text x="60" y="92" font-size="10" text-anchor="middle" fill="#333" font-family="IBM Plex Mono" id="synTxt">—</text></svg>' +
      '<div class="synlamps"><i class="lamp w" id="synL1"></i><span class="tagno">SYNC LAMPS</span><i class="lamp w" id="synL2"></i></div></div>' + nameplate(def);
    n.addEventListener('click', () => { if (explain) info(def.tag + ' · SYNCHROSCOPE', def.desc); });
    const needle = n.querySelector('#synNeedle'), txt = n.querySelector('#synTxt'), l1 = n.querySelector('#synL1'), l2 = n.querySelector('#synL2');
    def.update = () => {
      const tg = s.tg;
      const ang = tg.breaker ? 0 : tg.phase;
      needle.setAttribute('transform', 'rotate(' + ang.toFixed(1) + ' 60 60)');
      const slip = tg.rpm / 60 - s.grid.f;
      txt.textContent = tg.breaker ? 'ON LINE' : (tg.rpm < 2700 ? 'OFF' : (slip >= 0 ? '+' : '−') + Math.abs(slip).toFixed(2) + ' Hz');
      const b = tg.breaker || tg.rpm < 2700 || !tg.excCmd ? 0 : Math.abs(Math.sin(ang * Math.PI / 360));
      [l1, l2].forEach(l => { l.style.opacity = String(0.25 + b * 0.75); l.classList.toggle('on', b > 0.15); });
    };
    return n;
  }

  function buildBreaker(def) {
    const n = el('div', 'ctl');
    n.innerHTML = '<div class="lamps"><i class="lamp g" title="OPEN"></i><i class="lamp r" title="CLOSED"></i></div>' +
      '<button class="pistol red" aria-label="Generator breaker 52G"><span class="esc"></span><span class="grip"></span></button>' +
      '<div class="pos"><button data-v="0">TRIP</button><button data-v="1">CLOSE</button></div>' + nameplate(def);
    const doIt = close => act(def, () => cmd(close ? 'breakerClose' : 'breakerOpen')(s));
    n.querySelector('.pistol').addEventListener('click', () => doIt(!s.tg.breaker));
    n.querySelectorAll('.pos button').forEach(b => b.addEventListener('click', () => doIt(b.dataset.v === '1')));
    const lg = n.querySelector('.lamp.g'), lr = n.querySelector('.lamp.r'), grip = n.querySelector('.grip');
    let flag = 0;
    def.update = () => {
      lr.classList.toggle('on', s.tg.breaker); lg.classList.toggle('on', !s.tg.breaker);
      // spring-return pistol: sits at centre, shows last operation briefly
      const want = s.tg.breaker ? 1 : -1;
      if (want !== flag) { flag = want; grip.style.setProperty('--rot', (want * 45) + 'deg'); setTimeout(() => grip.style.setProperty('--rot', '0deg'), 700); }
    };
    return n;
  }

  function buildBench() {
    const bench = $('#bench');
    bench.innerHTML = '';
    ui.controls = [];
    for (const sec of SECTIONS) {
      const box = el('div', 'bsec' + (sec.cls ? ' ' + sec.cls : ''));
      box.appendChild(el('h3', null, sec.title));
      const grid = el('div', 'ctls');
      for (const def of sec.items) {
        const b = { sw: buildSwitch, knob: buildKnob, pb: buildPB, guard: buildGuard, sel: buildSelector, hold: buildHold, lcd: buildLcd, synchro: buildSynchro, brk: buildBreaker }[def.type];
        const node = b(def);
        node.dataset.id = def.id;
        if (def.desc) node.title = def.tag + ': ' + def.desc;
        grid.appendChild(node);
        ui.controls.push(def);
      }
      box.appendChild(grid);
      bench.appendChild(box);
    }
  }

  // ============================================================ ANNUNCIATOR
  const ARP = {
    disr: 'The plasma disrupted. Check the SOE on the EVENTS page for the cause, confirm the DMS fired, then re-premagnetise the CS for the next pulse.',
    vde: 'Plasma is drifting vertically. Confirm HS-VS-01 is in AUTO. If it keeps growing, press FPSS before it touches the wall.',
    dens: 'Density above 95 % of the Greenwald limit. Lower SP-FU-01 or raise the plasma current.',
    beta: 'Plasma pressure near the MHD limit. Reduce heating or fusion power setpoint.',
    q95: 'Edge safety factor low. Raise the toroidal field or reduce plasma current.',
    ntm: 'A tearing mode island is degrading confinement. Put ≥ 10 MW of ECRH on (HS-EC-01) to stabilise it within 40 s.',
    elm: 'Large type-I ELMs are eroding the divertor. Switch on the RMP coils (HS-RMP-01) or pace with pellets.',
    rad: 'More than 80 % of the heating is being radiated. Reduce argon seeding or tungsten sources; add heating.',
    he: 'Helium ash above 8 %. Raise the divertor pump speed (SP-DIV-01).',
    tung: 'Tungsten is accumulating in the core. Cut the divertor heat flux (more seeding) and suppress ELMs.',
    div: 'Divertor heat flux above 10 MW/m². Raise argon seeding (SP-DIV-02).',
    flux: 'Central solenoid flux below 40 Wb. Add current drive (NBI/ECCD) or plan a controlled ramp-down.',
    nbi: 'NBI is interlocked because the density is below 1×10¹⁹ m⁻³. Raise density first.',
    bd: 'Breakdown refused. The INITIATE nameplate help lists the permissives; the PROCEDURE page shows what is missing.',
    coil: 'Magnet temperature high. Check the cryoplant. Quench occurs at 30 K; consider a controlled ramp-down or FPSS.',
    quench: 'A TF coil quenched and was discharged. Wait for the coils to recool below 26 K before re-energising.',
    cryo: 'Magnets are energised but the cryoplant is not running. Restart HS-CRY-01 immediately.',
    vac: 'Vessel pressure high: possible air ingress. Do not initiate plasma.',
    fw: 'First wall above 450 °C. Check PHTS pumps and flow. Automatic FPSS at 520 °C.',
    flow: 'Primary coolant flow below 60 %. Start the PHTS pumps or reduce power.',
    prz: 'Primary pressure high. Heat input exceeds heat removal: check steam generator and steam path.',
    sglo: 'Steam generator level low. Check feedwater pumps and FW valve. Turbine trip and FPSS at 12 %.',
    sghi: 'Steam generator level high. Reduce feedwater. Turbine trip at 85 %.',
    sgp: 'Steam relief valves are venting to atmosphere. Open the steam dump or load the turbine.',
    cond: 'Condenser vacuum poor. Start the circulating water pumps. Turbine trip at 25 kPa.',
    ttrip: 'Turbine tripped. Fix the cause, then LATCH (PB-TG-01) and RUN-UP.',
    vib: 'Bearing vibration above 7.1 mm/s (ISO 10816 zone C). Do not hold the turbine in the critical band.',
    crit: 'Turbine dwelling in the critical-speed band 1250–1650 rpm. Raise or lower speed out of the band.',
    ospd: 'Turbine above 3200 rpm. Overspeed trip at 3300 rpm.',
    freq: 'Solhavn frequency outside 49.8–50.2 Hz. Match output to demand.',
    ufls: 'Under-frequency load shedding has disconnected districts of Solhavn. Supply more power; the TSO restores districts when there is headroom.',
    dev: 'Net output has been more than 10 % away from demand for 30 s. Put the unit master in AUTO or adjust load.',
    tstore: 'Tritium store below 200 g. Start the tritium plant and raise Li-6 enrichment.',
    isp: 'Burning D-T with the tritium plant stopped: exhaust tritium is not being recovered.',
    dms: 'Plasma present with disruption mitigation disarmed. Arm HS-DMS-01.',
    dmg: 'Cumulative in-vessel damage above 10 %. Avoid further unmitigated disruptions and ELMs.'
  };

  function buildTiles() {
    const box = $('#tiles');
    box.innerHTML = '';
    ui.tiles = {};
    for (const a of E.ALARMS) {
      const t = el('div', 'tile p' + a.pri, a.text);
      t.setAttribute('role', 'button'); t.tabIndex = 0;
      t.addEventListener('click', () => info('ALARM · ' + a.text.replace('\n', ' '), ARP[a.id] || ''));
      box.appendChild(t);
      ui.tiles[a.id] = { el: t, state: 'off', pri: a.pri };
    }
  }
  function updateTiles(silentInit) {
    const act = E.activeAlarms(s);
    let anyAlert = false;
    for (const id in ui.tiles) {
      const t = ui.tiles[id], on = act[id];
      if (silentInit) t.state = on ? 'ack' : 'off';
      else if (on && (t.state === 'off' || t.state === 'ring')) { t.state = 'alert'; ui.silenced = false; }
      else if (!on && t.state === 'ack') { t.state = 'ring'; snd.chime(); }
      if (t.state === 'alert') anyAlert = true;
      t.el.classList.toggle('alert', t.state === 'alert');
      t.el.classList.toggle('lit', t.state === 'ack');
      t.el.classList.toggle('ring', t.state === 'ring');
    }
    ui.anyAlert = anyAlert;
  }
  function annunButtons() {
    $('#annAck').addEventListener('click', () => { snd.init(); snd.click(); for (const id in ui.tiles) { const t = ui.tiles[id]; if (t.state === 'alert') t.state = 'ack'; } updateTiles(); });
    $('#annSil').addEventListener('click', () => { snd.init(); snd.click(); ui.silenced = true; });
    $('#annReset').addEventListener('click', () => { snd.click(); for (const id in ui.tiles) { const t = ui.tiles[id]; if (t.state === 'ring') t.state = 'off'; } updateTiles(); });
    const test = $('#annTest'), panel = document.querySelector('.annun');
    test.addEventListener('pointerdown', () => { snd.init(); panel.classList.add('test'); setTimeout(() => panel.classList.remove('test'), 2500); });
  }

  // ================================================================ METERS
  const METERS = [
    { label: 'Plasma current', unit: 'MA', min: 0, max: 25, get: st => st.pl.Ip, bands: [[24, 25, 'warn']] },
    { label: 'Mean temperature', unit: 'keV', min: 0, max: 25, get: st => st.d.T },
    { label: 'Electron density', unit: '10²⁰ m⁻³', min: 0, max: 2, get: st => st.d.ne / 1e20 },
    { label: 'Fusion power', unit: 'MW', min: 0, max: 2500, get: st => st.d.Pfus / 1e6 },
    { label: 'Normalised β', unit: 'βN', min: 0, max: 6, get: st => st.d.betaN, bands: [[4.5, 5, 'warn'], [5, 6, 'alarm']] },
    { label: 'Safety factor', unit: 'q95', min: 0, max: 12, get: st => st.d.q95, bands: [[0, 2, 'alarm'], [2, 3, 'warn']] },
    { label: 'CS flux', unit: 'Wb', min: 0, max: 220, get: st => st.mag.flux, bands: [[0, 40, 'warn']] },
    { label: 'Net electric', unit: 'MW', min: -300, max: 700, get: st => st.d.Pnet }
  ];
  function buildMeters() {
    const bank = $('#meterbank');
    bank.innerHTML = '';
    ui.meters = METERS.map(m => {
      const n = el('div', 'meter');
      let ticks = '';
      for (let i = 0; i <= 10; i++) {
        const y = 100 - i * 10;
        ticks += '<i class="' + (i % 5 === 0 ? 'maj' : '') + '" style="top:' + y + '%"></i>';
        if (i % 5 === 0) ticks += '<b style="top:' + y + '%">' + fmtTick(m.min + (m.max - m.min) * i / 10) + '</b>';
      }
      const bands = (m.bands || []).map(([a, b, c]) => '<span class="band ' + c + '" style="bottom:' + ((a - m.min) / (m.max - m.min) * 100) + '%;height:' + ((b - a) / (m.max - m.min) * 100) + '%"></span>').join('');
      n.innerHTML = '<div class="face" role="meter" aria-label="' + m.label + '" aria-valuemin="' + m.min + '" aria-valuemax="' + m.max + '">' + bands + '<span class="unit">' + m.unit + '</span><div class="ticks">' + ticks + '</div><div class="needle"></div></div>' +
        '<div class="lcd"><span class="v">—</span></div><div class="np">' + m.label + '</div>';
      bank.appendChild(n);
      return { m, needle: n.querySelector('.needle'), v: n.querySelector('.v'), face: n.querySelector('.face') };
    });
  }
  function fmtTick(v) { return Math.abs(v) >= 1000 ? (v / 1000) + 'k' : (Number.isInteger(v) ? String(v) : v.toFixed(1)); }
  function updateMeters() {
    for (const u of ui.meters) {
      const v = u.m.get(s) || 0;
      const f = clamp((v - u.m.min) / (u.m.max - u.m.min), 0, 1);
      u.needle.style.bottom = 'calc(6px + ' + (f * 100).toFixed(2) + '% - ' + (f * 12).toFixed(1) + 'px)';
      u.v.textContent = (u.m.max >= 100 ? fmt(v, 0) : fmt(v, u.m.max <= 2 ? 2 : 1));
      u.face.setAttribute('aria-valuenow', String(v));
    }
  }

  // ================================================================ KEY ROW
  const KEYS = [
    ['P FUSION', st => [fmt(st.d.Pfus / 1e6, 0), 'MW']],
    ['GAIN Q', st => [st.pl.on ? (isFinite(st.d.Q) ? fmt(st.d.Q, 1) : 'IGNITED') : '—', '']],
    ['CORE T₀', st => [st.pl.on ? fmt(st.d.T0 * E.MK_PER_KEV, 0) : '—', 'MK']],
    ['PLASMA Ip', st => [fmt(st.pl.Ip, 1), 'MA']],
    ['NEUTRONS', st => [st.pl.on ? st.d.neutronRate.toExponential(2) : '0', '/s']],
    ['NET OUTPUT', st => [fmt(st.d.Pnet, 0), 'MW', st.d.Pnet < 0 ? 'alarm' : 'good']]
  ];
  function buildKeys() {
    const row = $('#keyrow'); row.innerHTML = '';
    ui.keys = KEYS.map(([k, fn]) => { const n = el('div', 'lcd', '<span class="k">' + k + '</span><span class="v"></span>'); row.appendChild(n); return { n, fn, v: n.querySelector('.v') }; });
  }
  function updateKeys() { for (const k of ui.keys) { const [v, u, c] = k.fn(s); k.v.innerHTML = v + (u ? '<small>' + u + '</small>' : ''); k.n.className = 'lcd' + (c ? ' ' + c : ''); } }

  // ================================================================= MIMIC
  function buildMimic() {
    const svg = $('#mimicSvg');
    ui.flows = [];
    svg.querySelectorAll('.pipe[data-flow]').forEach(p => {
      const f = p.cloneNode(false);
      f.setAttribute('class', 'flow');
      p.after(f);
      ui.flows.push({ el: f, key: p.dataset.flow });
    });
  }
  const txt = (id, v) => { const n = document.getElementById(id); if (n && n.textContent !== v) n.textContent = v; };
  const cls = (id, c, on) => { const n = document.getElementById(id); if (n) n.classList.toggle(c, !!on); };
  function flowSpeeds() {
    const h = s.htx;
    return {
      cryo: s.mag.cryoOn ? 0.4 : 0,
      heat: (s.heat.nbiP + s.heat.ecP + s.heat.icP) / 40,
      fuel: s.fuel.flow / 40 + (s.vac.prefillCmd ? 0.2 : 0),
      exhaust: s.vac.pumpCmd ? 0.4 : 0,
      phts: (h.fA + h.fB) / 2, phtsB: h.fB,
      steam: h.steamGen / 1300, steamT: h.steamTurb / 1300, exhaustLP: h.steamTurb / 1300,
      dump: h.steamDump / 650, cw: h.cwCmd && !s.malf.cw ? 0.8 : 0,
      fw: h.fwFlow / 1300, fwB: h.fwBCmd ? h.fwFlow / 1300 : 0
    };
  }
  function animateFlows(dt) {
    const sp = flowSpeeds();
    for (const f of ui.flows) {
      const v = clamp(sp[f.key] || 0, 0, 1.6);
      ui.flowOff[f.key] = ((ui.flowOff[f.key] || 0) - v * dt * 60) % 1800;
      f.el.style.strokeDashoffset = ui.flowOff[f.key].toFixed(1);
      f.el.style.opacity = v > 0.01 ? '1' : '0';
    }
  }
  function updateMimic() {
    const h = s.htx, d = s.d, tg = s.tg;
    cls('mm-cryo', 'on', s.mag.cryoOn);
    cls('mm-heat', 'on', s.heat.nbiP + s.heat.ecP + s.heat.icP > 0.5);
    cls('mm-fuel', 'on', s.tri.ispCmd && !s.malf.isp);
    cls('mm-pump', 'on', s.vac.pumpCmd);
    txt('mt-coil', fmt(s.mag.coilT, 1) + ' K · ' + fmt(s.mag.BT, 2) + ' T');
    txt('mt-heat', fmt(s.heat.nbiP + s.heat.ecP + s.heat.icP, 0) + ' MW');
    txt('mt-pl', s.pl.on ? fmt(d.Pfus / 1e6, 0) + ' MW' : 'NO PLASMA');
    txt('mt-fw', 'FW ' + fmt(h.Tfw, 0) + ' °C');
    txt('mt-thot', fmt(h.Thot || h.Tavg, 0) + ' °C');
    txt('mt-tcold', fmt(h.Tcold || h.Tavg, 0) + ' °C');
    txt('mt-prz', fmt(h.prz, 2) + ' MPa');
    txt('mt-sgl', 'L ' + fmt(h.sgL, 0) + ' %');
    txt('mt-flow', fmt(h.flow || 0, 0) + ' kg/s');
    txt('mt-sgp', fmt(h.sgP, 2) + ' MPa');
    txt('mt-rpm', fmt(tg.rpm, 0) + ' rpm');
    txt('mt-gen', fmt(tg.breaker ? tg.Pgen : 0, 0) + ' MW');
    txt('mt-house', fmt(d.house, 0) + ' MW');
    txt('mt-pc', fmt(h.Pc, 1) + ' kPa');
    txt('mt-fwf', fmt(h.fwFlow, 0) + ' kg/s');
    txt('mt-fuel', fmt(s.fuel.flow, 0) + ' Pa·m³/s');
    txt('mt-vac', s.vac.P.toExponential(1) + ' Pa');
    const valve = (id, pos) => { const n = document.getElementById(id); if (!n) return; n.classList.toggle('open', pos > 0.95 || (pos > 0.02 && id !== 'mv-msiv')); n.classList.toggle('mid', id === 'mv-msiv' && pos > 0.02 && pos < 0.95); };
    valve('mv-gis', s.fuel.flow > 0.5 || s.vac.prefillCmd ? 1 : 0);
    valve('mv-msiv', h.msiv);
    valve('mv-srv', h.relief > 0 ? 1 : 0);
    valve('mv-tv', tg.tripped ? 0 : tg.valve);
    valve('mv-dump', h.dumpPos);
    valve('mv-fw', h.fwPos);
    cls('mb-52g', 'closed', tg.breaker);
    const pump = (id, run, fault) => { cls(id, 'run', run && !fault); cls(id, 'fault', fault); };
    pump('mp-1a', h.fA > 0.3, s.malf.pumpA && h.pumpACmd);
    pump('mp-1b', h.fB > 0.3, s.malf.pumpB && h.pumpBCmd);
    pump('mp-cw', h.cwCmd && !s.malf.cw, s.malf.cw && h.cwCmd);
    pump('mp-fwa', h.fwACmd && !s.malf.fwA, s.malf.fwA && h.fwACmd);
    pump('mp-fwb', h.fwBCmd && !s.malf.fwB, false);
    const pc = document.getElementById('mm-plasma');
    if (pc) {
      const I = s.pl.on ? clamp(Math.log10(1 + d.Pheat / 1e6) / 2.8, 0.1, 1) : 0;
      pc.setAttribute('opacity', (0.1 + I * 0.9).toFixed(2));
      pc.setAttribute('r', s.pl.on ? (40 + 30 * Math.sqrt(clamp(s.pl.Ip / 23, 0, 1))).toFixed(1) : '70');
    }
  }

  // ================================================================= SCADA
  const PROC = [
    ['Start the torus cryopumps (HS-VAC-01).', st => st.vac.pumpCmd && st.vac.P < 1e-4, 'Vessel below 10⁻⁴ Pa.'],
    ['Start the cryoplant (HS-CRY-01) and wait for the coils to reach 22 K.', st => st.mag.coilT < 22.5, 'Use ×5 or ×20 speed while you wait.'],
    ['Start PHTS pumps P-1A and P-1B, the circulating water pumps and both feedwater pumps.', st => st.htx.fA > 0.9 && st.htx.fB > 0.9 && st.htx.cwCmd && st.htx.fwACmd && st.htx.fwBCmd, 'The first wall must be cooled before any plasma.'],
    ['Energise the TF coils (HS-TF-01) and wait for 3.6 T.', st => st.mag.BT >= 3.55, ''],
    ['Vertical stability to AUTO (HS-VS-01), then press CS PRE-MAG (PB-CS-01).', st => st.mag.vsCmd && (st.mag.flux >= 215 || st.pl.on), 'The PRE-MAG lamp lights when charged to 220 Wb.'],
    ['Arm the disruption mitigation system (HS-DMS-01).', st => st.safety.dmsArmed, ''],
    ['Open the prefill valve (HS-GAS-00) and switch on ECRH (HS-EC-01) at ≥ 2 MW.', st => st.pl.on || (st.vac.P >= 1e-3 && st.heat.ecP >= 2), 'Vessel pressure must sit between 1 and 15 mPa.'],
    ['Press INITIATE (PB-PCS-01) when its lamp shows white.', st => st.pl.on || st.pl.pulse > 0, 'A 1 MA plasma forms.'],
    ['Blend D-D, fuelling AUTO at n/n_G 0.4, current setpoint 23 MA.', st => st.pl.on && st.pl.Ip >= 8, 'The PCS ramps the current at the ramp-rate setting.'],
    ['NBI 25 MW, ICRH 20 MW and ECRH 15 MW to cross the L-H threshold.', st => st.pl.on && st.pl.hmode, 'Watch for the L-H TRANSITION event and the H-MODE lamp.'],
    ['RMP coils ON, pellet injector ON, argon seeding ~50 %, divertor pumps ~80 %.', st => st.heat.rmpCmd && st.fuel.pelletCmd && st.fuel.seed >= 30, 'Suppresses ELMs and spreads the exhaust heat.'],
    ['Start the tritium plant (HS-TRI-01), select D-T at 50 % tritium, n/n_G 0.7.', st => st.pl.on && st.fuel.blend === 'DT' && st.d.Pfus > 300e6, 'Fusion power climbs within seconds.'],
    ['Burn control AUTO (HS-PCS-03), fusion setpoint ≤ 700 MW until on line.', st => st.pl.burnAuto, 'The steam dump can only take half the steam.'],
    ['Open the MSIV (HS-MS-01), LATCH the turbine (PB-TG-01), then RUN-UP (PB-TG-02).', st => st.tg.rpm > 2950, 'The turbine accelerates at 25 rpm/s.'],
    ['Excitation ON (HS-EX-01), then AUTO SYNC (PB-SY-01) or close 52G by hand near 12 o\'clock.', st => st.tg.breaker, 'Solhavn districts come back as HELIOS-1 picks up load.'],
    ['Unit master AUTO (HS-UM-01): HELIOS-1 now follows Solhavn demand.', st => st.tg.unitAuto && st.tg.breaker, 'Keep the burn, the tritium and the grid in balance.']
  ];
  function renderProc() {
    let cur = -1;
    const items = PROC.map((p, i) => { const done = !!p[1](s); if (!done && cur < 0) cur = i; return { p, done }; });
    return '<div class="proc"><h3>OP-101 · PLANT START-UP FROM SHUTDOWN</h3><p>Steps tick themselves off as the plant reaches each condition. Load IC-1 from the instructor station to start from cold.</p><ol>' +
      items.map((it, i) => '<li class="' + (it.done ? 'done' : '') + (i === cur ? ' now' : '') + '"><div><span class="chk">' + (it.done ? '✓ DONE' : i === cur ? '▶ NEXT' : '· PENDING') + '</span> ' + it.p[0] + (it.p[2] ? '<small>' + it.p[2] + '</small>' : '') + '</div></li>').join('') + '</ol></div>';
  }
  function row(k, v, u) { return '<tr><th>' + k + '</th><td>' + v + (u ? ' ' + u : '') + '</td></tr>'; }
  function secRow(t) { return '<tr class="sec"><th colspan="2">' + t + '</th></tr>'; }
  function renderPlasma() {
    const d = s.d, pl = s.pl, MW = x => fmt(x / 1e6, 1);
    if (!pl.on) return '<p class="proc">No plasma. Last pulse: #' + pl.pulse + (pl.lastDisruption ? ' ended by ' + pl.lastDisruption.reason + ' at ' + pl.lastDisruption.clock : '') + '.</p>';
    return '<table class="kv">' +
      secRow('POWER BALANCE') + row('Fusion power', MW(d.Pfus), 'MW') + row('α heating', MW(d.Palpha), 'MW') + row('Neutron power', MW(d.Pn), 'MW') +
      row('Auxiliary absorbed', MW(d.Paux), 'MW') + row('Ohmic', MW(d.Poh), 'MW') + row('Bremsstrahlung', MW(d.Pbrem), 'MW') + row('Line radiation (W, Ar)', MW(d.Pline), 'MW') +
      row('Power across separatrix', MW(d.Psep), 'MW') + row('L-H threshold (Martin 2008)', MW(d.PLH), 'MW') + row('Divertor heat flux', fmt(d.qdiv, 1), 'MW/m²') +
      row('Plasma gain Q', isFinite(d.Q) ? fmt(d.Q, 1) : '∞') +
      secRow('CONFINEMENT') + row('Stored energy W_th', fmt(pl.W / 1e6, 0), 'MJ') + row('τ_E (IPB98(y,2))', fmt(d.tauE, 2), 's') + row('H98 factor', fmt(d.Hfac, 2)) +
      row('Triple product n₀T₀τ_E', d.triple.toExponential(2), 'keV·s/m³') + row('ELM regime', pl.elmType) + row('ELMs this session', String(pl.elmCount)) +
      secRow('MHD & CURRENT') + row('β_t', fmt(d.betaT * 100, 2), '%') + row('β_N', fmt(d.betaN, 2)) + row('β_p', fmt(d.betaP, 2)) + row('q95', fmt(d.q95, 2)) +
      row('Greenwald fraction', fmt(d.fG, 2)) + row('Bootstrap current', fmt(d.Ibs, 2) + ' MA (' + fmt(d.fbs * 100, 0) + ' %)') + row('Current drive (NBI+EC)', fmt(d.Icd, 2), 'MA') +
      row('Loop voltage', fmt(d.Vloop * 1000, 1), 'mV') + row('Vertical position', fmt(pl.z * 100, 1), 'cm') +
      secRow('COMPOSITION') + row('n̄e', fmt(d.ne / 1e20, 3), '×10²⁰ m⁻³') + row('⟨T⟩ / T₀', fmt(d.T, 2) + ' / ' + fmt(d.T0, 1), 'keV') + row('Z_eff', fmt(d.Zeff, 2)) +
      row('Tritium fraction of fuel', fmt(d.dtRatio * 100, 1), '%') + row('Helium ash', fmt(d.heFrac * 100, 2), '%') + row('Tungsten concentration', (pl.cW).toExponential(1)) +
      row('Neutron rate', d.neutronRate.toExponential(2), 'n/s') + row('Neutron wall load', fmt(d.nwl, 2), 'MW/m²') + '</table>';
  }
  function renderProt() {
    const rows = E.tripMatrix(s);
    const malf = Object.keys(s.malf).filter(k => s.malf[k]);
    return '<table class="kv"><tr><th>ID</th><th>Parameter</th><th>Value</th><th>Setpoint</th><th>Action</th><th>State</th></tr>' +
      rows.map(r => '<tr><td class="l">' + r.id + '</td><td class="l">' + r.name + '</td><td>' + r.value + ' ' + r.unit + '</td><td>' + r.dir + ' ' + r.setpoint + '</td><td class="l">' + r.action + '</td><td><span class="st ' + r.state.replace('-', '_') + '">' + r.state + '</span></td></tr>').join('') +
      '</table><p class="proc" style="margin-top:8px">DMS: ' + (s.safety.dmsArmed ? 'ARMED' : 'SAFE (disarmed)') + ' · Active malfunctions: ' + (malf.length ? malf.join(', ') : 'none') + '</p>';
  }
  function renderFuel() {
    const tr = s.tri, d = s.d;
    const net = ((tr.breedRate || 0) - (tr.burnRate || 0)) * 3600;
    const cell = (k, v) => '<div class="cell"><b>' + k + '</b><span>' + v + '</span></div>';
    return '<div class="fuelgrid">' +
      cell('TRITIUM STORE', fmt(tr.store, 1) + ' g') + cell('INJECTED', fmt((tr.injectRate || 0) * 3600, 0) + ' g/h') +
      cell('BURNED', fmt((tr.burnRate || 0) * 86400, 0) + ' g/day') + cell('BRED IN BLANKET', fmt((tr.breedRate || 0) * 86400, 0) + ' g/day') +
      cell('BREEDING RATIO (TBR)', fmt(tr.tbr || 0, 3)) + cell('NET BALANCE', (net >= 0 ? '+' : '') + fmt(net, 2) + ' g/h') +
      cell('EXHAUST HOLD-UP', fmt(tr.exhaust, 1) + ' g') + cell('BLANKET INVENTORY', fmt(tr.blanket, 2) + ' g') +
      cell('D : T IN PLASMA', s.pl.on ? fmt((1 - d.dtRatio) * 100, 0) + ' : ' + fmt(d.dtRatio * 100, 0) : '—') +
      cell('PELLET RATE', fmt(s.fuel.pelletHz, 1) + ' Hz') + cell('BURNED THIS SESSION', fmt(tr.burned, 2) + ' g') + cell('STACK MONITOR', (tr.stack || 0).toExponential(1) + ' Bq/s') +
      '</div><p class="proc" style="margin-top:8px">Each D-T fusion consumes one tritium atom and releases one 14.1 MeV neutron. In the lithium blanket that neutron breeds a new tritium atom (⁶Li + n → T + ⁴He). A TBR above 1.0 keeps the plant self-sufficient.</p>';
  }
  function renderEvents() {
    const ev = s.events.slice(-150).reverse();
    return ev.map(e => '<li class="' + e.level + '"><time>' + e.clock + '</time><span>' + escapeHtml(e.text) + '</span></li>').join('');
  }
  function escapeHtml(t) { return t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function selectTab(t) {
    ui.tab = t;
    document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + t));
    store('helios.tab', t);
    updateScada(true);
  }
  function updateScada() {
    const t = ui.tab;
    if (t === 'proc') $('#pane-proc').innerHTML = renderProc();
    else if (t === 'plasma') $('#pane-plasma').innerHTML = renderPlasma();
    else if (t === 'prot') $('#pane-prot').innerHTML = renderProt();
    else if (t === 'fuel') $('#pane-fuel').innerHTML = renderFuel();
    else if (t === 'events') $('#soe').innerHTML = renderEvents();
  }

  // ============================================================ SUN PANEL
  const sci = (x, d) => {
    if (!isFinite(x) || x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x))), m = x / Math.pow(10, e);
    if (e >= -2 && e <= 4) return x.toLocaleString('en-GB', { maximumFractionDigits: d == null ? 1 : d });
    const sup = String(e).replace(/[-0-9]/g, c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
    return m.toFixed(1) + '×10' + sup;
  };
  function updateSun() {
    const S = E.SUN, d = s.d, pl = s.pl, M = E.MACHINE;
    const rows = [];
    const on = pl.on;
    const T0K = on ? d.T0 * 1.1604518e7 : 0;
    const amu = 1.66053907e-27;
    const rho = on ? (d.nD * 2.014 + d.nT * 3.016 + d.nH * 1.008 + d.nHe * 4.003) * amu : 0;
    const pdens = on ? d.Pfus / M.V : 0;
    const massRate = on ? d.Pfus / (2.99792458e8 ** 2) : 0;
    const add = (q, sun, ours, ratio) => rows.push('<tr><td>' + q + '</td><td>' + sun + '</td><td>' + ours + '</td><td>' + ratio + '</td></tr>');
    add('Core temperature', '15.7 million K', on ? sci(T0K / 1e6, 0) + ' million K' : '—', on ? '×' + (T0K / S.coreT_K).toFixed(1) + ' hotter' : '—');
    add('Density', '150,000 kg/m³', on ? sci(rho) + ' kg/m³' : '—', on ? '1 : ' + sci(S.coreDensity / rho) : '—');
    add('Pressure', '2.6×10¹¹ atm', on ? sci(d.pressure / 101325) + ' atm' : '—', on ? '1 : ' + sci(S.corePressure / d.pressure) : '—');
    add('Fusion power density', '276 W/m³', on ? sci(pdens) + ' W/m³' : '—', on ? '×' + sci(pdens / S.corePowerDensity) : '—');
    add('Fuel', 'Protons (p-p chain)', on ? ({ DT: 'Deuterium + tritium', DD: 'Deuterium', HH: 'Protons, like the Sun' }[s.fuel.blend]) : '—', '');
    add('What holds it', 'Gravity (2×10³⁰ kg)', 'Magnetic field ' + s.mag.BT.toFixed(1) + ' T', s.mag.BT > 0 ? '×' + sci(s.mag.BT / S.surfaceField) + ' Sun\'s surface field' : '');
    add('Energy confinement time', '~170,000 years', on ? fmt(d.tauE, 2) + ' s' : '—', '');
    add('Mass turned into energy', '4.3 million t/s', on ? sci(massRate * 1e9) + ' µg/s' : '—', '');
    add('Total fusion output', '3.8×10²⁶ W', on ? sci(d.Pfus) + ' W' : '—', on && d.Pfus > 1 ? '1 : ' + sci(S.luminosity / d.Pfus) : '—');
    $('#solRows').innerHTML = rows.join('');
    if (on && d.T > 0.3) {
      const hotter = (T0K / S.coreT_K).toFixed(0);
      $('#solHead').textContent = 'The core of this plasma is ' + hotter + '× hotter than the centre of the Sun, yet ' + sci(S.coreDensity / rho) + ' times thinner.';
      const ne = d.ne, svpp = E.sigmavPP(d.T);
      const Ppp = 0.5 * ne * ne * svpp * M.profileFactor * 1.177 * 1.602176634e-13 * M.V;
      const ratio = E.sigmavDT(d.T) / Math.max(svpp, 1e-99);
      $('#solNote').textContent = 'The Sun squeezes hydrogen with gravity and waits: an average proton in its core fuses once in about ten billion years. HELIOS-1 has no gravity and only seconds of confinement, so it burns deuterium and tritium, which at ' +
        fmt(d.T, 1) + ' keV react ' + sci(ratio) + ' times more readily than the Sun\'s protons. Filled with the Sun\'s own fuel at these conditions, this vessel would make about ' + sci(Ppp) + ' W of fusion power.';
    } else {
      $('#solHead').textContent = 'No plasma. The real Sun has been burning for 4.6 billion years without a pulse limit.';
      $('#solNote').textContent = 'Start a pulse to compare the plasma with the Sun\'s core. Select the H-H SUN fuel blend to try running on the Sun\'s own fuel.';
    }
  }

  // ============================================================ GRID PANEL
  function buildGridStats() {
    const box = $('#gridstats'); box.innerHTML = '';
    const defs = [
      ['FREQUENCY', st => [fmt(st.grid.f, 3), 'Hz', Math.abs(st.grid.f - 50) > 0.2 ? 'alarm' : 'good'], 'freqbig'],
      ['SOLHAVN DEMAND', st => [fmt(st.grid.D, 0), 'MW']],
      ['HELIOS-1 NET', st => [fmt(st.d.Pnet, 0), 'MW', st.d.Pnet < 0 ? 'alarm' : '']],
      ['HVDC LINK', st => [(st.grid.imp >= 0 ? 'IMP ' : 'EXP ') + fmt(Math.abs(st.grid.imp), 0), 'MW']],
      ['DISTRICTS LIT', st => [(E.MACHINE.districts - st.grid.shedBlocks) + ' / ' + E.MACHINE.districts, '', st.grid.shedBlocks ? 'alarm' : 'good']],
      ['HOMES IN THE DARK', st => [st.d.homesDark.toLocaleString('en-GB'), '', st.d.homesDark ? 'alarm' : '']],
      ['EXPORTED', st => [fmt(st.grid.plantMWh, 1), 'MWh']],
      ['UNSERVED', st => [fmt(st.grid.unservedMWh, 1), 'MWh', st.grid.unservedMWh > 0 ? 'alarm' : '']]
    ];
    ui.gstats = defs.map(([k, fn, extra]) => { const n = el('div', 'lcd' + (extra ? ' ' + extra : ''), '<span class="k">' + k + '</span><span class="v"></span>'); box.appendChild(n); return { n, fn, v: n.querySelector('.v'), extra }; });
  }
  function updateGridStats() {
    for (const g of ui.gstats) { const [v, u, c] = g.fn(s); g.v.innerHTML = v + (u ? '<small>' + u + '</small>' : ''); g.n.className = 'lcd' + (g.extra ? ' ' + g.extra : '') + (c ? ' ' + c : ''); }
    const m = s.grid.msg;
    txt('dispMsg', m ? 'TSO: ' + m : 'No dispatch instructions');
  }

  // ============================================================ INSTRUCTOR
  function loadIC(ic) {
    s = E.createState(ic);
    hist = []; lastSample = -1;
    if (ic === 3) {
      // pre-roll five minutes so the trends open with history
      for (let i = 0; i < 6000; i++) { E.step(s, DT); sample(); }
    }
    ui.lastEventCount = s.events.length;
    updateTiles(true);
    document.querySelectorAll('.ibtn[data-ic]').forEach(b => b.classList.toggle('on', +b.dataset.ic === ic));
    if (ic === 1) selectTab('proc');
    info('INSTRUCTOR', { 1: 'IC-1 loaded. Plant shut down, magnets warm, Solhavn partly dark. Follow OP-101 on the PROCEDURE page.', 2: 'IC-2 loaded. Magnets at field and CS charged: prefill, ECRH and INITIATE to make plasma.', 3: 'IC-3 loaded. Full power D-T burn feeding Solhavn. Try a malfunction from the instructor station.' }[ic]);
  }
  function sample() {
    if (s.t - lastSample < 1) return;
    lastSample = s.t;
    hist.push({ t: s.t, clock: E.fmtClock(s.clock), Ip: s.pl.Ip, T: s.d.T, Pfus: s.d.Pfus / 1e6, Pnet: s.d.Pnet, D: s.grid.D, f: s.grid.f });
    if (hist.length > 7200) hist.splice(0, hist.length - 7200);
  }
  function setSpeed(v) {
    speed = v;
    document.querySelectorAll('.spd').forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
  }
  function bindInstructor() {
    document.querySelectorAll('.ibtn[data-ic]').forEach(b => b.addEventListener('click', () => { snd.init(); loadIC(+b.dataset.ic); }));
    document.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
    $('#freeze').addEventListener('click', () => { frozen = !frozen; $('#freeze').classList.toggle('on', frozen); $('#freeze').textContent = frozen ? 'RUN' : 'FREEZE'; });
    $('#malfIns').addEventListener('click', () => {
      const v = $('#malf').value; if (!v) return;
      s.malf[v] = true;
      const label = $('#malf').selectedOptions[0].textContent;
      s.events.push({ t: s.t, clock: E.fmtClock(s.clock), text: 'INSTRUCTOR: malfunction inserted: ' + label, level: 'warn' });
      info('MALFUNCTION INSERTED', label + '. Diagnose it from the annunciators and mimic.', true);
    });
    $('#malfClr').addEventListener('click', () => { s.malf = {}; info('INSTRUCTOR', 'All malfunctions cleared.'); });
    $('#explain').addEventListener('click', () => {
      explain = !explain;
      $('#explain').setAttribute('aria-pressed', String(explain));
      document.body.classList.toggle('explain', explain);
      info('OPERATOR AID', explain ? 'Explain mode ON: tap any switch, knob, button, meter or alarm window to learn what it does. Controls will not operate until you turn it off.' : 'Explain mode OFF: controls operate normally.');
    });
    $('#sound').addEventListener('click', () => {
      snd.init(); snd.on = !snd.on;
      if (snd.ctx && snd.ctx.state === 'suspended') snd.ctx.resume();
      $('#sound').setAttribute('aria-pressed', String(snd.on));
      $('#sound').textContent = snd.on ? 'SOUND ON' : 'SOUND OFF';
      store('helios.sound', snd.on ? '1' : '0');
      if (snd.on) snd.chime();
    });
    document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));
    document.querySelectorAll('.trendbar button').forEach(b => b.addEventListener('click', () => {
      ui.trends.win = +b.dataset.win;
      document.querySelectorAll('.trendbar button').forEach(x => x.classList.toggle('on', x === b));
    }));
    $('#infoX').addEventListener('click', () => { $('#infobar').hidden = true; });
    const cf = $('#camField');
    cf.addEventListener('click', () => { ui.cam.fieldLines = !ui.cam.fieldLines; cf.setAttribute('aria-pressed', String(ui.cam.fieldLines)); });
  }

  // ================================================================ EVENTS
  function watchEvents() {
    if (s.events.length === ui.lastEventCount) return;
    const fresh = s.events.slice(ui.lastEventCount);
    ui.lastEventCount = s.events.length;
    const trip = fresh.filter(e => e.level === 'trip');
    if (fresh.some(e => /DISRUPTION|FPSS|QUENCH/.test(e.text))) snd.thump();
    const show = trip[trip.length - 1] || fresh[fresh.length - 1];
    if (show && performance.now() > ui.infoUntil - 6000) info(show.level === 'trip' ? 'TRIP' : 'EVENT · ' + show.clock, show.text, show.level === 'trip');
  }

  // ================================================================ LOOP
  let last = performance.now(), acc = 0, tUi = 0, tSlow = 0, tEq = 0;
  function frame(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!frozen) {
      acc += dtReal * speed;
      let n = 0;
      while (acc >= DT && n < 1500) { E.step(s, DT); sample(); acc -= DT; n++; }
      if (n >= 1500) acc = 0;
    }
    ui.cam.draw(s, now, frozen ? 0 : dtReal);
    animateFlows(frozen ? 0 : dtReal);
    snd.setHorn(ui.anyAlert && !ui.silenced, now);
    if (now - tUi > 120) {
      tUi = now;
      for (const c of ui.controls) c.update && c.update();
      updateTiles(); updateMeters(); updateKeys(); updateMimic(); watchEvents();
      txt('clock', E.fmtClock(s.clock));
      txt('simstate', (frozen ? 'FROZEN' : 'RUN ×' + speed) + ' · IC-' + s.ic);
      if (now > ui.infoUntil && !explain) { $('#infobar').classList.remove('warn'); }
    }
    if (now - tEq > 80) { tEq = now; ui.eq.draw(s); }
    if (now - tSlow > 400) {
      tSlow = now;
      updateScada(); updateSun(); updateGridStats();
      if (ui.tab === 'trend') ui.trends.draw(hist, s.t);
      ui.sky.draw(s, now);
      const eqv = $('#eqvals'), d = s.d, M = E.MACHINE;
      eqv.innerHTML = [['R₀', M.R0.toFixed(1) + ' m'], ['a', M.a.toFixed(1) + ' m'], ['A', (M.R0 / M.a).toFixed(2)], ['κ', M.kappa.toFixed(1)], ['δ', M.delta.toFixed(2)], ['V', M.V.toFixed(0) + ' m³'],
        ['q95', s.pl.on ? fmt(d.q95, 2) : '—'], ['βp', s.pl.on ? fmt(d.betaP, 2) : '—'], ['Z', s.pl.on ? fmt(s.pl.z * 100, 1) + ' cm' : '—']]
        .map(([k, v]) => '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('');
    }
    requestAnimationFrame(frame);
  }

  // ================================================================ BOOT
  function boot(data) {
    buildTiles(); annunButtons(); buildMeters(); buildKeys(); buildMimic(); buildBench(); buildGridStats();
    ui.cam = new R.Camera($('#camera'));
    ui.eq = new R.Equilibrium($('#equil'));
    ui.trends = new R.Trends($('#trends'), $('#trendTip'));
    ui.sky = new R.Skyline($('#skyline'));
    document.querySelector('.trendbar button[data-win="900"]').classList.add('on');
    bindInstructor();
    setSpeed(1);
    if (data && data.state) {
      s = data.state; hist = data.hist || []; lastSample = hist.length ? hist[hist.length - 1].t : -1;
      E.derive(s); ui.lastEventCount = s.events.length; updateTiles(true);
      speed = data.speed || 1; setSpeed(speed);
    } else loadIC(3);
    const savedTab = store('helios.tab');
    selectTab(data && data.tab ? data.tab : (savedTab && document.getElementById('pane-' + savedTab) ? savedTab : 'trend'));
    if (store('helios.sound') === '1') { $('#sound').textContent = 'SOUND: TAP TO ENABLE'; }
    const hot = window.claude && window.claude.hot;
    if (hot && hot.snapshot) hot.snapshot(() => ({ state: s, hist: hist.slice(-900), speed, tab: ui.tab }));
    requestAnimationFrame(frame);
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(boot);
  else boot(hot && hot.data ? hot.data : {});
})();
