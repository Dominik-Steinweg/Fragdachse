import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapEditorApi } from './server/plugin';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root: resolve(root, 'tools/map-editor'), base: './', publicDir: false,
  plugins: [mapEditorApi(root)],
  server: { host: '127.0.0.1', port: 8091, strictPort: true, open: false, hmr: false,
    fs: { allow: [root] }, watch: { ignored: ['**/src/config/coopDefenseMaps/*.json'] } },
  worker: { format: 'es' },
  build: { outDir: resolve(root, 'build/map-editor'), emptyOutDir: true, target: 'es2022' },
});
