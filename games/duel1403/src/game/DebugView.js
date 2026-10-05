import { Vector3 } from 'three';

/**
 * Developer view of the fight (F1, or ?dev=1).
 *
 *   F1        toggle                P        pause / resume
 *   .         step one frame        ,        slow motion 1 -> 1/2 -> 1/4 -> 1/10
 *   B         colliders on/off      X        x-ray (show lines through bodies)
 *   M         measure rings         T        blade trails
 *
 * Draws through the Med Engine's DebugDraw pass and lays text over the
 * canvas; reads the simulation, never writes to it.
 */
const MAT_COLOR = {
  plate: [0.85, 0.88, 0.95, 0.9], mail: [0.55, 0.62, 0.7, 0.9], pad: [0.95, 0.6, 0.25, 0.9], gambeson: [0.95, 0.6, 0.25, 0.9],
  leather: [0.7, 0.45, 0.25, 0.9], cloth: [0.9, 0.85, 0.5, 0.9], skin: [0.95, 0.4, 0.4, 0.9], sole: [0.5, 0.4, 0.3, 0.9],
};
const PART_COLOR = { blade: [0.3, 0.95, 1, 1], haft: [0.8, 0.6, 0.3, 1], cross: [0.9, 0.9, 0.3, 1], pommel: [0.9, 0.9, 0.3, 1], buckler: [0.9, 0.8, 0.5, 1] };
const SPEEDS = [1, 0.5, 0.25, 0.1];
const _v = new Vector3(), _w = new Vector3();

export class DebugView {
  constructor({ stage, getSim, getAis, getPlayer }) {
    this.stage = stage;
    this.dd = stage.r?.pass?.('debugdraw') ?? null;
    this.getSim = getSim; this.getAis = getAis; this.getPlayer = getPlayer;
    this.on = !!new URLSearchParams(location.search).get('dev');
    this.paused = false;
    this.stepOnce = false;
    this.speedIx = 0;
    this.show = { colliders: true, measure: true, trails: true };
    this.trails = [[], []];
    this.markers = [];
    this.lastHit = null;
    this.el = document.createElement('div');
    this.el.className = 'dev-overlay';
    this.panel = document.createElement('div');
    this.panel.className = 'dev-panel';
    document.body.append(this.el, this.panel);
    this._sync();
    window.addEventListener('keydown', (e) => this._key(e));
  }

  get timeScale() { return this.on ? SPEEDS[this.speedIx] : 1; }

  /** Should the simulation advance this frame? */
  shouldStep() {
    if (!this.on || !this.paused) return true;
    if (this.stepOnce) { this.stepOnce = false; return true; }
    return false;
  }

  _key(e) {
    if (e.key === 'F1') { e.preventDefault(); this.on = !this.on; this._sync(); return; }
    if (!this.on || e.target.closest?.('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'p') this.paused = !this.paused;
    else if (k === '.') { this.paused = true; this.stepOnce = true; }
    else if (k === ',') this.speedIx = (this.speedIx + 1) % SPEEDS.length;
    else if (k === 'b') this.show.colliders = !this.show.colliders;
    else if (k === 'x' && this.dd) this.dd.xray = !this.dd.xray;
    else if (k === 'm') this.show.measure = !this.show.measure;
    else if (k === 't') this.show.trails = !this.show.trails;
    else return;
    e.preventDefault();
  }

  _sync() {
    this.el.hidden = !this.on;
    this.panel.hidden = !this.on;
  }

  /** Damage events feed the markers and the hit inspector. */
  onDamage(e) {
    if (!e.point) return;
    const col = e.type === 'hit' ? (e.wound ? [1, 0.2, 0.15, 1] : [1, 0.85, 0.2, 1]) : e.type === 'parry' ? [0.3, 0.7, 1, 1] : [0.8, 0.8, 0.8, 1];
    this.markers.push({ p: e.point.clone(), t: 1.6, col, text: `${e.type === 'hit' ? e.kind : e.type} ${Math.round(e.energy ?? 0)} J` });
    if (e.type === 'hit') this.lastHit = e;
  }

  /** Called every rendered frame (dt = wall time). */
  update(dt) {
    if (!this.on || !this.dd) { this.el.textContent = ''; return; }
    const sim = this.getSim();
    if (!sim) return;
    const dd = this.dd;
    sim.knights.forEach((k, i) => this._knight(dd, k, i));
    // hit markers
    this.markers = this.markers.filter((m) => (m.t -= dt) > 0);
    for (const m of this.markers) {
      dd.cross(m.p, 0.05 + 0.05 * m.t, m.col);
      dd.label(m.p.clone().add(_v.set(0, 0.08, 0)), m.text, `rgb(${m.col.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})`);
    }
    this._labels(dd);
    this._panel(sim);
  }

  _knight(dd, k, i) {
    const tint = i === 0 ? [0.4, 1, 0.5, 1] : [1, 0.5, 0.4, 1];
    if (this.show.colliders) {
      for (const b of k.ragdoll.list) for (const s of b.shapes) this._shape(dd, s, MAT_COLOR[s.userData.mat] ?? MAT_COLOR.skin);
      const W = k.weapon;
      for (const s of W.body.shapes) this._shape(dd, s, PART_COLOR[s.userData.weaponPart ?? s.userData.part] ?? [0.9, 0.9, 0.9, 1]);
      if (W.offhand?.body) for (const s of W.offhand.body.shapes) this._shape(dd, s, PART_COLOR.buckler);
    }
    // blade trail coloured by speed (blue slow -> red > 15 m/s)
    const tip = k.weapon.worldPoint(k.weapon.tipY, new Vector3());
    const tr = this.trails[i];
    tr.push({ p: tip, v: k.weapon.body.velocityAt(tip, new Vector3()).length() });
    if (tr.length > 40) tr.shift();
    if (this.show.trails) for (let j = 1; j < tr.length; j++) {
      const s = Math.min(1, tr[j].v / 15);
      dd.line(tr[j - 1].p, tr[j].p, [s, 0.4 * (1 - s), 1 - s, 0.4 + 0.6 * j / tr.length]);
    }
    // commanded hand target and the blow's aim
    const hand = k.ff(k.cmd.hand.x, k.cmd.hand.y, k.cmd.hand.z, new Vector3());
    dd.cross(hand, 0.04, tint);
    if (k.attack?.spec?.target) {
      dd.cross(k.attack.spec.target, 0.08, [1, 1, 0.2, 1]);
      dd.line(hand, k.attack.spec.target, [1, 1, 0.2, 0.35]);
    }
    if (this.show.measure) {
      const ai = this.getAis().find((a) => a.k === k);
      const W = k.weapon;
      const reach = 0.75 * k.scale + (W.tipY - (W.gripY.R ?? W.grips.main)) + 0.15;
      const c = _v.set(k.center.x, 0.02, k.center.z).clone();
      dd.circle(c, reach, _w.set(0, 1, 0), [...tint.slice(0, 3), 0.55], 48);
      dd.circle(c, reach + 0.8 * k.scale, _w.set(0, 1, 0), [...tint.slice(0, 3), 0.22], 48);
      // balance: target pelvis position vs actual, feet
      dd.cross(k.assist.targetPos, 0.05, [1, 0.3, 1, 1]);
      dd.line(k.assist.targetPos, k.b.pelvis.pos, [1, 0.3, 1, 0.6]);
      for (const s of ['L', 'R']) dd.cross(k.feet[s].pos, 0.06, k.feet[s].planted ? [0.6, 1, 0.6, 1] : [1, 1, 1, 0.5]);
      void ai;
    }
    // state label above the head
    const ai = this.getAis().find((a) => a.k === k);
    const parts = [
      `${k.name.split(' ')[0]} · ${k.state}${k.attack ? ' · ' + k.attack.name + '/' + k.attack.phase : k.parrying ? ' · parry' : ''}`,
      `guard ${k.guard?.name ?? k.guard?.id ?? '-'} · stamina ${k.stamina.toFixed(0)} · blood ${k.blood.toFixed(2)} l · stun ${k.stun.toFixed(2)}`,
    ];
    if (ai) parts.push(`AI ${ai.styleId} · ${ai.response ?? 'watch'} · cooldown ${Math.max(0, ai.attackCooldown).toFixed(2)}`);
    dd.label(k.b.head.pos.clone().add(_v.set(0, 0.45, 0)), parts.join('\n'), i === 0 ? '#9f9' : '#f99');
  }

  _shape(dd, s, col) {
    s.updateWorld();
    if (s.type === 'sphere') dd.sphere(s.wCenter, s.radius, col);
    else if (s.type === 'capsule') dd.capsule(s.wA, s.wB, s.radius, col);
    else if (s.type === 'box') dd.box(s.wCenter, s.halfExtents, s.body.q, col);
  }

  _labels(dd) {
    const cam = this.stage.camera;
    const W = innerWidth, H = innerHeight;
    const html = [];
    for (const l of dd.labels) {
      const p = l.p.clone().project(cam);
      if (p.z > 1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2) continue;
      const x = (p.x * 0.5 + 0.5) * W, y = (0.5 - p.y * 0.5) * H;
      html.push(`<div class="dev-label" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;color:${l.color}">${esc(l.text)}</div>`);
    }
    this.el.innerHTML = html.join('');
  }

  _panel(sim) {
    const p = this.getPlayer(), h = this.lastHit;
    const o = sim.knights.find((k) => k !== p) ?? sim.b;
    const d = sim.a.center.distanceTo(sim.b.center);
    const rows = [
      `<b>DEBUG</b> t=${sim.time.toFixed(2)} s · ${this.paused ? 'PAUSED' : `x${SPEEDS[this.speedIx]}`} · distance ${d.toFixed(2)} m`,
      `<span class="dim">F1 off · P pause · . step · , slow · B colliders · X x-ray · M measure · T trails</span>`,
    ];
    if (h) {
      rows.push(`<b>last hit</b> ${esc(h.attacker?.name ?? '?')} → ${esc(h.defender?.name ?? '?')}: ${esc(h.blow)} (${h.kind}) at ${esc(h.side ? h.side + ' ' : '')}${esc(h.zoneName ?? h.zone)}`);
      rows.push(`energy ${h.energy.toFixed(1)} J · speed ${h.speed.toFixed(1)} m/s · through edge ${h.sharp.toFixed(1)} J · blunt ${h.blunt.toFixed(1)} J`);
      if (h.layers?.length) rows.push('through: ' + h.layers.map(esc).join(' → ') + (h.stopItem ? ` · stopped by ${esc(h.stopItem)}` : '') + (h.glanced ? ' · glanced' : ''));
      rows.push(`severity ${h.severity.toFixed(2)}${h.wound ? ` · bleeding ${h.wound.bleed.toFixed(2)} l/min${h.wound.arterial ? ' (artery)' : ''}` : ''}${h.concussion ? ` · concussion ${h.concussion.toFixed(2)}` : ''}${h.fatal ? ' · FATAL' : ''}`);
    }
    if (p && o) rows.push(`you ${p.state} · ${p.weapon.def.name} · foe ${o.state} · wounds ${o.wounds.length}`);
    this.panel.innerHTML = rows.join('<br>');
  }
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
