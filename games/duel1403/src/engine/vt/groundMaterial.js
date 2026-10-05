/**
 * The ground of the tournament field as a procedural material, evaluated
 * when a virtual-texture page is generated. Everything is a function of
 * world position, so any page at any mip level can be made on demand.
 *
 * ground(p, fp) -> Ground { albedo (linear), roughness, height (m), ao, wet }
 *   p   world x,z (m)      fp  footprint of one texel (m), for band-limiting
 */
export const GROUND_GLSL = /* glsl */`
struct Ground { vec3 albedo; float rough; float height; float ao; };

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
// value noise in 2D with footprint fade: features smaller than ~2 texels average out
float bnoise(vec2 p, float scale, float fp) { float f = smoothstep(0.6, 0.25, fp * scale); return mix(0.5, vnoise(p * scale), f); }
float bfbm(vec2 p, float scale, int oct, float fp) {
  float s = 0.0, a = 0.5, w = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; float sc = scale * pow(2.03, float(i)); s += a * bnoise(p + float(i) * 17.3, sc, fp); w += a; a *= 0.5; }
  return s / w;
}
// cellular features: returns (distance to nearest feature point, cell id hash)
vec2 cells(vec2 p, float scale) {
  vec2 g = floor(p * scale), f = fract(p * scale);
  float best = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = vec2(x, y);
    vec2 h = hash22(g + c);
    float d = length(c + h - f);
    if (d < best) { best = d; id = hash12(g + c + 7.7); }
  }
  return vec2(best / scale, id);
}

// A boot print: heel and sole as two soft ellipses, pressed in.
float bootPrint(vec2 p, float scale) {
  vec2 g = floor(p * scale);
  float press = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = g + vec2(x, y);
    float h = hash12(c);
    if (h > 0.22) continue;   // a print in about one cell in five
    vec2 o = (c + hash22(c * 1.3)) / scale;
    float ang = hash12(c + 3.1) * TAU;
    vec2 d = p - o;
    d = vec2(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang));
    float sole = length((d - vec2(0.0, 0.05)) / vec2(0.045, 0.075));
    float heel = length((d + vec2(0.0, 0.09)) / vec2(0.038, 0.04));
    press = max(press, smoothstep(1.0, 0.6, min(sole, heel)) * (0.25 + 0.45 * hash12(c + 9.0)));
  }
  return press;
}

// A horseshoe print, open toward the toe.
float hoofPrint(vec2 p, float scale) {
  vec2 g = floor(p * scale);
  float press = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = g + vec2(x, y);
    if (hash12(c + 2.0) > 0.45) continue;
    vec2 o = (c + hash22(c * 2.1)) / scale;
    float ang = (hash12(c + 5.0) - 0.5) * 0.8;   // along the path
    vec2 d = p - o;
    d = vec2(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang));
    float ring = abs(length(d / vec2(1.0, 1.15)) - 0.055);
    float open = smoothstep(-0.02, 0.03, d.y);
    press = max(press, smoothstep(0.016, 0.006, ring) * open);
  }
  return press;
}

Ground ground(vec2 p, float fp) {
  float r = length(p);
  Ground g;
  // --- masks ------------------------------------------------------------------
  float edgeN = bfbm(p, 0.35, 3, fp);
  float lists = 1.0 - smoothstep(6.0, 7.2, r + (edgeN - 0.5) * 1.6);       // raked earth of the lists
  float trodden = 1.0 - smoothstep(7.0, 16.0, r + (edgeN - 0.5) * 6.0);    // worn grass round the fence
  // the road from the gate to the village
  float roadX = 3.5 * sin(p.y * 0.045) + 1.2 * sin(p.y * 0.13);
  float dRoad = abs(p.x - roadX);
  float road = (1.0 - smoothstep(1.3, 1.9 + bfbm(p, 0.8, 2, fp) * 0.6, dRoad)) * smoothstep(5.5, 8.0, p.y) * (1.0 - smoothstep(150.0, 160.0, p.y));
  // --- grass --------------------------------------------------------------------
  float clump = bfbm(p, 3.0, 5, fp);
  float dry = smoothstep(0.45, 0.75, bfbm(p, 0.12, 4, fp));
  vec3 grass = mix(srgb(vec3(0.30, 0.37, 0.17)), srgb(vec3(0.45, 0.47, 0.22)), clump);
  grass = mix(grass, srgb(vec3(0.58, 0.52, 0.30)), dry * 0.65);
  float blades = bnoise(p * vec2(1.0, 0.35), 90.0, fp);
  grass *= 0.8 + 0.4 * blades;
  // a few late flowers and fallen leaves
  vec2 fl = cells(p, 6.0);
  float flower = smoothstep(0.012, 0.006, fl.x) * step(0.93, fl.y) * smoothstep(0.02, 0.008, fp);
  grass = mix(grass, fl.y > 0.965 ? srgb(vec3(0.85, 0.80, 0.55)) : srgb(vec3(0.62, 0.22, 0.10)), flower);
  float hGrass = (clump - 0.5) * 0.03 + (blades - 0.5) * 0.008;
  float roughGrass = 0.92;
  // --- earth of the lists ------------------------------------------------------------
  float grain = bfbm(p, 9.0, 4, fp);
  vec3 earth = mix(srgb(vec3(0.50, 0.42, 0.30)), srgb(vec3(0.62, 0.53, 0.38)), grain);
  float rake = bnoise(vec2(p.x * 0.2, (p.y + p.x * 0.3) * 6.0), 1.0, fp * 6.0);
  float boots = bootPrint(p, 3.0) * smoothstep(0.03, 0.01, fp) * (0.4 + 0.6 * (1.0 - smoothstep(1.5, 4.5, r)));   // worn most where they fight
  vec2 pb = cells(p, 22.0);
  float pebble = smoothstep(0.012, 0.004, pb.x) * step(0.55, pb.y) * smoothstep(0.01, 0.004, fp);
  vec3 pebbleCol = mix(srgb(vec3(0.55, 0.53, 0.50)), srgb(vec3(0.42, 0.36, 0.30)), fract(pb.y * 13.0));
  earth = mix(earth, earth * 0.72, boots);
  earth = mix(earth, pebbleCol, pebble);
  // straw strewn over the lists
  vec2 st = cells(p * vec2(1.0, 0.3), 8.0);
  float straw = smoothstep(0.006, 0.002, st.x) * step(0.85, st.y) * smoothstep(0.01, 0.004, fp);
  earth = mix(earth, srgb(vec3(0.78, 0.66, 0.36)), straw);
  float hEarth = (grain - 0.5) * 0.006 + (rake - 0.5) * 0.004 - boots * 0.012 + pebble * 0.006;
  float roughEarth = mix(0.95, 0.75, boots * 0.5);
  // --- road: packed mud, wheel ruts, hoof prints, puddles in the ruts -----------------
  float rutD = min(abs((p.x - roadX) - 0.75), abs((p.x - roadX) + 0.75));
  float rut = smoothstep(0.22, 0.05, rutD);
  vec3 mud = mix(srgb(vec3(0.36, 0.29, 0.21)), srgb(vec3(0.48, 0.40, 0.28)), grain);
  float hoof = hoofPrint(p, 3.0) * (1.0 - rut) * smoothstep(0.03, 0.01, fp);
  mud = mix(mud, mud * 0.7, hoof);
  float puddleN = bfbm(p, 0.7, 3, fp);
  float puddle = smoothstep(0.52, 0.56, puddleN) * rut;
  vec3 water = srgb(vec3(0.16, 0.14, 0.11));
  float hRoad = -rut * 0.06 - hoof * 0.01 + (grain - 0.5) * 0.008;
  // --- combine -------------------------------------------------------------------
  vec3 worn = mix(grass, mix(earth, grass, 0.45), 0.6);
  g.albedo = mix(grass, worn, trodden * (1.0 - lists));
  g.albedo = mix(g.albedo, earth, lists);
  g.albedo = mix(g.albedo, mud, road);
  g.height = mix(mix(hGrass, mix(hGrass, hEarth, 0.5), trodden), hEarth, lists);
  g.height = mix(g.height, hRoad, road);
  g.rough = mix(mix(roughGrass, 0.9, trodden), roughEarth, lists);
  g.rough = mix(g.rough, 0.85, road);
  // standing water: dark, mirror-smooth, level
  float wet = puddle * road;
  g.albedo = mix(g.albedo, water, wet);
  g.rough = mix(g.rough, 0.04, wet);
  g.height = mix(g.height, -0.045, wet);
  // damp rim round the puddles
  float damp = smoothstep(0.45, 0.53, puddleN) * rut * road * (1.0 - wet);
  g.albedo *= 1.0 - damp * 0.35;
  g.rough = mix(g.rough, 0.45, damp);
  g.ao = 1.0 - boots * 0.25 - rut * road * 0.2;
  return g;
}
`;
