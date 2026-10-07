/** Small painting helpers shared by the sets, the figures and the film. */

export function rng(seed) {
  let s = (typeof seed === 'string' ? [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) : seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function rgb([r, g, b], a = 1) { return a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
export function mix(a, b, t) { const A = typeof a === 'string' ? hex(a) : a, B = typeof b === 'string' ? hex(b) : b; return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]; }
export function shade(c, k) { const A = typeof c === 'string' ? hex(c) : c; return k < 0 ? mix(A, [0, 0, 0], -k) : mix(A, [255, 255, 255], k); }
export function css(c, k = 0, a = 1) { return rgb(k ? shade(c, k) : typeof c === 'string' ? hex(c) : c, a); }

/** A linear gradient from stops [[t, color], ...]. */
export function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}
export function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** A soft blob (cloud, foliage, haze): colour as hex or [r,g,b], peak alpha a. */
export function blob(ctx, x, y, rx, ry, c, a = 1, soft = 0.6) {
  const C = typeof c === 'string' ? hex(c) : c;
  ctx.save();
  ctx.translate(x, y); ctx.scale(1, ry / rx);
  ctx.fillStyle = radial(ctx, 0, 0, rx * (1 - soft), rx, [[0, rgb(C, a)], [1, rgb(C, 0)]]);
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** A tile of value noise, used for grain and painterly texture. */
export function noiseCanvas(size = 256, seed = 1, alpha = 1) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const x = c.getContext('2d');
  const img = x.createImageData(size, size), R = rng(seed);
  for (let i = 0; i < size * size; i++) { const v = 110 + R() * 145; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255 * alpha; }
  x.putImageData(img, 0, 0);
  return c;
}

export function canvas(w, h) {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** Paint strokes of texture over an area (brushy walls, ground, foliage). */
export function strokes(ctx, x, y, w, h, color, n, R, len = 30, width = 3, alpha = 0.12, angle = 0) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const px = x + R() * w, py = y + R() * h, a = angle + (R() - 0.5) * 0.5, l = len * (0.5 + R());
    ctx.strokeStyle = css(color, (R() - 0.5) * 0.35, alpha * (0.5 + R()));
    ctx.lineWidth = width * (0.5 + R());
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); ctx.stroke();
  }
  ctx.restore();
}
