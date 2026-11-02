import { COMMON } from './common.js';

/**
 * One vertex shader for every pass that rasterises scene geometry:
 * G-buffer (with motion vectors), shadow maps and probe captures.
 * Skinning reads bone matrices from a float texture; instancing reads
 * per-instance matrices (and last frame's, for motion vectors); morph
 * targets (face shapes) read slot deltas from a half-float texture, only
 * for the shapes active this frame.
 */
export const GEOMETRY_VS = /* glsl */`
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec4 skinIndex;
layout(location = 4) in vec4 skinWeight;
layout(location = 5) in vec3 color;
layout(location = 6) in mat4 instanceMatrix;
layout(location = 10) in vec3 instanceColor;
layout(location = 11) in mat4 prevInstanceMatrix;
layout(location = 15) in float morphSlot;

uniform mat4 uModel, uPrevModel;
uniform mat4 uViewProj;          // jittered (rasterisation)
uniform mat4 uViewProjFlat;      // unjittered (motion vectors)
uniform mat4 uPrevViewProj;      // last frame, unjittered
uniform mat3 uNormalMatrix;
#ifdef SKINNED
uniform sampler2D uBones, uPrevBones;
uniform mat4 uBindMatrix, uBindMatrixInverse;
mat4 bone(sampler2D t, float i) {
  int y = int(i);
  return mat4(texelFetch(t, ivec2(0, y), 0), texelFetch(t, ivec2(1, y), 0), texelFetch(t, ivec2(2, y), 0), texelFetch(t, ivec2(3, y), 0));
}
mat4 skinMatrix(sampler2D t) {
  return uBindMatrixInverse * (bone(t, skinIndex.x) * skinWeight.x + bone(t, skinIndex.y) * skinWeight.y
    + bone(t, skinIndex.z) * skinWeight.z + bone(t, skinIndex.w) * skinWeight.w) * uBindMatrix;
}
#endif
#ifdef MORPH
uniform highp sampler2D uMorphTex;
uniform int uMorphSlots, uMorphN;
uniform int uMorphIdx[16];
uniform float uMorphW[16], uMorphPW[16];
vec3 morphFetch(int unit, int slot) {
  int i = unit * uMorphSlots + slot;
  return texelFetch(uMorphTex, ivec2(i % 2048, i / 2048), 0).xyz;
}
#endif

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;
out vec4 vCur;
out vec4 vPrev;

void main() {
  vec4 p = vec4(position, 1.0);
  vec4 pp = p;
  vec3 n = normal;
#ifdef MORPH
  if (morphSlot >= 0.0) {
    int slot = int(morphSlot + 0.5);
    vec3 d = vec3(0.0), dp = vec3(0.0);
    for (int k = 0; k < 16; k++) {
      if (k >= uMorphN) break;
      vec3 m = morphFetch(uMorphIdx[k], slot);
      d += m * uMorphW[k];
      dp += m * uMorphPW[k];
    }
    p.xyz += d;
    pp.xyz += dp;
  }
#endif
  mat4 model = uModel;
  mat4 prevModel = uPrevModel;
#ifdef SKINNED
  mat4 sk = skinMatrix(uBones);
  pp = skinMatrix(uPrevBones) * pp;
  p = sk * p;
  n = mat3(sk) * n;
#endif
#ifdef INSTANCED
  model = uModel * instanceMatrix;
  prevModel = uPrevModel * prevInstanceMatrix;
  mat3 nm = transpose(inverse(mat3(model)));
#else
  mat3 nm = uNormalMatrix;
#endif
  vec4 w = model * p;
  vWorld = w.xyz;
  vNormal = normalize(nm * n);
  vUv = uv;
  vColor = color;
#ifdef INSTANCE_COLOR
  vColor *= instanceColor;
#endif
  vCur = uViewProjFlat * w;
  vPrev = uPrevViewProj * (prevModel * pp);
  gl_Position = uViewProj * w;
}`;

/**
 * Rain on surfaces (Med Engine 2): wet darkening of porous materials, glossier
 * surfaces, puddles with expanding raindrop ripples on horizontal ground, and
 * water running down walls. Driven by the frame's uWetness and uRain.
 */
export const WET_GLSL = /* glsl */`
uniform float uWetness, uRain, uGTime;
// One layer of raindrop ripples: a ring per cell with its own start time.
vec2 rippleLayer(vec2 p, float t, float seed) {
  vec2 cell = floor(p), f = fract(p);
  vec2 g = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(i, j);
    vec2 h = hash22(c + seed);
    vec2 centre = vec2(i, j) + h * 0.8 + 0.1;
    float start = hash12(c * 1.7 + seed);
    float age = fract(t * 0.9 + start);
    vec2 d = f - centre;
    float r = length(d);
    float ring = age * 1.1;
    float x = (r - ring) * 18.0;
    float w = exp(-x * x) * (1.0 - age) * (1.0 - age);
    g += d / max(r, 1e-3) * sin(x * 3.0) * w;
  }
  return g;
}
vec2 ripples(vec2 p, float t) {
  return (rippleLayer(p * 3.1, t, 0.0) + rippleLayer(p * 4.3 + 7.0, t * 1.13, 3.0) * 0.7) * uRain;
}
float puddleMask(vec2 p) {
  float n = fbm2(p * 0.35, 4) * 0.7 + fbm2(p * 1.7, 3) * 0.3;
  return smoothstep(0.52, 0.6, n + uWetness * 0.12 - 0.08);
}
`;

/** G-buffer fragment shader. Four targets:
 *  0 (sRGB8 A8)  base colour, specular occlusion
 *  1 (RGBA16F)   octahedral normal, roughness, metallic
 *  2 (RGBA16F)   motion vector (uv/frame), material type, material parameter
 *  3 (RGBA16F)   emitted radiance, unused
 */
export const GBUFFER_FS = /* glsl */`
${COMMON}
${WET_GLSL}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
in vec4 vCur;
in vec4 vPrev;

uniform vec3 uBaseColor;
uniform float uOpacity, uRoughness, uMetalness, uMatType, uMatParam, uSpecular, uAlphaTest, uUnlitScale, uWetFactor;
uniform vec3 uDetail;
uniform vec3 uEmissive;
uniform vec2 uNormalScale;
uniform sampler2D uMap, uNormalMap, uRoughMap, uEmissiveMap;
uniform mat3 uMapTransform, uNormalMapTransform, uRoughMapTransform;
uniform vec3 uCameraPos;
uniform vec2 uJitter;             // this frame's jitter in uv units, removed from motion
uniform float uFrame;

layout(location = 0) out vec4 g0;
layout(location = 1) out vec4 g1;
layout(location = 2) out vec4 g2;
layout(location = 3) out vec4 g3;

// Normal mapping without tangents: a cotangent frame built from screen-space
// derivatives (Schüler 2013).
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  return mat3(T * invmax, B * invmax, N);
}
vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 mapN) { return normalize(cotangentFrame(N, p, uv) * mapN); }

void main() {
  vec2 uvMap = (uMapTransform * vec3(vUv, 1.0)).xy;
  vec4 base = vec4(uBaseColor * vColor, uOpacity);
#if defined(USE_MAP) && !defined(BATSUIT)
  base *= texture(uMap, uvMap);
#endif
#ifdef ALPHA_DITHER
  // hair cards and lashes: stochastic transparency, resolved by the temporal filter
  float thr = mix(uAlphaTest * 0.45, 0.9, ign(gl_FragCoord.xy, uFrame));
  if (base.a < thr) discard;
#elif defined(ALPHA_TEST)
  if (base.a < uAlphaTest) discard;
#endif
#ifdef FLAT
  vec3 fn = cross(dFdx(vWorld), dFdy(vWorld));
  vec3 N = dot(fn, fn) > 1e-24 ? normalize(fn) : normalize(vNormal + vec3(0.0, 1e-6, 0.0));
#else
  vec3 N = normalize(vNormal + vec3(0.0, 1e-9, 0.0));
#endif
#if defined(DOUBLE_SIDED) || defined(BACK_SIDE)
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 Ng = N;
  float rough = uRoughness;
#ifdef USE_NORMALMAP
  vec2 uvN = (uNormalMapTransform * vec3(vUv, 1.0)).xy;
  vec3 mapN = texture(uNormalMap, uvN).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  N = perturb(N, vWorld, uvN, normalize(mapN));
#endif
#ifdef DETAIL
  {
    // micro detail in uv space: skin pores and fine lines, leather grain, fabric weave;
    // faded with distance (it would only alias far away)
    float dist = length(uCameraPos - vWorld);
    float k = 1.0 - smoothstep(0.8, 4.0, dist);
    if (k > 0.0) {
      vec2 q = vUv * uDetail.x;
      float e = 0.35;
      float h0 = vnoise(q), hx = vnoise(q + vec2(e, 0.0)), hy = vnoise(q + vec2(0.0, e));
      vec2 q2 = q * 2.9;
      float g0 = vnoise(q2), gx = vnoise(q2 + vec2(e, 0.0)), gy = vnoise(q2 + vec2(0.0, e));
      vec3 bump = vec3(((h0 - hx) * 0.65 + (g0 - gx) * 0.35) * uDetail.y, ((h0 - hy) * 0.65 + (g0 - gy) * 0.35) * uDetail.y, 1.0);
      N = perturb(N, vWorld, vUv, normalize(mix(vec3(0, 0, 1), bump, k)));
      rough = clamp(rough + (h0 - 0.5) * uDetail.z * 2.0 * k, 0.04, 1.0);
    }
  }
#endif
#ifdef BATSUIT
  {
    // The suit: the source garment's colour regions become raised armour panels (bump from
    // luminance), over a fine ballistic weave.
    vec2 px = vec2(1.0 / 1024.0);
    float hC = luma(texture(uMap, uvMap).rgb);
    float hX = luma(texture(uMap, uvMap + vec2(px.x, 0.0)).rgb);
    float hY = luma(texture(uMap, uvMap + vec2(0.0, px.y)).rgb);
    vec2 weaveUv = vUv * vec2(520.0, 520.0);
    float wx = sin(weaveUv.x * 6.2831) * 0.5 + 0.5, wy = sin(weaveUv.y * 6.2831) * 0.5 + 0.5;
    float weave = mix(wx, wy, step(0.5, fract(floor(weaveUv.x) * 0.5 + floor(weaveUv.y) * 0.5)));
    vec3 bump = vec3((hC - hX) * 6.0 + (wx - 0.5) * 0.12, (hC - hY) * 6.0 + (wy - 0.5) * 0.12, 1.0);
    N = perturb(N, vWorld, vUv, normalize(bump));
    float panel = smoothstep(0.08, 0.22, hC);
    base.rgb = mix(vec3(0.028, 0.029, 0.033), vec3(0.055, 0.056, 0.062), panel) * (0.92 + weave * 0.16);
    rough = mix(0.62, 0.38, panel);
  }
#endif
#ifdef USE_ROUGHMAP
  rough *= texture(uRoughMap, (uRoughMapTransform * vec3(vUv, 1.0)).xy).g;
#endif
#ifdef WET_SURFACE
  float wet = uWetness * uWetFactor;
  if (wet > 0.001) {
    float up = saturate(Ng.y);
    // porous things darken when wet; everything gets a film of water (Lagarde 2013)
    float porosity = saturate((rough - 0.3) * 1.6) * (1.0 - uMetalness);
    base.rgb *= mix(1.0, mix(1.0, 0.45, porosity), wet);
    rough = mix(rough, mix(0.32, 0.1, up), wet * mix(0.55, 0.95, up));
  #ifdef PUDDLES
    float pm = puddleMask(vWorld.xz) * smoothstep(0.85, 0.97, Ng.y) * wet;
    if (pm > 0.0) {
      vec2 rp = ripples(vWorld.xz, uGTime);
      vec3 pn = normalize(vec3(-rp.x * 0.5, 1.0, -rp.y * 0.5));
      N = normalize(mix(N, pn, pm));
      rough = mix(rough, 0.015, pm);
      base.rgb *= mix(1.0, 0.75, pm);
    } else if (uRain > 0.0 && Ng.y > 0.85) {
      vec2 rp = ripples(vWorld.xz, uGTime) * 0.25 * wet;
      N = normalize(N + vec3(-rp.x, 0.0, -rp.y));
    }
  #endif
  #ifdef RAIN_STREAKS
    float side = 1.0 - abs(Ng.y);
    if (side > 0.5 && uRain > 0.0) {
      vec2 sp = vec2(dot(vWorld.xz, vec2(0.7, 0.7)) * 9.0, vWorld.y * 1.5 + uGTime * 1.6);
      float col = floor(sp.x);
      float r = hash12(vec2(col, 3.1));
      float flow = smoothstep(0.6, 1.0, sin(sp.y * (1.0 + r) + r * 40.0)) * step(0.55, r);
      N = normalize(N + cross(Ng, vec3(0.0, 1.0, 0.0)) * (fract(sp.x) - 0.5) * flow * 0.6);
      rough = mix(rough, 0.05, flow * wet);
    }
  #endif
  }
#endif
  // Specular anti-aliasing: widen the lobe where the normal changes faster
  // than a pixel can resolve (Tokuyoshi & Kaplanyan 2019).
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  float a2 = rough * rough * rough * rough;
  rough = sqrt(sqrt(min(a2 + min(2.0 * variance, 0.18), 1.0)));
  rough = clamp(rough, 0.015, 1.0);

  vec3 emissive = uEmissive;
#ifdef USE_EMISSIVEMAP
  emissive *= texture(uEmissiveMap, uvMap).rgb;
#endif
#ifdef UNLIT
  emissive = base.rgb;
  base.rgb = vec3(0.0);
#endif

  vec2 cur = vCur.xy / vCur.w, prev = vPrev.xy / vPrev.w;
  vec2 motion = (cur - prev) * 0.5;

  g0 = vec4(saturate(base.rgb), uSpecular);
  g1 = vec4(encodeNormal(N), rough, uMetalness);
  g2 = vec4(motion, uMatType, uMatParam);
  g3 = vec4(emissive, 1.0);
}`;

/** Depth-only fragment shader for shadow maps (alpha-tested materials discard). */
export const DEPTH_FS = /* glsl */`
${COMMON}
in vec2 vUv;
in vec3 vWorld, vNormal, vColor;
in vec4 vCur, vPrev;
uniform sampler2D uMap;
uniform mat3 uMapTransform;
uniform float uAlphaTest, uFrame;
out vec4 o;
void main() {
#if defined(ALPHA_TEST) || defined(ALPHA_DITHER)
  float a = texture(uMap, (uMapTransform * vec3(vUv, 1.0)).xy).a;
  #ifdef ALPHA_DITHER
  if (a < mix(uAlphaTest * 0.45, 0.9, hash12(gl_FragCoord.xy))) discard;
  #else
  if (a < uAlphaTest) discard;
  #endif
#endif
  o = vec4(1.0);
}`;
