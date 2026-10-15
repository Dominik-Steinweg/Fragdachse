import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { publishColour, sha256 } from './lib/runtime-colours.mjs';
import { prepareRuntimeAtlases } from './lib/runtime-atlases.mjs';
import { readPipelineRegistry } from './asset-pipeline/pipeline-registry.mjs';

// Explicit colour-only families. Never infer data semantics from size or alpha.
const materials = ['rock_base', 'gras_bg_tile', 'ground_macro', 'gravel_material', 'gravel_material_alt',
  'dirt_material', 'dirt_material_alt', 'bank_material', 'bank_material_wet', 'lobby_bg'];
// Elevation carries world Z + oct normals; emission carries linear radiance.
// Both must retain their data channels, even when their atlas filenames lack "height".
export const isColourPng = file => file.endsWith('.png') && !/normal|height|elevation|emission|mask|depth|horizon/i.test(file);
export const bossAtlasImages = assets => new Set(assets.filter(a => a.runtimeContract === 'boss')
  .flatMap(a => Object.values(a.atlases).flatMap(pass => Object.values(pass).flatMap(clip => clip.pages.map(page => page.image.replace(/^\.\//, ''))))));
export async function colourSources() {
  // Explicitly published small sheets remain published on later builds too.
  const published = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8')).assets;
  // The boss residency loader verifies selected PNG bytes itself. Keep its complete
  // atlas publication, including color, independently of generic colour substitutions.
  const boundImages = bossAtlasImages((await readPipelineRegistry()).assets);
  const root = 'public/assets/environment/woodland';
  const files = ['rock/mineral-colour.png', 'rock/mineral-colour-2x.png', 'canopy/albedo.png',
    'ecology/rock-colonies-atlas.png', 'ecology/ground-litter-atlas.png', 'ecology/lilies-atlas.png',
    'ecology/shore-stones-atlas.png'].map(f => `${root}/${f}`);
  files.push(...materials.map(f => `public/assets/sprites/${f}.png`));
  files.push('public/assets/player/death-a01-r03/death-sheet.png');
  // Existing sprite/atlas keys and frame layouts survive publication unchanged.
  for (const family of ['groundcover', 'persistent-base', 'pipeline-v2', 'rewards', 'canopies', 'rockmoss']) {
    const visit = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await visit(file);
        else if (isColourPng(file) && !boundImages.has(file.slice('public/'.length))
          && ((await stat(file)).size >= 128 * 1024 || published[file.slice('public/'.length)])) files.push(file);
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
  // URL versions are derived from these bytes per build/dev/test run (scripts/asset-cache.ts), not written here.
  console.log(`Runtime colours: ${Object.keys(manifest).length} files, ${before} -> ${after} bytes; data PNG formats/channels retained (${sha256(text).slice(0, 12)}).`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await prepareRuntimeAssets();
