/**
 * Small vector, quaternion and matrix helpers on plain arrays, for the physics (which runs the
 * same headless in Node and in the browser, and allocates nothing in its inner loops).
 */
export const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
export const add = (a, b, o = [0, 0, 0]) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; };
export const sub = (a, b, o = [0, 0, 0]) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; };
export const scale = (a, s, o = [0, 0, 0]) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b, o = [0, 0, 0]) => {
  const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z; return o;
};
export const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Quaternion [x, y, z, w] rotating vector v (body -> world). */
export function qrot(q, v, o = [0, 0, 0]) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  // t = 2 q.xyz x v; v' = v + w t + q.xyz x t
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  o[0] = vx + w * tx + (y * tz - z * ty);
  o[1] = vy + w * ty + (z * tx - x * tz);
  o[2] = vz + w * tz + (x * ty - y * tx);
  return o;
}
/** Inverse rotation (world -> body). */
export function qrotInv(q, v, o = [0, 0, 0]) { return qrot([-q[0], -q[1], -q[2], q[3]], v, o); }
export function qmul(a, b, o = [0, 0, 0, 1]) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
  return o;
}
export function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; return q; }
/** Quaternion from an axis and angle. */
export function qaxis(ax, a) { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; }

/**
 * Heading, pitch and heel of a body orientation. Body axes: x forward, y up, z starboard;
 * world: X east, Y up, Z south. heading: compass bearing of the bow (radians, 0 north, + east);
 * pitch: bow up positive; heel: starboard down positive.
 */
export function attitude(q) {
  const f = qrot(q, [1, 0, 0]), s = qrot(q, [0, 0, 1]);
  const heading = Math.atan2(f[0], -f[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
  const heel = Math.asin(Math.max(-1, Math.min(1, -s[1])));
  return { heading: (heading + 2 * Math.PI) % (2 * Math.PI), pitch, heel };
}
/** Orientation from heading, pitch, heel (inverse of attitude). */
export function fromAttitude(heading, pitch = 0, heel = 0) {
  // yaw about world up (Y): body x (forward) to bearing; at heading 0 the bow faces north (-Z)
  const qy = qaxis([0, 1, 0], -heading + Math.PI / 2);
  const qp = qaxis([0, 0, 1], pitch);      // about the body's z (starboard) axis: bow up
  const qr = qaxis([1, 0, 0], heel);       // about the body's x axis: starboard down
  return qnorm(qmul(qmul(qy, qp), qr));
}

/** Solves A x = b for a dense n x n system (A as an array of rows), in place. */
export function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c, best = Math.abs(A[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > best) { best = Math.abs(A[r][c]); piv = r; }
    if (piv !== c) { const t = A[c]; A[c] = A[piv]; A[piv] = t; const tb = b[c]; b[c] = b[piv]; b[piv] = tb; }
    const d = A[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}
