/**
 * Med Engine 3 — public API.
 *
 *   import { Stage, Scene, Mesh, Renderer } from 'medengine';
 *
 * The package is split by concern; each part is also importable alone (see package.json "exports"):
 *   medengine/math      vectors, matrices, quaternions, colours, geometry helpers
 *   medengine/scene     scene graph, cameras, lights, geometry, materials
 *   medengine/anim      clips, mixer, state machine, retargeting
 *   medengine/physics   colliders, character controller, ragdoll
 *   medengine/input     keyboard / mouse / gamepad action maps
 *   medengine/assets    glTF, BVH, images, the asset manager
 *   medengine/story     the story runner
 *   medengine/human     characters: the packed human loader, faces, speech, the Actor that animates one
 *   medengine/cinema    the Director: shots, lenses, moves and the third-person camera
 *   medengine/audio     synthesised sound (WebAudio, browser only)
 *   medengine/ai        Claude in the game (browser only)
 */
export * from './math/index.js';
export * from './scene/index.js';
export { GPU, BUFFER, TEX } from './gpu/Device.js';
export * from './gpu/Timer.js';
export * from './render/Renderer.js';
export * from './platform/Platform.js';
export * from './anim/index.js';
export * from './physics/index.js';
export * from './input/index.js';
export * from './assets/index.js';
export * from './story/index.js';
export * from './Stage.js';
export * from './engine/index.js';
export * from './human/index.js';
export * from './cinema/index.js';
export * from './audio/index.js';
export * from './ai/index.js';
export * from './types.js';
