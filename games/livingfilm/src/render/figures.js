/**
 * People, painted: full figures for wide and medium shots, and faces for
 * close-ups. Looks come from the director (skin, hair and its style, beard,
 * clothes, build, age); expressions from each beat's emotion; mouths move
 * while a line is spoken, eyes blink, and the light of the scene falls on
 * them from the side it comes from.
 */
import { hex, rgb, mix, shade, css, grad, radial, blob } from './paint.js';

/** Brows, eyes, mouth and tilt for each emotion. browIn: inner end of the brow (+ up); curve: mouth (+ smile). */
const FACE = {
  neutral: { browIn: 0, browY: 0, eye: 1, curve: 0.05, open: 0, tilt: 0 },
  warm: { browIn: 0.15, browY: 0.05, eye: 0.85, curve: 0.55, open: 0.1, tilt: 0.05 },
  amused: { browIn: 0.1, browY: 0.1, eye: 0.7, curve: 0.75, open: 0.25, tilt: 0.08 },
  tender: { browIn: 0.35, browY: 0.05, eye: 0.75, curve: 0.35, open: 0, tilt: 0.1 },
  sad: { browIn: 0.6, browY: 0, eye: 0.7, curve: -0.45, open: 0, tilt: -0.06 },
  angry: { browIn: -0.7, browY: -0.1, eye: 0.8, curve: -0.4, open: 0.15, tilt: 0 },
  afraid: { browIn: 0.7, browY: 0.25, eye: 1.35, curve: -0.25, open: 0.3, tilt: -0.04 },
  surprised: { browIn: 0.3, browY: 0.4, eye: 1.4, curve: 0, open: 0.55, tilt: 0 },
  suspicious: { browIn: -0.4, browY: -0.05, eye: 0.55, curve: -0.1, open: 0, tilt: 0.12 },
  proud: { browIn: -0.1, browY: 0.1, eye: 0.8, curve: 0.2, open: 0, tilt: -0.1 },
  tired: { browIn: 0.25, browY: -0.05, eye: 0.5, curve: -0.15, open: 0, tilt: 0.06 },
};

const greyed = (hair, age) => (age > 45 ? rgb(mix(hair, '#a8a49a', Math.min(0.9, (age - 45) / 25))) : hair);

/**
 * The light on someone: their shadow side falls dark, and the colour of the
 * light tints them. Drawn 'source-atop', so it touches only the person:
 * the film paints each person on their own layer.
 */
function lit(ctx, x, y, w, h, light) {
  if (!light) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const shadow = 0.25 + light.dark * 0.55;
  const g = ctx.createLinearGradient(x - w * 0.5 * light.side, 0, x + w * 0.5 * light.side, 0);
  g.addColorStop(0, 'rgba(10,12,20,0)'); g.addColorStop(1, `rgba(10,12,20,${shadow})`);
  ctx.fillStyle = g; ctx.fillRect(x - w, y - h, w * 2, h * 2);
  ctx.fillStyle = rgb(light.color, 0.16 + light.dark * 0.12); ctx.fillRect(x - w, y - h, w * 2, h * 2);
  ctx.restore();
}

/**
 * A whole person standing at (x, y) (their feet), H stage units tall.
 * o: { emotion, talk (0..1), t, back (seen from behind), facing (-1 left, 1 right), light }
 */
export function drawFigure(ctx, p, x, y, H, o = {}) {
  const L = p.look, f = p.sex === 'f', face = FACE[o.emotion] ?? FACE.neutral;
  const bw = H * (L.build === 'broad' ? 0.3 : L.build === 'stout' ? 0.32 : 0.25) * (f ? 0.92 : 1);
  const t = o.t ?? 0, sway = Math.sin(t * 1.3 + (p.seed ?? 0)) * H * 0.004, breath = Math.sin(t * 1.8 + (p.seed ?? 0)) * H * 0.003;
  const cloth = L.clothes, dark = css(cloth, -0.35);
  ctx.save();
  ctx.translate(x + sway, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, bw * 0.9, H * 0.025, 0, 0, 7); ctx.fill();
  const hip = -H * 0.48, sh = -H * 0.8 + breath, head = -H * 0.9;
  // legs or skirt
  if (f) {
    ctx.fillStyle = grad(ctx, -bw, 0, bw, 0, [[0, css(cloth, -0.25)], [0.5, css(cloth)], [1, css(cloth, -0.4)]]);
    ctx.beginPath(); ctx.moveTo(-bw * 0.42, sh + H * 0.08); ctx.lineTo(bw * 0.42, sh + H * 0.08); ctx.lineTo(bw * 0.75, -H * 0.01); ctx.lineTo(-bw * 0.75, -H * 0.01); ctx.fill();
  } else {
    ctx.fillStyle = css(mix(cloth, '#2a2420', 0.5)); ctx.fillRect(-bw * 0.32, hip, bw * 0.26, -hip - H * 0.03); ctx.fillRect(bw * 0.06, hip, bw * 0.26, -hip - H * 0.03);
    ctx.fillStyle = '#1e140c'; ctx.fillRect(-bw * 0.36, -H * 0.035, bw * 0.32, H * 0.035); ctx.fillRect(bw * 0.04, -H * 0.035, bw * 0.32, H * 0.035);
    ctx.fillStyle = grad(ctx, -bw, 0, bw, 0, [[0, css(cloth, -0.25)], [0.5, css(cloth)], [1, css(cloth, -0.4)]]);
    ctx.beginPath(); ctx.moveTo(-bw * 0.45, sh + H * 0.05); ctx.lineTo(bw * 0.45, sh + H * 0.05); ctx.lineTo(bw * 0.55, hip + H * 0.16); ctx.lineTo(-bw * 0.55, hip + H * 0.16); ctx.fill();
  }
  // shoulders and chest
  ctx.fillStyle = css(cloth);
  ctx.beginPath(); ctx.ellipse(0, sh + H * 0.05, bw * 0.5, H * 0.06, 0, Math.PI, 0); ctx.fill();
  // belt
  ctx.fillStyle = css(L.accent, -0.3); ctx.fillRect(-bw * 0.45, hip - H * 0.02, bw * 0.9, H * 0.025);
  // arms: one lifts a little when speaking with feeling
  const gesture = (o.talk ?? 0) > 0 && !o.back && ['angry', 'amused', 'warm', 'surprised', 'proud'].includes(o.emotion) ? 0.5 + 0.3 * Math.sin(t * 2.2) : 0;
  for (const s of [-1, 1]) {
    ctx.save(); ctx.translate(s * bw * 0.47, sh + H * 0.03);
    ctx.rotate(s * 0.08 + (s === (o.facing ?? 1) ? -s * gesture : 0));
    ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-bw * 0.09, 0); ctx.lineTo(bw * 0.09, 0); ctx.lineTo(bw * 0.07, H * 0.33); ctx.lineTo(-bw * 0.07, H * 0.33); ctx.fill();
    ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(0, H * 0.35, bw * 0.08, 0, 7); ctx.fill();
    ctx.restore();
  }
  // neck and head
  ctx.fillStyle = css(L.skin, -0.15); ctx.fillRect(-bw * 0.08, sh - H * 0.03, bw * 0.16, H * 0.05);
  const hr = H * 0.065, tilt = face.tilt * 0.5;
  ctx.save(); ctx.translate(0, head); ctx.rotate(tilt * (o.facing ?? 1));
  hairBack(ctx, L, hr, p.age, f);
  ctx.fillStyle = L.skin; ctx.beginPath(); ctx.ellipse(0, 0, hr * 0.82, hr, 0, 0, 7); ctx.fill();
  if (!o.back) {
    const fx = (o.facing ?? 0) * hr * 0.18;
    ctx.fillStyle = '#1a120c';
    const eo = Math.max(0.15, face.eye) * (o.blink ? 0.1 : 1);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(fx + s * hr * 0.3, -hr * 0.05, hr * 0.08, hr * 0.06 * eo, 0, 0, 7); ctx.fill(); }
    ctx.strokeStyle = css(L.hair, -0.3); ctx.lineWidth = Math.max(1, hr * 0.06);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(fx + s * hr * 0.15, -hr * (0.22 + face.browY * 0.2) - face.browIn * hr * 0.08); ctx.lineTo(fx + s * hr * 0.45, -hr * (0.25 + face.browY * 0.2)); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(80,30,20,0.85)'; ctx.lineWidth = Math.max(1, hr * 0.05);
    const mo = (o.talk ?? 0) * hr * 0.12 + face.open * hr * 0.06;
    ctx.beginPath(); ctx.moveTo(fx - hr * 0.2, hr * 0.45 - face.curve * hr * 0.06); ctx.quadraticCurveTo(fx, hr * 0.45 + face.curve * hr * 0.12 + mo, fx + hr * 0.2, hr * 0.45 - face.curve * hr * 0.06); ctx.stroke();
    if (mo > hr * 0.03) { ctx.fillStyle = '#3a1410'; ctx.beginPath(); ctx.ellipse(fx, hr * 0.47, hr * 0.12, mo * 0.5, 0, 0, 7); ctx.fill(); }
  }
  if (p.look.beard > 0.2 && !f) { ctx.fillStyle = greyed(L.hair, p.age); ctx.globalAlpha = Math.min(1, p.look.beard + 0.2); ctx.beginPath(); ctx.ellipse(0, hr * 0.55, hr * 0.62, hr * 0.5 * p.look.beard, 0, 0, Math.PI); ctx.fill(); ctx.globalAlpha = 1; }
  hairFront(ctx, L, hr, p.age, f, o.back);
  ctx.restore();
  lit(ctx, 0, -H * 0.5, H * 0.35, H * 0.55, o.light);
  ctx.restore();
}

function hairBack(ctx, L, r, age, f) {
  const c = greyed(L.hair, age);
  ctx.fillStyle = c;
  if (L.hairStyle === 'long' || L.hairStyle === 'braid' || L.hairStyle === 'curly') { ctx.beginPath(); ctx.ellipse(0, r * 0.5, r * 1.0, r * 1.5, 0, 0, 7); ctx.fill(); }
  if (L.hairStyle === 'veil') {
    // a linen veil falling behind to the shoulders, shaded in its folds
    ctx.fillStyle = grad(ctx, -r * 1.2, 0, r * 1.2, 0, [[0, '#a8a090'], [0.35, '#e4dccb'], [0.7, '#d4ccba'], [1, '#9a9282']]);
    ctx.beginPath(); ctx.moveTo(-r * 1.0, -r * 0.6); ctx.quadraticCurveTo(-r * 1.25, r * 0.8, -r * 1.35, r * 1.45); ctx.lineTo(r * 1.35, r * 1.45); ctx.quadraticCurveTo(r * 1.25, r * 0.8, r * 1.0, -r * 0.6); ctx.quadraticCurveTo(0, -r * 1.35, -r * 1.0, -r * 0.6); ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,64,0.35)'; ctx.lineWidth = r * 0.03;
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(s * r * (0.95 + k * 0.08), r * 0.1); ctx.quadraticCurveTo(s * r * (1.1 + k * 0.06), r * 0.8, s * r * (1.15 + k * 0.06), r * 1.4); ctx.stroke(); }
  }
  if (L.hairStyle === 'hood') { ctx.fillStyle = css(L.clothes, -0.15); ctx.beginPath(); ctx.ellipse(0, r * 0.2, r * 1.25, r * 1.4, 0, 0, 7); ctx.fill(); }
  void f;
}

function hairFront(ctx, L, r, age, f, back) {
  const c = greyed(L.hair, age);
  const st = L.hairStyle;
  if (back) {
    ctx.fillStyle = st === 'veil' ? '#ece6d6' : st === 'hood' ? css(L.clothes, -0.1) : c;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.88, r * 1.05, 0, 0, 7); ctx.fill();
    return;
  }
  if (st === 'bald') return;
  if (st === 'veil') {
    // the veil over the brow, and the wimple wrapped under the chin and round the throat
    ctx.fillStyle = grad(ctx, 0, -r, 0, -r * 0.3, [[0, '#f0e9d8'], [1, '#d8d0be']]);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 0.98, r * 0.62, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = grad(ctx, 0, r * 0.4, 0, r * 1.3, [[0, '#d6cebc'], [1, '#b8b0a0']]);
    ctx.beginPath(); ctx.moveTo(-r * 0.86, -r * 0.3); ctx.quadraticCurveTo(-r * 0.92, r * 0.75, -r * 0.55, r * 1.25); ctx.lineTo(r * 0.55, r * 1.25); ctx.quadraticCurveTo(r * 0.92, r * 0.75, r * 0.86, -r * 0.3); ctx.lineTo(r * 0.74, -r * 0.3); ctx.quadraticCurveTo(r * 0.78, r * 0.55, r * 0.35, r * 0.88); ctx.quadraticCurveTo(0, r * 1.08, -r * 0.35, r * 0.88); ctx.quadraticCurveTo(-r * 0.78, r * 0.55, -r * 0.74, -r * 0.3); ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,64,0.3)'; ctx.lineWidth = r * 0.025;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-r * 0.5, r * (1.0 + k * 0.08)); ctx.quadraticCurveTo(0, r * (1.15 + k * 0.08), r * 0.5, r * (1.0 + k * 0.08)); ctx.stroke(); }
    return;
  }
  if (st === 'hood') { ctx.strokeStyle = css(L.clothes, -0.1); ctx.lineWidth = r * 0.3; ctx.beginPath(); ctx.ellipse(0, r * 0.05, r * 0.98, r * 1.15, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke(); return; }
  ctx.fillStyle = c;
  ctx.beginPath(); ctx.ellipse(0, -r * 0.55, r * 0.88, r * 0.52, 0, Math.PI, 0); ctx.fill();
  if (st === 'cap') { ctx.fillStyle = css(L.accent, -0.2); ctx.beginPath(); ctx.ellipse(0, -r * 0.6, r * 0.92, r * 0.5, 0, Math.PI, 0); ctx.fill(); }
  if (st === 'hat') { ctx.fillStyle = css(L.clothes, -0.45); ctx.beginPath(); ctx.ellipse(0, -r * 0.62, r * 1.5, r * 0.22, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -r * 0.8, r * 0.75, r * 0.5, 0, Math.PI, 0); ctx.fill(); }
  if (st === 'curly') for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(-r * 0.7 + i * r * 0.23, -r * 0.75, r * 0.2, 0, 7); ctx.fill(); }
  void f; void age;
}

/**
 * A close-up: head and shoulders, the face `size` tall, centred at (cx, cy).
 * o: { emotion, talk 0..1, blink, t, light: {color, side, dark}, look: -1..1 (gaze) }
 */
export function drawPortrait(ctx, p, cx, cy, size, o = {}) {
  const L = p.look, f = p.sex === 'f', E = FACE[o.emotion] ?? FACE.neutral;
  const r = size / 2, t = o.t ?? 0, seed = p.seed ?? 0;
  const age = p.age ?? 35, skin = hex(L.skin);
  ctx.save();
  ctx.translate(cx + Math.sin(t * 0.7 + seed) * r * 0.01, cy + Math.sin(t * 1.6 + seed) * r * 0.008);
  ctx.rotate(E.tilt * 0.35 + Math.sin(t * 0.5 + seed) * 0.008);
  // shoulders and clothes
  const sw = r * (L.build === 'broad' ? 2.5 : 2.2) * (f ? 0.9 : 1);
  ctx.fillStyle = grad(ctx, -sw, 0, sw, 0, [[0, css(L.clothes, -0.35)], [0.45, css(L.clothes, 0.05)], [1, css(L.clothes, -0.45)]]);
  ctx.beginPath(); ctx.moveTo(-sw, r * 3.2); ctx.quadraticCurveTo(-sw * 0.95, r * 1.25, -r * 0.55, r * 1.05); ctx.lineTo(r * 0.55, r * 1.05); ctx.quadraticCurveTo(sw * 0.95, r * 1.25, sw, r * 3.2); ctx.fill();
  ctx.strokeStyle = css(L.accent, -0.1, 0.8); ctx.lineWidth = r * 0.06; ctx.beginPath(); ctx.moveTo(-r * 0.6, r * 1.1); ctx.quadraticCurveTo(0, r * 1.55, r * 0.6, r * 1.1); ctx.stroke();
  // neck
  ctx.fillStyle = grad(ctx, -r * 0.4, 0, r * 0.4, 0, [[0, rgb(shade(skin, -0.35))], [1, rgb(shade(skin, -0.15))]]);
  ctx.fillRect(-r * 0.38, r * 0.6, r * 0.76, r * 0.6);
  hairBack(ctx, L, r, age, f);
  // ears
  ctx.fillStyle = rgb(shade(skin, -0.08));
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * 0.8, r * 0.02, r * 0.12, r * 0.2, 0, 0, 7); ctx.fill(); }
  // the face: a jaw that narrows to the chin
  ctx.fillStyle = grad(ctx, -r, -r, r, r, [[0, rgb(shade(skin, 0.06))], [1, rgb(shade(skin, -0.12))]]);
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, -r * 0.2);
  ctx.bezierCurveTo(-r * 0.86, -r * 1.2, r * 0.86, -r * 1.2, r * 0.8, -r * 0.2);
  ctx.bezierCurveTo(r * 0.78, r * 0.45, r * 0.45, r * (f ? 0.95 : 1.0), 0, r * (f ? 1.0 : 1.06));
  ctx.bezierCurveTo(-r * 0.45, r * (f ? 0.95 : 1.0), -r * 0.78, r * 0.45, -r * 0.8, -r * 0.2);
  ctx.fill();
  // cheeks and a little warmth
  for (const s of [-1, 1]) blob(ctx, s * r * 0.45, r * 0.3, r * 0.28, r * 0.2, [200, 90, 80], f ? 0.22 : 0.14);
  // eyes
  const gaze = (o.look ?? 0) * r * 0.05, open = Math.max(0.12, E.eye) * (o.blink ? 0.08 : 1);
  for (const s of [-1, 1]) {
    const ex = s * r * 0.34, ey = -r * 0.12;
    ctx.fillStyle = rgb(shade(skin, -0.2)); ctx.beginPath(); ctx.ellipse(ex, ey - r * 0.03, r * 0.2, r * 0.13, 0, 0, 7); ctx.fill();   // socket shadow
    ctx.save(); ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.16, r * 0.085 * open, 0, 0, 7); ctx.clip();
    ctx.fillStyle = '#efe8dc'; ctx.fillRect(ex - r * 0.2, ey - r * 0.2, r * 0.4, r * 0.4);
    ctx.fillStyle = css(p.eye ?? '#4a3420'); ctx.beginPath(); ctx.arc(ex + gaze, ey, r * 0.075, 0, 7); ctx.fill();
    ctx.fillStyle = '#0a0806'; ctx.beginPath(); ctx.arc(ex + gaze, ey, r * 0.035, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(ex + gaze - r * 0.025, ey - r * 0.025, r * 0.016, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(ex - r * 0.2, ey - r * 0.12, r * 0.4, r * 0.05);   // the upper lid's shade
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,20,14,0.85)'; ctx.lineWidth = r * 0.022;
    ctx.beginPath(); ctx.ellipse(ex, ey, r * 0.16, r * 0.085 * open, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  }
  // brows
  ctx.strokeStyle = rgb(shade(hex(greyed(L.hair, age).startsWith('rgb') ? '#8a8478' : L.hair), -0.25)); ctx.lineCap = 'round';
  ctx.lineWidth = r * (f ? 0.045 : 0.07);
  for (const s of [-1, 1]) {
    const by = -r * (0.36 + E.browY * 0.12);
    ctx.beginPath(); ctx.moveTo(s * r * 0.14, by - E.browIn * r * 0.09); ctx.quadraticCurveTo(s * r * 0.33, by - r * 0.06 - E.browIn * r * 0.03, s * r * 0.52, by + r * 0.02); ctx.stroke();
  }
  // nose
  ctx.strokeStyle = rgb(shade(skin, -0.32)); ctx.lineWidth = r * 0.03;
  ctx.beginPath(); ctx.moveTo(-r * 0.04, -r * 0.08); ctx.quadraticCurveTo(-r * 0.1, r * 0.2, -r * 0.12, r * 0.3); ctx.quadraticCurveTo(0, r * 0.38, r * 0.12, r * 0.3); ctx.stroke();
  blob(ctx, 0, r * 0.32, r * 0.12, r * 0.06, shade(skin, -0.3), 0.5);
  // mouth: lips, opening as they speak
  const mo = (o.talk ?? 0) * r * 0.11 + E.open * r * 0.06, cv = E.curve * r * 0.09, my = r * 0.58;
  if (mo > r * 0.015) { ctx.fillStyle = '#2a0e0a'; ctx.beginPath(); ctx.moveTo(-r * 0.2, my - cv * 0.4); ctx.quadraticCurveTo(0, my + cv + mo * 1.3, r * 0.2, my - cv * 0.4); ctx.quadraticCurveTo(0, my - mo * 0.3, -r * 0.2, my - cv * 0.4); ctx.fill(); ctx.fillStyle = 'rgba(235,225,210,0.8)'; ctx.fillRect(-r * 0.1, my - mo * 0.25, r * 0.2, Math.min(mo * 0.35, r * 0.04)); }
  ctx.strokeStyle = rgb(mix(shade(skin, -0.35), [150, 60, 60], 0.45)); ctx.lineWidth = r * 0.035;
  ctx.beginPath(); ctx.moveTo(-r * 0.22, my - cv * 0.5); ctx.quadraticCurveTo(0, my + cv + mo * 0.15, r * 0.22, my - cv * 0.5); ctx.stroke();
  ctx.fillStyle = rgb(mix(skin, [170, 80, 80], 0.35)); ctx.beginPath(); ctx.ellipse(0, my + r * 0.07 + mo, r * 0.13, r * 0.035, 0, 0, Math.PI); ctx.fill();
  // age
  if (age > 40) { ctx.strokeStyle = `rgba(80,40,30,${Math.min(0.35, (age - 40) / 80)})`; ctx.lineWidth = r * 0.015; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * r * 0.53, -r * 0.05); ctx.lineTo(s * r * 0.62, -r * 0.0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(s * r * 0.18, r * 0.35); ctx.quadraticCurveTo(s * r * 0.3, r * 0.55, s * r * 0.26, r * 0.7); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(-r * 0.25, -r * 0.62); ctx.lineTo(r * 0.25, -r * 0.62); ctx.stroke(); }
  // beard
  if (!f && L.beard > 0.15) {
    ctx.fillStyle = greyed(L.hair, age); ctx.globalAlpha = Math.min(1, 0.4 + L.beard * 0.7);
    ctx.beginPath(); ctx.moveTo(-r * 0.78, r * 0.05); ctx.bezierCurveTo(-r * 0.7, r * (0.9 + L.beard * 0.6), r * 0.7, r * (0.9 + L.beard * 0.6), r * 0.78, r * 0.05); ctx.bezierCurveTo(r * 0.5, r * 0.5, r * 0.25, r * 0.48, 0, r * 0.47); ctx.bezierCurveTo(-r * 0.25, r * 0.48, -r * 0.5, r * 0.5, -r * 0.78, r * 0.05); ctx.fill();
    ctx.globalAlpha = 1;
  }
  hairFront(ctx, L, r, age, f, false);
  // the light of the scene
  lit(ctx, 0, r * 0.8, r * 2.6, r * 2.6, o.light);
  ctx.restore();
}

export { FACE };

/** The back of a head and a shoulder, near the camera: for over-the-shoulder shots. */
export function drawBackShoulder(ctx, p, cx, cy, size) {
  const L = p.look, r = size / 2;
  ctx.save(); ctx.translate(cx, cy);
  ctx.fillStyle = css(L.clothes, -0.55);
  ctx.beginPath(); ctx.moveTo(-r * 2.4, r * 3); ctx.quadraticCurveTo(-r * 2.2, r * 1.1, -r * 0.5, r * 0.95); ctx.lineTo(r * 0.5, r * 0.95); ctx.quadraticCurveTo(r * 2.2, r * 1.1, r * 2.4, r * 3); ctx.fill();
  ctx.fillStyle = css(L.skin, -0.55); ctx.fillRect(-r * 0.35, r * 0.5, r * 0.7, r * 0.6);
  const st = L.hairStyle;
  ctx.fillStyle = st === 'veil' ? css('#ece6d6', -0.45) : st === 'hood' ? css(L.clothes, -0.5) : st === 'bald' ? css(L.skin, -0.5) : css(L.hair, -0.4);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.85, r * 1.05, 0, 0, 7); ctx.fill();
  ctx.restore();
}
