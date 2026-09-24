import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Die Version aus der VERSION-Datei im Repo-Wurzelverzeichnis. Sie wandert in
// die URL, unter der i18next seine Sprachdateien laedt - siehe src/i18n.ts.
const APP_VERSION = (() => {
  for (const p of ['../VERSION', './VERSION']) {
    try { const v = readFileSync(p, 'utf8').trim(); if (v) return v; } catch { /* naechster */ }
  }
  return 'dev';
})();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true }
    }
  },
  build: {
    chunkSizeWarningLimit: 650,
    assetsDir: 'static',
    // Skip gzip-sizing every chunk for the build log — speeds up `vite build`
    // (CI + Docker stage 1) with zero effect on the emitted output.
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // NOTE: deliberately NOT chunking the mermaid ecosystem (mermaid, d3,
          // dagre, cytoscape, katex). Mermaid already code-splits each diagram
          // type via its own dynamic imports; forcing it into one manual chunk
          // merges those back into a multi-MB monolith. Leave it to self-split.

          // Charts: recharts + its bundled d3 fork (victory-vendor). Extracting
          // these out of page chunks shrinks heavy pages like ManagementReport
          // (~370 kB -> ~30 kB) and lets the chart code be cached once.
          if (id.includes('node_modules/recharts') || id.includes('node_modules/victory-vendor')) {
            return 'vendor-charts';
          }
          // Excel export stack — only needed when a user actually exports.
          if (id.includes('node_modules/write-excel-file') || id.includes('node_modules/jszip') || id.includes('node_modules/archiver')) {
            return 'vendor-export';
          }
          if (id.includes('node_modules/react-router') || id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/lucide-react') || id.includes('node_modules/date-fns')) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/axios')) return 'vendor-data';
        },
      }
    }
  }
});
