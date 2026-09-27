// Physics lab: deterministic scenarios with the collision-shape view.
// Open /lab.html?punch=cross&level=head&noguard=1 ; the screenshot tool drives
// window.lab.stepTo(t).
import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, HemisphereLight, DirectionalLight, Mesh,
  PlaneGeometry, MeshStandardMaterial, Color, Vector3, GridHelper, PCFSoftShadowMap,
} from 'three';
import { FightSim } from './game/FightSim.js';
import { DebugDraw } from './render/DebugDraw.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
scene.background = new Color(0x20242b);
scene.add(new HemisphereLight(0xffffff, 0x404040, 1.2));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(sun);
const floor = new Mesh(new PlaneGeometry(8, 8), new MeshStandardMaterial({ color: 0x8a96a3, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new GridHelper(8, 32, 0x445566, 0x556677);
grid.position.y = 0.001;
scene.add(grid);

const sim = new FightSim();
const debug = new DebugDraw(sim.world, scene);

const dist = parseFloat(params.get('dist') ?? '1.02');
sim.a.placeAt(new Vector3(0, 0, -dist / 2), 0);
sim.b.placeAt(new Vector3(0, 0, dist / 2), Math.PI);
if (params.get('noguard')) sim.b.debugNoGuard = true;

const view = params.get('view') ?? 'side';
const aspect = innerWidth / innerHeight;
let camera;
if (view === 'side' || view === 'top' || view === 'front') {
  const h = parseFloat(params.get('zoom') ?? '1.3');
  camera = new OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.01, 50);
  if (view === 'side') camera.position.set(5, 1.1, 0);
  if (view === 'front') camera.position.set(0, 1.1, -5);
  if (view === 'top') camera.position.set(0, 6, 0.001);
  camera.lookAt(0, view === 'top' ? 0 : 1.1, 0);
} else {
  camera = new PerspectiveCamera(45, aspect, 0.05, 100);
  camera.position.set(2.2, 1.8, -2.4);
  camera.lookAt(0, 1.1, 0);
}

const punch = params.get('punch');
const level = params.get('level') ?? 'head';
const punchAt = parseFloat(params.get('at') ?? '1.0');
let thrown = false;
const log = [];

function step() {
  if (punch && !thrown && sim.time >= punchAt) {
    for (const p of punch.split(',')) sim.a.throwPunch(p, level);
    thrown = true;
  }
  sim.step();
  for (const imp of sim.world.impacts) {
    const ua = imp.shapeA.userData, ub = imp.shapeB.userData;
    if (ua.boxer !== undefined && ub.boxer !== undefined && ua.boxer !== ub.boxer) {
      log.push(`${sim.time.toFixed(3)} ${ua.boxer}:${ua.part}-${ub.boxer}:${ub.part} J=${imp.impulse.toFixed(2)} v=${imp.approachSpeed.toFixed(2)}`);
    }
  }
}

function render() {
  debug.update();
  renderer.render(scene, camera);
}

window.lab = {
  sim,
  log,
  stepTo(t) {
    while (sim.time < t - 1e-9) step();
    render();
    return sim.time;
  },
};

if (!params.get('manual')) {
  const loop = () => {
    step();
    render();
    requestAnimationFrame(loop);
  };
  loop();
} else {
  render();
}
