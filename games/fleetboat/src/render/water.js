/**
 * The sea's optics, shared by the passes that look through it.
 */

/** Clear oceanic water (Jerlov I), per channel (red 600, green 540, blue 470 nm). Smith & Baker 1981; Morel 1988. */
export const WATER = {
  Kd: [0.36, 0.065, 0.024],         // diffuse attenuation of downwelling light (1/m)
  c: [0.37, 0.07, 0.036],           // beam attenuation (absorption + scattering) for what you see through it (1/m)
  bb: [0.0012, 0.0016, 0.0022],     // backscattering: the water's own glow
};


/** Ray against the boat's spaces (boat coordinates): the length of [t0, t1] that lies inside them. */
export const RAY_BOAT_GLSL = /* glsl */`
vec2 rayCylX(vec3 o, vec3 d, float ay, float R, float x0, float x1) {
  // a cylinder along x (axis at height ay, z = 0) between x1 (aft) and x0 (fwd)
  vec2 oc = vec2(o.y - ay, o.z), dc = vec2(d.y, d.z);
  float A = dot(dc, dc), B = dot(oc, dc), C = dot(oc, oc) - R * R;
  vec2 t = vec2(1e9, -1e9);
  if (A < 1e-8) { if (C > 0.0) return t; t = vec2(-1e9, 1e9); }
  else { float h = B * B - A * C; if (h < 0.0) return t; h = sqrt(h); t = vec2((-B - h) / A, (-B + h) / A); }
  if (abs(d.x) > 1e-8) { float ta = (x1 - o.x) / d.x, tb = (x0 - o.x) / d.x; t = vec2(max(t.x, min(ta, tb)), min(t.y, max(ta, tb))); }
  else if (o.x < x1 || o.x > x0) return vec2(1e9, -1e9);
  return t;
}
vec2 raySphere(vec3 o, vec3 d, vec3 c, float R) {
  vec3 oc = o - c; float b = dot(oc, d), C = dot(oc, oc) - R * R, h = b * b - C;
  if (h < 0.0) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h);
}
float overlap(vec2 a, vec2 b) { return max(0.0, min(a.y, b.y) - max(a.x, b.x)); }
float insideBoat(vec3 o, vec3 d, vec2 seg) {
  float s = overlap(seg, rayCylX(o, d, uHull.x, uHull.y + 0.12, uHull.z, uHull.w));
  s += overlap(seg, rayCylX(o, d, uCT.z, uCT.w, uCT.x, uCT.y));
  vec2 c = rayCylX(o, d, uObs.y, uObs.z + 0.16, uObs.x + uObs.w, uObs.x - uObs.w);
  vec2 s1 = raySphere(o, d, vec3(uObs.x + uObs.w, uObs.y, 0.0), uObs.z + 0.16);
  vec2 s2 = raySphere(o, d, vec3(uObs.x - uObs.w, uObs.y, 0.0), uObs.z + 0.16);
  vec2 cap = vec2(min(c.x, min(s1.x, s2.x)), max(c.y, max(s1.y, s2.y)));
  s += overlap(seg, cap);
  return s;
}`;

