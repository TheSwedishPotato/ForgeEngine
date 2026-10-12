/**
 * The baked geodata keeps its big arrays as gzip + base64 (tools/geodata/build.py).
 * Decoding works the same in the browser and in Node (DecompressionStream is in both).
 */
export async function gunzipBase64(b64, Type = Float32Array) {
  let bytes;
  if (typeof Buffer !== 'undefined') bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  else { const s = atob(b64); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Type(buf);
}
