/**
 * Start-up diagnostics for the film. Imported first, so it is running before anything that can fail.
 *  - every start-up step is named (window.__mark), so a stall says where it stalled;
 *  - errors and failed loads show on screen instead of an endless loading bar;
 *  - the device's graphics are probed up front (WebGL2, float render targets, memory);
 *  - on claude.ai the start-up log is kept in the artifact's database (`boots/<id>`), so the
 *    developer can read what happened on the player's machine. It holds no personal data:
 *    the browser's user agent, screen size, graphics renderer and the timings and errors.
 */
const t0 = performance.now();
const ms = () => Math.round(performance.now() - t0);
const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const log = {
  at: new Date().toISOString(), ua: navigator.userAgent, dpr: devicePixelRatio,
  screen: `${screen.width}x${screen.height}`, view: `${innerWidth}x${innerHeight}`,
  memoryGB: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null,
  gl: probeGL(), steps: [], errors: [], ready: false,
};

function probeGL() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const out = {
      webgl2: true, floatTargets: !!gl.getExtension('EXT_color_buffer_float'), halfFloatTargets: !!gl.getExtension('EXT_color_buffer_half_float'),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE), renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  } catch (e) { return { webgl2: false, error: String(e?.message ?? e) }; }
}

// ---- on screen
let box = null;
function show(text, bad = true) {
  if (!box) {
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:7vw;right:7vw;bottom:14vh;z-index:60;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:10px 12px;background:rgba(10,4,4,.85);border-left:2px solid #ff8a7a;color:#ffd2cb;pointer-events:none';
    document.body.appendChild(box);
  }
  box.style.borderLeftColor = bad ? '#ff8a7a' : '#6fb7ff';
  box.style.color = bad ? '#ffd2cb' : '#cfe4ff';
  box.textContent = text;
}

// ---- the log on claude.ai (the artifact's database); one write at a time, only on change
let db, chain = Promise.resolve(), dirty = false;
function flush() {
  if (!globalThis.claude?.use) return;
  dirty = true;
  chain = chain.then(async () => {
    if (!dirty) return;
    dirty = false;
    db ??= await globalThis.claude.use('db').catch(() => null);
    if (db) await db.doc('boots/' + id).set(JSON.parse(JSON.stringify(log))).catch(() => { db = null; });
  });
}

export function mark(step) {
  log.steps.push([step, ms()]);
  globalThis.__step = step;
  if (/menu on|batman built|set staged|error/.test(step)) flush();
}
export function fail(message) {
  const m = String(message).slice(0, 400);
  if (log.errors.length < 20) log.errors.push([m, ms(), globalThis.__step ?? 'loading the code']);
  show(`Something went wrong while ${globalThis.__step ?? 'loading the code'}:\n${m}`);
  flush();
}
export function ready() {
  log.ready = true; mark('menu on');
  if (box && !log.errors.length) box.remove();
}

globalThis.__mark = mark;
addEventListener('error', (e) => {
  // resource failures arrive here in the capture phase with no message
  if (e.message) fail(e.message);
  else if (e.target?.src || e.target?.href) fail('could not load ' + (e.target.src || e.target.href));
}, true);
addEventListener('unhandledrejection', (e) => fail(e.reason?.message ?? e.reason));

mark('code loaded');
if (!log.gl.webgl2) fail('this browser has no WebGL2, which the film needs. Try a desktop Chrome, Edge or Firefox, or the illustrated version.');
else if (!log.gl.floatTargets && !log.gl.halfFloatTargets) fail('this device cannot render to floating-point images, which the film needs. Try the illustrated version.');
// a stall says where it is
for (const s of [25, 60, 120]) setTimeout(() => {
  if (log.ready) return;
  mark(`still loading after ${s} s`); flush();
  if (!log.errors.length) show(`Still loading after ${s} s — at: ${globalThis.__step}\n${log.gl.renderer ?? ''}`, false);
}, s * 1000);
