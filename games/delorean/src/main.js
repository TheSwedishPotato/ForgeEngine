/**
 * The DeLorean time machine on the Med Engine.
 * (?dev=stage: the bare stage test; ?manual=1 for the screenshot tool.)
 */
import './style.css';
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');
const manual = !!params.get('manual');

async function boot() {
  let app;
  if (params.get('dev') === 'stage') app = await (await import('./dev-stage.js')).devStage(canvas, params);
  else if (params.get('dev') === 'car') app = await (await import('./dev-car.js')).devCar(canvas, params);
  window.game = { ...app, ready: true, advance(dt) { const n = Math.max(1, Math.round(dt * 30)); for (let i = 0; i < n; i++) app.frame(dt / n); } };
  if (!manual) {
    let last = performance.now();
    const loop = (now) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; app.frame(dt); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot().catch((e) => { console.error(e); window.game = { error: String(e.stack || e) }; });
