/**
 * The entry point of the one-file browser build: everything the package root exports, plus the browser platform, so a page
 * needs a single file (`npm run build` writes it to dist/medengine.min.js; `import { Engine, BrowserPlatform } from 'medengine/bundle'`).
 * Games built with a bundler import from 'medengine' and 'medengine/platform/browser' instead, and ship only what they use.
 */
export * from './index.js';
export { BrowserPlatform, CanvasSurface } from './platform/browser.js';
