import { COMMON } from './common.js';

/**
 * One vertex shader for every pass that rasterises scene geometry:
 * G-buffer (with motion vectors), shadow maps and probe captures.
 * Skinning reads bone matrices from a float texture; instancing reads
 * per-instance matrices (and last frame's, for motion vectors).
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
  mat4 model = uModel;
  mat4 prevModel = uPrevModel;
#ifdef SKINNED
  mat4 sk = skinMatrix(uBones);
  pp = skinMatrix(uPrevBones) * p;
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

/** G-buffer fragment shader. Four targets:
 *  0 (sRGB8 A8)  base colour, specular occlusion
 *  1 (RGBA16F)   octahedral normal, roughness, metallic
 *  2 (RGBA16F)   motion vector (uv/frame), material type, material parameter
 *  3 (RGBA16F)   emitted radiance, unused
 */
export const GBUFFER_FS = /* glsl */`
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
in vec4 vCur;
in vec4 vPrev;

uniform vec3 uBaseColor;
uniform float uOpacity, uRoughness, uMetalness, uMatType, uMatParam, uSpecular, uAlphaTest, uUnlitScale;
uniform vec3 uEmissive;
uniform vec2 uNormalScale;
uniform sampler2D uMap, uNormalMap, uRoughMap, uEmissiveMap;
uniform mat3 uMapTransform, uNormalMapTransform, uRoughMapTransform;
uniform vec3 uCameraPos;
uniform vec2 uJitter;             // this frame's jitter in uv units, removed from motion

layout(location = 0) out vec4 g0;
layout(location = 1) out vec4 g1;
layout(location = 2) out vec4 g2;
layout(location = 3) out vec4 g3;

// Normal mapping without tangents: a cotangent frame built from screen-space
// derivatives (Schüler 2013).
vec3 perturb(vec3 N, vec3 p, vec2 uv, vec3 mapN) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  return normalize(mat3(T * invmax, B * invmax, N) * mapN);
}

void main() {
  vec2 uvMap = (uMapTransform * vec3(vUv, 1.0)).xy;
  vec4 base = vec4(uBaseColor * vColor, uOpacity);
#ifdef USE_MAP
  base *= texture(uMap, uvMap);
#endif
#ifdef ALPHA_TEST
  if (base.a < uAlphaTest) discard;
#endif
#ifdef FLAT
  // the face normal from screen derivatives; edge-on or sub-pixel faces give
  // a zero vector, which would put a NaN in the G-buffer (and through the
  // temporal passes, across the whole frame): fall back to the vertex normal
  vec3 fn = cross(dFdx(vWorld), dFdy(vWorld));
  vec3 N = dot(fn, fn) > 1e-24 ? normalize(fn) : normalize(vNormal + vec3(0.0, 1e-6, 0.0));
#else
  vec3 N = normalize(vNormal + vec3(0.0, 1e-9, 0.0));
#endif
#if defined(DOUBLE_SIDED) || defined(BACK_SIDE)
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 Ng = N;
#ifdef USE_NORMALMAP
  vec2 uvN = (uNormalMapTransform * vec3(vUv, 1.0)).xy;
  vec3 mapN = texture(uNormalMap, uvN).xyz * 2.0 - 1.0;
  mapN.xy *= uNormalScale;
  N = perturb(N, vWorld, uvN, normalize(mapN));
#endif
  float rough = uRoughness;
#ifdef USE_ROUGHMAP
  rough *= texture(uRoughMap, (uRoughMapTransform * vec3(vUv, 1.0)).xy).g;
#endif
  // Specular anti-aliasing: widen the lobe where the normal changes faster
  // than a pixel can resolve (Tokuyoshi & Kaplanyan 2019).
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  float a2 = rough * rough * rough * rough;
  rough = sqrt(sqrt(min(a2 + min(2.0 * variance, 0.18), 1.0)));
  rough = clamp(rough, 0.03, 1.0);

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
in vec2 vUv;
in vec3 vWorld, vNormal, vColor;
in vec4 vCur, vPrev;
uniform sampler2D uMap;
uniform mat3 uMapTransform;
uniform float uAlphaTest;
out vec4 o;
void main() {
#ifdef ALPHA_TEST
  if (texture(uMap, (uMapTransform * vec3(vUv, 1.0)).xy).a < uAlphaTest) discard;
#endif
  o = vec4(1.0);
}`;
