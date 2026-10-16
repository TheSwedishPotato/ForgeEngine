/**
 * Touch controls, for a phone or a tablet (only there: a mouse and keyboard keep the keys).
 * A stick at the left walks (pushed right out, she hurries); a finger dragged anywhere else looks
 * round. The buttons stand for the keys: Use and Back work the control you look at (the left and
 * right mouse buttons), E the ladder or the periscope, F its power, V the outside view, Orders
 * the captain, ? the help.
 */

/** A phone or tablet: a coarse pointer and no fine one. */
export function isTouchDevice() {
  const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return (mm('(pointer: coarse)') || (navigator.maxTouchPoints ?? 0) > 0) && !mm('(pointer: fine)');
}

const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Tab' ? 'Tab' : '' }));

export class Touch {
  constructor(root, game) {
    this.game = game;
    const P = game.player;
    const el = (this.el = document.createElement('div'));
    el.className = 'touch';
    el.innerHTML = `<div class="stick"><div class="knob"></div></div>
      <div class="pad">
        <button data-k="use" class="big">Use</button><button data-k="back" class="big">Back</button>
        <button data-k="KeyE">E</button><button data-k="KeyF">F</button><button data-k="KeyV">View</button>
        <button data-k="Tab">Orders</button><button data-k="KeyH">?</button>
      </div>`;
    root.append(el);
    // the stick: its offset drives W A S D (and Shift right out)
    const stick = el.querySelector('.stick'), knob = el.querySelector('.knob');
    let id = null, cx = 0, cy = 0;
    const set = (dx, dy) => {
      const R = 46, l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const ux = (dx * k) / R, uy = (dy * k) / R;
      const on = (code, v) => (v ? P.keys.add(code) : P.keys.delete(code));
      on('KeyW', uy < -0.3); on('KeyS', uy > 0.3); on('KeyA', ux < -0.3); on('KeyD', ux > 0.3);
      on('ShiftLeft', Math.hypot(ux, uy) > 0.95);
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId; stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      set(e.clientX - cx, e.clientY - cy);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.stopPropagation(); set(e.clientX - cx, e.clientY - cy); } });
    const end = (e) => { if (e.pointerId !== id) return; id = null; set(0, 0); };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    // the buttons
    for (const b of el.querySelectorAll('button')) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (k === 'use' || k === 'back') { if (P.mode === 'walk' && P.aim) { P.working = k === 'use' ? 1 : -1; P._throw = 0; } }
        else { key(k); key(k, 'keyup'); }
      });
      const up = () => { if (k === 'use' || k === 'back') P.working = 0; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }
}
