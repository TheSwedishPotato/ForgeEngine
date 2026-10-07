/**
 * The sets: every place the director can name, painted once per scene into
 * a wide plate (2400 × 1200 stage units) the camera then moves over. The
 * painter also says where the light comes from (hearth, candles, windows,
 * the moon) so the film can make it flicker and glow, how dark the place
 * is, and where people stand.
 */
import { rng, hex, rgb, mix, shade, css, grad, radial, blob, strokes, canvas } from './paint.js';

export const PW = 2400, PH = 1200, FLOOR = 1030;

const INTERIOR = new Set(['tavern', 'hall', 'chamber', 'cottage', 'church', 'workshop', 'cellar', 'dungeon', 'kitchen', 'stable', 'cave']);

const SKY = {
  dawn: [[0, '#28345e'], [0.45, '#8a5a7a'], [0.75, '#e48d6a'], [1, '#f5d09a']],
  day: [[0, '#5b88c4'], [0.6, '#a9c4dc'], [1, '#e2e6e2']],
  dusk: [[0, '#1d1d40'], [0.45, '#6a3a62'], [0.75, '#c0604e'], [1, '#f0a050']],
  night: [[0, '#03050c'], [0.6, '#0c1630'], [1, '#1c2a48']],
};
const HAZE = { dawn: '#e8b098', day: '#c8d4dc', dusk: '#c07a68', night: '#1e2a46' };
const SUNLIGHT = { dawn: [255, 190, 140], day: [255, 244, 220], dusk: [255, 150, 90], night: [120, 150, 220] };

/** Paint a scene. Returns { plate, lights, dark, tint, floor, interior }. */
export function paintSet(scene) {
  const c = canvas(PW, PH), ctx = c.getContext('2d');
  const R = rng(`${scene.place}|${scene.name}|${scene.time}`);
  const out = { plate: c, lights: [], dark: 0, tint: SUNLIGHT[scene.time] ?? SUNLIGHT.day, floor: FLOOR, interior: INTERIOR.has(scene.place), slots: [] };
  const grey = scene.weather === 'rain' || scene.weather === 'storm' || scene.weather === 'fog' || scene.light === 'overcast';
  if (out.interior) interior(ctx, scene, R, out);
  else exterior(ctx, scene, R, out, grey);
  // how dark it is, from the light named and the hour
  const night = scene.time === 'night', dim = scene.time === 'dusk' || scene.time === 'dawn';
  out.dark = out.interior
    ? ({ firelight: 0.45, candle: 0.55, torchlight: 0.5, moonlight: 0.6, daylight: 0.15, overcast: 0.28, golden: 0.18 }[scene.light] ?? 0.3) + (night ? 0.15 : 0)
    : night ? 0.62 : dim ? 0.22 : grey ? 0.12 : 0;
  if (scene.light === 'golden') out.tint = [255, 190, 110];
  if (scene.light === 'moonlight') out.tint = [130, 160, 230];
  if (scene.light === 'firelight' || scene.light === 'candle' || scene.light === 'torchlight') out.tint = [255, 170, 90];
  // where people stand: spread across the middle, front to back a little
  for (let i = 0; i < 7; i++) out.slots.push({ x: PW / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 260 + (R() - 0.5) * 60, y: FLOOR - (i % 3) * 18 });
  return out;
}

// --- outside --------------------------------------------------------------------------------------

function exterior(ctx, scene, R, out, grey) {
  const t = scene.time;
  let sky = SKY[t] ?? SKY.day;
  if (grey) sky = sky.map(([k, col]) => [k, css(mix(col, t === 'night' ? '#101418' : '#9aa0a4', 0.6))]);
  const horizon = ['hilltop', 'field', 'shore', 'ship', 'river'].includes(scene.place) ? 760 : 700;
  ctx.fillStyle = grad(ctx, 0, 0, 0, horizon + 80, sky);
  ctx.fillRect(0, 0, PW, PH);
  // sun or moon
  if (!grey) {
    if (t === 'night') {
      for (let i = 0; i < 220; i++) { ctx.fillStyle = `rgba(255,255,240,${0.2 + R() * 0.6})`; ctx.fillRect(R() * PW, R() * horizon * 0.8, R() < 0.1 ? 2.2 : 1.2, R() < 0.1 ? 2.2 : 1.2); }
      const mx = 400 + R() * 1600, my = 160 + R() * 120;
      blob(ctx, mx, my, 160, 160, [200, 210, 255], 0.25);
      ctx.fillStyle = '#f2efe0'; ctx.beginPath(); ctx.arc(mx, my, 34, 0, 7); ctx.fill();
      out.lights.push({ x: mx, y: my, r: 260, color: [190, 205, 255], power: 0.35, sky: true });
    } else {
      const sx = t === 'dawn' ? 500 : t === 'dusk' ? 1900 : 1200 + (R() - 0.5) * 600, sy = t === 'day' ? 140 : horizon - 60;
      blob(ctx, sx, sy, 420, 420, SUNLIGHT[t], 0.35);
      blob(ctx, sx, sy, 90, 90, [255, 250, 230], 0.9, 0.5);
      out.lights.push({ x: sx, y: sy, r: 700, color: SUNLIGHT[t], power: 0.25, sky: true });
    }
  }
  // clouds
  const cl = grey ? [120, 124, 130] : t === 'night' ? [40, 50, 80] : t === 'day' ? [250, 250, 250] : [240, 170, 150];
  for (let i = 0; i < (grey ? 26 : 12); i++) blob(ctx, R() * PW, 60 + R() * (horizon * 0.55), 160 + R() * 260, 40 + R() * 50, cl, grey ? 0.55 : 0.35);
  // far hills in haze
  const haze = hex(grey ? '#8a9096' : HAZE[t]);
  for (let l = 0; l < 3; l++) {
    const base = horizon - 40 + l * 30, col = mix(haze, t === 'night' ? [8, 12, 20] : [40, 60, 40], 0.25 + l * 0.22);
    ctx.fillStyle = rgb(col); ctx.beginPath(); ctx.moveTo(0, PH);
    for (let x = 0; x <= PW; x += 40) ctx.lineTo(x, base - 60 * Math.sin(x / (300 + l * 120) + l * 2 + R() * 0.05) - 40 * Math.sin(x / 130 + l));
    ctx.lineTo(PW, PH); ctx.fill();
  }
  const ground = t === 'night' ? '#1a2018' : scene.weather === 'snow' ? '#dfe4ea' : '#5c6a3a';
  const P = scene.place;
  if (P === 'shore' || P === 'ship' || P === 'river' || P === 'bridge') water(ctx, R, horizon, t, grey, out, P);
  else { ctx.fillStyle = grad(ctx, 0, horizon, 0, PH, [[0, css(ground, -0.05)], [1, css(ground, -0.45)]]); ctx.fillRect(0, horizon, PW, PH - horizon); strokes(ctx, 0, horizon, PW, PH - horizon, ground, 900, R, 26, 3, 0.18); }
  if (scene.weather === 'snow') { ctx.fillStyle = 'rgba(235,240,248,0.85)'; ctx.fillRect(0, horizon + 20, PW, PH); }
  const town = ['street', 'market', 'square', 'gate', 'courtyard', 'castle', 'graveyard'].includes(P);
  if (town) townscape(ctx, R, horizon, t, P, out);
  if (P === 'forest' || P === 'road' || P === 'graveyard' || P === 'garden') trees(ctx, R, horizon, t, P === 'forest' ? 26 : 8, P === 'forest');
  if (P === 'field') field(ctx, R, horizon, t);
  if (P === 'road') road(ctx, horizon, t);
  if (P === 'camp') camp(ctx, R, horizon, out);
  if (P === 'hilltop') { ctx.fillStyle = css('#3a4a2a', t === 'night' ? -0.7 : 0); ctx.beginPath(); ctx.moveTo(0, PH); ctx.quadraticCurveTo(PW / 2, horizon - 40, PW, PH); ctx.fill(); }
  if (P === 'graveyard') graves(ctx, R, horizon, t);
  if (P === 'garden') hedge(ctx, R, horizon, t);
  if (P === 'ship') deck(ctx, R, t);
  // a near ground band, for the feet
  ctx.fillStyle = grad(ctx, 0, FLOOR - 60, 0, PH, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${t === 'night' ? 0.6 : 0.35})`]]);
  ctx.fillRect(0, FLOOR - 60, PW, PH);
  if (scene.weather === 'fog') for (let i = 0; i < 14; i++) blob(ctx, R() * PW, horizon + R() * 300, 500, 90, [200, 205, 210], 0.35);
}

function water(ctx, R, horizon, t, grey, out, P) {
  const sky = hex(SKY[t]?.[SKY[t].length - 1][1] ?? '#8aa');
  const deep = mix(sky, [10, 30, 50], 0.65);
  ctx.fillStyle = grad(ctx, 0, horizon, 0, PH, [[0, rgb(mix(sky, deep, 0.3))], [1, rgb(deep)]]);
  ctx.fillRect(0, horizon, PW, PH - horizon);
  for (let i = 0; i < 500; i++) { const y = horizon + Math.pow(R(), 1.6) * (PH - horizon); ctx.fillStyle = `rgba(255,255,255,${0.03 + R() * 0.08})`; ctx.fillRect(R() * PW, y, 20 + R() * 80 * (y / PH), 1.5); }
  if (P === 'river' || P === 'bridge') { ctx.fillStyle = css('#4a5a34', t === 'night' ? -0.7 : -0.1); ctx.fillRect(0, horizon + 260, PW, PH); ctx.fillStyle = grad(ctx, 0, horizon + 240, 0, horizon + 290, [[0, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]); ctx.fillRect(0, horizon + 240, PW, 60); }
  if (P === 'bridge') {
    const stone = css('#8a7e6a', t === 'night' ? -0.7 : -0.1);
    ctx.fillStyle = stone; ctx.fillRect(300, horizon - 60, 1800, 70);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = css('#000000', 0, 0.45); ctx.beginPath(); ctx.ellipse(500 + i * 460, horizon + 10, 170, 120, 0, Math.PI, 0); ctx.fill(); }
    for (let i = 0; i < 12; i++) { ctx.fillStyle = stone; ctx.fillRect(300 + i * 160, horizon - 100, 40, 40); }
  }
  if (P === 'shore') { ctx.fillStyle = css('#a89a70', t === 'night' ? -0.75 : -0.1); ctx.beginPath(); ctx.moveTo(0, PH); ctx.lineTo(0, horizon + 300); ctx.quadraticCurveTo(PW * 0.6, horizon + 220, PW, horizon + 340); ctx.lineTo(PW, PH); ctx.fill();
    for (let i = 0; i < 3; i++) { const x = 300 + R() * 1800, y = horizon + 40 + R() * 80; ctx.fillStyle = css('#3a2a1a', t === 'night' ? -0.6 : 0); ctx.beginPath(); ctx.moveTo(x - 90, y); ctx.quadraticCurveTo(x, y + 40, x + 90, y); ctx.fill(); ctx.fillRect(x - 3, y - 150, 6, 150); ctx.fillStyle = css('#d8cdb0', t === 'night' ? -0.7 : 0); ctx.beginPath(); ctx.moveTo(x, y - 150); ctx.lineTo(x + 70, y - 40); ctx.lineTo(x, y - 40); ctx.fill(); } }
  void grey; void out;
}

function house(ctx, x, base, w, h, R, t, light, out) {
  const night = t === 'night';
  const wall = css(R() < 0.5 ? '#d8ccb0' : '#c8b898', night ? -0.75 : -0.05 - R() * 0.1);
  ctx.fillStyle = wall; ctx.fillRect(x, base - h, w, h);
  // timber frame
  ctx.strokeStyle = css('#3a2618', night ? -0.6 : 0); ctx.lineWidth = 8;
  ctx.strokeRect(x, base - h, w, h);
  ctx.beginPath(); ctx.moveTo(x, base - h / 2); ctx.lineTo(x + w, base - h / 2); ctx.moveTo(x + w / 2, base - h); ctx.lineTo(x + w / 2, base); ctx.moveTo(x, base - h); ctx.lineTo(x + w / 2, base - h / 2); ctx.stroke();
  // roof
  const roof = R() < 0.5 ? '#5a3a28' : '#6a6a5a';
  ctx.fillStyle = css(roof, night ? -0.7 : -0.1);
  ctx.beginPath(); ctx.moveTo(x - 20, base - h); ctx.lineTo(x + w / 2, base - h - h * (0.6 + R() * 0.4)); ctx.lineTo(x + w + 20, base - h); ctx.fill();
  // windows, lit at night
  for (let i = 0; i < 2; i++) {
    const wx = x + w * (0.22 + i * 0.4), wy = base - h * 0.78;
    const lit = (night || t === 'dusk') && R() < 0.7;
    ctx.fillStyle = lit ? '#f0b060' : css('#1a1410', night ? -0.5 : 0);
    ctx.fillRect(wx, wy, w * 0.16, h * 0.2);
    if (lit && light) out.lights.push({ x: wx + w * 0.08, y: wy + h * 0.1, r: 120, color: [255, 170, 80], power: 0.5, flicker: true });
  }
  ctx.fillStyle = css('#2a1a10', night ? -0.5 : 0); ctx.fillRect(x + w * 0.42, base - h * 0.42, w * 0.16, h * 0.42);
}

function townscape(ctx, R, horizon, t, P, out) {
  // a church tower or a castle behind
  const night = t === 'night';
  const stone = css('#8a8274', night ? -0.75 : -0.15);
  if (P === 'castle' || P === 'gate' || P === 'courtyard') {
    ctx.fillStyle = stone; ctx.fillRect(0, horizon - 260, PW, 300);
    for (let x = 0; x < PW; x += 70) ctx.fillRect(x, horizon - 300, 40, 40);
    for (const tx of [300, 1100, 1900]) { ctx.fillRect(tx, horizon - 520, 240, 560); for (let k = 0; k < 4; k++) ctx.fillRect(tx + k * 64, horizon - 560, 40, 40); ctx.fillStyle = css('#1a1410', night ? -0.3 : 0); ctx.fillRect(tx + 100, horizon - 440, 30, 60); ctx.fillStyle = stone; }
    if (P === 'gate') { ctx.fillStyle = css('#100c08'); ctx.beginPath(); ctx.moveTo(1020, horizon + 40); ctx.lineTo(1020, horizon - 180); ctx.arc(1200, horizon - 180, 180, Math.PI, 0); ctx.lineTo(1380, horizon + 40); ctx.fill(); }
  } else {
    ctx.fillStyle = stone; ctx.fillRect(1500, horizon - 620, 160, 660);
    ctx.beginPath(); ctx.moveTo(1480, horizon - 620); ctx.lineTo(1580, horizon - 860); ctx.lineTo(1680, horizon - 620); ctx.fillStyle = css('#3a3030', night ? -0.6 : 0); ctx.fill();
  }
  if (P !== 'castle') {
    let x = -60;
    while (x < PW) { const w = 200 + R() * 160, h = 220 + R() * 160; house(ctx, x, horizon + 140, w, h, R, t, true, out); x += w + 10 + R() * 30; }
  }
  if (P === 'market') for (let i = 0; i < 4; i++) {
    const x = 250 + i * 520 + R() * 80, y = FLOOR - 140;
    ctx.fillStyle = css('#5a3a22', night ? -0.6 : 0); ctx.fillRect(x, y, 300, 90); ctx.fillRect(x + 10, y - 150, 10, 150); ctx.fillRect(x + 280, y - 150, 10, 150);
    ctx.fillStyle = css(R() < 0.5 ? '#9a2a22' : '#c8b070', night ? -0.6 : 0); ctx.beginPath(); ctx.moveTo(x - 20, y - 150); ctx.lineTo(x + 320, y - 150); ctx.lineTo(x + 300, y - 200); ctx.lineTo(x, y - 200); ctx.fill();
    for (let k = 0; k < 8; k++) blob(ctx, x + 30 + k * 32, y - 8, 16, 12, R() < 0.5 ? [180, 60, 40] : [200, 170, 80], 0.9, 0.2);
  }
  // cobbles
  ctx.fillStyle = css('#6a645a', night ? -0.75 : -0.2); ctx.fillRect(0, horizon + 140, PW, PH);
  strokes(ctx, 0, horizon + 140, PW, PH, '#8a8478', 1600, R, 14, 5, night ? 0.06 : 0.2);
  if (P === 'square') { ctx.fillStyle = css('#8a8274', night ? -0.7 : -0.1); ctx.beginPath(); ctx.ellipse(1200, FLOOR - 120, 180, 40, 0, 0, 7); ctx.fill(); ctx.fillRect(1180, FLOOR - 260, 40, 140); }
}

function trees(ctx, R, horizon, t, n, dense) {
  const night = t === 'night';
  for (let i = 0; i < n; i++) {
    const depth = R(), x = R() * PW, base = horizon + 40 + depth * (dense ? 420 : 200), s = 0.5 + depth * 1.2;
    ctx.fillStyle = css('#3a2a1c', night ? -0.7 : -0.2 + depth * 0.1); ctx.fillRect(x - 10 * s, base - 300 * s, 20 * s, 300 * s);
    const leaf = mix(mix('#3a5a2a', '#7a8a3a', R()), night ? [5, 10, 15] : HAZE[t] ? hex(HAZE[t]) : [200, 200, 200], (1 - depth) * 0.45 + (night ? 0.5 : 0));
    for (let k = 0; k < 6; k++) blob(ctx, x + (R() - 0.5) * 140 * s, base - 300 * s - R() * 160 * s, 110 * s, 90 * s, leaf, 0.95, 0.35);
  }
  if (dense && t !== 'night') for (let i = 0; i < 5; i++) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = grad(ctx, 0, 0, 0, PH, [[0, 'rgba(255,230,170,0.12)'], [1, 'rgba(255,230,170,0)']]); const x = R() * PW; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 80, 0); ctx.lineTo(x + 380, PH); ctx.lineTo(x + 200, PH); ctx.fill(); ctx.restore(); }
}

function field(ctx, R, horizon, t) {
  ctx.strokeStyle = css('#3a3018', t === 'night' ? -0.7 : 0, 0.5); ctx.lineWidth = 3;
  for (let i = -20; i < 40; i++) { ctx.beginPath(); ctx.moveTo(PW / 2 + i * 12, horizon + 20); ctx.lineTo(PW / 2 + i * 160, PH); ctx.stroke(); }
  trees(ctx, R, horizon, t, 3, false);
}

function road(ctx, horizon, t) {
  ctx.fillStyle = css('#8a7a5a', t === 'night' ? -0.7 : -0.1);
  ctx.beginPath(); ctx.moveTo(1150, horizon + 20); ctx.lineTo(1250, horizon + 20); ctx.lineTo(1900, PH); ctx.lineTo(500, PH); ctx.fill();
}

function camp(ctx, R, horizon, out) {
  for (let i = 0; i < 5; i++) { const x = 200 + i * 450 + R() * 100, y = horizon + 120; ctx.fillStyle = css(R() < 0.5 ? '#c8b898' : '#8a6a4a', -0.2); ctx.beginPath(); ctx.moveTo(x - 140, y); ctx.lineTo(x, y - 200); ctx.lineTo(x + 140, y); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(x - 30, y); ctx.lineTo(x, y - 120); ctx.lineTo(x + 30, y); ctx.fill(); }
  fire(ctx, 1200, FLOOR - 40, 1, out);
}

function graves(ctx, R, horizon, t) {
  for (let i = 0; i < 14; i++) { const x = R() * PW, y = horizon + 80 + R() * 250, s = 0.5 + (y - horizon) / 400; ctx.fillStyle = css('#6a6a64', t === 'night' ? -0.7 : -0.1); ctx.fillRect(x - 6 * s, y - 80 * s, 12 * s, 80 * s); ctx.fillRect(x - 30 * s, y - 62 * s, 60 * s, 12 * s); }
}

function hedge(ctx, R, horizon, t) {
  for (let x = 0; x < PW; x += 90) blob(ctx, x, horizon + 100, 90, 70, mix('#2a4a22', t === 'night' ? '#05080a' : '#2a4a22', t === 'night' ? 0.7 : 0), 1, 0.3);
  for (let i = 0; i < 200; i++) { ctx.fillStyle = R() < 0.5 ? 'rgba(220,80,90,0.8)' : 'rgba(240,220,120,0.8)'; ctx.fillRect(R() * PW, horizon + 160 + R() * 400, 5, 5); }
}

function deck(ctx, R, t) {
  ctx.fillStyle = css('#6a4a2a', t === 'night' ? -0.7 : -0.1); ctx.fillRect(0, FLOOR - 140, PW, PH);
  strokes(ctx, 0, FLOOR - 140, PW, PH, '#4a3018', 300, R, 300, 3, 0.25);
  ctx.fillStyle = css('#3a2818', t === 'night' ? -0.6 : 0); ctx.fillRect(1180, 0, 40, FLOOR - 140);
  ctx.strokeStyle = 'rgba(30,20,10,0.6)'; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(1200, 40 + i * 20); ctx.lineTo(i < 3 ? 0 : PW, FLOOR - 150); ctx.stroke(); }
}

// --- inside --------------------------------------------------------------------------------------

const WALLS = { tavern: '#7a5a3a', hall: '#8a8070', chamber: '#a08a6a', cottage: '#8a7050', church: '#9a9282', workshop: '#6a5240', cellar: '#5a5048', dungeon: '#4a4640', kitchen: '#8a6a48', stable: '#6a5034', cave: '#3a3430' };

function interior(ctx, scene, R, out) {
  const P = scene.place, wallC = WALLS[P] ?? '#7a6a50';
  const back = 830;
  ctx.fillStyle = grad(ctx, 0, 0, 0, back, [[0, css(wallC, -0.35)], [1, css(wallC, -0.05)]]);
  ctx.fillRect(0, 0, PW, back);
  strokes(ctx, 0, 0, PW, back, wallC, 1400, R, 40, 6, 0.12);
  if (P === 'cellar' || P === 'dungeon' || P === 'church' || P === 'cave') stones(ctx, R, back, wallC);
  // floor
  ctx.fillStyle = grad(ctx, 0, back, 0, PH, [[0, css(wallC, -0.4)], [1, css(wallC, -0.7)]]);
  ctx.fillRect(0, back, PW, PH - back);
  strokes(ctx, 0, back, PW, PH - back, wallC, 600, R, 160, 3, 0.12);
  // a window to the outside, light by the hour
  if (P !== 'cellar' && P !== 'dungeon' && P !== 'cave') {
    const n = P === 'hall' || P === 'church' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const wx = n === 1 ? 300 + R() * 300 : 500 + i * 700, wy = P === 'church' || P === 'hall' ? 120 : 260, ww = P === 'church' ? 150 : 170, wh = P === 'church' ? 380 : 210;
      const sky = { dawn: [240, 170, 130], day: [220, 230, 240], dusk: [230, 130, 80], night: [40, 60, 110] }[scene.time];
      ctx.fillStyle = rgb(scene.weather === 'rain' || scene.weather === 'storm' ? mix(sky, [120, 125, 130], 0.6) : sky);
      if (P === 'church') { ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx, wy + 60); ctx.arc(wx + ww / 2, wy + 60, ww / 2, Math.PI, 0); ctx.lineTo(wx + ww, wy + wh); ctx.fill();
        const panes = [[180, 40, 40], [40, 70, 180], [210, 170, 60], [40, 120, 70]];
        for (let k = 0; k < 24; k++) { ctx.fillStyle = rgb(panes[(k * 7) % 4], scene.time === 'night' ? 0.35 : 0.75); ctx.fillRect(wx + 8 + (k % 4) * (ww - 16) / 4, wy + 70 + Math.floor(k / 4) * (wh - 80) / 6, (ww - 16) / 4 - 4, (wh - 80) / 6 - 4); } }
      else ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = css('#2a1a10'); ctx.lineWidth = 10; ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
      out.lights.push({ x: wx + ww / 2, y: wy + wh / 2, r: 420, color: sky, power: scene.time === 'night' ? 0.15 : 0.6, window: true });
      if (scene.time !== 'night') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = grad(ctx, wx, wy, wx + 500, PH, [[0, rgb(sky, 0.18)], [1, rgb(sky, 0)]]); ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + ww, wy); ctx.lineTo(wx + ww + 520, PH); ctx.lineTo(wx + 320, PH); ctx.fill(); ctx.restore(); }
    }
  }
  // beams
  if (P !== 'cave' && P !== 'church') { ctx.fillStyle = css('#2a1a10', -0.2); for (let x = -50; x < PW; x += 420) ctx.fillRect(x, 0, 36, back); ctx.fillRect(0, 60, PW, 34); }
  PROPS[P]?.(ctx, R, back, scene, out);
  if (!out.lights.some((l) => l.flicker) && scene.light !== 'daylight') candle(ctx, 1800 + R() * 200, back + 40, out);
}

function stones(ctx, R, back, c) {
  ctx.strokeStyle = css(c, -0.5, 0.5); ctx.lineWidth = 3;
  for (let y = 0; y < back; y += 60) for (let x = (y / 60) % 2 ? -60 : 0; x < PW; x += 120) ctx.strokeRect(x + (R() - 0.5) * 6, y, 120, 60);
}

function fire(ctx, x, y, s, out) {
  blob(ctx, x, y - 30 * s, 160 * s, 120 * s, [255, 140, 40], 0.55);
  for (let i = 0; i < 5; i++) { ctx.fillStyle = `rgba(${255},${120 + i * 25},${30 + i * 10},0.9)`; ctx.beginPath(); ctx.moveTo(x - (40 - i * 6) * s, y); ctx.quadraticCurveTo(x, y - (140 - i * 20) * s, x + (40 - i * 6) * s, y); ctx.fill(); }
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(x - 60 * s, y - 6, 120 * s, 12);
  out.lights.push({ x, y: y - 50 * s, r: 520 * s, color: [255, 150, 60], power: 0.9, flicker: true });
}

function candle(ctx, x, y, out) {
  ctx.fillStyle = '#e8dcc0'; ctx.fillRect(x - 5, y - 40, 10, 40);
  blob(ctx, x, y - 50, 24, 24, [255, 200, 120], 0.9, 0.4);
  ctx.fillStyle = '#fff4c0'; ctx.beginPath(); ctx.ellipse(x, y - 50, 4, 10, 0, 0, 7); ctx.fill();
  out.lights.push({ x, y: y - 50, r: 260, color: [255, 180, 90], power: 0.7, flicker: true });
}

function table(ctx, x, y, w, c) {
  ctx.fillStyle = css(c, -0.2); ctx.fillRect(x, y, w, 26);
  ctx.fillStyle = css(c, -0.45); ctx.fillRect(x + 20, y + 26, 20, 110); ctx.fillRect(x + w - 40, y + 26, 20, 110);
}

function barrel(ctx, x, y, s = 1) {
  ctx.fillStyle = css('#5a3a20', -0.1); ctx.beginPath(); ctx.ellipse(x, y - 70 * s, 55 * s, 75 * s, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 5 * s; for (const k of [-40, 0, 40]) { ctx.beginPath(); ctx.moveTo(x - 52 * s, y - 70 * s + k * s); ctx.lineTo(x + 52 * s, y - 70 * s + k * s); ctx.stroke(); }
}

function hearth(ctx, x, back, out, s = 1) {
  ctx.fillStyle = css('#4a4038', -0.2); ctx.fillRect(x - 200 * s, back - 340 * s, 400 * s, 340 * s);
  ctx.fillStyle = '#100a06'; ctx.fillRect(x - 140 * s, back - 220 * s, 280 * s, 220 * s);
  ctx.fillStyle = css('#3a3028', -0.2); ctx.fillRect(x - 230 * s, back - 360 * s, 460 * s, 40 * s);
  fire(ctx, x, back - 10, 0.9 * s, out);
}

const PROPS = {
  tavern(ctx, R, back, s, out) { hearth(ctx, 1700, back, out); table(ctx, 500, back + 110, 520, '#6a4a2a'); table(ctx, 1200, back + 150, 400, '#6a4a2a'); for (let i = 0; i < 4; i++) barrel(ctx, 2100 + (i % 2) * 120, back + 60 + (i > 1 ? 0 : -150)); for (let i = 0; i < 5; i++) { ctx.fillStyle = '#4a3a28'; ctx.fillRect(560 + i * 90, back + 80, 26, 32); } candle(ctx, 760, back + 110, out); },
  hall(ctx, R, back, s, out) { for (let i = 0; i < 4; i++) { ctx.fillStyle = css('#8a8070', -0.25); ctx.fillRect(250 + i * 600, 0, 90, back); ctx.fillStyle = css(i % 2 ? '#7a1a1a' : '#1a2a6a'); ctx.fillRect(400 + i * 600, 100, 140, 360); ctx.beginPath(); ctx.moveTo(400 + i * 600, 460); ctx.lineTo(470 + i * 600, 520); ctx.lineTo(540 + i * 600, 460); ctx.fill(); } table(ctx, 600, back + 60, 1200, '#5a3a20'); hearth(ctx, 2150, back, out, 1.2); },
  chamber(ctx, R, back, s, out) { ctx.fillStyle = css('#6a4a30', -0.2); ctx.fillRect(1500, back - 60, 520, 180); ctx.fillStyle = css('#d8cdb0', -0.1); ctx.fillRect(1510, back - 90, 500, 50); ctx.fillStyle = css('#7a2a2a', -0.1); ctx.fillRect(1510, back - 40, 500, 100); ctx.fillStyle = css('#5a3a20', -0.2); ctx.fillRect(900, back + 60, 220, 110); candle(ctx, 1010, back + 50, out); },
  cottage(ctx, R, back, s, out) { hearth(ctx, 1300, back, out, 0.8); for (let i = 0; i < 9; i++) { ctx.strokeStyle = '#6a7a3a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(300 + i * 60, 94); ctx.lineTo(300 + i * 60, 160 + R() * 40); ctx.stroke(); } table(ctx, 500, back + 120, 360, '#6a5030'); ctx.fillStyle = '#5a4a3a'; ctx.beginPath(); ctx.ellipse(1950, back + 80, 70, 50, 0, 0, 7); ctx.fill(); },
  church(ctx, R, back, s, out) { for (let i = 0; i < 5; i++) { ctx.fillStyle = css('#8a8274', -0.3); ctx.fillRect(150 + i * 520, 0, 80, back); } ctx.fillStyle = css('#d8cdb0', -0.1); ctx.fillRect(1050, back - 120, 300, 120); ctx.fillStyle = '#c8a050'; ctx.fillRect(1190, back - 330, 20, 200); ctx.fillRect(1130, back - 280, 140, 18); for (const x of [1080, 1320]) candle(ctx, x, back - 120, out); for (let i = 0; i < 6; i++) { ctx.fillStyle = css('#4a3420', -0.2); ctx.fillRect(200 + (i % 3) * 300 + (i > 2 ? 1150 : 0), back + 160, 240, 40); } },
  workshop(ctx, R, back, s, out) { ctx.fillStyle = css('#5a4a3a', -0.2); ctx.beginPath(); ctx.arc(1700, back, 230, Math.PI, 0); ctx.fill(); ctx.fillStyle = '#1a0a04'; ctx.beginPath(); ctx.arc(1700, back - 40, 90, Math.PI, 0); ctx.fill(); blob(ctx, 1700, back - 60, 140, 80, [255, 160, 60], 0.9, 0.4); out.lights.push({ x: 1700, y: back - 80, r: 560, color: [255, 140, 50], power: 1, flicker: true }); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(900, back + 60, 160, 40); ctx.fillRect(950, back + 100, 60, 90); table(ctx, 300, back + 80, 420, '#5a4030'); },
  cellar(ctx, R, back, s, out) { for (let i = 0; i < 7; i++) barrel(ctx, 300 + i * 300, back + 90, 1.2); torch(ctx, 1200, 400, out); },
  dungeon(ctx, R, back, s, out) { ctx.fillStyle = '#1a1612'; for (let x = 700; x < 1700; x += 60) ctx.fillRect(x, 200, 16, back - 200); ctx.fillRect(700, 200, 1000, 20); torch(ctx, 400, 380, out); ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(2000, 300); ctx.quadraticCurveTo(2050, 500, 2000, 640); ctx.stroke(); },
  kitchen(ctx, R, back, s, out) { hearth(ctx, 1200, back, out, 1.1); ctx.fillStyle = '#2a2a2a'; ctx.beginPath(); ctx.ellipse(1200, back - 160, 90, 70, 0, 0, 7); ctx.fill(); table(ctx, 300, back + 100, 500, '#6a5030'); for (let i = 0; i < 6; i++) { ctx.fillStyle = css('#8a6a40', -0.2); ctx.beginPath(); ctx.arc(1700 + i * 80, 260, 26, 0, 7); ctx.fill(); } },
  stable(ctx, R, back, s, out) { for (let i = 0; i < 4; i++) { ctx.fillStyle = css('#5a3a20', -0.2); ctx.fillRect(200 + i * 560, back - 220, 30, 340); ctx.fillRect(200 + i * 560, back - 220, 560, 26); } blob(ctx, 1900, back + 120, 260, 70, [200, 170, 90], 0.9, 0.3); torch(ctx, 1150, 420, out); },
  cave(ctx, R, back, s, out) { ctx.fillStyle = '#0a0806'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(PW, 0); ctx.lineTo(PW, PH); ctx.quadraticCurveTo(1800, 600, 1200, 520); ctx.quadraticCurveTo(600, 600, 0, PH); ctx.fill(); fire(ctx, 1200, back + 80, 0.9, out); },
};

function torch(ctx, x, y, out) {
  ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x - 6, y, 12, 80);
  blob(ctx, x, y - 10, 70, 70, [255, 160, 60], 0.8, 0.4);
  ctx.fillStyle = '#ffd080'; ctx.beginPath(); ctx.ellipse(x, y - 14, 10, 22, 0, 0, 7); ctx.fill();
  out.lights.push({ x, y: y - 14, r: 420, color: [255, 150, 60], power: 0.85, flicker: true });
}

export { INTERIOR, shade };
