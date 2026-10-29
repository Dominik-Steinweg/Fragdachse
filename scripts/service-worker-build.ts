import type { Plugin } from 'vite';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deployedRuntimeAssetUrls } from './asset-cache.ts';
import {
  SERVICE_WORKER_MANIFEST, SERVICE_WORKER_SCRIPT, type ServiceWorkerManifest,
} from '../src/serviceWorker/serviceWorkerPolicy.ts';

/** Vite's `[name]-[hash]` outputs; source maps are fetched by DevTools only and stay uncached. */
const HASHED_BUILD_FILE = /^assets\/[^/]+-[\w-]{8}\.(?!map$)[a-z0-9]+$/;

/**
 * Deployable game build only: writes `service-worker.js` and `service-worker-manifest.json` next to
 * index.html. The manifest lists every hashed URL the build ships, the shipped `?v=` assets and Vite's
 * hashed outputs; the worker script inlines the Vite outputs and the manifest version, so its bytes
 * change with every build that changes what it may cache. Labs, profiling builds and tools get none.
 */
export function serviceWorkerBuild(): Plugin {
  let root = '', outDir: string | undefined;
  return {
    name: 'service-worker-build',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      if (config.mode === 'production') outDir = resolve(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      if (!outDir) return;
      const buildFiles = Object.keys(bundle).filter(file => HASHED_BUILD_FILE.test(file)).sort();
      const assets = [...new Set(Object.values(await deployedRuntimeAssetUrls()))].sort();
      const urls = [...assets, ...buildFiles];
      const manifest: ServiceWorkerManifest = {
        version: createHash('sha256').update(JSON.stringify(urls)).digest('hex'), urls,
      };
      const { outputFiles } = await build({
        absWorkingDir: root,
        entryPoints: ['src/serviceWorker/serviceWorker.ts'],
        bundle: true, write: false, format: 'iife', target: 'es2020', minify: true, legalComments: 'none', logLevel: 'silent',
        define: {
          __SERVICE_WORKER_BUILD_FILES__: JSON.stringify(buildFiles),
          __SERVICE_WORKER_MANIFEST_VERSION__: JSON.stringify(manifest.version),
        },
      });
      await Promise.all([
        writeFile(resolve(outDir, SERVICE_WORKER_SCRIPT), outputFiles[0].contents),
        writeFile(resolve(outDir, SERVICE_WORKER_MANIFEST), JSON.stringify(manifest)),
      ]);
    },
  };
}
