import TerrainWorker from '../engine/geometry/terrain.worker.js?worker&inline';
import { ClusterMesh } from '../engine/geometry/ClusterMesh.js';
import { VirtualTexture, VirtualTexturePass } from '../engine/vt/VirtualTexture.js';

/**
 * The landscape on the Forge renderer: a fine 48 m patch under the lists
 * (~0.1 m spacing, ~400k triangles) and 1.2 km of country around it, both
 * as cluster hierarchies built in a worker, textured by one virtual texture.
 * Until the worker is done the old flat ground stands in.
 */
export class Terrain {
  constructor(stage, lists, { patchHalf = 24, patchN = 448, landSize = 1200, landN = 400 } = {}) {
    this.stage = stage;
    this.lists = lists;
    const r = stage.r;
    const qb = Number(new URLSearchParams(location.search).get('vtbudget'));
    this.vt = new VirtualTexture(r.gl, { worldSize: 1024, budget: qb || (r.q.renderScale >= 0.77 ? 10 : 6) });
    // first in the pass list: pages before the G-buffer, feedback right after it
    r.addPass(new VirtualTexturePass(this.vt), { first: true });
    this.ready = false;
    this.meshes = [];
    const t0 = performance.now();
    try {
      this.worker = new TerrainWorker();
      this.worker.onmessage = (e) => {
        if (!e.data.done) return;
        this._build(e.data);
        this.buildMs = performance.now() - t0;
        this.worker.terminate();
      };
      this.worker.postMessage({ patchHalf, patchN, landSize, landN });
    } catch (err) {
      console.warn('terrain worker unavailable', err);
    }
  }

  _build(d) {
    const r = this.stage.r;
    const patch = new ClusterMesh(r, d.patch, { vt: this.vt, name: 'terrain-patch' });
    const land = new ClusterMesh(r, d.land, { vt: this.vt, name: 'terrain-land' });
    this.meshes = [patch, land];
    for (const m of this.meshes) this.stage.scene.add(m);
    this.lists.useTerrain?.();
    this.ready = true;
    this.info = { patchTris: d.patch.sourceTris, landTris: d.land.sourceTris, clusters: d.patch.count + d.land.count, levels: Math.max(d.patch.levels, d.land.levels), workerMs: d.ms };
  }

  stats() {
    if (!this.ready) return null;
    return { ...this.info, drawnTris: this.meshes.reduce((s, m) => s + m.stats.triangles, 0), drawnClusters: this.meshes.reduce((s, m) => s + m.stats.clusters, 0), vt: { ...this.vt.stats } };
  }
}
