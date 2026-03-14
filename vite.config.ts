import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 8080,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Packt Phaser und Playroom in eine eigene Datei namens "vendor"
          vendor: ['phaser', 'playroomkit'] 
        }
      }
    }
  },
});
