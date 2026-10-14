/**
 * The car on a turntable, for comparing with the reference photographs:
 * ?dev=car&view=<front34|side|rear34|front|rear|top|cabin>&t=<ISO local>&doors=<0..1>&fov=..
 */
import { Mesh, PlaneGeometry, MeshStandardMaterial, Color, Vector3, PointLight } from 'three';
import { TimeStage } from './render/stage.js';
import { localToUtc } from './astro.js';
import { Car } from './car/car.js';

export async function devCar(canvas, params) {
  const stage = new TimeStage(canvas, { quality: params.get('q') ?? 'high' });
  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: new Color(0.28, 0.27, 0.25), roughness: 0.75 }));
  floor.rotation.x = -Math.PI / 2; stage.scene.add(floor);
  const car = new Car({ version: params.get('ver') ?? 'part1' });
  stage.scene.add(car.root);
  for (const g of car.glassPanes) stage.glass.add(g.mesh, g.opts);
  stage.cabin = car.cabin;
  car.setDoors(Number(params.get('doors') ?? 0));
  const [d, t] = (params.get('t') ?? '1985-10-26T14:30').split('T');
  const [y, mo, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  stage.setSky(localToUtc({ y, mo, d: dd, h, mi }), { glow: [2e-5, 1.2e-5, 0.5e-5] });
  if (params.get('lamp')) { const l = new PointLight(new Color(1, 0.75, 0.45), 0.6, 30); l.position.set(3, 6, 4); stage.scene.add(l); }
  const views = {
    front34: [[4.6, 1.5, 3.2], [0.2, 0.55, 0]], side: [[0, 0.75, 7.5], [0, 0.6, 0]], rear34: [[-4.6, 1.6, 3.4], [-0.3, 0.6, 0]],
    front: [[7, 0.8, 0], [0, 0.6, 0]], rear: [[-7, 0.9, 0], [0, 0.6, 0]], top: [[0.01, 9, 0], [0, 0, 0]], cabin: [[-0.25, 1.05, 0.36], [1.2, 0.85, 0.1]],
    dash: [[-0.35, 1.08, 0.0], [0.5, 0.82, 0.08]], petersen: [[4.2, 2.3, -2.6], [0, 0.6, 0.1]],
  };
  const v = views[params.get('view') ?? 'front34'] ?? views.front34;
  const yaw = Number(params.get('yaw') ?? 0) * Math.PI / 180;
  const e = new Vector3(...v[0]).applyAxisAngle(new Vector3(0, 1, 0), yaw);
  stage.camera.position.copy(e);
  stage.camera.lookAt(new Vector3(...v[1]));
  stage.camera.fov = Number(params.get('fov') ?? (params.get('view') === 'cabin' || params.get('view') === 'dash' ? 70 : 40));
  stage.camera.updateProjectionMatrix();
  return { stage, car, frame: (dt) => { car.update?.(dt); stage.render(dt); } };
}
