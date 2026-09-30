// What the A320's flight-deck screens and panels show, drawn every few frames from the live state of
// the simulation: the PFD, ND, E/WD and SD (with the ECAM's automatic page selection), both MCDUs,
// the standby instrument, the clock, the FCU with its windows and mode lights, the overhead panel's
// switches and lights, and the pedestal (engine masters, ENG MODE, radio panel, parking brake,
// flap and speed-brake detents, pitch trim). Layout and colour conventions follow the Airbus FCOM
// (green active, blue armed/selected, magenta managed, amber caution, red warning, white labels).
import { clamp, DEG } from './core.js';

const GREEN = '#35e05a', BLUE = '#29c5ff', MAG = '#e94ce0', AMBER = '#ffae00', RED = '#ff2b2b', WHITE = '#ffffff', GREY = '#8a929c';
const pad = (n, w, c = '0') => String(n).padStart(w, c);

// ---------------- PFD ----------------
export function drawPFD(g, d) {
  const W = 512;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  // FMA: five columns
  g.strokeStyle = '#6b6f76'; g.lineWidth = 2; for (const x of [96, 200, 300, 400]) { g.beginPath(); g.moveTo(x, 4); g.lineTo(x, 60); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 16px monospace';
  const f = d.fma, split = (s) => (s || '').split(' · ');
  g.fillStyle = d.athrActive ? GREEN : WHITE; g.fillText((f.thr || '').slice(0, 9), 48, 18);
  const [va, vb] = split(f.vert), [la, lb] = split(f.lat);
  g.fillStyle = GREEN; g.fillText((va || '').slice(0, 9), 148, 18); g.fillText((la || '').slice(0, 9), 250, 18);
  g.fillStyle = BLUE; g.fillText((vb || '').slice(0, 9), 148, 42); g.fillText((lb || '').slice(0, 9), 250, 42);
  g.fillStyle = WHITE; g.fillText(d.capability || '', 350, 18); if (d.dh) g.fillText(d.dh, 350, 42);
  g.fillText(d.ap1 ? 'AP1' : '', 456, 14); g.fillText(d.fd ? '1 FD 2' : '', 456, 32); g.fillStyle = d.athrActive ? WHITE : BLUE; g.fillText(d.athr ? 'A/THR' : '', 456, 50);
  // attitude
  const cx = 250, cy = 240, R = 118, ppd = 5.2;
  g.save(); g.beginPath(); g.rect(cx - R, cy - R, 2 * R, 2 * R); g.clip();
  g.translate(cx, cy); g.rotate(-d.bank); g.translate(0, d.pitch / DEG * ppd);
  g.fillStyle = '#1f7ad8'; g.fillRect(-400, -900, 800, 900); g.fillStyle = '#8a5a26'; g.fillRect(-400, 0, 800, 900);
  g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.moveTo(-400, 0); g.lineTo(400, 0); g.stroke();
  g.font = '13px monospace'; g.fillStyle = WHITE; g.textAlign = 'left';
  for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const y = -p * ppd, w = p % 10 === 0 ? 46 : p % 5 === 0 ? 26 : 10; g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke(); if (p % 10 === 0) g.fillText(String(Math.abs(p)), w + 4, y); }
  // heading marks on the horizon
  for (let h = -40; h <= 40; h += 10) { const x = h * ppd * 1.0; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 6); g.stroke(); }
  g.restore();
  // bank scale and pointer, sideslip index
  g.strokeStyle = WHITE; g.lineWidth = 2;
  for (const b of [-45, -30, -20, -10, 0, 10, 20, 30, 45]) { const a = (b - 90) * DEG, r0 = R - 6, r1 = R + (b % 30 === 0 || !b ? 12 : 6); g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke(); }
  { const a = -d.bank - Math.PI / 2; const px = cx + Math.cos(a) * (R - 8), py = cy + Math.sin(a) * (R - 8); g.fillStyle = Math.abs(d.bank) > 33 * DEG ? AMBER : '#ffd400'; g.beginPath(); g.moveTo(px, py); g.lineTo(px - 7, py + 12); g.lineTo(px + 7, py + 12); g.fill(); g.fillRect(px - 7 + clamp(d.beta / DEG, -8, 8) * 3, py + 14, 14, 4); }
  // flight director bars
  if (d.fd && !d.onGround) {
    g.strokeStyle = GREEN; g.lineWidth = 3;
    const py = cy + clamp(-d.fdPitch / DEG * ppd, -90, 90), px = cx + clamp(d.fdRoll / DEG * 3, -90, 90);
    g.beginPath(); g.moveTo(cx - 70, py); g.lineTo(cx + 70, py); g.moveTo(px, cy - 70); g.lineTo(px, cy + 70); g.stroke();
  }
  // aircraft symbol
  g.strokeStyle = '#ffd400'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx - 88, cy); g.lineTo(cx - 34, cy); g.lineTo(cx - 34, cy + 12); g.moveTo(cx + 88, cy); g.lineTo(cx + 34, cy); g.lineTo(cx + 34, cy + 12); g.stroke(); g.fillStyle = '#ffd400'; g.fillRect(cx - 4, cy - 4, 8, 8);
  // ILS deviation scales
  if (d.ilsTuned) {
    g.strokeStyle = WHITE; g.lineWidth = 2;
    for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(cx + k * 34, cy + R + 16, 3, 0, 7); g.stroke(); g.beginPath(); g.arc(cx + R + 16, cy + k * 34, 3, 0, 7); g.stroke(); }
    g.fillStyle = MAG;
    if (d.locValid) { const x = cx + clamp(d.locDev, -2.2, 2.2) * 34; g.beginPath(); g.moveTo(x - 8, cy + R + 16); g.lineTo(x, cy + R + 9); g.lineTo(x + 8, cy + R + 16); g.lineTo(x, cy + R + 23); g.fill(); }
    if (d.gsValid) { const y = cy + clamp(d.gsDev, -2.2, 2.2) * 34; g.beginPath(); g.moveTo(cx + R + 16, y - 8); g.lineTo(cx + R + 9, y); g.lineTo(cx + R + 16, y + 8); g.lineTo(cx + R + 23, y); g.fill(); }
  }
  // speed tape
  const spx = 16, spw = 74, k = 3.2;
  g.fillStyle = '#3a3f47'; g.fillRect(spx, 120, spw, 240); g.save(); g.beginPath(); g.rect(spx, 120, spw, 240); g.clip();
  g.strokeStyle = WHITE; g.fillStyle = WHITE; g.font = '15px monospace'; g.textAlign = 'right'; g.lineWidth = 2;
  const Y = (v) => cy - (v - d.ias) * k;
  for (let v = Math.max(30, Math.floor(d.ias / 10) * 10 - 60); v < d.ias + 70; v += 10) { const y = Y(v); g.beginPath(); g.moveTo(spx + spw - 10, y); g.lineTo(spx + spw, y); g.stroke(); if (v % 20 === 0) g.fillText(String(v), spx + spw - 14, y); }
  if (d.vls && !d.onGround) { g.fillStyle = AMBER; g.fillRect(spx + spw - 6, Y(d.vls), 6, 400); }
  if (d.vmax) { for (let v = d.vmax; v < d.vmax + 80; v += 6) { g.fillStyle = Math.floor((v - d.vmax) / 6) % 2 ? '#000' : RED; g.fillRect(spx + spw - 6, Y(v + 6), 6, 6 * k); } }
  if (d.onGround && d.v1) { g.fillStyle = BLUE; g.font = 'bold 15px monospace'; g.fillText('1', spx + spw - 2, Y(d.v1)); g.beginPath(); g.arc(spx + spw - 4, Y(d.vr), 4, 0, 7); g.strokeStyle = BLUE; g.stroke(); }
  if (!d.onGround) {
    g.font = 'bold 14px monospace'; g.fillStyle = GREEN;
    if (d.cfg === 0 && d.gdot) { g.beginPath(); g.arc(spx + spw - 6, Y(d.gdot), 4, 0, 7); g.strokeStyle = GREEN; g.stroke(); }
    if (d.cfg === 1 && d.sSpd) g.fillText('S', spx + spw - 2, Y(d.sSpd));
    if ((d.cfg === 2 || d.cfg === 3) && d.fSpd) g.fillText('F', spx + spw - 2, Y(d.fSpd));
  }
  if (d.spd) { const y = Y(d.spd); g.fillStyle = d.spdManaged ? MAG : BLUE; g.beginPath(); g.moveTo(spx + spw, y); g.lineTo(spx + spw - 12, y - 8); g.lineTo(spx + spw - 12, y + 8); g.fill(); }
  if (Math.abs(d.iasTrend) > 2) { g.strokeStyle = '#ffd400'; g.lineWidth = 3; const x = spx + spw - 20; g.beginPath(); g.moveTo(x, cy); g.lineTo(x, Y(d.ias + d.iasTrend)); g.stroke(); }
  g.restore(); g.fillStyle = '#ffd400'; g.fillRect(spx - 4, cy - 2, spw + 10, 4);
  g.fillStyle = '#000'; g.fillRect(spx, cy - 16, 56, 32); g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.strokeRect(spx, cy - 16, 56, 32);
  g.fillStyle = WHITE; g.font = 'bold 19px monospace'; g.textAlign = 'right'; g.fillText(String(Math.round(d.ias)), spx + 52, cy);
  if (d.mach > 0.5) { g.fillStyle = GREEN; g.font = '15px monospace'; g.fillText(`.${pad(Math.round(d.mach * 1000), 3).slice(0, 3)}`, spx + 60, 386); }
  if (d.spd && (d.spd > d.ias + 37 || d.spd < d.ias - 37)) { g.fillStyle = d.spdManaged ? MAG : BLUE; g.font = '15px monospace'; g.fillText(String(Math.round(d.spd)), spx + 56, d.spd > d.ias ? 110 : 372); }
  // altitude tape, target, baro, radio altitude
  const ax = 392, aw = 66, ka = 0.19;
  g.fillStyle = '#3a3f47'; g.fillRect(ax, 120, aw, 240); g.save(); g.beginPath(); g.rect(ax, 120, aw, 240); g.clip();
  g.fillStyle = WHITE; g.textAlign = 'left'; g.font = '14px monospace';
  const AY = (a) => cy - (a - d.alt) * ka;
  for (let a = Math.floor(d.alt / 100) * 100 - 700; a < d.alt + 700; a += 100) { const y = AY(a); g.fillRect(ax, y - 1, 8, 2); if (a % 500 === 0) g.fillText(pad(Math.max(0, a / 100 | 0), 3), ax + 12, y); }
  if (d.onGround || d.radioAlt < 570) { const gy = AY(d.alt - d.radioAlt); g.fillStyle = RED; g.fillRect(ax + aw - 8, gy, 8, 300); }
  { const y = AY(d.altTarget); g.fillStyle = d.altManaged ? MAG : BLUE; g.fillRect(ax, y - 10, 10, 20); }
  g.restore();
  g.fillStyle = '#000'; g.fillRect(ax - 4, cy - 17, 84, 34); g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.strokeRect(ax - 4, cy - 17, 84, 34);
  g.fillStyle = GREEN; g.font = 'bold 19px monospace'; g.textAlign = 'left'; g.fillText(pad(Math.round(d.alt / 20) * 20, 5, ' '), ax, cy);
  g.fillStyle = d.altManaged ? MAG : BLUE; g.font = '15px monospace'; g.fillText(d.altTargetStr, ax + 6, 108);
  g.fillStyle = d.std ? BLUE : WHITE; g.fillText(d.std ? 'STD' : `QNH ${d.qnh}`, ax + 2, 380);
  if (d.radioAlt < 2500 && !d.onGround) { g.fillStyle = d.radioAlt < (d.dhFt || 0) ? AMBER : GREEN; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.fillText(String(Math.round(d.radioAlt / (d.radioAlt < 50 ? 1 : d.radioAlt < 200 ? 5 : 10)) * (d.radioAlt < 50 ? 1 : d.radioAlt < 200 ? 5 : 10)), cx, cy + R - 14); }
  // vertical speed
  const vx = 478; g.fillStyle = '#3a3f47'; g.fillRect(vx, 150, 26, 180);
  g.strokeStyle = WHITE; g.lineWidth = 1; for (const v of [-6, -2, -1, 0, 1, 2, 6]) { const y = cy - Math.sign(v) * Math.min(80, Math.sqrt(Math.abs(v)) * 34); g.beginPath(); g.moveTo(vx, y); g.lineTo(vx + 6, y); g.stroke(); }
  { const v = d.vs / 1000, y = cy - Math.sign(v) * Math.min(86, Math.sqrt(Math.abs(v)) * 34); g.strokeStyle = Math.abs(d.vs) > 6000 ? AMBER : GREEN; g.lineWidth = 3; g.beginPath(); g.moveTo(vx + 40, cy); g.lineTo(vx + 4, y); g.stroke(); if (Math.abs(d.vs) > 200) { g.fillStyle = GREEN; g.font = '13px monospace'; g.textAlign = 'center'; g.fillText(pad(Math.abs(Math.round(d.vs / 100)), 2), vx + 13, d.vs > 0 ? 140 : 340); } }
  // heading scale with the selected heading and the track diamond
  g.fillStyle = '#3a3f47'; g.fillRect(140, 400, 220, 42); g.save(); g.beginPath(); g.rect(140, 400, 220, 42); g.clip();
  g.fillStyle = WHITE; g.font = '14px monospace'; g.textAlign = 'center';
  for (let h = Math.floor(d.hdg / 5) * 5 - 30; h < d.hdg + 35; h += 5) { const x = cx + (h - d.hdg) * 4; g.fillRect(x - 1, 400, 2, h % 10 === 0 ? 10 : 5); if (h % 10 === 0) g.fillText(pad(((((h % 360) + 360) % 360) / 10) | 0, 2), x, 425); }
  if (d.hdgSel != null) { const x = cx + angle(d.hdgSel - d.hdg) * 4; g.fillStyle = BLUE; g.beginPath(); g.moveTo(x, 400); g.lineTo(x - 6, 392 + 16); g.lineTo(x + 6, 392 + 16); g.fill(); }
  { const x = cx + angle(d.trk - d.hdg) * 4; g.strokeStyle = GREEN; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 401); g.lineTo(x - 5, 408); g.lineTo(x, 415); g.lineTo(x + 5, 408); g.closePath(); g.stroke(); }
  g.restore(); g.fillStyle = '#ffd400'; g.fillRect(cx - 2, 396, 4, 20);
  if (d.warn) { g.fillStyle = RED; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.fillText(d.warn, cx, 480); }
  else if (d.pfdMsg) { g.fillStyle = AMBER; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.fillText(d.pfdMsg, cx, 480); }
}
const angle = (a) => ((a + 540) % 360) - 180;

// ---------------- ND (ARC mode) ----------------
export function drawND(g, d) {
  const W = 512, cx = 256, cy = 420, R = 330, rng = d.range, ppm = R / (rng * 1852);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  g.save(); g.beginPath(); g.rect(0, 0, W, W); g.clip();
  // range arcs
  g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
  g.setLineDash([6, 8]); g.lineWidth = 1; for (const k of [0.25, 0.5, 0.75]) { g.beginPath(); g.arc(cx, cy, R * k, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); } g.setLineDash([]);
  g.fillStyle = BLUE; g.font = '14px monospace'; g.textAlign = 'center'; g.fillText(String(rng / 2), cx - R * 0.5 * 0.81, cy - R * 0.5 * 0.59);
  // compass rose on the arc
  g.fillStyle = WHITE; g.font = '15px monospace';
  for (let h = Math.floor(d.hdg / 5) * 5 - 60; h <= d.hdg + 60; h += 5) {
    const a = (h - d.hdg) * DEG - Math.PI / 2; if (Math.abs(h - d.hdg) > 54) continue;
    const L = h % 10 === 0 ? 14 : 7; g.beginPath(); g.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.lineTo(cx + Math.cos(a) * (R - L), cy + Math.sin(a) * (R - L)); g.stroke();
    if (h % 30 === 0) g.fillText(String((((h % 360) + 360) % 360) / 10 | 0), cx + Math.cos(a) * (R - 28), cy + Math.sin(a) * (R - 28));
  }
  if (d.hdgSel != null) { const a = angle(d.hdgSel - d.hdg) * DEG - Math.PI / 2; g.fillStyle = BLUE; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2)); g.lineTo(cx + Math.cos(a - 0.03) * (R + 16), cy + Math.sin(a - 0.03) * (R + 16)); g.lineTo(cx + Math.cos(a + 0.03) * (R + 16), cy + Math.sin(a + 0.03) * (R + 16)); g.fill(); }
  { const a = angle(d.trk - d.hdg) * DEG - Math.PI / 2; g.strokeStyle = GREEN; g.lineWidth = 2; const x = cx + Math.cos(a) * (R - 8), y = cy + Math.sin(a) * (R - 8); g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x - 5, y); g.lineTo(x, y + 7); g.lineTo(x + 5, y); g.closePath(); g.stroke(); }
  // flight plan: green legs, white TO waypoint, waypoint names
  const P = (p) => [cx + p[0] * ppm, cy - p[1] * ppm];
  if (d.route && d.route.length > 1) { g.strokeStyle = GREEN; g.lineWidth = 2.5; g.beginPath(); d.route.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); }
  g.font = '14px monospace'; g.textAlign = 'left';
  (d.wpts || []).forEach((w, i) => { const [x, y] = P(w.p); if (y < -20 || y > W + 20 || x < -40 || x > W + 40) return; g.strokeStyle = i === 0 ? WHITE : GREEN; g.fillStyle = i === 0 ? WHITE : GREEN; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y); g.lineTo(x, y + 6); g.lineTo(x - 6, y); g.closePath(); g.stroke(); g.fillText(w.name, x + 9, y - 8); });
  if (d.destP) { const [x, y] = P(d.destP); if (y > -20 && y < W && x > -40 && x < W + 40) { g.strokeStyle = WHITE; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); g.fillStyle = WHITE; g.fillText(d.destName, x + 10, y + 4); } }
  // weather radar returns
  if (d.wx) for (const c of d.wx) { const [x, y] = P(c); const r = c[2] * ppm; g.fillStyle = c[3] > 1.5 ? 'rgba(230,40,40,0.55)' : c[3] > 0.8 ? 'rgba(230,200,40,0.5)' : 'rgba(40,200,60,0.4)'; g.beginPath(); g.arc(x, y, Math.max(3, r), 0, 7); g.fill(); }
  // TCAS: other traffic with relative altitude in hundreds of feet
  for (const t of d.tcas || []) {
    const [x, y] = P(t.p); if (y < 0 || y > W || x < 0 || x > W) continue;
    const ta = t.ta, col = ta ? AMBER : WHITE; g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); if (ta) g.arc(x, y, 7, 0, 7); else { g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); }
    if (ta || Math.abs(t.rel) < 1200) g.fill(); else g.stroke();
    g.font = '13px monospace'; g.textAlign = 'center';
    const rel = `${t.rel >= 0 ? '+' : '-'}${pad(Math.min(99, Math.abs(Math.round(t.rel / 100))), 2)}`;
    g.fillText(rel, x, t.rel >= 0 ? y - 14 : y + 18);
    if (Math.abs(t.vs) > 500) { g.beginPath(); const ax = x + 12; g.moveTo(ax, y - 6); g.lineTo(ax, y + 6); g.stroke(); const dir = t.vs > 0 ? -1 : 1; g.beginPath(); g.moveTo(ax - 4, y + dir * 2); g.lineTo(ax, y + dir * 7); g.lineTo(ax + 4, y + dir * 2); g.stroke(); }
  }
  g.restore();
  // own aircraft
  g.strokeStyle = '#ffd400'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy - 20); g.lineTo(cx, cy + 18); g.moveTo(cx - 17, cy - 4); g.lineTo(cx + 17, cy - 4); g.moveTo(cx - 7, cy + 14); g.lineTo(cx + 7, cy + 14); g.stroke();
  // data
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 58);
  g.fillStyle = WHITE; g.textAlign = 'left'; g.font = '16px monospace';
  g.fillText(`GS${pad(Math.round(d.gs), 4, ' ')} TAS${pad(Math.round(d.tas), 4, ' ')}`, 8, 20);
  g.fillText(d.windTxt, 8, 44);
  if (d.windArrow && !d.onGround) { const a = (d.windFrom - d.hdg + 180) * DEG; const x0 = 118, y0 = 44; g.strokeStyle = GREEN; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - Math.sin(a) * 10, y0 + Math.cos(a) * 10); g.lineTo(x0 + Math.sin(a) * 10, y0 - Math.cos(a) * 10); g.stroke(); }
  g.textAlign = 'right'; g.fillStyle = WHITE; g.fillText(d.toName || d.destName, 504, 20); g.fillStyle = GREEN; g.fillText(`${d.toDist < 100 ? d.toDist.toFixed(1) : Math.round(d.toDist)} NM`, 504, 44);
  g.fillStyle = WHITE; g.fillText(d.eta, 504, 66);
  g.textAlign = 'left'; g.fillStyle = GREEN; g.fillText(d.ilsTuned ? `ILS ${d.ilsId}` : '', 8, 500); g.textAlign = 'right'; g.fillStyle = WHITE; g.fillText(d.tcasMode, 504, 500);
}

// ---------------- E/WD ----------------
export function drawEWD(g, d) {
  const W = 512;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // thrust limit
  g.fillStyle = BLUE; g.font = 'bold 18px monospace'; g.fillText(d.thrLimit, 256, 22); g.fillStyle = GREEN; g.fillText(`${d.thrLimitN1.toFixed(1)}%`, 256, 44);
  for (let i = 0; i < 2; i++) {
    const cx = 116 + i * 280, cy = 110, R = 62;
    const off = !d.running[i] && !d.starting[i];
    g.strokeStyle = off ? AMBER : WHITE; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.85, Math.PI * 2.05); g.stroke();
    // red arc above 101 %
    g.strokeStyle = RED; g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.85 + Math.PI * 1.2 * (101 / 110), Math.PI * 2.05); g.stroke();
    const a = Math.PI * 0.85 + Math.PI * 1.2 * clamp(d.n1[i] / 110, 0, 1);
    g.strokeStyle = d.n1[i] > 101 ? RED : GREEN; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    // command (thrust lever) marker
    const ac = Math.PI * 0.85 + Math.PI * 1.2 * clamp(d.n1Cmd[i] / 110, 0, 1); g.fillStyle = BLUE; g.beginPath(); g.arc(cx + Math.cos(ac) * (R + 6), cy + Math.sin(ac) * (R + 6), 4, 0, 7); g.fill();
    g.fillStyle = off ? AMBER : GREEN; g.font = 'bold 24px monospace'; g.fillText(off ? 'XX' : d.n1[i].toFixed(1), cx + 20, cy + 32);
    // EGT arc
    const ey = 250, er = 44; g.strokeStyle = WHITE; g.lineWidth = 3; g.beginPath(); g.arc(cx, ey, er, Math.PI, Math.PI * 2); g.stroke();
    const ea = Math.PI + Math.PI * clamp(d.egt[i] / 1100, 0, 1); g.strokeStyle = d.egt[i] > 1060 ? RED : GREEN; g.beginPath(); g.moveTo(cx, ey); g.lineTo(cx + Math.cos(ea) * er, ey + Math.sin(ea) * er); g.stroke();
    g.fillStyle = GREEN; g.font = '20px monospace'; g.fillText(String(Math.round(d.egt[i])), cx, ey + 18);
    g.fillText((d.n2[i] * 100).toFixed(1), cx, 300);
    g.fillText(String(Math.round(d.ff[i] * 3600 / 20) * 20), cx, 332);
    if (d.fire[i]) { g.fillStyle = RED; g.font = 'bold 22px monospace'; g.fillText('FIRE', cx, 70); }
    else if (d.fail[i]) { g.fillStyle = AMBER; g.font = 'bold 20px monospace'; g.fillText('FAIL', cx, 70); }
    if (d.starting[i]) { g.fillStyle = WHITE; g.font = '16px monospace'; g.fillText(d.startPhase[i] === 'crank' ? 'STARTER' : d.startPhase[i] === 'fuel' ? 'IGN' : 'A', cx, 190); }
  }
  g.fillStyle = WHITE; g.font = '15px monospace';
  g.fillText('N1', 256, 110); g.fillText('%', 256, 128); g.fillText('EGT', 256, 250); g.fillText('°C', 256, 268); g.fillText('N2 %', 256, 300); g.fillText('FF KG/H', 256, 332);
  g.textAlign = 'left'; g.font = '17px monospace'; g.fillText('FOB :', 14, 362); g.fillStyle = GREEN; g.fillText(`${Math.round(d.fob / 20) * 20}`, 80, 362); g.fillStyle = BLUE; g.fillText('KG', 150, 362);
  // slat/flap indicator
  { const x0 = 280, y0 = 356; g.fillStyle = WHITE; g.font = '14px monospace'; g.fillText('S', x0 - 18, y0 - 8); g.fillText('F', x0 + 196, y0 - 8);
    g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 + 60, y0 - 12); g.lineTo(x0 + 120, y0 - 12); g.stroke();
    g.fillStyle = GREEN; const sl = d.slat / 27, fl = d.flap / 35;
    g.beginPath(); g.moveTo(x0 + 60, y0 - 12); g.lineTo(x0 + 60 - 50 * sl, y0 - 12 + 22 * sl); g.lineTo(x0 + 50 - 50 * sl, y0 - 12 + 22 * sl); g.fill();
    g.beginPath(); g.moveTo(x0 + 120, y0 - 12); g.lineTo(x0 + 120 + 60 * fl, y0 - 12 + 22 * fl); g.lineTo(x0 + 130 + 60 * fl, y0 - 12 + 22 * fl); g.fill();
    g.fillStyle = d.flapsMoving ? BLUE : GREEN; g.font = 'bold 18px monospace'; g.textAlign = 'center'; if (d.cfgLabel !== '0') g.fillText(d.cfgLabel, x0 + 90, y0 + 14);
  }
  g.fillStyle = WHITE; g.fillRect(0, 392, W, 2); g.fillRect(256, 392, 2, 120);
  g.textAlign = 'left'; g.font = '16px monospace'; let y = 414;
  for (const m of d.memo) { g.fillStyle = m.c || GREEN; g.fillText(m.t, m.right ? 266 : 10, m.right ? (y) : y); y += 22; if (y > 505) break; }
  y = 414; for (const m of d.memoRight) { g.fillStyle = m.c || GREEN; g.fillText(m.t, 266, y); y += 22; if (y > 505) break; }
}

// ---------------- SD with the ECAM's automatic page selection ----------------
export function drawSD(g, d) {
  const W = 512;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = WHITE; g.font = 'bold 22px monospace'; g.fillText(d.sdPage, 256, 22);
  g.strokeStyle = WHITE; g.beginPath(); g.moveTo(206, 36); g.lineTo(306, 36); g.stroke();
  g.font = '16px monospace';
  const P = d.sdPage;
  if (P === 'DOOR/OXY') {
    // fuselage outline with the doors
    g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.moveTo(256, 60); g.bezierCurveTo(300, 70, 310, 110, 310, 150); g.lineTo(310, 370); g.lineTo(256, 420); g.lineTo(202, 370); g.lineTo(202, 150); g.bezierCurveTo(202, 110, 212, 70, 256, 60); g.stroke();
    const door = (x, y, open, label, right) => { g.strokeStyle = open ? AMBER : GREEN; g.fillStyle = open ? AMBER : GREEN; g.strokeRect(x - 7, y - 11, 14, 22); if (open) { g.fillRect(x - 7, y - 11, 14, 22); g.textAlign = right ? 'left' : 'right'; g.fillText(label, right ? x + 14 : x - 14, y); } };
    door(202, 130, d.doors.L1 > 0.05, 'CABIN'); door(310, 130, false, 'CABIN', true); door(202, 340, false, 'CABIN'); door(310, 340, false, 'CABIN', true);
    door(310, 190, d.cargoOpen, 'CARGO', true); door(310, 290, d.cargoOpen, 'CARGO', true);
    door(256, 110, d.cockpitDoor > 0.1, 'FLT DECK', true);
    g.textAlign = 'left'; g.fillStyle = WHITE; g.fillText('OXY', 20, 70); g.fillStyle = GREEN; g.fillText('1850 PSI', 20, 94);
    g.fillStyle = d.slidesArmed ? GREEN : WHITE; g.fillText(d.slidesArmed ? 'SLIDES ARMED' : 'SLIDES DISARMED', 20, 440);
  } else if (P === 'WHEEL') {
    const tri = (x, y, dn) => { g.fillStyle = dn ? GREEN : RED; g.beginPath(); g.moveTo(x - 14, y - 8); g.lineTo(x + 14, y - 8); g.lineTo(x, y + 12); g.fill(); };
    tri(256, 90, d.gear > 0.99); tri(150, 200, d.gear > 0.99); tri(362, 200, d.gear > 0.99);
    g.fillStyle = WHITE; g.font = '15px monospace';
    for (const [x, k] of [[120, 0], [180, 1], [332, 2], [392, 3]]) { const t = d.brakeTemp[k]; g.strokeStyle = t > 300 ? AMBER : GREEN; g.strokeRect(x - 24, 250, 48, 60); g.fillStyle = t > 300 ? AMBER : GREEN; g.fillText(String(Math.round(t / 5) * 5), x, 280); }
    g.fillStyle = WHITE; g.fillText('°C', 256, 280); g.fillText('REL', 256, 320);
    g.fillStyle = GREEN; g.fillText(d.autobrake !== 'OFF' ? `AUTO BRK ${d.autobrake}` : '', 256, 360);
    g.fillStyle = d.parkBrake ? AMBER : GREEN; g.fillText(d.parkBrake ? 'PARK BRK' : '', 256, 390);
    g.fillStyle = WHITE; g.fillText(`NW STEERING ${d.towing ? 'DISC' : ''}`, 256, 150); g.fillStyle = d.towing ? GREEN : WHITE; g.fillText(`${Math.round(d.steer)}°`, 256, 172);
    g.fillStyle = d.spoilerOut > 0.3 ? GREEN : WHITE; g.fillText(d.spoilerOut > 0.3 ? 'SPOILERS EXTENDED' : '', 256, 420);
  } else if (P === 'ENG') {
    for (let i = 0; i < 2; i++) {
      const x = 130 + i * 252;
      g.fillStyle = GREEN; g.font = 'bold 20px monospace';
      g.fillText(String(Math.round(d.fuelUsed[i] / 10) * 10), x, 90); g.fillText(d.oilQt[i].toFixed(1), x, 160); g.fillText(String(Math.round(d.oilPsi[i])), x, 230);
      g.fillText(d.vibN1[i].toFixed(1), x, 300); g.fillText(d.vibN2[i].toFixed(1), x, 330);
      g.fillStyle = d.starting[i] ? GREEN : WHITE; g.font = '16px monospace'; g.fillText(d.starting[i] ? (d.startValve[i] ? 'VALVE OPEN' : 'VALVE SHUT') : '', x, 380);
      g.fillText(d.starting[i] ? `${Math.round(d.startPsi[i])} PSI` : '', x, 404);
      g.fillStyle = d.ign[i] ? GREEN : WHITE; g.fillText(d.ign[i] ? 'IGN A' : '', x, 430);
    }
    g.fillStyle = WHITE; g.font = '15px monospace';
    g.fillText('F.USED', 256, 76); g.fillText('KG', 256, 98); g.fillText('OIL QT', 256, 160); g.fillText('PSI', 256, 230); g.fillText('VIB N1', 256, 300); g.fillText('N2', 256, 330);
  } else if (P === 'HYD') {
    for (const [x, name, ok] of [[110, 'GREEN', d.hyd.green], [256, 'BLUE', d.hyd.blue], [402, 'YELLOW', d.hyd.yellow]]) {
      g.fillStyle = ok ? GREEN : AMBER; g.font = 'bold 20px monospace'; g.fillText(name, x, 80); g.fillText(ok ? '3000' : '0', x, 110);
      g.strokeStyle = ok ? GREEN : AMBER; g.beginPath(); g.moveTo(x, 130); g.lineTo(x, 330); g.stroke(); g.strokeRect(x - 30, 330, 60, 60);
    }
    g.fillStyle = WHITE; g.font = '15px monospace'; g.fillText('PSI', 256, 140);
  } else if (P === 'CAB PRESS') {
    g.fillStyle = WHITE; g.font = '16px monospace'; g.textAlign = 'left';
    g.fillText('ΔP PSI', 40, 90); g.fillText('CAB V/S FT/MIN', 180, 90); g.fillText('CAB ALT FT', 360, 90);
    g.font = 'bold 26px monospace'; g.fillStyle = d.dP > 8.6 ? AMBER : GREEN; g.fillText(d.dP.toFixed(1), 60, 140);
    g.fillStyle = Math.abs(d.cabVS) > 1800 ? AMBER : GREEN; g.fillText(String(Math.round(d.cabVS / 50) * 50), 210, 140);
    g.fillStyle = d.cabAlt > 9550 ? RED : GREEN; g.fillText(String(Math.round(d.cabAlt / 50) * 50), 380, 140);
    g.font = '16px monospace'; g.fillStyle = GREEN; g.fillText(`LDG ELEV AUTO ${d.ldgElev} FT`, 40, 200);
    g.fillStyle = WHITE; g.fillText('SYS 1', 40, 240); g.fillText('PACK 1', 40, 400); g.fillText('PACK 2', 360, 400); g.fillStyle = d.packs ? GREEN : AMBER; g.fillText(d.packs ? 'ON' : 'OFF', 130, 400); g.fillText(d.packs ? 'ON' : 'OFF', 440, 400);
  } else { // CRUISE
    g.textAlign = 'left'; g.fillStyle = GREEN; g.font = '16px monospace'; g.fillText('ENG', 20, 60);
    g.fillStyle = WHITE; g.fillText('F.USED', 200, 84); g.fillText('OIL', 216, 124); g.fillText('VIB', 216, 164);
    for (let i = 0; i < 2; i++) { const x = 110 + i * 240; g.fillStyle = GREEN; g.textAlign = 'center'; g.fillText(String(Math.round(d.fuelUsed[i] / 10) * 10), x, 84); g.fillText(d.oilQt[i].toFixed(1), x, 124); g.fillText(`${d.vibN1[i].toFixed(1)}  ${d.vibN2[i].toFixed(1)}`, x, 164); }
    g.textAlign = 'left'; g.fillStyle = GREEN; g.fillText('AIR', 20, 220);
    g.fillStyle = WHITE; g.fillText('ΔP', 40, 254); g.fillText('CAB V/S', 200, 254); g.fillText('CAB ALT', 360, 254);
    g.fillStyle = GREEN; g.font = 'bold 20px monospace'; g.fillText(d.dP.toFixed(1), 40, 282); g.fillText(String(Math.round(d.cabVS / 50) * 50), 200, 282); g.fillStyle = d.cabAlt > 9550 ? RED : GREEN; g.fillText(String(Math.round(d.cabAlt / 50) * 50), 360, 282);
    g.fillStyle = WHITE; g.font = '16px monospace'; g.fillText('CKPT', 40, 330); g.fillText('FWD', 180, 330); g.fillText('AFT', 320, 330);
    g.fillStyle = GREEN; g.fillText(`${d.cabinT[0]}°C`, 40, 356); g.fillText(`${d.cabinT[1]}°C`, 180, 356); g.fillText(`${d.cabinT[2]}°C`, 320, 356);
  }
  // permanent data
  g.fillStyle = WHITE; g.fillRect(0, 446, W, 2);
  g.textAlign = 'left'; g.font = '16px monospace';
  g.fillStyle = WHITE; g.fillText('TAT', 10, 470); g.fillText('SAT', 10, 496); g.fillStyle = GREEN; g.fillText(`${d.tat > 0 ? '+' : ''}${Math.round(d.tat)} °C`, 54, 470); g.fillText(`${d.sat > 0 ? '+' : ''}${Math.round(d.sat)} °C`, 54, 496);
  g.textAlign = 'center'; g.fillStyle = GREEN; g.font = 'bold 20px monospace'; g.fillText(d.utc, 256, 482); g.font = '13px monospace'; g.fillText(d.utcSec, 300, 482);
  g.textAlign = 'right'; g.font = '16px monospace'; g.fillStyle = WHITE; g.fillText('GW', 420, 470); g.fillStyle = GREEN; g.fillText(`${Math.round(d.gw / 100) * 100}`, 504, 470);
  g.fillStyle = WHITE; g.fillText('GWCG', 420, 496); g.fillStyle = GREEN; g.fillText(`${d.gwcg.toFixed(1)} %`, 504, 496);
}

// ---------------- MCDU ----------------
export function drawMCDU(g, d, side) {
  const W = 256, H = 256;
  g.fillStyle = '#39424e'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#05070a'; g.fillRect(20, 10, 216, 150);
  g.fillStyle = '#dfe6ee'; for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) g.fillRect(28 + c * 34, 170 + r * 17, 28, 12);
  for (let i = 0; i < 6; i++) { g.fillRect(6, 30 + i * 21, 10, 8); g.fillRect(240, 30 + i * 21, 10, 8); }
  const page = side === 'capt' ? d.mcduCapt : d.mcduFo;
  g.textBaseline = 'middle'; g.font = '10px monospace';
  const line = (i, l, r, col = GREEN, big = true) => { const y = 22 + i * 10.5; g.font = big ? '10px monospace' : '8px monospace'; g.fillStyle = col; g.textAlign = 'left'; if (l) g.fillText(l, 24, y); g.textAlign = 'right'; if (r) g.fillText(r, 232, y); };
  g.fillStyle = WHITE; g.textAlign = 'center'; g.font = 'bold 10px monospace'; g.fillText(page.title, 128, 16);
  page.lines.forEach((ln, i) => line(i + 1, ln[0], ln[1], ln[2] || GREEN, !ln[3]));
  if (page.scratch) { g.fillStyle = WHITE; g.textAlign = 'left'; g.font = '10px monospace'; g.fillText(page.scratch, 24, 152); }
}

// ---------------- standby instrument (ISIS) ----------------
export function drawISIS(g, d) {
  const W = 256, cx = 128, cy = 128;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, W);
  g.save(); g.beginPath(); g.rect(40, 30, 176, 196); g.clip();
  g.translate(cx, cy); g.rotate(-d.bank); g.translate(0, d.pitch / DEG * 3);
  g.fillStyle = '#1f7ad8'; g.fillRect(-300, -500, 600, 500); g.fillStyle = '#8a5a26'; g.fillRect(-300, 0, 600, 500);
  g.strokeStyle = WHITE; g.lineWidth = 1; for (let p = -20; p <= 20; p += 10) { if (!p) continue; g.beginPath(); g.moveTo(-18, -p * 3); g.lineTo(18, -p * 3); g.stroke(); }
  g.restore();
  g.fillStyle = '#222'; g.fillRect(0, 30, 40, 196); g.fillRect(216, 30, 40, 196);
  g.fillStyle = WHITE; g.font = 'bold 16px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(Math.round(d.ias)), 20, cy); g.font = 'bold 13px monospace'; g.fillText(String(Math.round(d.alt / 10) * 10), 236, cy);
  g.strokeStyle = '#ffd400'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - 40, cy); g.lineTo(cx - 12, cy); g.moveTo(cx + 40, cy); g.lineTo(cx + 12, cy); g.stroke();
  g.fillStyle = WHITE; g.font = '12px monospace'; g.fillText(d.std ? 'STD' : `${d.qnh}`, 236, 240); g.fillText(`M.${pad(Math.round(d.mach * 100), 2)}`, 20, 240);
}

// ---------------- clock ----------------
export function drawClock(g, d) {
  g.fillStyle = '#12151a'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#e6e9ee'; g.font = '14px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTC', 128, 18);
  g.fillStyle = '#ff9a3a'; g.font = 'bold 44px monospace'; g.fillText(d.utc, 118, 64); g.font = 'bold 22px monospace'; g.fillText(d.utcSec, 218, 72);
  g.fillStyle = '#e6e9ee'; g.font = '14px Arial'; g.fillText(`ET ${d.et}`, 128, 108);
}

// ---------------- FCU ----------------
export function drawFCU(g, d) {
  const w = 1024, h = 128;
  g.fillStyle = '#39424e'; g.fillRect(0, 0, w, h);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  const win = (x, wd, text, dot) => { g.fillStyle = '#0b0d10'; g.fillRect(x - wd / 2, 14, wd, 44); g.fillStyle = '#ffb347'; g.font = 'bold 32px monospace'; g.fillText(text, x, 38); if (dot) { g.beginPath(); g.arc(x + wd / 2 - 10, 24, 5, 0, 7); g.fill(); } };
  win(290, 120, d.fcuSpd, d.spdManaged); win(430, 120, d.fcuHdg, d.hdgManaged); win(600, 150, d.fcuAlt, d.altManaged); win(770, 130, d.fcuVs, false);
  g.fillStyle = '#dfe6ee'; g.font = 'bold 16px Arial';
  for (const [x, t] of [[290, d.machMode ? 'MACH' : 'SPD'], [430, 'HDG'], [600, 'ALT'], [770, 'V/S']]) g.fillText(t, x, 72);
  // push-buttons with their green mode bars
  const btn = (x, y, t, on) => { g.fillStyle = '#2a3038'; g.fillRect(x - 30, y - 12, 60, 26); g.fillStyle = on ? '#3dff6a' : '#1b2a1f'; g.fillRect(x - 16, y - 10, 32, 4); g.fillStyle = '#dfe6ee'; g.font = 'bold 12px Arial'; g.fillText(t, x, y + 5); };
  btn(360, 102, 'LOC', d.locArmed); btn(460, 102, 'AP1', d.ap1); btn(530, 102, 'AP2', false); btn(600, 102, 'A/THR', d.athr); btn(680, 102, 'EXPED', false); btn(760, 102, 'APPR', d.apprArmed);
  // EFIS panels: baro setting and ND range
  for (const x of [80, 944]) {
    g.fillStyle = '#0b0d10'; g.fillRect(x - 58, 16, 116, 32); g.fillStyle = '#ffb347'; g.font = 'bold 22px monospace'; g.fillText(d.std ? 'Std' : String(d.qnh), x, 33);
    g.fillStyle = '#dfe6ee'; g.font = '12px Arial'; g.fillText(`ARC ${d.range}`, x, 66); g.fillText('FD  LS', x, 88);
    g.fillStyle = d.fd ? '#3dff6a' : '#1b2a1f'; g.fillRect(x - 28, 96, 18, 4); g.fillStyle = d.lsOn ? '#3dff6a' : '#1b2a1f'; g.fillRect(x + 10, 96, 18, 4);
  }
}

// ---------------- overhead panel ----------------
// Each tile is a panel (as laid out on the A320 overhead, simplified): switch captions light as on the
// real aircraft (white ON / OFF, amber FAULT, green AVAIL, blue ON for the anti-ice and APU bleed).
export function drawOverhead(g, d) {
  const W = 1024, H = 1024;
  g.fillStyle = '#4a5563'; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const panel = (x, y, w, h, title) => { g.strokeStyle = '#dfe6ee'; g.lineWidth = 1; g.strokeRect(x, y, w, h); g.fillStyle = '#dfe6ee'; g.font = 'bold 14px Arial'; g.fillText(title, x + w / 2, y + 12); };
  const pb = (x, y, label, top, bot) => {
    // top caption (FAULT/FIRE/AVAIL), bottom caption (ON/OFF), label under
    g.fillStyle = '#1a1e24'; g.fillRect(x - 26, y - 18, 52, 36);
    if (top) { g.fillStyle = top.c; g.font = 'bold 10px Arial'; g.fillText(top.t, x, y - 8); }
    if (bot) { g.fillStyle = bot.c; g.font = 'bold 10px Arial'; g.fillText(bot.t, x, y + 8); }
    g.fillStyle = '#dfe6ee'; g.font = '10px Arial'; g.fillText(label, x, y + 28);
  };
  const sw = (x, y, label, pos, labels) => {
    // three-position toggle drawn from above
    g.fillStyle = '#1a1e24'; g.fillRect(x - 6, y - 20, 12, 40); g.fillStyle = '#c8ccd2'; g.beginPath(); g.arc(x, y + [-14, 0, 14][pos], 7, 0, 7); g.fill();
    g.fillStyle = '#dfe6ee'; g.font = '9px Arial'; labels.forEach((t, i) => { if (t) g.fillText(t, x + 26, y + [-14, 0, 14][i]); }); g.font = '10px Arial'; g.fillText(label, x, y + 32);
  };
  const on = (v) => (v ? { t: 'ON', c: BLUE } : null), off = (v) => (v ? { t: 'OFF', c: WHITE } : null), fault = (v) => (v ? { t: 'FAULT', c: AMBER } : null);
  // row 1: ADIRS, FLT CTL, EVAC, EMER ELEC, GPWS, RCDR, OXYGEN, CALLS
  panel(10, 10, 250, 150, 'ADIRS'); for (let i = 0; i < 3; i++) pb(60 + i * 75, 70, `IR ${i + 1}`, null, { t: 'NAV', c: GREEN });
  panel(270, 10, 180, 150, 'EVAC'); pb(360, 70, 'COMMAND', null, null);
  panel(460, 10, 180, 150, 'GPWS'); pb(510, 70, 'SYS', null, null); pb(590, 70, 'TERR', null, null);
  panel(650, 10, 180, 150, 'OXYGEN'); pb(700, 70, 'CREW SUPPLY', null, null); pb(780, 70, 'PASSENGER', d.masks ? { t: 'SYS ON', c: WHITE } : null, null);
  panel(840, 10, 174, 150, 'RCDR'); pb(927, 70, 'GND CTL', null, on(d.onGround && d.anyEngine));
  // row 2: FIRE
  panel(10, 170, 1004, 150, 'FIRE');
  for (let i = 0; i < 2; i++) { const x = i ? 820 : 200; pb(x, 230, `ENG ${i + 1}`, d.fire[i] ? { t: 'FIRE', c: RED } : null, null); pb(x + 80, 230, 'AGENT 1', d.agentDisch[i] ? { t: 'DISCH', c: AMBER } : null, null); }
  pb(512, 230, 'APU', null, null);
  // row 3: HYD, FUEL, ELEC
  panel(10, 330, 330, 170, 'HYD');
  pb(60, 400, 'ENG 1 PUMP', fault(!d.running[0]), null); pb(140, 400, 'ELEC PUMP', null, null); pb(220, 400, 'PTU', null, null); pb(300, 400, 'ENG 2 PUMP', fault(!d.running[1]), null);
  panel(350, 330, 330, 170, 'FUEL');
  for (const [i, t] of [[0, 'L TK 1'], [1, 'CTR L'], [2, 'CTR R'], [3, 'R TK 2']]) pb(395 + i * 80, 400, t, null, null);
  panel(690, 330, 324, 170, 'ELEC');
  pb(740, 400, 'GEN 1', fault(!d.running[0]), null); pb(820, 400, 'APU GEN', null, null); pb(900, 400, 'GEN 2', fault(!d.running[1]), null); pb(980, 400, 'EXT PWR', d.extPwrAvail ? { t: 'AVAIL', c: GREEN } : null, null);
  // row 4: AIR COND, ANTI ICE, CABIN PRESS
  panel(10, 510, 480, 160, 'AIR COND');
  pb(70, 580, 'PACK 1', null, null); pb(150, 580, 'ENG 1 BLEED', fault(!d.running[0] && !d.starting[0]), null); pb(245, 580, 'APU BLEED', null, on(d.apuBleed)); pb(340, 580, 'ENG 2 BLEED', fault(!d.running[1] && !d.starting[1]), null); pb(430, 580, 'PACK 2', null, null);
  panel(500, 510, 300, 160, 'ANTI ICE');
  pb(560, 580, 'WING', null, on(d.wingAI)); pb(650, 580, 'ENG 1', null, on(d.engAI)); pb(740, 580, 'ENG 2', null, on(d.engAI));
  panel(810, 510, 204, 160, 'CABIN PRESS'); pb(860, 580, 'MODE SEL', null, null); pb(950, 580, 'DITCHING', null, null);
  // row 5: EXT LT, APU, SIGNS
  panel(10, 680, 560, 170, 'EXT LT');
  sw(60, 750, 'STROBE', d.strobe === 'ON' ? 0 : d.strobe === 'AUTO' ? 1 : 2, ['ON', 'AUTO', 'OFF']);
  sw(140, 750, 'BEACON', d.beacon ? 0 : 2, ['ON', '', 'OFF']);
  sw(220, 750, 'WING', 2, ['ON', '', 'OFF']);
  sw(300, 750, 'NAV & LOGO', d.nav ? 0 : 2, ['1', '2', 'OFF']);
  sw(380, 750, 'RWY TURN OFF', d.taxiLt ? 0 : 2, ['ON', '', 'OFF']);
  sw(460, 750, 'LAND', d.landLt ? 0 : 2, ['ON', 'OFF', 'RETRACT']);
  sw(530, 750, 'NOSE', d.noseLt === 'TO' ? 0 : d.noseLt === 'TAXI' ? 1 : 2, ['T.O', 'TAXI', 'OFF']);
  panel(580, 680, 200, 170, 'APU');
  pb(630, 750, 'MASTER SW', null, d.apuMaster ? { t: 'ON', c: BLUE } : null); pb(720, 750, 'START', d.apuAvail ? { t: 'AVAIL', c: GREEN } : null, d.apuStarting ? { t: 'ON', c: BLUE } : null);
  panel(790, 680, 224, 170, 'SIGNS');
  sw(840, 750, 'SEAT BELTS', d.seatBelts ? 0 : 2, ['ON', '', 'OFF']); sw(920, 750, 'NO SMOKING', 0, ['ON', 'AUTO', 'OFF']); sw(990, 750, 'EMER EXIT LT', d.emerLt ? 0 : 1, ['ON', 'ARM', 'OFF']);
  // row 6: ENG MAN START, INT LT, WIPERS
  panel(10, 860, 330, 150, 'ENG MAN START'); pb(100, 920, 'ENG 1', null, null); pb(250, 920, 'ENG 2', null, null);
  panel(350, 860, 330, 150, 'INT LT'); sw(420, 930, 'DOME', d.dome ? 0 : 2, ['BRT', 'DIM', 'OFF']); sw(560, 930, 'ANN LT', 1, ['TEST', 'BRT', 'DIM']);
  panel(690, 860, 324, 150, 'WIPER'); sw(760, 930, 'CAPT', d.wipers ? 0 : 2, ['FAST', 'SLOW', 'OFF']); sw(940, 930, 'F/O', d.wipers ? 0 : 2, ['FAST', 'SLOW', 'OFF']);
}

// ---------------- pedestal ----------------
export function drawPedestal(g, d) {
  const W = 512, H = 1024;
  g.fillStyle = '#39424e'; g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const lab = (t, x, y, s = 13) => { g.fillStyle = '#dfe6ee'; g.font = `bold ${s}px Arial`; g.fillText(t, x, y); };
  // radio management panel: the frequency the crew are on and the next one on standby
  g.fillStyle = '#1c2128'; g.fillRect(20, 20, 472, 110);
  g.fillStyle = '#0b0d10'; g.fillRect(40, 34, 180, 44); g.fillRect(292, 34, 180, 44);
  g.fillStyle = '#ffb347'; g.font = 'bold 28px monospace'; g.fillText(d.rmpActive, 130, 57); g.fillText(d.rmpStby, 382, 57);
  lab('ACTIVE', 130, 94, 11); lab('STBY/CRS', 382, 94, 11); lab(`RMP 1 · ${d.rmpUnit}`, 256, 116, 11);
  // speed brake (left) and flap lever (right) quadrants
  g.fillStyle = '#1c2128'; g.fillRect(20, 150, 150, 260); g.fillRect(342, 150, 150, 260);
  lab('SPEED BRAKE', 95, 166); lab('FLAPS', 417, 166);
  for (const [i, t] of ['0', '1', '2', '3', 'FULL'].entries()) { g.fillStyle = '#dfe6ee'; g.font = '12px Arial'; g.fillText(t, 470, 200 + i * 46); }
  g.fillStyle = '#e8eaee'; g.fillRect(380, 190 + d.flapLever * 46, 60, 18);
  for (const [i, t] of ['RET', '1/2', 'FULL'].entries()) { g.fillStyle = '#dfe6ee'; g.font = '12px Arial'; g.fillText(t, 150, 200 + i * 90); }
  g.fillStyle = '#9aa0a8'; g.fillRect(40, 190 + (d.spoilersArmed ? -14 : 0) + d.speedbrake * 180, 70, 18); if (d.spoilersArmed) lab('ARM', 75, 184, 11);
  // thrust levers' detents
  g.fillStyle = '#1c2128'; g.fillRect(180, 150, 152, 260); lab('THRUST', 256, 166);
  for (const [t, v] of [['TOGA', 1], ['FLX MCT', 0.8], ['CL', 0.6], ['0', 0], ['REV', -1]]) { const y = 390 - (v + 1) * 100; g.fillStyle = '#dfe6ee'; g.font = '11px Arial'; g.fillText(t, 256, y); }
  for (let i = 0; i < 2; i++) { const y = 390 - (d.thr[i] + 1) * 100; g.fillStyle = '#c8ccd2'; g.fillRect(i ? 262 : 196, y - 8, 54, 16); }
  // engine master switches and the ENG MODE selector
  g.fillStyle = '#1c2128'; g.fillRect(20, 430, 472, 150); lab('ENG', 256, 446);
  for (let i = 0; i < 2; i++) {
    const x = i ? 336 : 176; lab(`${i + 1}`, x, 466);
    g.fillStyle = '#0b0d10'; g.fillRect(x - 16, 478, 32, 60);
    g.fillStyle = '#d0d4da'; g.fillRect(x - 12, d.masters[i] ? 482 : 512, 24, 22);
    lab(d.masters[i] ? 'ON' : 'OFF', x + 44, 508, 11);
    if (d.fire[i] || d.startFault[i]) { g.fillStyle = d.fire[i] ? RED : AMBER; g.font = 'bold 11px Arial'; g.fillText(d.fire[i] ? 'FIRE' : 'FAULT', x, 552); }
  }
  { const x = 256, y = 520, a = { CRANK: -0.8, NORM: 0, 'IGN/START': 0.8 }[d.engMode] ?? 0; g.fillStyle = '#0b0d10'; g.beginPath(); g.arc(x, y, 26, 0, 7); g.fill(); g.strokeStyle = '#e8eaee'; g.lineWidth = 6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * 22, y - Math.cos(a) * 22); g.stroke(); g.lineWidth = 1;
    lab('CRANK', x - 42, y - 30, 10); lab('NORM', x, y - 36, 10); lab('IGN/START', x + 46, y - 30, 10); lab('MODE', x, y + 40, 11); }
  // pitch trim wheels with the THS position, rudder trim
  g.fillStyle = '#1c2128'; g.fillRect(20, 600, 472, 120); lab('PITCH TRIM', 256, 616);
  g.fillStyle = '#dfe6ee'; g.font = 'bold 20px monospace'; g.fillText(`${Math.abs(d.ths / DEG).toFixed(1)} ${d.ths >= 0 ? 'UP' : 'DN'}`, 256, 660);
  lab('RUD TRIM', 256, 690); g.font = 'bold 16px monospace'; g.fillText(`${d.rudTrim >= 0 ? 'R' : 'L'} ${Math.abs(d.rudTrim).toFixed(1)}`, 256, 708);
  // parking brake and the transponder, weather radar
  g.fillStyle = '#1c2128'; g.fillRect(20, 740, 230, 130); lab('PARK BRK', 135, 756);
  { const a = d.parkBrake ? Math.PI / 2 : 0; g.strokeStyle = '#e8eaee'; g.lineWidth = 12; g.beginPath(); g.moveTo(135, 810); g.lineTo(135 + Math.cos(a) * 60, 810 - Math.sin(a) * 60 + (d.parkBrake ? 0 : 0)); g.stroke(); g.lineWidth = 1; lab(d.parkBrake ? 'ON' : 'OFF', 135, 850); }
  g.fillStyle = '#1c2128'; g.fillRect(262, 740, 230, 130); lab('ATC / TCAS', 377, 756);
  g.fillStyle = '#0b0d10'; g.fillRect(302, 772, 150, 40); g.fillStyle = '#ffb347'; g.font = 'bold 26px monospace'; g.fillText(d.squawk, 377, 793);
  lab(`XPDR ${d.xpdrMode} · TCAS ${d.tcasMode}`, 377, 836, 11);
  g.fillStyle = '#1c2128'; g.fillRect(20, 890, 472, 110); lab('WX RADAR', 256, 906); lab(d.wxrOn ? 'SYS 1 · WX · TILT -1.5' : 'OFF', 256, 950, 12);
}
