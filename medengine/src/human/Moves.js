/**
 * A library of poses and short clips in the rig's pose language (src/human/Rig.js).
 *
 * Side-neutral convention: for arms and legs, x is "out" (away from the midline on that
 * side), so the same numbers serve left and right. Hands are relative to their shoulder in
 * the chest frame (the shoulder is ~0.18 m from the midline: out -0.18 = centre of the chest).
 * Feet are relative to the hip horizontally, height above the floor.
 *
 * A clip: { keys: [{ t, pose, ease? }], loop?, hold? } with t in seconds. Poses missing a part
 * leave it to the layer below.
 */

const fist = { curl: 1, thumb: 0.9, spread: 0 };
const relaxed = { curl: 0.25, thumb: 0.2 };

export const POSES = {
  idle: {},
  idle_tense: { spine: [6, 0, 0], head: [-4, 0, 0], armL: { hand: [0.05, -0.47, 0.1], curl: 0.6, thumb: 0.5 }, armR: { hand: [0.05, -0.47, 0.1], curl: 0.6, thumb: 0.5 }, legL: { foot: [0.03, 0, 0.1] }, legR: { foot: [0.03, 0, -0.08] } },
  stand_wide: { pelvis: { pos: [0, -0.01, 0] }, legL: { foot: [0.07, 0, 0.02], yaw: 14 }, legR: { foot: [0.07, 0, -0.02], yaw: 14 }, armL: { hand: [0.1, -0.5, 0.0], ...fist }, armR: { hand: [0.1, -0.5, 0.0], ...fist }, spine: [-2, 0, 0], head: [-4, 0, 0] },
  arms_crossed: { armL: { hand: [-0.27, -0.24, 0.17], elbow: [0.3, -1, 0.2], fingers: [-1, 0.1, 0], palm: [0, 0, 1], curl: 0.4 }, armR: { hand: [-0.25, -0.28, 0.2], elbow: [0.3, -1, 0.2], fingers: [-1, 0.2, 0], palm: [0, 0, -1], curl: 0.4 }, spine: [-3, 0, 0] },
  hands_up: { armL: { hand: [0.12, 0.12, 0.12], elbow: [0.6, -1, 0], fingers: [0, 1, 0.1], palm: [0, 0, 1], curl: 0.05, spread: 0.8 }, armR: { hand: [0.12, 0.12, 0.12], elbow: [0.6, -1, 0], fingers: [0, 1, 0.1], palm: [0, 0, 1], curl: 0.05, spread: 0.8 }, spine: [-6, 0, 0], head: [-6, 0, 0] },
  hands_bound: { armL: { hand: [-0.16, -0.42, 0.2], elbow: [0.3, -1, -0.4], fingers: [-0.2, -0.6, 1], palm: [-1, 0, 0], curl: 0.5 }, armR: { hand: [-0.16, -0.42, 0.2], elbow: [0.3, -1, -0.4], fingers: [-0.2, -0.6, 1], palm: [-1, 0, 0], curl: 0.5 }, spine: [8, 0, 0], head: [6, 0, 0] },
  point: { armR: { hand: [0.02, 0.0, 0.52], elbow: [0.5, -1, 0], fingers: [0, 0.05, 1], palm: [-1, -0.3, 0], curl: 0.7, thumb: 0.4 }, spine: [0, -8, 0] },
  // a call: wrist at the jaw, the hand running up and back to the ear, the phone along the palm
  phone: { armR: { hand: [-0.06, 0.1, 0.08], elbow: [0.5, -0.75, 0.35], fingers: [-0.1, 0.65, -0.75], palm: [-1, 0, 0], curl: 0.45, thumb: 0.5 }, head: [3, -10, 6], spine: [3, 0, 0] },
  gun_low: { armR: { hand: [0.02, -0.45, 0.2], elbow: [0.3, -1, -0.3], fingers: [0, -0.5, 1], palm: [-1, 0, 0], curl: 0.8, thumb: 0.5 } },
  gun_aim: { spine: [2, -12, 0], head: [2, 10, 0], armR: { hand: [-0.12, 0.0, 0.56], elbow: [0.35, -1, 0], fingers: [0, 0.15, 1], palm: [-1, 0, 0], curl: 0.8, thumb: 0.5 }, armL: { hand: [-0.27, -0.04, 0.48], elbow: [0.2, -1, -0.2], fingers: [0.2, 0.2, 1], palm: [-0.2, 1, 0], curl: 0.6 }, legL: { foot: [0.03, 0, 0.14] }, legR: { foot: [0.04, 0, -0.12] } },
  // holding a hostage in front, gun at their head (the hostage stands just in front)
  hostage_hold: { spine: [3, -6, 0], armL: { hand: [-0.3, -0.18, 0.22], elbow: [0.4, -1, -0.2], fingers: [-1, 0, 0.2], palm: [0, 0, -1], curl: 0.6 }, armR: { hand: [-0.17, 0.12, 0.25], elbow: [0.6, -0.8, -0.1], fingers: [-0.3, 0.2, 1], palm: [-1, 0, 0], curl: 0.8, thumb: 0.5 }, legL: { foot: [0.04, 0, 0.12] }, legR: { foot: [0.05, 0, -0.16] } },
  guard: { pelvis: { pos: [0, -0.05, 0] }, spine: [10, 14, 0], head: [-6, -10, 0], armL: { hand: [-0.08, -0.08, 0.34], elbow: [0.3, -1, 0], fingers: [-0.2, 0.3, 1], palm: [-1, 0, 0], ...fist }, armR: { hand: [-0.12, -0.14, 0.2], elbow: [0.4, -1, 0], fingers: [-0.2, 0.3, 1], palm: [-1, 0, 0], ...fist }, legL: { foot: [0.04, 0, 0.2], knee: [0.2, 0, 1] }, legR: { foot: [0.07, 0, -0.2], knee: [0.2, 0, 1], yaw: 30 } },
  punch_l: { pelvis: { pos: [0, -0.06, 0.04] }, spine: [12, -18, 0], head: [-8, 12, 0], armL: { hand: [-0.12, -0.02, 0.6], elbow: [0.4, -1, 0], fingers: [0, 0, 1], palm: [0, -1, 0], ...fist }, armR: { hand: [-0.12, -0.14, 0.18], elbow: [0.4, -1, 0], ...fist }, legL: { foot: [0.04, 0, 0.3], knee: [0.2, 0, 1] }, legR: { foot: [0.07, 0, -0.24], toe: 10 } },
  punch_r: { pelvis: { pos: [0, -0.06, 0.06] }, spine: [12, 22, 0], head: [-8, -16, 0], armR: { hand: [-0.14, 0.0, 0.62], elbow: [0.4, -1, 0], fingers: [0, 0, 1], palm: [0, -1, 0], ...fist }, armL: { hand: [-0.1, -0.1, 0.26], elbow: [0.4, -1, 0], ...fist }, legL: { foot: [0.04, 0, 0.28], knee: [0.2, 0, 1] }, legR: { foot: [0.07, 0, -0.26], toe: 14 } },
  elbow_strike: { pelvis: { pos: [0, -0.07, 0.05] }, spine: [8, 34, -6], armR: { hand: [-0.36, -0.02, 0.12], elbow: [0, 0.2, 1], fingers: [-1, 0, 0], ...fist }, armL: { hand: [-0.1, -0.12, 0.25], ...fist } },
  kick: { pelvis: { pos: [0, 0.0, -0.05], rot: [-10, 0, 0] }, spine: [-10, 0, 0], legR: { foot: [0.02, 0.55, 0.62], knee: [0, 1, 0.4], toe: 25 }, legL: { foot: [0.03, 0, -0.05] }, armL: { hand: [0.0, -0.1, 0.25], ...fist }, armR: { hand: [0.16, -0.3, -0.1], ...fist } },
  block: { spine: [6, 0, 0], head: [12, 0, 0], armL: { hand: [-0.12, 0.12, 0.26], elbow: [0.2, -1, 0.4], fingers: [-0.4, 1, 0.2], palm: [0, 0, -1], ...fist }, armR: { hand: [-0.12, 0.08, 0.26], elbow: [0.2, -1, 0.4], fingers: [-0.4, 1, 0.2], palm: [0, 0, -1], ...fist }, pelvis: { pos: [0, -0.06, -0.03] } },
  hit_reel: { pelvis: { pos: [0, -0.03, -0.08], rot: [-6, 8, 4] }, spine: [-14, 18, 6], head: [-20, 24, 10], armL: { hand: [0.24, -0.3, -0.05], ...relaxed }, armR: { hand: [0.2, -0.36, 0.08], ...relaxed }, legL: { foot: [0.06, 0, -0.06] }, legR: { foot: [0.06, 0, -0.22] } },
  knocked_down: { pelvis: { pos: [0, -0.74, -0.45], rot: [-80, 10, 6] }, spine: [-10, 0, 8], head: [20, 30, 0], armL: { hand: [0.35, 0.1, -0.1], elbow: [1, 0, 0], ...relaxed }, armR: { hand: [0.3, 0.2, 0.1], elbow: [1, 0, 0], ...relaxed }, legL: { foot: [0.12, 0.05, 0.62], knee: [0.3, 1, 0.5] }, legR: { foot: [0.05, 0.05, 0.55], knee: [0, 1, 0.4] } },
  kneel: { pelvis: { pos: [0, -0.44, -0.05] }, spine: [8, 0, 0], legL: { foot: [0.04, 0, 0.4], knee: [0.1, 0.4, 1] }, legR: { foot: [0.05, 0.02, -0.45], knee: [0, -1, 0.6], toe: 30 }, armL: { hand: [0.0, -0.32, 0.3], ...relaxed }, armR: { hand: [0.02, -0.42, 0.12], ...relaxed } },
  crouch: { pelvis: { pos: [0, -0.4, -0.08] }, spine: [30, 0, 0], head: [-26, 0, 0], legL: { foot: [0.07, 0, 0.18], knee: [0.3, 0.2, 1] }, legR: { foot: [0.07, 0, -0.08], knee: [0.3, 0.2, 1], toe: 10 }, armL: { hand: [-0.05, -0.38, 0.32], curl: 0.5 }, armR: { hand: [0.0, -0.5, 0.18], curl: 0.6 } },
  // perched on a gargoyle: a deep crouch, forearms on the knees, looking down at the city
  perch: { pelvis: { pos: [0, -0.52, -0.12] }, spine: [38, 0, 0], neck: [-14, 0, 0], head: [-6, 0, 0], legL: { foot: [0.06, 0, 0.24], knee: [0.15, 0.4, 1] }, legR: { foot: [0.08, 0, 0.12], knee: [0.2, 0.4, 1] }, armL: { hand: [-0.1, -0.38, 0.4], elbow: [0.2, -1, 0.1], fingers: [-0.2, -0.6, 0.6], curl: 0.55 }, armR: { hand: [-0.08, -0.42, 0.36], elbow: [0.2, -1, 0.1], fingers: [-0.2, -0.6, 0.6], curl: 0.55 } },
  glide: { pelvis: { rot: [-70, 0, 0] }, spine: [-10, 0, 0], neck: [-30, 0, 0], head: [-20, 0, 0], armL: { hand: [0.5, 0.05, -0.05], elbow: [0, 1, -0.2], fingers: [1, 0, 0], palm: [0, -1, 0], curl: 0.6 }, armR: { hand: [0.5, 0.05, -0.05], elbow: [0, 1, -0.2], fingers: [1, 0, 0], palm: [0, -1, 0], curl: 0.6 }, legL: { foot: [0.02, 0.6, -0.65], knee: [0, -1, 0] }, legR: { foot: [0.02, 0.62, -0.6], knee: [0, -1, 0] } },
  // gripping someone's collar at arm's length (the interrogation)
  hold_collar: { spine: [8, 0, 0], armL: { hand: [-0.12, -0.05, 0.5], elbow: [0.3, -1, 0], fingers: [0, 0.6, 1], palm: [0, 0, 1], curl: 0.95, thumb: 0.8 }, armR: { hand: [-0.12, 0.0, 0.52], elbow: [0.3, -1, 0], fingers: [0, 0.6, 1], palm: [0, 0, 1], curl: 0.95, thumb: 0.8 }, legL: { foot: [0.05, 0, 0.18] }, legR: { foot: [0.06, 0, -0.2] } },
  // held over a ledge by the collar: arms grabbing at the wrists above, feet dangling
  dangled: { pelvis: { rot: [8, 0, 0] }, spine: [-8, 0, 0], head: [10, 0, 0], armL: { hand: [-0.08, 0.32, 0.2], elbow: [0.6, -0.4, 0], fingers: [0, 1, 0.2], palm: [0, 0, -1], curl: 0.8 }, armR: { hand: [-0.08, 0.33, 0.22], elbow: [0.6, -0.4, 0], fingers: [0, 1, 0.2], palm: [0, 0, -1], curl: 0.8 }, legL: { foot: [0.02, 0.05, 0.1], knee: [0, 0, 1] }, legR: { foot: [0.06, 0.15, -0.05], knee: [0, 0, 1] } },
  steer: { pelvis: { pos: [0, -0.04, 0] }, spine: [12, 0, 0], head: [-10, 0, 0], armL: { hand: [-0.08, -0.12, 0.44], elbow: [0.4, -1, 0], fingers: [-0.4, 0.4, 0.6], palm: [-0.6, 0, -0.4], curl: 0.9 }, armR: { hand: [-0.08, -0.12, 0.44], elbow: [0.4, -1, 0], fingers: [-0.4, 0.4, 0.6], palm: [-0.6, 0, -0.4], curl: 0.9 }, legL: { foot: [0.06, 0, 0.1] }, legR: { foot: [0.07, 0, -0.12] } },
  talk_open: { armL: { hand: [-0.02, -0.3, 0.3], elbow: [0.4, -1, -0.2], fingers: [0.2, -0.1, 1], palm: [0.3, 1, 0], curl: 0.2, spread: 0.4 }, armR: { hand: [0.0, -0.4, 0.2], ...relaxed } },
  talk_chest: { armR: { hand: [-0.19, -0.18, 0.16], elbow: [0.4, -1, -0.2], fingers: [-1, 0.2, -0.3], palm: [0, 0, -1], curl: 0.3 }, head: [4, 0, 0] },
  shrug: { armL: { hand: [0.08, -0.32, 0.22], fingers: [0.4, 0, 1], palm: [0, 1, 0], curl: 0.15, clavicle: [10, 0] }, armR: { hand: [0.08, -0.32, 0.22], fingers: [0.4, 0, 1], palm: [0, 1, 0], curl: 0.15, clavicle: [10, 0] }, head: [-4, 0, 8] },
  head_down: { neck: [16, 0, 0], head: [14, 0, 0], spine: [8, 0, 0] },
  look_up: { neck: [-16, 0, 0], head: [-14, 0, 0] },
  fear_back: { spine: [-8, 0, 0], head: [-6, 0, 0], armL: { hand: [-0.05, -0.18, 0.3], fingers: [0, 0.6, 1], palm: [0, 0, 1], curl: 0.2, spread: 0.6 }, armR: { hand: [-0.03, -0.25, 0.3], fingers: [0, 0.6, 1], palm: [0, 0, 1], curl: 0.2, spread: 0.6 }, legL: { foot: [0.04, 0, -0.05] }, legR: { foot: [0.05, 0, -0.2] } },
  throw_r: { spine: [6, 26, 0], head: [-4, -20, 0], armR: { hand: [-0.2, 0.05, 0.6], elbow: [0.2, -1, 0], fingers: [0, 0, 1], palm: [0, -1, 0], curl: 0.5 }, armL: { hand: [0.1, -0.3, 0.2], ...fist } },
  wheel_turn: { spine: [10, -10, -8], armL: { hand: [-0.0, -0.05, 0.44], curl: 0.9 }, armR: { hand: [-0.16, -0.2, 0.42], curl: 0.9 } },
};

/** Short clips: key poses with times. Played over the base pose by the actor. */
export const CLIPS = {
  punch_l: { keys: [{ t: 0, pose: POSES.guard }, { t: 0.12, pose: POSES.punch_l, ease: 'out' }, { t: 0.4, pose: POSES.guard, ease: 'inOut' }] },
  punch_r: { keys: [{ t: 0, pose: POSES.guard }, { t: 0.14, pose: POSES.punch_r, ease: 'out' }, { t: 0.45, pose: POSES.guard, ease: 'inOut' }] },
  combo: { keys: [{ t: 0, pose: POSES.guard }, { t: 0.12, pose: POSES.punch_l, ease: 'out' }, { t: 0.3, pose: POSES.guard }, { t: 0.42, pose: POSES.punch_r, ease: 'out' }, { t: 0.62, pose: POSES.elbow_strike, ease: 'out' }, { t: 0.95, pose: POSES.guard, ease: 'inOut' }] },
  kick: { keys: [{ t: 0, pose: POSES.guard }, { t: 0.18, pose: POSES.kick, ease: 'out' }, { t: 0.55, pose: POSES.guard, ease: 'inOut' }] },
  hit: { keys: [{ t: 0, pose: POSES.idle_tense }, { t: 0.08, pose: POSES.hit_reel, ease: 'out' }, { t: 0.7, pose: POSES.idle_tense, ease: 'inOut' }] },
  fall: { keys: [{ t: 0, pose: POSES.hit_reel }, { t: 0.25, pose: { ...POSES.hit_reel, pelvis: { pos: [0, -0.35, -0.3], rot: [-30, 10, 4] } }, ease: 'in' }, { t: 0.55, pose: POSES.knocked_down, ease: 'in' }], hold: true },
  throw: { keys: [{ t: 0, pose: POSES.idle_tense }, { t: 0.18, pose: { ...POSES.throw_r, armR: { hand: [0.1, 0.15, -0.15], elbow: [0.5, -0.2, -1], curl: 0.5 } } }, { t: 0.3, pose: POSES.throw_r, ease: 'out' }, { t: 0.7, pose: POSES.idle_tense, ease: 'inOut' }] },
  nod: { keys: [{ t: 0, pose: {} }, { t: 0.2, pose: { head: [12, 0, 0] } }, { t: 0.45, pose: { head: [-2, 0, 0] } }, { t: 0.6, pose: {} }] },
  shake_head: { keys: [{ t: 0, pose: {} }, { t: 0.18, pose: { head: [0, 14, 0] } }, { t: 0.4, pose: { head: [0, -14, 0] } }, { t: 0.62, pose: { head: [0, 8, 0] } }, { t: 0.8, pose: {} }] },
  flinch: { keys: [{ t: 0, pose: {} }, { t: 0.08, pose: { spine: [-6, 0, 0], head: [-10, 0, 0], armL: { clavicle: [12, 0] }, armR: { clavicle: [12, 0] } }, ease: 'out' }, { t: 0.5, pose: {}, ease: 'inOut' }] },
};

export function getPose(name) { return POSES[name] ?? {}; }
