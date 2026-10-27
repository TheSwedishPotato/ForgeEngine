/**
 * Touch controls, for a phone or a tablet (only there: a mouse and keyboard keep the keys).
 * A stick at the left walks (pushed right out, you hurry); a finger dragged anywhere else looks
 * round. Use is your hand on what the crosshair rests on: tap it for a button or a switch, hold
 * it to carry a loose thing or pull a door or lever (look round while holding to move it).
 * Throw, E and Q (stairs, ladders), View (outside), Go to, and ? stand for the keys.
 */

/** A phone or tablet: a coarse pointer and no fine one. */
export function isTouchDevice() {
  const mm = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
  return (mm('(pointer: coarse)') || (navigator.maxTouchPoints ?? 0) > 0) && !mm('(pointer: fine)');
}

const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code }));

export class Touch {
  constructor(root, game, hud) {
    const P = game.player;
    const el = document.createElement('div');
    el.className = 'touch';
    el.innerHTML = `<div class="stick"><div class="knob"></div></div>
      <div class="pad">
        <button data-k="use" class="big">Use</button><button data-k="throw" class="big">Throw</button>
        <button data-k="KeyE">E</button><button data-k="KeyQ">Q</button><button data-k="KeyV">View</button>
        <button data-k="go">Go to</button><button data-k="KeyT">Data</button><button data-k="KeyH">?</button>
        <button data-k="tool">Tool</button><button data-k="KeyR">Apply</button><button data-k="KeyX">Put down</button><button data-k="KeyK">Guide</button>
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
        if (k === 'use') {
          // carrying: one tap picks it up, the next puts it down
          if (P.held?.body) { P._release(); b.textContent = 'Use'; return; }
          const hit = P._pick(null);
          if (hit) { P._grab(hit); if (hit.body && !hit.body.tool) b.textContent = 'Drop'; }
        }
        else if (k === 'throw') { if (P.held?.body) { P._throw(); el.querySelector('[data-k=use]').textContent = 'Use'; } }
        else if (k === 'tool') game.tools.toggle();
        else if (k === 'go') hud.goto.style.display = hud.goto.style.display === 'none' ? '' : 'none';
        else { key(k); key(k, 'keyup'); }
      });
      const up = () => { if (k === 'use' && !P.held?.body) P._release(); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }
}
