/**
 * Benchmark scenes. Each one builds itself into an Engine and returns `{ name, about, frame(i, dt) }`; `frame` is called before every
 * simulated and drawn frame to script whatever moves (a camera orbit, a running player). Nothing here touches the DOM or Node, so the
 * same scenes run in bench/bench.mjs (headless, Dawn) and bench/index.html (a browser, a real canvas).
 */
import {
  Mesh, BoxGeometry, PlaneGeometry, StandardMaterial, DirectionalLight, PointLight, Vector3,
  PlaneCollider, BoxCollider, RigidBody, Actor, loadClipLibrary,
} from '../src/index.js';
import { createGame } from '../demo/game.js';

const rng = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const mat = (color, o = {}) => new StandardMaterial({ color, roughness: 0.85, ...o });

function ground(engine, size = 120, color = 0x6f7f5a) {
  const g = new Mesh(new PlaneGeometry(size, size), mat(color, { roughness: 0.95 }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
  engine.scene.add(g);
  engine.physics.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
  return g;
}

function sun(engine, intensity = 7) {
  const s = new DirectionalLight(0xfff1dc, intensity);
  s.position.set(-9, 13, 7); s.castShadow = true;
  engine.scene.add(s);
  return s;
}

/** The camera goes round a point: the view changes every frame, so culling and the temporal filters have real work to do. */
function orbit(engine, { radius, height, target, speed = 0.25 }) {
  const t = new Vector3(...target);
  return (i, dt) => {
    const a = i * dt * speed;
    engine.camera.position.set(t.x + Math.sin(a) * radius, height, t.z + Math.cos(a) * radius);
    engine.camera.lookAt(t.x, t.y, t.z);
  };
}

export const SCENES = {
  ford: {
    about: 'the demo level: the player runs circles, one sun with cascaded shadows, a lantern, 3 characters, 7 rigid bodies',
    needsGPU: true,
    async build(engine) {
      const game = await createGame(engine);
      engine.platform.emit('key', { code: 'KeyW', key: 'KeyW', down: true, repeat: false });
      return {
        frame() { game.director.look(0.03, 0); },               // the camera swings round and the player runs where it looks: a circle
        dispose() { engine.platform.emit('key', { code: 'KeyW', key: 'KeyW', down: false, repeat: false }); },
      };
    },
  },

  crowd: {
    about: '40 skinned characters (60-bone mocap mixing, capsule controllers) walking in rings, one sun',
    needsGPU: true,
    async build(engine, { count = 40 } = {}) {
      ground(engine); sun(engine);
      const clips = await loadClipLibrary(engine.assets, 'assets/anim/humanoid');
      const r = rng(11), actors = [];
      for (let i = 0; i < count; i++) {
        const a = Actor.mannequin({ name: `a${i}`, color: 0x808080 + Math.floor(r() * 0x7f7f7f), clips });
        a.root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        engine.add(a);
        const ang = (i / count) * Math.PI * 2, rad = 3 + (i % 4) * 2.2;
        a.place([Math.cos(ang) * rad, 0, Math.sin(ang) * rad], (ang * 180) / Math.PI);
        a.attachCharacter(engine.physics);
        actors.push({ a, phase: r() * 6.28, rad, ang });
      }
      const cam = orbit(engine, { radius: 17, height: 7, target: [0, 1, 0] });
      return {
        frame(i, dt) {
          cam(i, dt);
          for (const o of actors) {
            const w = i * dt * 0.6 + o.phase;
            o.a.move(Math.cos(w) * 1.3, Math.sin(w) * 1.3);
          }
        },
      };
    },
  },

  lights: {
    about: '160 point lights over a field of pillars (clustered lighting), one sun',
    needsGPU: true,
    async build(engine, { count = 160 } = {}) {
      ground(engine, 80, 0x888888); sun(engine, 3);
      const r = rng(5), pillar = mat(0xb4ae9f);
      for (let i = 0; i < 60; i++) {
        const h = 3 + r() * 3, m = new Mesh(new BoxGeometry(0.9, h, 0.9), pillar);
        m.position.set((r() - 0.5) * 50, h / 2, (r() - 0.5) * 50);
        m.castShadow = m.receiveShadow = true;
        engine.scene.add(m);
      }
      for (let i = 0; i < count; i++) {
        const l = new PointLight(0xffffff, 18, 7);
        l.color.setHSL(r(), 0.6, 0.6);
        l.position.set((r() - 0.5) * 50, 1 + r() * 3, (r() - 0.5) * 50);
        engine.scene.add(l);
      }
      return { frame: orbit(engine, { radius: 26, height: 10, target: [0, 1, 0], speed: 0.2 }) };
    },
  },

  draws: {
    about: '3600 separate meshes in view (5 materials, all casting shadows): the cost of draw calls and of walking a large scene',
    needsGPU: true,
    async build(engine, { side = 60 } = {}) {
      ground(engine, 80); sun(engine);
      const mats = [0xc2452f, 0x2f6fc2, 0xe0b03c, 0x4fa35c, 0xb4ae9f].map((c) => mat(c));
      const low = new BoxGeometry(0.4, 0.4, 0.4), tall = new BoxGeometry(0.4, 1.2, 0.4);
      for (let x = 0; x < side; x++) {
        for (let z = 0; z < side; z++) {
          const isTall = (x * 7 + z * 3) % 5 === 0;
          const m = new Mesh(isTall ? tall : low, mats[(x + z * 2) % 5]);
          m.position.set((x - side / 2) * 0.62, isTall ? 0.6 : 0.2, (z - side / 2) * 0.62);
          m.castShadow = m.receiveShadow = true;
          engine.scene.add(m);
        }
      }
      return { frame: orbit(engine, { radius: 22, height: 14, target: [0, 0, 0], speed: 0.15 }) };
    },
  },

  physics: {
    about: '400 spheres and capsules tumbling in a walled box (no drawing at all: the cost of the simulation alone)',
    needsGPU: false,
    async build(engine, { count = 400 } = {}) {
      const w = engine.physics;
      w.addCollider(new PlaneCollider(new Vector3(0, 1, 0), 0));
      for (const [x, z, sx, sz] of [[0, -6, 6, 0.5], [0, 6, 6, 0.5], [-6, 0, 0.5, 6], [6, 0, 0.5, 6]]) w.addCollider(new BoxCollider({ center: new Vector3(x, 3, z), half: new Vector3(sx, 3, sz) }));
      const r = rng(3);
      for (let i = 0; i < count; i++) {
        const sphere = i % 2 === 0;
        w.addBody(new RigidBody({
          shape: sphere ? { type: 'sphere', radius: 0.2 + r() * 0.15 } : { type: 'capsule', radius: 0.15, length: 0.4 },
          mass: 1 + r() * 4, position: new Vector3((r() - 0.5) * 9, 1 + (i / count) * 14, (r() - 0.5) * 9), friction: 0.7, restitution: 0.2,
        }));
      }
      return { frame() {} };
    },
  },
};

export const SCENE_NAMES = Object.keys(SCENES);
