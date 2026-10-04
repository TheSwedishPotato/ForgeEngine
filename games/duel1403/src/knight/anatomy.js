import { Vector3 } from 'three';

const deg = Math.PI / 180;

/**
 * Anthropometric model of a fighter in the rest pose (standing straight,
 * arms hanging, facing +Z, left side at +X, feet on y = 0).
 *
 * Segment masses follow Winter's tables (Biomechanics and Motor Control of
 * Human Movement) as fractions of body mass; lengths follow Drillis &
 * Contini fractions of stature. Inertias are those of solid ellipsoids.
 * Armour is added on top: each piece's mass is placed on the segments it
 * rests on (see data/armour.js), and it enlarges the inertia as a shell.
 *
 * Every body's local frame is axis-aligned in the rest pose; the body origin
 * is its centre of mass.
 */
export function buildAnatomy({ height = 1.78, mass = 78, armourMass = {}, bulk = {} } = {}) {
  const s = height / 1.8;
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
    handDrop: y(0.075),
  };
  J.elbowY = J.shoulderY - J.elbowDrop;
  J.wristY = J.elbowY - J.wristDrop;
  J.handY = J.wristY - J.handDrop;

  const ellipsoidInertia = (mm, w, h, d) => new Vector3(
    (mm / 20) * (h * h + d * d),
    (mm / 20) * (w * w + d * d),
    (mm / 20) * (w * w + h * h),
  );
  // A thin shell of the same outer size has 5/3 the inertia of the solid.
  const shellInertia = (mm, w, h, d) => ellipsoidInertia(mm, w, h, d).multiplyScalar(5 / 3);

  const seg = {};
  seg.pelvis = { mass: 0.142 * m, com: new Vector3(0, y(0.985), -0.01 * s), size: [0.33 * s, 0.2 * s, 0.22 * s] };
  seg.abdomen = { mass: 0.139 * m, com: new Vector3(0, y(1.15), 0), size: [0.3 * s, 0.17 * s, 0.2 * s] };
  seg.chest = { mass: 0.216 * m, com: new Vector3(0, y(1.34), -0.01 * s), size: [0.38 * s, 0.3 * s, 0.23 * s] };
  seg.head = { mass: 0.081 * m, com: new Vector3(0, y(1.665), 0.012 * s), size: [0.16 * s, 0.25 * s, 0.2 * s] };

  const armX = J.shoulderX + 0.02 * s;
  seg.upperArm = { mass: 0.028 * m, com: new Vector3(armX, J.shoulderY - 0.436 * J.elbowDrop, 0), size: [0.1 * s, J.elbowDrop, 0.1 * s] };
  // Forearm and hand as one rigid unit; the wrist's freedom lives in the
  // grip joint that holds the weapon.
  const foreMass = 0.016 * m, handMass = 0.006 * m;
  const fm = foreMass + handMass;
  const comDrop = (foreMass * 0.43 * J.wristDrop + handMass * (J.wristDrop + J.handDrop)) / fm;
  seg.forearm = { mass: fm, com: new Vector3(armX, J.elbowY - comDrop, 0), size: [0.09 * s, J.wristDrop + 0.15 * s, 0.09 * s] };
  seg.thigh = { mass: 0.1 * m, com: new Vector3(J.hipX, J.hipY - 0.433 * (J.hipY - J.kneeY), 0), size: [0.15 * s, J.hipY - J.kneeY, 0.16 * s] };
  seg.shin = { mass: 0.0465 * m, com: new Vector3(J.hipX, J.kneeY - 0.433 * (J.kneeY - J.ankleY), -0.005 * s), size: [0.1 * s, J.kneeY - J.ankleY, 0.11 * s] };
  seg.foot = { mass: 0.0145 * m, com: new Vector3(J.hipX + 0.005 * s, y(0.045), 0.055 * s), size: [0.1 * s, 0.09 * s, 0.26 * s] };

  for (const k of Object.keys(seg)) {
    const g = seg[k];
    g.inertia = ellipsoidInertia(g.mass, ...g.size);
    const am = armourMass[k] ?? 0;
    if (am > 0) {
      // Armour sits on the surface of the segment: add it as a shell.
      const b = bulk[k] ?? 0.01;
      const [w, h, d] = g.size;
      g.inertia.add(shellInertia(am, w + 2 * b, h, d + 2 * b));
      g.mass += am;
      g.armourMass = am;
    }
  }

  // Collision geometry (local to each segment's COM). `bulk` thickens it by
  // the armour worn on that segment.
  const bk = (k) => bulk[k] ?? 0;
  const shapes = {
    pelvis: [{ type: 'capsule', radius: 0.11 * s + bk('pelvis'), halfLength: 0.07 * s, axis: [1, 0, 0], offset: [0, 0, 0] }],
    abdomen: [{ type: 'capsule', radius: 0.105 * s + bk('abdomen'), halfLength: 0.055 * s, axis: [1, 0, 0], offset: [0, 0, 0.005 * s] }],
    chest: [
      { type: 'capsule', radius: 0.115 * s + bk('chest'), halfLength: 0.075 * s, axis: [1, 0, 0], offset: [0, -0.03 * s, 0.01 * s] },
      { type: 'capsule', radius: 0.1 * s + bk('chest'), halfLength: 0.1 * s, axis: [1, 0, 0], offset: [0, 0.08 * s, -0.005 * s] },
    ],
    head: [
      { type: 'sphere', radius: 0.1 * s + bk('head'), offset: [0, 0.025 * s, -0.004 * s], part: 'skull' },
      { type: 'sphere', radius: 0.06 * s + bk('head') * 0.6, offset: [0, -0.058 * s, 0.045 * s], part: 'jaw' },
      { type: 'capsule', radius: 0.055 * s + bk('head') * 0.5, halfLength: 0.03 * s, axis: [0, 1, 0], offset: [0, -0.1 * s, -0.01 * s], part: 'neck' },
    ],
    upperArm: [{ type: 'capsule', radius: 0.052 * s + bk('upperArm'), halfLength: 0.1 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    forearm: [
      { type: 'capsule', radius: 0.042 * s + bk('forearm'), halfLength: 0.085 * s, axis: [0, 1, 0], offset: [0, 0, 0], part: 'forearm' },
      { type: 'sphere', radius: 0.044 * s + bk('hand'), offset: [0, 0, 0], part: 'hand' },
    ],
    thigh: [{ type: 'capsule', radius: 0.075 * s + bk('thigh'), halfLength: 0.15 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    shin: [{ type: 'capsule', radius: 0.052 * s + bk('shin'), halfLength: 0.16 * s, axis: [0, 1, 0], offset: [0, 0.01 * s, 0] }],
    foot: [
      { type: 'box', halfExtents: [0.048 * s, 0.04 * s, 0.13 * s], offset: [0, -0.003 * s, 0], part: 'sole' },
      { type: 'capsule', radius: 0.042 * s + bk('foot'), halfLength: 0.085 * s, axis: [0, 0, 1], offset: [0, 0, 0] },
    ],
  };
  {
    const comY = seg.forearm.com.y;
    shapes.forearm[0].offset = [0, J.elbowY - 0.125 * s - comY, 0];
    shapes.forearm[1].offset = [0, J.handY - comY, 0.005 * s];
  }

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
    const abd = [-80 * deg, 170 * deg];
    joints.push({ name: 'shoulder' + side, parent: 'chest', child: 'upperArm' + side,
      anchor: [sx * J.shoulderX, J.shoulderY, 0],
      twistAxis: [0, -1, 0], swingAxis1: [0, 0, 1], swingAxis2: [-1, 0, 0],
      twist: side === 'L' ? [-100 * deg, 110 * deg] : [-110 * deg, 100 * deg],
      swing1: side === 'L' ? abd : [-abd[1], -abd[0]],
      swing2: [-60 * deg, 175 * deg] });
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

  return { J, seg, shapes, joints, height, mass, scale: s };
}

/**
 * Peak isometric torques (N m) of a trained adult man, from dynamometry
 * literature, with the controller's nominal stiffness and damping.
 */
export const MUSCLES = {
  lumbar:   { maxTorque: 260, stiffness: 1500, damping: 75 },
  thoracic: { maxTorque: 200, stiffness: 1200, damping: 60 },
  neck:     { maxTorque: 55,  stiffness: 150,  damping: 10 },
  shoulder: { maxTorque: 95,  stiffness: 340,  damping: 13 },
  elbow:    { maxTorque: 75,  stiffness: 210,  damping: 7 },
  hip:      { maxTorque: 240, stiffness: 1700, damping: 64 },
  knee:     { maxTorque: 260, stiffness: 1700, damping: 58 },
  ankle:    { maxTorque: 150, stiffness: 700,  damping: 20 },
};

/** Which anatomical segments each massBy key loads (limbs: per side). */
export const MASS_KEYS = {
  head: ['head'], chest: ['chest'], abdomen: ['abdomen'], pelvis: ['pelvis'],
  upperArm: ['upperArmL', 'upperArmR'], forearm: ['forearmL', 'forearmR'],
  thigh: ['thighL', 'thighR'], shin: ['shinL', 'shinR'], foot: ['footL', 'footR'],
};
