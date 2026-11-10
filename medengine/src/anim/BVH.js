/**
 * BVH motion capture files: parser and forward kinematics.
 *
 * BVH stores a joint hierarchy (an OFFSET per joint: where it sits relative to its parent when no
 * rotation is applied) and, for every frame, the values of each joint's channels. Rotation channels
 * apply in the order they are listed: for `Zrotation Yrotation Xrotation` the joint's rotation is
 * Rz * Ry * Rx. Right-handed, Y up (the Carnegie Mellon files face +Z in their T-pose).
 *
 * `parseBVH` is tolerant: tabs or spaces, CRLF, "Frame Time:" with or without a leading zero, files
 * whose last frame is cut short.
 */

const AXIS = { x: 0, y: 1, z: 2 };

/** @typedef {{ name: string, parent: number, offset: number[], channels: string[], chan: number, rotOrder: string, isEnd: boolean }} BVHJoint */

/**
 * One frame in world space, as `BVHData.pose` writes it: `q` holds x, y, z, w per joint and `p` holds x, y, z per joint.
 * @typedef {{ q: Float64Array, p: Float64Array }} BVHPose
 */

export class BVHData {
  constructor() {
    /** @type {BVHJoint[]} */ this.joints = [];
    this.frames = 0;
    this.frameTime = 1 / 30;
    this.channelCount = 0;
    /** @type {Float32Array} frames x channelCount, in file order */ this.data = new Float32Array(0);
    this.name = '';
  }
  get fps() { return 1 / this.frameTime; }
  get duration() { return Math.max(0, this.frames - 1) * this.frameTime; }
  index(name) { return this.joints.findIndex((j) => j.name === name); }
  /** Joints that are real bones (End Sites are not). */
  get bones() { return this.joints.filter((j) => !j.isEnd); }
  childrenOf(i) { const out = []; for (let k = 0; k < this.joints.length; k++) if (this.joints[k].parent === i) out.push(k); return out; }

  /**
   * Forward kinematics of one frame: world rotations (quaternion x,y,z,w per joint) and positions
   * (metres, after `scale`) into `out`. `out` is { q: Float64Array(4n), p: Float64Array(3n) }.
   * @param {number} frame  frame index
   * @param {number} [scale]  multiplies the file's lengths to give metres
   * @param {BVHPose | null} [out]  filled in place when given, so a loop does not allocate
   * @returns {BVHPose}
   */
  pose(frame, scale = 1, out = null) {
    const n = this.joints.length;
    out ??= { q: new Float64Array(n * 4), p: new Float64Array(n * 3) };
    const row = frame * this.channelCount, d = this.data;
    const lq = [0, 0, 0, 1];
    for (let i = 0; i < n; i++) {
      const j = this.joints[i];
      // local rotation from the channels, in listed order
      let qx = 0, qy = 0, qz = 0, qw = 1, px = j.offset[0], py = j.offset[1], pz = j.offset[2];
      for (let c = 0; c < j.channels.length; c++) {
        const ch = j.channels[c], v = d[row + j.chan + c];
        if (ch.endsWith('position')) {
          const a = AXIS[ch[0].toLowerCase()];
          if (a === 0) px = v; else if (a === 1) py = v; else pz = v;
        } else {
          const a = AXIS[ch[0].toLowerCase()], h = (v * Math.PI) / 360, s = Math.sin(h);
          lq[0] = a === 0 ? s : 0; lq[1] = a === 1 ? s : 0; lq[2] = a === 2 ? s : 0; lq[3] = Math.cos(h);
          const x = qx, y = qy, z = qz, w = qw;           // q = q * lq
          qx = w * lq[0] + x * lq[3] + y * lq[2] - z * lq[1];
          qy = w * lq[1] - x * lq[2] + y * lq[3] + z * lq[0];
          qz = w * lq[2] + x * lq[1] - y * lq[0] + z * lq[3];
          qw = w * lq[3] - x * lq[0] - y * lq[1] - z * lq[2];
        }
      }
      px *= scale; py *= scale; pz *= scale;
      const o4 = i * 4, o3 = i * 3;
      if (j.parent < 0) {
        out.q[o4] = qx; out.q[o4 + 1] = qy; out.q[o4 + 2] = qz; out.q[o4 + 3] = qw;
        out.p[o3] = px; out.p[o3 + 1] = py; out.p[o3 + 2] = pz;
      } else {
        const p4 = j.parent * 4, p3 = j.parent * 3, Q = out.q;
        const ax = Q[p4], ay = Q[p4 + 1], az = Q[p4 + 2], aw = Q[p4 + 3];
        // world position = parent position + parent rotation * offset
        const tx = 2 * (ay * pz - az * py), ty = 2 * (az * px - ax * pz), tz = 2 * (ax * py - ay * px);
        out.p[o3] = out.p[p3] + px + aw * tx + (ay * tz - az * ty);
        out.p[o3 + 1] = out.p[p3 + 1] + py + aw * ty + (az * tx - ax * tz);
        out.p[o3 + 2] = out.p[p3 + 2] + pz + aw * tz + (ax * ty - ay * tx);
        // world rotation = parent * local
        Q[o4] = aw * qx + ax * qw + ay * qz - az * qy;
        Q[o4 + 1] = aw * qy - ax * qz + ay * qw + az * qx;
        Q[o4 + 2] = aw * qz + ax * qy - ay * qx + az * qw;
        Q[o4 + 3] = aw * qw - ax * qx - ay * qy - az * qz;
      }
    }
    return out;
  }
}

/** Parses BVH text into a BVHData. */
export function parseBVH(text, name = '') {
  const tok = text.replace(/\r/g, '').split(/\s+/).filter(Boolean);
  let i = 0;
  const bvh = new BVHData();
  bvh.name = name;
  const expect = (s) => { if (tok[i]?.toUpperCase() !== s) throw new Error(`BVH: expected "${s}" but found "${tok[i]}" near token ${i}`); i++; };
  if (tok[i]?.toUpperCase() !== 'HIERARCHY') throw new Error('BVH: missing HIERARCHY');
  i++;
  let channelCount = 0;
  const parseJoint = (parent, isEnd) => {
    const joint = { name: isEnd ? `${bvh.joints[parent]?.name ?? 'End'}_end` : tok[i++], parent, offset: [0, 0, 0], channels: [], chan: channelCount, rotOrder: '', isEnd };
    if (isEnd) { expect('SITE'); }
    const idx = bvh.joints.length;
    bvh.joints.push(joint);
    expect('{');
    for (;;) {
      const t = tok[i++]?.toUpperCase();
      if (t === 'OFFSET') { joint.offset = [parseFloat(tok[i]), parseFloat(tok[i + 1]), parseFloat(tok[i + 2])]; i += 3; }
      else if (t === 'CHANNELS') {
        const n = parseInt(tok[i++], 10);
        for (let k = 0; k < n; k++) joint.channels.push(tok[i++]);
        joint.chan = channelCount; channelCount += n;
        joint.rotOrder = joint.channels.filter((c) => c.endsWith('rotation')).map((c) => c[0].toUpperCase()).join('');
      } else if (t === 'JOINT') parseJoint(idx, false);
      else if (t === 'END') parseJoint(idx, true);
      else if (t === '}') break;
      else throw new Error(`BVH: unexpected "${t}" in hierarchy`);
    }
  };
  expect('ROOT');
  parseJoint(-1, false);
  bvh.channelCount = channelCount;
  expect('MOTION');
  expect('FRAMES:'); const frames = parseInt(tok[i++], 10);
  if (tok[i]?.toUpperCase() === 'FRAME') { i++; if (tok[i]?.toUpperCase() === 'TIME:') i++; else throw new Error('BVH: bad "Frame Time"'); }
  else throw new Error('BVH: missing Frame Time');
  bvh.frameTime = parseFloat(tok[i++]);
  if (!(bvh.frameTime > 0)) bvh.frameTime = 1 / 30;
  const avail = Math.floor((tok.length - i) / channelCount);
  const n = Math.min(frames, avail);
  bvh.frames = n;
  bvh.data = new Float32Array(n * channelCount);
  for (let k = 0; k < n * channelCount; k++) bvh.data[k] = parseFloat(tok[i + k]);
  return bvh;
}

/**
 * Writes a BVH back to text (used by the trimming tool: fewer frames, fewer decimals).
 * @param {BVHData} bvh
 * @param {{ fps?: number | null, decimals?: number }} [o]  `fps` drops frames to get near that rate (default: keep all); `decimals` is how many a channel value keeps (3)
 * @returns {string}
 */
export function writeBVH(bvh, { fps = null, decimals = 3 } = {}) {
  const lines = ['HIERARCHY'];
  const f = (v) => (+v.toFixed(5)).toString();
  const emit = (i, depth) => {
    const j = bvh.joints[i], pad = '\t'.repeat(depth);
    if (j.isEnd) lines.push(`${pad}End Site`);
    else lines.push(`${pad}${j.parent < 0 ? 'ROOT' : 'JOINT'} ${j.name}`);
    lines.push(`${pad}{`);
    lines.push(`${pad}\tOFFSET ${j.offset.map(f).join(' ')}`);
    if (!j.isEnd) lines.push(`${pad}\tCHANNELS ${j.channels.length} ${j.channels.join(' ')}`);
    for (const c of bvh.childrenOf(i)) emit(c, depth + 1);
    lines.push(`${pad}}`);
  };
  emit(0, 0);
  const step = fps ? Math.max(1, Math.round(bvh.fps / fps)) : 1;
  const out = [];
  for (let fr = 0; fr < bvh.frames; fr += step) out.push(Array.from(bvh.data.subarray(fr * bvh.channelCount, (fr + 1) * bvh.channelCount), (v) => (+v.toFixed(decimals)).toString()).join(' '));
  lines.push('MOTION', `Frames: ${out.length}`, `Frame Time: ${(bvh.frameTime * step).toFixed(7)}`, ...out);
  return lines.join('\n') + '\n';
}
