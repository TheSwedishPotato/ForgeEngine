/*
 * HELIOS-1 Spherical Tokamak Power Plant — physics & plant engine.
 *
 * A 0-D (volume-averaged) burning-plasma model coupled to a balance-of-plant model:
 *   plasma  : Bosch–Hale D-T / D-D reactivities, solar p-p reactivity, bremsstrahlung and
 *             impurity line radiation, IPB98(y,2) confinement, Martin-2008 L-H threshold,
 *             Greenwald / Troyon / kink / vertical-stability limits, ELMs, NTMs, disruptions.
 *   current : Spitzer-neoclassical resistivity, bootstrap and NBI/EC current drive, central
 *             solenoid flux budget.
 *   plant   : HTS magnets + cryoplant, vacuum, fuelling and tritium cycle, pressurised-water
 *             primary loop, steam generator, turbine-generator, 400 kV grid with UFLS.
 *
 * Units: SI unless the name says otherwise. Temperatures in keV (plasma) or °C (plant),
 * plasma current in MA, powers in W inside the plasma model and MW in the plant model.
 * Works in the browser (window.HeliosEngine) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- constants
  const KEV = 1.602176634e-16;         // J per keV
  const MEV = 1.602176634e-13;         // J per MeV
  const MU0 = 4e-7 * Math.PI;
  const C_LIGHT = 2.99792458e8;
  const ATOMS_PER_PAM3 = 5.3e20;       // atoms in 1 Pa·m³ of D2/T2/H2 at 273 K
  const G_PER_T_ATOM = 3.01605 * 1.66053907e-24;
  const MK_PER_KEV = 11.604518;        // 1 keV = 11.6 million kelvin

  const E_DT = 17.589 * MEV, E_DT_ALPHA = 3.518 * MEV;
  const E_DDN = 3.269 * MEV, E_DDN_CHARGED = 0.817 * MEV;
  const E_DDP = 4.033 * MEV;
  const E_PP = 1.177 * MEV;            // p + p -> d + e+ + nu, neutrino energy removed

  // The real Sun (for the SOL REFERENCE panel)
  const SUN = {
    coreT_K: 1.57e7,
    coreT_keV: 1.57e7 / 1.1604518e7,
    coreDensity: 1.5e5,                // kg/m³
    corePressure: 2.65e16,             // Pa
    corePowerDensity: 276.5,           // W/m³ at the centre
    luminosity: 3.828e26,              // W
    massToEnergy: 3.828e26 / (C_LIGHT * C_LIGHT), // kg/s
    surfaceField: 1e-4,                // T (≈1 gauss mean)
    photonEscapeYears: 1.7e5,
    coreIons: 4.5e31,                  // m^-3 (H + He)
    confinement: 'Gravity'
  };

  // ------------------------------------------------------------------ machine
  const MACHINE = (function () {
    const R0 = 4.0, a = 2.2, kappa = 2.8, delta = 0.5;
    const eps = a / R0;
    const shape = Math.sqrt((1 + kappa * kappa) / 2);
    const li = 0.8;
    return {
      name: 'HELIOS-1',
      R0, a, kappa, delta, eps, li,
      V: 2 * Math.PI * R0 * Math.PI * a * a * kappa,       // plasma volume, m³
      S: 4 * Math.PI * Math.PI * R0 * a * shape,           // plasma surface, m²
      Lpol: 2 * Math.PI * a * shape,                        // poloidal circumference, m
      Lp: MU0 * R0 * (Math.log(8 * R0 / a) + li / 2 - 2),  // self inductance, H
      areaPol: Math.PI * a * a * kappa,
      BTnom: 3.6, IpMax: 24, fluxMax: 220, vLoopMax: 25,
      nbiMax: 50, ecMax: 40, icMax: 30,
      divertorWetArea: 30,              // m²
      vesselGasVolume: 1500,            // m³
      pumpSpeed: 250,                   // m³/s torus cryopumps
      profileFactor: 1.25,              // <n² σv> peaking over n̄² σv(T̄)
      tempPeaking: 2.0,                 // T(0) / <T>
      densityPeaking: 1.3,              // n(0) / <n>
      phtsFlowPerPump: 5500,            // kg/s
      cpWater: 5400,                    // J/kg/K at 15.5 MPa, 300 °C
      Cfw: 6e8, Cpc: 2e9,               // J/K: blanket+first wall, primary coolant
      hFw: 3.8e7,                       // W/K first wall→coolant at full flow
      UAsg: 1.18e8,                     // W/K steam generator
      hEvap: 1.8e6,                     // J/kg feedwater→dry steam
      turbineK: 188,                    // kg/s per MPa at full valve
      dhTurbine: 0.62e6,                // J/kg useful enthalpy drop
      genRating: 1000,                  // MW
      blanketMult: 1.18,                // neutron energy multiplication in Li blanket
      sgLevelMass: 1000,                // kg per % SG level
      steamCap: 2500,                   // kg per MPa steam volume
      importCap: 450,                   // MW HVDC interconnector
      districts: 12
    };
  })();

  // --------------------------------------------------------------- reactivity
  // Bosch & Hale, Nucl. Fusion 32 (1992) 611. Returns <σv> in m³/s, T in keV (0.2–100).
  const BH = {
    DT: { BG: 34.3827, mrc2: 1124656, C: [1.17302e-9, 1.51361e-2, 7.51886e-2, 4.60643e-3, 1.35000e-2, -1.06750e-4, 1.36600e-5] },
    DDn: { BG: 31.3970, mrc2: 937814, C: [5.43360e-12, 5.85778e-3, 7.68222e-3, 0, -2.964e-6, 0, 0] },
    DDp: { BG: 31.3970, mrc2: 937814, C: [5.65718e-12, 3.41267e-3, 1.99167e-3, 0, 1.05060e-5, 0, 0] }
  };
  function boschHale(T, p) {
    if (!(T > 0.2)) return 0;
    T = Math.min(T, 100);
    const c = p.C;
    const theta = T / (1 - (T * (c[1] + T * (c[3] + T * c[5]))) / (1 + T * (c[2] + T * (c[4] + T * c[6]))));
    const xi = Math.cbrt(p.BG * p.BG / (4 * theta));
    return c[0] * theta * Math.sqrt(xi / (p.mrc2 * T * T * T)) * Math.exp(-3 * xi) * 1e-6;
  }
  const sigmavDT = T => boschHale(T, BH.DT);
  const sigmavDDn = T => boschHale(T, BH.DDn);
  const sigmavDDp = T => boschHale(T, BH.DDp);

  // Solar p-p reaction (non-resonant Gamow form), calibrated to the Sun's core:
  // 276.5 W/m³ at 15.7 MK with n_p = 3.05e31 m^-3 gives <σv> ≈ 2.8e-49 m³/s.
  const PP_EG = 493;      // Gamow energy, keV
  const ppTau = T => 3 * Math.cbrt(PP_EG / (4 * T));
  const PP_K = 2.8e-49 / (ppTau(SUN.coreT_keV) ** 2 * Math.exp(-ppTau(SUN.coreT_keV)));
  function sigmavPP(T) {
    if (!(T > 0.05)) return 0;
    const tau = ppTau(T);
    return PP_K * tau * tau * Math.exp(-tau);
  }

  // Impurity cooling rates, W·m³ (coronal-equilibrium fits)
  const coolW = T => 1.3e-31 * Math.min(1, Math.pow(Math.max(T, 0.01) / 1.5, -0.6));
  const coolAr = T => 2e-33 + 2.5e-31 * Math.exp(-Math.max(T, 0) / 0.6);   // line part; brems is in Zeff
  const zW = T => Math.min(46, 20 + 2.2 * T);

  // Water saturation temperature, °C, from pressure in MPa (fit good to ±3 °C, 0.1–16 MPa)
  const tSat = P => 100 * Math.pow(Math.max(P, 0.005) / 0.101325, 0.25);

  // ----------------------------------------------------------------- helpers
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const approach = (x, target, rate, dt) => {
    const d = target - x, m = rate * dt;
    return Math.abs(d) <= m ? target : x + Math.sign(d) * m;
  };
  const relax = (x, target, tau, dt) => x + (target - x) * (1 - Math.exp(-dt / tau));

  function rand(s) {
    let t = (s.seed = (s.seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const hazard = (s, rate, dt) => rate > 0 && rand(s) < 1 - Math.exp(-rate * dt);

  function fmtClock(sec) {
    sec = ((sec % 86400) + 86400) % 86400;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = Math.floor(sec % 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
  }

  function log(s, text, level) {
    s.events.push({ t: s.t, clock: fmtClock(s.clock), text, level: level || 'info' });
    if (s.events.length > 400) s.events.splice(0, s.events.length - 400);
  }

  // ------------------------------------------------------------ grid demand
  // Solhavn regional load for the plant's supply area, MW, by hour of day.
  const LOAD_CURVE = [
    [0, 390], [3, 350], [5, 360], [6.5, 410], [8, 495], [10, 510], [12, 480], [14, 460],
    [16, 490], [18, 555], [19.5, 585], [21, 525], [23, 430], [24, 390]
  ];
  function demandAt(clockSec) {
    const h = (((clockSec / 3600) % 24) + 24) % 24;
    for (let i = 1; i < LOAD_CURVE.length; i++) {
      const [h1, p1] = LOAD_CURVE[i];
      const [h0, p0] = LOAD_CURVE[i - 1];
      if (h <= h1) {
        const f = (h - h0) / (h1 - h0);
        return p0 + (p1 - p0) * (0.5 - 0.5 * Math.cos(Math.PI * f));
      }
    }
    return LOAD_CURVE[0][1];
  }

  const DISPATCH_EVENTS = [
    { text: 'Nordvik wind farm output falling: +45 MW for 20 min', mw: 45, dur: 1200 },
    { text: 'Solhavn steelworks arc furnace on line: +60 MW for 15 min', mw: 60, dur: 900 },
    { text: 'Hydro unit Fjellstad synchronised: -40 MW for 25 min', mw: -40, dur: 1500 },
    { text: 'Cold snap forecast: district heating pumps +35 MW for 30 min', mw: 35, dur: 1800 },
    { text: 'Interconnector price spike, maximise output: +50 MW for 10 min', mw: 50, dur: 600 },
    { text: 'Rooftop solar surge: -55 MW for 20 min', mw: -55, dur: 1200 }
  ];

  // ------------------------------------------------------------ state setup
  function baseState() {
    return {
      seed: 20260926, t: 0, clock: 5 * 3600, frozen: false, ic: 1,
      events: [],
      mag: {
        cryoCmd: false, cryoOn: false, coilT: 62, tfCmd: false, tfOn: false, BT: 0, BTset: 3.6,
        vsCmd: false, flux: 0, premag: false, quench: false, fastDump: false, dBdt: 0
      },
      vac: { pumpCmd: false, P: 2e-3, prefillCmd: false },
      fuel: {
        auto: false, blend: 'DT', nG: 0.5, tFrac: 0.5, manFlow: 0, flow: 0, integ: 0,
        pelletCmd: false, pumpSpeed: 60, seed: 0, liEnrich: 60,
        valveD: 0, valveT: 0, valveH: 0, pelletHz: 0
      },
      pl: {
        on: false, tStart: 0, Ip: 0, IpSet: 23, ramp: 0.25, ND: 0, NT: 0, NH: 0, NHe: 0,
        cAr: 0, cW: 0, W: 0, hmode: false, z: 0, elmAcc: 0, elmCount: 0, elmType: 'NONE',
        ntm: false, ntmTime: 0, ecOnNtm: 0, rampDown: false, burnAuto: false, PfusSet: 1900,
        flash: 0, elmFlash: 0, dCount: 0, lastDisruption: null, lhCount: 0, pulse: 0,
        fluxExhausted: false
      },
      heat: {
        nbiCmd: false, nbiSet: 30, nbiP: 0, ecCmd: false, ecSet: 20, ecP: 0,
        icCmd: false, icSet: 10, icP: 0, rmpCmd: false
      },
      htx: {
        pumpACmd: false, pumpBCmd: false, fA: 0, fB: 0, speed: 100,
        Tfw: 288, Tavg: 286, prz: 15.5, DH: 0,
        sgP: 6.9, sgL: 50, fwACmd: false, fwBCmd: false, fwAuto: true, fwPos: 0, fwFlow: 0,
        msivCmd: false, msiv: 0, dumpAuto: true, dumpPos: 0, dumpMan: 0, cwCmd: false, Pc: 101,
        relief: 0, steamGen: 0, steamTurb: 0, steamDump: 0, porv: false
      },
      tg: {
        tripped: true, valve: 0, integ: 0, rpm: 0, speedSet: 0, speedRef: 0, loadRef: 0,
        loadSet: 0, unitAuto: false, excCmd: false, breaker: false, phase: 0, autoSync: false,
        vib: 1.2, bandTime: 0, rpTime: 0, Pgen: 0, Pmech: 0
      },
      grid: {
        f: 50, D: demandAt(5 * 3600), extra: 0, extraUntil: 0, msg: '', nextEvent: 1800,
        imp: 0, shedBlocks: 0, restoreTimer: 0, shedTimer: 0, servedMWh: 0, unservedMWh: 0,
        plantMWh: 0, noise: 0, devTime: 0
      },
      tri: { store: 1200, exhaust: 0, blanket: 0, ispCmd: false, bred: 0, burned: 0 },
      safety: { dmsArmed: false, fpssCount: 0 },
      dmg: { fw: 0, div: 0, mag: 0, gen: 0 },
      malf: {},
      d: {},
      hist: []
    };
  }

  function fillPlasma(s, ne, T, tFrac, heFrac) {
    const V = MACHINE.V, pl = s.pl;
    const nFuel = ne * (1 - 2 * heFrac - 18 * pl.cAr - zW(T) * pl.cW);
    pl.ND = nFuel * (1 - tFrac) * V;
    pl.NT = nFuel * tFrac * V;
    pl.NH = 0;
    pl.NHe = ne * heFrac * V;
    const ni = nFuel + ne * heFrac + ne * (pl.cAr + pl.cW);
    pl.W = 1.5 * (ne + ni) * T * KEV * V;
  }

  function createState(ic, opts) {
    opts = opts || {};
    const s = baseState();
    s.ic = ic || 1;
    if (s.ic === 1) {
      log(s, 'IC-1 loaded: plant shut down, magnets warm (62 K), Solhavn grid on emergency imports', 'op');
    }
    if (s.ic >= 2) {
      Object.assign(s.mag, { cryoCmd: true, cryoOn: true, coilT: 20.2, tfCmd: true, tfOn: true, BT: 3.6, vsCmd: true, flux: MACHINE.fluxMax, premag: true });
      Object.assign(s.vac, { pumpCmd: true, P: 4e-6 });
      Object.assign(s.htx, { pumpACmd: true, pumpBCmd: true, fA: 1, fB: 1, cwCmd: true, Pc: 5.2, fwACmd: true, fwBCmd: true, msivCmd: true, msiv: 1, Tavg: 288, Tfw: 289 });
      Object.assign(s.tri, { ispCmd: true, store: 1350 });
      s.safety.dmsArmed = true;
      s.tg.tripped = false; s.tg.rpm = 0;
      s.clock = 5.5 * 3600;
    }
    if (s.ic === 2) {
      log(s, 'IC-2 loaded: magnets at 3.6 T, CS pre-magnetised, vessel at base vacuum. Ready for breakdown', 'op');
    }
    if (s.ic === 3) {
      s.clock = 7 * 3600 + 40 * 60;
      Object.assign(s.fuel, { auto: true, blend: 'DT', nG: 0.8, tFrac: 0.5, pelletCmd: true, pumpSpeed: 80, seed: 50, liEnrich: 60 });
      Object.assign(s.heat, { nbiCmd: true, nbiSet: 25, nbiP: 25, ecCmd: true, ecSet: 15, ecP: 15, icCmd: false, rmpCmd: true });
      const pl = s.pl;
      Object.assign(pl, { on: true, Ip: 23, IpSet: 23, hmode: true, burnAuto: true, PfusSet: 1750, cAr: 0.0005, cW: 4e-6, pulse: 1, tStart: -600 });
      s.fuel.integ = 40;
      s.mag.flux = 150; s.mag.premag = false;
      fillPlasma(s, 1.2e20, 11.5, 0.5, 0.04);
      Object.assign(s.htx, { Tavg: 306, Tfw: 368, dumpAuto: true, DH: 20 });
      Object.assign(s.tg, { tripped: false, rpm: 3000, speedSet: 3000, speedRef: 3000, excCmd: true, breaker: true, loadRef: 780, loadSet: 780, unitAuto: true, valve: 0.97, integ: 0 });
      s.tri.store = 1400;
      s.grid.D = demandAt(s.clock);
      s.grid.nextEvent = s.t + 900;
      // settle the coupled plant onto its operating point
      if (opts.settle === false) { derive(s); return s; }
      for (let i = 0; i < 12000; i++) step(s, 0.05);
      s.t = 0; s.pl.tStart = -3600; s.grid.nextEvent = 900; s.grid.extraUntil = 0; s.grid.extra = 0;
      s.clock = 7 * 3600 + 40 * 60;
      s.grid.servedMWh = s.grid.unservedMWh = s.grid.plantMWh = 0;
      s.events.length = 0;
      s.dmg = { fw: 0, div: 0, mag: 0, gen: 0 };
      s.pl.elmCount = 0; s.pl.dCount = 0; s.tri.bred = 0; s.tri.burned = 0;
      log(s, 'IC-3 loaded: HELIOS-1 at full power, D-T burn, synchronised to Solhavn 400 kV grid', 'op');
    }
    if (s.ic !== 3) {
      // grid starts balanced: imports at the link limit, the rest shed
      const house = houseLoad(s);
      const need = s.grid.D + house;
      s.grid.imp = Math.min(MACHINE.importCap, need);
      const deficit = need - s.grid.imp;
      s.grid.shedBlocks = clamp(Math.ceil(deficit / (s.grid.D / MACHINE.districts)), 0, MACHINE.districts);
      s.grid.imp = Math.min(MACHINE.importCap, s.grid.D * (1 - s.grid.shedBlocks / MACHINE.districts) + house);
    }
    derive(s);
    return s;
  }

  // -------------------------------------------------------- derived quantities
  // Recomputes all plasma quantities from the state. Called inside step() and by the UI.
  function plasmaDerived(s) {
    const M = MACHINE, pl = s.pl, h = s.heat, d = s.d;
    const V = M.V;
    if (!pl.on) {
      Object.assign(d, {
        ne: 0, ni: 0, T: 0, T0: 0, Zeff: 1, Pfus: 0, Palpha: 0, Pn: 0, Pbrem: 0, Pline: 0, Prad: 0,
        Poh: 0, Paux: 0, Pheat: 0, tauE: 0, betaT: 0, betaN: 0, betaP: 0, q95: 0, fG: 0, nG: 0,
        Ibs: 0, Icd: 0, Iind: 0, Vloop: 0, Rp: 0, Psep: 0, PLH: 0, qdiv: 0, Q: 0, fbs: 0,
        Rdt: 0, neutronRate: 0, triple: 0, Hfac: 0, heFrac: 0, dtRatio: 0, Mavg: 2,
        nbiAbs: 0, ecAbs: 0, icAbs: 0, Wth: 0, fRad: 0, nD: 0, nT: 0, nH: 0, nHe: 0, Pfus_pp: 0,
        tBurnGday: 0, nwl: 0, pressure: 0
      });
      d.ecAbs = h.ecP * 1e6 * 0; d.nbiAbs = 0; d.icAbs = 0;
      return d;
    }
    const nD = pl.ND / V, nT = pl.NT / V, nH = pl.NH / V, nHe = pl.NHe / V;
    const Tprev = d.T > 0 ? d.T : 0.05;
    const zw = zW(Tprev);
    const denom = Math.max(0.3, 1 - 18 * pl.cAr - zw * pl.cW);
    const ne = Math.max(1e15, (nD + nT + nH + 2 * nHe) / denom);
    const nAr = pl.cAr * ne, nW = pl.cW * ne;
    const ni = nD + nT + nH + nHe + nAr + nW;
    const T = Math.max(0.003, pl.W / (1.5 * (ne + ni) * KEV * V));
    const Zeff = (nD + nT + nH + 4 * nHe + 324 * nAr + zw * zw * nW) / ne;
    const nFuel = nD + nT + nH;
    const Mavg = nFuel > 0 ? (2 * nD + 3 * nT + nH) / nFuel : 2;

    // fusion
    const F = M.profileFactor;
    const svDT = sigmavDT(T), svDDn = sigmavDDn(T), svDDp = sigmavDDp(T), svPP = sigmavPP(T);
    const Rdt = nD * nT * svDT * F;
    const Rddn = 0.5 * nD * nD * svDDn * F;
    const Rddp = 0.5 * nD * nD * svDDp * F;
    const Rpp = 0.5 * nH * nH * svPP * F;
    const Pfus = V * (Rdt * E_DT + Rddn * E_DDN + Rddp * E_DDP + Rpp * E_PP);
    const Palpha = V * (Rdt * E_DT_ALPHA + Rddn * E_DDN_CHARGED + Rddp * E_DDP + Rpp * E_PP);
    const Pn = Pfus - Palpha;

    // radiation
    const Pbrem = 5.35e-37 * Zeff * ne * ne * Math.sqrt(T) * V;
    const Pline = (ne * nW * coolW(T) + ne * nAr * coolAr(T)) * V;
    const Prad = Pbrem + Pline;

    // heating absorption
    const nbiAbs = h.nbiP * 1e6 * (1 - Math.exp(-ne / 3e19));
    const ecAbs = h.ecP * 1e6 * (s.mag.BT > 0.85 * M.BTnom ? 0.95 : 0.15);
    const icAbs = h.icP * 1e6 * (ne > 1e19 ? 0.9 : 0.3);
    const Paux = nbiAbs + ecAbs + icAbs;

    // current and MHD
    const Ip = Math.max(pl.Ip, 0.01);
    const BT = Math.max(s.mag.BT, 0.05);
    const p = (ne + ni) * T * KEV;
    const betaT = 2 * MU0 * p / (BT * BT);
    const betaN = betaT * 100 * M.a * BT / Ip;
    const Bp = MU0 * Ip * 1e6 / M.Lpol;
    const betaP = 2 * MU0 * p / (Bp * Bp);
    const n20 = ne / 1e20;
    const nG = Ip / (Math.PI * M.a * M.a);
    const fG = n20 / nG;
    const eps = M.eps, k = M.kappa, dl = M.delta;
    const q95 = (5 * M.a * M.a * BT * (1 + k * k * (1 + 2 * dl * dl - 1.2 * dl * dl * dl))) / (2 * M.R0 * Ip) *
      (1.17 - 0.65 * eps) / Math.pow(1 - eps * eps, 2);
    const eta = 2 * 1.65e-9 * Zeff * 17 / Math.pow(T, 1.5);
    const Rp = eta * 2 * Math.PI * M.R0 / M.areaPol;
    const fbs = Math.min(0.85, 0.7 * Math.sqrt(eps) * betaP) * (pl.hmode ? 1 : 0.5);
    const Ibs = fbs * pl.Ip;
    const gNB = Math.min(0.4, 0.028 * T), gEC = Math.min(0.3, 0.02 * T);
    const Icd = Math.min(1.3 * pl.Ip, (gNB * nbiAbs / 1e6 + gEC * ecAbs / 1e6) / (Math.max(n20, 0.05) * M.R0));
    const Iind = pl.Ip - Ibs - Icd;
    const Vloop = Rp * Iind * 1e6;                      // resistive loop voltage needed to hold Ip
    const Poh = Math.max(0, Math.min(Vloop, M.vLoopMax) * pl.Ip * 1e6);
    const Pheat = Palpha + Paux + Poh;

    // confinement: IPB98(y,2)
    let H = pl.hmode ? 1.2 : 0.55;                       // spherical-tokamak H-mode runs at H98 ≈ 1.2
    if (pl.hmode) {
      if (h.rmpCmd) H *= 0.97;
      else if (!s.fuel.pelletCmd) H *= 1.12;           // type-I: inter-ELM confinement, ELMs remove the rest
    }
    if (pl.ntm) H *= 0.8;
    if (fG > 0.9) H *= Math.max(0.5, 1 - 1.5 * (fG - 0.9));
    const Ploss = Math.max(1, (Pheat - Prad) / 1e6);
    const n19 = Math.max(n20 * 10, 0.1);
    const tauE = 0.0562 * H * Math.pow(Ip, 0.93) * Math.pow(BT, 0.15) * Math.pow(Ploss, -0.69) *
      Math.pow(n19, 0.41) * Math.pow(Mavg, 0.19) * Math.pow(M.R0, 1.97) * Math.pow(eps, 0.58) * Math.pow(k, 0.78);

    const Psep = Math.max(0, Pheat - Prad);
    const PLH = 0.0488 * Math.pow(Math.max(n20, 0.1), 0.717) * Math.pow(BT, 0.803) * Math.pow(M.S, 0.941) * (2 / Mavg) * 1e6;
    const fDiv = 0.85 * (1 - Math.exp(-s.fuel.seed / 35));
    const qdiv = Psep * (1 - fDiv) / M.divertorWetArea / 1e6;

    const T0 = T * M.tempPeaking;
    Object.assign(d, {
      ne, ni, T, T0, Zeff, Pfus, Palpha, Pn, Pbrem, Pline, Prad, Poh, Paux, Pheat, tauE, betaT, betaN, betaP,
      q95, fG, nG, Ibs, Icd, Iind, Vloop, Rp, Psep, PLH, qdiv, fbs, Rdt: Rdt * V, Rddn: Rddn * V, Rddp: Rddp * V,
      Rpp: Rpp * V, Pfus_pp: Rpp * V * E_PP,
      neutronRate: (Rdt + Rddn) * V, Hfac: H, heFrac: nHe / ne, Mavg, nbiAbs, ecAbs, icAbs, Wth: pl.W,
      Q: Paux > 1e5 ? Pfus / Paux : (Pfus > 1e6 ? Infinity : 0),
      triple: ne * M.densityPeaking * T0 * tauE,
      fRad: Pheat > 0 ? Prad / Pheat : 0,
      dtRatio: nD + nT > 0 ? nT / (nD + nT) : 0,
      nD, nT, nH, nHe, pressure: p,
      tBurnGday: Rdt * V * G_PER_T_ATOM * 86400,
      nwl: Pn / M.S / 1e6
    });
    return d;
  }

  function houseLoad(s) {
    const h = s.htx, m = s.mag, pl = s.pl, ht = s.heat, d = s.d;
    let P = 18;                                            // I&C, HVAC, lighting, water treatment
    if (m.cryoOn) P += 28 + 0.004 * ((d.Pn || 0) / 1e6);
    if (m.tfOn) P += 1.5 + Math.abs(m.dBdt) * 25;
    if (m.premag && m.flux < MACHINE.fluxMax - 0.5 && !pl.on) P += 8;
    if (pl.on) P += 4 + clamp(Math.abs((s._vApplied || 0) * pl.Ip), 0, 120);   // CS/PF pulsed supplies
    P += ht.nbiP / 0.33 + ht.ecP / 0.40 + ht.icP / 0.55;
    P += 12 * (h.fA ** 3 + h.fB ** 3) / 0.95;
    P += (h.fwACmd && !s.malf.fwA ? 3 : 0) + (h.fwBCmd ? 3 : 0) + 6 * clamp(h.fwFlow / 1400, 0, 1.2);
    if (h.cwCmd && !s.malf.cw) P += 10;
    if (s.vac.pumpCmd) P += 2.5;
    if (s.tri.ispCmd) P += 6;
    if (s.fuel.pelletCmd) P += 1.5;
    return P;
  }

  function derive(s) {
    plasmaDerived(s);
    const d = s.d;
    d.house = houseLoad(s);
    d.Pgross = s.tg.breaker ? s.tg.Pgen : 0;
    d.Pnet = d.Pgross - d.house;
    d.Qeng = d.house > 0 ? d.Pgross / d.house : 0;
    d.Tsat = tSat(s.htx.sgP);
    d.served = s.grid.D * (1 - s.grid.shedBlocks / MACHINE.districts);
    d.homesDark = Math.round(s.grid.D * s.grid.shedBlocks / MACHINE.districts * 1000 / 1.3);
    d.homesLit = Math.round(d.served * 1000 / 1.3);
    d.permissives = breakdownPermissives(s);
    return d;
  }

  // ---------------------------------------------------------------- permissives
  function breakdownPermissives(s) {
    const m = s.mag, v = s.vac, M = MACHINE;
    const flowFrac = s.htx.fA + s.htx.fB;
    return [
      { key: 'plasma', label: 'No plasma present', ok: !s.pl.on },
      { key: 'vac', label: 'Torus cryopumps running', ok: v.pumpCmd },
      { key: 'bt', label: 'Toroidal field ≥ 3.2 T', ok: m.tfOn && m.BT >= 3.2 },
      { key: 'cs', label: 'Central solenoid pre-magnetised (≥ 200 Wb)', ok: m.flux >= 200 },
      { key: 'vs', label: 'Vertical stability control in AUTO', ok: m.vsCmd && !s.malf.vs },
      { key: 'gas', label: 'Prefill pressure 1–15 mPa', ok: v.P >= 1e-3 && v.P <= 1.5e-2 },
      { key: 'ec', label: 'ECRH ≥ 2 MW for assisted breakdown', ok: s.heat.ecP >= 2 },
      { key: 'phts', label: 'First-wall cooling flow ≥ 50 %', ok: flowFrac >= 1 },
      { key: 'dms', label: 'Disruption mitigation armed', ok: s.safety.dmsArmed }
    ].map(p => (p.detail = p.ok ? 'OK' : 'NOT MET', p));
    // M referenced for future checks
  }

  // ------------------------------------------------------------------ commands
  function command(s, name, arg) {
    const m = s.mag, pl = s.pl, tg = s.tg;
    switch (name) {
      case 'premag': {
        if (pl.on) return fail(s, 'CS PRE-MAGNETISATION BLOCKED: plasma present');
        if (!m.tfOn) return fail(s, 'CS PRE-MAGNETISATION BLOCKED: TF coils not energised');
        m.premag = true;
        log(s, 'Central solenoid pre-magnetisation started (charging to 220 Wb)', 'op');
        return ok('CS charging');
      }
      case 'initiate': {
        const bad = breakdownPermissives(s).filter(p => !p.ok);
        if (bad.length) {
          s.flags = Object.assign(s.flags || {}, { bdFail: s.t });
          return fail(s, 'BREAKDOWN INHIBITED: ' + bad.map(b => b.label).join('; '));
        }
        startPlasma(s);
        return ok('Breakdown');
      }
      case 'softStop': {
        if (!pl.on) return fail(s, 'No plasma to ramp down');
        if (!pl.rampDown) {
          pl.rampDown = true;
          pl.burnAuto = false;
          log(s, 'PCS: controlled ramp-down initiated by operator', 'op');
        }
        return ok('Ramp-down');
      }
      case 'fpss': {
        s.safety.fpssCount++;
        log(s, 'FAST PLASMA SHUTDOWN actuated (manual)', 'trip');
        fpss(s, 'MANUAL FPSS');
        return ok('FPSS');
      }
      case 'magDump': {
        if (!m.tfOn && m.BT < 0.05) return fail(s, 'Magnets already discharged');
        m.tfCmd = false; m.tfOn = false; m.fastDump = true;
        log(s, 'MAGNET FAST DISCHARGE: TF energy dumped into resistors', 'trip');
        return ok('Fast discharge');
      }
      case 'turbTrip': {
        if (!tg.tripped) { tg.tripped = true; log(s, 'TURBINE TRIP (manual)', 'trip'); }
        return ok('Turbine tripped');
      }
      case 'turbReset': {
        if (!tg.tripped) return ok('Turbine already latched');
        if (s.htx.Pc > 25) return fail(s, 'TURBINE RESET BLOCKED: condenser vacuum low (' + s.htx.Pc.toFixed(0) + ' kPa)');
        if (s.htx.sgL > 85 || s.htx.sgL < 12) return fail(s, 'TURBINE RESET BLOCKED: SG level out of range');
        if (tg.vib > 11) return fail(s, 'TURBINE RESET BLOCKED: vibration high');
        tg.tripped = false; tg.integ = 0; tg.speedSet = Math.round(tg.rpm); tg.speedRef = tg.rpm;
        log(s, 'Turbine latched (stop valves reset)', 'op');
        return ok('Turbine latched');
      }
      case 'runup': {
        if (tg.tripped) return fail(s, 'RUN-UP BLOCKED: turbine tripped, reset first');
        if (tg.breaker) return fail(s, 'Generator on line: speed follows the grid');
        tg.speedSet = 3000;
        log(s, 'Turbine run-up to 3000 rpm selected', 'op');
        return ok('Run-up');
      }
      case 'govRaise':
      case 'govLower': {
        const sign = name === 'govRaise' ? 1 : -1;
        const stepSize = arg || 1;
        if (tg.breaker) { tg.unitAuto = false; tg.loadSet = clamp(tg.loadSet + sign * 5 * stepSize, 0, 1000); }
        else tg.speedSet = clamp(tg.speedSet + sign * (tg.speedSet >= 2900 ? 1 : 50) * stepSize, 0, 3150);
        return ok('');
      }
      case 'breakerClose': {
        if (tg.breaker) return ok('Breaker already closed');
        const chk = syncCheck(s);
        if (!chk.ok) return fail(s, 'SYNC CHECK (25) BLOCKED CLOSE: ' + chk.reason);
        closeBreaker(s);
        return ok('Breaker closed');
      }
      case 'breakerOpen': {
        if (!tg.breaker) return ok('Breaker already open');
        openBreaker(s, 'operator');
        return ok('Breaker open');
      }
      case 'autoSync': {
        if (tg.breaker) return ok('Already synchronised');
        if (tg.tripped) return fail(s, 'AUTO-SYNC BLOCKED: turbine tripped');
        if (!tg.excCmd) return fail(s, 'AUTO-SYNC BLOCKED: excitation off');
        if (tg.rpm < 2850) return fail(s, 'AUTO-SYNC BLOCKED: turbine below 2850 rpm');
        tg.autoSync = true;
        log(s, 'Auto-synchroniser engaged', 'op');
        return ok('Auto-sync');
      }
      case 'ack':
        return ok('');
      default:
        return fail(s, 'Unknown command ' + name);
    }
  }
  function ok(msg) { return { ok: true, msg }; }
  function fail(s, msg) { log(s, msg, 'warn'); return { ok: false, msg }; }

  function syncCheck(s) {
    const tg = s.tg;
    const slip = tg.rpm / 60 - s.grid.f;
    const volts = tg.excCmd ? 24 * tg.rpm / 3000 : 0.3;
    let ang = ((tg.phase % 360) + 360) % 360; if (ang > 180) ang -= 360;
    if (tg.tripped) return { ok: false, reason: 'turbine tripped' };
    if (!tg.excCmd) return { ok: false, reason: 'no excitation' };
    if (Math.abs(volts - 24) > 1.2) return { ok: false, reason: 'voltage mismatch ' + volts.toFixed(1) + ' kV' };
    if (Math.abs(slip) > 0.2) return { ok: false, reason: 'slip ' + slip.toFixed(2) + ' Hz' };
    if (Math.abs(ang) > 15) return { ok: false, reason: 'phase angle ' + ang.toFixed(0) + '°' };
    return { ok: true, slip, ang };
  }
  function closeBreaker(s) {
    const tg = s.tg;
    tg.breaker = true; tg.autoSync = false;
    tg.loadRef = Math.max(30, tg.Pmech / 1e6); tg.loadSet = Math.max(40, tg.loadSet);
    tg.integ = tg.valve;
    log(s, 'GENERATOR BREAKER 52G CLOSED: HELIOS-1 synchronised to Solhavn 400 kV grid', 'op');
  }
  function openBreaker(s, why) {
    const tg = s.tg;
    if (!tg.breaker) return;
    tg.breaker = false; tg.autoSync = false;
    tg.speedSet = 3000; tg.speedRef = tg.rpm; tg.integ = 0.02;
    log(s, 'GENERATOR BREAKER 52G OPEN (' + why + ')', why === 'operator' ? 'op' : 'trip');
  }

  // -------------------------------------------------------------- plasma life
  function startPlasma(s) {
    const pl = s.pl, V = MACHINE.V;
    const n0 = 2 * s.vac.P / (1.380649e-23 * 293);        // fully dissociated & ionised prefill
    const ne = Math.max(n0, 1e18);
    pl.on = true; pl.tStart = s.t; pl.Ip = 1.0; pl.rampDown = false; pl.fluxExhausted = false;
    pl.hmode = false; pl.z = 0.003; pl.ntm = false; pl.elmAcc = 0; pl.cAr = 0; pl.cW = 1e-6;
    pl.NH = 0; pl.NHe = 0;
    const b = s.fuel.blend;
    if (b === 'HH') { pl.NH = ne * V; pl.ND = 0; pl.NT = 0; }
    else { pl.ND = ne * V; pl.NT = 0; }
    pl.W = 1.5 * 2 * ne * 0.02 * KEV * V;
    pl.pulse++;
    s.mag.flux -= 8;
    s.mag.premag = false;
    s.vac.prefillCmd = false;
    s.d.T = 0.02;
    log(s, 'BREAKDOWN: plasma initiated, pulse #' + pl.pulse + ' (Ip 1.0 MA, prefill ' + (s.vac.P * 1000).toFixed(1) + ' mPa)', 'op');
  }

  function endPlasma(s, why) {
    const pl = s.pl, h = s.heat;
    pl.on = false; pl.Ip = 0; pl.W = 0; pl.ND = pl.NT = pl.NH = pl.NHe = 0; pl.cAr = pl.cW = 0;
    pl.hmode = false; pl.rampDown = false; pl.ntm = false; pl.z = 0; pl.burnAuto = false;
    h.nbiCmd = false; h.icCmd = false; h.ecCmd = false;
    s.fuel.auto = false; s.fuel.manFlow = 0; s.fuel.integ = 0; s.fuel.pelletCmd = false;
    s.d.T = 0;
    log(s, 'PCS: plasma terminated (' + why + '). Heating and fuelling inhibited', 'info');
  }

  function disrupt(s, reason) {
    const pl = s.pl;
    if (!pl.on) return;
    const W = pl.W, Ip = pl.Ip;
    const mitigated = s.safety.dmsArmed && !s.malf.dms;
    const WGJ = W / 1e9;
    pl.dCount++;
    pl.lastDisruption = { t: s.t, clock: fmtClock(s.clock), reason, mitigated, W, Ip };
    log(s, 'DISRUPTION: ' + reason + '. Thermal quench ' + (W / 1e6).toFixed(0) + ' MJ in ~1 ms, current quench ' + Ip.toFixed(1) + ' MA', 'trip');
    if (mitigated) {
      s.dmg.fw += 0.3 * WGJ + 0.02 * Ip / 22;
      log(s, 'DMS fired: shattered pellet injection radiated the energy, runaway electrons suppressed', 'warn');
    } else {
      s.dmg.fw += 5 * WGJ + (Ip > 5 ? 3 * Ip / 22 : 0);
      s.dmg.div += 7 * WGJ;
      s.dmg.mag += 0.8 * Ip / 22;
      log(s, 'UNMITIGATED: ' + (Ip > 5 ? 'runaway electron beam struck the first wall; ' : '') + 'halo currents loaded the vessel', 'trip');
    }
    s.htx.Tfw += W / MACHINE.Cfw;
    pl.flash = mitigated ? 0.9 : 1.4;
    endPlasma(s, 'disruption');
  }

  function fpss(s, why) {
    const pl = s.pl;
    if (pl.on) {
      const W = pl.W;
      if (s.safety.dmsArmed && !s.malf.dms) {
        s.dmg.fw += 0.05 * W / 1e9;
        pl.flash = 0.7;
        log(s, 'FPSS: SPI + massive gas injection, mitigated termination (' + (W / 1e6).toFixed(0) + ' MJ radiated)', 'warn');
        pl.dCount++;
        pl.lastDisruption = { t: s.t, clock: fmtClock(s.clock), reason: why, mitigated: true, W, Ip: pl.Ip };
        endPlasma(s, why);
      } else {
        disrupt(s, why + ' with DMS disarmed');
      }
    }
    s.heat.nbiCmd = s.heat.ecCmd = s.heat.icCmd = false;
    s.fuel.auto = false; s.fuel.manFlow = 0;
  }

  // =============================================================== main step
  function step(s, dt) {
    if (s.frozen) return;
    s.t += dt;
    s.clock = (s.clock + dt) % 86400;
    stepMagnets(s, dt);
    stepVacuum(s, dt);
    stepHeating(s, dt);
    stepPlasma(s, dt);
    stepHeatTransport(s, dt);
    stepTurbine(s, dt);
    stepGrid(s, dt);
    stepTritium(s, dt);
    stepProtection(s, dt);
    derive(s);
  }

  function stepMagnets(s, dt) {
    const m = s.mag, M = MACHINE, pl = s.pl;
    m.cryoOn = m.cryoCmd && !s.malf.cryo;
    const PnMW = (s.d.Pn || 0) / 1e6;
    if (m.cryoOn) {
      const Teq = 19.6 + 0.0012 * PnMW + 4 * Math.abs(m.dBdt);
      m.coilT = m.coilT > Teq ? relax(m.coilT, Teq, 14, dt) : approach(m.coilT, Teq, 0.05 + 0.0004 * PnMW, dt);
    } else {
      m.coilT += dt * (m.coilT < 60 ? (0.06 + 0.00045 * PnMW) : 0.004);
    }
    // TF breaker and permissive
    if (!m.tfCmd) m.tfOn = false;
    else if (!m.tfOn && m.coilT < 23 && !m.quench) { m.tfOn = true; m.fastDump = false; log(s, 'TF coil power supply energised', 'op'); }
    const BTold = m.BT;
    if (m.tfOn) m.BT = approach(m.BT, m.BTset, 0.04, dt);
    else if (m.quench || m.fastDump) m.BT *= Math.exp(-dt / (m.quench ? 1.5 : 2.5));
    else m.BT = approach(m.BT, 0, 0.05, dt);
    if (m.BT < 0.002) m.BT = 0;
    m.dBdt = (m.BT - BTold) / dt;
    // quench: HTS REBCO current sharing above ~30 K at operating current
    if (m.BT > 0.5 && m.coilT > 30 && !m.quench) {
      m.quench = true; m.tfOn = false; m.tfCmd = false;
      s.dmg.mag += 1.5;
      log(s, 'TF COIL QUENCH DETECTED at ' + m.coilT.toFixed(1) + ' K: quench protection fast discharge', 'trip');
    }
    if (m.quench && m.BT < 0.05 && m.coilT < 26) { m.quench = false; log(s, 'Quench recovered: TF coils cold and discharged', 'info'); }
    // central solenoid
    if (m.premag && !pl.on) {
      if (m.tfOn || m.BT > 1) m.flux = approach(m.flux, M.fluxMax, 12, dt);
    }
  }

  function stepVacuum(s, dt) {
    const v = s.vac, M = MACHINE;
    const S = v.pumpCmd ? M.pumpSpeed : 0.5;
    let Q = 2e-4;                                        // outgassing + permeation
    if (v.prefillCmd && !s.pl.on) Q += 0.6;
    if (!s.pl.on) Q += s.fuel.flow * 0.02;               // fuel valves open into an empty vessel
    else Q += s.fuel.flow * 0.004;                       // divertor neutral pressure proxy
    if (s.malf.lova) Q += 250;
    v.P += dt * (Q - S * v.P) / M.vesselGasVolume;
    v.P = Math.max(v.P, 1e-7);
  }

  function stepHeating(s, dt) {
    const h = s.heat, pl = s.pl, M = MACHINE;
    const ne = s.d.ne || 0;
    const nbiOk = pl.on && ne >= 1e19 && !s.malf.nbi;
    const icOk = pl.on;
    h.nbiInterlock = h.nbiCmd && pl.on && ne < 1e19;
    h.nbiP = approach(h.nbiP, h.nbiCmd && nbiOk ? clamp(h.nbiSet, 0, M.nbiMax) : 0, 10, dt);
    h.ecP = approach(h.ecP, h.ecCmd ? clamp(h.ecSet, 0, M.ecMax) : 0, 20, dt);
    h.icP = approach(h.icP, h.icCmd && icOk ? clamp(h.icSet, 0, M.icMax) : 0, 10, dt);
    if (pl.rampDown) {
      h.nbiP = approach(h.nbiP, 0, 1.5, dt);
      h.icP = approach(h.icP, 0, 1.5, dt);
      h.ecP = approach(h.ecP, Math.min(h.ecP, 5), 1.5, dt);
    }
  }

  function stepPlasma(s, dt) {
    const pl = s.pl, M = MACHINE, V = M.V, f = s.fuel, m = s.mag;
    if (pl.flash > 0) pl.flash = Math.max(0, pl.flash - dt * 1.5);
    if (pl.elmFlash > 0) pl.elmFlash = Math.max(0, pl.elmFlash - dt * 6);
    // fuelling valves are computed even with no plasma (gas goes to the vessel)
    if (!pl.on) {
      f.flow = f.auto ? 0 : f.manFlow;
      splitFuel(s, f.flow);
      s._dIp = 0;
      return;
    }
    const d = plasmaDerived(s);

    // --- coordinated control: unit master turns grid demand into a fusion power target
    if (pl.burnAuto && s.tg.unitAuto && s.tg.breaker) {
      const grossNeed = s.grid.D + (s.d.house || 250);
      const pumpHeat = 12 * (s.htx.fA ** 3 + s.htx.fB ** 3);
      const want = clamp((grossNeed / 0.335 - d.Paux / 1e6 - pumpHeat) / 1.144 * 1.03, 300, 2600);
      pl.PfusSet = approach(pl.PfusSet, want, 8, dt);
    }
    // --- burn control: trims the density target to hold fusion power (kept below the
    //     Greenwald region where confinement degrades)
    pl.burnLimit = false;
    if (pl.burnAuto && !pl.rampDown && f.auto) {
      const err = (pl.PfusSet * 1e6 - d.Pfus) / Math.max(pl.PfusSet * 1e6, 1e8);
      f.nG = clamp(f.nG + 0.015 * err * dt, 0.3, 0.9);
      pl.burnLimit = (f.nG >= 0.9 && err > 0.02) || (f.nG <= 0.3 && err < -0.02);
    }

    // --- fuelling (Pa·m³/s of gas-equivalent atoms)
    if (pl.rampDown) f.flow = 0;
    else if (f.auto) {
      const err = (f.nG * d.nG - d.ne / 1e20);
      f.integ = clamp(f.integ + 60 * err * dt, 0, 200);
      f.flow = clamp(250 * err + f.integ, 0, 200);
      if (f.integ >= 200 && err > 0) f.integ = 200;
    } else f.flow = clamp(f.manFlow, 0, 200);
    splitFuel(s, f.flow);
    const pellets = f.pelletCmd && !s.malf.pellet;
    const eff = pellets ? 0.85 : (pl.hmode ? 0.2 : 0.4);
    f.pelletHz = pellets ? f.flow * ATOMS_PER_PAM3 / 4e21 : 0;
    const Sd = f.valveD * ATOMS_PER_PAM3 * eff;
    const St = f.valveT * ATOMS_PER_PAM3 * eff;
    const Sh = f.valveH * ATOMS_PER_PAM3 * eff;

    // --- particle balance
    const pump = clamp(f.pumpSpeed / 100, 0, 1);
    const pumpFactor = 1.6 - pump;
    const tauP = clamp(4 * d.tauE, 0.4, 25) * pumpFactor;
    const tauHe = clamp(5 * d.tauE, 0.8, 60) * pumpFactor * 1.1;
    const Rdt = d.Rdt, Rddn = d.Rddn, Rddp = d.Rddp, Rpp = d.Rpp;
    pl.ND = Math.max(0, (pl.ND + dt * (Sd - 2 * (Rddn + Rddp) - Rdt)) / (1 + dt / tauP));
    pl.NT = Math.max(0, (pl.NT + dt * (St - Rdt + Rddp)) / (1 + dt / tauP));
    pl.NH = Math.max(0, (pl.NH + dt * (Sh - 2 * Rpp + Rddp)) / (1 + dt / tauP));
    pl.NHe = Math.max(0, (pl.NHe + dt * (Rdt + Rddn)) / (1 + dt / tauHe));
    s._exhaustT = pl.NT / tauP + s.fuel.valveT * ATOMS_PER_PAM3 * (1 - eff);   // T atoms/s to exhaust

    // --- impurities
    const tauImp = clamp(3 * d.tauE, 0.5, 20);
    const cArEq = 0.001 * f.seed / 100 * (pl.hmode ? 1 : 0.6);
    pl.cAr = relax(pl.cAr, cArEq, Math.max(1, 2 * d.tauE), dt);
    let wSrc = 2e-9;
    if (d.qdiv > 10) wSrc += 2e-7 * (d.qdiv - 10);
    pl.cW = Math.max(0, (pl.cW + dt * wSrc) / (1 + dt / tauImp));
    if (s.malf.lova && s.vac.P > 0.5) pl.cAr += dt * 0.002;   // air ingress: N/O behave like a light seed

    // --- energy
    const Wold = pl.W;
    pl.W = (pl.W + dt * (d.Pheat - d.Prad)) / (1 + dt / d.tauE);
    if (pl.W < 1e3) pl.W = 1e3;
    s._Ptransport = pl.W / d.tauE;

    // --- L-H transition
    if (!pl.hmode && d.Psep > d.PLH && d.fG < 0.95 && pl.Ip > 3) {
      pl.hmode = true; pl.lhCount++;
      log(s, 'L-H TRANSITION: H-mode pedestal formed (P_sep ' + (d.Psep / 1e6).toFixed(0) + ' MW > P_LH ' + (d.PLH / 1e6).toFixed(0) + ' MW)', 'info');
    } else if (pl.hmode && (d.Psep < 0.75 * d.PLH || d.fG > 1.0)) {
      pl.hmode = false;
      log(s, 'H-L BACK-TRANSITION: ' + (d.fG > 1.0 ? 'density limit' : 'separatrix power below threshold'), 'warn');
    }

    // --- ELMs
    pl.elmType = 'NONE';
    s._elmPower = 0;
    if (pl.hmode) {
      const Wped = 0.35 * pl.W;
      if (s.heat.rmpCmd && !s.malf.rmp) {
        pl.elmType = 'SUPPRESSED (RMP)';
      } else if (f.pelletCmd && !s.malf.pellet && f.pelletHz > 3) {
        pl.elmType = 'PACED (PELLETS)';
        pl.elmAcc += f.pelletHz * dt;
        while (pl.elmAcc >= 1) { pl.elmAcc -= 1; pl.elmCount++; }
      } else {
        pl.elmType = 'TYPE-I';
        const dW = 0.05 * Wped;
        const freq = clamp(0.2 * d.Psep / Math.max(dW, 1), 0, 40);
        pl.elmAcc += freq * dt;
        while (pl.elmAcc >= 1) {
          pl.elmAcc -= 1; pl.elmCount++;
          pl.W -= dW; s._elmPower += dW / dt;
          s.dmg.div += 0.0005 * dW / 1e6;
          pl.cW += 3e-8 * dW / 1e6;
          pl.elmFlash = Math.min(1, 0.4 + dW / 3e7);
        }
      }
    }

    // --- plasma current and flux
    const target = pl.rampDown ? 0 : clamp(pl.IpSet, 0, M.IpMax);
    const rate = pl.rampDown ? Math.max(pl.ramp, 0.3) : pl.ramp;
    const Ipold = pl.Ip;
    let dIp = approach(pl.Ip, target, rate, dt) - pl.Ip;
    // the CS supply can only apply vLoopMax; beyond that the current decays on its own L/R
    const vMax = m.flux > 0 ? M.vLoopMax : Math.min(M.vLoopMax, 0);
    if (d.Vloop + M.Lp * dIp * 1e6 / dt > vMax) dIp = (vMax - d.Vloop) / (M.Lp * 1e6) * dt;
    pl.Ip = Math.max(0, Ipold + dIp);
    s._dIp = dIp / dt;
    s._vApplied = d.Vloop + M.Lp * dIp * 1e6 / dt;
    m.flux -= s._vApplied * dt;
    m.flux = Math.min(m.flux, M.fluxMax);
    if (m.flux <= 0 && !pl.rampDown && d.Iind > 0) {
      pl.rampDown = true; pl.fluxExhausted = true; pl.burnAuto = false;
      log(s, 'CS FLUX EXHAUSTED: PCS starts controlled ramp-down (end of pulse)', 'warn');
    }

    // --- vertical position
    const vsOk = m.vsCmd && !s.malf.vs;
    const noise = (rand(s) - 0.5) * 0.004;
    if (vsOk) pl.z += (-6 * pl.z) * dt + noise * Math.sqrt(dt) * 3;
    else pl.z += (7 * pl.z + Math.sign(pl.z || 1) * 0.004) * dt;

    // --- NTMs (3/2 tearing modes) at high beta, stabilised by ECCD
    if (pl.hmode && !pl.ntm && d.betaN > 4.0 && hazard(s, 0.12 * (d.betaN - 4.0), dt)) {
      pl.ntm = true; pl.ntmTime = 0; pl.ecOnNtm = 0;
      log(s, 'NTM DETECTED: m/n = 3/2 magnetic island, confinement degraded', 'warn');
    }
    if (pl.ntm) {
      pl.ntmTime += dt;
      pl.ecOnNtm = d.ecAbs >= 10e6 ? pl.ecOnNtm + dt : 0;
      if (pl.ecOnNtm > 4) { pl.ntm = false; log(s, 'NTM stabilised by ECCD', 'info'); }
      else if (pl.ntmTime > 40) return disrupt(s, 'LOCKED MODE (unstabilised NTM)');
    }

    // --- stability limits
    const age = s.t - pl.tStart;
    if (Math.abs(pl.z) > 0.6) return disrupt(s, 'VERTICAL DISPLACEMENT EVENT (VDE)');
    if (m.BT < 1.2) return disrupt(s, 'LOSS OF TOROIDAL FIELD');
    if (d.q95 < 2.0) return disrupt(s, 'EXTERNAL KINK (q95 < 2)');
    if (d.betaN > 5.6) return disrupt(s, 'BETA LIMIT (resistive wall mode)');
    if (d.betaN > 5.0 && hazard(s, (d.betaN - 5.0) * 1.5, dt)) return disrupt(s, 'BETA LIMIT (resistive wall mode)');
    if (pl.Ip > 1.5) {
      if (d.fG > 1.35) return disrupt(s, 'DENSITY LIMIT (MARFE)');
      if (d.fG > 1.12 && hazard(s, (d.fG - 1.12) * 8, dt)) return disrupt(s, 'DENSITY LIMIT (MARFE)');
    }
    if (age > 4 && d.T < 0.06 && !pl.rampDown) return disrupt(s, 'RADIATIVE COLLAPSE');
    if (age > 4 && d.fRad > 0.95 && d.T < 3 && hazard(s, 0.25, dt)) return disrupt(s, 'RADIATIVE COLLAPSE');
    if (s.vac.P > 3) return disrupt(s, 'LOSS OF VACUUM (air ingress)');

    // --- graceful end
    if (pl.rampDown && pl.Ip <= 0.8) {
      log(s, 'Controlled ramp-down complete, pulse #' + pl.pulse + ' ended normally', 'info');
      endPlasma(s, 'end of pulse');
    }
    void Wold;
  }

  function splitFuel(s, flow) {
    const f = s.fuel;
    let fd = 0, ft = 0, fh = 0;
    if (f.blend === 'DT') { ft = f.tFrac; fd = 1 - ft; }
    else if (f.blend === 'DD') fd = 1;
    else fh = 1;
    if (s.tri.store <= 0.5 || s.malf.tritium) ft = 0;
    f.valveD = flow * fd; f.valveT = flow * ft; f.valveH = flow * fh;
  }

  function stepHeatTransport(s, dt) {
    const h = s.htx, M = MACHINE, d = s.d, pl = s.pl;
    // decay heat from activated structures
    h.DH = relax(h.DH, 0.015 * (d.Pn || 0) / 1e6, 600, dt);
    // PHTS pumps (with coast-down)
    const tA = h.pumpACmd && !s.malf.pumpA ? h.speed / 100 : 0;
    const tB = h.pumpBCmd && !s.malf.pumpB ? h.speed / 100 : 0;
    h.fA = relax(h.fA, tA, tA > h.fA ? 4 : 9, dt);
    h.fB = relax(h.fB, tB, tB > h.fB ? 4 : 9, dt);
    const flowFrac = Math.max(0.02, h.fA + h.fB) / 2;
    const mdot = flowFrac * 2 * M.phtsFlowPerPump;
    h.flow = mdot;
    const pumpHeat = 12 * (h.fA ** 3 + h.fB ** 3);          // MW
    // heat reaching blanket / first wall / divertor, MW
    const unabsorbed = (s.heat.nbiP + s.heat.ecP + s.heat.icP) - (d.Paux || 0) / 1e6;
    let Qr = (d.Pn || 0) / 1e6 * M.blanketMult + h.DH + Math.max(0, unabsorbed);
    if (pl.on) Qr += ((s._Ptransport || 0) + (d.Prad || 0) + (s._elmPower || 0)) / 1e6;
    h.Qr = Qr;
    const hFw = M.hFw * Math.pow(flowFrac, 0.8);
    const qToCool = hFw * (h.Tfw - h.Tavg) / 1e6;       // MW
    h.Tfw += dt * (Qr - qToCool) * 1e6 / M.Cfw;
    // steam generator
    const Ts = tSat(h.sgP);
    const levelF = clamp(h.sgL / 40, 0, 1);
    let Qsg = M.UAsg * (h.Tavg - Ts) * levelF / 1e6;
    if (Qsg < 0) Qsg *= 0.1;
    h.Qsg = Qsg;
    const Qamb = 2 * (h.Tavg - 40) / 260;
    h.Tavg += dt * (qToCool + pumpHeat - Qsg - Qamb) * 1e6 / M.Cpc;
    h.dT = clamp(Math.max(0, qToCool) * 1e6 / (mdot * M.cpWater), 0, 180);
    h.Thot = h.Tavg + h.dT / 2; h.Tcold = h.Tavg - h.dT / 2;
    h.prz = 15.5 + 0.035 * (h.Tavg - 306);
    h.porv = h.prz > 17.2;
    if (h.porv) h.Tavg -= dt * 0.5;
    // MSIV stroke
    h.msiv = approach(h.msiv, h.msivCmd && !s.malf.msiv ? 1 : 0, 0.2, dt);
    // steam flows, kg/s
    const gen = Math.max(0, Qsg) * 1e6 / M.hEvap;
    h.steamGen = gen;
    const tg = s.tg;
    const condOk = h.Pc < 30;
    const mTurb = tg.tripped ? 0 : tg.valve * h.msiv * M.turbineK * h.sgP;
    // steam dump (condenser bypass), auto holds 7.0 MPa
    if (h.dumpAuto) {
      const target = clamp((h.sgP - 7.0) * 1.5 + (tg.tripped ? 0.02 : 0), 0, 1);
      h.dumpPos = approach(h.dumpPos, target, 0.5, dt);
    } else h.dumpPos = approach(h.dumpPos, h.dumpMan / 100, 0.3, dt);
    const mDump = condOk ? h.dumpPos * h.msiv * 0.5 * M.turbineK * h.sgP : 0;
    h.relief = h.sgP > 8.3 ? 500 * (h.sgP - 8.3) : 0;
    const mOut = mTurb + mDump + h.relief;
    h.steamTurb = mTurb; h.steamDump = mDump;
    h.sgP = Math.max(0.1, h.sgP + dt * (gen - mOut) / M.steamCap);
    // feedwater (three-element control in AUTO)
    const pumpsAvail = (h.fwACmd && !s.malf.fwA ? 1 : 0) + (h.fwBCmd && !s.malf.fwB ? 1 : 0);
    const cap = pumpsAvail * 800;
    if (h.fwAuto) {
      const demand = gen + 25 * (50 - h.sgL);
      h.fwPos = approach(h.fwPos, cap > 0 ? clamp(demand / cap, 0, 1) : h.fwPos, 0.25, dt);
    }
    h.fwFlow = cap * h.fwPos;
    h.sgL += dt * (h.fwFlow - gen - h.relief * 0.3) / M.sgLevelMass;
    h.sgL = clamp(h.sgL, 0, 100);
    // condenser
    const cwOn = h.cwCmd && !s.malf.cw;
    const steamIn = mTurb + mDump;
    if (cwOn) h.Pc = relax(h.Pc, 5 + 3 * steamIn / 1300, 20, dt);
    else h.Pc = Math.min(101, h.Pc + dt * (0.15 + 0.8 * steamIn / 1300));
    // primary loop pressure also cools slowly with no heat
  }

  function stepTurbine(s, dt) {
    const tg = s.tg, h = s.htx, M = MACHINE, g = s.grid;
    const mTurb = h.steamTurb;
    const condF = clamp(1 - (h.Pc - 6) / 40, 0.2, 1);
    tg.Pmech = mTurb * M.dhTurbine * condF;               // W
    const PmMW = tg.Pmech / 1e6;
    // governor
    if (tg.tripped) {
      tg.valve = approach(tg.valve, 0, 5, dt);
      tg.integ = 0;
      if (tg.speedSet > 0 && tg.rpm < 100) tg.speedSet = 0;
    } else if (!tg.breaker) {
      if (tg.autoSync) {
        tg.speedSet = 3000 + 3;
        const chk = syncCheck(s);
        let ang = ((tg.phase % 360) + 360) % 360; if (ang > 180) ang -= 360;
        if (chk.ok && Math.abs(ang) < 5) closeBreaker(s);
      }
      // speed governor: run-up at 25 rpm/s (60 rpm/s through the critical band), with
      // feed-forward of friction + acceleration power and an anti-windup integrator
      const inBand = tg.speedRef > 1200 && tg.speedRef < 1700;
      const rampRate = inBand ? 60 : 25;
      const prevRef = tg.speedRef;
      tg.speedRef = approach(tg.speedRef, tg.speedSet, rampRate, dt);
      const accel = (tg.speedRef - prevRef) / dt;
      const wRef = tg.speedRef / 3000;
      const Preq = 3e6 * wRef * wRef + 1e6 * wRef + 2 * 6 * M.genRating * 1e6 * Math.max(wRef, 0.05) * accel / 3000;
      const ff = Math.max(0, Preq) / (M.dhTurbine * M.turbineK * Math.max(h.sgP * h.msiv, 0.3));
      const err = tg.speedRef - tg.rpm;
      if (Math.abs(err) < 60) tg.integ = clamp(tg.integ + 2e-5 * err * dt, -0.05, 0.05);
      tg.valve = clamp(ff + 2e-4 * err + tg.integ, 0, 1);
    } else {
      // load control; unit master follows Solhavn demand
      if (tg.unitAuto) tg.loadSet = clamp(g.D + (s.d.house || 0) - 0, 0, 1000);
      // pressure limiter: runs the load back when the steam generator cannot keep up
      tg.limiter = h.sgP < 6.3;
      if (tg.limiter) tg.loadRef = Math.max(0, Math.min(tg.loadRef, PmMW) - dt * 60 * (6.3 - h.sgP));
      else tg.loadRef = approach(tg.loadRef, Math.max(0, tg.loadSet), 12, dt);
      const droop = -(g.f - 50) / 50 / 0.05 * M.genRating;
      const ref = tg.loadRef + clamp(droop, -150, 150);
      tg.valve = clamp(tg.valve + 6e-4 * (ref - tg.Pgen) * dt, 0, 1);
    }
    // rotor
    if (!tg.breaker) {
      const w = tg.rpm / 3000;
      const Pf = 3e6 * w * w + 1e6 * w;
      const J2H = 2 * 6 * M.genRating * 1e6;
      const dw = (tg.Pmech - Pf) / (J2H * Math.max(w, 0.05)) * dt;
      tg.rpm = Math.max(0, tg.rpm + dw * 3000);
      tg.Pgen = 0;
      tg.phase = (tg.phase + 360 * (tg.rpm / 60 - g.f) * dt) % 360;
    } else {
      tg.rpm = g.f * 60;
      tg.phase = 0;
      tg.Pgen = PmMW * 0.985 - 4;
      if (!tg.excCmd || s.malf.exc) { openBreaker(s, 'loss of excitation, relay 40'); }
    }
    // critical speed band and vibration (ISO 10816 zones)
    const inCrit = !tg.breaker && tg.rpm > 1250 && tg.rpm < 1650;
    tg.bandTime = inCrit ? tg.bandTime + dt : Math.max(0, tg.bandTime - dt * 2);
    const vibTarget = 1.2 + (inCrit ? 2.5 + tg.bandTime * 0.35 : 0) + (tg.rpm > 3150 ? (tg.rpm - 3150) * 0.03 : 0) + (s.dmg.gen > 0 ? s.dmg.gen * 0.05 : 0);
    tg.vib = relax(tg.vib, vibTarget, 1.5, dt);
  }

  function stepGrid(s, dt) {
    const g = s.grid, M = MACHINE, tg = s.tg;
    // demand: daily curve + dispatcher events + slow noise
    if (s.t >= g.nextEvent) {
      const ev = DISPATCH_EVENTS[Math.floor(rand(s) * DISPATCH_EVENTS.length)];
      g.extra = ev.mw; g.extraUntil = s.t + ev.dur; g.msg = ev.text;
      g.nextEvent = s.t + ev.dur + 900 + rand(s) * 1800;
      log(s, 'DISPATCH (Solhavn TSO): ' + ev.text, 'info');
    }
    if (s.t > g.extraUntil && g.extra !== 0) { g.extra = 0; g.msg = ''; log(s, 'DISPATCH: event ended, demand returning to schedule', 'info'); }
    g.noise = relax(g.noise, (rand(s) - 0.5) * 30, 40, dt);
    g.Dtarget = demandAt(s.clock) + g.extra + g.noise;
    g.D = approach(g.D, g.Dtarget, 1.2, dt);

    const house = houseLoad(s);
    const Pplant = (tg.breaker ? tg.Pgen : 0) - house;
    const block = g.D / M.districts;
    const load = g.D - g.shedBlocks * block;
    // HVDC link: frequency droop + AGC toward balancing, ramp-limited
    const want = clamp(load - Pplant + 400 * (50 - g.f), -M.importCap, M.importCap);
    g.imp = approach(g.imp, want, 30, dt);
    const mismatch = Pplant + g.imp - load;
    const H = 4, S = 2000, Dl = 40;
    g.f += dt * 50 / (2 * H * S) * (mismatch - Dl * (g.f - 50));
    g.f = clamp(g.f, 45, 55);
    // under-frequency load shedding: stage k trips at 49.2 - 0.2k Hz after 0.3 s; a slow stage
    // sheds one more district if frequency stays below 49.5 Hz for 8 s
    const stageF = 49.2 - 0.2 * g.shedBlocks;
    g.shedTimer = g.f < stageF ? g.shedTimer + dt : 0;
    g.slowTimer = g.f < 49.5 ? (g.slowTimer || 0) + dt : 0;
    g.tsoTimer = g.f < 49.8 ? (g.tsoTimer || 0) + dt : 0;        // TSO manual shedding
    if ((g.shedTimer > 0.3 || g.slowTimer > 8 || g.tsoTimer > 25) && g.shedBlocks < M.districts) {
      g.tsoTimer = 0;
      g.shedBlocks++; g.shedTimer = 0; g.slowTimer = 0;
      log(s, 'UFLS: ' + g.f.toFixed(2) + ' Hz, district ' + g.shedBlocks + ' of Solhavn disconnected (' + block.toFixed(0) + ' MW)', 'trip');
    }
    // restoration by the TSO when headroom exists
    const headroom = Pplant + M.importCap - load;
    if (g.shedBlocks > 0 && g.f > 49.9 && headroom > block + 15) {
      g.restoreTimer += dt;
      if (g.restoreTimer > 6) {
        g.restoreTimer = 0; g.shedBlocks--;
        log(s, 'TSO: district restored, ' + g.shedBlocks + ' still dark', 'info');
      }
    } else g.restoreTimer = 0;
    // over-frequency protection of the unit
    if (g.f > 51.5 && tg.breaker) openBreaker(s, 'over-frequency 51.5 Hz');
    // accounting
    const hrs = dt / 3600;
    g.servedMWh += load * hrs;
    g.unservedMWh += g.shedBlocks * block * hrs;
    if (tg.breaker) g.plantMWh += Math.max(0, Pplant) * hrs;
    g.dev = tg.breaker ? Pplant - g.D : 0;
    g.devTime = tg.breaker && Math.abs(g.dev) > 0.1 * g.D ? g.devTime + dt : 0;
  }

  function stepTritium(s, dt) {
    const tr = s.tri, f = s.fuel, d = s.d, M = MACHINE;
    const injected = f.valveT * ATOMS_PER_PAM3 * G_PER_T_ATOM;       // g/s
    tr.store = Math.max(0, tr.store - injected * dt);
    const exhaustIn = s.pl.on ? (s._exhaustT || 0) * G_PER_T_ATOM : injected;
    tr.exhaust += exhaustIn * dt;
    const tbr = 0.85 + 0.35 * f.liEnrich / 100;
    tr.tbr = tbr;
    const bredRate = tbr * (d.Rdt || 0) * G_PER_T_ATOM;                // g/s
    tr.blanket += bredRate * dt;
    tr.bred += bredRate * dt;
    tr.burned += (d.Rdt || 0) * G_PER_T_ATOM * dt;
    if (tr.ispCmd && !s.malf.isp) {
      const back = tr.exhaust * (1 - Math.exp(-dt / 90));
      tr.exhaust -= back; tr.store += back * 0.9995;
      const ext = tr.blanket * (1 - Math.exp(-dt / 240));
      tr.blanket -= ext; tr.store += ext;
    }
    tr.injectRate = injected;
    tr.burnRate = (d.Rdt || 0) * G_PER_T_ATOM;
    tr.breedRate = bredRate;
    tr.stack = 2e5 + (s.malf.isp ? 0 : 0) + tr.exhaust * 5e4;      // Bq/s stack release (normal is tiny)
    void M;
  }

  function stepProtection(s, dt) {
    const h = s.htx, pl = s.pl, tg = s.tg, d = s.d;
    s.trips = s.trips || {};
    const T = s.trips;
    const Pfus = d.Pfus || 0;
    // Central Safety System (plasma)
    if (pl.on) {
      if (h.Tfw >= 520) { log(s, 'CSS-01 FIRST WALL TEMPERATURE HIGH-HIGH (' + h.Tfw.toFixed(0) + ' °C): automatic FPSS', 'trip'); fpss(s, 'CSS-01 FIRST WALL OVERTEMPERATURE'); }
      else if ((h.fA + h.fB) / 2 < 0.25 && Pfus > 100e6) { log(s, 'CSS-02 PHTS FLOW LOW-LOW: automatic FPSS', 'trip'); fpss(s, 'CSS-02 LOSS OF COOLANT FLOW'); }
      else if (h.sgL <= 12 && Pfus > 100e6) { log(s, 'CSS-03 SG LEVEL LOW-LOW (loss of heat sink): automatic FPSS', 'trip'); fpss(s, 'CSS-03 LOSS OF HEAT SINK'); }
      else if (s.mag.quench) { fpss(s, 'CSS-04 TF QUENCH'); }
      else if (h.prz >= 17.5) { log(s, 'CSS-05 PRIMARY PRESSURE HIGH-HIGH: automatic FPSS', 'trip'); fpss(s, 'CSS-05 PRIMARY OVERPRESSURE'); }
    }
    // Turbine protection
    if (!tg.tripped) {
      let why = '';
      if (tg.rpm > 3300) why = 'TPS-01 OVERSPEED (110 %)';
      else if (h.Pc > 25 && tg.rpm > 500) why = 'TPS-02 CONDENSER VACUUM LOW';
      else if (h.sgL >= 85) why = 'TPS-03 SG LEVEL HIGH-HIGH';
      else if (tg.vib > 11) why = 'TPS-04 VIBRATION HIGH';
      else if (h.sgL <= 12 && tg.rpm > 500) why = 'TPS-05 SG LEVEL LOW-LOW';
      else if (h.sgP < 4.5 && tg.rpm > 2500) why = 'TPS-06 MAIN STEAM PRESSURE LOW';
      if (why) { tg.tripped = true; log(s, 'TURBINE TRIP: ' + why, 'trip'); }
    }
    // Generator protection: reverse power (relay 32)
    if (tg.breaker && tg.Pgen < -3) {
      tg.rpTime += dt;
      if (tg.rpTime > 2.5) { openBreaker(s, 'reverse power, relay 32'); tg.rpTime = 0; }
    } else tg.rpTime = 0;
    T.css01 = h.Tfw; T.css02 = (h.fA + h.fB) / 2; T.css03 = h.sgL; T.css05 = h.prz;
  }

  // ------------------------------------------------------------ annunciators
  // Each alarm: id, text shown on the window, priority (1 red, 2 amber, 3 white), condition.
  const ALARMS = [
    ['disr', 'PLASMA\nDISRUPTION', 1, s => s.pl.lastDisruption && s.t - s.pl.lastDisruption.t < 20],
    ['vde', 'VERTICAL\nPOSITION', 1, s => s.pl.on && Math.abs(s.pl.z) > 0.08],
    ['dens', 'DENSITY\nLIMIT n/nG', 2, s => s.pl.on && s.d.fG > 0.95],
    ['beta', 'BETA LIMIT\nβN HIGH', 2, s => s.pl.on && s.d.betaN > 4.5],
    ['q95', 'SAFETY\nFACTOR q95 LOW', 2, s => s.pl.on && s.d.q95 < 3],
    ['ntm', 'NTM / LOCKED\nMODE', 2, s => s.pl.on && s.pl.ntm],
    ['elm', 'TYPE-I ELMs\nUNMITIGATED', 2, s => s.pl.on && s.pl.elmType === 'TYPE-I'],
    ['rad', 'RADIATED\nPOWER HIGH', 2, s => s.pl.on && s.d.fRad > 0.8 && s.t - s.pl.tStart > 5],
    ['he', 'He ASH\nACCUMULATION', 2, s => s.pl.on && s.d.heFrac > 0.08],
    ['tung', 'TUNGSTEN\nINFLUX', 2, s => s.pl.on && s.pl.cW > 3e-5],
    ['div', 'DIVERTOR HEAT\nFLUX HIGH', 2, s => s.pl.on && s.d.qdiv > 10],
    ['flux', 'CS FLUX\nLOW', 2, s => s.pl.on && s.mag.flux < 40],
    ['nbi', 'NBI SHINE-\nTHROUGH ILK', 3, s => s.heat.nbiInterlock],
    ['bd', 'BREAKDOWN\nINHIBITED', 3, s => s.flags && s.flags.bdFail && s.t - s.flags.bdFail < 8],
    ['coil', 'MAGNET\nTEMP HIGH', 1, s => s.mag.tfOn && s.mag.coilT > 24],
    ['quench', 'TF COIL\nQUENCH', 1, s => s.mag.quench],
    ['cryo', 'CRYOPLANT\nNOT RUNNING', 2, s => !s.mag.cryoOn && s.mag.BT > 0.1],
    ['vac', 'VESSEL\nPRESSURE HIGH', 1, s => s.vac.P > 0.5 && (!s.pl.on || s.malf.lova)],
    ['fw', 'FIRST WALL\nTEMP HIGH', 1, s => s.htx.Tfw > 450],
    ['flow', 'PHTS FLOW\nLOW', 1, s => (s.htx.fA + s.htx.fB) / 2 < 0.6 && (s.pl.on || s.htx.DH > 3)],
    ['prz', 'PRIMARY\nPRESSURE HIGH', 2, s => s.htx.prz > 16.6],
    ['sglo', 'SG LEVEL\nLOW', 1, s => s.htx.sgL < 30],
    ['sghi', 'SG LEVEL\nHIGH', 2, s => s.htx.sgL > 75],
    ['sgp', 'STEAM RELIEF\nVALVES OPEN', 2, s => s.htx.relief > 0],
    ['cond', 'CONDENSER\nVACUUM LOW', 2, s => s.htx.Pc > 15],
    ['ttrip', 'TURBINE\nTRIPPED', 2, s => s.tg.tripped && (s.tg.rpm > 50 || s.pl.on)],
    ['vib', 'TURBINE\nVIBRATION', 1, s => s.tg.vib > 7.1],
    ['crit', 'CRITICAL\nSPEED BAND', 2, s => s.tg.bandTime > 4],
    ['ospd', 'TURBINE\nOVERSPEED', 1, s => s.tg.rpm > 3200],
    ['freq', 'GRID\nFREQUENCY', 1, s => Math.abs(s.grid.f - 50) > 0.2],
    ['ufls', 'UFLS LOAD\nSHEDDING', 1, s => s.grid.shedBlocks > 0],
    ['dev', 'DISPATCH\nDEVIATION', 3, s => s.grid.devTime > 30],
    ['tstore', 'TRITIUM\nSTORE LOW', 2, s => s.tri.store < 200],
    ['isp', 'TRITIUM\nPLANT OFF', 2, s => !s.tri.ispCmd && s.pl.on && s.fuel.blend === 'DT'],
    ['dms', 'DMS\nDISARMED', 1, s => !s.safety.dmsArmed && s.pl.on],
    ['dmg', 'FIRST WALL\nDAMAGE', 2, s => s.dmg.fw > 10 || s.dmg.div > 10]
  ].map(([id, text, pri, cond]) => ({ id, text, pri, cond }));

  function activeAlarms(s) {
    const out = {};
    for (const a of ALARMS) {
      let on = false;
      try { on = !!a.cond(s); } catch (e) { on = false; }
      out[a.id] = on;
    }
    return out;
  }

  // Trip matrix for the SCADA "PROTECTION" page
  function tripMatrix(s) {
    const h = s.htx, tg = s.tg, d = s.d, m = s.mag, g = s.grid;
    const row = (id, name, value, unit, setpoint, dir, action, fmt) => {
      const v = value;
      const trip = dir === '>' ? v >= setpoint : v <= setpoint;
      const warn = dir === '>' ? v >= setpoint * 0.9 : v <= setpoint * 1.15;
      return { id, name, value: fmt ? fmt(v) : v, unit, setpoint, dir, action, state: trip ? 'TRIP' : warn ? 'PRE-TRIP' : 'NORMAL' };
    };
    return [
      row('CSS-01', 'First wall temperature', h.Tfw, '°C', 520, '>', 'FPSS', v => v.toFixed(0)),
      row('CSS-02', 'PHTS coolant flow', (h.fA + h.fB) / 2 * 100, '%', 25, '<', 'FPSS', v => v.toFixed(0)),
      row('CSS-03', 'SG level (heat sink)', h.sgL, '%', 12, '<', 'FPSS + TURB TRIP', v => v.toFixed(1)),
      row('CSS-04', 'TF coil temperature', m.coilT, 'K', 30, '>', 'FAST DISCHARGE + FPSS', v => v.toFixed(1)),
      row('CSS-05', 'Primary pressure', h.prz, 'MPa', 17.5, '>', 'FPSS', v => v.toFixed(2)),
      row('PPS-01', 'Plasma vertical position', Math.abs(s.pl.z) * 100, 'cm', 60, '>', 'DMS FIRE', v => v.toFixed(1)),
      row('PPS-02', 'Normalised beta βN', d.betaN || 0, '', 5.6, '>', 'DMS FIRE', v => v.toFixed(2)),
      row('PPS-03', 'Greenwald fraction', d.fG || 0, '', 1.35, '>', 'DMS FIRE', v => v.toFixed(2)),
      row('PPS-04', 'Electron density (NBI)', (d.ne || 0) / 1e19, '10¹⁹', 1.0, '<', 'NBI TRIP', v => v.toFixed(2)),
      row('PPS-05', 'CS flux remaining', m.flux, 'Wb', 0, '<', 'RAMP-DOWN', v => v.toFixed(0)),
      row('TPS-01', 'Turbine speed', tg.rpm, 'rpm', 3300, '>', 'TURB TRIP', v => v.toFixed(0)),
      row('TPS-02', 'Condenser pressure', h.Pc, 'kPa', 25, '>', 'TURB TRIP', v => v.toFixed(1)),
      row('TPS-03', 'SG level high', h.sgL, '%', 85, '>', 'TURB TRIP', v => v.toFixed(1)),
      row('TPS-04', 'Bearing vibration', tg.vib, 'mm/s', 11, '>', 'TURB TRIP', v => v.toFixed(1)),
      row('GPS-01', 'Grid frequency', g.f, 'Hz', 51.5, '>', '52G OPEN', v => v.toFixed(3)),
      row('UFLS', 'Grid frequency (UFLS)', g.f, 'Hz', 49.2, '<', 'SHED DISTRICT', v => v.toFixed(3))
    ];
  }

  const api = {
    MACHINE, SUN, KEV, MK_PER_KEV, ATOMS_PER_PAM3, G_PER_T_ATOM,
    sigmavDT, sigmavDDn, sigmavDDp, sigmavPP, tSat, demandAt,
    createState, step, derive, command, breakdownPermissives, syncCheck,
    activeAlarms, ALARMS, tripMatrix, fmtClock, houseLoad
  };
  root.HeliosEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
