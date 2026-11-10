/**
 * GPU timing per pass, with timestamp queries.
 *
 * The frame's command encoder is told to stamp the start and the end of every render and compute pass it begins; the stamps are
 * resolved into a buffer, copied to a mappable one and read back a few frames later, so measuring never stalls the GPU. Passes
 * are named by their `label`, so the result reads `{ gbuffer: 0.8, lighting: 1.4, 'shadow cascade 0': 0.3, ... }` in milliseconds.
 *
 *   renderer.enableGpuTiming();                 // false when the device has no 'timestamp-query'
 *   ... draw some frames ...
 *   renderer.timer.avg                          // { spanMs, sumMs, passes: { label: ms } }, smoothed over frames
 *   renderer.timer.last                         // the most recent finished frame
 *   renderer.timer.onSample = (s) => ...        // every finished frame (they arrive 2-3 frames after they were drawn)
 *
 * `spanMs` is from the start of the first pass to the end of the last one (the time the frame occupied the GPU); `sumMs` adds up
 * the passes alone (the gaps between them are barriers and idle time). Browsers round timestamps to 100 microseconds unless
 * Chrome runs with --enable-webgpu-developer-features, so short passes read 0.0 or 0.1 there; Dawn on Node is exact.
 */
import { BUFFER, MAP } from './Device.js';

/**
 * What the GPU spent, in milliseconds.
 * @typedef {object} GpuTimes
 * @property {number} spanMs                    from the start of the first pass to the end of the last: the time the frame occupied the GPU
 * @property {number} sumMs                     the passes added up (the rest is barriers and idle time)
 * @property {Record<string, number>} passes    milliseconds by pass label
 */

/** @import { GPU } from './Device.js' */

const EMA = 0.1;

export class GpuTimer {
  /**
   * @param {GPU} gpu
   * @param {object} [o]
   * @param {number} [o.maxPasses]   passes timed per frame; a frame with more is still drawn, the extra passes are just not measured (see `untimed`)
   * @param {number} [o.ring]        frames in flight: result buffers read back while later frames are drawn
   */
  constructor(gpu, { maxPasses = 192, ring = 6 } = {}) {
    this.gpu = gpu;
    this.supported = !!gpu.hasTimestamps;
    this.maxPasses = maxPasses;
    /** Called with every finished frame (`last`), two or three frames after it was drawn. @type {((times: GpuTimes) => void) | null} */
    this.onSample = null;
    /** The most recent finished frame. @type {GpuTimes} */
    this.last = { spanMs: 0, sumMs: 0, passes: {} };
    /** Smoothed over the last frames. @type {GpuTimes} */
    this.avg = { spanMs: 0, sumMs: 0, passes: {} };
    /** Frames measured so far. */
    this.samples = 0;
    /** Passes of the most recent frame that did not fit in `maxPasses` and are missing from the numbers (normally 0). */
    this.untimed = 0;
    this._slot = null;
    if (!this.supported) return;
    const d = gpu.device;
    this.querySet = d.createQuerySet({ type: 'timestamp', count: maxPasses * 2, label: 'pass timestamps' });
    this.resolveBuf = gpu.buffer({ size: maxPasses * 16, usage: BUFFER.QUERY_RESOLVE | BUFFER.COPY_SRC, label: 'timestamp resolve' });
    this.slots = Array.from({ length: ring }, (_, i) => ({ buf: gpu.buffer({ size: maxPasses * 16, usage: BUFFER.MAP_READ | BUFFER.COPY_DST, label: `timestamp readback ${i}` }), names: [], busy: false }));
  }

  /** Starts timing the passes begun on `enc` from now on. Returns the slot to give to end() and collect(), or null (not supported, or the ring is full). */
  begin(enc) {
    if (!this.supported) return null;
    const slot = this.slots.find((s) => !s.busy);
    if (!slot) return null;
    slot.names.length = 0;
    slot.untimed = 0;
    const render = enc.beginRenderPass.bind(enc), compute = enc.beginComputePass.bind(enc), set = this.querySet, max = this.maxPasses;
    const stamp = (desc) => {
      const n = slot.names.length;
      if (n >= max) { slot.untimed++; return desc; }
      slot.names.push(desc?.label ?? `pass ${n}`);
      return { ...desc, timestampWrites: { querySet: set, beginningOfPassWriteIndex: 2 * n, endOfPassWriteIndex: 2 * n + 1 } };
    };
    enc.beginRenderPass = (d) => render(stamp(d));
    enc.beginComputePass = (d) => compute(stamp(d ?? {}));
    return slot;
  }

  /** After the last pass, before `enc.finish()`. */
  end(enc, slot) {
    const n = slot.names.length;
    if (!n) return;
    enc.resolveQuerySet(this.querySet, 0, n * 2, this.resolveBuf, 0);
    enc.copyBufferToBuffer(this.resolveBuf, 0, slot.buf, 0, n * 16);
    slot.busy = true;
  }

  /** After `queue.submit`: reads the stamps once the GPU has finished the frame. Never waits. */
  collect(slot) {
    if (!slot.busy) return;
    const n = slot.names.length, names = slot.names.slice(), untimed = slot.untimed;
    slot.buf.mapAsync(MAP.READ, 0, n * 16).then(() => {
      const t = new BigUint64Array(slot.buf.getMappedRange(0, n * 16).slice(0));
      slot.buf.unmap();
      slot.busy = false;
      this.untimed = untimed;
      this._ingest(names, t);
    }, () => { slot.busy = false; });                         // device lost or destroyed while waiting: nothing to report
  }

  _ingest(names, t) {
    const passes = {};
    let sum = 0, first = null, lastEnd = null;
    for (let i = 0; i < names.length; i++) {
      const a = t[2 * i], b = t[2 * i + 1];
      if (b < a) continue;                                    // a counter that wrapped or was never written
      const ms = Number(b - a) / 1e6;
      passes[names[i]] = (passes[names[i]] ?? 0) + ms;
      sum += ms;
      if (first === null || a < first) first = a;
      if (lastEnd === null || b > lastEnd) lastEnd = b;
    }
    if (first === null) return;
    const span = Number(lastEnd - first) / 1e6;
    this.last = { spanMs: span, sumMs: sum, passes };
    const k = this.samples++ ? EMA : 1, avg = this.avg;
    avg.spanMs += (span - avg.spanMs) * k;
    avg.sumMs += (sum - avg.sumMs) * k;
    for (const [name, ms] of Object.entries(passes)) { const prev = avg.passes[name]; avg.passes[name] = prev === undefined ? ms : prev + (ms - prev) * k; }
    for (const name of Object.keys(avg.passes)) {             // a pass that stopped running fades out instead of staying at its last value
      if (name in passes) continue;
      avg.passes[name] *= 1 - k;
      if (avg.passes[name] < 1e-3) delete avg.passes[name];
    }
    this.onSample?.(this.last);
  }

  /** Forgets everything measured so far (benchmarks call this after their warm-up: the first frames upload textures and build the sky). */
  reset() {
    this.last = { spanMs: 0, sumMs: 0, passes: {} };
    this.avg = { spanMs: 0, sumMs: 0, passes: {} };
    this.samples = 0;
  }

  /** Waits until every frame already submitted has been read back (benchmarks call this before reading the totals). */
  async flush() {
    await this.gpu.idle();
    for (let i = 0; i < 100 && this.slots?.some((s) => s.busy); i++) await new Promise((r) => setTimeout(r, 2));
  }

  dispose() {
    if (!this.supported) return;
    this.querySet.destroy(); this.resolveBuf.destroy();
    for (const s of this.slots) s.buf.destroy();
    this.supported = false;
  }
}
