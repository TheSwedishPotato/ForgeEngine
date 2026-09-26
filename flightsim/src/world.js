// Outside world: sky & atmosphere, curved-earth terrain built from Natural Earth
// data, water, clouds (cumulus sprites + stratus decks), rain and weather state.
import * as THREE from 'three';
import { GEO } from '../data/geodata.js';
import { project, unproject, sunPosition, moonPosition, azElToVec, DEG, clamp, lerp, smoothstep, hash2, rng, sharedUniforms, CURVE_GLSL, fbm2 } from './core.js';
import { cloudTex } from './textures.js';

// Region covered by the data textures (world metres)
export const REGION = { x0: -420000, x1: 420000, z0: -470000, z1: 470000 };

// ---------------- shared GLSL ----------------
export const NOISE_GLSL = /* glsl */`
float hsh(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hsh(i),hsh(i+vec2(1,0)),u.x), mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
float fbm3(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<3;i++){ s+=a*vn(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
vec3 voro(vec2 p){ // returns (distance to border, cell id hash, dist to centre)
  vec2 n=floor(p), f=fract(p); vec2 mg, mr; float md=8.0; float id=0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=vec2(hsh(n+g), hsh(n+g+31.7)); vec2 r=g+o-f; float d=dot(r,r); if(d<md){ md=d; mr=r; mg=g; id=hsh(n+g+7.3);} }
  float bd=8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=mg+vec2(float(i),float(j)); vec2 o=vec2(hsh(n+g), hsh(n+g+31.7)); vec2 r=g+o-f; if(dot(mr-r,mr-r)>0.00001) bd=min(bd, dot(0.5*(mr+r), normalize(r-mr))); }
  return vec3(bd, id, sqrt(md));
}
`;

export const ATMOS_GLSL = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uHorizonSun; uniform vec3 uGroundHaze;
uniform float uCamAlt; uniform float uHazeD; uniform float uHazeH; uniform float uInCloud; uniform vec3 uCloudFog; uniform float uNight;
uniform vec3 uCamPos; uniform float uOvercastBelow;
uniform vec4 uGFog; // x,z centre, radius, visibility-scaled density
uniform float uGFogTop; uniform vec3 uGFogCol;
float gfogWeight(vec2 xz){ return uGFog.w <= 0.0 ? 0.0 : 1.0 - smoothstep(uGFog.z * 0.6, uGFog.z, length(xz - uGFog.xy)); }
vec3 skyCol(vec3 d){
  float dip = -sqrt(2.0*max(uCamAlt,2.0)/6371000.0);
  float e = d.y - dip;
  vec2 hd = normalize(d.xz + 1e-5); vec2 hs = normalize(uSunDir.xz + 1e-5);
  float toward = pow(max(dot(hd, hs), 0.0), 2.0);
  vec3 hor = mix(uHorizon, uHorizonSun, toward * smoothstep(0.35, 0.0, uSunDir.y + 0.05));
  float k = pow(1.0 - clamp(e, 0.0, 1.0), 5.0 + uCamAlt/2500.0);
  vec3 col = mix(uZenith, hor, k);
  if (e < 0.0) col = mix(hor, uGroundHaze, smoothstep(0.0, -0.08, e));
  float mu = dot(d, uSunDir);
  col += uSunCol * (0.06*pow(max(mu,0.0), 6.0) + 0.35*pow(max(mu,0.0), 48.0) + 1.3*pow(max(mu,0.0), 900.0)) * (1.0 - uOvercastBelow);
  return col;
}
// aerial perspective between camera and point p (world), returns vec4(fogColor, amount)
vec4 aerial(vec3 p){
  vec3 v = p - uCamPos; float dist = length(v); vec3 d = v / max(dist, 1e-3);
  float hc = uCamAlt, hp = hc + v.y;
  float H = uHazeH;
  float dh = hc - hp;
  float od;
  if (abs(dh) < 1.0) od = uHazeD * exp(-hc/H) * dist;
  else od = uHazeD * H * dist / dh * (exp(-hp/H) - exp(-hc/H));
  od += dist / 260000.0; // Rayleigh
  float f = 1.0 - exp(-max(od, 0.0));
  vec3 fc = skyCol(vec3(d.x, max(d.y, -0.02)*0.25, d.z));
  float mu = max(dot(d, uSunDir), 0.0);
  fc += uSunCol * 0.12 * pow(mu, 8.0) * (1.0 - uNight);
  // shallow radiation fog lying over the airfield
  if (uGFog.w > 0.0) {
    float Hf = uGFogTop * 0.6;
    float odf = abs(dh) < 0.5 ? exp(-hc / Hf) * dist : Hf * dist / dh * (exp(-hp / Hf) - exp(-hc / Hf));
    float wgt = max(gfogWeight(p.xz), gfogWeight(uCamPos.xz));
    float ff = 1.0 - exp(-uGFog.w * odf * wgt);
    fc = mix(fc, uGFogCol, ff / max(ff + f * (1.0 - ff), 1e-4) * ff);
    f = 1.0 - (1.0 - f) * (1.0 - ff);
  }
  // in-cloud fog
  float cf = 1.0 - exp(-dist * uInCloud / 55.0);
  fc = mix(fc, uCloudFog, cf); f = max(f, cf);
  return vec4(fc, clamp(f, 0.0, 1.0));
}
`;

// ---------------- geodata rasterisation ----------------
function decodeRing(r) { const out = []; let x = 0, y = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; out.push([y / 1e4, x / 1e4]); } return out; }

const FARM = [ // [value, [[lat,lon]...]] approximate agricultural plains
  [0.55, [[59.95, 17.35], [60.02, 17.75], [59.82, 17.85], [59.74, 17.6], [59.78, 17.3]]],
  [0.6, [[59.75, 16.35], [59.72, 17.25], [59.56, 17.4], [59.45, 16.9], [59.5, 16.3]]],
  [0.5, [[59.42, 16.2], [59.38, 17.2], [59.2, 17.3], [59.18, 16.4]]],
  [0.85, [[58.72, 15.0], [58.66, 16.3], [58.52, 16.4], [58.36, 15.9], [58.3, 15.3], [58.45, 14.95]]],
  [0.75, [[58.62, 13.0], [58.55, 13.9], [58.2, 14.05], [58.0, 13.6], [58.2, 12.8]]],
  [0.6, [[57.35, 16.95], [57.2, 17.15], [56.2, 16.62], [56.2, 16.35], [56.6, 16.42], [57.0, 16.72]]],
  [0.4, [[57.2, 16.35], [56.6, 16.32], [56.55, 16.05], [57.2, 16.2]]],
  [0.9, [[56.28, 12.45], [56.22, 13.4], [55.95, 14.25], [55.62, 14.4], [55.32, 14.2], [55.3, 13.0], [55.5, 12.85], [55.85, 12.72]]],
  [0.7, [[56.12, 13.85], [56.12, 14.4], [55.88, 14.4], [55.88, 13.85]]],
  [0.6, [[57.05, 12.15], [56.9, 12.6], [56.42, 12.98], [56.3, 12.8], [56.8, 12.2]]],
  [0.85, [[56.15, 11.7], [56.1, 12.62], [55.75, 12.6], [55.2, 12.25], [54.95, 11.7], [55.3, 11.05], [55.75, 10.85]]],
  [0.85, [[55.65, 9.65], [55.55, 10.85], [54.95, 10.85], [54.95, 9.65]]],
  [0.8, [[57.7, 7.9], [57.7, 10.7], [56.45, 10.95], [55.5, 9.6], [54.75, 9.35], [54.75, 8.0]]],
  [0.9, [[54.98, 10.95], [54.92, 12.2], [54.52, 12.05], [54.58, 10.95]]],
  [0.8, [[54.52, 9.4], [54.55, 14.5], [53.9, 14.5], [53.9, 9.4]]],
  [0.5, [[57.97, 18.1], [57.92, 19.05], [57.0, 18.55], [56.88, 18.1], [57.4, 18.05]]],
];
const LAKEY = [
  [0.75, [[57.85, 14.2], [57.95, 16.0], [57.2, 16.25], [56.5, 15.45], [56.4, 13.6], [57.2, 13.4]]],
  [0.6, [[59.32, 15.8], [59.28, 17.2], [58.78, 17.05], [58.82, 15.8]]],
  [0.35, [[60.2, 17.0], [60.2, 18.8], [59.55, 18.9], [59.6, 17.0]]],
  [0.5, [[58.9, 14.4], [58.95, 16.3], [58.55, 16.5], [58.3, 14.6]]],
];
const DECID = [
  [0.75, [[56.5, 12.3], [56.45, 14.9], [55.3, 14.6], [55.3, 12.4]]],
  [0.6, [[57.3, 11.8], [57.2, 12.9], [56.4, 13.2], [56.4, 12.4]]],
  [0.8, [[57.8, 7.9], [57.8, 13.0], [54.4, 13.0], [54.4, 7.9]]],
];

export function buildGeoTextures() {
  const N = 4096, NR = 1024;
  const W = REGION.x1 - REGION.x0, H = REGION.z1 - REGION.z0;
  const toPx = (lat, lon, n) => { const p = project(lat, lon); return [(p.x - REGION.x0) / W * n, (p.z - REGION.z0) / H * n]; };
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, N, N);
  const fillPolys = (ctx, polys, n, style) => {
    ctx.fillStyle = style; ctx.beginPath();
    for (const poly of polys) for (const ring of poly) {
      const pts = decodeRing(ring);
      pts.forEach(([la, lo], i) => { const [x, y] = toPx(la, lo, n); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  };
  fillPolys(g, GEO.land, N, '#ff0000');
  fillPolys(g, GEO.lakes, N, '#000000');
  // roads into the green channel
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const rd of GEO.roads) {
    const kind = rd[0]; const pts = decodeRing(rd.slice(1));
    g.strokeStyle = kind === 1 ? 'rgba(0,150,0,1)' : 'rgba(0,80,0,1)'; g.lineWidth = kind === 1 ? 1.1 : 0.8;
    g.beginPath(); pts.forEach(([la, lo], i) => { const [x, y] = toPx(la, lo, N); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }); g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  const id = g.getImageData(0, 0, N, N).data;
  const landData = new Uint8Array(N * N * 2);
  for (let i = 0, j = 0; i < id.length; i += 4, j += 2) { landData[j] = id[i]; landData[j + 1] = id[i + 1]; }
  const landTex = new THREE.DataTexture(landData, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  landTex.magFilter = THREE.LinearFilter; landTex.minFilter = THREE.LinearMipmapLinearFilter; landTex.generateMipmaps = true; landTex.anisotropy = 4;
  landTex.flipY = false; landTex.needsUpdate = true;

  // region texture: R farmland, G urban, B small lakes, A deciduous
  const rc = document.createElement('canvas'); rc.width = NR; rc.height = NR;
  const rg = rc.getContext('2d');
  const layer = (defs, base) => {
    const cc = document.createElement('canvas'); cc.width = NR; cc.height = NR; const cg = cc.getContext('2d');
    cg.fillStyle = `rgb(${base},${base},${base})`; cg.fillRect(0, 0, NR, NR);
    for (const [v, pts] of defs) { cg.fillStyle = `rgb(${v * 255 | 0},${v * 255 | 0},${v * 255 | 0})`; cg.beginPath(); pts.forEach(([la, lo], i) => { const [x, y] = toPx(la, lo, NR); if (i === 0) cg.moveTo(x, y); else cg.lineTo(x, y); }); cg.closePath(); cg.fill(); }
    const bc = document.createElement('canvas'); bc.width = NR; bc.height = NR; const bg = bc.getContext('2d');
    bg.filter = 'blur(6px)'; bg.drawImage(cc, 0, 0);
    return bg.getImageData(0, 0, NR, NR).data;
  };
  const farm = layer(FARM, 30), lakes = layer(LAKEY, 30), dec = layer(DECID, 40);
  const uc = document.createElement('canvas'); uc.width = NR; uc.height = NR; const ug = uc.getContext('2d');
  ug.fillStyle = '#000'; ug.fillRect(0, 0, NR, NR);
  fillPolys(ug, GEO.urban, NR, '#ffffff');
  for (const [name, lat, lon, pop] of GEO.places) { const [x, y] = toPx(lat, lon, NR); const r = clamp(Math.sqrt(pop) / 180, 1, 8); const gr = ug.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); ug.fillStyle = gr; ug.fillRect(x - r, y - r, 2 * r, 2 * r); }
  const ud = ug.getImageData(0, 0, NR, NR).data;
  const regData = new Uint8Array(NR * NR * 4);
  for (let i = 0; i < regData.length; i += 4) { regData[i] = farm[i]; regData[i + 1] = ud[i]; regData[i + 2] = lakes[i]; regData[i + 3] = dec[i]; }
  const regTex = new THREE.DataTexture(regData, NR, NR, THREE.RGBAFormat, THREE.UnsignedByteType);
  regTex.magFilter = THREE.LinearFilter; regTex.minFilter = THREE.LinearMipmapLinearFilter; regTex.generateMipmaps = true; regTex.flipY = false; regTex.needsUpdate = true;
  return { landTex, regTex, landData, N };
}

// ---------------- weather presets ----------------
export const WEATHER = {
  clear: { label: 'Clear skies', cumulus: 0.0, cuBase: 1400, cuTop: 2200, stratus: null, cirrus: 0.35, vis: 70000, turb: 0.18, rain: 0, wind: '210° / 8 kt', temp: [15, 16], metar: 'CAVOK' },
  fair: { label: 'Fair-weather cumulus', cumulus: 0.34, cuBase: 1150, cuTop: 2100, stratus: null, cirrus: 0.2, vis: 45000, turb: 0.4, rain: 0, wind: '220° / 12 kt', temp: [14, 15], metar: 'FEW038 SCT045' },
  broken: { label: 'Broken clouds', cumulus: 0.62, cuBase: 900, cuTop: 2000, stratus: null, cirrus: 0.45, vis: 30000, turb: 0.55, rain: 0, wind: '230° / 16 kt', temp: [12, 13], metar: 'BKN030' },
  rain: { label: 'Overcast with light rain', cumulus: 0.0, cuBase: 900, cuTop: 1800, stratus: { base: 420, top: 2300 }, cirrus: 0.0, vis: 9000, turb: 0.5, rain: 0.8, wind: '200° / 14 kt', temp: [10, 11], metar: '-RA BKN014 OVC020' },
  fog: { label: 'Morning fog at Arlanda', cumulus: 0.1, cuBase: 1300, cuTop: 1900, stratus: null, fog: { top: 70, airport: 'ARN' }, cirrus: 0.2, vis: 25000, turb: 0.2, rain: 0, wind: 'calm', temp: [8, 14], metar: 'BCFG' },
};

// ---------------- World ----------------
export class World {
  constructor(renderer, opts) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.weather = WEATHER[opts.weather] || WEATHER.fair;
    this.quality = opts.quality || 'medium';
    this.localTime = opts.localTime;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 900000);
    this.u = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uHorizonSun: { value: new THREE.Color() }, uGroundHaze: { value: new THREE.Color() },
      uCamAlt: { value: 0 }, uHazeD: { value: 1e-4 }, uHazeH: { value: 1500 }, uInCloud: { value: 0 }, uCloudFog: { value: new THREE.Color(0.8, 0.8, 0.82) },
      uNight: { value: 0 }, uCamPos: { value: new THREE.Vector3() }, uOvercastBelow: { value: 0 },
      uViewUp: sharedUniforms.uViewUp, uTime: { value: 0 },
      uAmbient: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudCov: { value: this.weather.cumulus }, uCloudAlt: { value: (this.weather.cuBase + this.weather.cuTop) / 2 },
      uWet: { value: this.weather.rain > 0 ? 1 : 0 },
      uLandingLight: { value: 0 }, uLLPos: { value: new THREE.Vector3() }, uLLDir: { value: new THREE.Vector3() },
      uGFog: sharedUniforms.uGFog, uGFogTop: sharedUniforms.uGFogTop, uGFogCol: sharedUniforms.uGFogCol,
    };
    if (this.weather.fog) {
      const c = project(59.6519, 17.9186);
      this.u.uGFog.value.set(c.x, c.z, 16000, 3.0 / 250);
      this.u.uGFogTop.value = this.weather.fog.top;
    }
    this.scene.fog = new THREE.FogExp2(0xffffff, 0); // haze & fog for scenery objects
    this.geo = buildGeoTextures();
    this._buildCloudMap();
    this._buildSky();
    this._buildTerrain();
    this._buildClouds();
    this._buildStratus();
  }

  // Cumulus coverage field (region-wide), shared by sprite placement and terrain shadows.
  _buildCloudMap() {
    const N = 512, cov = this.weather.cumulus;
    const data = new Uint8Array(N * N);
    this.cloudCovData = data; this.cloudCovN = N;
    if (cov > 0) {
      const W = REGION.x1 - REGION.x0, H = REGION.z1 - REGION.z0;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const x = REGION.x0 + (i + 0.5) / N * W, z = REGION.z0 + (j + 0.5) / N * H;
        const n = fbm2(x / 5200, z / 5200, 4) * 0.8 + fbm2(x / 40000, z / 40000, 2) * 0.35 - 0.07;
        data[j * N + i] = Math.round(smoothstep(1 - cov - 0.1, 1 - cov + 0.14, n) * 255);
      }
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.flipY = false; t.needsUpdate = true;
    this.cloudMap = t;
  }
  cloudCoverAt(x, z) {
    const N = this.cloudCovN, W = REGION.x1 - REGION.x0, H = REGION.z1 - REGION.z0;
    const i = clamp(Math.floor((x - REGION.x0) / W * N), 0, N - 1), j = clamp(Math.floor((z - REGION.z0) / H * N), 0, N - 1);
    return this.cloudCovData[j * N + i] / 255;
  }

  // ---------- sky (full-screen) ----------
  _buildSky() {
    const u = this.u;
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() }, uMoon: { value: 0 } }, u),
      depthWrite: false, depthTest: false,
      vertexShader: `varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
      fragmentShader: `
        varying vec2 vNdc; uniform mat4 uInvProj; uniform mat4 uCamRot; uniform float uMoon; uniform vec3 uMoonDir; uniform float uTime;
        ${ATMOS_GLSL}
        float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){
          vec4 v = uInvProj * vec4(vNdc, 1.0, 1.0); v /= v.w;
          vec3 d = normalize((uCamRot * vec4(normalize(v.xyz), 0.0)).xyz);
          vec3 col = skyCol(d);
          // stars
          if (uNight > 0.2 && d.y > -0.05) {
            vec3 q = d * 420.0; vec3 cell = floor(q); float r = h3(cell);
            if (r > 0.9965) { vec3 c = cell + 0.5; float s = smoothstep(0.35, 0.0, length(q - c)); col += vec3(0.8,0.85,1.0) * s * (uNight-0.2) * 1.4 * (0.4 + 0.6*h3(cell+3.1)); }
          }
          // moon
          float mm = dot(d, uMoonDir);
          col += vec3(0.9,0.92,1.0) * uMoon * (smoothstep(0.99992, 0.99996, mm) * 3.0 + pow(max(mm,0.0), 400.0)*0.15);
          col = mix(col, uCloudFog, clamp(uInCloud, 0.0, 1.0));
          if (uGFog.w > 0.0) { float inF = gfogWeight(uCamPos.xz) * (1.0 - smoothstep(uGFogTop * 0.6, uGFogTop * 1.6, uCamAlt)); col = mix(col, uGFogCol, inF * (1.0 - smoothstep(0.02, 0.45, d.y))); }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.sky = new THREE.Mesh(geo, mat); this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  // ---------- terrain ----------
  _buildTerrain() {
    const rings = this.quality === 'low' ? 170 : 250, segs = this.quality === 'low' ? 128 : 192;
    const r0 = 1.5, rMax = 520000;
    const k = Math.pow(rMax / r0, 1 / rings);
    const pos = [0, 0, 0]; const idx = [];
    for (let i = 1; i <= rings; i++) {
      const r = r0 * Math.pow(k, i);
      for (let j = 0; j < segs; j++) { const a = j / segs * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs, c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    const u = this.u;
    this.airportTex = { arn: { tex: null, o: new THREE.Vector2(), s: 1 }, cph: { tex: null, o: new THREE.Vector2(), s: 1 } };
    const mat = this.terrainMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({
        uLand: { value: this.geo.landTex }, uReg: { value: this.geo.regTex },
        uRegion: { value: new THREE.Vector4(REGION.x0, REGION.z0, REGION.x1 - REGION.x0, REGION.z1 - REGION.z0) },
        uCenter: { value: new THREE.Vector2() },
        uAp0: { value: null }, uAp0Box: { value: new THREE.Vector4(0, 0, 1, 1) }, uAp0Rot: { value: new THREE.Vector4(1, 0, 0, 1) },
        uAp1: { value: null }, uAp1Box: { value: new THREE.Vector4(0, 0, 1, 1) }, uAp1Rot: { value: new THREE.Vector4(1, 0, 0, 1) },
        uCloudMap: { value: this.cloudMap },
      }, u),
      vertexShader: `
        #include <common>
        uniform vec2 uCenter; uniform vec4 uRegion; uniform sampler2D uLand;
        uniform vec4 uAp0Box; uniform vec4 uAp1Box;
        varying vec3 vW; varying float vDist;
        ${CURVE_GLSL}
        ${NOISE_GLSL}
        void main(){
          vec3 p = position; vec2 wxz = uCenter + p.xz;
          vec2 ruv = (wxz - uRegion.xy) / uRegion.zw;
          float land = texture2D(uLand, ruv).r;
          float hills = (fbm3(wxz/9000.0)*90.0 + fbm3(wxz/1700.0)*18.0) * smoothstep(0.35, 0.9, land);
          vec2 a0 = (wxz - uAp0Box.xy); vec2 a1 = (wxz - uAp1Box.xy);
          float flat0 = smoothstep(uAp0Box.z*0.45, uAp0Box.z*0.9, length(a0));
          float flat1 = smoothstep(uAp1Box.z*0.45, uAp1Box.z*0.9, length(a1));
          float h = hills * flat0 * flat1;
          vec3 wp = vec3(wxz.x, h, wxz.y);
          vW = wp; vDist = length(p.xz);
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          mv = curveView(mv);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`.replace('void main(){', '#include <logdepthbuf_pars_vertex>\nvoid main(){'),
      fragmentShader: `
        uniform sampler2D uLand; uniform sampler2D uReg; uniform vec4 uRegion;
        uniform sampler2D uAp0; uniform vec4 uAp0Box; uniform vec4 uAp0Rot;
        uniform sampler2D uAp1; uniform vec4 uAp1Box; uniform vec4 uAp1Rot;
        uniform vec3 uAmbient; uniform float uTime; uniform float uCloudCov; uniform float uCloudAlt; uniform float uWet;
        uniform float uLandingLight; uniform vec3 uLLPos; uniform vec3 uLLDir;
        varying vec3 vW; varying float vDist;
        ${NOISE_GLSL}
        ${ATMOS_GLSL}
        #include <logdepthbuf_pars_fragment>
        uniform sampler2D uCloudMap;
        float cloudCov(vec2 xz){ return texture2D(uCloudMap, (xz - uRegion.xy) / uRegion.zw).r; }
        vec4 apSample(sampler2D t, vec4 box, vec4 ax, vec2 w){
          vec2 d = w - box.xy; vec2 l = vec2(dot(d, ax.xy), dot(d, ax.zw));
          vec2 uv = l / box.z + 0.5;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
          vec4 c = texture2D(t, uv);
          float e = min(min(uv.x, uv.y), min(1.0-uv.x, 1.0-uv.y));
          return c * smoothstep(0.0, 0.03, e);
        }
        void main(){
          #include <logdepthbuf_fragment>
          vec2 w = vW.xz;
          float px = max(fwidth(w.x), fwidth(w.y)); // metres per pixel
          vec2 ruv = (w - uRegion.xy) / uRegion.zw;
          // domain-warped coast lookup for sub-texel detail
          vec2 warp = (vec2(vn(w/700.0), vn(w/700.0+19.0)) - 0.5) * 220.0 * smoothstep(3000.0, 200.0, px*300.0);
          vec2 lt = texture2D(uLand, (w + warp - uRegion.xy)/uRegion.zw).rg;
          float land = smoothstep(0.42, 0.58, lt.r + (vn(w/180.0)-0.5)*0.25*smoothstep(60.0, 5.0, px));
          vec4 reg = texture2D(uReg, ruv);
          float farm = reg.r, urban = reg.g, lakeP = reg.b, decid = reg.a;
          float lat = 57.6 - w.y / 111370.0;
          // small lakes
          float ln = fbm(w/2600.0 + 3.1);
          float lakeT = 1.0 - 0.34*lakeP;
          float smallLake = smoothstep(lakeT, lakeT+0.012, ln) * land * (1.0 - smoothstep(0.2, 0.6, farm));
          float water = max(1.0 - land, smallLake);
          // ---- land cover ----
          float detail = smoothstep(90.0, 8.0, px); // pattern visibility
          vec3 v = voro(w / (farm > 0.6 ? 520.0 : 360.0));
          float fieldN = fbm(w/4200.0 + 7.0);
          float forestN = fbm(w/1500.0) * 0.75 + vn(w/260.0) * 0.25;
          float isField = smoothstep(0.02, -0.02, forestN - (0.28 + farm*0.62));
          float isUrban = smoothstep(0.35, 0.7, urban + (vn(w/900.0)-0.5)*0.3);
          // May colours
          float cid = v.y;
          float rape = smoothstep(59.0, 56.3, lat) * 0.26;
          vec3 fieldCol;
          if (cid < rape) fieldCol = vec3(0.72, 0.6, 0.06);          // rapeseed in bloom
          else if (cid < rape + 0.32) fieldCol = vec3(0.16, 0.27, 0.07); // winter wheat
          else if (cid < rape + 0.5) fieldCol = vec3(0.27, 0.21, 0.14);  // freshly sown soil
          else if (cid < rape + 0.68) fieldCol = vec3(0.21, 0.3, 0.1);   // ley / pasture
          else if (cid < rape + 0.8) fieldCol = vec3(0.3, 0.29, 0.16);   // stubble
          else fieldCol = vec3(0.19, 0.28, 0.11);
          fieldCol *= 0.85 + 0.3*vn(w/60.0);
          // rows / tramlines
          fieldCol *= 1.0 - 0.08 * detail * step(0.5, fract(dot(w, vec2(cos(cid*20.0), sin(cid*20.0)))/9.0)) * step(cid, 0.8);
          // hedges / field borders
          float border = smoothstep(0.035, 0.0, v.x) * detail;
          vec3 avgField = vec3(0.21, 0.27, 0.1);
          fieldCol = mix(avgField, fieldCol, detail*0.9 + 0.1);
          fieldCol = mix(fieldCol, vec3(0.1, 0.15, 0.06), border*0.6);
          vec3 conifer = vec3(0.045, 0.075, 0.035), broad = vec3(0.12, 0.2, 0.06);
          vec3 forestCol = mix(conifer, broad, clamp(decid*0.8 + (vn(w/400.0)-0.5)*0.4, 0.0, 1.0));
          forestCol *= 0.75 + 0.5*vn(w/35.0) * detail + 0.25*(1.0-detail);
          // clearings, bogs and rock outcrops in the forest
          float bog = smoothstep(0.62, 0.66, vn(w/700.0+40.0)) * (1.0-farm);
          forestCol = mix(forestCol, vec3(0.2, 0.21, 0.13), bog*0.5);
          vec3 urbanCol = vec3(0.3, 0.3, 0.3) * (0.7 + 0.5*vn(w/45.0)*detail);
          vec3 blocks = voro(w/140.0);
          urbanCol = mix(urbanCol, vec3(0.16,0.2,0.12), step(0.8, blocks.y)*0.8);
          urbanCol *= mix(1.0, 0.6, smoothstep(0.06, 0.0, blocks.x)*detail);
          vec3 col = mix(forestCol, fieldCol, isField);
          col = mix(col, urbanCol, isUrban);
          // roads
          col = mix(col, vec3(0.42,0.42,0.42), clamp(lt.g*1.6, 0.0, 0.7) * (1.0 - isUrban*0.5));
          // beach / shore
          float shore = smoothstep(0.62, 0.5, lt.r) * land;
          col = mix(col, vec3(0.55, 0.52, 0.42), shore*0.5);
          // airports
          vec4 a0 = apSample(uAp0, uAp0Box, uAp0Rot, w); vec4 a1 = apSample(uAp1, uAp1Box, uAp1Rot, w);
          float aw0 = a0.a * step(0.75, a0.b) * step(a0.r, 0.15) * step(a0.g, 0.15);
          float aw1 = a1.a * step(0.75, a1.b) * step(a1.r, 0.15) * step(a1.g, 0.15);
          col = mix(col, a0.rgb, a0.a * (1.0 - aw0)); col = mix(col, a1.rgb, a1.a * (1.0 - aw1));
          float apMask = max(a0.a * (1.0 - aw0), a1.a * (1.0 - aw1));
          water = max(water * (1.0 - apMask), max(aw0, aw1));
          if (uNight > 0.1) col += col * apMask * uNight * step(0.3, dot(col, vec3(0.33))) * 1.5;
          if (uWet > 0.5) col *= 0.78;
          // ---- lighting ----
          vec3 n = vec3(0.0, 1.0, 0.0);
          float hn = (vn(w/180.0) - 0.5) * detail;
          n = normalize(vec3(hn*0.35, 1.0, (vn(w/180.0+5.0)-0.5)*0.35*detail));
          vec3 cp = vW + uSunDir * ((uCloudAlt - vW.y) / max(uSunDir.y, 0.05));
          float shadow = 1.0 - 0.72 * cloudCov(cp.xz) * step(0.0, uSunDir.y);
          float ndl = max(dot(n, uSunDir), 0.0);
          vec3 lit = col * (uSunCol * ndl * shadow + uAmbient);
          // water
          vec3 V = normalize(uCamPos - vW);
          float wk = smoothstep(6.0, 0.8, px);   // fine ripples only where they are resolvable
          float wk2 = smoothstep(80.0, 8.0, px);
          vec2 wn = vec2(vn(w/13.0 + uTime*0.4) - 0.5, vn(w/11.0 - uTime*0.35 + 7.0) - 0.5) * 0.35 * wk + vec2(vn(w/170.0 + uTime*0.05) - 0.5, vn(w/150.0+3.0) - 0.5) * 0.22 * wk2 + vec2(vn(w/1400.0) - 0.5, vn(w/1300.0+9.0) - 0.5) * 0.12;
          vec3 N = normalize(vec3(wn.x, 1.0, wn.y));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          vec3 sky = skyCol(vec3(R.x, max(R.y, 0.0), R.z));
          vec3 H = normalize(V + uSunDir);
          float spec = pow(max(dot(N, H), 0.0), mix(60.0, 380.0, wk2)) * mix(4.0, 60.0, wk2) * shadow;
          vec3 deep = mix(vec3(0.012, 0.03, 0.045), vec3(0.02, 0.045, 0.05), smallLake);
          vec3 wat = deep * (uAmbient + uSunCol*0.5) + sky * fres + uSunCol * spec;
          lit = mix(lit, wat, water);
          // night lights
          if (uNight > 0.05) {
            float sp = step(0.72, vn(w/28.0)) * isUrban + step(0.93, vn(w/40.0)) * isField * 0.2;
            float rd = clamp(lt.g*2.0, 0.0, 1.0) * step(0.6, vn(w/60.0));
            vec3 em = vec3(1.0, 0.62, 0.3) * (sp*urban*2.2 + rd*0.6 + isUrban*urban*0.25);
            lit += em * uNight * (1.0 - water) * (detail*0.7+0.3);
          }
          // landing lights pool
          if (uLandingLight > 0.0) {
            vec3 lv = vW - uLLPos; float ld = length(lv);
            float cone = smoothstep(0.93, 0.99, dot(lv/ld, uLLDir));
            lit += col * vec3(1.0,0.95,0.85) * cone * uLandingLight * 900.0 / (ld*ld + 400.0);
          }
          // distant flat cumulus seen from above
          if (uCloudCov > 0.0 && uCamAlt > uCloudAlt + 300.0) {
            vec3 dv = vW - uCamPos; float tt = (uCloudAlt - uCamPos.y) / dv.y;
            if (tt > 0.0 && tt < 1.0) {
              vec3 cpos = uCamPos + dv * tt; float cc = cloudCov(cpos.xz);
              float far = smoothstep(22000.0, 34000.0, length(cpos.xz - uCamPos.xz));
              vec3 ccol = vec3(1.0) * (uSunCol * (0.65 + 0.35*vn(cpos.xz/300.0)) + uAmbient * 1.4);
              lit = mix(lit, ccol, cc * far * 0.95);
            }
          }
          vec4 ap = aerial(vW);
          vec3 outc = mix(lit, ap.rgb, ap.a);
          gl_FragColor = vec4(outc, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    mat.extensions = { derivatives: true };
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.frustumCulled = false;
    this.scene.add(this.terrain);
  }

  // axisX/axisY: world directions (unit Vector2) of the texture's x and y axes.
  setAirportTexture(i, tex, centre, size, axisX, axisY) {
    const U = this.terrainMat.uniforms;
    U['uAp' + i].value = tex;
    U['uAp' + i + 'Box'].value.set(centre.x, centre.y, size, size);
    U['uAp' + i + 'Rot'].value.set(axisX.x, axisX.y, axisY.x, axisY.y);
  }

  // ---------- cumulus sprites ----------
  _buildClouds() {
    const W = this.weather;
    this.cloudCells = 2200; // metres per cell
    this.cloudRange = this.quality === 'low' ? 18000 : 30000;
    const maxPuffs = this.quality === 'low' ? 5000 : 11000;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.cPos = new Float32Array(maxPuffs * 4); this.cAttr = new Float32Array(maxPuffs * 4);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.cPos, 4));
    geo.setAttribute('iAttr', new THREE.InstancedBufferAttribute(this.cAttr, 4));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uTex: { value: cloudTex() } }, this.u),
      transparent: true, depthWrite: false,
      vertexShader: `
        #include <common>
        attribute vec4 iPos; attribute vec4 iAttr; varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vW; varying float vTile; varying float vSunward;
        ${CURVE_GLSL}
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uCamPos; uniform vec3 uSunDir;
        void main(){
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          mv = curveView(mv);
          float size = iPos.w;
          float dist = length(mv.xyz);
          mv.xy += position.xy * size;
          vUv = position.xy*0.5+0.5; vTile = iAttr.z; vShade = iAttr.x;
          float near = smoothstep(size*0.4, size*1.6, dist);
          vAlpha = iAttr.y * near;
          vW = iPos.xyz;
          vSunward = dot(normalize(iPos.xyz - uCamPos), uSunDir);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec3 uAmbient; varying vec2 vUv; varying float vShade; varying float vAlpha; varying vec3 vW; varying float vTile; varying float vSunward;
        ${ATMOS_GLSL}
        #include <logdepthbuf_pars_fragment>
        void main(){
          #include <logdepthbuf_fragment>
          vec2 off = vec2(mod(vTile, 2.0), floor(vTile/2.0)) * 0.5;
          vec4 t = texture2D(uTex, vUv*0.5 + off);
          float a = t.a * vAlpha;
          if (a < 0.01) discard;
          float lightK = mix(0.55, 1.0, vShade) * t.r;
          vec3 c = uSunCol * lightK * (0.9 + 0.5*pow(max(vSunward,0.0), 6.0)) + uAmbient * mix(1.1, 1.6, vShade);
          vec4 ap = aerial(vW);
          c = mix(c, ap.rgb, ap.a*0.9);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(geo, mat); this.clouds.frustumCulled = false; this.clouds.renderOrder = 2;
    this.scene.add(this.clouds);
    this.cloudCenter = null;
    this.maxPuffs = maxPuffs;
  }

  _rebuildClouds(cx, cz) {
    const W = this.weather, cov = W.cumulus;
    if (cov <= 0) { this.clouds.geometry.instanceCount = 0; return; }
    const S = this.cloudCells, R = this.cloudRange;
    const i0 = Math.floor((cx - R) / S), i1 = Math.floor((cx + R) / S), j0 = Math.floor((cz - R) / S), j1 = Math.floor((cz + R) / S);
    let n = 0; const P = this.cPos, A = this.cAttr;
    const puffs = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const hx = hash2(i, j), hz = hash2(j + 99, i - 7);
      const x = (i + hx) * S, z = (j + hz) * S;
      if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
      // same coverage field as the terrain shader, so shadows line up
      const c = this.cloudCoverAt(x, z);
      if (hash2(i * 3 + 1, j * 5 + 2) > c * 1.15) continue;
      const r = rng((i * 73856093) ^ (j * 19349663));
      const size = lerp(0.6, 1.25, r()) * (0.7 + c * 0.5);
      const width = 900 * size, depth = (W.cuTop - W.cuBase) * (0.55 + 0.45 * r());
      const count = Math.floor(7 + 9 * size);
      for (let k = 0; k < count; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * width;
        const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr * 0.8;
        const hf = (1 - rr / width);
        const py = W.cuBase + 120 + depth * (0.15 + 0.75 * hf * r());
        const ps = (260 + 240 * r()) * (0.7 + hf * 0.6) * size;
        puffs.push([px, py, pz, ps, clamp((py - W.cuBase) / depth, 0, 1), 0.85, Math.floor(r() * 4)]);
      }
    }
    this.puffs = puffs;
    this._sortClouds(cx, this.lastCamY ?? 0, cz);
  }

  _sortClouds(cx, cy, cz) {
    const puffs = this.puffs; if (!puffs) return;
    puffs.sort((a, b) => ((b[0] - cx) ** 2 + (b[1] - cy) ** 2 + (b[2] - cz) ** 2) - ((a[0] - cx) ** 2 + (a[1] - cy) ** 2 + (a[2] - cz) ** 2));
    const n = Math.min(puffs.length, this.maxPuffs); const P = this.cPos, A = this.cAttr;
    for (let k = 0; k < n; k++) { const p = puffs[k]; P[k * 4] = p[0]; P[k * 4 + 1] = p[1]; P[k * 4 + 2] = p[2]; P[k * 4 + 3] = p[3]; A[k * 4] = p[4]; A[k * 4 + 1] = p[5]; A[k * 4 + 2] = p[6]; }
    const g = this.clouds.geometry; g.instanceCount = n;
    g.attributes.iPos.needsUpdate = true; g.attributes.iAttr.needsUpdate = true;
  }

  // ---------- stratus decks ----------
  _buildStratus() {
    const st = this.weather.stratus;
    this.decks = [];
    if (!st) return;
    const rings = 90, segs = 96, r0 = 20, rMax = 300000, k = Math.pow(rMax / r0, 1 / rings);
    const pos = [0, 0, 0], idx = [];
    for (let i = 1; i <= rings; i++) { const r = r0 * Math.pow(k, i); for (let j = 0; j < segs; j++) { const a = j / segs * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); } }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) { const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs; idx.push(a, b, a + segs, b, b + segs, a + segs); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    for (const which of ['top', 'base']) {
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({ uAlt: { value: which === 'top' ? st.top : st.base }, uTop: { value: which === 'top' ? 1 : 0 }, uCenter: { value: new THREE.Vector2() } }, this.u),
        side: THREE.DoubleSide,
        vertexShader: `#include <common>
          uniform vec2 uCenter; uniform float uAlt; uniform float uTop; varying vec3 vW;
          ${CURVE_GLSL}
          ${NOISE_GLSL}
          #include <logdepthbuf_pars_vertex>
          void main(){ vec2 w = uCenter + position.xz; float bump = uTop > 0.5 ? (fbm3(w/2500.0)*260.0 - 80.0) : (fbm3(w/3000.0)*-120.0);
            vW = vec3(w.x, uAlt + bump, w.y); vec4 mv = curveView(viewMatrix * vec4(vW, 1.0)); gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader: `uniform float uTop; uniform vec3 uAmbient; uniform float uTime; varying vec3 vW;
          ${NOISE_GLSL}
          ${ATMOS_GLSL}
          #include <logdepthbuf_pars_fragment>
          void main(){
            #include <logdepthbuf_fragment>
            vec2 w = vW.xz;
            vec3 col;
            if (uTop > 0.5) {
              float n = fbm(w/900.0 + uTime*0.002); float n2 = fbm(w/160.0);
              vec3 nrm = normalize(vec3((fbm3(w/700.0+1.3)-fbm3(w/700.0-1.3))*2.0, 1.0, (fbm3(w/700.0+7.3)-fbm3(w/700.0+4.7))*2.0));
              float l = max(dot(nrm, uSunDir), 0.0);
              col = uSunCol * (0.55 + 0.45*l) * (0.85 + 0.15*n2) + uAmbient * 1.3;
            } else {
              float n = fbm(w/1200.0); col = (uAmbient * 1.25 + uSunCol*0.12) * (0.55 + 0.25*n);
            }
            vec4 ap = aerial(vW);
            col = mix(col, ap.rgb, ap.a);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 1;
      this.scene.add(m); this.decks.push({ mesh: m, which, mat });
    }
  }

  // ---------- per-frame ----------
  update(dt, simT, fm, camPos, camQuat, localHours) {
    const u = this.u;
    u.uTime.value = simT;
    const ll = unproject(fm.pos.x, fm.pos.z);
    const sun = sunPosition(localHours, ll.lat, ll.lon);
    const moon = moonPosition(localHours, ll.lat, ll.lon);
    this.sunEl = sun.el / DEG; this.sunAz = sun.az / DEG;
    const sd = azElToVec(sun.az, Math.max(sun.el, -0.3));
    u.uSunDir.value.copy(sd);
    u.uMoonDir.value.copy(azElToVec(moon.az, moon.el));
    this.sky.material.uniforms.uMoon.value = moon.el > 0 ? 0.3 + moon.illum : 0;
    const alt = camPos.y;
    u.uCamAlt.value = alt; u.uCamPos.value.copy(camPos); sharedUniforms.uCamPosW.value.copy(camPos);
    this.lastCamY = alt;
    const W = this.weather;
    const el = this.sunEl;
    // sun colour & intensity (air mass reddening)
    const day = smoothstep(-4, 10, el);
    const low = smoothstep(18, 0, el);
    const sunI = smoothstep(-2.5, 4, el) * 3.2 * (1 + alt / 30000);
    const sunCol = new THREE.Color(1.0, lerp(0.96, 0.58, low), lerp(0.9, 0.3, low)).multiplyScalar(sunI);
    const st = W.stratus;
    const below = st ? clamp((st.base - alt) / 50 + 1, 0, 1) * (alt < st.top ? 1 : 0) : 0;
    const inside = st ? smoothstep(st.base - 40, st.base + 60, alt) * (1 - smoothstep(st.top - 80, st.top + 30, alt)) : 0;
    u.uOvercastBelow.value = st ? (alt < st.base ? 1 : 0) : 0;
    const shade = st && alt < st.top ? lerp(0.3, 0.55, clamp((alt - st.base) / (st.top - st.base), 0, 1)) : 1;
    u.uSunCol.value.copy(sunCol).multiplyScalar(st && alt < st.base ? 0.0 : 1);
    // sky colours
    const altK = clamp(alt / 11000, 0, 1);
    const twi = smoothstep(-14, 2, el);
    const nightK = 1 - smoothstep(-10, 1, el);
    this.nightK = nightK; u.uNight.value = nightK;
    const zen = new THREE.Color().setRGB(lerp(0.2, 0.06, altK), lerp(0.4, 0.16, altK), lerp(0.85, 0.55, altK)).multiplyScalar(lerp(0.02, 1.0, twi) * (0.5 + 0.5 * day));
    const hor = new THREE.Color().setRGB(0.66, 0.76, 0.9).multiplyScalar(lerp(0.03, 1.05, twi) * (0.4 + 0.6 * day));
    const horSun = new THREE.Color().setRGB(1.0, lerp(0.5, 0.75, day), lerp(0.25, 0.6, day)).multiplyScalar(lerp(0.12, 1.3, twi));
    const ground = new THREE.Color().setRGB(0.32, 0.36, 0.42).multiplyScalar(lerp(0.02, 0.9, twi));
    if (st && alt < st.top) {
      const g = lerp(0.08, 0.62, twi) * shade;
      zen.setRGB(g * 0.95, g, g * 1.04); hor.setRGB(g * 1.05, g * 1.07, g * 1.1); horSun.copy(hor); ground.copy(hor).multiplyScalar(0.8);
    }
    u.uZenith.value.copy(zen); u.uHorizon.value.copy(hor); u.uHorizonSun.value.copy(horSun); u.uGroundHaze.value.copy(ground);
    u.uAmbient.value.copy(zen).lerp(hor, 0.5).multiplyScalar(0.55).add(new THREE.Color(0.004, 0.005, 0.008));
    // haze
    u.uHazeD.value = 3.2 / W.vis; u.uHazeH.value = 1300;
    u.uGFogCol.value.setRGB(0.78, 0.8, 0.83).multiplyScalar(lerp(0.06, 1.0, twi)).lerp(new THREE.Color(1, 0.86, 0.7).multiplyScalar(lerp(0.06, 1.0, twi)), low * 0.35);
    u.uCloudFog.value.setRGB(0.72, 0.74, 0.78).multiplyScalar(lerp(0.05, 1.0, twi) * (st ? lerp(0.55, 1.0, clamp((alt - st.base) / (st.top - st.base), 0, 1)) : 1));
    // exponential-squared fog for buildings, trees and aircraft (the terrain has its own aerial perspective)
    const F = this.scene.fog;
    let dens = 1.3 / W.vis, fcol = hor.clone().lerp(new THREE.Color(0.5, 0.52, 0.55), 0.2);
    if (W.fog) {
      const g = u.uGFog.value; const inside = (1 - smoothstep(g.z * 0.6, g.z, Math.hypot(camPos.x - g.x, camPos.z - g.y))) * (1 - smoothstep(W.fog.top, W.fog.top * 4, alt));
      dens = lerp(dens, 1 / 280, inside); fcol.lerp(u.uGFogCol.value, inside);
    }
    if (st && alt < st.base) dens = Math.max(dens, 1 / 6000);
    F.density = dens; F.color.copy(fcol);
    // in-cloud (stratus or near cumulus)
    let inCloud = inside;
    this.inCloud = inCloud;
    u.uInCloud.value = inCloud * 1.0;
    u.uCloudAlt.value = (W.cuBase + W.cuTop) / 2;
    // terrain follows camera
    this.terrain.material.uniforms.uCenter.value.set(camPos.x, camPos.z);
    for (const d of this.decks) d.mat.uniforms.uCenter.value.set(camPos.x, camPos.z);
    // clouds rebuild on movement
    if (!this.cloudCenter || Math.hypot(camPos.x - this.cloudCenter.x, camPos.z - this.cloudCenter.y) > this.cloudCells * 1.5) {
      this.cloudCenter = new THREE.Vector2(camPos.x, camPos.z);
      this._rebuildClouds(camPos.x, camPos.z);
      this._sortT = 0;
    } else {
      this._sortT = (this._sortT || 0) + dt;
      if (this._sortT > 1.5) { this._sortT = 0; this._sortClouds(camPos.x, camPos.y, camPos.z); }
    }
    // near-cumulus in-cloud check (for turbulence & fog)
    if (this.puffs && W.cumulus > 0 && alt > W.cuBase && alt < W.cuTop + 200) {
      let best = 0;
      for (let k = this.puffs.length - 1; k >= Math.max(0, this.puffs.length - 60); k--) {
        const p = this.puffs[k]; const d = Math.hypot(p[0] - camPos.x, p[1] - camPos.y, p[2] - camPos.z);
        best = Math.max(best, clamp(1 - d / (p[3] * 0.9), 0, 1));
      }
      this.inCloud = Math.max(this.inCloud, best);
      u.uInCloud.value = Math.max(u.uInCloud.value, best * 0.9);
    }
    return { sunDir: sd, sunCol, nightK, day, ambient: u.uAmbient.value, zenith: zen, horizon: hor, inCloud: this.inCloud, belowOvercast: !!(st && alt < st.base), moon };
  }

  render(renderer, camera) {
    const U = this.sky.material.uniforms;
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamRot.value.extractRotation(camera.matrixWorld);
    renderer.render(this.scene, camera);
  }
}
