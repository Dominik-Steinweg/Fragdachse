import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Only content-versioned public assets are immutable; HTML and APIs never are. */
export function runtimeAssetCache(): Plugin {
  const urls = JSON.parse(readFileSync(resolve('src/assets/runtimeAssetUrls.json'), 'utf8')) as Record<string, string>;
  const values = new Set(Object.values(urls));
  const install = (server: { middlewares: { use: (fn: (req: {url?: string}, res: {setHeader: (key: string, value: string) => void}, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      if (values.has((req.url ?? '').replace(/^\//, ''))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      next();
    });
  };
  return { name: 'runtime-asset-cache', configureServer: install, configurePreviewServer: install,
    transformIndexHtml: {
      order: 'pre',
      // Include font preloads/CSS and favicon, which bypass Phaser's loader.
      handler: html => html.replace(/(["'(])(\.\/|\/)(assets\/[^"'()?]+)(?:\?[^"')]+)?(["')])/g,
        (match, open, prefix, path, close) => urls[path] ? open + prefix + urls[path] + close : match),
    },
  };
}
