/**
 * Lights. Units: `intensity` multiplies `color`; a directional light's intensity is irradiance on a
 * surface facing it (the sun is about 7), point / spot / tube intensities are radiant intensity
 * (candela-like) with an inverse-square falloff windowed to `distance`.
 *
 * The scene's first visible DirectionalLight is the sun: it drives the sky and the cascaded shadow
 * maps. Point, spot and tube lights go to the clustered light grid (up to 256 at once). A spot light
 * with `castShadow` renders into the 4x4 spot shadow atlas (up to 16 at once).
 */
import { Object3D } from './Object3D.js';
import { Color } from '../math/core.js';

/** @import { ColorRepresentation } from '../math/core.js' */

export class Light extends Object3D {
  /**
   * @param {ColorRepresentation} [color]  default white
   * @param {number} [intensity]  see the units at the top of the file (default 1)
   */
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.type = 'Light';
    this.color = new Color(color);
    this.intensity = intensity;
    /** Size of the emitting surface in metres: softens specular highlights. */
    this.radius = 0.05;
    /** 0..1: how strongly the light would scatter in fog and rain. Reserved: Med Engine 3 has no volumetric pass yet (Med Engine 2 had one), so for now this reaches the light grid and changes nothing you can see. */
    this.volumetric = 0;
  }
  get isLight() { return true; }
  copy(src, recursive) {
    super.copy(src, recursive);
    this.color.copy(src.color); this.intensity = src.intensity; this.radius = src.radius; this.volumetric = src.volumetric;
    return this;
  }
}

export class DirectionalLight extends Light {
  /**
   * @param {ColorRepresentation} [color]
   * @param {number} [intensity]  irradiance on a surface facing the light; the sun is about 7
   */
  constructor(color, intensity = 1) {
    super(color, intensity);
    this.type = 'DirectionalLight';
    this.position.set(0, 1, 0);
    this.target = new Object3D();
  }
  get isDirectionalLight() { return true; }
}

export class PointLight extends Light {
  /**
   * @param {ColorRepresentation} [color]
   * @param {number} [intensity]  radiant intensity, inverse-square falloff
   * @param {number} [distance]   metres where the light has faded to nothing (10)
   */
  constructor(color, intensity = 1, distance = 10) {
    super(color, intensity);
    this.type = 'PointLight';
    this.distance = distance;
  }
  get isPointLight() { return true; }
  copy(src, recursive) { super.copy(src, recursive); this.distance = src.distance; return this; }
}

export class SpotLight extends Light {
  /**
   * @param {ColorRepresentation} [color]
   * @param {number} [intensity]  radiant intensity
   * @param {number} [distance]   metres where the light has faded to nothing (20)
   * @param {number} [angle]      half the cone's angle in radians (PI / 4)
   * @param {number} [penumbra]   0..1: how much of the cone's edge is soft (0.3)
   */
  constructor(color, intensity = 1, distance = 20, angle = Math.PI / 4, penumbra = 0.3) {
    super(color, intensity);
    this.type = 'SpotLight';
    this.distance = distance; this.angle = angle; this.penumbra = penumbra;
    this.target = new Object3D();
  }
  get isSpotLight() { return true; }
  copy(src, recursive) { super.copy(src, recursive); this.distance = src.distance; this.angle = src.angle; this.penumbra = src.penumbra; return this; }
}

/** A fluorescent tube / neon strip along the light's local X axis. */
export class TubeLight extends Light {
  /**
   * @param {ColorRepresentation} [color]
   * @param {number} [intensity]
   * @param {number} [distance]  metres where the light has faded to nothing (8)
   * @param {number} [length]    metres, along the light's local X (1.2)
   */
  constructor(color, intensity = 1, distance = 8, length = 1.2) {
    super(color, intensity);
    this.type = 'TubeLight';
    this.distance = distance; this.length = length;
    this.radius = 0.02;
  }
  get isTubeLight() { return true; }
  copy(src, recursive) { super.copy(src, recursive); this.distance = src.distance; this.length = src.length; return this; }
}
