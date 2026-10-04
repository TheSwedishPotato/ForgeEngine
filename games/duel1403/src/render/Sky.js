import { Mesh, SphereGeometry, ShaderMaterial, BackSide, Vector3 } from 'three';

export const SUN_DIR = new Vector3(-0.55, 0.42, 0.72).normalize();

/**
 * Late-afternoon autumn sky: gradient, a low sun with glow, and drifting
 * fair-weather clouds from value noise. Big enough to sit behind
 * everything; also rendered into the environment map for reflections.
 */
export class Sky {
  constructor() {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 uSun; uniform float uTime; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 zenith = vec3(0.34, 0.47, 0.62);
          vec3 horizon = vec3(0.86, 0.82, 0.74);
          vec3 ground = vec3(0.36, 0.38, 0.30);
          vec3 col = h > 0.0 ? mix(horizon, zenith, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-h*6.0,0.0,1.0));
          float sd = max(dot(d, uSun), 0.0);
          col += vec3(1.0, 0.82, 0.55) * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.9);
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.9993, 0.9997, sd) * 6.0;
          if (h > 0.0) {
            vec2 uv = d.xz / (h + 0.18) * 1.6 + vec2(uTime * 0.004, 0.0);
            float c = smoothstep(0.52, 0.78, fbm(uv));
            vec3 cloud = mix(vec3(0.78, 0.76, 0.74), vec3(1.0, 0.93, 0.82), pow(sd, 3.0));
            col = mix(col, cloud, c * 0.8 * smoothstep(0.0, 0.12, h));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(800, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  update(t) {
    this.material.uniforms.uTime.value = t;
  }
}
