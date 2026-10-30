import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const RUNTIME_COLOURS_MANIFEST = 'src/assets/manifests/runtime-colours.json';

/**
 * Logical public path -> content-versioned runtime URL, derived from the committed bytes under
 * public/assets and the colour publication manifest. It is computed per build/dev/test run and
 * never committed: a committed copy went stale with every asset export and conflicted on merges.
 *
 * A manifest entry only counts while it still belongs to the bytes it was published from: a re-export
 * (e.g. an audio-studio publication over a placeholder that `assets:runtime` had folded into an alias of
 * an identical file) leaves it stale until the next `npm run assets:runtime`. A stale entry is bypassed,
 * so the file is served directly under its own hash instead of another file's bytes. Every entry is
 * checked by size; aliases (few, small) also by both hashes, because a copy keeps the size of its source.
 * `onStale` receives the bypassed keys.
 */
export function runtimeAssetUrls({ manifest = RUNTIME_COLOURS_MANIFEST, publicRoot = 'public', onStale } = {}) {
  const published = JSON.parse(readFileSync(manifest, 'utf8')).assets;
  const hashes = new Map();
  const hashOf = file => {
    if (!hashes.has(file)) hashes.set(file, sha256(readFileSync(file)));
    return hashes.get(file);
  };
  const matches = (file, runtime) => {
    if (statSync(file).size !== runtime.sourceBytes) return false;
    if (runtime.category !== 'alias') return true;
    const target = `${publicRoot}/${runtime.file}`;
    return hashOf(file) === runtime.sourceSha256 && existsSync(target) && hashOf(target) === runtime.sha256;
  };
  const urls = {}, stale = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else {
        const key = file.slice(publicRoot.length + 1);
        let runtime = published[key];
        if (runtime && !matches(file, runtime)) { stale.push(key); runtime = undefined; }
        urls[key] = `${runtime?.file ?? key}?v=${runtime?.sha256 ?? hashOf(file)}`;
      }
    }
  };
  visit(`${publicRoot}/assets`);
  if (stale.length) onStale?.(stale);
  return urls;
}
