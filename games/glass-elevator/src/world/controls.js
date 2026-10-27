/**
 * Everything a hand can work: each control is a mesh (or several) with what it is called, what
 * pressing it does (down, and up when let go), what it shows (lit or not, which position), and
 * the words for it under the crosshair. Buttons answer the moment they are pressed, switches
 * flip between their positions, hold-to-run buttons act while held, and handles are dragged.
 */
export class Controls {
  constructor() { this.meshes = []; this.list = []; }

  /** Registers a control on meshes: { id, label, kind, down, up, hint, lit, show, litMat, offMat, face }. */
  add(meshes, spec) {
    const c = { kind: 'button', ...spec, meshes: [].concat(meshes) };
    for (const m of c.meshes) { m.userData.control = c; this.meshes.push(m); }
    this.list.push(c);
    return c;
  }

  /** Lights and positions every control as its state says. */
  update() {
    for (const c of this.list) {
      if (c.lit && c.litMesh) { const on = !!c.lit(); if (on !== c._on) { c._on = on; c.litMesh.material = on ? c.litMat : c.offMat; } }
      c.show?.();
    }
  }
}
