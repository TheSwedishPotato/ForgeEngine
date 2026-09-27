import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    rollupOptions: mode === 'single' ? undefined : {
      input: { main: resolve(import.meta.dirname, 'index.html'), lab: resolve(import.meta.dirname, 'lab.html') },
    },
  },
}));
