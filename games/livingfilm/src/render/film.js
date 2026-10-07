/**
 * The projector. Holds the painted set of the current scene and the people
 * in it, and for each beat frames a shot (establishing, wide, medium,
 * two-shot, over the shoulder, close on a face, an insert on a detail),
 * moves the camera through it (push in, pull out, pan, tilt, drift), and
 * composes the frame: the set (soft behind a close face), the dark of the
 * hour, the glow and flicker of fire and windows, the people lit from the
 * side the light comes from, weather, dust and embers, grain, vignette and
 * the black bars of a widescreen film.
 */
import { paintSet, PW, PH, FLOOR } from './sets.js';
import { drawFigure, drawPortrait, drawBackShoulder } from './figures.js';
import { rng, rgb, radial, noiseCanvas, canvas } from './paint.js';

export const ASPECT = 2.39;
const FIG_H = 420;
const ease = (u) => u * u * (3 - 2 * u);

export class Film {
  constructor(el) {
    this.el = el;
    this.ctx = el.getContext('2d');
    this.layer = canvas(16, 16);
    this.grain = noiseCanvas(256, 7);
    this.cast = {};
    this.player = null;
    this.set = null;
    this.setKey = '';
    this.scene = null;
    this.places = new Map();     // who stands where in this scene
    this.shot = null;
    this.t = 0;
    this.fade = 1;               // black: 1 → clear: 0
    this.fadeTo = 0;
    this.speaking = null;
    this.blinks = {};
    this.particles = [];
    this.uiBottom = 0;           // px reserved under the frame for the controls
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr;
    this.el.width = Math.round(innerWidth * dpr); this.el.height = Math.round(innerHeight * dpr);
    this.layer = canvas(this.el.width, this.el.height);
  }

  /** The frame rectangle on screen (device px): as wide as fits, 2.39:1, above the controls. */
  frameRect() {
    const W = this.el.width, H = this.el.height - this.uiBottom * this.dpr;
    let w = W, h = w / ASPECT;
    if (h > H * 0.92) { h = H * 0.92; w = h * ASPECT; }
    return { x: (W - w) / 2, y: Math.max(0, (H - h) / 2), w, h };
  }

  setCast(cast, player) { this.cast = cast; this.player = player; }

  /** A new scene (or the same one, with new people in it). */
  setScene(scene) {
    const key = `${scene.place}|${scene.name}|${scene.time}|${scene.weather}|${scene.light}`;
    if (key !== this.setKey) {
      this.set = paintSet(scene); this.setKey = key; this.places.clear();
      const R = rng(key);
      this.particles = Array.from({ length: 160 }, () => ({ x: R(), y: R(), z: 0.3 + R() * 0.7, s: R() }));
    }
    this.scene = scene;
    // place the people: keep where they stood, newcomers to free spots
    const used = new Set([...this.places.values()].map((p) => p.slot));
    for (const id of scene.present) {
      if (this.places.has(id)) continue;
      let i = 0; while (used.has(i) && i < this.set.slots.length - 1) i++;
      used.add(i);
      const sl = this.set.slots[i];
      this.places.set(id, { x: sl.x, y: sl.y, slot: i });
    }
    for (const id of [...this.places.keys()]) if (!scene.present.includes(id)) this.places.delete(id);
  }

  /** Where someone stands (the player stands front left, seen from behind). */
  posOf(id) {
    if (id === 'you') return { x: PW * 0.28, y: FLOOR + 110 };
    return this.places.get(id) ?? { x: PW / 2, y: FLOOR };
  }

  /** Frame a beat. dur: how long it will hold, seconds. */
  showBeat(beat, dur = 5) {
    const on = beat.on.length ? beat.on : this.scene?.present.slice(0, 2) ?? [];
    const subj = beat.who ?? on[0] ?? null;
    const P = subj ? this.posOf(subj) : { x: PW / 2, y: FLOOR };
    let w, cx, cy;
    const horizonY = this.set?.interior ? 560 : 620;
    switch (beat.shot) {
      case 'establishing': w = PW * 0.95; cx = PW / 2; cy = horizonY; break;
      case 'wide': { const xs = on.map((i) => this.posOf(i).x); const m = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : PW / 2; w = 1500; cx = m; cy = FLOOR - 250; break; }
      case 'two-shot': { const xs = on.slice(0, 2).map((i) => this.posOf(i).x); const m = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : P.x; w = Math.max(900, Math.abs((xs[1] ?? m) - (xs[0] ?? m)) + 700); cx = m; cy = FLOOR - 300; break; }
      case 'insert': { const L = this.set?.lights.filter((l) => !l.sky) ?? []; const l = L[Math.floor(Math.random() * L.length)] ?? { x: P.x, y: FLOOR - 200 }; w = 420; cx = l.x; cy = l.y + 40; break; }
      case 'close': case 'over-shoulder': case 'medium': default: {
        const scale = 1 + (P.y - FLOOR) / 600;
        w = (beat.shot === 'medium' ? 640 : 520) * scale; cx = P.x + (P.x < PW / 2 ? 0.12 : -0.12) * w; cy = P.y - FIG_H * scale * 0.8;
      }
    }
    const h = w / ASPECT;
    cx = Math.max(w / 2, Math.min(PW - w / 2, cx)); cy = Math.max(h / 2, Math.min(PH - h / 2, cy));
    const k = { 'push-in': [1.1, 0.94], 'pull-out': [0.94, 1.1] }[beat.move] ?? [1, 1];
    const dx = beat.move === 'pan-left' ? 0.06 * w : beat.move === 'pan-right' ? -0.06 * w : beat.move === 'drift' ? 0.02 * w : 0;
    const dy = beat.move === 'tilt-up' ? 0.08 * h : 0;
    this.shot = { beat, subj, w, cx, cy, from: { w: w * k[0], x: cx + dx, y: cy + dy }, to: { w: w * k[1], x: cx - dx, y: cy - dy }, t0: this.t, dur: Math.max(2, dur) };
  }

  fadeOut() { this.fadeTo = 1; }
  fadeIn() { this.fadeTo = 0; }

  /** The light falling on someone at x: from the nearest lamp or window, else the sky. */
  lightAt(x, y) {
    const S = this.set;
    let best = null, bd = 1e9;
    for (const l of S.lights) { const d = Math.hypot(l.x - x, (l.y - y) * 0.6) / (l.power + 0.2); if (d < bd) { bd = d; best = l; } }
    return { color: best?.color ?? S.tint, side: best ? (best.x < x ? 1 : -1) : 1, dark: S.dark };
  }

  frame(dt) {
    this.t += dt;
    this.fade += (this.fadeTo - this.fade) * Math.min(1, dt * 3);
    const ctx = this.ctx, W = this.el.width, H = this.el.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const F = this.frameRect();
    if (!this.set || !this.shot) { this._bars(F); return; }
    const sh = this.shot, u = ease(Math.min(1, (this.t - sh.t0) / sh.dur));
    const cw = sh.from.w + (sh.to.w - sh.from.w) * u, cxx = sh.from.x + (sh.to.x - sh.from.x) * u, cyy = sh.from.y + (sh.to.y - sh.from.y) * u;
    const ch = cw / ASPECT, sx = cxx - cw / 2, sy = cyy - ch / 2;
    const scale = F.w / cw;
    const toScreen = (x, y) => [F.x + (x - sx) * scale, F.y + (y - sy) * scale];
    ctx.save();
    ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
    const close = sh.beat.shot === 'close' || sh.beat.shot === 'over-shoulder';
    // the set, soft behind a near subject
    const blur = close ? 9 : sh.beat.shot === 'medium' ? 3 : sh.beat.shot === 'insert' ? 5 : 0;
    if (blur) ctx.filter = `blur(${blur * this.dpr}px)`;
    ctx.drawImage(this.set.plate, sx, sy, cw, ch, F.x, F.y, F.w, F.h);
    ctx.filter = 'none';
    // the dark of the hour, then the lights glowing through it
    if (this.set.dark > 0) { ctx.fillStyle = `rgba(8,10,22,${this.set.dark})`; ctx.fillRect(F.x, F.y, F.w, F.h); }
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.set.lights) {
      const fl = l.flicker ? 0.85 + 0.15 * Math.sin(this.t * 9 + l.x) * Math.sin(this.t * 13.7 + l.y) : 1;
      const [lx, ly] = toScreen(l.x, l.y), r = l.r * scale * fl;
      if (lx < F.x - r || lx > F.x + F.w + r) continue;
      ctx.fillStyle = radial(ctx, lx, ly, 0, r, [[0, rgb(l.color, 0.35 * l.power * (0.4 + this.set.dark))], [1, rgb(l.color, 0)]]);
      ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // the people
    if (close) this._close(ctx, F, sh, sx, sy, scale);
    else if (sh.beat.shot !== 'insert') this._people(ctx, F, toScreen, scale, sh);
    this._weather(ctx, F, dt);
    // vignette and grain
    ctx.fillStyle = radial(ctx, F.x + F.w / 2, F.y + F.h / 2, F.h * 0.45, F.w * 0.62, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.55)']]);
    ctx.fillRect(F.x, F.y, F.w, F.h);
    ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
    const ox = Math.random() * 256, oy = Math.random() * 256;
    ctx.fillStyle = ctx.createPattern(this.grain, 'repeat'); ctx.translate(-ox, -oy); ctx.fillRect(F.x + ox, F.y + oy, F.w, F.h); ctx.translate(ox, oy);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (this.fade > 0.005) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(F.x, F.y, F.w, F.h); }
    ctx.restore();
    this._bars(F);
  }

  _bars(F) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.el.width, F.y); ctx.fillRect(0, F.y + F.h, this.el.width, this.el.height - F.y - F.h);
  }

  _talk(id) { return this.speaking === id ? 0.35 + 0.65 * Math.abs(Math.sin(this.t * 13 + Math.sin(this.t * 5.3) * 2)) : 0; }
  _blink(id) { const b = (this.blinks[id] ??= { next: this.t + 1 + Math.random() * 4 }); if (this.t > b.next + 0.14) b.next = this.t + 2 + Math.random() * 4.5; return this.t > b.next && this.t < b.next + 0.14; }

  _person(id) { return id === 'you' ? this.player && { ...this.player, id: 'you', age: 25, seed: 3 } : this.cast[id] && { ...this.cast[id], seed: id.length * 7 }; }

  _people(ctx, F, toScreen, scale, sh) {
    const L = this.layer, lx = L.getContext('2d');
    const ids = [...this.places.keys()];
    if (['wide', 'establishing', 'two-shot'].includes(sh.beat.shot)) ids.push('you');
    ids.sort((a, b) => this.posOf(a).y - this.posOf(b).y);
    for (const id of ids) {
      const p = this._person(id); if (!p) continue;
      const pos = this.posOf(id), s = 1 + (pos.y - FLOOR) / 600;
      const [x, y] = toScreen(pos.x, pos.y), Hs = FIG_H * s * scale;
      if (x < F.x - Hs || x > F.x + F.w + Hs) continue;
      lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, L.width, L.height);
      const em = sh.beat.who === id ? sh.beat.emotion : 'neutral';
      drawFigure(lx, p, x, y, Hs, { emotion: em, talk: this._talk(id), t: this.t, back: id === 'you', facing: pos.x < PW / 2 ? 1 : -1, blink: this._blink(id), light: this.lightAt(pos.x, pos.y) });
      ctx.drawImage(L, 0, 0);
    }
  }

  _close(ctx, F, sh, sx, sy, scale) {
    const id = sh.subj ?? sh.beat.on[0];
    const p = id && this._person(id);
    const L = this.layer, lx = L.getContext('2d');
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.clearRect(0, 0, L.width, L.height);
    if (p && id !== 'you') {
      const pos = this.posOf(id), left = pos.x < PW / 2;
      const size = F.h * (sh.beat.shot === 'over-shoulder' ? 0.36 : 0.44);
      const cx = F.x + F.w * (left ? 0.36 : 0.64), cy = F.y + F.h * 0.4;
      drawPortrait(lx, p, cx, cy, size, { emotion: sh.beat.emotion, talk: this._talk(id), blink: this._blink(id), t: this.t, light: this.lightAt(pos.x, pos.y), look: left ? 0.5 : -0.5 });
      ctx.drawImage(L, 0, 0);
      if (sh.beat.shot === 'over-shoulder' && this.player) {
        // your shoulder in the near foreground, out of focus
        lx.clearRect(0, 0, L.width, L.height);
        drawBackShoulder(lx, this._person('you'), F.x + F.w * (left ? 0.88 : 0.12), F.y + F.h * 0.7, F.h * 0.62);
        ctx.filter = `blur(${7 * this.dpr}px)`; ctx.globalAlpha = 0.95; ctx.drawImage(L, 0, 0); ctx.filter = 'none'; ctx.globalAlpha = 1;
      }
    } else if (p) {
      // a close shot on yourself: your hands, your breath; show the scene soft
      void sx; void sy; void scale;
    }
  }

  _weather(ctx, F, dt) {
    const sc = this.scene, w = sc?.weather, S = this.set;
    if (!S) return;
    const out = !S.interior;
    ctx.save();
    for (const q of this.particles) {
      if (out && (w === 'rain' || w === 'storm')) {
        q.y += dt * (1.6 + q.z) * (w === 'storm' ? 1.5 : 1); q.x += dt * (w === 'storm' ? 0.25 : 0.06);
        if (q.y > 1) { q.y -= 1; q.x = Math.random(); }
        ctx.strokeStyle = `rgba(200,210,230,${0.15 + q.z * 0.25})`; ctx.lineWidth = q.z * 1.5 * this.dpr;
        const x = F.x + (q.x % 1) * F.w, y = F.y + q.y * F.h;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (w === 'storm' ? 14 : 4) * this.dpr, y - 26 * q.z * this.dpr); ctx.stroke();
      } else if (out && w === 'snow') {
        q.y += dt * 0.05 * (0.5 + q.z); q.x += Math.sin(this.t + q.s * 9) * dt * 0.01;
        if (q.y > 1) q.y -= 1;
        ctx.fillStyle = `rgba(250,250,255,${0.5 + q.z * 0.4})`; ctx.beginPath(); ctx.arc(F.x + (((q.x % 1) + 1) % 1) * F.w, F.y + q.y * F.h, (1 + q.z * 2.5) * this.dpr, 0, 7); ctx.fill();
      } else if (S.lights.some((l) => l.flicker) && q.s < 0.25) {
        // embers rising from the fire, or dust in the window light
        q.y -= dt * 0.03 * (0.5 + q.z); q.x += Math.sin(this.t * 0.7 + q.s * 20) * dt * 0.004;
        if (q.y < 0) q.y += 1;
        const ember = sc.light === 'firelight' || sc.light === 'torchlight';
        ctx.fillStyle = ember ? `rgba(255,${140 + q.z * 80},60,${0.25 + 0.5 * Math.abs(Math.sin(this.t * 3 + q.s * 40))})` : `rgba(255,240,200,${0.15 + q.z * 0.2})`;
        ctx.beginPath(); ctx.arc(F.x + q.x * F.w, F.y + q.y * F.h, (ember ? 1.4 : 1) * this.dpr, 0, 7); ctx.fill();
      } else if (out && (w === 'wind' || w === 'clear') && q.s < 0.12) {
        q.x += dt * 0.04 * (w === 'wind' ? 3 : 0.4); if (q.x > 1) q.x -= 1;
        ctx.fillStyle = `rgba(255,250,230,${0.1 + q.z * 0.15})`; ctx.beginPath(); ctx.arc(F.x + q.x * F.w, F.y + (q.y + 0.02 * Math.sin(this.t + q.s * 30)) * F.h, this.dpr, 0, 7); ctx.fill();
      }
    }
    if (w === 'fog' || (w === 'storm' && Math.sin(this.t * 0.9) > 0.995)) { ctx.fillStyle = w === 'storm' ? 'rgba(230,235,255,0.5)' : 'rgba(200,205,212,0.18)'; ctx.fillRect(F.x, F.y, F.w, F.h); }
    ctx.restore();
  }
}
