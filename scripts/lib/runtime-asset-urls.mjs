import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const RUNTIME_COLOURS_MANIFEST = 'src/assets/manifests/runtime-colours.json';

/**
 * Logical public path -> content-versioned runtime URL, derived from the committed bytes under
 * public/assets and the colour publication manifest. It is computed per build/dev/test run and
 * never committed: a committed copy went stale with every asset export and conflicted on merges.
 */
export function runtimeAssetUrls() {
  const published = JSON.parse(readFileSync(RUNTIME_COLOURS_MANIFEST, 'utf8')).assets;
  const urls = {};
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else {
        const key = file.slice('public/'.length);
        const runtime = published[key];
        urls[key] = `${runtime?.file ?? key}?v=${runtime?.sha256 ?? sha256(readFileSync(file))}`;
      }
    }
  };
  visit('public/assets');
  return urls;
}
