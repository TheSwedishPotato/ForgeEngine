/**
 * Type names shared across the engine's doc comments. There is no code in this file: the declarations in types/ are generated from
 * the doc comments in src/ (`npm run types`), and a name that several modules use is defined here once.
 *
 * @import { Vector3 } from './math/core.js'
 * @import { Object3D } from './scene/Object3D.js'
 */

/**
 * A point in the world: a Vector3, `[x, y, z]` or `{ x, y, z }`.
 * @typedef {Vector3 | [number, number, number] | { x: number, y: number, z: number }} Vec3Like
 */

/**
 * Something the camera, a look-at or a pointing gesture can be aimed at: a point (a Vector3, `[x, y, z]`, `{ x, y, z }`), an
 * Object3D (its world position), an Actor (its eyes), or a function returning one of these, called every frame so it follows.
 * @typedef {Vec3Like | Object3D | { eyes(out?: Vector3): Vector3 } | (() => Subject | null | undefined)} Subject
 */

/**
 * Pixels as RGBA8, rows from the top: what a screenshot or a decoded PNG is.
 * @typedef {{ width: number, height: number, data: Uint8Array | Uint8ClampedArray }} RGBA8Image
 */

/**
 * The quality tiers of the renderer (see QUALITY): the internal resolution, shadow map size and which effects run.
 * @typedef {'low' | 'medium' | 'high' | 'ultra'} QualityName
 */

/**
 * An object of the WebGPU API (a device, a texture, a command encoder ...). The engine's GPU layer is deliberately loose about
 * these, because the object comes from whichever WebGPU the platform provides (the browser's, Dawn on Node, wgpu on Deno). Install
 * `@webgpu/types` and cast to see the real interface.
 * @typedef {any} GPUObject
 */

export {};
