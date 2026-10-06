import {
  Vector3, Group, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry, ConeGeometry, MeshStandardMaterial, Object3D, Color, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { earthTexture, woodTexture, fabricTexture, heraldryTexture, rng } from './textures.js';
import { HERALDRY } from '../data/opponents.js';
import { LODInstancer, buildLODChain } from '../engine/geometry/LOD.js';
import { onlookerParts } from './Foliage.js';
import { FIELD } from '../joust/JoustSim.js';
import { Cloth, windAt } from './Cloth.js';

/**
 * The joust field, laid out as a joust at large was before the tilt: an open
 * run of raked earth fenced with timber (the tilt itself, a cloth-hung
 * barrier down the middle, is shown when a joust is run with it), a covered stand for the lords and
 * ladies with the heralds and judges in the middle, the commons along the
 * far fence, banners, and the jousters' pavilions at both ends.
 */
const _wl = new Vector3();

export class JoustField {
  constructor(scene, { quality = 'high' } = {}) {
    this.group = new Group();
    this.group.name = 'joust-field';
    scene.add(this.group);
    const rand = rng(1429);
    const C = FIELD.center, HL = FIELD.halfLength, HW = FIELD.halfWidth;
    const wood = new MeshStandardMaterial({ map: woodTexture('#6a4e32'), roughness: 0.85 });
    const darkWood = new MeshStandardMaterial({ map: woodTexture('#4a3422'), roughness: 0.9 });

    // ---- the run: raked earth ---------------------------------------------------------------
    const et = earthTexture().clone();
    et.needsUpdate = true;
    et.repeat.set(36, 3);
    const run = new Mesh(new PlaneGeometry(HL * 2 + 6, 7.5), new MeshStandardMaterial({ map: et, roughness: 1 }));
    run.rotation.x = -Math.PI / 2;
    run.position.set(C.x, 0.006, C.z);
    run.receiveShadow = true;
    this.group.add(run);

    // ---- fence -------------------------------------------------------------------------------
    const posts = [], rails = [];
    const side = (z) => {
      for (let x = -HL; x <= HL + 0.01; x += 2.6) {
        posts.push(new CylinderGeometry(0.07, 0.085, 1.3, 7).translate(C.x + x, 0.65, z));
      }
      for (const h of [0.6, 1.15]) rails.push(new BoxGeometry(HL * 2, 0.09, 0.07).translate(C.x, h, z));
    };
    side(C.z - HW); side(C.z + HW);
    for (const sx of [-1, 1]) {
      for (let z = -HW; z <= HW + 0.01; z += 2.6) if (Math.abs(z) > 2.4) posts.push(new CylinderGeometry(0.07, 0.085, 1.3, 7).translate(C.x + sx * HL, 0.65, C.z + z));
      for (const h of [0.6, 1.15]) for (const s of [-1, 1]) rails.push(new BoxGeometry(0.07, 0.09, HW - 2.4).translate(C.x + sx * HL, h, C.z + s * (HW + 2.4) / 2));
    }
    const fence = new Mesh(mergeGeometries([...posts, ...rails].map((g) => g.toNonIndexed())), wood);
    fence.castShadow = true; fence.receiveShadow = true;
    this.group.add(fence);

    // ---- the tilt (shown only when a joust is run with it) ---------------------------------
    {
      const tilt = new Group();
      tilt.name = 'joust-tilt';
      const len = (HL - 5) * 2, H = FIELD.tiltHeight, T = FIELD.tiltThickness;
      const tposts = [], trails = [];
      for (let x = -len / 2; x <= len / 2 + 0.01; x += 3) tposts.push(new BoxGeometry(0.14, H + 0.1, 0.14).translate(C.x + x, (H + 0.1) / 2, C.z));
      for (const y of [0.25, H - 0.06]) trails.push(new BoxGeometry(len, 0.12, T).translate(C.x, y, C.z));
      const frame = new Mesh(mergeGeometries([...tposts, ...trails].map((g) => g.toNonIndexed())), darkWood);
      frame.castShadow = true; frame.receiveShadow = true;
      tilt.add(frame);
      // the toile: painted cloth hung on the frame, both faces
      const toileTex = fabricTexture('#9a1a1e').clone(); toileTex.needsUpdate = true; toileTex.repeat.set(len / 3, 1);
      const toileMat = new MeshStandardMaterial({ map: toileTex, roughness: 0.95, side: DoubleSide });
      toileMat.userData.cloth = true;
      for (const s of [-1, 1]) {
        const cloth = new Mesh(new PlaneGeometry(len, H - 0.45, Math.ceil(len / 1.5), 2), toileMat);
        const pos = cloth.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, 0.02 * Math.sin(x * 2.1) * (0.5 - y / (H - 0.45))); }
        cloth.geometry.computeVertexNormals();
        cloth.position.set(C.x, 0.25 + (H - 0.45) / 2 + 0.06, C.z + s * (T / 2 + 0.02));
        cloth.rotation.y = s > 0 ? 0 : Math.PI;
        cloth.castShadow = true; cloth.receiveShadow = true;
        tilt.add(cloth);
      }
      tilt.visible = false;
      this.group.add(tilt);
      this.tilt = tilt;
    }

    // ---- the stand for the lords, ladies and judges (south side) ---------------------------------
    {
      const st = new Group();
      const zf = C.z - HW - 2.2;          // front of the stand
      const len = 34;
      const tiers = [];
      for (let i = 0; i < 4; i++) {
        tiers.push(new BoxGeometry(len, 0.12, 0.9).translate(C.x, 0.9 + i * 0.55, zf - 0.5 - i * 0.9));      // floor of the tier
        tiers.push(new BoxGeometry(len, 0.45, 0.32).translate(C.x, 1.18 + i * 0.55, zf - 0.75 - i * 0.9));   // bench
      }
      const frame = [];
      for (let x = -len / 2; x <= len / 2 + 0.01; x += 3.4) {
        for (const dz of [0, -1.8, -3.6]) frame.push(new CylinderGeometry(0.08, 0.09, 4.6, 6).translate(C.x + x, 2.3, zf + dz - 0.1));
      }
      st.add(new Mesh(mergeGeometries(tiers.map((g) => g.toNonIndexed())), wood));
      st.add(new Mesh(mergeGeometries(frame.map((g) => g.toNonIndexed())), darkWood));
      // canopy, striped
      const canMat = new MeshStandardMaterial({ map: fabricTexture('#b0161c', { stripes: '#ece8e0' }), roughness: 0.85, side: DoubleSide });
      canMat.map = canMat.map.clone(); canMat.map.needsUpdate = true; canMat.map.repeat.set(10, 1);
      canMat.userData.cloth = true;
      const can = new Mesh(new BoxGeometry(len + 1, 0.06, 4.6), canMat);
      can.position.set(C.x, 4.65, zf - 1.9);
      can.rotation.x = -0.12;
      st.add(can);
      // the drape along the front with the arms of the kingdom
      const drapeMat = new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.bohemia), roughness: 0.85, side: DoubleSide });
      drapeMat.map = drapeMat.map.clone(); drapeMat.map.needsUpdate = true; drapeMat.map.repeat.set(8, 1);
      drapeMat.userData.cloth = true;
      const drape = new Mesh(new PlaneGeometry(len, 0.95), drapeMat);
      drape.position.set(C.x, 0.48, zf + 0.02);
      st.add(drape);
      // the judges' box in the middle, raised, with its own hanging
      const jb = new Mesh(new BoxGeometry(4, 0.1, 2.2), darkWood);
      jb.position.set(C.x, 3.2, zf - 1.2);
      st.add(jb);
      const jbMat = new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.rozmberk), roughness: 0.85, side: DoubleSide });
      jbMat.userData.cloth = true;
      const jd = new Mesh(new PlaneGeometry(4, 1.1), jbMat);
      jd.position.set(C.x, 2.65, zf - 0.08);
      st.add(jd);
      st.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(st);
      this.stand = { zf, len };
    }

    // ---- banners along the north fence --------------------------------------------------------------
    this.flags = [];
    const fl = [new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.bohemia), side: DoubleSide, roughness: 0.85 }), new MeshStandardMaterial({ map: heraldryTexture(HERALDRY.rozmberk), side: DoubleSide, roughness: 0.85 })];
    for (const m of fl) m.userData.cloth = true;
    for (let i = 0; i < 9; i++) {
      const x = C.x - HL + 6 + i * ((HL * 2 - 12) / 8), z = C.z + HW + 0.8;
      const pole = new Mesh(new CylinderGeometry(0.04, 0.05, 6, 8), wood);
      pole.position.set(x, 3, z);
      pole.castShadow = true;
      this.group.add(pole);
      const geo = new PlaneGeometry(1.0, 1.5, 6, 10);
      geo.translate(0, -0.75, 0);
      const flag = new Mesh(geo, fl[i % 2]);
      flag.position.set(x + 0.02, 5.9, z);
      flag.rotation.y = Math.PI / 2;
      flag.castShadow = true;
      this.group.add(flag);
      flag.updateMatrixWorld();
      this.flags.push({ mesh: flag, cloth: new Cloth(geo, { pin: (px, py) => py > -0.01, widthSegments: 6, heightSegments: 10, mass: 0.25 }), inv: flag.quaternion.clone().invert() });
    }

    // ---- pavilions at the ends: where the jousters arm ---------------------------------------------
    const cols = [['#e9e2d0', '#b0161c'], ['#1c3a6a', '#d8c060'], ['#e9e2d0', '#1c3a6a'], ['#b0161c', '#e9e2d0']];
    let k = 0;
    for (const sx of [-1, 1]) for (const dz of [-5, 5]) {
      const [c1, c2] = cols[k++ % 4];
      const mat = new MeshStandardMaterial({ map: fabricTexture(c1, { stripes: c2 }), roughness: 0.9, side: DoubleSide });
      mat.map = mat.map.clone(); mat.map.needsUpdate = true; mat.map.repeat.set(5, 1);
      mat.userData.cloth = true;
      const x = C.x + sx * (HL + 7), z = C.z + dz;
      const wall = new Mesh(new CylinderGeometry(2.4, 2.4, 2.2, 28, 1, true), mat);
      wall.position.set(x, 1.1, z);
      const roof = new Mesh(new ConeGeometry(2.9, 2.2, 28, 1, true), mat);
      roof.position.set(x, 3.3, z);
      const pole = new Mesh(new CylinderGeometry(0.035, 0.035, 1.4, 6), wood);
      pole.position.set(x, 4.9, z);
      for (const m of [wall, roof, pole]) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    }

    // ---- onlookers: commons standing at the north fence, lords seated in the stand ---------------
    const people = [];
    const cloths = ['#6a5a40', '#7a1c1c', '#3a4a2a', '#4a3a2a', '#8a7a5a', '#2a2a3a', '#9a6a2a', '#5a2a3a', '#d6ccb0', '#3c4c6a'];
    const rich = ['#7a1018', '#1c2a5a', '#2a4a2a', '#5a1a4a', '#c8a040', '#e8e2d4', '#101010'];
    const skins = ['#e0b896', '#d2a07c', '#c48e6a', '#e8c4a4', '#b98462'];
    const nCommons = quality === 'low' ? 60 : 140;
    for (let i = 0; i < nCommons; i++) {
      const x = C.x - HL + 3 + rand() * (HL * 2 - 6);
      const z = C.z + HW + 0.6 + rand() * 1.8 + (rand() < 0.35 ? 1.3 : 0);
      people.push({ x, y: 0, z, sc: 0.9 + rand() * 0.16, phase: rand() * 10, hat: rand() < 0.5 ? 0 : rand() < 0.6 ? 1 : 2, cloth: new Color(cloths[Math.floor(rand() * cloths.length)]), skin: new Color(skins[Math.floor(rand() * skins.length)]), wear: new Color(cloths[Math.floor(rand() * cloths.length)]).multiplyScalar(rand() < 0.5 ? 1 : 0.7) });
    }
    const { zf, len } = this.stand;
    for (let t = 0; t < 4; t++) for (let x = -len / 2 + 0.6; x < len / 2 - 0.4; x += 0.75 + rand() * 0.5) {
      if (rand() < 0.25 || (t >= 2 && Math.abs(x) < 2.2)) continue;
      // seated: the figure stands on the tier floor, a little lower (sitting on the bench)
      people.push({ x: C.x + x, y: 0.96 + t * 0.55 - 0.35, z: zf - 0.95 - t * 0.9, sc: 0.88 + rand() * 0.12, phase: rand() * 10, hat: rand() < 0.45 ? 2 : rand() < 0.5 ? 1 : 0, cloth: new Color(rich[Math.floor(rand() * rich.length)]), skin: new Color(skins[Math.floor(rand() * skins.length)]), wear: new Color(rich[Math.floor(rand() * rich.length)]) });
    }
    this.people = people;
    const parts = onlookerParts();
    const mk = (geo, name, count) => {
      const chain = buildLODChain(geo, [1, 0.4, 0.12]);
      const mat = new MeshStandardMaterial({ roughness: name === 'head' ? 0.6 : 0.92, vertexColors: true });
      if (name !== 'head') mat.userData.cloth = true;
      return new LODInstancer(chain.map((c, i) => ({ geometry: c.geometry, distance: [16, 40, Infinity][i] })), mat, Math.max(1, count), { name: 'joust-crowd-' + name });
    };
    this.crowd = {
      body: mk(parts.body, 'body', people.length),
      head: mk(parts.head, 'head', people.length),
      hood: mk(parts.hood, 'hood', people.filter((p) => p.hat === 0).length),
      hat: mk(parts.hat, 'hat', people.filter((p) => p.hat === 1).length),
    };
    for (const l of Object.values(this.crowd)) this.group.add(l.group);
    this.time = 0;
    this._pose(0, 0, C.z);
  }

  _pose(t, excitement, focusX) {
    const o = new Object3D();
    let ih = 0, it = 0;
    const C = this.crowd;
    this.people.forEach((p, i) => {
      o.position.set(p.x, p.y + Math.max(0, Math.sin(t * 7 + p.phase) * 0.09 * excitement), p.z);
      o.rotation.set(0, 0, 0);
      // they watch the riders
      o.lookAt(focusX + (p.x - focusX) * 0.3, o.position.y, FIELD.center.z);
      o.rotateZ(Math.sin(t * 0.8 + p.phase) * 0.03);
      o.scale.setScalar(p.sc);
      o.updateMatrix();
      C.body.setInstance(i, o.matrix, p.cloth);
      C.head.setInstance(i, o.matrix, p.skin);
      if (p.hat === 0) C.hood.setInstance(ih++, o.matrix, p.wear);
      else if (p.hat === 1) C.hat.setInstance(it++, o.matrix, p.wear);
    });
  }

  update(dt, { excitement = 0, focusX = 0, camera = null } = {}) {
    this.time += dt;
    const t = this.time;
    // banners: cloth in the wind (only when the field is on screen, at full rate when near)
    const near = !camera || camera.position.distanceTo(FIELD.center) < 90;
    if (near && this.group.visible) {
      const wind = windAt(t);
      for (const f of this.flags) f.cloth.step(dt, _wl.copy(wind).applyQuaternion(f.inv));
    }
    this._pose(t, excitement, focusX);
    if (camera) for (const l of Object.values(this.crowd)) { l._built = false; l.update(camera.position); }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) m.dispose?.();
    });
    this.group.removeFromParent();
  }
}
