/**
 * The tools, and what each does to what you point it at.
 *
 * Turning tools need the right socket or bit for the fastener (a 17 mm socket will not go on a 19 mm
 * nut). Hand tools turn as far as you move them (the mouse, dragged with the button held); power
 * tools turn while you hold the trigger. Each gives at most its own torque (sim/fastener.js): what
 * is rusted on needs the breaker bar, penetrating oil and patience. The torque wrench clicks at its
 * setting. A wheel in the air turns with its nut unless something holds it (the handbrake, a gear,
 * a foot on the brake) — the impact gun's hammer blows do not need that.
 *
 * Measuring tools read what the simulation says the part is: the tread depth gauge, the tyre gauge
 * and air line, the disc micrometer, the vernier for pads, feeler gauges for spark plugs, the
 * multimeter, the OBD scan tool, the Volvo's diagnostic lead, the brake fluid tester, the mechanic's
 * stethoscope, the pry bar for play in joints.
 */
import { TOOL_TORQUE, turn, soak, judge } from '../sim/fastener.js';
import { cornerName } from '../sim/vehicle.js';

export const SOCKETS = [7, 8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 30, 32, 36, 41];

export const TOOLS = [
  { id: 'hand', name: 'Hands', key: '1', icon: '✋' },
  { id: 'ratchet', name: '½" ratchet', key: '2', icon: '🔧', socket: true, max: TOOL_TORQUE.ratchet12, manual: true },
  { id: 'breaker', name: 'Breaker bar (600 mm)', key: '3', icon: '⟋', socket: true, max: TOOL_TORQUE.breaker, manual: true },
  { id: 'torque', name: 'Torque wrench', key: '4', icon: '⚙', socket: true, max: TOOL_TORQUE.torqueWrench, manual: true, setting: true },
  { id: 'impact', name: 'Impact gun (air)', key: '5', icon: '🔫', socket: true, max: TOOL_TORQUE.impact, power: true },
  { id: 'driver', name: 'Screwdrivers and bits', key: '6', icon: '🪛', bits: true, max: 25, manual: true },
  { id: 'tread', name: 'Tread depth gauge', key: '7', icon: '📏' },
  { id: 'gauge', name: 'Tyre gauge and air line', key: '8', icon: '◔' },
  { id: 'scanner', name: 'OBD-II scan tool', key: '9', icon: '📟' },
  { id: 'multimeter', name: 'Multimeter', key: '0', icon: '⚡' },
  { id: 'micrometer', name: 'Disc micrometer', icon: '⊢' },
  { id: 'vernier', name: 'Vernier calliper', icon: '⊣' },
  { id: 'feeler', name: 'Feeler gauges', icon: '≡' },
  { id: 'prybar', name: 'Pry bar', icon: '/' },
  { id: 'stethoscope', name: 'Mechanic\'s stethoscope', icon: '🩺' },
  { id: 'tester', name: 'Brake fluid tester', icon: '🖊' },
  { id: 'spray', name: 'Penetrating oil', icon: '🧴' },
  { id: 'oiljug', name: 'Engine oil (5 l can)', icon: '🛢' },
  { id: 'coolantjug', name: 'Coolant (premixed)', icon: '💧' },
  { id: 'bleeder', name: 'Brake bleeding kit and DOT 4', icon: '🩸' },
  { id: 'filter', name: 'Oil filter wrench', icon: '◯', max: 60, manual: true },
  { id: 'diaglead', name: 'Volvo diagnostic lead', icon: '⎓' },
  { id: 'wheelgun', name: 'F1 wheel gun', icon: '🔫', power: true, max: TOOL_TORQUE.wheelGun, socket: true },
  { id: 'gloves', name: 'Insulated HV gloves', icon: '🧤' },
  { id: 'f1jack', name: 'F1 front/rear jacks', icon: '⤒' },
  { id: 'starter', name: 'F1 external starter', icon: '⟳' },
  { id: 'heater', name: 'F1 heater cart', icon: '♨' },
];
export const toolById = (id) => TOOLS.find((t) => t.id === id);

/** Does this tool (with its current socket/bit) fit this fastener? Returns null if it fits, else why not. */
export function fits(tool, socket, f) {
  if (f.drive === 'pin') return tool.id === 'hand' ? null : 'a quick-release pin: pull it by hand';
  if (f.drive === 'filter') return tool.id === 'filter' || tool.id === 'hand' ? null : 'use the oil filter wrench (or your hand)';
  if (f.drive === 'dzus' || f.drive === 'clamp') return tool.id === 'driver' ? null : `a ${f.drive === 'dzus' ? 'quarter-turn fastener' : 'hose clamp'}: a flat screwdriver`;
  if (f.drive === 'torx' || f.drive === 'allen') return tool.id === 'driver' ? null : `a ${f.drive === 'torx' ? 'T' + f.size + ' Torx' : f.size + ' mm hex'} screw: screwdrivers and bits`;
  if (!tool.socket) return tool.id === 'hand' ? `${f.size} mm: needs a spanner or a socket` : `${tool.name} does not turn bolts`;
  if (tool.id === 'wheelgun' && f.size !== 41) return 'the wheel gun only fits the centre-lock nuts';
  if (socket !== f.size) return `${socket} mm socket on a ${f.size} mm ${/nut/.test(f.name) ? 'nut' : 'head'}: wrong size`;
  return null;
}

/**
 * One frame of turning: deg of handle movement (manual) or dt of trigger (power).
 * ctx: { A, S, game } to know whether the wheel turns with its nut.
 */
export function turnStep(tool, f, dir, amount, { A, S, setting }) {
  const max = tool.id === 'hand' ? (f.drive === 'filter' ? 25 : f.drive === 'pin' ? 5 : TOOL_TORQUE.hand) : tool.max;
  const part = A.part(f.partId);
  // a wheel in the air turns with a tight nut unless something holds it
  if (part.kind === 'wheel' && A.state.raised[part.corner] && !tool.power) {
    const hold = S.drag(part.corner) + (A.state.brakePedal ? 800 : 0);
    const need = f.clamp * 0.85 + f.seize;
    if (need > hold && (dir < 0 ? f.clamp > 0.5 : f.clamp >= hold)) {
      S.wheelSpin[part.corner] = dir * 2;
      return { moved: 0, torque: hold, event: 'wheelturns' };
    }
  }
  const deg = tool.power ? amount * (tool.id === 'wheelgun' ? 2400 : 1100) : amount;
  return turn(f, dir, deg, max, { clickAt: tool.setting ? setting : null, impact: !!tool.power });
}

export const EVENT_TEXT = {
  seized: 'It will not move. More leverage (the breaker bar), penetrating oil and a few minutes, or the impact gun.',
  'broke-loose': 'Crack: it broke loose.',
  seated: 'Seated: now torque it.',
  click: 'Click: torque reached.',
  out: 'Out. Into the magnetic tray.',
  stretched: 'It went soft under the wrench: the bolt has stretched. Replace it.',
  snapped: 'SNAP. The bolt sheared.',
  stripped: 'The thread let go: stripped.',
  wheelturns: 'The wheel turns with the nut. Hold it: handbrake, a gear, or someone on the brake (or lower it onto the ground).',
};

/** What a measuring tool reads on a part. Returns { text, finding } or null if it does not apply. */
export function measure(tool, part, game) {
  const { A, S } = game.cust, c = part.cond, k = part.corner, raised = k && A.state.raised[k];
  const cn = k ? cornerName(k) : '';
  const wheelOff = k && A.part('wheel' + k)?.removed;
  const r = (text, finding = true) => ({ text, finding: finding ? `${part.name}: ${text}` : null });
  switch (tool.id) {
    case 'tread':
      if (part.kind !== 'wheel') return null;
      return r(`tread ${c.tread.toFixed(1)} mm (legal minimum 1.6 mm; winter tyres in Sweden 3.0 mm from 1 December)${c.nail ? '. There is a nail in the tread!' : ''}`);
    case 'gauge':
      if (part.kind !== 'wheel') return null;
      return r(`${c.bar.toFixed(2)} bar (placard ${A.spec.wheels.pressure[k[0]]} bar)`);
    case 'micrometer':
      if (part.kind !== 'disc') return null;
      if (!wheelOff) return r('take the wheel off to get the micrometer on the disc', false);
      return r(`${c.t.toFixed(2)} mm thick (new ${c.nominal.toFixed(1)}, minimum ${c.min.toFixed(1)} stamped on it)${c.lip ? ', with a lip at the edge' : ''}${c.scored ? ', deeply scored' : ''}`);
    case 'vernier':
      if (part.kind === 'pad') return part.removed || wheelOff ? r(`${c.mm.toFixed(1)} mm of friction material (new ${c.nominal} mm; change below 3 mm)`) : r('take the wheel off to see the pads', false);
      if (part.kind === 'disc' && wheelOff) return r(`about ${c.t.toFixed(1)} mm (the micrometer is the proper tool)`);
      return null;
    case 'feeler':
      if (part.kind !== 'plug') return null;
      if (!part.removed) return r('take the plug out first', false);
      return r(`gap ${c.gap.toFixed(2)} mm (spec ${c.spec} mm)${c.fouled ? '; the tip is black and oily (fouled)' : ''}${c.wear > 0.8 ? '; the electrodes are rounded off' : ''}`);
    case 'multimeter':
      if (part.kind === 'battery') { const v = S.batteryVolts(); return v == null ? r('the battery is out', false) : r(`${v.toFixed(2)} V across the terminals${S.E.running ? (S.chargeA > 0 ? ' (charging)' : ' with the engine running: not charging!') : S.E.starterAmps > 0 ? ' while cranking' : ' resting'}`); }
      if (part.kind === 'fuse') return part.removed ? r(c.ok ? 'continuity: the fuse is good' : 'open circuit: the fuse is blown') : r('pull the fuse to test it, or probe both its test points', false);
      if (part.kind === 'lead') return part.removed ? r(`${c.ok ? c.resistance.toFixed(1) + ' kΩ (good)' : 'open circuit (broken inside)'}`) : r('pull the lead off to measure it', false);
      if (part.kind === 'coil') return part.removed ? r(c.ok ? 'secondary 7.2 kΩ (good)' : 'secondary open circuit: the coil is dead') : r('pull the coil to measure it', false);
      if (part.kind === 'bulb') return part.removed ? r(c.ok ? 'filament intact' : 'filament open: blown') : r('take the bulb out to test it', false);
      return null;
    case 'tester':
      if (part.kind !== 'reservoir' && part.kind !== 'resvcap') return null;
      if (!A.part('resvcap').removed) return r('take the reservoir cap off first', false);
      return r(`${S.fluidWater().toFixed(1)} % water (change above 3 %)`);
    case 'prybar': {
      if (!['link', 'balljoint', 'hub', 'tierod', 'wheel', 'arm'].includes(part.kind)) return null;
      if (k && !raised) return r('lift the car first', false);
      const j = part.kind === 'wheel' ? A.part('hub' + k) : part;
      const play = j?.cond.play ?? 0;
      return r(play > 0.5 ? `clear play: ${play.toFixed(1)} mm, it knocks` : play > 0.1 ? `slight play (${play.toFixed(2)} mm)` : 'no play');
    }
    case 'stethoscope': {
      if (part.kind === 'hub' || part.kind === 'wheel' || part.kind === 'knuckle') { const h = A.part('hub' + k); return r(h?.cond.rough > 0.3 ? 'a gritty rumble as the wheel turns: the bearing' : 'smooth'); }
      if (['engine', 'plug', 'coil', 'lead', 'manifold'].includes(part.kind) || part.sys === 'ignition') return S.E.running ? r(S.roughness > 12 ? 'an uneven beat: one cylinder is missing' : 'an even beat, the injectors ticking') : r('start the engine to listen', false);
      if (part.kind === 'belt' || part.kind === 'alternator' || part.kind === 'tensioner') return S.E.running ? r(A.part('belt').cond.glazed ? 'the belt squeals and slips on the alternator pulley' : 'a smooth whirr') : r('start the engine to listen', false);
      if (part.kind === 'vachose') return S.E.running ? r(part.cond.split ? 'a loud hiss: air leaking in' : 'nothing') : r('start the engine to listen', false);
      return r('nothing unusual', false);
    }
    case 'diaglead':
      if (part.kind !== 'diag') return null;
      { const d = S.pressDiag(game.diagSocket ?? 2); return d.error ? r(d.error, false) : r(`socket ${game.diagSocket ?? 2}: the LED flashes ${d.code} — ${d.text}`); }
    default: return null;
  }
}

/** How a fastener reads on the torque wrench, for the HUD. */
export function fastenerStatus(f) {
  if (f.snapped) return 'sheared';
  if (f.out) return 'out';
  const j = judge(f);
  return `${f.engaged < f.len - 0.01 ? `${(f.len - f.engaged).toFixed(1)} turns out` : `${Math.round(f.clamp)} N·m`} (spec ${f.spec}${f.specAngle ? ` + ${f.specAngle}°` : ''} N·m${j === 'ok' ? ', ok' : j === 'loose' ? ', loose' : j === 'tight' ? ', over' : ''})`;
}

/** Soaks a fastener in penetrating oil (minutes of game time do the rest). */
export function spray(f) { f.oiled = Math.max(f.oiled, 0.05); f.spraying = true; }
export { soak };
