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

/**
 * The lists below a Bohemian castle, autumn 1403: a ring fenced with
 * timber, banners of the kingdom, a judges' stand, pavilions, onlookers,
 * the village and its church, and a castle on the hill.
 */
export class Lists {
  constructor(scene, { quality = 'high' } = {}) {
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
    const et = earthTexture().clone();
    et.needsUpdate = true;
    et.repeat.set(5, 5);
    const arena = new Mesh(new CircleGeometry(LISTS_RADIUS + 1.4, 64), new MeshStandardMaterial({ map: et, roughness: 1 }));
    arena.rotation.x = -Math.PI / 2;
    arena.position.y = 0.003;
    arena.receiveShadow = true;
    this.group.add(arena);

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
      this.flags.push({ mesh: flag, base: geo.attributes.position.array.slice(), phase: rand() * 6 });
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

    // ---- trees ---------------------------------------------------------------------------------
    {
      const nT = quality === 'low' ? 120 : 260;
      const spruce = new InstancedMesh(mergeGeometries([new ConeGeometry(2.2, 7, 7).translate(0, 5, 0), new ConeGeometry(1.6, 5, 7).translate(0, 8, 0), new CylinderGeometry(0.25, 0.3, 2.2, 5).translate(0, 1.1, 0)].map((g) => g.toNonIndexed())), new MeshStandardMaterial({ color: '#2f4227', roughness: 1, flatShading: true }), nT);
      const leafy = new InstancedMesh(mergeGeometries([new SphereGeometry(2.6, 7, 5).translate(0, 5.2, 0), new SphereGeometry(1.9, 7, 5).translate(1.2, 6.4, 0.6), new CylinderGeometry(0.28, 0.36, 3.6, 5).translate(0, 1.8, 0)].map((g) => g.toNonIndexed())), new MeshStandardMaterial({ roughness: 1, flatShading: true }), nT);
      const o = new Object3D();
      const autumn = ['#7a6a2a', '#9a5a1e', '#6a7a2e', '#a8742a', '#5c6a26', '#8a3a1a'];
      for (let i = 0; i < nT; i++) {
        for (const [mesh, isLeafy] of [[spruce, false], [leafy, true]]) {
          let x, z;
          do { x = (rand() - 0.5) * 420; z = (rand() - 0.5) * 420; } while (Math.hypot(x, z) < 26 || (z > 70 && Math.abs(x - 10) < 70));
          o.position.set(x, 0, z);
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

    // ---- hills, the castle on its rock, the village ------------------------------------------
    {
      const hillMat = new MeshStandardMaterial({ color: '#56653a', roughness: 1, flatShading: true });
      for (const [x, z, r, h] of [[30, 230, 120, 55], [-160, 260, 140, 40], [210, 180, 110, 35], [-260, -120, 150, 45], [180, -260, 160, 50], [0, -320, 180, 38]]) {
        const hill = new Mesh(new SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
        hill.scale.y = h / r;
        hill.position.set(x, -2, z);
        this.group.add(hill);
      }
      const stone = new MeshStandardMaterial({ color: '#cfc6b2', roughness: 0.95 });
      const roofMat = new MeshStandardMaterial({ color: '#8a3c26', roughness: 0.9, flatShading: true });
      const castle = new Group();
      const keep = new Mesh(new BoxGeometry(9, 26, 9), stone);
      keep.position.set(0, 13, 0);
      const keepRoof = new Mesh(new ConeGeometry(7.4, 9, 4), roofMat);
      keepRoof.rotation.y = Math.PI / 4;
      keepRoof.position.set(0, 30.5, 0);
      const tower = new Mesh(new CylinderGeometry(4, 4.4, 20, 16), stone);
      tower.position.set(-16, 10, 6);
      const towerRoof = new Mesh(new ConeGeometry(5, 9, 16), roofMat);
      towerRoof.position.set(-16, 24.5, 6);
      const hall = new Mesh(new BoxGeometry(18, 11, 9), stone);
      hall.position.set(13, 5.5, 2);
      const hallRoof = new Mesh(new CylinderGeometry(0.01, 7, 18, 4, 1), roofMat);
      hallRoof.rotation.z = Math.PI / 2;
      hallRoof.rotation.x = Math.PI / 4;
      hallRoof.scale.set(1, 1, 0.75);
      hallRoof.position.set(13, 13.5, 2);
      const wall = new Mesh(new BoxGeometry(48, 8, 2), stone);
      wall.position.set(-2, 4, -12);
      const wall2 = new Mesh(new BoxGeometry(2, 8, 30), stone);
      wall2.position.set(-25, 4, 0);
      for (const m of [keep, keepRoof, tower, towerRoof, hall, hallRoof, wall, wall2]) castle.add(m);
      // crenellations
      const cren = [];
      for (let i = 0; i < 22; i++) cren.push(new BoxGeometry(1, 1.2, 2).translate(-25 + i * 2.2, 8.6, -12));
      castle.add(new Mesh(mergeGeometries(cren), stone));
      castle.position.set(30, 52, 230);
      castle.rotation.y = 0.3;
      this.group.add(castle);
      // Village below: timber houses with steep roofs, and a church.
      const plaster = new MeshStandardMaterial({ color: '#d9d0bb', roughness: 0.95 });
      const thatch = new MeshStandardMaterial({ color: '#7d6a44', roughness: 1, flatShading: true });
      const houses = [], roofs = [];
      for (let i = 0; i < 24; i++) {
        const x = -60 + rand() * 120, z = 70 + rand() * 60;
        const w = 5 + rand() * 3, d = 7 + rand() * 4, h = 3 + rand() * 1.5;
        const ry = rand() * 0.6 - 0.3;
        houses.push(new BoxGeometry(w, h, d).rotateY(ry).translate(x, h / 2, z));
        const roof = new CylinderGeometry(0.01, w * 0.75, d, 4, 1);
        roof.rotateX(Math.PI / 2);
        roof.rotateZ(Math.PI / 4);
        roof.scale(1, 1.6, 1);
        roof.rotateY(ry);
        roof.translate(x, h + w * 0.5, z);
        roofs.push(roof);
      }
      const hm = new Mesh(mergeGeometries(houses), plaster);
      const rm = new Mesh(mergeGeometries(roofs.map((r) => r.toNonIndexed())), thatch);
      hm.castShadow = rm.castShadow = true;
      this.group.add(hm, rm);
      const church = new Mesh(new BoxGeometry(5, 18, 5), plaster);
      church.position.set(-20, 9, 100);
      const spire = new Mesh(new ConeGeometry(3.8, 12, 4), roofMat);
      spire.rotation.y = Math.PI / 4;
      spire.position.set(-20, 24, 100);
      const nave = new Mesh(new BoxGeometry(9, 9, 18), plaster);
      nave.position.set(-20, 4.5, 112);
      this.group.add(church, spire, nave);
    }
    void Vector3; void BufferGeometry; void Float32BufferAttribute;
  }

  update(dt, excitement = 0) {
    this.time += dt;
    const t = this.time;
    for (const f of this.flags) {
      const pos = f.mesh.geometry.attributes.position;
      const b = f.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        const w = x / 1.2;
        pos.array[i * 3 + 2] = Math.sin(x * 4 - t * 4 + f.phase) * 0.08 * w + Math.sin(b[i * 3 + 1] * 3 + t * 2.3) * 0.03 * w;
      }
      pos.needsUpdate = true;
      f.mesh.geometry.computeVertexNormals();
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
