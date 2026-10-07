/**
 * The Med Engine and its craft, borrowed read-only from Zweikampf 1403
 * (../duel1403/src): the deferred renderer with its lighting, shadows,
 * GI, volumetrics, depth of field and TAA; the posable, clothed people;
 * the modelled props and the town's materials. Nothing physics-driven is
 * used: the people are posed, never simulated. Zweikampf itself is not
 * changed by any of this.
 */
export { MedStage } from '../../../duel1403/src/render/MedStage.js';
export { Walker } from '../../../duel1403/src/life/Walker.js';
export { FACE } from '../../../duel1403/src/render/bodyMesh.js';
export { townMaterials } from '../../../duel1403/src/render/TownMesh.js';
export * as props from '../../../duel1403/src/render/props.js';
