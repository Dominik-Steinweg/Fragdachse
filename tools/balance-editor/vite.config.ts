import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { balanceEditorApi } from './server/plugin';

const root = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  root: resolve(root, 'tools/balance-editor'), base: './', publicDir: false,
  cacheDir: resolve(root, 'build/balance-editor-vite'),
  plugins: [balanceEditorApi(root)],
  server: { host: '127.0.0.1', port: 8092, strictPort: true, open: false, hmr: false, fs: { allow: [root] } },
  build: { outDir: resolve(root, 'build/balance-editor'), emptyOutDir: true, target: 'es2022' },
});
