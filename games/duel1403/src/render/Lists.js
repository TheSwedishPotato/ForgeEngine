import {
  Mesh, Group, PlaneGeometry, CircleGeometry, CylinderGeometry, ConeGeometry, BoxGeometry, SphereGeometry,
  MeshStandardMaterial, DirectionalLight, HemisphereLight, InstancedMesh, Object3D, Color, DoubleSide,
  CapsuleGeometry, Vector3, BufferGeometry, Float32BufferAttribute, PlaneGeometry as PG,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { grassTexture, earthTexture, woodTexture, heraldryTexture, fabricTexture, rng } from './textures.js';
import { SUN_DIR } from './Sky.js';
import { HERALDRY } from '../data/opponents.js';
import { LISTS_RADIUS } from '../knight/Knight.js';
import { heightAt, inJoustField } from '../world/terrain.js';
import { LODInstancer, buildLODChain } from '../engine/geometry/LOD.js';
import { spruceGeometry, broadleafGeometry, onlookerParts } from './Foliage.js';
import { Cloth, windAt } from './Cloth.js';

/**
 * The lists below a Bohemian castle, autumn 1403: a ring fenced with
 * timber, banners of the kingdom, a judges' stand, pavilions, onlookers,
 * the village and its church, and a castle on the hill.
 */
export class Lists {
  constructor(scene, { quality = 'high', terrain = false } = {}) {
    // With the Med Engine terrain, things stand on the real ground height.
    const groundY = terrain ? heightAt : () => 0;
    this.scene = scene;
    this.group = new Group();
    scene.add(this.group);
    this.time = 0;
    const rand = rng(1403);

    // ---- light --------------------------------------------------------------
    const hemi = new HemisphereLight(0xc9d6e6, 0x5d5a3c, 0.85);
    this.group.add(hemi);
    const sun = new DirectionalLight(0xffe2b8, 2.6);
    sun.position.copy(SUN_DIR).multiplyScalar(30);
    sun.castShadow = true;
    const ss = quality === 'high' ? 4096 : quality === 'medium' ? 2048 : 1024;
    sun.shadow.mapSize.set(ss, ss);
    sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.userData.keyLight = true;
    this.group.add(sun, sun.target);
    this.sun = sun;

    // ---- ground ----------------------------------------------------------------
    const gt = grassTexture().clone();
    gt.needsUpdate = true;
    gt.repeat.set(160, 160);
    const ground = new Mesh(new PlaneGeometry(900, 900, 1, 1), new MeshStandardMaterial({ map: gt, roughness: 0.96 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.flatGround = [ground];
    const et = earthTexture().clone();
    et.needsUpdate = true;
    et.repeat.set(5, 5);
    const arena = new Mesh(new CircleGeometry(LISTS_RADIUS + 1.4, 64), new MeshStandardMaterial({ map: et, roughness: 1 }));
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.003;
    arena.receiveShadow = true;
    this.group.add(arena);
    this.flatGround.push(arena);

    // ---- the fence of the lists ---------------------------------------------
    const R = LISTS_RADIUS + 1.2;
    const wood = new MeshStandardMaterial({ map: woodTexture('#6e5236'), roughness: 0.85 });
    const posts = [], rails = [];
    const nPosts = 36;
    for (let i = 0; i < nPosts; i++) {
      const a = (i / nPosts) * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2 - Math.PI / 4)) < 0.05) continue; // gate
      const p = new CylinderGeometry(0.07, 0.08, 1.25, 7);
      p.translate(Math.cos(a) * R, 0.62, Math.sin(a) * R);
      posts.push(p);
      const a2 = ((i + 1) / nPosts) * Math.PI * 2;
      const mid = (a + a2) / 2, len = 2 * R * Math.sin((a2 - a) / 2);
      for (const h of [0.55, 1.05]) {
        const r = new BoxGeometry(len + 0.1, 0.09, 0.06);
        r.rotateY(-mid + Math.PI / 2);
        r.translate(Math.cos(mid) * R * Math.cos((a2 - a) / 2), h, Math.sin(mid) * R * Math.cos((a2 - a) / 2));
        rails.push(r);
      }
    }
    const fence = new Mesh(mergeGeometries([...posts, ...rails]), wood);
    fence.castShadow = true;
    fence.receiveShadow = true;
    this.group.add(fence);

    // ---- banners of the kingdom ------------------------------------------------
    this.flags = [];
    const flagMat = new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.bohemia), side: DoubleSide, roughness: 0.85 });
    const flagMat2 = new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.rozmberk), side: DoubleSide, roughness: 0.85 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * (R + 0.6), z = Math.sin(a) * (R + 0.6);
      const pole = new Mesh(new CylinderGeometry(0.035, 0.045, 5.2, 8), wood);
      pole.position.set(x, 2.6, z);
      pole.castShadow = true;
      this.group.add(pole);
      const geo = new PG(1.2, 0.9, 16, 4);
      geo.translate(0.6, 0, 0);
      const flag = new Mesh(geo, i % 3 === 2 ? flagMat2 : flagMat);
      flag.position.set(x, 4.7, z);
      flag.castShadow = true;
      this.group.add(flag);
      this.flags.push({ mesh: flag, cloth: new Cloth(geo, { pin: (px) => px < 0.01, widthSegments: 16, heightSegments: 4, mass: 0.2 }) });
    }

    // ---- judges' stand with canopy ----------------------------------------------------
    {
      const stand = new Group();
      const plat = new Mesh(new BoxGeometry(5, 0.8, 2.4), wood);
      plat.position.y = 0.4;
      stand.add(plat);
      for (const sx of [-2.3, 2.3]) for (const sz of [-1.0, 1.0]) {
        const p = new Mesh(new CylinderGeometry(0.06, 0.06, 2.6, 6), wood);
        p.position.set(sx, 2.1, sz);
        stand.add(p);
      }
      const canopy = new Mesh(new BoxGeometry(5.4, 0.08, 2.8), new MeshStandardMaterial({ map: fabricTexture('#9a1c1c', { stripes: '#e9e2d0' }), roughness: 0.85 }));
      canopy.position.y = 3.4;
      stand.add(canopy);
      const drape = new Mesh(new PG(5, 0.7), new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.bohemia), side: DoubleSide }));
      drape.position.set(0, 0.4, 1.21);
      stand.add(drape);
      stand.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      stand.position.set(0, 0, R + 3.2);
      stand.rotation.y = Math.PI;
      this.group.add(stand);
    }

    // ---- pavilions --------------------------------------------------------------------------
    const tentCols = [['#e9e2d0', '#9a1c1c'], ['#e9e2d0', '#1c3a6a'], ['#d8c060', '#2e4a2a']];
    for (let i = 0; i < 4; i++) {
      const a = 2.2 + i * 0.62;
      const d = 14 + (i % 2) * 4;
      const [c1, c2] = tentCols[i % 3];
      const mat = new MeshStandardMaterial({ map: fabricTexture(c1, { stripes: c2 }), roughness: 0.9, side: DoubleSide });
      mat.map = mat.map.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(4, 1);
      const wall = new Mesh(new CylinderGeometry(2.2, 2.2, 2.0, 24, 1, true), mat);
      wall.position.set(Math.cos(a) * d, 1.0, Math.sin(a) * d);
      const roof = new Mesh(new ConeGeometry(2.6, 2.0, 24, 1, true), mat);
      roof.position.set(wall.position.x, 3.0, wall.position.z);
      const pole = new Mesh(new CylinderGeometry(0.03, 0.03, 1.2, 6), wood);
      pole.position.set(wall.position.x, 4.4, wall.position.z);
      for (const m of [wall, roof, pole]) { m.castShadow = true; this.group.add(m); }
    }

    // ---- onlookers at the fence ------------------------------------------------------------
    if (terrain) this._detailedCrowd(R, rand, quality);
    else {
    {
      const n = quality === 'low' ? 40 : 90;
      const bodyGeo = new CapsuleGeometry(0.2, 0.75, 4, 8);
      bodyGeo.translate(0, 0.6, 0);
      const headGeo = new SphereGeometry(0.11, 10, 8);
      headGeo.translate(0, 1.45, 0);
      const hoodGeo = new SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
      hoodGeo.translate(0, 1.47, -0.01);
      const bodies = new InstancedMesh(bodyGeo, new MeshStandardMaterial({ roughness: 0.95 }), n);
      const heads = new InstancedMesh(headGeo, new MeshStandardMaterial({ color: '#c99a78', roughness: 0.7 }), n);
      const hoods = new InstancedMesh(hoodGeo, new MeshStandardMaterial({ roughness: 0.95 }), n);
      const cloths = ['#6a5a40', '#7a1c1c', '#3a4a2a', '#4a3a2a', '#8a7a5a', '#2a2a3a', '#9a6a2a', '#5a2a3a', '#d6ccb0'];
      const o = new Object3D();
      this.crowd = [];
      let k = 0;
      for (let i = 0; i < n; i++) {
        let a = rand() * Math.PI * 2;
        if (Math.abs(Math.sin(a / 2 - Math.PI / 4)) < 0.08) a += 0.3;
        const d = R + 0.55 + rand() * 1.6 + (rand() < 0.3 ? 1.2 : 0);
        o.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
        o.lookAt(0, 0, 0);
        const sc = 0.92 + rand() * 0.16;
        o.scale.setScalar(sc);
        o.updateMatrix();
        bodies.setMatrixAt(k, o.matrix);
        heads.setMatrixAt(k, o.matrix);
        hoods.setMatrixAt(k, o.matrix);
        bodies.setColorAt(k, new Color(cloths[Math.floor(rand() * cloths.length)]));
        hoods.setColorAt(k, new Color(cloths[Math.floor(rand() * cloths.length)]).multiplyScalar(rand() < 0.5 ? 1 : 0.7));
        this.crowd.push({ pos: o.position.clone(), rot: o.quaternion.clone(), sc, phase: rand() * 10 });
        k++;
      }
      for (const m of [bodies, heads, hoods]) { m.castShadow = true; this.group.add(m); }
      this.crowdMeshes = [bodies, heads, hoods];
    }

    }
    // ---- trees ---------------------------------------------------------------------------------
    if (terrain) this._detailedTrees(rand, quality, groundY);
    else {
    {
      const nT = quality === 'low' ? 120 : 260;
      const spruce = new InstancedMesh(mergeGeometries([new ConeGeometry(2.2, 7, 7).translate(0, 5, 0), new ConeGeometry(1.6, 5, 7).translate(0, 8, 0), new CylinderGeometry(0.25, 0.3, 2.2, 5).translate(0, 1.1, 0)].map((g) => g.toNonIndexed())), new MeshStandardMaterial({ color: '#2f4227', roughness: 1, flatShading: true }), nT);
      const leafy = new InstancedMesh(mergeGeometries([new SphereGeometry(2.6, 7, 5).translate(0, 5.2, 0), new SphereGeometry(1.9, 7, 5).translate(1.2, 6.4, 0.6), new CylinderGeometry(0.28, 0.36, 3.6, 5).translate(0, 1.8, 0)].map((g) => g.toNonIndexed())), new MeshStandardMaterial({ roughness: 1, flatShading: true }), nT);
      const o = new Object3D();
      const autumn = ['#7a6a2a', '#9a5a1e', '#6a7a2e', '#a8742a', '#5c6a26', '#8a3a1a'];
      for (let i = 0; i < nT; i++) {
        for (const [mesh, isLeafy] of [[spruce, false], [leafy, true]]) {
          let x, z;
          do { x = (rand() - 0.5) * 420; z = (rand() - 0.5) * 420; } while (Math.hypot(x, z) < 26 || (z > 70 && Math.abs(x - 10) < 70) || inJoustField(x, z, 6));
          o.position.set(x, groundY(x, z) - 0.25, z);
          o.rotation.y = rand() * 6;
          o.scale.setScalar(0.7 + rand() * 0.8);
          o.updateMatrix();
          mesh.setMatrixAt(i, o.matrix);
          if (isLeafy) mesh.setColorAt(i, new Color(autumn[Math.floor(rand() * autumn.length)]));
        }
      }
      spruce.castShadow = leafy.castShadow = true;
      this.group.add(spruce, leafy);
    }

    }
    // ---- hills, the castle on its rock, the village ------------------------------------------
    {
      // Until the engine's terrain has been built (a few seconds, in a worker),
      // a coarse copy of the same land: the same height function on a 10 m
      // grid, so the town, the road and the castle terrace stand where they
      // will stand (the old dome hills buried the north of the town).
      const hillMat = new MeshStandardMaterial({ color: '#56653a', roughness: 1 });
      {
        const N = 120, S = 1200, step = S / N;
        const geo = new PlaneGeometry(S, S, N, N);
        geo.rotateX(-Math.PI / 2);
        const P = geo.attributes.position;
        for (let i = 0; i < P.count; i++) P.setY(i, heightAt(P.getX(i), P.getZ(i)) - 0.06);
        geo.computeVertexNormals();
        const land = new Mesh(geo, hillMat);
        land.receiveShadow = true;
        this.group.add(land);
        (this.hills ??= []).push(land);
        void step;
      }
      // The castle, the church and the town's houses are drawn by TownMesh (src/render/TownMesh.js).
    }
    void Vector3; void BufferGeometry; void Float32BufferAttribute;
  }

  /**
   * Detailed spectators with LOD chains (QEM-simplified), split into parts so
   * clothes, faces and headwear each get their own colours.
   */
  _detailedCrowd(R, rand, quality) {
    const n = quality === 'low' ? 50 : 110;
    const parts = onlookerParts();
    const mk = (geo, color, name, count) => {
      const chain = buildLODChain(geo, [1, 0.4, 0.12]);
      const mat = new MeshStandardMaterial({ roughness: name === 'head' ? 0.6 : 0.92, vertexColors: true, color });
      if (name !== 'head') mat.userData.cloth = true;
      return new LODInstancer(chain.map((c, i) => ({ geometry: c.geometry, distance: [14, 32, Infinity][i] })), mat, count, { name: 'crowd-' + name });
    };
    const cloths = ['#6a5a40', '#7a1c1c', '#3a4a2a', '#4a3a2a', '#8a7a5a', '#2a2a3a', '#9a6a2a', '#5a2a3a', '#d6ccb0', '#3c4c6a'];
    const skins = ['#e0b896', '#d2a07c', '#c48e6a', '#e8c4a4', '#b98462'];
    const people = [];
    for (let i = 0; i < n; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(Math.sin(a / 2 - Math.PI / 4)) < 0.08) a += 0.3;
      const d = R + 0.55 + rand() * 1.6 + (rand() < 0.3 ? 1.2 : 0);
      people.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, sc: 0.92 + rand() * 0.16, phase: rand() * 10, hat: rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2,
        cloth: new Color(cloths[Math.floor(rand() * cloths.length)]), skin: new Color(skins[Math.floor(rand() * skins.length)]), wear: new Color(cloths[Math.floor(rand() * cloths.length)]).multiplyScalar(rand() < 0.5 ? 1 : 0.7) });
    }
    this.people = people;
    this.crowdLod = {
      body: mk(parts.body, '#ffffff', 'body', n),
      head: mk(parts.head, '#ffffff', 'head', n),
      hood: mk(parts.hood, '#ffffff', 'hood', people.filter((p) => p.hat === 0).length),
      hat: mk(parts.hat, '#ffffff', 'hat', people.filter((p) => p.hat === 1).length),
    };
    for (const l of Object.values(this.crowdLod)) this.group.add(l.group);
    this._poseCrowd(0, 0);
  }

  _poseCrowd(t, excitement) {
    const o = new Object3D();
    let ih = 0, it = 0;
    const C = this.crowdLod;
    this.people.forEach((p, i) => {
      o.position.set(p.x, Math.max(0, Math.sin(t * 7 + p.phase) * 0.08 * excitement), p.z);
      o.rotation.set(0, 0, 0);
      o.lookAt(0, o.position.y, 0);
      o.rotateZ(Math.sin(t * 0.8 + p.phase) * 0.03);
      o.scale.setScalar(p.sc);
      o.updateMatrix();
      C.body.setInstance(i, o.matrix, p.cloth);
      C.head.setInstance(i, o.matrix, p.skin);
      if (p.hat === 0) C.hood.setInstance(ih++, o.matrix, p.wear);
      else if (p.hat === 1) C.hat.setInstance(it++, o.matrix, p.wear);
    });
  }

  /** Detailed spruces and autumn broadleaves on the terrain, with LOD chains. */
  _detailedTrees(rand, quality, groundY) {
    const nT = quality === 'low' ? 140 : 300;
    const spruceChain = buildLODChain(spruceGeometry(7), [1, 0.3, 0.08, 0.02]);
    const leafChain = buildLODChain(broadleafGeometry(11), [1, 0.3, 0.08, 0.02]);
    const dists = [45, 110, 240, Infinity];
    const spruceMat = new MeshStandardMaterial({ roughness: 0.95, vertexColors: true });
    spruceMat.userData.foliage = true;
    const leafMat = new MeshStandardMaterial({ roughness: 0.9, vertexColors: true });
    leafMat.userData.foliage = true;
    // Instances are bucketed into 115 m cells, one LOD instancer per cell and
    // species, so the camera and each shadow cascade cull whole cells.
    const CELL = 115;
    const cells = new Map();
    const cellOf = (x, z, leafy) => {
      const k = `${leafy ? 'b' : 's'}${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      let c = cells.get(k);
      if (!c) { c = { leafy, list: [] }; cells.set(k, c); }
      return c;
    };
    const o = new Object3D();
    const autumn = ['#c9a23a', '#c8642a', '#9aa83a', '#d89a3a', '#8c9a2e', '#b8441e', '#e0b040'];
    for (let i = 0; i < nT; i++) {
      for (const isLeafy of [false, true]) {
        let x, z;
        do { x = (rand() - 0.5) * 460; z = (rand() - 0.5) * 460; } while (Math.hypot(x, z) < 28 || (z > 55 && z < 145 && Math.abs(x) < 80) || inJoustField(x, z, 6));
        o.position.set(x, groundY(x, z) - 0.2, z);
        o.rotation.set(0, rand() * 6, 0);
        o.scale.setScalar(0.7 + rand() * 0.8);
        o.updateMatrix();
        cellOf(x, z, isLeafy).list.push({ m: o.matrix.clone(), c: isLeafy ? new Color(autumn[Math.floor(rand() * autumn.length)]) : new Color(1, 1, 1).multiplyScalar(0.85 + rand() * 0.3) });
      }
    }
    this.treeLod = [];
    for (const [k, c] of cells) {
      const chain = c.leafy ? leafChain : spruceChain;
      const inst = new LODInstancer(chain.map((ch, i) => ({ geometry: ch.geometry, distance: dists[i] })), c.leafy ? leafMat : spruceMat, c.list.length, { name: (c.leafy ? 'broadleaf-' : 'spruce-') + k });
      c.list.forEach((e, i) => inst.setInstance(i, e.m, e.c));
      inst.leafy = c.leafy;
      this.treeLod.push(inst);
      this.group.add(inst.group);
    }
    const sum = (leafy) => this.treeLod.filter((t) => t.leafy === leafy).reduce((acc, t) => acc.map((v, i) => v + t.stats[i]), [0, 0, 0, 0]);
    this.lodStats = () => ({ spruce: sum(false), broadleaf: sum(true), triangles: { spruce: spruceChain.map((c) => c.triangles), broadleaf: leafChain.map((c) => c.triangles), onlooker: buildTris(this.crowdLod) } });
  }

  /** The Med Engine terrain has arrived: retire the flat ground and the dome hills. */
  useTerrain() {
    for (const m of [...(this.flatGround ?? []), ...(this.hills ?? [])]) m.visible = false;
  }

  update(dt, excitement = 0) {
    this.time += dt;
    const t = this.time;
    // the banners of the kingdom stream in the wind (Verlet cloth, see Cloth.js)
    const wind = windAt(t);
    for (const f of this.flags) f.cloth.step(dt, wind);
    // LOD selection for the detailed scenery, from the camera.
    if (this.camera) {
      const cp = this.camera.position;
      for (const l of this.treeLod ?? []) l.update(cp);
      if (this.crowdLod) {
        this._poseCrowd(t, excitement);
        for (const l of Object.values(this.crowdLod)) { l._built = false; l.update(cp); }
      }
    }
    // The crowd sways and, when the fight is hot, jumps.
    if (this.crowd) {
      const o = new Object3D();
      for (let i = 0; i < this.crowd.length; i++) {
        const c = this.crowd[i];
        o.position.copy(c.pos);
        o.quaternion.copy(c.rot);
        o.position.y = Math.max(0, Math.sin(t * 7 + c.phase) * 0.08 * excitement);
        o.rotateZ(Math.sin(t * 0.8 + c.phase) * 0.03);
        o.scale.setScalar(c.sc);
        o.updateMatrix();
        for (const m of this.crowdMeshes) m.setMatrixAt(i, o.matrix);
      }
      for (const m of this.crowdMeshes) m.instanceMatrix.needsUpdate = true;
    }
  }
}

function buildTris(c) { return c ? Object.fromEntries(Object.entries(c).map(([k, l]) => [k, l.levels.map((v) => v.geometry.index.count / 3)])) : null; }
