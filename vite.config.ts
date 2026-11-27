import {defineConfig} from 'vite';

export default defineConfig({
  // Relative base ensures assets resolve on both root domains and GitHub Pages subpaths (/repo-name/)
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/xrblocks/')) return 'xrblocks';
          if (id.includes('node_modules/@pmndrs/')) return 'uikit';
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
