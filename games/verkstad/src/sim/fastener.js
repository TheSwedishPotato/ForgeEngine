/**
 * A threaded fastener as a fitter feels it through the tool.
 *
 * Threads engage over `len` turns. Running down it takes only the thread friction (a few N·m,
 * more on a rusty thread). Once seated the joint stiffens: torque rises with the angle turned,
 * at the joint's stiffness (N·m per degree), which is how a torque wrench reads clamp. Beyond the
 * bolt's yield (about 1.8 × the specified torque for an ordinary grade 8.8/10.9 bolt done up dry)
 * it stretches and holds less; at about 2.4 × it snaps.
 *
 * Undoing it, the first movement needs the breakaway torque: the clamp it holds plus whatever
 * rust, thread-lock or galling adds (`seize`). Penetrating oil works into the thread over minutes
 * and takes most of that away. After that it runs out on thread friction.
 *
 * Tools give at most their own torque: fingers 2 N·m, a screwdriver 4, a 3/8" ratchet about 90
 * (a 0.22 m handle and the 400 N an arm puts into it), a 1/2" ratchet 130, a 600 mm breaker bar
 * 300, an impact gun hammers its rated torque in blows and stops when the bolt stops moving.
 */

export const TOOL_TORQUE = { hand: 2, screwdriver: 4, ratchet38: 90, ratchet12: 130, breaker: 300, torqueWrench: 210, impact: 650, wheelGun: 1500 };

export function makeFastener({ id, name, size, drive = 'hex', torque, len = 8, angle = 0, thread = '', stiffness, partId, pos = [0, 0, 0], axis = [0, 0, 1], seize = 0, crush = false }) {
  // stiffness: N·m per degree past seating. A wheel nut on its taper seats over ~30°; a small bolt
  // into an aluminium head over ~60°: what makes the click come at the right angle.
  const k = stiffness ?? Math.max(0.15, torque / 35);
  return {
    id, name, size, drive, spec: torque, specAngle: angle, len, thread, k, partId, pos, axis, crush,
    engaged: len,          // turns of thread engaged (0: out of the hole)
    clamp: torque,         // N·m it now holds (what breaks it loose, with seize)
    seize,                 // extra breakaway N·m from rust/galling
    oiled: 0,              // 0..1 penetrating oil worked in
    stretched: false, snapped: false, out: false, lost: false,
    finalTorque: torque,   // the last torque it was done up to (for the work order)
    tool: null,            // the last tool that did it up
    history: [],
  };
}

/** The torque the fastener resists with right now, turning in direction dir (+1 tighten, -1 undo). */
export function resisting(f, dir) {
  if (f.snapped || f.out) return 0;
  const friction = 1.2 + f.size * 0.08 + f.seize * 0.04 * (1 - f.oiled);
  if (dir < 0) {
    if (f.clamp > 0.01 || f.seize > 0) return f.clamp * 0.85 + f.seize * (1 - 0.8 * f.oiled) + friction;
    return friction;
  }
  if (f.engaged < f.len - 1e-6) return friction;        // still running down
  return Math.max(friction, f.clamp);
}

/**
 * Turns the fastener with a tool that can give at most `max` N·m, by `deg` degrees of handle
 * movement (or for power tools, as far as they go in dt). Returns what happened:
 *   { moved (deg), torque (N·m felt), event: null | 'seized' | 'broke-loose' | 'seated' | 'click' | 'out' | 'stretched' | 'snapped' | 'stripped' }
 * clickAt: a torque wrench's setting (it slips at that torque and you feel the click).
 */
export function turn(f, dir, deg, max, { clickAt = null, impact = false } = {}) {
  const out = { moved: 0, torque: 0, event: null };
  if (f.snapped) { out.event = 'snapped'; return out; }
  if (f.out && dir < 0) { out.event = 'out'; return out; }
  if (dir < 0) {
    const need = resisting(f, -1);
    if (f.clamp > 0.01 || (f.seize > 0 && f.engaged >= f.len - 1e-6)) {
      if (need > max) { out.torque = max; out.event = 'seized'; return out; }
      // it breaks loose: the clamp is gone, the rust broken
      out.torque = need; out.event = 'broke-loose';
      f.clamp = 0; f.seize *= 0.15;
      f.history.push('loosened');
    } else out.torque = need;
    f.engaged = Math.max(0, f.engaged - deg / 360);
    out.moved = deg;
    if (f.engaged <= 1e-6) { f.engaged = 0; f.out = true; out.event = 'out'; }
    return out;
  }
  // tightening
  if (f.out) { f.out = false; f.engaged = 0; }
  let left = deg;
  if (f.engaged < f.len - 1e-6) {
    const run = Math.min(left, (f.len - f.engaged) * 360);
    f.engaged += run / 360; left -= run; out.moved += run;
    out.torque = resisting(f, 1);
    if (f.engaged >= f.len - 1e-6) { f.engaged = f.len; out.event = 'seated'; f.clamp = Math.max(f.clamp, 0.5); }
    if (left <= 0) return out;
  }
  // seated: torque climbs with angle
  const limit = clickAt != null ? Math.min(max, clickAt) : max;
  const yieldT = f.spec * 1.8, snapT = f.spec * 2.4;
  const k = f.stretched ? f.k * 0.35 : f.k;
  if (f.clamp >= limit) {
    out.torque = limit;
    if (clickAt != null && max >= clickAt) out.event = 'click';
    return out;
  }
  let ang = Math.min(left, (limit - f.clamp) / k);
  if (impact) ang = Math.min(left, (limit - f.clamp) / k);   // an impact gun drives until it can't
  f.clamp += ang * k; out.moved += ang;
  out.torque = f.clamp;
  if (f.clamp >= yieldT && !f.stretched) { f.stretched = true; out.event = 'stretched'; }
  if (f.clamp >= snapT) { f.snapped = true; f.clamp = 0; out.event = f.size >= 15 ? 'stripped' : 'snapped'; return out; }
  if (clickAt != null && f.clamp >= clickAt - 1e-6) out.event = 'click';
  f.finalTorque = f.clamp;
  return out;
}

/** Done up to spec? 'ok' within -10/+20 %, 'loose', 'tight', 'missing', 'damaged'. */
export function judge(f) {
  if (f.lost || f.out) return 'missing';
  if (f.snapped || f.stretched) return 'damaged';
  if (f.engaged < f.len - 1e-3) return 'loose';
  const r = f.clamp / f.spec;
  if (r < 0.9) return 'loose';
  if (r > 1.25) return 'tight';
  return 'ok';
}

/** Penetrating oil: works into the thread over about 10 minutes of game time. */
export function soak(f, dtMinutes) { f.oiled = Math.min(1, f.oiled + dtMinutes / 10); }

/** A brand-new fastener of the same kind (from the drawer), out of the hole. */
export function fresh(f) {
  const n = makeFastener({ id: f.id, name: f.name, size: f.size, drive: f.drive, torque: f.spec, len: f.len, angle: f.specAngle, thread: f.thread, stiffness: f.k, partId: f.partId, pos: f.pos, axis: f.axis, crush: f.crush });
  n.engaged = 0; n.clamp = 0; n.out = true; n.finalTorque = 0;
  return n;
}
