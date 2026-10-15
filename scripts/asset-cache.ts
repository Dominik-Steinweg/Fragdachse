import type { Plugin, ViteDevServer } from 'vite';
import { resolve } from 'node:path';
import { runtimeAssetUrls, RUNTIME_COLOURS_MANIFEST } from './lib/runtime-asset-urls.mjs';

/** `import urls from 'virtual:runtime-asset-urls'`; declared in src/vite-env.d.ts. */
export const RUNTIME_ASSET_URLS_MODULE = 'virtual:runtime-asset-urls';
const resolvedModule = `\0${RUNTIME_ASSET_URLS_MODULE}`;

// One table per process, shared by the page and worker plugin instances.
let table: { urls: Record<string, string>; values: Set<string> } | undefined;
const current = () => {
  if (!table) { const urls = runtimeAssetUrls(); table = { urls, values: new Set(Object.values(urls)) }; }
  return table;
};

/**
 * Serves the content-versioned URL table as a virtual module and marks only those URLs immutable;
 * HTML and APIs never are. The table is derived from public/assets on every build, dev and test run.
 * Worker bundles need their own instance (`worker.plugins`).
 */
export function runtimeAssetCache(): Plugin {
  current();
  const install = (server: { middlewares: { use: (fn: (req: {url?: string}, res: {setHeader: (key: string, value: string) => void}, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (current().values.has((req.url ?? '').replace(/^\//, ''))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      next();
    });
  };
  // A re-export or `npm run assets:runtime` during dev changes the hashed bytes: rebuild the table once
  // the writes settle and reload, so the browser never keeps an immutable cache entry under a stale hash.
  const watch = (server: ViteDevServer) => {
    const assets = resolve('public/assets'), manifest = resolve(RUNTIME_COLOURS_MANIFEST);
    let timer: ReturnType<typeof setTimeout> | undefined;
    server.watcher.on('all', (_event, file) => {
      const path = resolve(file);
      if (!path.startsWith(assets) && path !== manifest) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        table = undefined; current();
        const module = server.moduleGraph.getModuleById(resolvedModule);
        if (!module) return;
        server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      }, 500);
    });
  };
  return { name: 'runtime-asset-cache',
    configureServer: server => { install(server); watch(server); },
    configurePreviewServer: install,
    resolveId: id => id === RUNTIME_ASSET_URLS_MODULE ? resolvedModule : undefined,
    load: id => id === resolvedModule ? `export default ${JSON.stringify(current().urls)};` : undefined,
    transformIndexHtml: {
      order: 'pre',
      // Include font preloads/CSS and favicon, which bypass Phaser's loader.
      handler: html => html.replace(/(["'(])(\.\/|\/)(assets\/[^"'()?]+)(?:\?[^"')]+)?(["')])/g,
        (match, open, prefix, path, close) => current().urls[path] ? open + prefix + current().urls[path] + close : match),
    },
  };
}
