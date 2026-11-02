/**
 * The screen: what you look at and what your tool reads, the tool belt, the workshop's clock and
 * till, the job card, and the panels: the conversation at the counter (and on the phone), the
 * estimate, the parts shelf, the scan tool, the invoice, settings (how Claude is reached) and help.
 */
import { TOOLS, SOCKETS } from '../world/tools.js';
import { RATE } from '../game.js';
import { MODELS } from '../ai/brain.js';
import { CARS } from '../data/cars.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sek = (n) => `${Math.round(n).toLocaleString('sv-SE')} kr`;
const SYS = { wheel: 'Wheels and tyres', brake: 'Brakes', susp: 'Suspension', steer: 'Steering', drive: 'Drive', ignition: 'Ignition', air: 'Air intake', oil: 'Oil', cool: 'Cooling', charge: 'Charging', elec: 'Electrics', light: 'Lights', exhaust: 'Exhaust', body: 'Body', aero: 'Aerodynamics', interior: 'Interior', fuel: 'Fuel', ers: 'ERS' };

export class HUD {
  constructor(root, game) {
    this.g = game; this.root = root;
    this.top = el('div', 'top'); root.append(this.top);
    this.cross = el('div', 'crosshair'); root.append(this.cross);
    this.tip = el('div', 'tip'); root.append(this.tip);
    this.belt = el('div', 'belt'); root.append(this.belt);
    this.logEl = el('div', 'log'); root.append(this.logEl);
    this.card = el('div', 'card'); root.append(this.card);
    this.panel = el('div', 'panel hidden'); root.append(this.panel);
    this._belt();
    game.onSay = () => this._log();
    game.onLine = (c, who, text) => { if (this.chatOpen) this._chatLine(who, text); };
    game.onCounter = () => this.openChat();
    game.onShelf = (only) => this.openShelf(only);
    game.onScanner = () => this.openScanner();
    game.onToolbox = () => this.openToolbox();
    game.onCustomer = () => { this._card(); if (!game.manual) this._toast(`${game.cust.name} is at the counter. Go and talk to them (E).`); };
    addEventListener('keydown', (e) => this._key(e));
    this._cardT = 0;
  }

  // ---- keys -----------------------------------------------------------------------------------
  _key(e) {
    const g = this.g;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') { if (e.key === 'Escape') this.close(); return; }
    const t = TOOLS.find((x) => x.key === e.key);
    if (t) { g.selectTool(t.id); this._belt(); return; }
    if (e.code === 'KeyR') { g.dir = -g.dir; this._belt(); g.say(g.dir < 0 ? 'Undoing (anticlockwise).' : 'Doing up (clockwise).'); }
    if (e.code === 'KeyQ') g._drop(g.player.target?.point);
    if (e.code === 'KeyE') { if (this.panelOpen) this.close(); else this.openChat(); }
    if (e.code === 'KeyT') this.openToolbox();
    if (e.code === 'KeyH') this.openHelp();
    if (e.code === 'KeyB') { g.cust.A.state.brakePedal = g.cust.A.state.brakePedal ? 0 : 1; g.say(g.cust.A.state.brakePedal ? 'A brick on the brake pedal: the wheels are held.' : 'Brake pedal released.'); }
    if (e.code === 'KeyG') { g.throttle = g.throttle ? 0 : 0.35; g.say(g.throttle ? 'Revving it (35 % throttle).' : 'Off the throttle.'); }
    if (e.key === 'Escape') this.close();
  }

  // ---- the panels -------------------------------------------------------------------------------
  _open(html, cls = '') {
    this.panel.className = `panel ${cls}`; this.panel.innerHTML = html; this.panelOpen = true; this.g.uiOpen = true;
    document.exitPointerLock?.();
    const x = el('button', 'x', '×'); x.onclick = () => this.close(); this.panel.prepend(x);
  }
  close() { this.panel.className = 'panel hidden'; this.panelOpen = false; this.chatOpen = false; this.g.uiOpen = false; this.g.chatting = false; clearInterval(this._scanT); }

  openChat() {
    const g = this.g, c = g.cust; if (!c) return;
    this.chatOpen = true; g.chatting = true;
    this._open(`<h2>${esc(c.name)} <small>${esc(c.profile.age)} · ${esc(c.profile.occupation)}</small></h2>
      <div class="chat"></div>
      <div class="row"><input class="say" placeholder="Say something (Enter)…" maxlength="400"><button class="send">Say</button></div>
      <div class="row btns"><button class="est">Write an estimate…</button><button class="phone">Ask to approve extra work…</button><button class="show">Show what you found</button><button class="hand">Hand the car back…</button></div>
      <div class="note">${g.brain.status === 'artifact' ? 'Played by Claude (your claude.ai account)' : g.brain.online ? `Played by ${esc(g.brain.model)}` : 'Offline customer (connect Claude in Settings for real conversations)'}</div>`, 'chatpanel');
    const box = this.panel.querySelector('.chat');
    for (const h of c.history) box.append(this._lineEl(h.who, h.text));
    box.scrollTop = 1e9;
    const input = this.panel.querySelector('.say');
    const send = async () => { const t = input.value.trim(); if (!t || this.busy) return; input.value = ''; this.busy = true; this._typing(true); await c.talk(g.brain, t); this._typing(false); this.busy = false; };
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); e.stopPropagation(); };
    this.panel.querySelector('.send').onclick = send;
    this.panel.querySelector('.est').onclick = () => this.openEstimate('estimate');
    this.panel.querySelector('.phone').onclick = () => this.openEstimate('extra');
    this.panel.querySelector('.show').onclick = async () => { if (this.busy) return; const f = g.findings.slice(-6); if (!f.length) return g.say('You have not found anything to show yet: measure, look, listen.'); this.busy = true; this._typing(true); c.say('event', `The mechanic shows you what they found: ${f.join('; ')}.`); try { const r = g.brain.online ? await g.brain.reply(c) : 'I see. So that is what it was?'; c.say('customer', r); } catch (e) { c.say('customer', `(${e.message})`); } this._typing(false); this.busy = false; };
    this.panel.querySelector('.hand').onclick = () => this.openInvoice();
    setTimeout(() => input.focus(), 30);
  }
  _lineEl(who, text) { return el('div', `line ${who}`, who === 'event' ? `<i>${esc(text)}</i>` : `<b>${who === 'customer' ? esc(this.g.cust.firstName) : 'You'}:</b> ${esc(text)}`); }
  _chatLine(who, text) { const box = this.panel.querySelector('.chat'); if (!box) return; box.append(this._lineEl(who, text)); box.scrollTop = 1e9; }
  _typing(on) { const box = this.panel.querySelector('.chat'); if (!box) return; box.querySelector('.typing')?.remove(); if (on) { box.append(el('div', 'line typing', '…')); box.scrollTop = 1e9; } }

  /** The estimate (or extra work on the phone): lines of labour and parts. */
  openEstimate(kind) {
    const g = this.g, c = g.cust, A = c.A;
    const parts = [...A.parts.values()].filter((p) => !p.fixed && p.price > 0).sort((a, b) => a.sys.localeCompare(b.sys) || a.name.localeCompare(b.name));
    this.est = [{ text: 'Labour', sek: RATE, hours: 1 }];
    this._open(`<h2>${kind === 'estimate' ? 'Estimate' : 'Extra work (phone call)'} <small>${esc(c.name)} · ${esc(c.plate)}</small></h2>
      <p class="note">Labour ${RATE} kr/h incl. VAT. ${kind === 'estimate' ? 'Under konsumenttjänstlagen you may not charge more than about 15 % over this without asking.' : 'Explain on the phone what you found and what it costs on top.'}</p>
      <div class="lines"></div>
      <div class="row"><select class="addpart"><option value="">+ add a part…</option>${parts.map((p) => `<option value="${p.id}">${esc(p.name)} — ${sek(p.price)}</option>`).join('')}</select><button class="addlab">+ ½ h labour</button></div>
      <div class="row total"></div>
      <div class="row btns"><button class="go primary">${kind === 'estimate' ? 'Give it to them' : 'Phone and ask'}</button></div>`, 'estpanel');
    const draw = () => {
      const box = this.panel.querySelector('.lines'); box.innerHTML = '';
      this.est.forEach((l, i) => { const r = el('div', 'row line', `<input class="t" value="${esc(l.text)}"><input class="s" type="number" value="${l.sek}"><button>×</button>`); r.querySelector('.t').oninput = (e) => (l.text = e.target.value); r.querySelector('.s').oninput = (e) => { l.sek = Number(e.target.value) || 0; total(); }; r.querySelector('button').onclick = () => { this.est.splice(i, 1); draw(); }; box.append(r); });
      total();
    };
    const total = () => { this.panel.querySelector('.total').innerHTML = `<b>Total ${sek(this.est.reduce((s, l) => s + l.sek, 0))}</b>`; };
    this.panel.querySelector('.addpart').onchange = (e) => { const p = A.part(e.target.value); if (p) this.est.push({ text: p.name, sek: p.price }); e.target.value = ''; draw(); };
    this.panel.querySelector('.addlab').onclick = () => { const l = this.est.find((x) => x.text === 'Labour'); if (l) l.sek += RATE / 2; else this.est.push({ text: 'Labour', sek: RATE / 2 }); draw(); };
    this.panel.querySelector('.go').onclick = async () => {
      const lines = this.est.map((l) => ({ text: l.text, sek: Math.round(l.sek) })), tot = lines.reduce((s, l) => s + l.sek, 0);
      this.openChat(); this.busy = true; this._typing(true);
      const d = await c.propose(g.brain, kind, lines, tot);
      this._typing(false); this.busy = false;
      g.say(d.accept ? `${c.firstName} agrees: ${sek(tot)}.` : `${c.firstName} says no.`, 'Counter');
      if (d.accept && c.startedWork == null) c.startedWork = g.clock;
      this._card();
    };
    draw();
  }

  /** The invoice: the new parts you fitted, the hours by the clock; what you tell them you did. */
  openInvoice() {
    const g = this.g, c = g.cust, A = c.A;
    const fitted = [...A.parts.values()].filter((p) => p.installedNew);
    const lines = [...fitted.map((p) => ({ text: p.name, sek: p.price })), { text: `Labour ${g.labourHours().toFixed(1)} h`, sek: Math.round(g.labourHours() * RATE) }];
    if ((A.part('engine')?.cond.oilAge ?? 9e9) < 500) lines.unshift({ text: `Engine oil ${A.spec.engine.oil.grade}, ${A.spec.engine.oil.capacity} l`, sek: Math.round(A.spec.engine.oil.capacity * 189) });
    const missing = A.audit().missing.filter((id) => !A.part(id).fixed).map((id) => A.part(id).name);
    this.inv = lines;
    const said = [...g.findings.slice(-8), ...fitted.map((p) => `Replaced: ${p.name}`)].join('. ');
    this._open(`<h2>Invoice <small>${esc(c.name)} · ${esc(c.plate)}</small></h2>
      ${missing.length ? `<p class="warn">Still off the car: ${missing.map(esc).join(', ')}. They will notice.</p>` : ''}
      <div class="lines"></div>
      <div class="row total"></div>
      <label>What you tell them you did</label><textarea class="done" rows="4">${esc(said)}</textarea>
      <div class="row btns"><button class="go primary">Hand over the keys</button></div>`, 'estpanel');
    const draw = () => { const box = this.panel.querySelector('.lines'); box.innerHTML = ''; this.inv.forEach((l) => { const r = el('div', 'row line', `<input class="t" value="${esc(l.text)}"><input class="s" type="number" value="${l.sek}">`); r.querySelector('.t').oninput = (e) => (l.text = e.target.value); r.querySelector('.s').oninput = (e) => { l.sek = Number(e.target.value) || 0; this.panel.querySelector('.total').innerHTML = `<b>Total ${sek(this.inv.reduce((s, x) => s + x.sek, 0))}</b>`; }; box.append(r); }); this.panel.querySelector('.total').innerHTML = `<b>Total ${sek(this.inv.reduce((s, x) => s + x.sek, 0))}</b>`; };
    draw();
    this.panel.querySelector('.go').onclick = async () => {
      const done = this.panel.querySelector('.done').value;
      this.openChat(); this.busy = true; this._typing(true);
      const v = await g.handOver(this.inv.map((l) => ({ text: l.text, sek: Math.round(l.sek) })), done);
      this._typing(false); this.busy = false;
      this._chatLine('event', `Paid ${sek(v.pays_sek)} · ${'★'.repeat(v.stars)}${'☆'.repeat(5 - v.stars)} · “${v.review}”`);
    };
  }

  openShelf(only = null) {
    const g = this.g, c = g.cust, A = c.A;
    const parts = [...A.parts.values()].filter((p) => !p.fixed && p.price > 0 && p.spare && (!only || p.kind === only));
    const by = {};
    for (const p of parts) (by[p.sys] ??= []).push(p);
    this._open(`<h2>Parts for the ${esc(c.spec.make)} ${esc(c.spec.model)} <small>trade price 62 % of retail · you have ${sek(g.money)}</small></h2>
      <div class="shelf">${Object.entries(by).map(([s, ps]) => `<h3>${SYS[s] ?? s}</h3>${ps.map((p) => `<div class="row part"><span>${esc(p.name)}${p.partNo && !/^[A-Z]{2}-\d/.test(p.partNo) ? ` <small>${esc(p.partNo)}</small>` : ''}</span><span>${sek(p.price)}</span><button data-id="${p.id}"${p.removed ? '' : ' class="dim"'}>Take</button></div>`).join('')}`).join('')}</div>`, 'shelfpanel');
    this.panel.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => { g.takeNew(b.dataset.id); this.close(); }));
  }

  openScanner() {
    const g = this.g, S = g.cust.S;
    const draw = () => {
      const r = S.scan();
      if (r.error) { this.panel.querySelector('.scan').innerHTML = `<p class="warn">${esc(r.error)}</p>`; return; }
      this.panel.querySelector('.scan').innerHTML = `<h3>Fault memory</h3>${r.codes.length ? r.codes.map((d) => `<div class="code"><b>${d.code}</b> ${esc(d.text)} <small>${d.status}, seen ${d.count}×</small></div>`).join('') : '<div class="code">No faults stored</div>'}
        <h3>Live data</h3><table>${Object.entries(r.live).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>${r.epb ? `<h3>Electric parking brake</h3><div>${esc(r.epb)}</div>` : ''}`;
    };
    this._open(`<h2>Scan tool <small>OBD-II · ${esc(g.cust.spec.model)}</small></h2><div class="scan"></div>
      <div class="row btns"><button class="clr">Clear fault memory</button>${g.cust.spec.brakes.epb ? '<button class="epb">EPB service mode on / off</button>' : ''}</div>`, 'scanpanel');
    draw();
    this.panel.querySelector('.clr').onclick = () => { S.clearCodes(); g.say('Fault memory cleared.'); draw(); };
    const epb = this.panel.querySelector('.epb');
    if (epb) epb.onclick = () => { const on = !g.cust.A.state.epbService; S.setEpbService(on); g.say(on ? 'Whirr: both rear parking brake motors wind the pistons back. Service mode.' : 'Service mode off: the parking brake is applied again.'); draw(); };
    this._scanT = setInterval(draw, 500);
  }

  openToolbox() {
    const g = this.g;
    this._open(`<h2>Roll cab <small>pick a tool (number keys for the first ten)</small></h2><div class="tools">${TOOLS.map((t) => `<button data-id="${t.id}" class="${g.tool.id === t.id ? 'sel' : ''}"><span>${t.icon}</span>${esc(t.name)}${t.key ? ` <small>${t.key}</small>` : ''}</button>`).join('')}</div>`, 'toolpanel');
    this.panel.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => { g.selectTool(b.dataset.id); this._belt(); this.close(); }));
  }

  openSettings() {
    const g = this.g, B = g.brain;
    this._open(`<h2>Settings</h2>
      <label>Customers</label><select class="mode"><option value="auto">Automatic (dev proxy, else my key, else offline)</option><option value="key">Claude with my API key</option><option value="offline">Offline customers (no AI)</option></select>
      <label>Anthropic API key <small>(kept only in this browser; sent only to api.anthropic.com)</small></label><input class="key" type="password" placeholder="sk-ant-…" value="${esc(B.key)}">
      <label>Model</label><select class="model">${MODELS.map((m) => `<option value="${m.id}"${B.model === m.id ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <label>Picture quality</label><select class="q">${['low', 'medium', 'high', 'ultra'].map((q) => `<option${g.stage.quality === q ? ' selected' : ''}>${q}</option>`).join('')}</select>
      <p class="note">Now: ${B.status === 'artifact' ? 'Claude on your claude.ai account' : B.status === 'proxy' ? 'Claude through the dev server' : B.status === 'key' ? 'Claude with your key' : 'offline'} · ${B.usage.calls} calls, ${B.usage.input + B.usage.output} tokens (${B.usage.cached} read from cache)${B.lastError ? ` · last error: ${esc(B.lastError)}` : ''}</p>
      <div class="row btns"><button class="go primary">Save</button></div>`, 'setpanel');
    this.panel.querySelector('.mode').value = B.mode;
    this.panel.querySelector('.go').onclick = async () => {
      B.mode = this.panel.querySelector('.mode').value; B.key = this.panel.querySelector('.key').value.trim(); B.model = this.panel.querySelector('.model').value; B.save();
      const q = this.panel.querySelector('.q').value; if (q !== g.stage.quality) g.stage.setQuality(q);
      await B.probe(); g.say(B.online ? `Customers: ${B.model}.` : 'Customers: offline.', 'Workshop'); this.close();
    };
  }

  openHelp() {
    this._open(`<h2>Verkstan <small>how to work</small></h2><div class="help">
      <p><b>Move</b> W A S D (Shift hurries) · <b>look</b> mouse (click the view to hold it, Esc to let go) · <b>C</b> crouch / lie on the creeper / stand.</p>
      <p><b>Hands</b> left button on what you look at. Take parts off and put them back (aim at where they go), open doors, bonnet (pull the release lever inside first), boot. <b>Q</b> puts down what you hold. Old parts go in the scrap bin.</p>
      <p><b>Tools</b> 1–0, or <b>T</b> for the roll cab. The mouse wheel changes socket size; Shift + wheel sets the torque wrench. <b>R</b> switches undo / do up. Hold the button and drag to turn a spanner; power tools turn while held. A wheel in the air turns with its nut: <b>B</b> puts a brick on the brake pedal.</p>
      <p><b>The lift</b> swing each of the four arms under its jacking point (click them), then hold the button on the control box (left: up, right: down). With fewer than four arms under it, the car will come off.</p>
      <p><b>The engine</b> key in the ignition (driver's door open): click to I, II, then click and hold to crank. <b>G</b> revs it. Listen: a missing beat is a dead cylinder.</p>
      <p><b>The customer</b> <b>E</b> at any time: talk, give an estimate, phone about extra work, show what you found, hand the car back and invoice. Labour is by the workshop clock (${RATE} kr/h).</p>
      <p><b>Measure</b> tread gauge, tyre gauge (hold to inflate, right button to let out), micrometer on discs, vernier on pads, feeler gauge on plugs, multimeter, scan tool (OBD socket under the dash), the Volvo's blink codes (diagnostic lead on the box in the engine bay; wheel switches socket 2/6), stethoscope, pry bar for play.</p></div>`, 'helppanel');
  }

  _toast(text) { const t = el('div', 'toast', esc(text)); this.root.append(t); setTimeout(() => t.remove(), 6000); }

  // ---- each frame ------------------------------------------------------------------------------
  _belt() {
    const g = this.g;
    this.belt.innerHTML = TOOLS.slice(0, 10).map((t) => `<div class="slot${g.tool.id === t.id ? ' sel' : ''}"><span>${t.icon}</span><small>${t.key}</small></div>`).join('') +
      `<div class="toolname">${g.tool.name}${g.tool.socket ? ` · <b>${g.socket} mm</b>` : ''}${g.tool.setting ? ` · set <b>${g.torqueSet} N·m</b>` : ''}${g.tool.socket || g.tool.id === 'driver' || g.tool.id === 'filter' ? ` · ${g.dir < 0 ? '↺ undo' : '↻ do up'} (R)` : ''}${g.tool.id === 'diaglead' ? ` · socket ${g.diagSocket}` : ''}</div>`;
  }

  _log() {
    const now = performance.now();
    this.logEl.innerHTML = this.g.log.slice(-6).map((l) => `<div style="opacity:${Math.max(0.25, 1 - (now - l.t) / 20000)}"><b>${esc(l.who)}:</b> ${esc(l.text)}</div>`).join('');
  }

  _card() {
    const g = this.g, c = g.cust; if (!c) return;
    const S = c.S;
    this.card.innerHTML = `<div class="ttl">${esc(c.name)} <small>${esc(c.plate)}</small></div>
      <div>${esc(c.spec.year)} ${esc(c.spec.make)} ${esc(c.spec.model)} · ${Number(c.profile.mileage_km).toLocaleString('sv-SE')} km</div>
      <div class="q">“${esc(c.profile.opening)}”</div>
      <div>${c.estimate ? `Agreed: ${sek(c.estimate.total)}${c.approved ? ` + ${sek(c.approved)}` : ''}` : '<span class="warn">No estimate agreed yet</span>'} · Labour ${g.labourHours().toFixed(1)} h</div>
      ${g.findings.length ? `<ul>${g.findings.slice(-6).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      <div class="gauges">${S.E.running ? `${Math.round(S.E.rpm)} rpm · ` : ''}${S.E.coolant.toFixed(0)} °C · ${S.volts.toFixed(1)} V${S.draining > 0 ? ` · oil running out ${(S.draining * 60).toFixed(1)} l/min${S.drainPan ? ' into the pan' : ' ONTO THE FLOOR'}` : ''}</div>`;
  }

  update(dt) {
    const g = this.g;
    const d = g.describeTarget?.();
    const live = g.turning ? `${Math.round(g.lastTorque ?? 0)} N·m` : g.hint ?? '';
    this.tip.innerHTML = d ? `<b>${esc(d.title)}</b>${d.sub ? `<div>${esc(d.sub)}</div>` : ''}${d.hint ? `<div class="h">${esc(d.hint)}</div>` : ''}${live ? `<div class="live">${esc(live)}</div>` : ''}` : live ? `<div class="live">${esc(live)}</div>` : '';
    this.tip.style.display = d || live ? '' : 'none';
    if (!g.pouring && !g.inflating) g.hint = null;
    const stars = g.rating;
    this.top.innerHTML = `<b>Verkstan</b> · Mon 2 Nov · ${g.timeText()} · ${sek(g.money)} · ${stars ? `${stars.toFixed(1)} ★ (${g.reviews.length})` : 'no reviews yet'} · <a class="set">${g.brain.online ? '● Claude' : '○ offline'}</a> · <a class="hlp">H help</a>${g.held ? ` · holding: ${esc(g.cust.A.part(g.held.partId)?.name ?? (g.held.pan ? 'drain pan' : 'a part'))}` : ''}`;
    this.top.querySelector('.set').onclick = () => this.openSettings();
    this.top.querySelector('.hlp').onclick = () => this.openHelp();
    this._cardT += dt; if (this._cardT > 0.5) { this._cardT = 0; this._card(); this._log(); }
    void CARS; void SOCKETS;
  }
}
