/**
 * The car's materials: brushed 304 stainless steel over everything above the sill, the dark
 * grey urethane of the bumpers, black rubber and plastic trim, grey leather inside, and the
 * time machine's aluminium boxes, cables and lamps. (The Med Engine reads three's standard
 * and physical materials: colour, roughness, metalness, normal/roughness maps, emissive.)
 */
import { MeshStandardMaterial, MeshPhysicalMaterial, Color, DoubleSide } from 'three';
import { brushedSteel, grainNormal, carpetTexture } from './textures.js';

let _m = null;
export function carMaterials() {
  if (_m) return _m;
  const b = brushedSteel();
  const grain = grainNormal(5, 1, 1.2), fine = grainNormal(9, 2, 0.6);
  const std = (o) => new MeshStandardMaterial(o);
  _m = {
    // AISI 304, No. 4 brushed: a bright, slightly yellow-neutral metal with streaky roughness
    steel: std({ color: new Color(0.6, 0.6, 0.6), metalness: 1, roughness: 0.34, normalMap: b.normal, normalScale: { x: 0.55, y: 0.55 }, roughnessMap: b.rough }),
    steelDark: std({ color: new Color(0.42, 0.42, 0.43), metalness: 1, roughness: 0.45, normalMap: b.normal, normalScale: { x: 0.4, y: 0.4 } }),
    bumper: std({ color: new Color(0.035, 0.036, 0.038), roughness: 0.62, normalMap: fine, normalScale: { x: 0.3, y: 0.3 } }),
    tailPanel: std({ color: new Color(0.02, 0.02, 0.021), roughness: 0.5 }),
    grille: std({ color: new Color(0.02, 0.02, 0.021), roughness: 0.5 }),
    trim: std({ color: new Color(0.012, 0.012, 0.013), roughness: 0.38, side: DoubleSide }),
    rubber: std({ color: new Color(0.015, 0.015, 0.015), roughness: 0.75 }),
    under: std({ color: new Color(0.03, 0.03, 0.032), roughness: 0.85 }),
    well: std({ color: new Color(0.012, 0.012, 0.012), roughness: 0.95, side: DoubleSide }),
    deck: std({ color: new Color(0.025, 0.025, 0.027), roughness: 0.55 }),
    chrome: std({ color: new Color(0.85, 0.85, 0.86), metalness: 1, roughness: 0.08 }),
    alloy: std({ color: new Color(0.62, 0.63, 0.64), metalness: 1, roughness: 0.28 }),
    alloyDark: std({ color: new Color(0.18, 0.18, 0.19), metalness: 1, roughness: 0.45 }),
    tire: std({ color: new Color(0.022, 0.022, 0.022), roughness: 0.82, normalMap: fine, normalScale: { x: 0.4, y: 0.4 } }),
    tireLetters: std({ color: new Color(0.5, 0.5, 0.5), roughness: 0.7 }),
    brake: std({ color: new Color(0.3, 0.29, 0.28), metalness: 1, roughness: 0.55 }),
    // the lamps (their emissive is driven by the car: headlamps, tail, brake, indicators)
    headLens: new MeshPhysicalMaterial({ color: new Color(0.8, 0.82, 0.84), roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color(1, 0.94, 0.82), emissiveIntensity: 0 }),
    reflector: std({ color: new Color(0.8, 0.8, 0.8), metalness: 1, roughness: 0.15 }),
    tailRed: new MeshPhysicalMaterial({ color: new Color(0.35, 0.01, 0.01), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color(1, 0.04, 0.02), emissiveIntensity: 0 }),
    brakeRed: new MeshPhysicalMaterial({ color: new Color(0.35, 0.01, 0.01), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color(1, 0.04, 0.02), emissiveIntensity: 0 }),
    amber: new MeshPhysicalMaterial({ color: new Color(0.6, 0.25, 0.02), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color(1, 0.45, 0.05), emissiveIntensity: 0 }),
    reverse: new MeshPhysicalMaterial({ color: new Color(0.7, 0.7, 0.7), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05, emissive: new Color(1, 1, 1), emissiveIntensity: 0 }),
    plate: null,     // set by the body (OUTATIME)
    badge: std({ color: new Color(0.8, 0.8, 0.82), metalness: 1, roughness: 0.18 }),
    // inside
    leather: std({ color: new Color(0.16, 0.16, 0.165), roughness: 0.58, normalMap: grain, normalScale: { x: 0.35, y: 0.35 } }),
    leatherDark: std({ color: new Color(0.06, 0.06, 0.062), roughness: 0.55, normalMap: grain, normalScale: { x: 0.35, y: 0.35 } }),
    dashTop: std({ color: new Color(0.13, 0.13, 0.135), roughness: 0.7, normalMap: grain, normalScale: { x: 0.3, y: 0.3 } }),
    plastic: std({ color: new Color(0.1, 0.1, 0.105), roughness: 0.6, normalMap: fine, normalScale: { x: 0.25, y: 0.25 } }),
    plasticBlack: std({ color: new Color(0.018, 0.018, 0.019), roughness: 0.5 }),
    liner: std({ color: new Color(0.085, 0.085, 0.088), roughness: 0.62, normalMap: grain, normalScale: { x: 0.3, y: 0.3 } }),
    headliner: std({ color: new Color(0.11, 0.11, 0.115), roughness: 0.95, normalMap: fine, normalScale: { x: 0.5, y: 0.5 } }),
    carpet: std({ map: carpetTexture(), roughness: 1 }),
    wheelLeather: std({ color: new Color(0.025, 0.025, 0.026), roughness: 0.5, normalMap: grain, normalScale: { x: 0.5, y: 0.5 } }),
    gaugeGlass: new MeshPhysicalMaterial({ color: new Color(0.02, 0.02, 0.02), roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    needle: std({ color: new Color(0.95, 0.35, 0.05), roughness: 0.4, emissive: new Color(1, 0.35, 0.05), emissiveIntensity: 0 }),
    // the time machine's hardware
    aluminium: std({ color: new Color(0.7, 0.71, 0.72), metalness: 1, roughness: 0.38 }),
    aluBrushed: std({ color: new Color(0.66, 0.66, 0.67), metalness: 1, roughness: 0.3, normalMap: b.normal, normalScale: { x: 0.4, y: 0.4 } }),
    deckPlate: std({ color: new Color(0.22, 0.22, 0.23), metalness: 1, roughness: 0.5, normalMap: b.normal, normalScale: { x: 0.3, y: 0.3 } }),
    greyBox: std({ color: new Color(0.3, 0.31, 0.31), metalness: 0.6, roughness: 0.5 }),
    blackBox: std({ color: new Color(0.03, 0.03, 0.032), metalness: 0.2, roughness: 0.5 }),
    conduit: std({ color: new Color(0.02, 0.02, 0.022), roughness: 0.6 }),
    conduitGrey: std({ color: new Color(0.35, 0.36, 0.37), metalness: 0.7, roughness: 0.4 }),
    wireRed: std({ color: new Color(0.5, 0.02, 0.02), roughness: 0.45 }),
    wireYellow: std({ color: new Color(0.6, 0.45, 0.02), roughness: 0.45 }),
    wireWhite: std({ color: new Color(0.7, 0.7, 0.68), roughness: 0.45 }),
    wireBlue: std({ color: new Color(0.02, 0.1, 0.5), roughness: 0.45 }),
    wireGreen: std({ color: new Color(0.03, 0.35, 0.06), roughness: 0.45 }),
    wireOrange: std({ color: new Color(0.7, 0.18, 0.02), roughness: 0.45 }),
    copper: std({ color: new Color(0.72, 0.38, 0.22), metalness: 1, roughness: 0.32 }),
    capBlue: std({ color: new Color(0.03, 0.12, 0.5), metalness: 0.3, roughness: 0.3 }),
    keypadGreen: std({ color: new Color(0.16, 0.24, 0.17), roughness: 0.55 }),
    keyWhite: std({ color: new Color(0.78, 0.78, 0.74), roughness: 0.45 }),
    whitePlastic: std({ color: new Color(0.72, 0.71, 0.68), roughness: 0.45 }),
    coil: std({ color: new Color(0.55, 0.56, 0.58), metalness: 1, roughness: 0.3, emissive: new Color(0.35, 0.65, 1.0), emissiveIntensity: 0 }),
    coilGlow: std({ color: new Color(0.6, 0.75, 1.0), roughness: 0.2, emissive: new Color(0.45, 0.75, 1.0), emissiveIntensity: 0 }),
    flux: std({ color: new Color(0.7, 0.68, 0.6), roughness: 0.1, emissive: new Color(1.0, 0.86, 0.55), emissiveIntensity: 0 }),
    red: std({ color: new Color(0.6, 0.03, 0.03), roughness: 0.4 }),
    yellow: std({ color: new Color(0.75, 0.55, 0.03), roughness: 0.45 }),
    orangeLamp: std({ color: new Color(0.7, 0.3, 0.02), roughness: 0.3, emissive: new Color(1, 0.5, 0.08), emissiveIntensity: 0 }),
  };
  return _m;
}
