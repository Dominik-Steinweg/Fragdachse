import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { publishColour, sha256 } from './lib/runtime-colours.mjs';
import { prepareRuntimeAtlases } from './lib/runtime-atlases.mjs';

// Explicit colour-only families. Never infer data semantics from size or alpha.
const materials = ['rock_base', 'gras_bg_tile', 'ground_macro', 'gravel_material', 'gravel_material_alt',
  'dirt_material', 'dirt_material_alt', 'bank_material', 'bank_material_wet', 'lobby_bg'];
export async function colourSources() {
  const root = 'public/assets/environment/woodland';
  const files = ['rock/mineral-colour.png', 'rock/mineral-colour-2x.png', 'canopy/albedo.png',
    'ecology/rock-colonies-atlas.png', 'ecology/ground-litter-atlas.png', 'ecology/lilies-atlas.png',
    'ecology/shore-stones-atlas.png'].map(f => `${root}/${f}`);
  files.push(...materials.map(f => `public/assets/sprites/${f}.png`));
  // Existing sprite/atlas keys and frame layouts survive publication unchanged.
  for (const family of ['groundcover', 'persistent-base', 'pipeline-v2', 'rewards']) {
    const visit = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await visit(file);
        else if (entry.name.endsWith('.png') && !/normal|height|mask|depth|horizon/i.test(entry.name)
          && (await stat(file)).size >= 128 * 1024) files.push(file);
      }
    };
    await visit(`public/assets/sprites/${family}`);
  }
  return files.sort();
}
export async function prepareRuntimeAssets() {
  const previous = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8').catch(() => '{"assets":{}}')).assets;
  const manifest = {};
  let before = 0, after = 0;
  for (const file of await colourSources()) {
    const cached = previous[file.slice('public/'.length)];
    const published = cached && cached.sourceSha256 === sha256(await readFile(file))
      && cached.sha256 === sha256(await readFile(`public/${cached.file}`).catch(() => Buffer.alloc(0)))
      ? cached : await publishColour(file);
    if (!published) continue;
    manifest[published.source] = published;
    before += published.sourceBytes; after += published.downloadBytes;
  }
  const output = 'src/assets/manifests/runtime-colours.json';
  const text = JSON.stringify({ version: 1, assets: manifest }, null, 2) + '\n';
  if (await readFile(output, 'utf8').catch(() => '') !== text) await writeFile(output, text);
  await prepareRuntimeAtlases(manifest);
  const urls = {};
  const visit = async directory => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(file);
      else {
        const key = file.slice('public/'.length);
        const runtime = manifest[key];
        const target = runtime?.file ?? key;
        const digest = runtime?.sha256 ?? sha256(await readFile(file));
        urls[key] = `${target}?v=${digest}`;
      }
    }
  };
  await visit('public/assets');
  const urlFile = 'src/assets/runtimeAssetUrls.json', urlText = JSON.stringify(urls, null, 2) + '\n';
  if (await readFile(urlFile, 'utf8').catch(() => '') !== urlText) await writeFile(urlFile, urlText);
  console.log(`Runtime colours: ${Object.keys(manifest).length} files, ${before} -> ${after} bytes; data PNG formats/channels retained (${sha256(text).slice(0, 12)}).`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await prepareRuntimeAssets();
