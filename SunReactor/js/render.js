/*
 * HELIOS-1 canvas renderers: synthetic plasma camera (the star in its magnetic cage),
 * poloidal equilibrium, SCADA strip-chart trends and the Solhavn skyline.
 */
(function (root) {
  'use strict';
  const E = root.HeliosEngine;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mix = (a, b, t) => a + (b - a) * t;
  const mixRGB = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';

  function seeded(seed) {
    let t = seed >>> 0;
    return () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  }
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // ================================================================= CAMERA
  function Camera(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.W = canvas.width; this.H = canvas.height;
    this.fieldLines = true;
    this.view = 0;
    this.proms = [];
    this.lastElm = 0;
    this.lastFlash = 0;
    this.buildStatic();
  }
  Camera.prototype.buildStatic = function () {
    const W = this.W, H = this.H;
    // vessel interior: tungsten tiles on a curved wall
    const bg = makeCanvas(W, H), g = bg.getContext('2d');
    const grd = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.75);
    grd.addColorStop(0, '#1b1f22'); grd.addColorStop(1, '#040506');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,130,140,0.10)'; g.lineWidth = 1;
    for (let i = -14; i <= 14; i++) {
      g.beginPath();
      for (let y = 0; y <= H; y += 10) {
        const k = (y - H / 2) / (H / 2);
        const x = W / 2 + i * 38 * (1 + 0.35 * k * k);
        y === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let j = -9; j <= 9; j++) {
      g.beginPath();
      g.ellipse(W / 2, H / 2 + j * 34, W * 0.7, 40 + Math.abs(j) * 6, 0, 0, TAU);
      g.stroke();
    }
    // divertor cassettes glow faintly at top and bottom
    g.fillStyle = 'rgba(80,90,100,0.12)';
    g.fillRect(0, 0, W, 40); g.fillRect(0, H - 40, W, 40);
    this.bg = bg;

    // granulation texture (tileable), 512 px
    const N = 512, tex = makeCanvas(N, N), t = tex.getContext('2d');
    t.fillStyle = '#6b6b6b'; t.fillRect(0, 0, N, N);
    const r = seeded(7);
    for (let i = 0; i < 2600; i++) {
      const x = r() * N, y = r() * N, rad = 4 + r() * 9, b = 150 + r() * 105;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
        const px = x + ox, py = y + oy;
        if (px < -rad || px > N + rad || py < -rad || py > N + rad) continue;
        const gg = t.createRadialGradient(px, py, 0, px, py, rad);
        gg.addColorStop(0, 'rgba(' + b + ',' + b + ',' + b + ',0.9)');
        gg.addColorStop(0.7, 'rgba(' + (b * 0.7) + ',' + (b * 0.7) + ',' + (b * 0.7) + ',0.5)');
        gg.addColorStop(1, 'rgba(40,40,40,0)');
        t.fillStyle = gg; t.beginPath(); t.arc(px, py, rad, 0, TAU); t.fill();
      }
    }
    this.tex = tex;
    this.texPattern = this.g.createPattern(tex, 'repeat');

    // scanlines + vignette
    const sc = makeCanvas(W, H), s = sc.getContext('2d');
    s.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) s.fillRect(0, y, W, 1);
    const vg = s.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    s.fillStyle = vg; s.fillRect(0, 0, W, H);
    this.scan = sc;
  };

  // colour of the plasma as a function of temperature: cold hydrogen glows Balmer pink,
  // warm plasma orange, burning plasma the white-yellow of the solar photosphere
  function plasmaColours(T) {
    const pink = { core: [255, 170, 230], mid: [220, 80, 170], limb: [120, 30, 110], corona: [200, 90, 200] };
    const orange = { core: [255, 220, 170], mid: [255, 120, 40], limb: [150, 30, 10], corona: [255, 110, 50] };
    const sun = { core: [255, 252, 238], mid: [255, 205, 110], limb: [220, 90, 20], corona: [255, 190, 120] };
    const lerpSet = (a, b, t) => ({ core: mixRGB(a.core, b.core, t), mid: mixRGB(a.mid, b.mid, t), limb: mixRGB(a.limb, b.limb, t), corona: mixRGB(a.corona, b.corona, t) });
    if (T < 0.3) return pink;
    if (T < 1.5) return lerpSet(pink, orange, (T - 0.3) / 1.2);
    if (T < 6) return lerpSet(orange, sun, (T - 1.5) / 4.5);
    return sun;
  }

  Camera.prototype.draw = function (s, now, dtReal) {
    const g = this.g, W = this.W, H = this.H, d = s.d, pl = s.pl;
    const cx = W / 2, cy = H / 2;
    this.view += dtReal * 0.05;
    const on = pl.on;
    const T = on ? d.T : 0;
    const Ptot = on ? d.Pheat + d.Pfus * 0.05 : 0;
    const I = on ? clamp(Math.log10(1 + Ptot / 1e6) / 2.8, 0.12, 1) : 0;
    const col = plasmaColours(T);
    const Rp = H * 0.27 * (on ? 0.55 + 0.45 * Math.sqrt(clamp(pl.Ip / 23, 0, 1.1)) : 0.8);
    const zOff = clamp(pl.z * 900, -120, 120);
    const py = cy + zOff;

    // ELM prominences and flares
    if (pl.elmCount !== this.lastElm) {
      const n = Math.min(3, pl.elmCount - this.lastElm);
      if (on && pl.elmType === 'TYPE-I') for (let i = 0; i < n; i++) this.spawnProm(true);
      else if (on && pl.elmType.startsWith('PACED') && Math.random() < 0.08) this.spawnProm(false);
      this.lastElm = pl.elmCount;
    }
    if (on && Math.random() < dtReal * 0.25 * I) this.spawnProm(false);

    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.drawImage(this.bg, 0, 0);
    // plasma light on the wall
    if (on) {
      const wl = g.createRadialGradient(cx, py, Rp * 0.5, cx, py, W * 0.8);
      wl.addColorStop(0, rgba(col.corona, 0.55 * I)); wl.addColorStop(0.4, rgba(col.corona, 0.18 * I)); wl.addColorStop(1, rgba(col.corona, 0));
      g.globalCompositeOperation = 'lighter'; g.fillStyle = wl; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }

    const coilLight = on ? I : (s.mag.BT > 0.1 ? 0.08 : 0.04);
    this.drawCage(s, cx, cy, Rp, coilLight, col, false);

    if (on) {
      // corona and streamers
      g.globalCompositeOperation = 'lighter';
      const cor = g.createRadialGradient(cx, py, Rp * 0.85, cx, py, Rp * 2.3);
      cor.addColorStop(0, rgba(col.corona, 0.55 * I)); cor.addColorStop(0.35, rgba(col.corona, 0.16 * I)); cor.addColorStop(1, rgba(col.corona, 0));
      g.fillStyle = cor; g.beginPath(); g.arc(cx, py, Rp * 2.3, 0, TAU); g.fill();
      g.save(); g.translate(cx, py);
      for (let k = 0; k < 18; k++) {
        const a = k / 18 * TAU + this.view * 0.3 + Math.sin(now / 1700 + k) * 0.05;
        const len = Rp * (1.5 + 0.5 * Math.sin(now / 900 + k * 1.7));
        const sg = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
        sg.addColorStop(0.55, rgba(col.corona, 0.10 * I)); sg.addColorStop(1, rgba(col.corona, 0));
        g.strokeStyle = sg; g.lineWidth = Rp * 0.12;
        g.beginPath(); g.moveTo(Math.cos(a) * Rp * 0.9, Math.sin(a) * Rp * 0.9); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
      }
      g.restore();
      g.globalCompositeOperation = 'source-over';

      // photosphere
      g.save();
      g.beginPath(); g.ellipse(cx, py, Rp, Rp * 1.06, 0, 0, TAU); g.clip();
      const body = g.createRadialGradient(cx - Rp * 0.15, py - Rp * 0.15, Rp * 0.05, cx, py, Rp * 1.05);
      body.addColorStop(0, rgba(col.core, 1)); body.addColorStop(0.55, rgba(col.mid, 1)); body.addColorStop(1, rgba(col.limb, 1));
      g.fillStyle = body; g.fillRect(cx - Rp, py - Rp * 1.1, Rp * 2, Rp * 2.2);
      if (T > 1) {
        // granulation drifting with rotation
        const gAlpha = clamp((T - 1) / 5, 0, 1) * 0.55;
        g.globalAlpha = gAlpha;
        g.globalCompositeOperation = 'overlay';
        const off = (now * 0.012) % 512;
        g.translate(cx - Rp - off, py - Rp * 1.1);
        g.fillStyle = this.texPattern;
        g.fillRect(off, 0, Rp * 2 + 512, Rp * 2.2);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        // sunspots (magnetic active regions), foreshortened as they rotate across the disc
        for (let k = 0; k < 4; k++) {
          const lon = ((now / 26000 + k * 0.27) % 1) * Math.PI - Math.PI / 2;
          const lat = [-0.35, 0.25, -0.18, 0.4][k];
          const x = cx + Rp * Math.cos(lat) * Math.sin(lon), y = py - Rp * 1.06 * Math.sin(lat);
          const fs = Math.cos(lon);
          if (fs < 0.1) continue;
          const sr = Rp * 0.045 * (1 + k % 2);
          g.fillStyle = 'rgba(60,20,5,0.55)';
          g.beginPath(); g.ellipse(x, y, sr * 1.8 * fs, sr * 1.8, 0, 0, TAU); g.fill();
          g.fillStyle = 'rgba(25,8,2,0.85)';
          g.beginPath(); g.ellipse(x, y, sr * fs, sr, 0, 0, TAU); g.fill();
        }
      }
      // limb darkening
      const ld = g.createRadialGradient(cx, py, Rp * 0.45, cx, py, Rp * 1.06);
      ld.addColorStop(0, 'rgba(0,0,0,0)'); ld.addColorStop(0.8, 'rgba(40,10,0,0.25)'); ld.addColorStop(1, 'rgba(30,5,0,0.7)');
      g.fillStyle = ld; g.fillRect(cx - Rp, py - Rp * 1.1, Rp * 2, Rp * 2.2);
      // helical field lines
      if (this.fieldLines) {
        const q = clamp(d.q95 || 5, 1, 14);
        g.strokeStyle = 'rgba(150,215,255,0.32)'; g.lineWidth = 1.2;
        for (let k = 0; k < 14; k++) {
          g.beginPath();
          let pen = false;
          for (let lat = -1.45; lat <= 1.45; lat += 0.04) {
            const lon = k / 14 * TAU + lat * q * 0.28 + now / 4000;
            const cl = Math.cos(lon);
            const x = cx + Rp * Math.cos(lat) * Math.sin(lon), y = py - Rp * 1.06 * Math.sin(lat);
            if (cl > 0) { pen ? g.lineTo(x, y) : g.moveTo(x, y); pen = true; } else pen = false;
          }
          g.stroke();
        }
      }
      // overall brightness
      g.fillStyle = 'rgba(0,0,0,' + (1 - I) * 0.75 + ')';
      g.fillRect(cx - Rp, py - Rp * 1.1, Rp * 2, Rp * 2.2);
      if (pl.elmFlash > 0) {
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,240,210,' + pl.elmFlash * 0.25 + ')';
        g.fillRect(cx - Rp, py - Rp * 1.1, Rp * 2, Rp * 2.2);
      }
      g.restore();
      g.globalCompositeOperation = 'source-over';
    } else if (s.vac.prefillCmd && s.vac.P > 5e-4) {
      // neutral gas lit only by the vessel lamps
      g.fillStyle = 'rgba(120,120,200,0.05)'; g.beginPath(); g.arc(cx, cy, Rp, 0, TAU); g.fill();
    }

    // prominences / eruptions (ELMs)
    this.drawProms(cx, py, Rp, dtReal, col, I);
    this.drawCage(s, cx, cy, Rp, coilLight, col, true);

    // disruption flash
    if (pl.flash > 0) {
      g.fillStyle = 'rgba(255,250,240,' + clamp(pl.flash, 0, 1) * 0.85 + ')';
      g.fillRect(0, 0, W, H);
    }
    g.drawImage(this.scan, 0, 0);
    this.drawHud(s, now);
  };

  Camera.prototype.drawCage = function (s, cx, cy, Rp, light, col, front) {
    const g = this.g, H = this.H;
    const n = 12, Rout = Rp * 1.75, top = cy - H * 0.44, bot = cy + H * 0.44;
    const lit = rgba(mixRGB([60, 70, 80], col.corona, 0.6), 0.25 + light * 0.6);
    // central solenoid column
    if (!front) {
      const cg = g.createLinearGradient(cx - 26, 0, cx + 26, 0);
      cg.addColorStop(0, '#0d1012'); cg.addColorStop(0.5, 'rgba(90,100,110,' + (0.3 + light * 0.5) + ')'); cg.addColorStop(1, '#0d1012');
      g.fillStyle = cg; g.fillRect(cx - 26, 0, 52, H);
    }
    // PF coils: horizontal rings above and below
    const rings = [[-0.36, 1.55], [0.36, 1.55], [-0.62, 1.05], [0.62, 1.05]];
    for (const [yf, rf] of rings) {
      const y = cy + yf * H, rx = Rout * rf * 0.85, ry = rx * 0.16;
      g.lineWidth = 9; g.strokeStyle = '#15191b';
      g.beginPath(); g.ellipse(cx, y, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : TAU); g.stroke();
      g.lineWidth = 2; g.strokeStyle = lit;
      g.beginPath(); g.ellipse(cx, y - 3, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : TAU); g.stroke();
    }
    // TF coils: D-shaped loops sharing the centre column, seen from the side
    for (let k = 0; k < n; k++) {
      const phi = k / n * TAU + this.view;
      const depth = Math.cos(phi);
      if ((depth > 0) !== front) continue;
      const x = cx + Rout * Math.sin(phi);
      const xin = cx + 20 * Math.sin(phi);
      g.beginPath();
      g.moveTo(xin, top + 20);
      g.bezierCurveTo(mix(xin, x, 0.5), top - 10, x, top + 30, x, cy - H * 0.2);
      g.lineTo(x, cy + H * 0.2);
      g.bezierCurveTo(x, bot - 30, mix(xin, x, 0.5), bot + 10, xin, bot - 20);
      const w = 10 + 6 * Math.abs(Math.cos(phi));
      g.lineWidth = w; g.strokeStyle = front ? 'rgba(14,17,19,0.92)' : '#0f1214'; g.stroke();
      g.lineWidth = 2; g.strokeStyle = lit; g.stroke();
    }
  };

  Camera.prototype.spawnProm = function (big) {
    this.proms.push({ a: Math.random() * TAU, span: (big ? 0.35 : 0.18) + Math.random() * 0.15, h: 0, hMax: big ? 0.9 + Math.random() * 0.6 : 0.3 + Math.random() * 0.3, life: 1, big });
    if (this.proms.length > 12) this.proms.shift();
  };
  Camera.prototype.drawProms = function (cx, cy, Rp, dt, col, I) {
    const g = this.g;
    g.globalCompositeOperation = 'lighter';
    for (const p of this.proms) {
      p.h = Math.min(p.hMax, p.h + dt * (p.big ? 2.2 : 0.6));
      p.life -= dt * (p.big ? 0.9 : 0.35);
      if (p.life <= 0) continue;
      const a1 = p.a - p.span / 2, a2 = p.a + p.span / 2;
      const x1 = cx + Math.cos(a1) * Rp, y1 = cy + Math.sin(a1) * Rp * 1.06;
      const x2 = cx + Math.cos(a2) * Rp, y2 = cy + Math.sin(a2) * Rp * 1.06;
      const hx = cx + Math.cos(p.a) * Rp * (1 + p.h), hy = cy + Math.sin(p.a) * Rp * 1.06 * (1 + p.h);
      const alpha = clamp(p.life, 0, 1) * (0.35 + 0.5 * I);
      g.strokeStyle = rgba(p.big ? [255, 120, 60] : col.corona, alpha * 0.5);
      g.lineWidth = Rp * (p.big ? 0.09 : 0.05);
      g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(hx, hy, x2, y2); g.stroke();
      g.strokeStyle = rgba([255, 230, 190], alpha * 0.6);
      g.lineWidth = Rp * 0.018;
      g.beginPath(); g.moveTo(x1, y1); g.quadraticCurveTo(hx, hy, x2, y2); g.stroke();
    }
    this.proms = this.proms.filter(p => p.life > 0);
    g.globalCompositeOperation = 'source-over';
  };

  Camera.prototype.drawHud = function (s, now) {
    const g = this.g, W = this.W, H = this.H, d = s.d, pl = s.pl;
    g.font = '600 17px "IBM Plex Mono", monospace';
    g.fillStyle = 'rgba(220,240,230,0.85)';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.fillText('CAM-07  SYNTHETIC VIS  ' + (pl.on ? 'PULSE #' + pl.pulse : 'NO PLASMA'), 18, 16);
    g.textAlign = 'right';
    g.fillText(E.fmtClock(s.clock), W - 18, 16);
    if (Math.floor(now / 700) % 2 === 0) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(W - 128, 26, 6, 0, TAU); g.fill(); }
    g.textBaseline = 'bottom';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(220,240,230,0.9)';
    if (pl.on) {
      g.fillText('T₀ ' + (d.T0 * E.MK_PER_KEV).toFixed(0) + ' MK   Ip ' + pl.Ip.toFixed(1) + ' MA   ' + (pl.hmode ? 'H-MODE' : 'L-MODE') + (pl.rampDown ? '  RAMP-DOWN' : ''), 18, H - 16);
      g.textAlign = 'right';
      g.fillText('P_fus ' + (d.Pfus / 1e6).toFixed(0) + ' MW', W - 18, H - 16);
    } else {
      g.fillText('VESSEL ' + s.vac.P.toExponential(1) + ' Pa   B_T ' + s.mag.BT.toFixed(2) + ' T', 18, H - 16);
      if (pl.lastDisruption && s.t - pl.lastDisruption.t < 12) {
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '700 30px "IBM Plex Mono", monospace';
        g.fillStyle = pl.lastDisruption.mitigated ? '#ffb627' : '#ff4b3a';
        g.fillText('DISRUPTION', W / 2, H / 2 - 18);
        g.font = '600 16px "IBM Plex Mono", monospace';
        g.fillText(pl.lastDisruption.reason, W / 2, H / 2 + 16);
      }
    }
  };

  // ============================================================ EQUILIBRIUM
  function Equilibrium(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); }
  const heat = t => {
    // single-hue orange ramp, dark → light, for plasma temperature
    const stops = [[28, 12, 6], [110, 38, 10], [205, 90, 25], [245, 160, 70], [255, 232, 190]];
    const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return mixRGB(stops[i], stops[i + 1], x - i);
  };
  Equilibrium.prototype.draw = function (s) {
    const g = this.g, M = E.MACHINE, d = s.d, pl = s.pl;
    if (!this.c.clientWidth) return;
    const [W, H] = fitCanvas(this.c, g);
    const Rmax = 7.6, Zmax = 8.4;
    const sc = Math.min((W - 60) / Rmax, (H - 50) / (2 * Zmax));
    const ox = Math.max(44, (W - Rmax * sc) / 2 - 10), oy = H / 2 - 6;
    const X = R => ox + R * sc, Y = Z => oy - Z * sc;
    g.fillStyle = '#0a0f12'; g.fillRect(0, 0, W, H);
    // grid
    g.strokeStyle = '#16232a'; g.lineWidth = 1;
    g.font = '500 11px "IBM Plex Mono", monospace'; g.fillStyle = '#6f8b96';
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let R = 0; R <= 7; R++) { g.beginPath(); g.moveTo(X(R), Y(Zmax)); g.lineTo(X(R), Y(-Zmax)); g.stroke(); g.fillText(String(R), X(R), Y(-Zmax) + 4); }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let Z = -8; Z <= 8; Z += 4) { g.beginPath(); g.moveTo(X(0), Y(Z)); g.lineTo(X(Rmax), Y(Z)); g.stroke(); g.fillText(String(Z), X(0) - 6, Y(Z)); }
    g.textAlign = 'left'; g.fillText('R [m]', X(Rmax) - 34, Y(-Zmax) - 10);
    g.save(); g.translate(12, Y(0)); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('Z [m]', 0, 0); g.restore();

    // centre column: central solenoid + TF inner legs
    g.fillStyle = '#2a3238'; g.fillRect(X(0), Y(7.6), 1.25 * sc, 15.2 * sc);
    g.strokeStyle = '#46525a';
    for (let z = -7.4; z < 7.6; z += 0.5) { g.beginPath(); g.moveTo(X(0), Y(z)); g.lineTo(X(1.25), Y(z + 0.5)); g.stroke(); }
    // PF coils
    g.fillStyle = s.mag.tfOn ? '#3f6d8a' : '#2d3a42';
    for (const [R, Z, w, h] of [[6.7, 3.3, 0.5, 0.7], [5.4, 6.4, 0.6, 0.5], [2.3, 7.6, 0.6, 0.4], [1.7, 6.2, 0.35, 0.5]]) {
      g.fillRect(X(R - w / 2), Y(Z + h / 2), w * sc, h * sc);
      g.fillRect(X(R - w / 2), Y(-Z + h / 2), w * sc, h * sc);
    }
    // vessel
    const miller = (R0, a, k, dl, rho, z0, th) => [R0 + rho * a * Math.cos(th + dl * rho * Math.sin(th)), z0 + k * rho * a * Math.sin(th)];
    g.strokeStyle = '#9aa7ad'; g.lineWidth = 2.5;
    g.beginPath();
    for (let i = 0; i <= 120; i++) { const [R, Z] = miller(4.0, 2.72, 2.5, 0.42, 1, 0, i / 120 * TAU); i ? g.lineTo(X(R), Y(Z)) : g.moveTo(X(R), Y(Z)); }
    g.closePath(); g.stroke();
    // divertor plates
    g.strokeStyle = '#c9a15a'; g.lineWidth = 4;
    for (const sgn of [1, -1]) { g.beginPath(); g.moveTo(X(2.2), Y(sgn * 6.55)); g.lineTo(X(4.4), Y(sgn * 6.75)); g.stroke(); }

    const z0 = pl.on ? clamp(pl.z * 3, -2, 2) : 0;
    const T0 = pl.on ? d.T0 : 0;
    if (pl.on) {
      const rhos = [1, 0.8, 0.6, 0.4, 0.2];
      const scale = clamp(0.55 + 0.45 * Math.sqrt(pl.Ip / 23), 0.4, 1.05);
      for (const rho of rhos) {
        const Trho = T0 * (1 - (rho - 0.1) * (rho - 0.1));
        const c = heat(Trho / 40);
        g.fillStyle = rgba(c, 1);
        g.beginPath();
        const shift = 0.25 * (1 - rho * rho) * Math.min(1.5, d.betaP || 0);
        for (let i = 0; i <= 90; i++) {
          const [R, Z] = miller(M.R0 + shift, M.a * scale, M.kappa, M.delta, rho, z0, i / 90 * TAU);
          i ? g.lineTo(X(R), Y(Z)) : g.moveTo(X(R), Y(Z));
        }
        g.closePath(); g.fill();
        g.strokeStyle = rho === 1 ? (pl.elmFlash > 0 ? '#ffffff' : '#ffd36b') : 'rgba(255,255,255,0.28)';
        g.lineWidth = rho === 1 ? 2 : 1; g.stroke();
      }
      // X-points and divertor legs (double null)
      const aS = M.a * scale;
      g.strokeStyle = pl.elmFlash > 0 ? '#ffffff' : '#ffd36b'; g.lineWidth = 1.5;
      for (const sgn of [1, -1]) {
        const xr = M.R0 - M.delta * aS, xz = z0 + sgn * M.kappa * aS;
        g.beginPath(); g.moveTo(X(xr - 0.9), Y(sgn * 6.6)); g.lineTo(X(xr), Y(xz)); g.lineTo(X(xr + 1.1), Y(sgn * 6.72)); g.stroke();
        g.fillStyle = '#ffd36b'; g.fillRect(X(xr) - 3, Y(xz) - 3, 6, 6);
        if (pl.hmode && d.qdiv > 0) {
          const q = clamp(d.qdiv / 15, 0, 1);
          g.fillStyle = rgba(q > 0.66 ? [255, 75, 58] : [255, 182, 39], 0.4 + q * 0.6);
          g.beginPath(); g.arc(X(xr - 0.9), Y(sgn * 6.6), 4 + q * 5, 0, TAU); g.arc(X(xr + 1.1), Y(sgn * 6.72), 4 + q * 5, 0, TAU); g.fill();
        }
      }
      // magnetic axis
      g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
      const axR = M.R0 + 0.25 * Math.min(1.5, d.betaP || 0);
      g.beginPath(); g.moveTo(X(axR) - 6, Y(z0)); g.lineTo(X(axR) + 6, Y(z0)); g.moveTo(X(axR), Y(z0) - 6); g.lineTo(X(axR), Y(z0) + 6); g.stroke();
    } else {
      g.fillStyle = '#6f8b96'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 13px "IBM Plex Mono", monospace';
      g.fillText('NO PLASMA', X(4), Y(0));
    }
    // temperature scale legend
    const lx = W - 26, ly = 22, lh = 150;
    for (let i = 0; i < lh; i++) { g.fillStyle = rgba(heat(1 - i / lh), 1); g.fillRect(lx, ly + i, 10, 1); }
    g.strokeStyle = '#6f8b96'; g.lineWidth = 1; g.strokeRect(lx - 0.5, ly - 0.5, 11, lh + 1);
    g.fillStyle = '#9fb3bb'; g.font = '500 10px "IBM Plex Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillText('40 keV', lx - 4, ly); g.fillText('20', lx - 4, ly + lh / 2); g.fillText('0', lx - 4, ly + lh);
    g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillStyle = '#9fb3bb';
    g.fillText('EFIT · ' + (pl.on ? 'Z ' + (pl.z * 100).toFixed(1) + ' cm' : 'IDLE'), 50, 8);
  };

  // ================================================================= TRENDS
  // Small multiples: one y-axis per strip, never two scales on one plot.
  const STRIPS = [
    { key: 'Ip', title: 'Plasma current', unit: 'MA', min: 0, max: 25, dec: 1 },
    { key: 'T', title: 'Volume-average temperature', unit: 'keV', min: 0, max: 20, dec: 1 },
    { key: 'Pfus', title: 'Fusion power', unit: 'MW', min: 0, max: 2500, dec: 0 },
    { key: 'Pnet', key2: 'D', title: 'Net output vs Solhavn demand', unit: 'MW', min: -300, max: 700, dec: 0, names: ['Net output', 'Demand'] },
    { key: 'f', title: 'Grid frequency', unit: 'Hz', min: 48.6, max: 51, dec: 2, refs: [49.8, 50, 50.2] }
  ];
  function Trends(canvas, tip) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.tip = tip; this.win = 900; this.hoverX = null;
    const onMove = e => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = e.clientX - r.left;
      this.hoverPx = { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width };
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onMove);
    canvas.addEventListener('pointerleave', () => { this.hoverX = null; tip.hidden = true; });
  }
  function fitCanvas(c, g) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(200, c.clientWidth), H = Math.max(160, c.clientHeight);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [W, H];
  }
  Trends.prototype.draw = function (hist, tNow) {
    const g = this.g;
    if (!this.c.clientWidth) return;
    const [W, H] = fitCanvas(this.c, g);
    const css = getComputedStyle(document.documentElement);
    const pen1 = css.getPropertyValue('--pen-1').trim() || '#3987e5';
    const pen2 = css.getPropertyValue('--pen-2').trim() || '#d95926';
    g.clearRect(0, 0, W, H);
    const left = W < 500 ? 44 : 58, right = W < 500 ? 70 : 92, axisH = 22;
    const stripH = (H - axisH) / STRIPS.length;
    const t0 = tNow - this.win;
    const xOf = t => left + (t - t0) / this.win * (W - left - right);
    const data = hist.filter(p => p.t >= t0 - 2);
    let hoverIdx = -1;
    if (this.hoverX != null && data.length) {
      const tH = t0 + (this.hoverX - left) / (W - left - right) * this.win;
      let best = Infinity;
      data.forEach((p, i) => { const dd = Math.abs(p.t - tH); if (dd < best) { best = dd; hoverIdx = i; } });
    }
    STRIPS.forEach((st, k) => {
      const top = k * stripH + 18, bot = (k + 1) * stripH - 6;
      const yOf = v => bot - (clamp(v, st.min, st.max) - st.min) / (st.max - st.min) * (bot - top);
      // title and latest value
      g.font = '600 12px "IBM Plex Mono", monospace'; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.fillStyle = '#b9ced6';
      if (st.names) {
        // legend built into the title: each series name followed by its pen swatch
        let x = left;
        const part = (t, c) => { g.fillStyle = '#b9ced6'; g.fillText(t, x, top - 5); x += g.measureText(t).width; if (c) { g.fillStyle = c; g.fillRect(x + 3, top - 11, 14, 3); x += 21; } };
        part(st.names[0], pen1); part('vs ' + st.names[1].toLowerCase(), pen2); part('[' + st.unit + ']');
      } else g.fillText(st.title + ' [' + st.unit + ']', left, top - 5);
      // hairline grid: min, mid, max
      g.strokeStyle = '#1d2e36'; g.lineWidth = 1;
      g.font = '500 11px "IBM Plex Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = '#7f9aa4';
      const ticks = [st.min, (st.min + st.max) / 2, st.max];
      for (const v of ticks) { const y = Math.round(yOf(v)) + 0.5; g.beginPath(); g.moveTo(left, y); g.lineTo(W - right, y); g.stroke(); g.fillText(Number.isInteger(v) ? fmt(v, 0) : fmt(v, 1), left - 6, y); }
      if (st.refs) {
        g.strokeStyle = 'rgba(250,178,25,0.45)';
        for (const v of [st.refs[0], st.refs[2]]) { const y = Math.round(yOf(v)) + 0.5; g.beginPath(); g.moveTo(left, y); g.lineTo(W - right, y); g.stroke(); }
      }
      const series = [[st.key, pen1]];
      if (st.key2) series.push([st.key2, pen2]);
      for (const [key, colr] of series) {
        g.strokeStyle = colr; g.lineWidth = 2; g.lineJoin = 'round';
        g.beginPath();
        let started = false;
        for (const p of data) { const x = xOf(p.t), y = yOf(p[key]); started ? g.lineTo(x, y) : g.moveTo(x, y); started = true; }
        g.stroke();
        const last = data[data.length - 1];
        if (last) {
          const x = xOf(last.t), y = yOf(last[key]);
          g.fillStyle = colr; g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill();
          g.fillStyle = '#e4f1f6'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.font = '600 12px "IBM Plex Mono", monospace';
          const label = (st.names ? (key === st.key ? 'Net ' : 'Dem ') : '') + fmt(last[key], st.dec);
          const dy = st.key2 ? (key === st.key ? (last[st.key] >= last[st.key2] ? -8 : 8) : (last[st.key] >= last[st.key2] ? 8 : -8)) : 0;
          g.fillText(label, x + 8, clamp(y + dy, top + 4, bot - 4));
        }
      }
    });
    // time axis
    g.fillStyle = '#7f9aa4'; g.font = '500 11px "IBM Plex Mono", monospace'; g.textBaseline = 'bottom';
    const mins = this.win / 60, stepM = mins <= 5 ? 1 : mins <= 15 ? 5 : 15;
    for (let m = 0; m <= mins; m += stepM) {
      const x = xOf(tNow - m * 60);
      g.textAlign = m === 0 ? 'right' : 'center';
      g.fillText(m === 0 ? 'now' : '−' + m + ' min', x, H - 2);
    }
    // crosshair + tooltip
    if (hoverIdx >= 0) {
      const p = data[hoverIdx], x = xOf(p.t);
      g.strokeStyle = 'rgba(220,240,250,0.55)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(Math.round(x) + 0.5, 10); g.lineTo(Math.round(x) + 0.5, H - axisH); g.stroke();
      const tip = this.tip;
      tip.hidden = false;
      tip.innerHTML = '<b>' + p.clock + '</b><br>Ip ' + fmt(p.Ip, 1) + ' MA<br>⟨T⟩ ' + fmt(p.T, 1) + ' keV<br>P_fus ' + fmt(p.Pfus, 0) + ' MW<br>Net ' + fmt(p.Pnet, 0) + ' MW · Demand ' + fmt(p.D, 0) + ' MW<br>Grid ' + fmt(p.f, 3) + ' Hz';
      const hp = this.hoverPx;
      tip.style.left = Math.min(hp.x + 14, hp.w - 230) + 'px';
      tip.style.top = Math.max(4, hp.y - 60) + 'px';
    }
  };
  function fmt(v, dec) { return v == null || !isFinite(v) ? '—' : Number(v).toFixed(dec).replace('-', '−'); }

  // ================================================================ SKYLINE
  function Skyline(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    const r = seeded(42), W = canvas.width;
    this.districts = [];
    const n = E.MACHINE.districts, left = 150, w = (W - left - 10) / n;
    for (let i = 0; i < n; i++) {
      const bl = [];
      let x = left + i * w + 4;
      while (x < left + (i + 1) * w - 12) {
        const bw = 12 + r() * 22, bh = 40 + r() * (i % 4 === 1 ? 150 : 90);
        const wins = [];
        for (let yy = 8; yy < bh - 6; yy += 9) for (let xx = 4; xx < bw - 4; xx += 7) wins.push([xx, yy, r()]);
        bl.push({ x, w: bw, h: bh, wins });
        x += bw + 2 + r() * 4;
      }
      this.districts.push({ x0: left + i * w, w, bl });
    }
  }
  Skyline.prototype.draw = function (s, now) {
    const g = this.g, W = this.c.width, H = this.c.height, gr = s.grid;
    const hour = s.clock / 3600;
    const day = clamp(Math.sin((hour - 6) / 12 * Math.PI), 0, 1);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, rgba(mixRGB([6, 10, 22], [64, 104, 150], day), 1));
    sky.addColorStop(1, rgba(mixRGB([18, 20, 36], [150, 160, 170], day), 1));
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    const ground = H - 30;
    // HELIOS-1 plant on the headland
    g.fillStyle = '#1c2226';
    g.fillRect(20, ground - 60, 90, 60);
    g.beginPath(); g.arc(65, ground - 60, 34, Math.PI, 0); g.fill();
    const glow = s.pl.on ? clamp(s.d.Pfus / 2e9, 0.15, 1) : 0;
    if (glow > 0) {
      const gg = g.createRadialGradient(65, ground - 70, 2, 65, ground - 70, 50);
      gg.addColorStop(0, 'rgba(255,220,150,' + 0.8 * glow + ')'); gg.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = gg; g.beginPath(); g.arc(65, ground - 70, 50, 0, TAU); g.fill();
    }
    g.fillStyle = '#9fb3bb'; g.font = '600 12px "IBM Plex Mono", monospace'; g.textAlign = 'center';
    g.fillText('HELIOS-1', 65, ground + 18);
    // transmission line
    const exporting = s.tg.breaker && s.d.Pnet > 0;
    g.strokeStyle = exporting ? 'rgba(108,182,255,0.9)' : 'rgba(90,100,110,0.6)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(110, ground - 50);
    for (let x = 110; x <= 150; x += 20) g.quadraticCurveTo(x + 10, ground - 38, x + 20, ground - 50);
    g.stroke();
    // districts
    this.districts.forEach((dst, i) => {
      const dark = i >= E.MACHINE.districts - gr.shedBlocks;
      for (const b of dst.bl) {
        g.fillStyle = dark ? '#0b0e12' : '#20262d';
        g.fillRect(b.x, ground - b.h, b.w, b.h);
        if (!dark) {
          for (const [wx, wy, rv] of b.wins) {
            if (rv < 0.55 + 0.25 * day) continue;
            const flick = rv > 0.985 && Math.floor(now / 400 + rv * 100) % 7 === 0;
            g.fillStyle = flick ? '#ffe9b0' : (rv > 0.93 ? '#cfe6ff' : '#ffcf73');
            g.fillRect(b.x + wx, ground - b.h + wy, 3, 4);
          }
        }
      }
      g.fillStyle = dark ? '#ff6a5a' : '#7f9aa4';
      g.font = '500 11px "IBM Plex Mono", monospace'; g.textAlign = 'center';
      g.fillText('D' + (i + 1), dst.x0 + dst.w / 2, ground + 18);
    });
    g.fillStyle = '#0d1114'; g.fillRect(0, ground, W, 2);
  };

  root.HeliosRender = { Camera, Equilibrium, Trends, Skyline, fmt };
})(typeof window !== 'undefined' ? window : globalThis);
