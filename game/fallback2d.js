// Canvas2D version of Coin Rush: used when WebGPU is missing or the engine fails to start.
export function start2D(canvas, hud, msg) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const fit = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  fit(); addEventListener('resize', fit);
  const R = 13, rand = () => (Math.random() * 2 - 1) * R;
  const p = { x: 0, z: 0, vx: 0, vz: 0 };
  const coins = Array.from({ length: 12 }, () => ({ x: rand(), z: rand() }));
  let score = 0, left = 30, state = 'ready', tap = false;
  const keys = new Set();
  addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') tap = true; });
  addEventListener('keyup', (e) => keys.delete(e.code));
  const t = { id: null, x0: 0, y0: 0, ax: 0, az: 0 };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { t.id = e.pointerId; t.x0 = e.clientX; t.y0 = e.clientY; tap = true; });
  canvas.addEventListener('pointermove', (e) => { if (e.pointerId !== t.id) return; t.ax = Math.max(-1, Math.min(1, (e.clientX - t.x0) / 50)); t.az = Math.max(-1, Math.min(1, (e.clientY - t.y0) / 50)); });
  const end = (e) => { if (e.pointerId === t.id) { t.id = null; t.ax = t.az = 0; } };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  const k = (...c) => c.some((x) => keys.has(x));
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if ((state === 'ready' || state === 'over') && tap) { state = 'play'; score = 0; left = 30; msg.hidden = true; }
    tap = false;
    if (state === 'play') {
      const ax = t.ax || ((k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0));
      const az = t.az || ((k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0));
      p.vx += ax * 40 * dt; p.vz += az * 40 * dt;
      const d = Math.exp(-3 * dt); p.vx *= d; p.vz *= d;
      p.x = Math.max(-R, Math.min(R, p.x + p.vx * dt)); p.z = Math.max(-R, Math.min(R, p.z + p.vz * dt));
      for (const c of coins) if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 1.4) { score++; c.x = rand(); c.z = rand(); }
      left -= dt;
      if (left <= 0) { left = 0; state = 'over'; msg.hidden = false; msg.innerHTML = `<div>Time! Score ${score}<small>Tap or press Space to play again</small></div>`; }
    }
    hud.textContent = `Score ${score}   Time ${left.toFixed(1)}`;
    const W = canvas.width, H = canvas.height, s = Math.min(W, H) / (2 * R + 4), cx = W / 2, cy = H / 2;
    ctx.fillStyle = '#0e1511'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4f7f55'; ctx.fillRect(cx - (R + 1) * s, cy - (R + 1) * s, (2 * R + 2) * s, (2 * R + 2) * s);
    ctx.fillStyle = '#ffd23f';
    for (const c of coins) ctx.fillRect(cx + c.x * s - 0.35 * s, cy + c.z * s - 0.35 * s, 0.7 * s, 0.7 * s);
    ctx.fillStyle = '#e04f4f'; ctx.beginPath(); ctx.arc(cx + p.x * s, cy + p.z * s, 0.6 * s, 0, 7); ctx.fill();
    requestAnimationFrame(frame);
  })(last);
}
