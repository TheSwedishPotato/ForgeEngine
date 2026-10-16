// The vehicles stand on the rails: in every canted curve each wheel's tread meets its rail head
// (track.js lays the rails, trainGL.js poses the bodies on them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Object3D, Vector3 } from 'three';
import { Route } from '../src/world/route.js';
import { poseOnTrack } from '../src/render/trainGL.js';

const route = await Route.load();

test('in the curves the cars lean with the cant: every wheel on its rail', () => {
  const L = route.run, RP = 1.507, pose = {}, o = new Object3D();
  let worst = 0, n = 0;
  for (let s = 2000; s < 28000; s += 37) {
    if (Math.abs(L.cantAt(s)) < 0.03) continue;
    poseOnTrack(L, s + 9, s - 9, pose);
    o.position.set(pose.x, pose.z, -pose.y);
    o.rotation.copy(new Euler(pose.roll, pose.yaw, pose.pitch, 'YZX'));
    o.updateMatrixWorld();
    for (const x of [9, -9]) for (const side of [-1, 1]) {
      const w = new Vector3(x, 0, side * 0.75).applyMatrix4(o.matrixWorld);
      const q = s + x, k = L.curvatureAt(q), p = L.pos(q);
      const rail = p.z + side * 0.75 * Math.sin(-Math.atan2(L.cantAt(q), RP) * Math.sign(k));
      worst = Math.max(worst, Math.abs(w.y - rail));
    }
    n++;
  }
  assert.ok(n > 50, `canted curves sampled (${n})`);
  assert.ok(worst < 0.012, `a wheel ${(worst * 1000).toFixed(0)} mm off its rail`);
});
