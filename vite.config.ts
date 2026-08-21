import gameVersion from './game-version.json';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const buildTimestamp = new Date().toISOString();

  return {
  base: './',
  server: {
    port: 8080,
  },
  // Der Flowfield-Worker wird als ES-Modul geladen (`new Worker(..., { type: 'module' })`).
  // Rollups Default für Worker ist IIFE und würde dessen Imports brechen.
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    // Ohne Source-Maps lösen Chrome-Profile und die Long-Animation-Frame-Attribution des
    // eigenen Profilers nur bis zum minifizierten Bundle auf ("vendor-*.js", leerer
    // Funktionsname) und sind damit für die Ursachensuche wertlos. Die .map-Dateien werden
    // nur bei Bedarf nachgeladen und kosten zur Laufzeit nichts.
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Packt Phaser und PeerJS in eine eigene Datei namens "vendor"
          vendor: ['phaser', 'peerjs']
        }
      }
    }
  },
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion.version),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  };
});
