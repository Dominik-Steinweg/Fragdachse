// Derived local viewer inventory. Source manifests and selections remain immutable.
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function indexLibrary(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')) {
  const constructions = [];
  for (const version of [1, 2]) {
    const runs = path.join(root, `art/poc/pipeline-v${version}/runs`);
    const entries = await readdir(runs, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) continue;
      const file = path.join(runs, entry.name, 'catalog.json');
      let catalog;
      try { catalog = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (catalog.version !== version || !Array.isArray(catalog.assets) || !catalog.assets.length) continue;
      let modified = 0;
      for (const asset of catalog.assets) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(asset.id)) throw new Error('Invalid library asset ID');
        const base = path.join(runs, entry.name, asset.id);
        const selection = await readFile(path.join(base, 'selection.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (selection) asset.preferred = { variant: selection.variant, size: selection.size, reason: selection.reason };
        const variant = asset.variants[0]?.variant;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(variant ?? '')) throw new Error('Invalid library variant');
        modified = Math.max(modified, await stat(path.join(base, variant, 'render.json')).then(s => s.mtimeMs).catch(error => { if (error.code === 'ENOENT') return 0; throw error; }));
      }
      constructions.push({ key: `${version}/${entry.name}`, version, run: entry.name, modified, assets: catalog.assets });
    }
  }
  constructions.sort((a, b) => b.modified - a.modified || b.key.localeCompare(a.key));
  const file = path.join(root, 'art/poc/asset-library.json');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, constructions }, null, 2) + '\n');
  return { file, constructions: constructions.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await indexLibrary());
