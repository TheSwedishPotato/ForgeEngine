/**
 * The observation deck's acrylic: a cylinder with hemispherical ends, 160 mm thick (cast PMMA,
 * n = 1.49), drawn over the finished image like the sea's surface. Looking out, you see the sea
 * through it (the water pass has already done the sea); what the glass adds is its reflections:
 * from inside, the deck's own lamps and furniture faintly mirrored in the inner face (4 % head
 * on); from outside, the sky or the depths. Against the water the outer face hardly reflects
 * at all (acrylic and sea water bend light nearly alike), which is why the view is so clear.
 */
import { Program, Target, postProgram, fullscreen, state } from '../../../duel1403/src/engine/gl/GL.js';
import { COMMON } from '../../../duel1403/src/engine/shaders/common.js';
import { OBS_DECK } from '../physics/mass.js';

const VS = /* glsl */`
layout(location = 0) in vec3 aPos;            // boat coordinates (y above the keel)
layout(location = 1) in vec3 aNormal;
uniform mat4 uBoatMat;
uniform mat4 uViewProj;
out vec3 vWorld; out vec3 vNormal; out vec4 vClip; out vec3 vLocal;
void main() {
  vec4 w = uBoatMat * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(uBoatMat) * aNormal);
  vLocal = aPos;
  vClip = uViewProj * w;
  gl_Position = vClip;
}`;

const FS = /* glsl */`
${COMMON}
in vec3 vWorld; in vec3 vNormal; in vec4 vClip; in vec3 vLocal;
uniform highp sampler2D uDepth;
uniform mat4 uInvProj;
uniform samplerCube uEnv;
uniform vec3 uCameraPos;
uniform vec3 uInterior;        // radiance of the deck's inside, for the reflections from within
uniform vec3 uLamp;            // the deck lamps' glint
uniform vec3 uWaterRad;
uniform float uSeaY;
out vec4 o;
void main() {
  vec2 ndc = vClip.xy / vClip.w;
  float d = texture(uDepth, ndc * 0.5 + 0.5).r;
  vec4 sp = uInvProj * vec4(ndc, d * 2.0 - 1.0, 1.0);
  if (d < 1.0 && -sp.z / sp.w < vClip.w - 0.01) discard;
  vec3 V = normalize(uCameraPos - vWorld);
  bool inside = dot(V, vNormal) < 0.0;
  vec3 N = inside ? -vNormal : vNormal;
  float cosT = max(dot(N, V), 0.0);
  vec3 col; float F;
  if (inside) {
    F = 0.039 + 0.961 * pow5(1.0 - cosT);
    vec3 R = reflect(-V, N);
    // the deck mirrored: brighter toward the floor lamps, the lamps themselves as soft glints
    col = uInterior * (0.6 + 0.4 * max(-R.y, 0.0));
    col += uLamp * pow(max(dot(R, normalize(vec3(0.3, -0.6, 0.2))), 0.0), 60.0);
  } else {
    bool wet = vWorld.y < uSeaY;
    F = wet ? 0.003 + 0.2 * pow5(1.0 - cosT) : 0.039 + 0.961 * pow5(1.0 - cosT);
    vec3 R = reflect(-V, N);
    col = wet ? uWaterRad * (0.4 + 0.6 * max(R.y, 0.0)) : min(textureLod(uEnv, R, 0.3).rgb, vec3(15.0));
  }
  // the slight green of thick acrylic at grazing angles
  float path = 0.16 / max(cosT, 0.15);
  float tint = 1.0 - exp(-path * 0.25);
  o = vec4(col * F + vec3(0.002, 0.004, 0.003) * tint, F + tint * 0.08);
  if (!(abs(o.r) + abs(o.g) + abs(o.b) + abs(o.a) < 1e30)) o = vec4(0.0);
  o = clamp(o, vec4(0.0), vec4(6e4, 6e4, 6e4, 1.0));
}`;

export class Acrylic {
  constructor(stage) { this.name = 'acrylic'; this.enabled = true; this.stage = stage; this.interior = [0.004, 0.0035, 0.003]; this.lamp = [0.02, 0.017, 0.013]; }

  init(r) {
    const gl = (this.gl = r.gl);
    this.prog = new Program(gl, VS, FS, {}, 'acrylic');
    this.copy = postProgram(gl, `in vec2 vUv; out vec4 o; uniform sampler2D uC; void main(){ o = texture(uC, vUv); }`, {}, 'acrylic-copy');
    // the capsule's inner face (the outer adds nothing a viewer would tell apart)
    const D = OBS_DECK, R = D.rIn + 0.02, h = D.length / 2, NA = 48, NS = 12;
    const P = [], Nn = [];
    const push = (x, y, z, nx, ny, nz) => { P.push(D.x + x, D.axisY + y, z); Nn.push(nx, ny, nz); };
    const ring = [];
    // rows from the aft pole over the cylinder to the forward pole
    for (let i = 0; i <= NS; i++) { const a = -Math.PI / 2 + (i / NS) * Math.PI / 2; ring.push({ x: -h + R * Math.sin(a), r: R * Math.cos(a), nx: Math.sin(a) }); }
    for (let i = 1; i < 6; i++) ring.push({ x: -h + (2 * h * i) / 6, r: R, nx: 0 });
    for (let i = 0; i <= NS; i++) { const a = (i / NS) * Math.PI / 2; ring.push({ x: h + R * Math.sin(a), r: R * Math.cos(a), nx: Math.sin(a) }); }
    // only above the deck saddle (the lower part sits in the casing)
    const floor = -(D.axisY - (D.axisY - 0.95));
    void floor;
    for (let i = 0; i < ring.length - 1; i++) {
      const A = ring[i], B = ring[i + 1];
      for (let j = 0; j < NA; j++) {
        const t0 = (j / NA) * Math.PI * 2, t1 = ((j + 1) / NA) * Math.PI * 2;
        const pt = (q, t) => [q.x, q.r * Math.sin(t), q.r * Math.cos(t), q.nx, Math.sqrt(Math.max(0, 1 - q.nx * q.nx)) * Math.sin(t), Math.sqrt(Math.max(0, 1 - q.nx * q.nx)) * Math.cos(t)];
        const a = pt(A, t0), b = pt(B, t0), c = pt(B, t1), e = pt(A, t1);
        // skip the part below the saddle (inside the deck casing)
        if (Math.max(a[1], b[1], c[1], e[1]) < -0.78) continue;
        for (const q of [a, b, c, a, c, e]) push(...q);
      }
    }
    this.count = P.length / 3;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(P), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Nn), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize(r) {
    if (!this.target) this.target = new Target(r.gl, { width: r.displayW, height: r.displayH, colors: [{ format: 'rgba16f' }] });
    else this.target.resize(r.displayW, r.displayH);
  }

  afterLighting(r, color) {
    const gl = r.gl, S = this.stage;
    this.target.bind();
    state(gl);
    this.copy.use().set('uC', color);
    fullscreen(gl);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    gl.disable(gl.CULL_FACE);
    this.prog.use().set('uBoatMat', S.boatMat).set('uViewProj', r.viewProj).set('uDepth', r.depth).set('uInvProj', r.invProj)
      .set('uEnv', r.env.spec).set('uCameraPos', r.cameraPos).set('uInterior', this.interior).set('uLamp', this.lamp)
      .set('uWaterRad', S.U.waterRad).set('uSeaY', 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return this.target.tex;
  }
}
