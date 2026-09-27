import {
  Group, Mesh, BoxGeometry, CylinderGeometry, PlaneGeometry, MeshStandardMaterial, MeshPhysicalMaterial,
  MeshBasicMaterial, TubeGeometry, CatmullRomCurve3, Vector3, Color, InstancedMesh, Object3D,
  SpotLight, HemisphereLight, ConeGeometry, ShaderMaterial, AdditiveBlending, DoubleSide,
  CapsuleGeometry, SphereGeometry, BufferGeometry, Float32BufferAttribute, Points, PointsMaterial,
  CanvasTexture, InstancedBufferAttribute, Sprite, SpriteMaterial, Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RING } from '../game/FightSim.js';
import { ringCanvasTexture, apronTexture, ledBoardTexture, noiseNormal } from './textures.js';

const ROPE_COLORS = [0xd9d9d9, 0xb3121f, 0xd9d9d9, 0x1846b8];
const ROPE_SEGMENTS = 48;

/**
 * The venue: ring, ropes that bend where fighters lean on them, ringside,
 * a stadium of fans, the lighting truss and atmosphere.
 */
export class Arena {
  constructor(scene, sim, { quality = 'high' } = {}) {
    this.scene = scene;
    this.sim = sim;
    this.quality = quality;
    this.group = new Group();
    this.group.name = 'arena';
    scene.add(this.group);
    this.time = 0;
    this._buildRing();
    this._buildRopes();
    this._buildRingside();
    this._buildCrowd();
    this._buildLights();
    this._buildAtmosphere();
    this._mergeStatic();
  }

  /**
   * Bakes every static mesh into one mesh per material: a few hundred props
   * become a handful of draw calls (and shadow-pass calls).
   */
  _mergeStatic() {
    const keep = new Set([this.crowd, this.dust, ...this.sim.ropes.map((r) => r.mesh), ...this.flashes.map((f) => f.sprite)]);
    const byMat = new Map();
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || keep.has(o) || o.parent === null) return;
      const list = byMat.get(o.material) ?? [];
      list.push(o);
      byMat.set(o.material, list);
    });
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = [];
      for (const m of list) {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) continue;
        g.applyMatrix4(m.matrixWorld);
        geos.push(g);
      }
      if (geos.length < 2) continue;
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = list.some((m) => m.castShadow);
      mesh.receiveShadow = list.some((m) => m.receiveShadow);
      mesh.renderOrder = list[0].renderOrder;
      for (const m of list) m.parent.remove(m);
      this.group.add(mesh);
    }
  }

  _buildRing() {
    const R = RING;
    const full = R.half + R.apron;
    // Platform + canvas
    const canvasMat = new MeshStandardMaterial({
      map: ringCanvasTexture(),
      normalMap: noiseNormal('fabric', { size: 256, base: 64, octaves: 3, seed: 5, strength: 1.2 }),
      roughness: 0.82,
      metalness: 0,
    });
    canvasMat.normalMap.repeat.set(12, 12);
    canvasMat.normalScale.set(0.35, 0.35);
    const top = new Mesh(new PlaneGeometry(full * 2, full * 2), canvasMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.group.add(top);

    const apron = apronTexture();
    apron.repeat.set(1, 1);
    const skirtMat = new MeshStandardMaterial({ map: apron, roughness: 0.6, metalness: 0.1 });
    const H = R.platformHeight;
    for (let i = 0; i < 4; i++) {
      const side = new Mesh(new PlaneGeometry(full * 2, H), skirtMat);
      const a = (i * Math.PI) / 2;
      side.position.set(Math.sin(a) * full, -H / 2, Math.cos(a) * full);
      side.rotation.y = a;
      side.receiveShadow = true;
      this.group.add(side);
    }
    // padded canvas edge (the canvas wraps over the platform lip)
    const edgeMat = new MeshStandardMaterial({ color: 0x9aa6b2, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const lip = new Mesh(new CapsuleGeometry(0.035, full * 2 - 0.07, 4, 12), edgeMat);
      const a = (i * Math.PI) / 2;
      lip.rotation.z = Math.PI / 2;
      lip.rotation.y = a;
      lip.position.set(Math.sin(a) * full, -0.01, Math.cos(a) * full);
      lip.receiveShadow = true;
      this.group.add(lip);
    }

    // Corner posts and turnbuckle pads
    const postMat = new MeshPhysicalMaterial({ color: 0x1b1d22, metalness: 0.9, roughness: 0.28, clearcoat: 0.5 });
    const padColors = [0xf2f2f2, 0x1846b8, 0xf2f2f2, 0xb3121f];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(([sx, sz], i) => {
      const post = new Mesh(new CylinderGeometry(R.postRadius, R.postRadius, R.postHeight + 0.15, 20), postMat);
      post.position.set(sx * R.half, (R.postHeight - 0.15) / 2, sz * R.half);
      post.castShadow = true;
      this.group.add(post);
      const padMat = new MeshPhysicalMaterial({
        color: padColors[i], roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.3,
        normalMap: noiseNormal('leather'), normalScale: new Vector2(0.3, 0.3),
      });
      const pad = new Mesh(new CapsuleGeometry(0.13, 1.0, 8, 20), padMat);
      pad.scale.set(1, 1, 0.75);
      pad.position.set(sx * (R.half - 0.06), 0.93, sz * (R.half - 0.06));
      pad.lookAt(0, 0.93, 0);
      pad.castShadow = true;
      pad.receiveShadow = true;
      this.group.add(pad);
      // Post cap
      const cap = new Mesh(new SphereGeometry(R.postRadius * 1.15, 16, 10), postMat);
      cap.position.set(sx * R.half, R.postHeight, sz * R.half);
      this.group.add(cap);
    });

    // Ring steps at the red and blue corners
    const stepMat = new MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.2 });
    for (const [sx, sz] of [[1, 1], [-1, -1]]) {
      for (let k = 0; k < 3; k++) {
        const st = new Mesh(new BoxGeometry(0.7, 0.4 * (k + 1) - 0.02, 0.35), stepMat);
        const d = full + 0.25 + (2 - k) * 0.35;
        st.position.set(sx * d * 0.7071 + sx * 0.3, -1.2 + 0.2 * (k + 1), sz * d * 0.7071 + sz * 0.3);
        st.rotation.y = Math.atan2(sx, sz);
        st.castShadow = st.receiveShadow = true;
        this.group.add(st);
      }
    }

    // Arena floor
    const floor = new Mesh(
      new PlaneGeometry(60, 60),
      new MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.45, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -H;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  _buildRopes() {
    this.ropeMeshes = [];
    const mats = ROPE_COLORS.map((c) => new MeshPhysicalMaterial({
      color: c, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.5,
      normalMap: noiseNormal('rope', { size: 128, base: 8, octaves: 2, seed: 17, strength: 3 }),
    }));
    for (const rope of this.sim.ropes) {
      mats[rope.index].normalMap.repeat.set(80, 1);
      const pts = [];
      for (let i = 0; i <= 8; i++) pts.push(new Vector3());
      rope.curve = new CatmullRomCurve3(pts);
      rope.points = pts;
      const mesh = new Mesh(new TubeGeometry(rope.curve, ROPE_SEGMENTS, RING.ropeRadius * 1.4, 8, false), mats[rope.index]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      rope.mesh = mesh;
      this.group.add(mesh);
      this._shapeRope(rope, 0, 0.5, new Vector3());
    }
    // Rope ties (spacer straps) at the thirds of each side
    const tieMat = new MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 });
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i], [x1, z1] = corners[(i + 1) % 4];
      for (const t of [1 / 3, 2 / 3]) {
        const tie = new Mesh(new BoxGeometry(0.035, RING.ropeHeights[3] - RING.ropeHeights[0] + 0.06, 0.012), tieMat);
        tie.position.set((x0 + (x1 - x0) * t) * RING.half, (RING.ropeHeights[0] + RING.ropeHeights[3]) / 2, (z0 + (z1 - z0) * t) * RING.half);
        tie.rotation.y = Math.atan2(x1 - x0, z1 - z0);
        this.group.add(tie);
        this.ropeTies = this.ropeTies ?? [];
        this.ropeTies.push({ mesh: tie, side: i, t });
      }
    }
  }

  _shapeRope(rope, deflection, at, dir) {
    const sag = 0.02;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = rope.points[i];
      p.lerpVectors(rope.a, rope.b, t);
      p.y = rope.height - sag * Math.sin(Math.PI * t);
      // Deflection bump centred where the body presses.
      const w = Math.max(0, 1 - Math.abs(t - at) / Math.max(0.12, Math.min(at, 1 - at) + 0.05));
      const k = Math.sin(Math.PI * t) * w;
      p.addScaledVector(dir, deflection * k);
    }
    rope.curve.needsUpdate = true;   // points moved: drop cached arc lengths
    const geo = new TubeGeometry(rope.curve, ROPE_SEGMENTS, RING.ropeRadius * 1.4, 8, false);
    rope.mesh.geometry.dispose();
    rope.mesh.geometry = geo;
  }

  _buildRingside() {
    const R = RING;
    const d = R.half + R.apron + 2.6;
    // LED barrier boards
    const led = ledBoardTexture([
      { text: 'FORGE BOXING', color: '#ff3b3b' },
      { text: 'XPBD PHYSICS', color: '#3fd0ff' },
      { text: 'FIGHT NIGHT', color: '#ffd166' },
      { text: 'WORLD TITLE', color: '#ffffff' },
    ]);
    led.repeat.set(2, 1);
    const ledMat = new MeshBasicMaterial({ map: led, toneMapped: false });
    ledMat.color.setScalar(1.6);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const board = new Mesh(new PlaneGeometry(d * 2, 0.6), ledMat);
      board.position.set(Math.sin(a) * d, -1.2 + 0.55, Math.cos(a) * d);
      board.rotation.y = a + Math.PI;
      this.group.add(board);
    }
    // Press row tables
    const tableMat = new MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 });
    const screenMat = new MeshBasicMaterial({ color: 0x3a5a7a });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const t = new Mesh(new BoxGeometry(d * 1.6, 0.05, 0.7), tableMat);
      t.position.set(Math.sin(a) * (d - 1.1), -1.2 + 0.75, Math.cos(a) * (d - 1.1));
      t.rotation.y = a;
      t.receiveShadow = true;
      this.group.add(t);
      for (let k = -4; k <= 4; k++) {
        const scr = new Mesh(new PlaneGeometry(0.34, 0.22), screenMat);
        const off = k * 0.8;
        scr.position.set(Math.sin(a) * (d - 1.25) + Math.cos(a) * off, -1.2 + 0.9, Math.cos(a) * (d - 1.25) - Math.sin(a) * off);
        scr.rotation.y = a + Math.PI;
        scr.rotation.x = -0.25;
        this.group.add(scr);
      }
    }
  }

  _buildCrowd() {
    const R = RING;
    const rows = this.quality === 'low' ? 10 : 16;
    const inner = R.half + R.apron + 3.6;
    // One fan = torso capsule + head sphere, merged.
    const body = new CapsuleGeometry(0.2, 0.42, 2, 7);
    body.translate(0, 0.45, 0);
    const head = new SphereGeometry(0.12, 7, 5);
    head.translate(0, 1.0, 0);
    const colorAttr = (g, c) => {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c; arr[i * 3 + 1] = c; arr[i * 3 + 2] = c; }
      g.setAttribute('shade', new Float32BufferAttribute(arr, 3));
    };
    colorAttr(body, 1);
    colorAttr(head, 0);
    const fan = mergeGeometries([body, head]);
    const seatGeo = new BoxGeometry(1, 0.5, 0.9);

    const positions = [];
    for (let r = 0; r < rows; r++) {
      const dist = inner + r * 0.95;
      const y = -1.2 + r * 0.42;
      for (let side = 0; side < 4; side++) {
        const len = dist * 2;
        const n = Math.floor(len / 0.62);
        for (let k = 0; k < n; k++) {
          if (Math.random() < 0.06) continue;   // empty seats
          const t = (k + 0.5) / n - 0.5;
          const a = (side * Math.PI) / 2;
          const along = t * len;
          const x = Math.sin(a) * dist + Math.cos(a) * along;
          const z = Math.cos(a) * dist - Math.sin(a) * along;
          // skip aisles
          if (Math.abs(along) < 0.5 || Math.abs(Math.abs(along) - dist * 0.55) < 0.35) continue;
          positions.push({ x, y, z, rot: a + Math.PI });
        }
      }
      // tier risers
      for (let side = 0; side < 4; side++) {
        const a = (side * Math.PI) / 2;
        const riser = new Mesh(seatGeo, this._tierMat ?? (this._tierMat = new MeshStandardMaterial({ color: 0x101116, roughness: 0.9 })));
        riser.scale.set(dist * 2 + 1.2, 1, 1);
        riser.position.set(Math.sin(a) * (dist + 0.1), y - 0.25, Math.cos(a) * (dist + 0.1));
        riser.rotation.y = a;
        riser.receiveShadow = false;
        this.group.add(riser);
      }
    }
    const count = positions.length;
    const shirts = [0x2b2f3a, 0x8a1c1c, 0x1f3f8a, 0xe8e8e8, 0x1a1a1a, 0x4b5d3a, 0x6b4a2b, 0xc9a227, 0x5a2a6b, 0x303a44];
    const skins = [0xe0b18f, 0xc68e66, 0x8d5a3b, 0x5a3825, 0xf0c8a8];
    const mat = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uExcite = { value: 0 };
      this.crowdUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 shade; attribute vec3 skinColor; attribute float phase;
          uniform float uTime; uniform float uExcite; varying vec3 vSkinMix;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float bob = sin(uTime * (1.3 + phase * 0.8) + phase * 6.28) * (0.015 + 0.12 * uExcite * step(0.5, fract(phase * 7.0)));
          transformed.y += bob * (0.3 + position.y);
          transformed.x += sin(uTime * 0.7 + phase * 4.0) * 0.02 * position.y;
          vSkinMix = shade;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(skinColor, instanceColor.xyz, shade.x);
          #endif`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkinMix;');
    };
    const crowd = new InstancedMesh(fan, mat, count);
    const skinArr = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const dummy = new Object3D();
    const col = new Color();
    positions.forEach((p, i) => {
      const s = 0.9 + Math.random() * 0.2;
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot + (Math.random() - 0.5) * 0.4, 0);
      dummy.scale.set(s, s * (0.95 + Math.random() * 0.1), s);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
      // Seats further back fall off into darkness.
      const dim = 0.32 * Math.max(0.2, 1 - (p.y + 1.2) / 8);
      col.setHex(shirts[Math.floor(Math.random() * shirts.length)]).multiplyScalar((0.7 + Math.random() * 0.5) * dim);
      crowd.setColorAt(i, col);
      col.setHex(skins[Math.floor(Math.random() * skins.length)]).multiplyScalar(dim);
      skinArr[i * 3] = col.r; skinArr[i * 3 + 1] = col.g; skinArr[i * 3 + 2] = col.b;
      phase[i] = Math.random();
    });
    fan.setAttribute('skinColor', new InstancedBufferAttribute(skinArr, 3));
    fan.setAttribute('phase', new InstancedBufferAttribute(phase, 1));
    crowd.instanceMatrix.needsUpdate = true;
    crowd.frustumCulled = false;
    this.group.add(crowd);
    this.crowd = crowd;
    this.crowdPositions = positions;
    this.excitement = 0;
  }

  _buildLights() {
    const scene = this.scene;
    // Soft fill: the arena is dark, the ring is a lit box.
    this.hemi = new HemisphereLight(0x8fa3c0, 0x1a1410, 0.18);
    scene.add(this.hemi);

    // Key: steep overhead spot confined to the ring, crisp shadow below
    // the fighters. The crowd stays in the dark, as in a real arena.
    const key = new SpotLight(0xfff4e6, 250, 30, 0.56, 0.45, 2);
    key.position.set(0.9, 9.5, 0.6);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const ss = this.quality === 'high' ? 4096 : this.quality === 'medium' ? 2048 : 1024;
    key.shadow.mapSize.set(ss, ss);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 2.5;
    scene.add(key, key.target);
    this.key = key;

    // Four truss spots, angled in from the corners (rim + modelling light).
    this.spots = [];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    corners.forEach(([sx, sz], i) => {
      const sp = new SpotLight(i % 2 ? 0xdbe8ff : 0xfff0dc, 34, 18, 0.4, 0.6, 2);
      sp.position.set(sx * 4.3, 6.2, sz * 4.3);
      sp.target.position.set(0, 0.9, 0);
      sp.castShadow = this.quality === 'high' && i < 2;
      if (sp.castShadow) {
        sp.shadow.mapSize.set(1024, 1024);
        sp.shadow.bias = -0.0006;
        sp.shadow.normalBias = 0.03;
      }
      scene.add(sp, sp.target);
      this.spots.push(sp);
    });

    // Truss
    const trussMat = new MeshStandardMaterial({ color: 0x202226, metalness: 0.8, roughness: 0.4 });
    const lampMat = new MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false });
    lampMat.color.setScalar(6);
    const tr = 4.4, ty = 6.4;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const beam = new Mesh(new BoxGeometry(tr * 2 + 0.3, 0.3, 0.3), trussMat);
      beam.position.set(Math.sin(a) * tr, ty, Math.cos(a) * tr);
      beam.rotation.y = a + Math.PI / 2;
      this.group.add(beam);
      for (let k = -3; k <= 3; k++) {
        const lamp = new Mesh(new CylinderGeometry(0.13, 0.16, 0.22, 16), trussMat);
        const off = k * 1.15;
        lamp.position.set(Math.sin(a) * tr + Math.cos(a) * off, ty - 0.25, Math.cos(a) * tr - Math.sin(a) * off);
        this.group.add(lamp);
        const lens = new Mesh(new CylinderGeometry(0.12, 0.12, 0.01, 16), lampMat);
        lens.position.copy(lamp.position);
        lens.position.y -= 0.115;
        this.group.add(lens);
        this.lampPositions = this.lampPositions ?? [];
        this.lampPositions.push(lens.position.clone());
      }
    }
    // Hanging cables
    const cableMat = new MeshBasicMaterial({ color: 0x050505 });
    for (const [sx, sz] of corners) {
      const cable = new Mesh(new CylinderGeometry(0.01, 0.01, 10, 4), cableMat);
      cable.position.set(sx * tr, ty + 5, sz * tr);
      this.group.add(cable);
    }
  }

  _buildAtmosphere() {
    // Light shafts from the truss lamps (soft additive cones).
    const beamMat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(0xfff2dd) }, uStrength: { value: 0.012 } },
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying float vDist;
        void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vY; varying vec3 vN; varying vec3 vV; varying float vDist;
        void main(){ float edge = pow(abs(dot(vN, vV)), 2.0); float fall = pow(vY, 2.0);
        float near = smoothstep(1.5, 5.0, vDist);
        gl_FragColor = vec4(uColor * uStrength * edge * fall * near, 1.0); }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.beamMat = beamMat;
    const beams = new Group();
    for (const p of this.lampPositions) {
      const len = 7.2;
      const cone = new Mesh(new ConeGeometry(1.4, len, 24, 1, true), beamMat);
      cone.position.copy(p);
      cone.position.y -= len / 2;
      // aim roughly at the ring centre
      const dir = new Vector3(-p.x * 0.55, -len, -p.z * 0.55).normalize();
      cone.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir);
      cone.position.copy(p).addScaledVector(dir, len / 2);
      beams.add(cone);
    }
    this.group.add(beams);
    this.beams = beams;

    // Floating haze / dust in the light.
    const n = this.quality === 'low' ? 300 : 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 9;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const dg = dot.getContext('2d');
    const grd = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grd;
    dg.fillRect(0, 0, 32, 32);
    const dotTex = new CanvasTexture(dot);
    this.dotTex = dotTex;
    const dust = new Points(g, new PointsMaterial({ size: 0.025, map: dotTex, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending, color: 0xfff2e0 }));
    this.dust = dust;
    this.group.add(dust);

    // Camera flashes from the crowd.
    this.flashes = [];
    const flashMat = new SpriteMaterial({ map: dotTex, color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let i = 0; i < 14; i++) {
      const s = new Sprite(flashMat.clone());
      s.material.opacity = 0;
      s.scale.setScalar(0.45);
      this.group.add(s);
      this.flashes.push({ sprite: s, t: 1 });
    }
  }

  /** Crowd reaction to a big moment (0..1). */
  excite(amount) {
    this.excitement = Math.min(1, this.excitement + amount);
    const k = Math.floor(amount * 10);
    for (let i = 0; i < k; i++) this._flash();
  }

  _flash() {
    const f = this.flashes.find((x) => x.t >= 1);
    if (!f || !this.crowdPositions.length) return;
    const p = this.crowdPositions[Math.floor(Math.random() * this.crowdPositions.length)];
    f.sprite.position.set(p.x, p.y + 1.1, p.z);
    f.t = 0;
  }

  update(dt) {
    this.time += dt;
    this.excitement = Math.max(0, this.excitement - dt * 0.25);
    if (this.crowdUniforms) {
      this.crowdUniforms.uTime.value = this.time;
      this.crowdUniforms.uExcite.value = this.excitement;
    }
    // Idle photographers
    if (Math.random() < dt * (0.4 + this.excitement * 10)) this._flash();
    for (const f of this.flashes) {
      if (f.t >= 1) continue;
      f.t += dt * 9;
      f.sprite.material.opacity = Math.max(0, 1 - f.t) * 2.2;
    }
    // Dust drift
    const pa = this.dust.geometry.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      let y = pa.getY(i) + dt * 0.03;
      if (y > 6) y = 0;
      pa.setY(i, y);
    }
    pa.needsUpdate = true;
    this._updateRopes();
  }

  _updateRopes() {
    // Rope deflection from the solver's rope contacts this frame.
    const touch = new Map();
    for (const imp of this.sim.world.impacts) {
      for (const [sh, other] of [[imp.shapeA, imp.shapeB], [imp.shapeB, imp.shapeA]]) {
        if (sh.userData.part !== 'rope') continue;
        const rope = this.sim.ropes.find((r) => r.body === sh.body);
        if (!rope) continue;
        const ab = new Vector3().subVectors(rope.b, rope.a);
        const len = ab.length();
        const t = Math.min(1, Math.max(0, new Vector3().subVectors(imp.point, rope.a).dot(ab) / (len * len)));
        // Push direction: towards outside of the ring (horizontal normal).
        const dir = new Vector3(rope.a.x + rope.b.x, 0, rope.a.z + rope.b.z).normalize();
        const cur = touch.get(rope) ?? { amount: 0, t, dir };
        // rope compliance 1/2.2e4 N/m -> displacement ~ F / k, visually exaggerated a little
        const F = imp.peakForce;
        cur.amount = Math.max(cur.amount, Math.min(0.28, F / 2.2e4 * 2.5 + 0.02));
        cur.t = t;
        touch.set(rope, cur);
        void other;
      }
    }
    for (const rope of this.sim.ropes) {
      const target = touch.get(rope);
      const want = target ? target.amount : 0;
      rope.deflection += (want - rope.deflection) * (want > rope.deflection ? 0.6 : 0.15);
      if (target) rope.deflectPoint = target.t;
      if (Math.abs(rope.deflection) > 0.002 || rope._wasBent) {
        rope._wasBent = Math.abs(rope.deflection) > 0.002;
        const dir = new Vector3(rope.a.x + rope.b.x, 0, rope.a.z + rope.b.z).normalize();
        this._shapeRope(rope, rope.deflection, rope.deflectPoint, dir);
      }
    }
  }
}
