import { Vector3 } from 'three';

const deg = Math.PI / 180;

/**
 * Anthropometric model of a boxer, built in the rest pose (standing straight,
 * arms hanging, facing +Z, left side at +X, feet on y = 0).
 *
 * Segment masses follow Winter's tables (Biomechanics and Motor Control of
 * Human Movement) as fractions of body mass, scaled to the fighter; lengths
 * follow Drillis & Contini fractions of stature. Inertias are those of solid
 * ellipsoids with the segment's dimensions, which lands within ~10-20% of
 * measured radii of gyration - plenty for a game.
 *
 * Every body's local frame is axis-aligned in the rest pose; the body origin
 * is its centre of mass.
 */
export function buildAnatomy({ height = 1.8, mass = 80, gloveMass = 0.34 } = {}) {
  const s = height / 1.8;         // proportions below are for a 1.80 m fighter
  const m = mass;
  const y = (v) => v * s;

  const J = {
    ankleY: y(0.085),
    kneeY: y(0.505),
    hipY: y(0.925),
    hipX: y(0.092),
    lumbarY: y(1.075),
    thoracicY: y(1.225),
    shoulderY: y(1.455),
    shoulderX: y(0.185),
    neckY: y(1.555),
    elbowDrop: y(0.305),
    wristDrop: y(0.265),
  };
  J.elbowY = J.shoulderY - J.elbowDrop;
  J.wristY = J.elbowY - J.wristDrop;

  const seg = {};
  const ellipsoidInertia = (mm, w, h, d) => new Vector3(
    (mm / 20) * (h * h + d * d),
    (mm / 20) * (w * w + d * d),
    (mm / 20) * (w * w + h * h),
  );

  // --- trunk ---------------------------------------------------------------
  seg.pelvis = {
    mass: 0.142 * m,
    com: new Vector3(0, y(0.985), -0.01 * s),
    size: [0.33 * s, 0.2 * s, 0.22 * s],
  };
  seg.abdomen = {
    mass: 0.139 * m,
    com: new Vector3(0, y(1.15), 0),
    size: [0.3 * s, 0.17 * s, 0.2 * s],
  };
  seg.chest = {
    mass: 0.216 * m,
    com: new Vector3(0, y(1.34), -0.01 * s),
    size: [0.38 * s, 0.3 * s, 0.23 * s],
  };
  // Head + neck as one segment (the neck's mass sits low, pulling the COM down).
  seg.head = {
    mass: 0.081 * m,
    com: new Vector3(0, y(1.665), 0.012 * s),
    size: [0.16 * s, 0.25 * s, 0.2 * s],
  };

  // --- limbs (left; right is mirrored) ---------------------------------------
  const armX = J.shoulderX + 0.02 * s;
  seg.upperArm = {
    mass: 0.028 * m,
    com: new Vector3(armX, J.shoulderY - 0.436 * J.elbowDrop, 0),
    size: [0.1 * s, J.elbowDrop, 0.1 * s],
  };
  // Forearm + taped hand + glove: one rigid unit (boxers' wrists are wrapped).
  const foreMass = 0.016 * m + 0.006 * m + gloveMass;
  const gloveCenterDrop = 0.085 * s;
  const foreComDrop = (0.016 * m * 0.43 * J.wristDrop + (0.006 * m + gloveMass) * (J.wristDrop + gloveCenterDrop)) / foreMass;
  seg.forearm = {
    mass: foreMass,
    com: new Vector3(armX, J.elbowY - foreComDrop, 0),
    size: [0.1 * s, J.wristDrop + 0.16 * s, 0.1 * s],
  };
  seg.thigh = {
    mass: 0.1 * m,
    com: new Vector3(J.hipX, J.hipY - 0.433 * (J.hipY - J.kneeY), 0),
    size: [0.15 * s, J.hipY - J.kneeY, 0.16 * s],
  };
  seg.shin = {
    mass: 0.0465 * m,
    com: new Vector3(J.hipX, J.kneeY - 0.433 * (J.kneeY - J.ankleY), -0.005 * s),
    size: [0.1 * s, J.kneeY - J.ankleY, 0.11 * s],
  };
  seg.foot = {
    mass: 0.0145 * m + 0.35,          // + boxing boot
    com: new Vector3(J.hipX + 0.005 * s, y(0.045), 0.055 * s),
    size: [0.1 * s, 0.09 * s, 0.26 * s],
  };

  for (const k of Object.keys(seg)) {
    const g = seg[k];
    g.inertia = ellipsoidInertia(g.mass, ...g.size);
  }

  // Collision geometry (local to each segment's COM).
  const shapes = {
    pelvis: [{ type: 'capsule', radius: 0.11 * s, halfLength: 0.07 * s, axis: [1, 0, 0], offset: [0, 0, 0.0] }],
    abdomen: [{ type: 'capsule', radius: 0.105 * s, halfLength: 0.055 * s, axis: [1, 0, 0], offset: [0, 0, 0.005 * s] }],
    chest: [
      { type: 'capsule', radius: 0.115 * s, halfLength: 0.075 * s, axis: [1, 0, 0], offset: [0, -0.03 * s, 0.01 * s] },
      { type: 'capsule', radius: 0.1 * s, halfLength: 0.1 * s, axis: [1, 0, 0], offset: [0, 0.08 * s, -0.005 * s] },
    ],
    head: [
      { type: 'sphere', radius: 0.098 * s, offset: [0, 0.025 * s, -0.004 * s], part: 'skull' },
      { type: 'sphere', radius: 0.058 * s, offset: [0, -0.058 * s, 0.045 * s], part: 'jaw' },
    ],
    upperArm: [{ type: 'capsule', radius: 0.052 * s, halfLength: 0.1 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    forearm: [
      { type: 'capsule', radius: 0.043 * s, halfLength: 0.085 * s, axis: [0, 1, 0], offset: [0, 0, 0], part: 'forearm' },
      { type: 'capsule', radius: 0.062 * s, halfLength: 0.03 * s, axis: [0, 1, 0], offset: [0, 0, 0], part: 'glove' },
    ],
    thigh: [{ type: 'capsule', radius: 0.075 * s, halfLength: 0.15 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    shin: [{ type: 'capsule', radius: 0.052 * s, halfLength: 0.16 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    foot: [
      { type: 'box', halfExtents: [0.048 * s, 0.04 * s, 0.13 * s], offset: [0, -0.003 * s, 0], part: 'sole' },
      { type: 'capsule', radius: 0.042 * s, halfLength: 0.085 * s, axis: [0, 0, 1], offset: [0, 0.0, 0.0] },
    ],
  };
  // Forearm shapes positioned relative to the elbow, then converted to COM-local.
  {
    const comY = seg.forearm.com.y;
    const foreCenter = J.elbowY - 0.125 * s;
    const gloveCenter = J.wristY - gloveCenterDrop;
    shapes.forearm[0].offset = [0, foreCenter - comY, 0];
    shapes.forearm[1].offset = [0, gloveCenter - comY, 0.005 * s];
  }

  // Joint definitions. Axes are in the parent's frame. For limbs the twist
  // axis runs along the bone; for hinges it is the hinge axis.
  const joints = [
    { name: 'lumbar', parent: 'pelvis', child: 'abdomen', anchor: [0, J.lumbarY, -0.02 * s],
      twistAxis: [0, 1, 0], swingAxis1: [0, 0, 1], swingAxis2: [1, 0, 0],
      twist: [-20 * deg, 20 * deg], swing1: [-22 * deg, 22 * deg], swing2: [-25 * deg, 40 * deg] },
    { name: 'thoracic', parent: 'abdomen', child: 'chest', anchor: [0, J.thoracicY, -0.02 * s],
      twistAxis: [0, 1, 0], swingAxis1: [0, 0, 1], swingAxis2: [1, 0, 0],
      twist: [-35 * deg, 35 * deg], swing1: [-20 * deg, 20 * deg], swing2: [-20 * deg, 30 * deg] },
    { name: 'neck', parent: 'chest', child: 'head', anchor: [0, J.neckY, -0.005 * s],
      twistAxis: [0, 1, 0], swingAxis1: [0, 0, 1], swingAxis2: [1, 0, 0],
      twist: [-75 * deg, 75 * deg], swing1: [-40 * deg, 40 * deg], swing2: [-55 * deg, 50 * deg] },
  ];
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    // Shoulder: twist along the arm (down), swing1 about Z (abduction for L),
    // swing2 about -X (flexion: arm forward).
    // The shoulder is the most mobile joint in the body; with the arm
    // raised it can adduct well across the chest (cross, hooks), so the
    // adduction side of the cone is generous.
    const abd = [-80 * deg, 165 * deg];
    joints.push({ name: 'shoulder' + side, parent: 'chest', child: 'upperArm' + side,
      anchor: [sx * J.shoulderX, J.shoulderY, 0],
      twistAxis: [0, -1, 0], swingAxis1: [0, 0, 1], swingAxis2: [-1, 0, 0],
      twist: side === 'L' ? [-100 * deg, 110 * deg] : [-110 * deg, 100 * deg],
      swing1: side === 'L' ? abd : [-abd[1], -abd[0]],
      swing2: [-60 * deg, 170 * deg] });
    joints.push({ name: 'elbow' + side, parent: 'upperArm' + side, child: 'forearm' + side,
      anchor: [sx * armX, J.elbowY, 0],
      twistAxis: [-1, 0, 0], swingAxis1: [0, 1, 0], swingAxis2: [0, 0, 1],
      twist: [-4 * deg, 150 * deg], swing1: [0, 0], swing2: [0, 0] });
    const hipAbd = [-25 * deg, 50 * deg];
    joints.push({ name: 'hip' + side, parent: 'pelvis', child: 'thigh' + side,
      anchor: [sx * J.hipX, J.hipY, 0],
      twistAxis: [0, -1, 0], swingAxis1: [0, 0, 1], swingAxis2: [-1, 0, 0],
      twist: [-40 * deg, 40 * deg],
      swing1: side === 'L' ? hipAbd : [-hipAbd[1], -hipAbd[0]],
      swing2: [-25 * deg, 125 * deg] });
    joints.push({ name: 'knee' + side, parent: 'thigh' + side, child: 'shin' + side,
      anchor: [sx * J.hipX, J.kneeY, 0],
      twistAxis: [1, 0, 0], swingAxis1: [0, 1, 0], swingAxis2: [0, 0, 1],
      twist: [-3 * deg, 150 * deg], swing1: [0, 0], swing2: [0, 0] });
    const inv = [-18 * deg, 18 * deg];
    joints.push({ name: 'ankle' + side, parent: 'shin' + side, child: 'foot' + side,
      anchor: [sx * J.hipX, J.ankleY, 0],
      twistAxis: [1, 0, 0], swingAxis1: [0, 0, 1], swingAxis2: [0, -1, 0],
      twist: [-25 * deg, 45 * deg], swing1: inv, swing2: [-15 * deg, 15 * deg] });
  }

  return { J, seg, shapes, joints, height, mass, scale: s, gloveCenterDrop };
}

/**
 * Muscle strength per joint (peak isometric torque, Nm) for a trained
 * 80 kg athlete, from dynamometry literature (e.g. Anderson et al. 2007,
 * neck: Garces et al. 2002). Stiffness/damping are the controller's
 * nominal PD gains at full activation.
 */
export const MUSCLES = {
  lumbar:   { maxTorque: 260, stiffness: 1400, damping: 70 },
  thoracic: { maxTorque: 200, stiffness: 1100, damping: 55 },
  neck:     { maxTorque: 55,  stiffness: 140,  damping: 9 },
  shoulder: { maxTorque: 95,  stiffness: 320,  damping: 12 },
  elbow:    { maxTorque: 75,  stiffness: 200,  damping: 6 },
  hip:      { maxTorque: 240, stiffness: 1600, damping: 60 },
  knee:     { maxTorque: 260, stiffness: 1600, damping: 55 },
  ankle:    { maxTorque: 150, stiffness: 650,  damping: 18 },
};
