/**
 * Binary payloads on hosts that serve only text and images (a claude.ai artifact). The packager
 * writes every binary file as base64 text under its own name plus `.b64.txt`
 * (`rook.binz` -> `rook.binz.b64.txt`) and loads a tiny module first that sets
 * `globalThis.MED_PACKED`. Everything in the engine that fetches raw bytes goes through
 * fetchBytes(), so the same code runs from a dev server and from the packed page.
 */
export const isPacked = () => !!globalThis.MED_PACKED;

/** The bytes at `url` (an ArrayBuffer); rejects on a missing file. */
export async function fetchBytes(url) {
  const r = await fetch(isPacked() ? url + '.b64.txt' : url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return isPacked() ? decodeBase64(await r.text()) : r.arrayBuffer();
}

export function decodeBase64(s) {
  s = s.replace(/\s+/g, '');
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s).buffer;
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export function encodeBase64(bytes) {
  // Node (the packager) and browsers both have btoa; chunked so large files do not overflow the stack
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * A binary glTF (GLB) built in memory from a .gltf's JSON and its one external buffer, so a
 * loader can parse it without fetching the buffer (or making a blob: or data: URL for it).
 * Images stay external and resolve against the loader's path as before.
 */
export function toGLB(json, bin) {
  if (json.buffers?.length !== 1) throw new Error('toGLB: expected exactly one buffer');
  const j = { ...json, buffers: [{ byteLength: bin.byteLength }] };
  const text = new TextEncoder().encode(JSON.stringify(j));
  const jLen = (text.length + 3) & ~3, bLen = (bin.byteLength + 3) & ~3;
  const out = new ArrayBuffer(12 + 8 + jLen + 8 + bLen), v = new DataView(out), u = new Uint8Array(out);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.byteLength, true);
  v.setUint32(12, jLen, true); v.setUint32(16, 0x4e4f534a, true);
  u.set(text, 20); u.fill(0x20, 20 + text.length, 20 + jLen);
  v.setUint32(20 + jLen, bLen, true); v.setUint32(24 + jLen, 0x004e4942, true);
  u.set(new Uint8Array(bin), 28 + jLen);
  return out;
}
