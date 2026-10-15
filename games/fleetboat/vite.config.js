import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Med Engine and its people are imported, read-only, from ../duel1403/src and
// ../gotthard-pullman/src (both games are left as they are). One copy of three.js serves all.
export default defineConfig(({ mode }) => ({
  base: './',
  // (NOHMR=1 PORT=5179: a second server for the headless screenshots, which edits must not reload)
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 5178), strictPort: !!process.env.PORT, hmr: process.env.NOHMR ? false : undefined, fs: { allow: ['..'] } },
  resolve: { dedupe: ['three'] },
  worker: { format: 'es' },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 6000, assetsInlineLimit: 100000000 },
}));
