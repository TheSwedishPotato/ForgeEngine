/** A bare test scene for the stage: ground, a few boxes, a lamp, a headlight; ?t=<ISO local> */
import { Mesh, BoxGeometry, PlaneGeometry, MeshStandardMaterial, PointLight, Vector3, Color } from 'three';
import { TimeStage } from './render/stage.js';
import { localToUtc } from './astro.js';

export async function devStage(canvas, params) {
  const stage = new TimeStage(canvas, { quality: params.get('q') ?? 'high' });
  const g = new Mesh(new PlaneGeometry(400, 400), new MeshStandardMaterial({ color: new Color(0.12, 0.12, 0.12), roughness: 0.85 }));
  g.rotation.x = -Math.PI / 2; stage.scene.add(g);
  const steel = new MeshStandardMaterial({ color: new Color(0.62, 0.62, 0.63), roughness: 0.3, metalness: 1 });
  for (let i = 0; i < 5; i++) { const b = new Mesh(new BoxGeometry(1.8, 1.1, 4.2), steel); b.position.set(-8 + i * 4, 0.55, -6); b.castShadow = true; stage.scene.add(b); }
  const lamp = new PointLight(new Color(1.0, 0.62, 0.25), 0.45, 40); lamp.position.set(0, 9, -2); stage.scene.add(lamp);
  const [d, t] = (params.get('t') ?? '1985-10-26T01:20').split('T');
  const [y, mo, dd] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  stage.setSky(localToUtc({ y, mo, d: dd, h, mi }), { glow: params.get('glow') ? [3e-5, 1.6e-5, 0.6e-5] : [0, 0, 0] });
  stage.spots = [{ pos: new Vector3(-0.6, 0.65, 2), dir: new Vector3(0, -0.03, -1).normalize(), color: [1.6, 1.5, 1.3], range: 90, shape: [0.32, 0.09, 0.0] }];
  stage.camera.position.set(0, 1.4, 8);
  stage.camera.lookAt(0, 1.6, -6);
  if (params.get('up')) stage.camera.lookAt(0, 30, -20);
  return { stage, frame: (dt) => stage.render(dt) };
}
