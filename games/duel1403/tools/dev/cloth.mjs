import { PlaneGeometry, Vector3 } from 'three';
import { Cloth, windAt } from '../../src/render/Cloth.js';
const geo = new PlaneGeometry(1.2, 0.9, 16, 4); geo.translate(0.6, 0, 0);
const c = new Cloth(geo, { pin: (x) => x < 0.01, widthSegments: 16, heightSegments: 4, mass: 0.2 });
for (let i = 0; i < 600; i++) { c.step(1 / 60, windAt(i / 60)); }
const p = geo.attributes.position.array; let mx = -9, my = 9, mz = 0, nan = 0;
for (let i = 0; i < p.length; i += 3) { if (!Number.isFinite(p[i])) nan++; mx = Math.max(mx, p[i]); my = Math.min(my, p[i + 1]); mz = Math.max(mz, Math.abs(p[i + 2])); }
console.log({ maxX: mx.toFixed(2), minY: my.toFixed(2), maxZ: mz.toFixed(2), nan });
