/**
 * A procedural humanoid: the Med Engine / MakeHuman "game engine" bone set (pelvis, three spine
 * bones, neck, head, eyes, clavicles, arms, hands with five fingers, legs, feet, toes) laid out in a
 * world-aligned rest pose (every bone's rest rotation is identity), with an optional skinned
 * "artist's mannequin" mesh.
 *
 * It exists for three reasons: tests that must run without character files, the demo scene, and as a
 * reference for what a character rig has to look like to receive retargeted motion. Real characters
 * (scans, MakeHuman exports, glTF) bring their own bones with the same names; see docs/ANIMATION.md.
 */
import { Group, Object3D } from '../scene/Object3D.js';
import { Bone, Skeleton, SkinnedMesh } from '../scene/Mesh.js';
import { StandardMaterial } from '../scene/Material.js';
import { BufferGeometry, CylinderGeometry, SphereGeometry, BoxGeometry, Float32BufferAttribute, Uint16BufferAttribute, mergeGeometries } from '../scene/Geometry.js';
import { Vector3, Quaternion, Matrix4 } from '../math/core.js';
import { RigInfo } from './Retarget.js';

/** Bone names in the order of the hierarchy (parents first). */
export const HUMANOID_BONES = (() => {
  const L = [['pelvis', null], ['spine_01', 'pelvis'], ['spine_02', 'spine_01'], ['spine_03', 'spine_02'], ['neck_01', 'spine_03'], ['head', 'neck_01'], ['eye_l', 'head'], ['eye_r', 'head']];
  for (const s of ['l', 'r']) {
    L.push([`clavicle_${s}`, 'spine_03'], [`upperarm_${s}`, `clavicle_${s}`], [`lowerarm_${s}`, `upperarm_${s}`], [`hand_${s}`, `lowerarm_${s}`]);
    for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      L.push([`${f}_01_${s}`, `hand_${s}`], [`${f}_02_${s}`, `${f}_01_${s}`], [`${f}_03_${s}`, `${f}_02_${s}`]);
    }
  }
  for (const s of ['l', 'r']) L.push([`thigh_${s}`, 'pelvis'], [`calf_${s}`, `thigh_${s}`], [`foot_${s}`, `calf_${s}`], [`ball_${s}`, `foot_${s}`]);
  return L;
})();

/**
 * Rest positions (metres) of every bone's head for a body `height` metres tall.
 * @param {object} [o]
 * @param {number} [o.height]    metres (1.75)
 * @param {number} [o.armAngle]  degrees the arms hang below horizontal: 0 = T-pose, 40 = A-pose (the default)
 * @returns {Record<string, Vector3>}  bone name -> head position
 */
export function humanoidRestHeads({ height = 1.75, armAngle = 40 } = {}) {
  const k = height / 1.75;
  const H = {};
  const set = (n, x, y, z) => { H[n] = new Vector3(x * k, y * k, z * k); };
  set('pelvis', 0, 0.95, 0); set('spine_01', 0, 1.03, 0); set('spine_02', 0, 1.15, 0); set('spine_03', 0, 1.29, 0);
  set('neck_01', 0, 1.50, 0); set('head', 0, 1.60, 0.0);
  const a = (armAngle * Math.PI) / 180, d = new Vector3(Math.cos(a), -Math.sin(a), 0);
  for (const [s, sg] of [['l', 1], ['r', -1]]) {
    set(`eye_${s}`, 0.032 * sg, 1.685, 0.085);
    set(`clavicle_${s}`, 0.02 * sg, 1.45, 0.02);
    const sh = new Vector3(0.18 * sg, 1.46, 0).multiplyScalar(k);
    const dir = new Vector3(d.x * sg, d.y, 0);
    const elbow = sh.clone().addScaledVector(dir, 0.29 * k), wrist = elbow.clone().addScaledVector(dir, 0.26 * k);
    H[`upperarm_${s}`] = sh; H[`lowerarm_${s}`] = elbow; H[`hand_${s}`] = wrist;
    // fingers lie in the hand's plane: palm down, index toward +Z; the thumb leans forward and down
    const along = dir.clone(), fwd = new Vector3(0, 0, 1);
    const fing = { index: [0.088, 0.03, 0.04, 0.026], middle: [0.092, 0.008, 0.044, 0.028], ring: [0.086, -0.014, 0.04, 0.026], pinky: [0.078, -0.034, 0.03, 0.02] };
    for (const [f, [base, off, l2, l3]] of Object.entries(fing)) {
      const p1 = wrist.clone().addScaledVector(along, base * k).addScaledVector(fwd, off * k);
      const p2 = p1.clone().addScaledVector(along, l2 * k), p3 = p2.clone().addScaledVector(along, l3 * k);
      H[`${f}_01_${s}`] = p1; H[`${f}_02_${s}`] = p2; H[`${f}_03_${s}`] = p3;
    }
    const td = along.clone().multiplyScalar(0.6).addScaledVector(fwd, 0.7).addScaledVector(new Vector3(0, -1, 0), 0.2).normalize();
    const t1 = wrist.clone().addScaledVector(along, 0.03 * k).addScaledVector(fwd, 0.025 * k).addScaledVector(new Vector3(0, -1, 0), 0.012 * k);
    const t2 = t1.clone().addScaledVector(td, 0.04 * k), t3 = t2.clone().addScaledVector(td, 0.03 * k);
    H[`thumb_01_${s}`] = t1; H[`thumb_02_${s}`] = t2; H[`thumb_03_${s}`] = t3;
    set(`thigh_${s}`, 0.09 * sg, 0.93, 0); set(`calf_${s}`, 0.09 * sg, 0.51, 0.005); set(`foot_${s}`, 0.09 * sg, 0.095, -0.01); set(`ball_${s}`, 0.09 * sg, 0.035, 0.135);
  }
  return H;
}

export class Humanoid {
  /**
   * @param {object} [o]
   * @param {number} [o.height]   metres
   * @param {number} [o.armAngle] rest pose arms: 0 = T-pose, 40 = A-pose
   * @param {string} [o.name]
   */
  constructor({ height = 1.75, armAngle = 40, name = 'humanoid' } = {}) {
    this.height = height; this.armAngle = armAngle;
    this.root = new Group(); this.root.name = name;
    this.heads = humanoidRestHeads({ height, armAngle });
    this.bones = {}; this.boneList = [];
    for (const [n, p] of HUMANOID_BONES) {
      const b = new Bone(); b.name = n;
      this.bones[n] = b; this.boneList.push(b);
      if (p) { this.bones[p].add(b); b.position.copy(this.heads[n]).sub(this.heads[p]); } else { this.root.add(b); b.position.copy(this.heads[n]); }
      b.userData.rest = this.heads[n].clone();
    }
    this.root.updateMatrixWorld(true);
    this.skeleton = new Skeleton(this.boneList);
    this.rig = RigInfo.fromObject3D(this.root);
    this.mesh = null;
  }

  /** Puts every bone back in its rest pose. */
  resetPose() {
    for (const b of this.boneList) { b.quaternion.identity(); const p = HUMANOID_BONES.find(([n]) => n === b.name)[1]; if (p) b.position.copy(this.heads[b.name]).sub(this.heads[p]); else b.position.copy(this.heads[b.name]); }
    this.root.updateMatrixWorld(true);
  }

  /**
   * The artist's mannequin: capsules and ellipsoids rigidly skinned to the bones, joined by spheres.
   * @returns {SkinnedMesh}
   */
  buildMannequin({ color = 0xd9d3c7, roughness = 0.55 } = {}) {
    const H = this.heads, k = this.height / 1.75, idx = new Map(this.boneList.map((b, i) => [b.name, i]));
    const parts = [];
    const q = new Quaternion(), m = new Matrix4(), up = new Vector3(0, 1, 0);
    const add = (geo, bone) => {
      const n = geo.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = idx.get(bone); sw[i * 4] = 1; }
      geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
      geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
      geo.deleteAttribute('uv');
      parts.push(geo);
    };
    const capsule = (bone, a, b, ra, rb) => {
      const A = H[a], B = H[b], len = A.distanceTo(B);
      const g = new CylinderGeometry(rb * k, ra * k, len, 14, 1, true);
      q.setFromUnitVectors(up, B.clone().sub(A).normalize());
      m.compose(A.clone().add(B).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
      g.applyMatrix4(m);
      add(g, bone);
      ball(bone, A, ra * k);
    };
    const ball = (bone, c, r, sx = 1, sy = 1, sz = 1) => {
      const g = new SphereGeometry(r, 14, 10);
      m.makeScale(sx, sy, sz).setPosition(c);
      g.applyMatrix4(m);
      add(g, bone);
    };
    const box = (bone, c, w, h, d, dir = null) => {
      const g = new BoxGeometry(w, h, d);
      if (dir) { q.setFromUnitVectors(new Vector3(1, 0, 0), dir); m.compose(c, q, new Vector3(1, 1, 1)); } else m.makeTranslation(c.x, c.y, c.z);
      g.applyMatrix4(m);
      add(g, bone);
    };
    // torso and head
    ball('pelvis', H.pelvis.clone().add(new Vector3(0, -0.02 * k, 0)), 0.1 * k, 1.45, 0.95, 1.0);
    capsule('spine_01', 'spine_01', 'spine_02', 0.12, 0.13);
    capsule('spine_02', 'spine_02', 'spine_03', 0.13, 0.145);
    ball('spine_03', H.spine_03.clone().add(new Vector3(0, 0.07 * k, 0)), 0.11 * k, 1.5, 1.1, 0.95);
    capsule('neck_01', 'neck_01', 'head', 0.05, 0.045);
    ball('head', H.head.clone().add(new Vector3(0, 0.1 * k, 0.012 * k)), 0.095 * k, 0.92, 1.12, 1.0);
    for (const s of ['l', 'r']) {
      const sg = s === 'l' ? 1 : -1;
      capsule(`clavicle_${s}`, `clavicle_${s}`, `upperarm_${s}`, 0.045, 0.05);
      capsule(`upperarm_${s}`, `upperarm_${s}`, `lowerarm_${s}`, 0.05, 0.04);
      capsule(`lowerarm_${s}`, `lowerarm_${s}`, `hand_${s}`, 0.04, 0.028);
      const mid = H[`middle_03_${s}`].clone().sub(H[`hand_${s}`]);
      const hc = H[`hand_${s}`].clone().addScaledVector(mid, 0.5);
      box(`hand_${s}`, hc, mid.length() * 1.2, 0.02 * k, 0.085 * k, mid.clone().normalize());
      capsule(`thigh_${s}`, `thigh_${s}`, `calf_${s}`, 0.085, 0.06);
      capsule(`calf_${s}`, `calf_${s}`, `foot_${s}`, 0.06, 0.042);
      box(`foot_${s}`, H[`foot_${s}`].clone().lerp(H[`ball_${s}`], 0.5).add(new Vector3(0, -0.02 * k, 0.01 * k)), 0.085 * k, 0.07 * k, 0.2 * k);
      ball(`ball_${s}`, H[`ball_${s}`].clone().add(new Vector3(0, 0.0, 0.03 * k)), 0.035 * k, 1.2, 0.8, 1.4);
      void sg;
    }
    const geo = mergeGeometries(parts);
    geo.computeBoundingSphere();
    const mesh = new SkinnedMesh(geo, new StandardMaterial({ color, roughness }));
    mesh.name = 'mannequin'; mesh.castShadow = true; mesh.frustumCulled = false;
    this.root.add(mesh);
    mesh.bind(this.skeleton);
    this.mesh = mesh;
    return mesh;
  }
}

void BufferGeometry; void Object3D;
