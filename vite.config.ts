import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8080,
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
});
