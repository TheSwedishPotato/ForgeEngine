/**
 * Every control a hand can work, where it is, and how it is worked. Boat coordinates (m): x
 * forward of frame 66 1/2, y above the keel, z to starboard. "face": the way the person stands
 * to work it. Positions follow the order the Fleet Type Submarine (3A4, 3A7 - 3A10, 6C13) lists
 * the fittings, compartment by compartment; the exact spots are estimates.
 *
 * kind:
 *  valve      a handwheel: value 0 (shut) .. 1 (open), `turns` turns end to end, a man turning
 *             `rate` turns a second
 *  lever      a lever thrown between `states` (each throw ~0.6 s)
 *  switch     on / off (or a push-button controller)
 *  wheel      a big wheel whose angle is a command (the planes, the helm): degrees
 *  rheostat   a field rheostat wheel: 0..1
 *  telegraph  the engine order telegraph: one of `states`
 *  door       a watertight door: 0 shut and dogged .. 1 wide open
 *  hatch      a hatch: 0 shut and dogged .. 1 open
 *  button     a push button held for a time (the alarms)
 */
import { DECK, LEVELS, DOOR_LIST, HATCHES, OBS_DECK, frameX } from './layout.js';

const D = DECK;
const C = [];
const add = (c) => { C.push({ size: 0.06, turns: 0, rate: 1, init: 0, ...c }); };

// ---------------------------------------------------------------------------------------------
// CONTROL ROOM, port side, forward to aft: the negative tank's inboard vent, the hydraulic
// manifold, the diving station, the trim manifold.
const P = -1.82, S = 1.82;
add({ id: 'cr.negVentInboard', label: 'negative tank inboard vent', comp: 'cr', pos: [13.45, D + 1.25, P], face: 'port', kind: 'valve', turns: 0.25, rate: 0.5, size: 0.08 });

// the hydraulic manifold: a bank of levers, each driving a ram (vents, floods, induction)
const HM = [
  ['hm.vent.bb', 'bow buoyancy vent'], ['hm.vent.1', 'No. 1 main vent'], ['hm.vent.2', 'No. 2 main vents'], ['hm.vent.3', 'No. 3 vents (F.B.T.)'],
  ['hm.vent.4', 'No. 4 main vents'], ['hm.vent.5', 'No. 5 vents (F.B.T.)'], ['hm.vent.6', 'No. 6 main vents'], ['hm.vent.7', 'No. 7 main vent'],
  ['hm.vent.safety', 'safety tank vent'], ['hm.flood.safety', 'safety tank flood valves'], ['hm.flood.negative', 'negative tank flood valve'],
  ['hm.induction', 'main induction and ship\'s supply'], ['hm.hullVent', 'hull ventilation outboard'],
];
HM.forEach(([id, label], i) => add({ id, label, comp: 'cr', pos: [13.25 - i * 0.075, D + 1.05, P + 0.08], face: 'port', kind: 'lever', states: ['shut', 'open'], init: 'shut', size: 0.03, group: 'hydraulicManifold' }));

// the diving station: the bow planes' wheel forward, the stern planes' aft; the planesmen sit facing outboard
add({ id: 'cr.bowPlanes', label: 'bow planes', comp: 'cr', pos: [11.95, D + 1.05, -1.42], face: 'port', kind: 'wheel', min: -25, max: 25, rate: 12, size: 0.4, init: 0, seat: true });
add({ id: 'cr.sternPlanes', label: 'stern planes', comp: 'cr', pos: [11.10, D + 1.05, -1.42], face: 'port', kind: 'wheel', min: -25, max: 25, rate: 12, size: 0.4, init: 0, seat: true });
add({ id: 'cr.bowPlanesRig', label: 'bow plane rigging', comp: 'cr', pos: [11.52, D + 1.30, -1.78], face: 'port', kind: 'lever', states: ['in', 'out'], init: 'in', size: 0.04 });
add({ id: 'cr.divingAlarm', label: 'diving alarm (control room)', comp: 'cr', pos: [12.35, D + 1.45, -1.80], face: 'port', kind: 'button', size: 0.03 });

// the trim manifold: for each tank and the sea, a valve to the suction line and one to the discharge
const TRIM = ['fwdTrim', 'fwdWRT', 'aux1', 'aux2', 'aftWRT', 'aftTrim', 'negative', 'safety', 'sea'];
const TRIM_NAME = { fwdTrim: 'forward trim', fwdWRT: 'forward W.R.T.', aux1: 'auxiliary No. 1', aux2: 'auxiliary No. 2', aftWRT: 'after W.R.T.', aftTrim: 'after trim', negative: 'negative', safety: 'safety', sea: 'sea' };
TRIM.forEach((t, i) => {
  add({ id: `tm.suction.${t}`, label: `trim manifold: ${TRIM_NAME[t]} to suction`, comp: 'cr', pos: [10.55 - i * 0.12, D + 0.95, P + 0.12], face: 'port', kind: 'valve', turns: 1.5, rate: 1.4, size: 0.035, group: 'trimManifold' });
  add({ id: `tm.discharge.${t}`, label: `trim manifold: ${TRIM_NAME[t]} to discharge`, comp: 'cr', pos: [10.55 - i * 0.12, D + 1.25, P + 0.12], face: 'port', kind: 'valve', turns: 1.5, rate: 1.4, size: 0.035, group: 'trimManifold' });
});
add({ id: 'tm.pump', label: 'trim pump', comp: 'cr', pos: [9.30, D + 1.45, P + 0.05], face: 'port', kind: 'switch', size: 0.025 });
add({ id: 'tm.priming', label: 'trim pump priming pump', comp: 'cr', pos: [9.30, D + 1.32, P + 0.05], face: 'port', kind: 'switch', size: 0.025 });

// starboard side, forward to aft: I.C. switchboard, high-pressure air manifold, 225-lb, 600-lb and 10-lb manifolds
add({ id: 'cr.lights', label: 'lighting: white / red', comp: 'cr', pos: [13.35, D + 1.35, S], face: 'stbd', kind: 'lever', states: ['white', 'red'], init: 'white', size: 0.03 });
for (let b = 1; b <= 5; b++) add({ id: `hp.bank${b}`, label: `No. ${b} air bank stop`, comp: 'cr', pos: [12.85 - (b - 1) * 0.11, D + 1.55, S - 0.1], face: 'stbd', kind: 'valve', turns: 3, rate: 1.2, size: 0.03, init: 1, group: 'hpManifold' });
add({ id: 'hp.blow.safety', label: 'blow safety', comp: 'cr', pos: [12.80, D + 1.20, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.5, size: 0.035, group: 'hpManifold' });
add({ id: 'hp.blow.negative', label: 'blow negative', comp: 'cr', pos: [12.65, D + 1.20, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.5, size: 0.035, group: 'hpManifold' });
add({ id: 'hp.blow.bb', label: 'blow bow buoyancy', comp: 'cr', pos: [12.50, D + 1.20, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.5, size: 0.035, group: 'hpManifold' });
add({ id: 'hp.hammer1', label: 'No. 1 hammer valve (to the 600-lb manifold)', comp: 'cr', pos: [12.30, D + 1.35, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.0, size: 0.05, group: 'hpManifold' });
add({ id: 'hp.hammer2', label: 'No. 2 hammer valve', comp: 'cr', pos: [12.15, D + 1.35, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.0, size: 0.05, group: 'hpManifold' });
add({ id: 'hp.bleed', label: 'high-pressure bleed into the boat', comp: 'cr', pos: [12.00, D + 1.05, S - 0.12], face: 'stbd', kind: 'valve', turns: 1, rate: 1.0, size: 0.025, group: 'hpManifold' });
add({ id: 'hp.startAir', label: 'starting air to the engine rooms', comp: 'cr', pos: [11.85, D + 1.05, S - 0.12], face: 'stbd', kind: 'valve', turns: 2, rate: 1.0, size: 0.03, init: 1, group: 'hpManifold' });
const GROUPS = ['1', '2', '3', '4', '5', '6', '7'];
GROUPS.forEach((g, i) => add({ id: `mbt.blow.${g}`, label: `600-lb blow, No. ${g}${g === '3' || g === '5' ? ' (F.B.T.)' : ''}`, comp: 'cr', pos: [11.30 - i * 0.10, D + 1.15, S - 0.12], face: 'stbd', kind: 'valve', turns: 1.5, rate: 1.4, size: 0.03, group: 'mbtManifold' }));
GROUPS.forEach((g, i) => add({ id: `lp.blow.${g}`, label: `10-lb blow, No. ${g}`, comp: 'cr', pos: [10.45 - i * 0.10, D + 1.05, S - 0.12], face: 'stbd', kind: 'valve', turns: 1.5, rate: 1.4, size: 0.035, group: 'lpManifold' }));
add({ id: 'lp.blower', label: 'low-pressure blower', comp: 'cr', pos: [9.65, D + 1.40, S - 0.05], face: 'stbd', kind: 'switch', size: 0.025 });
add({ id: 'cr.o2', label: 'oxygen bleed from the flasks', comp: 'cr', pos: [8.90, D + 1.85, 0.95], face: 'stbd', kind: 'valve', turns: 1, rate: 0.8, size: 0.025 });

// centreline: the steering stand and the master gyro forward, the periscope wells, the ladder up
add({ id: 'cr.helm', label: 'steering wheel (control room)', comp: 'cr', pos: [13.25, D + 1.20, 0.45], face: 'fwd', kind: 'wheel', min: -35, max: 35, rate: 18, size: 0.3, init: 0 });
add({ id: 'cr.steerSel', label: 'steering: conning tower / control room', comp: 'cr', pos: [13.40, D + 0.95, 0.80], face: 'fwd', kind: 'lever', states: ['ct', 'cr'], init: 'ct', size: 0.03 });

// ---------------------------------------------------------------------------------------------
// PUMP ROOM (below the control room)
const PR = LEVELS.pump.y;
add({ id: 'pr.series', label: 'trim pump: series / parallel', comp: 'cr', level: 'pump', pos: [8.6, PR + 0.85, -1.05], face: 'port', kind: 'lever', states: ['parallel', 'series'], init: 'parallel', size: 0.04 });
add({ id: 'pr.drain', label: 'drain pump', comp: 'cr', level: 'pump', pos: [9.8, PR + 1.1, 1.0], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'pr.imo1', label: 'No. 1 hydraulic pump (IMO)', comp: 'cr', level: 'pump', pos: [12.1, PR + 1.1, -0.95], face: 'port', kind: 'switch', size: 0.03, init: 1 });
add({ id: 'pr.imo2', label: 'No. 2 hydraulic pump (IMO)', comp: 'cr', level: 'pump', pos: [11.8, PR + 1.1, -0.95], face: 'port', kind: 'switch', size: 0.03 });
add({ id: 'pr.comp1', label: 'No. 1 high-pressure air compressor', comp: 'cr', level: 'pump', pos: [10.6, PR + 1.1, 1.0], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'pr.comp2', label: 'No. 2 high-pressure air compressor', comp: 'cr', level: 'pump', pos: [10.2, PR + 1.1, 1.0], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'pr.negFloodHand', label: 'negative flood, hand gear', comp: 'cr', level: 'pump', pos: [12.6, PR + 0.9, -0.6], face: 'port', kind: 'valve', turns: 8, rate: 0.8, size: 0.12 });

// ---------------------------------------------------------------------------------------------
// CONNING TOWER and BRIDGE
const CT = LEVELS.ct.y;
add({ id: 'ct.helm', label: 'steering wheel (conning tower)', comp: 'ct', level: 'ct', pos: [12.15, CT + 1.15, 0.0], face: 'fwd', kind: 'wheel', min: -35, max: 35, rate: 18, size: 0.32, init: 0 });
add({ id: 'ct.telegraph.port', label: 'port engine order telegraph', comp: 'ct', level: 'ct', pos: [12.25, CT + 1.25, -0.55], face: 'fwd', kind: 'telegraph', states: ['backEmergency', 'backFull', 'back2', 'back1', 'stop', 'ahead1', 'ahead2', 'standard', 'full', 'flank'], init: 'stop', size: 0.05 });
add({ id: 'ct.telegraph.stbd', label: 'starboard engine order telegraph', comp: 'ct', level: 'ct', pos: [12.25, CT + 1.25, 0.55], face: 'fwd', kind: 'telegraph', states: ['backEmergency', 'backFull', 'back2', 'back1', 'stop', 'ahead1', 'ahead2', 'standard', 'full', 'flank'], init: 'stop', size: 0.05 });
add({ id: 'ct.divingAlarm', label: 'diving alarm (conning tower)', comp: 'ct', level: 'ct', pos: [11.95, CT + 1.40, -0.85], face: 'port', kind: 'button', size: 0.03 });
add({ id: 'ct.scope1', label: 'No. 1 periscope hoist', comp: 'ct', level: 'ct', pos: [10.85, CT + 1.30, 0.35], face: 'aft', kind: 'switch', size: 0.03 });
add({ id: 'ct.scope2', label: 'No. 2 periscope hoist', comp: 'ct', level: 'ct', pos: [9.75, CT + 1.30, 0.35], face: 'aft', kind: 'switch', size: 0.03 });
const BR = LEVELS.bridge.y;
add({ id: 'br.divingAlarm', label: 'diving alarm (bridge)', comp: 'bridge', level: 'bridge', pos: [11.0, BR + 1.05, -0.55], face: 'fwd', kind: 'button', size: 0.03 });

// ---------------------------------------------------------------------------------------------
// HATCHES and DOORS
for (const h of HATCHES) {
  const level = h.id === 'ctUpper' ? 'ct' : 'main';
  const y = h.id === 'ctUpper' ? CT + 2.15 : h.id === 'galley' ? D + 2.15 : D + 2.2;
  add({ id: `hatch.${h.id}`, label: h.name, comp: compOf(h.x), level, pos: [h.x, y, 0], face: 'up', kind: 'hatch', size: 0.2, init: 0, hatch: h.id });
}
for (const d of DOOR_LIST) add({ id: `door.${d.i}`, label: `watertight door, ${d.between[0]} - ${d.between[1]}`, comp: d.between[0], pos: [d.x, D + 0.95, 0.3], face: 'aft', kind: 'door', size: 0.15, init: 1, door: d.i });

// ---------------------------------------------------------------------------------------------
// ENGINE ROOMS: each engine's control stand at its forward end, its valves
const ENG = [
  { n: 1, comp: 'fer', x: -9.0, z: 0.72 }, { n: 2, comp: 'fer', x: -9.0, z: -0.72 },
  { n: 3, comp: 'aer', x: -17.1, z: 0.72 }, { n: 4, comp: 'aer', x: -17.1, z: -0.72 },
];
for (const e of ENG) {
  const s = Math.sign(e.z), face = s > 0 ? 'stbd' : 'port';
  add({ id: `eng${e.n}.lever`, label: `No. ${e.n} main engine control lever`, comp: e.comp, pos: [e.x, D + 1.05, e.z], face, kind: 'lever', states: ['stop', 'start', 'run'], init: 'stop', size: 0.05, engine: e.n });
  add({ id: `eng${e.n}.standbyLube`, label: `No. ${e.n} standby lube oil pump`, comp: e.comp, pos: [e.x + 0.45, D + 1.35, e.z + 0.2 * s], face, kind: 'switch', size: 0.03, engine: e.n });
  add({ id: `eng${e.n}.seaSuction`, label: `No. ${e.n} engine sea suction`, comp: e.comp, pos: [e.x - 0.6, D + 0.35, e.z - 0.1 * s], face, kind: 'valve', turns: 6, rate: 1.2, size: 0.07, engine: e.n });
  add({ id: `eng${e.n}.exhaustIn`, label: `No. ${e.n} inboard exhaust valve`, comp: e.comp, pos: [e.x - 5.4, D + 1.95, e.z * 0.85], face: 'aft', kind: 'valve', turns: 8, rate: 1.0, size: 0.09, engine: e.n });
  add({ id: `eng${e.n}.exhaustOut`, label: `No. ${e.n} outboard exhaust valve`, comp: e.comp, pos: [e.x - 6.0, D + 1.95, e.z * 0.85], face: 'aft', kind: 'valve', turns: 10, rate: 1.0, size: 0.09, engine: e.n });
}
add({ id: 'fer.induction', label: 'forward engine room air induction hull valve', comp: 'fer', pos: [-8.4, D + 2.0, 0.0], face: 'fwd', kind: 'valve', turns: 12, rate: 1.1, size: 0.15 });
add({ id: 'aer.induction', label: 'after engine room air induction hull valve', comp: 'aer', pos: [-16.4, D + 2.0, 0.0], face: 'fwd', kind: 'valve', turns: 12, rate: 1.1, size: 0.15 });
add({ id: 'fer.hullSupply', label: 'hull ventilation supply valve', comp: 'fer', pos: [-8.8, D + 2.0, 0.45], face: 'fwd', kind: 'valve', turns: 8, rate: 1.2, size: 0.12 });
add({ id: 'fer.ventBlowers', label: 'ship\'s supply and exhaust blowers', comp: 'fer', pos: [-8.2, D + 1.45, 1.25], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'aux.lever', label: 'auxiliary engine control lever', comp: 'aer', pos: [-22.6, D + 1.0, -0.55], face: 'port', kind: 'lever', states: ['stop', 'start', 'run'], init: 'stop', size: 0.05, engine: 0 });
add({ id: 'aux.exhaust', label: 'auxiliary engine exhaust valve', comp: 'aer', pos: [-23.1, D + 1.6, -0.6], face: 'port', kind: 'valve', turns: 6, rate: 1.1, size: 0.07, engine: 0 });
add({ id: 'aux.seaSuction', label: 'auxiliary engine sea suction', comp: 'aer', pos: [-22.9, D + 0.35, -0.5], face: 'port', kind: 'valve', turns: 5, rate: 1.2, size: 0.06, engine: 0 });

// ---------------------------------------------------------------------------------------------
// MANEUVERING ROOM: the main propulsion control cubicle, athwartships, its operators facing aft
const MX = -28.75, MY = D + 0.95;
const LEVERS = [
  ['man.gen.4', 'No. 4 generator', ['off', 'motorBus', 'batBus']], ['man.gen.2', 'No. 2 generator', ['off', 'motorBus', 'batBus']],
  ['man.reverse.port', 'port motors reverse lever', ['astern', 'off', 'ahead']], ['man.starter.port', 'port motors starter', ['stop', 'ser1', 'ser2', 'ser3', 'par1', 'par2']],
  ['man.batSel', 'battery selector', ['off', 'aft', 'fwd', 'both']], ['man.busSel', 'bus selector', ['tieClosed', 'tieOpen', 'off', 'batBus', 'slow']],
  ['man.starter.stbd', 'starboard motors starter', ['stop', 'ser1', 'ser2', 'ser3', 'par1', 'par2']], ['man.reverse.stbd', 'starboard motors reverse lever', ['astern', 'off', 'ahead']],
  ['man.gen.1', 'No. 1 generator', ['off', 'motorBus', 'batBus']], ['man.gen.3', 'No. 3 generator', ['off', 'motorBus', 'batBus']],
];
const LEVER_INIT = { 'man.batSel': 'both', 'man.busSel': 'off', 'man.reverse.port': 'off', 'man.reverse.stbd': 'off' };
LEVERS.forEach(([id, label, states], i) => add({ id, label, comp: 'man', pos: [MX, MY, -0.9 + i * 0.2], face: 'aft', kind: 'lever', states, init: LEVER_INIT[id] ?? states[0], size: 0.035, group: 'cubicle' }));
[['man.genField.4', -0.85], ['man.genField.2', -0.62], ['man.motorField.port', -0.3], ['man.motorField.stbd', 0.3], ['man.genField.1', 0.62], ['man.genField.3', 0.85]].forEach(([id, z]) =>
  add({ id, label: id.includes('motor') ? `${id.endsWith('port') ? 'port' : 'starboard'} motor field rheostat` : `No. ${id.slice(-1)} generator field rheostat`, comp: 'man', pos: [MX + 0.05, MY + 0.42, z], face: 'aft', kind: 'rheostat', rate: 0.25, size: 0.06, init: id.includes('motor') ? 1 : 0, group: 'cubicle' }));
for (let n = 1; n <= 4; n++) add({ id: `man.engSpeed.${n}`, label: `No. ${n} engine governor control`, comp: 'man', pos: [-26.6, D + 1.35, 1.55 - (n - 1) * 0.0], face: 'stbd', kind: 'rheostat', rate: 0.15, size: 0.03, init: 1, group: 'governor', offset: n });
add({ id: 'man.answer.port', label: 'port telegraph answer', comp: 'man', pos: [MX + 0.02, MY + 0.75, -0.35], face: 'aft', kind: 'telegraph', states: ['backEmergency', 'backFull', 'back2', 'back1', 'stop', 'ahead1', 'ahead2', 'standard', 'full', 'flank'], init: 'stop', size: 0.04 });
add({ id: 'man.answer.stbd', label: 'starboard telegraph answer', comp: 'man', pos: [MX + 0.02, MY + 0.75, 0.35], face: 'aft', kind: 'telegraph', states: ['backEmergency', 'backFull', 'back2', 'back1', 'stop', 'ahead1', 'ahead2', 'standard', 'full', 'flank'], init: 'stop', size: 0.04 });
add({ id: 'man.auxGen', label: 'auxiliary generator to the line', comp: 'man', pos: [-29.6, D + 1.30, 1.45], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'man.batFans.fwd', label: 'forward battery ventilation blowers', comp: 'man', pos: [-29.6, D + 1.55, 1.45], face: 'stbd', kind: 'switch', size: 0.03, init: 1 });
add({ id: 'man.batFans.aft', label: 'after battery ventilation blowers', comp: 'man', pos: [-29.6, D + 1.70, 1.45], face: 'stbd', kind: 'switch', size: 0.03, init: 1 });

// ---------------------------------------------------------------------------------------------
// AFTER BATTERY, TORPEDO ROOMS, THE OBSERVATION DECK
add({ id: 'abr.safetyVentInboard', label: 'safety tank inboard vent', comp: 'abr', pos: [4.4, D + 1.4, -1.6], face: 'port', kind: 'valve', turns: 3, rate: 1.2, size: 0.05 });
add({ id: 'ftr.bbVentHand', label: 'bow buoyancy vent, hand gear', comp: 'ftr', pos: [32.6, D + 1.2, -0.85], face: 'port', kind: 'valve', turns: 10, rate: 0.9, size: 0.12 });
add({ id: 'ftr.mbt1VentHand', label: 'No. 1 main vent, hand gear', comp: 'ftr', pos: [30.6, D + 1.2, 0.85], face: 'stbd', kind: 'valve', turns: 10, rate: 0.9, size: 0.12 });
const OB = LEVELS.obs.y;
add({ id: 'obs.floodlights', label: 'observation deck floodlights', comp: 'obs', level: 'obs', pos: [OBS_DECK.x + 1.2, OB + 1.0, 0.7], face: 'stbd', kind: 'switch', size: 0.03 });
add({ id: 'obs.lamps', label: 'observation deck lamps', comp: 'obs', level: 'obs', pos: [OBS_DECK.x + 1.2, OB + 1.12, 0.7], face: 'stbd', kind: 'switch', size: 0.03, init: 1 });

export const CONTROLS = C;
export const CONTROL = Object.fromEntries(C.map((c) => [c.id, c]));
for (const c of C) c.level ??= 'main';

function compOf(x) {
  const order = [['ftr', frameX(35)], ['fbr', frameX(47, 9)], ['cr', frameX(58, 3)], ['abr', frameX(77, 7.25)], ['fer', frameX(88, -6.25)], ['aer', frameX(99, -13.5)], ['man', frameX(107)], ['atr', -1e9]];
  for (const [id, x1] of order) if (x >= x1) return id;
  return 'atr';
}

export { TRIM, GROUPS };
