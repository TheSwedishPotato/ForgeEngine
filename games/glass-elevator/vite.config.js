import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The Med Engine is imported, read-only, from ../duel1403/src, and the sky and the sun from
// ../gotthard-pullman/src (both games are left as they are). One copy of three.js serves all.
export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: '127.0.0.1', port: Number(process.env.PORT ?? 5180), strictPort: !!process.env.PORT, hmr: process.env.NOHMR ? false : undefined, fs: { allow: ['..'] } },
  resolve: { dedupe: ['three'] },
  worker: { format: 'es' },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 6000, assetsInlineLimit: 100000000 },
}));
