/**
 * The running workshop: the hall and the lift, you and your tools, the customer at the counter and
 * their car in the bay (its parts' conditions, its simulation, its 3D model), the parts you have
 * taken off lying where you put them, the clock and the till.
 *
 * Time: the physics (the engine, fasteners, fluids) runs in real time; the workshop clock runs six
 * times faster (a day of work in about an hour and a half), and labour is billed by that clock.
 */
import { Vector3, Box3, Group, Mesh, BoxGeometry } from 'three';
import { Stage } from './render/stage.js';
import { makeMaterials } from './render/mats.js';
import { CarGL } from './render/carGL.js';
import { Workshop, BAY, CUSTOMER_SPOT, YARD } from './world/workshop.js';
import { Player } from './player.js';
import { TOOLS, toolById, SOCKETS, fits, turnStep, measure, EVENT_TEXT, fastenerStatus } from './world/tools.js';
import { soak } from './sim/fastener.js';
import { newCond, CORNER_NAME } from './car/assembly.js';
import { Brain } from './ai/brain.js';
import { offlineCustomer } from './ai/offline.js';
import { Customer } from './ai/customer.js';
import { CustomerFigure } from './people/figure.js';
import { Sound } from './audio/sound.js';
import { utcMs } from '../../gotthard-pullman/src/render/sun.js';

export const RATE = 1095;                        // SEK per hour, including VAT
const CLOCK_SCALE = 6;
const _v = new Vector3(), _b = new Box3();

export class Game {
  constructor(canvas, { quality = 'high', manual = false, touch = false, offline = false } = {}) {
    this.canvas = canvas; this.manual = manual; this.touch = touch;
    this.stage = new Stage(canvas, { quality });
    this.M = makeMaterials();
    this.workshop = new Workshop(this.stage, this.M);
    this.player = new Player(this);
    this.brain = new Brain();
    if (offline) this.brain.mode = 'offline';
    this.sound = new Sound(this);
    this.clock = 7 * 3600 + 45 * 60;              // 07:45, Monday 2 November 2026 (local time, CET)
    this.money = 20000; this.reviews = [];
    this.tool = TOOLS[0]; this.socket = 17; this.torqueSet = 115; this.dir = -1; this.diagSocket = 2;
    this.held = null; this.loose = []; this.looseId = 1;
    this.cust = null; this.carGL = null; this.queue = []; this.served = [];
    this.log = []; this.findings = [];
    this.busyHand = false; this.uiOpen = false;
    this.carPos = { t: 1, from: YARD, to: [BAY.x, 0, BAY.z] };
    this.compressor = true;
    this.figure = null;
    this.timeScale = 1;
  }

  // ---- customers -------------------------------------------------------------------------------

  async start() {
    await this.brain.probe();
    this.say(this.brain.online ? `Customers are played by Claude (${this.brain.model}).` : 'No Claude key set up: offline customers (see Settings to connect Claude).', 'Workshop');
    this._prefetch();
    await this.nextCustomer();
  }

  _prefetch() {
    if (this._fetching) return;
    const when = this.timeText();
    const recent = this.served.map((c) => `${c.name} (${c.spec.model})`).slice(-6);
    this._fetching = (this.brain.online
      ? this.brain.newCustomer({ when: `Monday 2 November 2026, ${when}`, weather: '7 °C, grey, drizzle on and off, the first frost forecast for Thursday', recent, allowF1: this.served.length >= 2 }).catch((e) => { this.say(`Claude could not make a customer (${e.message}); an offline one comes instead.`, 'Workshop'); return offlineCustomer(Math.random, { allowF1: this.served.length >= 2 }); })
      : Promise.resolve(offlineCustomer(Math.random, { allowF1: this.served.length >= 2 })))
      .then((p) => { this.queue.push(p); this._fetching = null; });
  }

  async nextCustomer(profile) {
    if (!profile) { if (!this.queue.length) await this._fetching; profile = this.queue.shift(); }
    this._prefetch();
    const c = new Customer(profile);
    c.arrivedAt = this.clock;
    c.onLine = (who, text) => this.onLine?.(c, who, text);
    this.cust = c;
    this.findings = [];
    if (this.carGL) this.stage.scene.remove(this.carGL.root);
    for (const l of this.loose) this.stage.scene.remove(l.group);
    this.loose = []; this.held = null;
    this.carGL = new CarGL(c, this.M);
    this.stage.scene.add(this.carGL.root);
    this.stage.carGlass.set(this.carGL.glassMeshes);
    this.carPos = { t: 0, from: YARD, to: [BAY.x, 0, BAY.z] };
    this.workshop.lift.arms = [false, false, false, false];
    for (const a of this.workshop.arms) a.userData.target = 0;
    this.workshop.rollerDoor = 1;
    if (this.figure) this.figure.remove();
    this.figure = new CustomerFigure(this.stage.scene, c.profile);
    this.figure.walkTo([[YARD[0] + 1.4, 0, BAY.z + 2.6], [6.3, 0, 7.6], CUSTOMER_SPOT]);
    c.state = 'waiting';
    c.say('customer', c.profile.opening);
    this.say(`${c.name} drives in with a ${c.spec.year} ${c.spec.make} ${c.spec.model} (${c.plate}) and goes to the counter.`, 'Workshop');
    this.onCustomer?.(c);
  }

  /** Done: they pay (or not), drive away, the next one comes. */
  async handOver(lines, workDone) {
    const c = this.cust;
    const total = lines.reduce((s, l) => s + l.sek, 0);
    const v = await c.handover(this.brain, { lines, total }, workDone);
    this.money += v.pays_sek;
    this.reviews.push({ name: c.name, stars: v.stars, review: v.review, car: c.spec.model });
    this.served.push(c);
    this.say(`${c.firstName} pays ${v.pays_sek} SEK and gives you ${'★'.repeat(v.stars)}${'☆'.repeat(5 - v.stars)}.`, 'Till');
    // they drive off; the next car arrives after a while
    setTimeout(() => { this.carPos = { t: 0, from: [BAY.x, 0, BAY.z], to: YARD, leaving: true }; this.figure?.walkTo([[6.3, 0, 7.6], [YARD[0] + 1.4, 0, BAY.z + 2.6]]); }, 2500);
    setTimeout(() => this.nextCustomer(), 9000);
    return v;
  }

  get rating() { return this.reviews.length ? this.reviews.reduce((s, r) => s + r.stars, 0) / this.reviews.length : 0; }
  timeText(t = this.clock) { const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }
  labourHours() { const c = this.cust; return c?.startedWork != null ? Math.max(0.1, Math.round(((this.clock - c.startedWork) / 3600) * 10) / 10) : 0; }

  say(text, who = 'You') { this.log.push({ text, who, t: performance.now() }); if (this.log.length > 60) this.log.shift(); this.onSay?.(text, who); }

  // ---- the car in the bay ------------------------------------------------------------------------

  /** Where the car stands now: on its wheels, or on the lift's arms (if all four are under it). */
  carLift() {
    const L = this.workshop.lift, A = this.cust?.A;
    if (!A || A.state.f1) return A?.state.f1 ? (A.state.f1lift ?? 0) : 0;
    const set = L.arms.filter(Boolean).length;
    const contact = A.spec.dims.groundClear + 0.06;
    if (set < 4) return 0;
    return Math.max(0, L.y - contact);
  }

  carBox() {
    if (!this.cust) return null;
    const d = this.cust.spec.dims, p = this.carGL.root.position;
    return { x0: p.x - d.width / 2, x1: p.x + d.width / 2, z0: p.z - d.length / 2, z1: p.z + d.length / 2, bottom: p.y + d.groundClear };
  }

  _carPlace(dt) {
    const cp = this.carPos, root = this.carGL.root;
    if (cp.t < 1) {
      cp.t = Math.min(1, cp.t + dt / 7);
      for (const k of ['FL', 'FR', 'RL', 'RR']) this.cust.S.wheelSpin[k] = (cp.leaving ? -1 : 1) * 4 * Math.sin(Math.PI * cp.t);
      if (cp.leaving && cp.t >= 1) root.visible = false;
    }
    const e = cp.t * cp.t * (3 - 2 * cp.t);
    root.position.x = cp.from[0] + (cp.to[0] - cp.from[0]) * e; root.position.z = cp.from[2] + (cp.to[2] - cp.from[2]) * e;
    root.rotation.y = BAY.yaw;
    const lift = this.carLift();
    root.position.y = cp.t >= 1 && !cp.leaving ? lift : 0;
    const A = this.cust.A;
    const up = root.position.y > 0.12;
    if (!A.state.f1) for (const k of ['FL', 'FR', 'RL', 'RR']) A.state.raised[k] = up;
    // too few arms under it: past their height the car tips off (it does not wait to be told)
    const L = this.workshop.lift, set = L.arms.filter(Boolean).length;
    if (!A.state.f1 && set > 0 && set < 4 && L.y > A.spec.dims.groundClear + 0.35 && !this._tipped) {
      this._tipped = true;
      this.say(`The car shifts on ${set === 1 ? 'one arm' : set + ' arms'} and lurches off! It crashes back onto its wheels: a dented sill, a cracked bumper.`, 'Workshop');
      this.sound.bang();
      L.arms = [false, false, false, false];
      for (const a of this.workshop.arms) a.userData.target = 0;
      A.part('body').cond.dented = true;
      this.findings.push('DAMAGE: the car fell off the lift (dented sill, cracked bumper)');
    }
  }

  // ---- what you can pick at --------------------------------------------------------------------

  pickables() {
    const list = [...this.workshop.pickables];
    if (this.carGL && this.carGL.root.visible) list.push(...this.carGL.pickables.filter((m) => !this.held || !m.userData.partId || m.userData.partId !== this.held.partId));
    for (const l of this.loose) if (l !== this.held) l.group.traverse((o) => { if (o.isMesh) list.push(o); });
    return list;
  }

  /** The mouse wheel: the socket size, or the torque wrench's setting (Shift), or the diagnostic socket. */
  wheel(d, shift) {
    if (this.tool.setting && shift) { this.torqueSet = Math.max(20, Math.min(210, this.torqueSet - d * 5)); return; }
    if (this.tool.socket) { const i = Math.max(0, Math.min(SOCKETS.length - 1, SOCKETS.indexOf(this.socket) - d)); this.socket = SOCKETS[i]; return; }
    if (this.tool.id === 'diaglead') { this.diagSocket = this.diagSocket === 2 ? 6 : 2; this.say(`Diagnostic lead in socket ${this.diagSocket} (${this.diagSocket === 2 ? 'fuel injection' : 'ignition'}).`); }
  }

  selectTool(id) { this.tool = toolById(id) ?? TOOLS[0]; if (this.tool.id === 'torque') this.torqueSet = this._specUnder() ?? this.torqueSet; }
  _specUnder() { const t = this.player.target; return t?.kind === 'fast' ? this.cust.A.fast(t.id).spec : null; }

  // ---- the hands ------------------------------------------------------------------------------

  /** A press of the left button: what it does depends on what you hold and what you look at. */
  press() {
    const t = this.player.target, c = this.cust;
    if (this.held) return this._pressHolding(t);
    if (!t) return;
    if (t.kind === 'world') return this._world(t.id, true);
    if (t.kind === 'loose') { const l = this.loose.find((x) => x.id === t.id); if (l) this._pick(l); return; }
    if (t.kind === 'item') {
      const it = c.A.items.find((i) => i.id === t.id);
      if (!it) return;
      if (it.location === 'airbox' && c.A.installed('airlid')) return this.say('It is inside the air filter housing: take the lid off first.');
      if (it.location === 'enginebay' && !c.A.state.hoodOpen) return this.say('Open the bonnet first.');
      it.found = true; this.carGL.itemMeshes.get(it.id).visible = false;
      if (it.shorts) c.A.part(it.shorts).cond.short = false;
      this.findings.push(`Found: ${it.label} (${it.whereText})`);
      return this.say(`You find ${it.label} ${it.whereText}. You put it in a bag for ${c.firstName}.`);
    }
    if (!c || this.carPos.t < 1) return;
    const A = c.A;
    if (t.kind === 'fast') {
      const f = A.fast(t.id);
      if (this.tool.id === 'spray') { soak(f, 0.5); return this.say(`Penetrating oil on the ${f.name}. Give it some minutes to work in.`); }
      const why = fits(this.tool, this.socket, f);
      if (why) return this.say(why);
      this.turning = { f, last: 0 };
      this.busyHand = true;
      return;
    }
    const p = A.part(t.id);
    if (!p) return;
    // measuring tools first
    const m = measure(this.tool, p, this);
    if (m) { this.say(`${p.name}: ${m.text}`); if (m.finding) this._finding(m.finding); return; }
    switch (this.tool.id) {
      case 'scanner': if (p.kind === 'obd' || p.kind === 'dash' || p.kind === 'cluster') return this.onScanner?.(); return this.say(A.spec.engine.diag === 'OBD2' ? 'Plug the scan tool into the OBD socket under the dash, by the driver\'s knee.' : c.S.scan().error);
      case 'gauge': if (p.kind === 'wheel') { this.inflating = { p }; return; } break;
      case 'oiljug': if (p.kind === 'engine' && !A.installed('oilcap')) { this.pouring = { what: 'oil' }; return; } return this.say(A.installed('oilcap') ? 'Take the oil filler cap off first.' : 'Pour it into the oil filler on top of the engine.');
      case 'coolantjug': if (p.kind === 'exptank') { if (A.installed('expcap')) return this.say('Take the expansion tank cap off (cold!) first.'); this.pouring = { what: 'coolant' }; return; } break;
      case 'bleeder': if (p.kind === 'caliper') { if (A.installed('resvcap')) return this.say('Take the reservoir cap off and keep it topped up while bleeding.'); this.bleeding = { k: p.corner, t: 0 }; return; } break;
      case 'gloves': if (p.kind === 'isolator') { this.isolating = { t: 0 }; this.say('Gloves on. Isolating the energy store: the DC link discharges...'); return; } break;
      case 'f1jack': if (A.state.f1) return this._f1jack(t.point); break;
      case 'heater': if (p.kind === 'coolantport') { A.state.heaterCart = !A.state.heaterCart; return this.say(A.state.heaterCart ? 'Heater cart connected: warming the water and oil to 60 °C.' : 'Heater cart off.'); } break;
      case 'starter': if (p.kind === 'starterport') { this.f1start = true; return; } break;
      default: break;
    }
    if (this.tool.id !== 'hand') { if (p.kind === 'wheel' && A.state.raised[p.corner]) return this._spinStart(p); return this.say(`${this.tool.name}: not on the ${p.name.toLowerCase()}.`); }
    this._hand(p);
  }

  _finding(text) { if (!this.findings.includes(text)) this.findings.push(text); if (this.cust.startedWork == null) this.cust.startedWork = this.clock; }

  _hand(p) {
    const c = this.cust, A = c.A, st = A.state;
    if (p.hinge) {
      if (p.kind === 'hood') {
        if (!st.hoodLatch && !st.hoodOpen) return this.say('The bonnet is latched: pull the release lever inside the car (by the driver\'s left knee).');
        st.hoodOpen = !st.hoodOpen; if (!st.hoodOpen) st.hoodLatch = false;
        return this.say(st.hoodOpen ? 'You slip a finger under the front edge, lift the safety catch and raise the bonnet.' : 'Bonnet shut.');
      }
      if (p.kind === 'trunk') { st.trunkOpen = !st.trunkOpen; return; }
      if (p.kind === 'door') { const k = p.id.slice(4); st.doors[k] = st.doors[k] ? 0 : 1; return; }
    }
    if (p.kind === 'hoodrelease') { st.hoodLatch = true; this.sound.clunk(); return this.say('Clunk: the bonnet pops onto its safety catch.'); }
    if (p.kind === 'ignition') {
      if (c.S.E.running || st.ignition === 3) { st.ignition = 0; return this.say('Key off: the engine stops.'); }
      if (st.ignition < 2) { st.ignition++; return this.say(st.ignition === 1 ? 'Key to I (accessories).' : 'Key to II: ignition on, the lamps light. Click and hold to crank (III); click when it runs to switch off.'); }
      st.ignition = 3; return;          // held: cranking until you let go
    }
    if (p.kind === 'handbrake') { if (A.spec.brakes.epb && st.epbService) return this.say('The parking brake is in service mode (scan tool).'); st.handbrake = !st.handbrake; return this.say(st.handbrake ? 'Parking brake on.' : 'Parking brake off.'); }
    if (p.kind === 'gearlever') { st.gear = st.gear ? 0 : 1; return this.say(st.gear ? 'In first gear.' : 'Neutral.'); }
    if (p.kind === 'wheel' && st.raised[p.corner] && !A.canRemove(p.id)) return this._spinStart(p);
    if (p.kind === 'diag' || p.kind === 'obd') return this.say(p.info);
    if (p.fixed) return this.say(p.info || `${p.name}: not something you take off for this job.`);
    if (!A.canRemove(p.id)) {
      const why = A.obstacles(p.id);
      const holding = A.holding(p.id);
      if (holding.length) why.push(`still held by ${holding.length} ${holding.length === 1 ? holding[0].name : 'fasteners (' + [...new Set(holding.map((f) => `${f.size} mm`))].join(', ') + ')'}`);
      return this.say(`${p.name}: ${why.join('; ')}.`);
    }
    if (p.kind === 'expcap' && c.S.E.coolant > 70) return this.say('The coolant is hot and under pressure: wait for it to cool before you open the cap.');
    A.remove(p.id);
    if (c.startedWork == null) c.startedWork = this.clock;
    const l = this._detach(p);
    this._pick(l);
    if (p.kind === 'dipstick') { const d = c.S.dipstick(); this.say(`The dipstick: oil ${d.text}, ${d.colour}.`); this._finding(`Oil level ${d.text}, ${d.colour}`); }
    else if (p.kind === 'caliper') this.say('Caliper off. Hang it on a hook, never on its hose.');
    else this.say(`${p.name} off.`);
  }

  _spinStart(p) { this.spinning = { k: p.corner }; this.busyHand = true; }

  /** A part leaves the car: its group goes into the world where it was. */
  _detach(p) {
    const g = this.carGL.groups.get(p.id);
    const l = { id: 'L' + this.looseId++, partId: p.id, group: g, old: !p.installedNew, cond: null, v: 0, mass: p.mass };
    if (g) {
      g.updateMatrixWorld(true);
      const wp = g.getWorldPosition(new Vector3());
      g.removeFromParent(); this.stage.scene.add(g); g.position.copy(wp);
      g.traverse((o) => { o.userData.looseId = l.id; });
    }
    this.loose.push(l);
    return l;
  }

  _pick(l) {
    if (l.mass > 32) return this.say('Too heavy to carry on your own.');
    this.held = l;
    l.group.traverse((o) => { o.userData.held = true; });
  }

  _pressHolding(t) {
    const h = this.held, c = this.cust, A = c.A;
    if (h.partId && A.part(h.partId)) {
      const p = A.part(h.partId);
      // aim at its own place on the car (anywhere on the part it fits to, or within 25 cm of its home)
      const home = this.carGL.homeOf(p.id);
      const target = t?.point ?? null;
      let near = false;
      if (home && target) { const hp = home.parent.localToWorld(home.pos.clone()); near = hp.distanceTo(target) < 0.3; }
      if (near && p.removed) {
        const why = A.obstacles(p.id);
        if (why.length) return this.say(`It cannot go on yet: ${why.join('; ')}.`);
        if (!h.old && !h.cond) h.cond = newCond(p, A.spec);
        A.install(p.id, h.old ? null : h.cond);
        for (const fid of p.fasteners) { const f = A.fast(fid); if (f.snapped) { f.snapped = false; f.stretched = false; } f.out = false; f.engaged = 0; f.clamp = 0; f.seize = 0; f.oiled = 0; f.finalTorque = 0; }
        if (p.kind === 'drainplug' && h.old) p.cond.washer = 'reused';
        this._attach(h, p);
        return this.say(`${p.name} ${h.old ? 'back on' : '(new) fitted'}.${p.fasteners.length ? ' Now do up its fasteners.' : ''}`);
      }
    }
    if (t?.kind === 'world') {
      if (t.id === 'scrap' && h.partId) { this._discard(h); return this.say(`${A.part(h.partId)?.name ?? 'It'} goes in the scrap bin.`); }
      if (t.id === 'tyrehotel' && A.part(h.partId)?.kind === 'wheel') { this._discard(h); return this.say('Wheel stored in the tyre hotel with the customer\'s name on it.'); }
      if (t.id === 'balancer' && A.part(h.partId)?.kind === 'wheel') {
        const cnd = h.old ? A.part(h.partId).cond : (h.cond ??= newCond(A.part(h.partId), A.spec));
        const was = cnd.imbalance;
        cnd.imbalance = 0;
        this.clock += 6 * 60;
        if (was > 0) this._finding(`${A.part(h.partId).name}: balanced (was ${Math.round(was)} g out)`);
        return this.say(was > 5 ? `The balancer spins it: ${Math.round(was * 0.55)} g inside, ${Math.round(was * 0.45)} g outside. Weights fitted; it reads 0 g now.` : 'The balancer reads 0 g / 0 g: it is in balance.');
      }
    }
    // put it down where you look (the floor, a bench), or in front of you
    this._drop(t?.point);
  }

  _attach(l, p) {
    const g = l.group, home = this.carGL.homeOf(p.id);
    this.carGL.adopt(p, g);
    g.removeFromParent(); home.parent.add(g); g.position.copy(home.pos); g.rotation.copy(home.rot);
    g.traverse((o) => { delete o.userData.looseId; delete o.userData.held; });
    this.loose = this.loose.filter((x) => x !== l);
    if (this.held === l) this.held = null;
  }

  _discard(l) { this.stage.scene.remove(l.group); this.loose = this.loose.filter((x) => x !== l); if (this.held === l) this.held = null; }

  _drop(point) {
    const l = this.held; if (!l) return;
    l.group.traverse((o) => { delete o.userData.held; });
    if (point && point.distanceTo(this.stage.camera.position) < 2.6) l.group.position.set(point.x, point.y + 0.15, point.z);
    l.v = 0; this.held = null;
  }

  /** A new part from the shelf, in your hands, for one of this car's parts. */
  takeNew(partId) {
    const A = this.cust.A, p = A.part(partId);
    if (!p) return;
    if (this.held) return this.say('Your hands are full.');
    const g = this.carGL.buildPart(p);
    this.stage.scene.add(g);
    const l = { id: 'L' + this.looseId++, partId, group: g, old: false, cond: newCond(p, A.spec), v: 0, mass: p.mass, bought: true };
    if (p.kind === 'wheel' && this.cust.winterSet) { l.cond.season = 'winter'; l.cond.tread = 6.5; l.cond.bar = A.spec.wheels.pressure[p.corner[0]]; }
    g.traverse((o) => { o.userData.looseId = l.id; delete o.userData.partId; delete o.userData.fastId; });
    this.loose.push(l);
    this.money -= Math.round(p.price * 0.62);
    this.cust.bought = [...(this.cust.bought ?? []), { id: partId, name: p.name, sek: p.price }];
    this._pick(l);
    this.say(`New: ${p.name}${p.partNo ? ` (${p.partNo})` : ''}. Trade price ${Math.round(p.price * 0.62)} SEK; retail ${p.price} SEK.`);
  }

  _world(id) {
    const W = this.workshop, c = this.cust;
    if (id === 'liftbox') { this.liftHold = true; return; }
    if (id.startsWith('arm')) {
      const i = Number(id.slice(3));
      if (c.A.state.f1) return this.say('Not this car: it has no jacking points, and the arms would crack its carbon floor. Use the F1 jacks.');
      if (W.lift.y > 0.2) return this.say('Lower the lift before you move the arms.');
      const set = !W.lift.arms[i];
      if (set) { const r = W.aimArm(i, c.spec); if (!r.ok) return this.say('That arm will not reach the jacking point from here.'); }
      W.lift.arms[i] = set; W.arms[i].userData.target = set ? 1 : 0;
      this._tipped = false;
      return this.say(set ? `Arm ${i + 1} swung under the jacking point, pad screwed up to the pinch weld.` : `Arm ${i + 1} swung clear.`);
    }
    if (id === 'rollerdoor') { W.rollerDoor = W.rollerDoor ? 0 : 1; return; }
    if (id === 'counter') return this.onCounter?.();
    if (id === 'shelf') return this.onShelf?.();
    if (id === 'rollcab') return this.onToolbox?.();
    if (id === 'oilbarrel') { this.selectTool('oiljug'); return this.say(`You fill a jug with ${c.spec.engine.oil.grade} from the barrel.`); }
    if (id === 'compressor') { this.compressor = !this.compressor; return this.say(this.compressor ? 'Compressor on: 8 bar in the lines.' : 'Compressor off.'); }
    if (id === 'tyrehotel') {
      if (!c.winterSet) return this.say(`No wheels stored here for ${c.name}.`);
      this.onShelf?.('wheel');
      return this.say(`${c.firstName}'s winter wheels are on the rack (studded? no: Nordic friction tyres). Take them one at a time.`);
    }
    if (id === 'whiteboard') return this.onCounter?.();
    if (id === 'balancer') return this.say('Bring a wheel to the balancer (hold it and click).');
  }

  _f1jack(point) {
    const A = this.cust.A, front = point && this.carGL.root.worldToLocal(point.clone()).z > 0;
    const k = front ? ['FL', 'FR'] : ['RL', 'RR'];
    const up = !A.state.raised[k[0]];
    for (const x of k) A.state.raised[x] = up;
    this.say(up ? `The ${front ? 'front' : 'rear'} jack under the ${front ? 'nose' : 'crash structure'}, a pull on the handle: the ${front ? 'front' : 'rear'} goes up and onto its stand.` : `Down off its stand onto its wheels.`);
  }

  /** The release of the left button: whatever was being held stops. */
  release() {
    this.turning = null; this.busyHand = false; this.inflating = null; this.pouring = null; this.spinning = null; this.liftHold = false; this.f1start = false;
    if (this.bleeding) this.bleeding = null;
    if (this.isolating) this.isolating = null;
    if (this.cust?.A.state.ignition === 3) this.cust.A.state.ignition = 2;
    this.workshop.liftCmd(0);
  }

  // ---- each frame --------------------------------------------------------------------------------

  frame(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const P = this.player, c = this.cust;
    this.clock += dt * CLOCK_SCALE * this.timeScale;
    if (c && this.carGL) {
      const A = c.A, S = c.S;
      // the hand at work
      if (P.mouse.down || P.mouse.right) this._hold(dt);
      P.mouse.dx = 0; P.mouse.dy = 0;
      // oil in the pan: the pan under the drain plug catches it
      S.drainPan = this._panUnderPlug();
      for (const f of A.fasteners.values()) if (f.oiled > 0 && f.oiled < 1) soak(f, (dt * CLOCK_SCALE) / 60);
      S.step(dt * this.timeScale, { throttle: this.throttle ?? 0 });
      this._carPlace(dt);
      this.stage.carGlass.indoor = this.carGL.root.position.z < 7.2 ? 1 : 0;
      this.carGL.update(dt);
    }
    this.workshop.update(dt);
    this._loose(dt);
    P.update(dt, this.stage.camera);
    if (this.held) { const hp = P.handPoint(); this.held.group.position.copy(hp); this.held.group.rotation.set(0, P.yaw, 0); }
    this.figure?.update(dt, this.stage.camera, this.chatting);
    this._lamps();
    this.stage.setTime(utcMs({ year: 2026, month: 11, day: 2, utcOffset: 1 }, this.clock));
    this.stage.render(dt);
    this.sound.update(dt);
    this.onFrame?.(dt);
  }

  _hold(dt) {
    const P = this.player, c = this.cust, A = c.A, mdx = Math.abs(P.mouse.dx) + Math.abs(P.mouse.dy);
    if (this.turning) {
      const f = this.turning.f, tool = this.tool;
      if (tool.power && tool.id === 'impact' && !this.compressor) { this.say('No air: switch the compressor on.'); this.release(); return; }
      const amount = tool.power ? dt : mdx * 0.9;
      if (amount <= 0) return;
      const r = turnStep(tool, f, this.dir, amount, { A, S: c.S, setting: this.torqueSet });
      this.lastTorque = r.torque;
      if (r.moved > 0) this.sound.turn(tool, r.moved);
      if (c.startedWork == null) c.startedWork = this.clock;
      if (r.event && r.event !== this._lastEv) { this.say(`${f.name}: ${EVENT_TEXT[r.event]}`); if (r.event === 'click') this.sound.click(); if (r.event === 'snapped' || r.event === 'stripped') { this.sound.bang(); this.findings.push(`DAMAGE: ${f.name} ${r.event}`); } }
      this._lastEv = r.event;
      if (r.event === 'out' || r.event === 'click' || r.event === 'snapped') this.release();
      return;
    }
    if (this.spinning) { const k = this.spinning.k; c.S.wheelSpin[k] += (P.mouse.dx || P.mouse.dy) * 0.08; if (!this._spunMsg) { this._spunMsg = true; setTimeout(() => { const d = c.S.drag(k); this.say(`The ${CORNER_NAME[k]} wheel ${d > 300 ? 'will not turn: something holds it (a gear, the handbrake)' : d > 30 ? 'stops almost at once: the brake is dragging hard' : A.part('hub' + k)?.cond.rough > 0.3 ? 'spins, with a gritty rumble you can feel in your hand' : 'spins freely and quietly'}.`); this._spunMsg = false; }, 1500); } return; }
    if (this.inflating) { const w = this.inflating.p.cond; w.bar = Math.min(3.5, w.bar + dt * (P.mouse.right ? -0.3 : 0.25)); this.hint = `${w.bar.toFixed(2)} bar`; this.sound.hiss(); return; }
    if (this.pouring) {
      if (this.pouring.what === 'oil') { const e = A.part('engine').cond, q = dt * 0.15; e.oilAge = (e.oilAge * e.oil) / (e.oil + q); e.oil += q; this.hint = `${c.S.dipstick().text}`; }
      else { const t = A.part('exptank').cond; t.level = Math.min(1.1, t.level + dt * 0.05); this.hint = `coolant ${Math.round(t.level * 100)} %`; }
      return;
    }
    if (this.bleeding) {
      this.bleeding.t += dt;
      if (this.bleeding.t > 4) { const k = this.bleeding.k; c.S.airInBrakes[k] = 0; const r = A.part('reservoir').cond; r.water = Math.max(0.6, r.water * 0.75); r.level = Math.max(0.4, r.level - 0.05); this.say(`${CORNER_NAME[k]} bled: clean fluid, no more bubbles.`); this._finding(`Bled the ${CORNER_NAME[k]} brake`); this.bleeding = null; }
      return;
    }
    if (this.isolating) { this.isolating.t += dt; if (this.isolating.t > 3) { A.state.ersSafe = true; this.say('The ERS light turns green: the car is safe to touch.'); this.isolating = null; } return; }
    if (this.liftHold) { this.workshop.liftCmd(P.mouse.right ? -1 : 1); return; }
    if (this.f1start) { A.state.externalStarter = true; return; }
  }

  _panUnderPlug() {
    const pan = this.loose.find((l) => l.pan);
    if (!pan || !this.carGL) return false;
    const plug = this.carGL.groups.get('drainplug'); if (!plug) return false;
    const pp = plug.getWorldPosition(_v);
    return Math.hypot(pp.x - pan.group.position.x, pp.z - pan.group.position.z) < 0.35;
  }

  /** Loose things fall onto whatever is under them: the floor, a bench, the drain pan. */
  _loose(dt) {
    for (const l of this.loose) {
      if (l === this.held) continue;
      const g = l.group;
      _b.setFromObject(g);
      const half = (_b.max.y - _b.min.y) / 2, x = g.position.x, z = g.position.z;
      let floor = 0;
      for (const [x0, z0, x1, z1, y] of this.workshop.surfaces) if (x > x0 && x < x1 && z > z0 && z < z1 && y <= _b.min.y + 0.06) floor = Math.max(floor, y);
      const bottom = _b.min.y;
      if (bottom > floor + 0.002) { l.v -= 9.81 * dt; g.position.y = Math.max(g.position.y + l.v * dt, g.position.y - (bottom - floor)); }
      else { l.v = 0; if (bottom < floor - 0.002) g.position.y += floor - bottom; }
      void half;
    }
    if (!this.loose.some((l) => l.pan)) this._makePan();
  }

  _makePan() {
    const g = new Group();
    g.add(new Mesh(new BoxGeometry(0.7, 0.12, 0.5), this.M.toolRed));
    const oil = new Mesh(new BoxGeometry(0.64, 0.02, 0.44), this.M.oilBlack); oil.position.y = 0.05; g.add(oil);
    g.position.set(-1.6, 0.06, 2.2);
    const l = { id: 'L' + this.looseId++, pan: true, group: g, v: 0, mass: 6 };
    g.traverse((o) => { o.userData.looseId = l.id; });
    this.stage.scene.add(g); this.loose.push(l);
  }

  _lamps() {
    const cam = this.stage.camera.position, L = [];
    for (const [x, z] of [[-6, -1], [-3, -1], [0, -1], [-3, 2.5], [3, -1], [6, 2.5], [-4.5, -4.5], [3, -4.5]].sort((a, b) => Math.hypot(a[0] - cam.x, a[1] - cam.z) - Math.hypot(b[0] - cam.x, b[1] - cam.z)).slice(0, 6)) L.push({ pos: [x, 4.7, z], power: 0.07, range: 9, color: [1, 0.97, 0.92] });
    // the inspection lamp you carry under the car
    if (this.player.pose > 0 || this.carLift() > 0.8) L.push({ pos: [cam.x, cam.y + 0.1, cam.z], power: 0.05, range: 3.5, color: [1, 0.98, 0.95] });
    this.stage.setLamps(L);
  }

  /** What the HUD shows about what you look at. */
  describeTarget() {
    const t = this.player.target, c = this.cust;
    if (!t) return null;
    if (t.kind === 'fast') { const f = c.A.fast(t.id); const why = fits(this.tool, this.socket, f); return { title: `${f.name} — ${f.drive === 'hex' ? f.size + ' mm' : f.drive === 'torx' ? 'T' + f.size : f.drive}${f.thread ? ' ' + f.thread : ''}`, sub: `${c.A.part(f.partId).name} · ${fastenerStatus(f)}`, hint: why ?? (this.dir < 0 ? 'Hold and drag to undo' : 'Hold and drag to do up') }; }
    if (t.kind === 'part') { const p = c.A.part(t.id); if (!p) return null; const obs = c.A.obstacles(p.id), hold = c.A.holding(p.id); return { title: p.name, sub: `${p.partNo && !/^[A-Z]{2}-\d/.test(p.partNo) ? p.partNo + ' · ' : ''}${p.fixed ? '' : `${p.mass} kg`}`, hint: p.info || (obs.length ? obs[0] : hold.length ? `held by ${hold.length} fastener${hold.length > 1 ? 's' : ''}` : p.fixed ? '' : 'Click to take it off') }; }
    if (t.kind === 'item') { const it = c.A.items.find((i) => i.id === t.id); return { title: 'Something that does not belong here', sub: it?.whereText ?? '', hint: 'Click to take it out' }; }
    if (t.kind === 'loose') { const l = this.loose.find((x) => x.id === t.id); return { title: l?.pan ? 'Waste oil drain pan' : (c.A.part(l?.partId)?.name ?? 'Part') + (l?.old === false ? ' (new)' : ''), hint: 'Click to pick up' }; }
    const W = { liftbox: ['Lift controls', 'Hold left button: up · hold right button: down'], rollerdoor: ['Roller door', 'Click to open or shut'], counter: ['Reception counter', 'Click (or E) to talk to the customer'], shelf: ['Parts shelves', 'Click to take new parts'], tyrehotel: ['Tyre hotel', 'Customers\' stored wheels'], oilbarrel: ['Oil barrel', 'Click to fill a jug'], compressor: ['Compressor', this.compressor ? 'On (8 bar)' : 'Off'], balancer: ['Wheel balancer', 'Bring a wheel'], scrap: ['Scrap bin', 'Old parts go in here'], rollcab: ['Roll cab', 'All the tools'], whiteboard: ['Today\'s jobs', ''] };
    if (t.id.startsWith('arm')) return { title: `Lift arm ${Number(t.id.slice(3)) + 1}`, hint: this.workshop.lift.arms[Number(t.id.slice(3))] ? 'Under its jacking point. Click to swing clear' : 'Click to swing it under the jacking point' };
    const w = W[t.id]; return w ? { title: w[0], hint: w[1] } : null;
  }
}
