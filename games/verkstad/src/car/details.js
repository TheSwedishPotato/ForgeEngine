/**
 * The details that make a body a particular car, traced from reference photographs (Wikimedia
 * Commons, listed in docs/references.md): its lamps, grille, bumpers, rubbing strips, window trim,
 * headliner and mirror. Shapes in the car frame (+Z forward, +X left), placed on the body surface.
 *
 * Volvo 240 (from a 1986 244 GL): rectangular headlamps with the amber indicator at the outer end,
 * wrapping round the corner; a chrome-framed grille with the diagonal bar; deep black bumpers
 * wrapping back to the wheel arches; a black rubbing strip along the doors and wings; black window
 * frames; tall rear lamps.
 *
 * Golf VII (from a 2013–15 five-door): slim wedge headlamps swept back into the wings, joined by a
 * black grille band with its chrome line; a wide lower intake with fog lamps; L-shaped rear lamps
 * across the tailgate shut line; black window trim.
 */
const box = (w, h, d, p, m, r) => ({ t: 'box', s: [w, h, d], p, m, r });

export function bodyDetails(spec, B) {
  const P = B.P, out = [];
  const st = (z) => B.station(z);               // [z, top, belt, shoulder hw, roof hw, sill]
  const volvo = spec.id === 'volvo240';
  const F = P.front, R = P.rear;
  if (volvo) {
    const hw = st(F - 0.02)[3];
    for (const sx of [1, -1]) {
      // headlamp unit (flush with the nose, its indicator wrapping round the corner)
      out.push(box(0.4, 0.165, 0.03, [sx * 0.5, 0.66, F + 0.012], 'lensVolvo', sx > 0 ? undefined : [0, 0, Math.PI]));
      out.push(box(0.03, 0.13, 0.12, [sx * (hw + 0.004), 0.64, F - 0.05], 'lensAmber'));
      // the tall rear lamp
      out.push(box(0.3, 0.27, 0.03, [sx * 0.64, 0.66, R - 0.012], 'tailVolvo'));
      // rubbing strip on the wing, the doors and the rear wing (the arches between)
      for (const [z0, z1] of [[1.72, F - 0.05], [-0.95, 0.94], [R + 0.05, -1.72]]) { const zc = (z0 + z1) / 2; out.push(box(0.022, 0.036, z1 - z0, [sx * (st(zc)[3] + 0.012), 0.6, zc], 'rubStrip')); }
      // black window frames: along the belt and up the roof edge
      out.push(box(0.02, 0.022, P.cowl - P.trunkF - 0.1, [sx * (st(-0.4)[3] - 0.03), st(-0.4)[2] + 0.005, (P.cowl + P.trunkF) / 2], 'trimBlack'));
      out.push(box(0.02, 0.022, P.roofF - P.roofR, [sx * (st(-0.4)[4] + 0.005), st(-0.4)[1] - 0.04, (P.roofF + P.roofR) / 2], 'trimBlack'));
      // the bumpers' wrap-arounds
      out.push(box(0.17, 0.17, 0.5, [sx * (hw + 0.03), 0.45, F - 0.18], 'trimBlack'));
      out.push(box(0.17, 0.17, 0.42, [sx * (st(R + 0.1)[3] + 0.03), 0.45, R + 0.16], 'trimBlack'));
    }
    out.push(box(0.56, 0.2, 0.03, [0, 0.665, F + 0.014], 'grilleVolvo'));
  } else {
    for (const sx of [1, -1]) {
      // wedge headlamps on the nose's slope, swept back and tilted up
      out.push(box(0.46, 0.125, 0.03, [sx * 0.55, 0.72, F - 0.06], 'lensGolf', [-0.3, sx * 0.5, sx > 0 ? 0 : Math.PI]));
      out.push(box(0.12, 0.05, 0.02, [sx * 0.56, 0.43, F + 0.03], 'lensGolf'));                      // fog lamp
      out.push(box(0.36, 0.11, 0.03, [sx * 0.6, 0.98, R + 0.03], 'tailGolf', [0.35, sx * -0.25, 0]));      // rear lamp
      out.push(box(0.02, 0.02, P.cowl - P.roofR - 0.2, [sx * (st(-0.6)[3] - 0.03), st(-0.6)[2] + 0.005, (P.cowl + P.roofR) / 2], 'trimBlack'));
    }
    out.push(box(0.6, 0.075, 0.03, [0, 0.715, F + 0.005], 'grilleGolf', [-0.25, 0, 0]));
    out.push(box(0.9, 0.13, 0.02, [0, 0.44, F + 0.028], 'honeycomb'));
  }
  // inside: the headliner under the roof, the rear-view mirror at the top of the windscreen
  const zr = (P.roofF + P.roofR) / 2, s = st(zr);
  out.push(box(s[4] * 2 - 0.06, 0.02, P.roofF - P.roofR + 0.1, [0, s[1] - 0.04, zr], 'headliner'));
  out.push(box(0.24, 0.07, 0.02, [0.02, s[1] - 0.12, P.roofF + 0.05], 'mirrorGlass', [0.15, 0, 0]));
  out.push(box(0.025, 0.06, 0.025, [0.02, s[1] - 0.07, P.roofF + 0.05], 'trimBlack'));
  return out;
}

/** The bumpers (their own parts): deep black rubber on the Volvo, painted with a black lower lip on the Golf. */
export function bumper(spec, B, front) {
  const P = B.P, z = front ? P.front : P.rear, dir = front ? 1 : -1, w = spec.dims.width;
  if (spec.id === 'volvo240') return [box(w + 0.04, 0.17, 0.16, [0, 0.45, z + dir * 0.06], 'trimBlack'), box(w - 0.1, 0.025, 0.02, [0, 0.5, z + dir * 0.14], 'rubStrip')];
  return front
    ? [box(w - 0.06, 0.24, 0.08, [0, 0.42, z - 0.02], 'paint'), box(w - 0.3, 0.05, 0.1, [0, 0.29, z - 0.02], 'trimBlack')]
    : [box(w - 0.06, 0.26, 0.1, [0, 0.5, z + 0.03], 'paint'), box(w - 0.4, 0.08, 0.1, [0, 0.36, z + 0.02], 'trimBlack')];
}
