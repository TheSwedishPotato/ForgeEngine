// Builds the BVH off the main thread (see BVH.js).
import { buildBVH } from './BVH.js';

self.onmessage = (e) => {
  const { positions, triCount } = e.data;
  const t0 = performance.now();
  const { nodes, tris } = buildBVH(positions, triCount);
  const flat = new Float32Array(nodes.length * 8);
  nodes.forEach((n, i) => flat.set([n.min[0], n.min[1], n.min[2], n.a, n.max[0], n.max[1], n.max[2], n.b], i * 8));
  self.postMessage({ nodes: flat, tris, ms: performance.now() - t0 }, [flat.buffer, tris.buffer]);
};
