/**
 * Minimal PNG codec for the Node / Deno platforms (browsers use their own decoder).
 * Decodes 8-bit and 16-bit, gray / gray+alpha / RGB / RGBA / palette, non-interlaced.
 * Encodes RGBA8. Needs a zlib: Node's `node:zlib`, passed in by the platform.
 */

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

let CRC;
function crc32(buf) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePNG(bytes, zlib) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 8; i++) if (d[i] !== SIG[i]) throw new Error('decodePNG: not a PNG file');
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = 8, width = 0, height = 0, depth = 8, ctype = 6, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p < d.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]), body = d.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = dv.getUint32(p + 8); height = dv.getUint32(p + 12); depth = d[p + 16]; ctype = d[p + 17]; interlace = d[p + 20]; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('decodePNG: interlaced PNGs are not supported (re-save without interlacing)');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`decodePNG: unsupported colour type ${ctype}`);
  const raw = zlib.inflateSync(concat(idat));
  const bitsPP = channels * depth, bpp = Math.max(1, bitsPP >> 3), stride = Math.ceil((width * bitsPP) / 8);
  const out = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride), src = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[src++], line = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error(`decodePNG: bad filter ${ft}`);
      }
      line[i] = v & 255;
    }
    src += stride;
    prev = line;
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (row, i) => { // i-th sample of a row, scaled to 8 bits
    if (depth === 8) return row[i];
    if (depth === 16) return row[i * 2];
    const per = 8 / depth, byte = row[Math.floor(i / per)], shift = 8 - depth * ((i % per) + 1);
    const v = (byte >> shift) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  for (let y = 0; y < height; y++) {
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (ctype === 6) { for (let k = 0; k < 4; k++) rgba[o + k] = sample(row, x * 4 + k); }
      else if (ctype === 2) { for (let k = 0; k < 3; k++) rgba[o + k] = sample(row, x * 3 + k); rgba[o + 3] = 255; }
      else if (ctype === 0) { const g = sample(row, x); rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = 255; }
      else if (ctype === 4) { const g = sample(row, x * 2); rgba[o] = rgba[o + 1] = rgba[o + 2] = g; rgba[o + 3] = sample(row, x * 2 + 1); }
      else { const i = sample(row, x); rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2]; rgba[o + 3] = trns && i < trns.length ? trns[i] : 255; }
    }
  }
  return { width, height, data: rgba };
}

export function encodePNG({ width, height, data }, zlib) {
  const stride = width * 4, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(new Uint8Array(data.buffer, data.byteOffset + y * stride, stride), y * (stride + 1) + 1);   // filter byte 0 = none
  const idat = new Uint8Array(zlib.deflateSync(raw, { level: 6 }));
  const chunk = (type, body) => {
    const b = new Uint8Array(12 + body.length), v = new DataView(b.buffer);
    v.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(body, 8);
    v.setUint32(8 + body.length, crc32(b.subarray(4, 8 + body.length)));
    return b;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width); hv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  return concat([new Uint8Array(SIG), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}
