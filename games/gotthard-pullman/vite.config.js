import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Med Engine and its people are imported, read-only, from ../duel1403/src
// (Zweikampf 1403 is left as it is). One copy of three.js serves both.
export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: '127.0.0.1', port: 5176, fs: { allow: ['..'] } },
  resolve: { dedupe: ['three'] },
  worker: { format: 'es' },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 6000, assetsInlineLimit: 100000000 },
}));
