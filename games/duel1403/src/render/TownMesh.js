import {
  Group, Mesh, BoxGeometry, CylinderGeometry, ConeGeometry, PlaneGeometry, MeshStandardMaterial, BufferGeometry,
  Float32BufferAttribute, DoubleSide, TorusGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, finish, speckle } from './textures.js';
import { BUILDINGS, PLACES, castleLocal } from '../world/town.js';
import { heightAt } from '../world/terrain.js';

const tex = {};
/** Lime plaster over wattle, with oak framing: the timber-framed house of a Bohemian town. */
function plasterTimber() {
  if (tex.wall) return tex.wall;
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#d8ccb0'; g.fillRect(0, 0, W, H);
  speckle(g, W, H, 3000, ['#b8a888', '#efe6d0', '#a89878'], 2, 9, 31);
  g.fillStyle = '#4a3422';
  const beam = (x, y, w, h) => g.fillRect(x, y, w, h);
  beam(0, 0, W, 14); beam(0, H - 18, W, 18); beam(0, H / 2 - 6, W, 12);
  for (let x = 0; x <= W; x += 128) beam(x - 7, 0, 14, H);
  g.lineWidth = 11; g.strokeStyle = '#4a3422';
  for (let x = 0; x < W; x += 128) { g.beginPath(); g.moveTo(x, H / 2); g.lineTo(x + 64, H - 18); g.stroke(); }
  // weathering at the foot of the wall
  const grd = g.createLinearGradient(0, H - 60, 0, H);
  grd.addColorStop(0, 'rgba(60,45,30,0)'); grd.addColorStop(1, 'rgba(60,45,30,0.45)');
  g.fillStyle = grd; g.fillRect(0, H - 60, W, 60);
  return (tex.wall = finish(c, { repeat: true }));
}
function thatch() {
  if (tex.thatch) return tex.thatch;
  const W = 256, c = canvas(W, W), g = c.getContext('2d');
  g.fillStyle = '#8a744a'; g.fillRect(0, 0, W, W);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * W, y = Math.random() * W;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '60,48,28' : '180,160,110'},${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 1 + Math.random();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + 10 + Math.random() * 16); g.stroke();
  }
  for (let y = 0; y < W; y += 32) { g.fillStyle = 'rgba(40,30,15,0.25)'; g.fillRect(0, y, W, 3); }
  return (tex.thatch = finish(c, { repeat: true }));
}
function shingle() {
  if (tex.shingle) return tex.shingle;
  const W = 256, c = canvas(W, W), g = c.getContext('2d');
  g.fillStyle = '#6a5440'; g.fillRect(0, 0, W, W);
  for (let y = 0; y < W; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < W; x += 24) {
    const v = 70 + Math.random() * 40;
    g.fillStyle = `rgb(${v + 20},${v},${v - 18})`; g.fillRect(x + 1, y + 1, 22, 15);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 13, 24, 3);
  }
  return (tex.shingle = finish(c, { repeat: true }));
}
function planks() {
  if (tex.planks) return tex.planks;
  const W = 128, c = canvas(W, W), g = c.getContext('2d');
  g.fillStyle = '#5a3e26'; g.fillRect(0, 0, W, W);
  for (let x = 0; x < W; x += 16) { g.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.2})`; g.fillRect(x, 0, 2, W); }
  speckle(g, W, W, 600, ['#3a2818', '#7a5636'], 1, 4, 7);
  return (tex.planks = finish(c, { repeat: true }));
}

/** A gabled roof over a w x d box: ridge along the longer side. */
function gableRoof(w, d, rise, over) {
  const along = w >= d;
  const L = (along ? w : d) / 2 + over, S = (along ? d : w) / 2 + over;
  const p = [];
  const uv = [];
  const quad = (a, b, c2, dd, u) => { p.push(...a, ...b, ...c2, ...a, ...c2, ...dd); uv.push(0, 0, u, 0, u, 1, 0, 0, u, 1, 0, 1); };
  const sl = Math.hypot(S, rise);
  if (along) {
    quad([-L, 0, S], [L, 0, S], [L, rise, 0], [-L, rise, 0], L / 1.5);
    quad([L, 0, -S], [-L, 0, -S], [-L, rise, 0], [L, rise, 0], L / 1.5);
  } else {
    quad([S, 0, L], [S, 0, -L], [0, rise, -L], [0, rise, L], L / 1.5);
    quad([-S, 0, -L], [-S, 0, L], [0, rise, L], [0, rise, -L], L / 1.5);
  }
  void sl;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
/** The two triangular gable ends. */
function gables(w, d, rise) {
  const along = w >= d;
  const S = (along ? d : w) / 2, L = (along ? w : d) / 2;
  const p = [];
  for (const s of [-1, 1]) {
    if (along) p.push(s * L, 0, -S, s * L, 0, S, s * L, rise, 0);
    else p.push(-S, 0, s * L, S, 0, s * L, 0, rise, s * L);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1], 2));
  g.computeVertexNormals();
  return g;
}

/**
 * The town of Skalice: timber-framed houses with thatched or shingled roofs,
 * doors you can walk through, shop signs, the well, the pillory, market
 * stalls, privies, and the castle gate tower. The church and the castle keep
 * are drawn by Lists.js; this adds everything people use.
 */
export class TownMesh {
  constructor(scene) {
    this.group = new Group();
    this.group.name = 'town';
    scene.add(this.group);
    const wallMat = new MeshStandardMaterial({ map: plasterTimber(), roughness: 0.92 });
    const thatchMat = new MeshStandardMaterial({ map: thatch(), roughness: 1, side: DoubleSide });
    const shingleMat = new MeshStandardMaterial({ map: shingle(), roughness: 0.9, side: DoubleSide });
    const woodMat = new MeshStandardMaterial({ map: planks(), roughness: 0.85 });
    const stoneMat = new MeshStandardMaterial({ color: '#a69e8c', roughness: 0.95 });
    const darkMat = new MeshStandardMaterial({ color: '#1a120c', roughness: 1 });
    const walls = [], roofsT = [], roofsS = [], gab = [], doors = [], dark = [], wood = [], stone = [];
    for (const b of BUILDINGS) {
      if (b.builtBy === 'lists') continue;
      const y = heightAt(b.x, b.z);
      const wall = new BoxGeometry(b.w, b.h, b.d);
      // wall uv in metres so the framing has its real size (a panel ~1.6 m)
      const P = wall.attributes.position, U = wall.attributes.uv, N = wall.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const nx = Math.abs(N.getX(i)) > 0.5;
        U.setXY(i, ((nx ? P.getZ(i) : P.getX(i)) + 50) / 6.4, (P.getY(i) + b.h / 2) / b.h);
      }
      walls.push(wall.translate(b.x, y + b.h / 2, b.z));
      const rise = Math.min(b.w, b.d) * 0.75;
      const roof = gableRoof(b.w, b.d, rise, 0.45).translate(b.x, y + b.h, b.z);
      (b.roof === 'shingle' ? roofsS : roofsT).push(roof);
      gab.push(gables(b.w, b.d, rise).translate(b.x, y + b.h, b.z));
      // the door: a dark opening in a plank frame, on the side the door point is
      const dx = b.door.x - b.x, dz = b.door.z - b.z;
      const onX = Math.abs(dx) / b.w > Math.abs(dz) / b.d;
      const fx = onX ? b.x + Math.sign(dx) * (b.w / 2 + 0.02) : b.door.x, fz = onX ? b.door.z : b.z + Math.sign(dz) * (b.d / 2 + 0.02);
      const dw = 1.1, dh = 2.0;
      const door = new BoxGeometry(onX ? 0.06 : dw, dh, onX ? dw : 0.06).translate(fx, y + dh / 2, fz);
      dark.push(door);
      const frame = new BoxGeometry(onX ? 0.12 : dw + 0.3, 0.16, onX ? dw + 0.3 : 0.12).translate(fx, y + dh + 0.08, fz);
      wood.push(frame);
      for (const s of [-1, 1]) wood.push(new BoxGeometry(onX ? 0.12 : 0.14, dh, onX ? 0.14 : 0.12).translate(fx + (onX ? 0 : s * (dw / 2 + 0.07)), y + dh / 2, fz + (onX ? s * (dw / 2 + 0.07) : 0)));
      // a small shuttered window either side
      for (const s of [-1, 1]) {
        const off = s * Math.min(2.2, (onX ? b.d : b.w) / 2 - 0.9);
        dark.push(new BoxGeometry(onX ? 0.05 : 0.6, 0.5, onX ? 0.6 : 0.05).translate(fx + (onX ? 0 : off), y + 1.7, fz + (onX ? off : 0)));
      }
      // shop sign on a bracket
      if (b.sign) {
        const sx = fx + (onX ? Math.sign(dx) * 0.7 : 0.9), sz = fz + (onX ? 0.9 : Math.sign(dz) * 0.7);
        wood.push(new BoxGeometry(onX ? 1.2 : 0.06, 0.06, onX ? 0.06 : 1.2).translate((fx + sx) / 2 + (onX ? 0 : 0.9) * 0, y + 2.75, (fz + sz) / 2));
        const signGeo = b.sign === 'tavern' ? new TorusGeometry(0.28, 0.07, 6, 14) : b.sign === 'bread' ? new TorusGeometry(0.22, 0.09, 6, 14) : new BoxGeometry(0.5, 0.4, 0.06);
        if (onX) signGeo.rotateY(Math.PI / 2);
        wood.push(signGeo.translate(sx, y + 2.4, sz));
      }
    }
    const add = (geos, mat, shadow = true) => { if (!geos.length) return; const m = new Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat); m.castShadow = shadow; m.receiveShadow = true; this.group.add(m); return m; };
    add(walls, wallMat);
    add(roofsT, thatchMat);
    add(roofsS, shingleMat);
    add(gab, wallMat);
    add(dark, darkMat, false);
    add(wood, woodMat);

    // ---- the square: well, pillory, market stalls --------------------------------------------
    {
      const w = PLACES.well;
      stone.push(new CylinderGeometry(0.8, 0.85, 0.8, 20, 1, true).translate(w.x, 0.4, w.z));
      stone.push(new TorusGeometry(0.8, 0.1, 6, 20).rotateX(Math.PI / 2).translate(w.x, 0.8, w.z));
      for (const s of [-1, 1]) wood.push(new BoxGeometry(0.12, 2.0, 0.12).translate(w.x + s * 0.75, 1.0, w.z));
      wood.push(new CylinderGeometry(0.07, 0.07, 1.7, 8).rotateZ(Math.PI / 2).translate(w.x, 1.75, w.z));
      wood.push(new BoxGeometry(1.9, 0.08, 1.1).translate(w.x, 2.1, w.z));
      const pl = PLACES.pillory;
      // the pillory: a post with a hinged board for neck and wrists
      stone.push(new CylinderGeometry(0.7, 0.8, 0.4, 8).translate(pl.x, 0.2, pl.z));
      wood.push(new BoxGeometry(0.22, 2.6, 0.22).translate(pl.x, 1.5, pl.z));
      wood.push(new BoxGeometry(1.2, 0.3, 0.1).translate(pl.x, 2.15, pl.z + 0.16));
      wood.push(new BoxGeometry(0.4, 0.4, 0.4).translate(pl.x, 2.9, pl.z));
      // stalls
      const mk = PLACES.market;
      const awn = [];
      for (let i = 0; i < 3; i++) {
        const x = mk.x - 6 + i * 4.5, z = mk.z - 1;
        wood.push(new BoxGeometry(2.4, 0.08, 1.0).translate(x, 0.9, z));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) wood.push(new BoxGeometry(0.08, sz < 0 ? 2.2 : 1.9, 0.08).translate(x + sx * 1.15, sz < 0 ? 1.1 : 0.95, z + sz * 0.45));
        awn.push(new BoxGeometry(2.6, 0.04, 1.4).rotateX(0.18).translate(x, 2.1, z));
      }
      const awnMat = new MeshStandardMaterial({ color: '#b8a070', roughness: 0.9, side: DoubleSide });
      awnMat.userData.cloth = true;
      add(awn, awnMat);
      // the privy behind the tavern: a plank hut
      const pr = PLACES.privy;
      wood.length = 0;
      wood.push(new BoxGeometry(1.2, 2.1, 1.2).translate(pr.x, 1.05, pr.z));
      wood.push(new BoxGeometry(1.5, 0.08, 1.5).rotateX(0.2).translate(pr.x, 2.2, pr.z));
      dark.length = 0;
      dark.push(new BoxGeometry(0.6, 1.6, 0.05).translate(pr.x, 0.85, pr.z - 0.62));
      add(wood, woodMat);
      add(dark, darkMat, false);
      add(stone, stoneMat);
    }
    // ---- the castle gate tower with its arch, in front of the south wall -----------------------
    {
      const g = castleLocal(-2, -13.5), y = heightAt(g.x, g.z) - 0.5;
      const tower = new Group();
      const sMat = new MeshStandardMaterial({ color: '#cfc6b2', roughness: 0.95 });
      for (const s of [-1, 1]) { const m = new Mesh(new BoxGeometry(2.2, 10, 4), sMat); m.position.set(s * 2.4, 5, 0); tower.add(m); }
      const top = new Mesh(new BoxGeometry(7, 3, 4), sMat); top.position.set(0, 8.5, 0); tower.add(top);
      const arch = new Mesh(new BoxGeometry(2.6, 7, 4.2), darkMat); arch.position.set(0, 3.5, 0); tower.add(arch);
      const roof = new Mesh(new ConeGeometry(5.2, 4, 4), new MeshStandardMaterial({ color: '#8a3c26', roughness: 0.9 }));
      roof.rotation.y = Math.PI / 4; roof.position.set(0, 12, 0); tower.add(roof);
      tower.position.set(g.x, y, g.z);
      tower.rotation.y = 0.3;
      tower.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.group.add(tower);
    }
    // a beaten earth street along the graph would go here (the terrain VT paints the ground)
    void Vector3; void PlaneGeometry;
  }
}
