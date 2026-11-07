import { Engine, Mesh, PlaneGeometry, BoxGeometry, SphereGeometry, StandardMaterial, DirectionalLight, BrowserPlatform } from './engine.min.js';

const canvas = document.querySelector('canvas'), hud = document.getElementById('hud'), msg = document.getElementById('msg');
const engine = await Engine.create({ platform: new BrowserPlatform({ canvas }) });
const { scene, camera, input } = engine;

const ground = new Mesh(new PlaneGeometry(30, 30), new StandardMaterial({ color: 0x4f7f55, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const sun = new DirectionalLight(0xfff2dd, 7); sun.position.set(6, 12, 5); scene.add(sun);

const player = new Mesh(new SphereGeometry(0.6, 32, 16), new StandardMaterial({ color: 0xe04f4f, roughness: 0.4 }));
player.position.set(0, 0.6, 0); player.castShadow = true; scene.add(player);

const coinMat = new StandardMaterial({ color: 0xffd23f, metalness: 0.8, roughness: 0.25 });
const coins = [];
const R = 13, rand = () => (Math.random() * 2 - 1) * R;
for (let i = 0; i < 12; i++) {
  const c = new Mesh(new BoxGeometry(0.7, 0.7, 0.7), coinMat);
  c.position.set(rand(), 0.8, rand()); c.castShadow = true; scene.add(c); coins.push(c);
}

let score = 0, left = 30, state = 'ready';
const vel = { x: 0, z: 0 };
const key = (...k) => k.some((c) => input.keyDown(c));

engine.add({
  update(dt) {
    if (state === 'ready' || state === 'over') {
      if (key('Space')) { state = 'play'; score = 0; left = 30; msg.hidden = true; }
    }
    coins.forEach((c) => { c.rotation.y += dt * 2; });
    if (state === 'play') {
      const ax = (key('KeyD', 'ArrowRight') ? 1 : 0) - (key('KeyA', 'ArrowLeft') ? 1 : 0);
      const az = (key('KeyS', 'ArrowDown') ? 1 : 0) - (key('KeyW', 'ArrowUp') ? 1 : 0);
      vel.x += ax * 40 * dt; vel.z += az * 40 * dt;
      const damp = Math.exp(-3 * dt); vel.x *= damp; vel.z *= damp;
      player.position.x = Math.max(-R - 1, Math.min(R + 1, player.position.x + vel.x * dt));
      player.position.z = Math.max(-R - 1, Math.min(R + 1, player.position.z + vel.z * dt));
      player.rotation.x += vel.z * dt; player.rotation.z -= vel.x * dt;
      for (const c of coins) {
        const dx = c.position.x - player.position.x, dz = c.position.z - player.position.z;
        if (dx * dx + dz * dz < 1.4) { score++; c.position.set(rand(), 0.8, rand()); }
      }
      left -= dt;
      if (left <= 0) { left = 0; state = 'over'; msg.hidden = false; msg.innerHTML = `<div>Time! Score ${score}<small>Space to play again</small></div>`; }
    }
    hud.textContent = `Score ${score}   Time ${left.toFixed(1)}`;
    camera.position.set(player.position.x * 0.6, 14, player.position.z * 0.6 + 10);
    camera.lookAt(player.position);
  },
});
canvas.focus(); canvas.addEventListener("pointerdown", () => canvas.focus());
engine.start();
