// Where every control the pilots operate sits on the A320 flight deck (aircraft frame: x right, y up
// from the cabin floor, z aft), and how long a human hand takes to get there.
//
// Layout (FCOM flight-deck description): glareshield with the FCU in the middle and an EFIS control
// panel at each end; main panel with PFD/ND per pilot and the E/WD over the SD in the centre, the
// landing-gear lever right of the SD with the autobrake push-buttons between them; pedestal with the
// two MCDUs and the ECAM control panel forward, then the RMPs/ACPs, the thrust levers with speed
// brake (left) and flaps (right), the pitch-trim wheels, and aft the engine masters with ENG MODE,
// rudder trim, parking-brake handle and transponder; overhead with the systems panels.
//
// Nothing in the cockpit changes until a hand has got to its control: crew.press() queues the job on
// the pilot's hand, the reach time follows Fitts' law with human spread, and the change is applied
// at the moment of contact. The flight deck poses the pilot's arm on the same target.

export const CONTROLS = {
  // pedestal
  thrust: [0, 0.82, -5.12], parkBrake: [0, 0.68, -4.62], engMaster0: [-0.045, 0.68, -4.9], engMaster1: [0.045, 0.68, -4.9],
  engMode: [0, 0.68, -4.82], flaps: [0.16, 0.76, -5.28], speedbrake: [-0.16, 0.76, -5.28], rudderTrim: [0, 0.68, -4.7],
  xpdr: [0.13, 0.68, -4.72], wxr: [-0.13, 0.68, -4.72], rmpC: [-0.15, 0.68, -5.38], rmpF: [0.15, 0.68, -5.38],
  mcduC: [-0.17, 0.38, -5.34], mcduF: [0.17, 0.38, -5.34], ecp: [0, 0.4, -5.36],
  // centre panel: gear lever right of the SD, autobrake between them
  gear: [0.25, 0.52, -5.52], autobrake: [0.155, 0.545, -5.56],
  // glareshield: FCU knobs and push-buttons, EFIS panels
  fcuSpd: [-0.3, 0.9, -5.45], fcuHdg: [-0.13, 0.9, -5.45], fcuAp: [0.0, 0.9, -5.45], fcuAlt: [0.14, 0.9, -5.45], fcuVs: [0.28, 0.9, -5.45],
  fcuAppr: [0.07, 0.89, -5.45], efisC: [-0.62, 0.9, -5.45], efisF: [0.62, 0.9, -5.45],
  // overhead (forward, lower rows are nearest the windshield)
  ovhSigns: [0.1, 1.6, -5.0], ovhExtLt: [-0.05, 1.6, -5.02], ovhApu: [0.06, 1.66, -4.86], ovhBleed: [0.12, 1.68, -4.78],
  ovhAntiIce: [-0.08, 1.66, -4.88], ovhFuel: [0, 1.7, -4.72], ovhElec: [0.18, 1.7, -4.7],
  // the sidestick's own take-over push-button: the hand is already there
  stick: null,
};

// Fitts' law movement time (a + b log2(D/W + 1)) with the pointing figures typical of reaching for a
// switch in a cockpit: a = 0.2 s, b = 0.14 s/bit, target width 2 cm.
export function reachTime(d, r) {
  const t = 0.2 + 0.14 * Math.log2(d / 0.02 + 1);
  return r ? r.human(t, 0.2) : t;
}

// Which of a pilot's hands goes: the one on the side of the control (the captain sits left, so the
// pedestal and the FCU are worked with his right hand)
export function handFor(pilotX, target) {
  if (!target) return pilotX < 0 ? 'l' : 'r';
  return target[0] > pilotX + 0.12 ? 'r' : target[0] < pilotX - 0.12 ? 'l' : pilotX < 0 ? 'r' : 'l';
}

// Two-bone arm pose (upper arm a, forearm + hand b) that puts the hand on a target, from the shoulder
// position; returns shoulder and elbow angles in the humans.js pose convention (negative x = flexion
// forward, z = abduction, mirrored for the left arm).
export function armPose(shoulder, target, side, a = 0.3, b = 0.38) {
  const dx = target[0] - shoulder[0], dy = target[1] - shoulder[1], dz = target[2] - shoulder[2];
  const L = Math.min(Math.hypot(dx, dy, dz), (a + b) * 0.995);
  const f = -dz, u = dy, l = side === 'r' ? dx : -dx;       // forward, up, outward
  const cosE = (a * a + b * b - L * L) / (2 * a * b);
  const elbow = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE)));
  const cosA = (a * a + L * L - b * b) / (2 * a * L);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const pitch = Math.atan2(f, -u);                            // 0 = hanging down, pi/2 = forward, pi = up
  const abd = Math.atan2(l, Math.hypot(f, u));
  const sh = [-(pitch - alpha * 0.8), 0, (side === 'r' ? 1 : -1) * abd];
  const el = [-elbow, side === 'r' ? -0.2 : 0.2, 0];
  return side === 'r' ? { rShoulder: sh, rElbow: el, rWrist: [0.2, 0, 0] } : { lShoulder: sh, lElbow: el, lWrist: [0.2, 0, 0] };
}
