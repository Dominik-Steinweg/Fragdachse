import { build } from 'vite';
import path from 'node:path';
import { repoRoot } from './export.mjs';

// Compile the separate entry without adding it to the game build or deployment.
await build({
  configFile: false,
  root: path.join(repoRoot, 'scripts/asset-pipeline/viewer'),
  base: './', publicDir: false,
  build: { target: 'esnext', outDir: path.join(repoRoot, 'art/poc/pipeline-v1/viewer-build'), emptyOutDir: false },
});
