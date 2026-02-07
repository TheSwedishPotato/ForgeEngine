export const waterVertexShader = `
  uniform float uTime;
  uniform float uWaveHeight;
  uniform float uWaveFrequency;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vPosition = position;

    // Create wave effect
    float elevation = sin(position.x * uWaveFrequency + uTime * 0.5) *
                     sin(position.y * uWaveFrequency + uTime * 0.3) *
                     uWaveHeight;

    elevation += sin(position.x * uWaveFrequency * 2.0 - uTime * 0.7) *
                 sin(position.y * uWaveFrequency * 2.0 + uTime * 0.4) *
                 (uWaveHeight * 0.5);

    vElevation = elevation;

    vec3 newPosition = position;
    newPosition.z += elevation;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`

export const waterFragmentShader = `
  uniform float uTime;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  uniform float uOpacity;

  varying vec2 vUv;
  varying float vElevation;
  varying vec3 vPosition;

  void main() {
    // Mix colors based on elevation
    float mixStrength = (vElevation + 0.2) * 0.5;
    vec3 color = mix(uDeepColor, uShallowColor, mixStrength);

    // Add some shimmer effect
    float shimmer = sin(vPosition.x * 10.0 + uTime) *
                   cos(vPosition.y * 10.0 - uTime) * 0.1;
    color += shimmer;

    gl_FragColor = vec4(color, uOpacity);
  }
`
