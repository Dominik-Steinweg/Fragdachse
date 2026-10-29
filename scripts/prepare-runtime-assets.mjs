import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { PUBLICATION_CONTRACTS, UI_ART_RECIPE, publishAlias, publishColour, publishData, publishUiArt, sha256 } from './lib/runtime-colours.mjs';
import { atlasSources, prepareRuntimeAtlases } from './lib/runtime-atlases.mjs';
import { readPipelineRegistry } from './asset-pipeline/pipeline-registry.mjs';
import { isNeverRequested } from './lib/public-deployment.mjs';

// Explicit colour-only families. Never infer data semantics from size or alpha.
const materials = ['rock_base', 'gras_bg_tile', 'ground_macro', 'gravel_material', 'gravel_material_alt',
  'dirt_material', 'dirt_material_alt', 'bank_material', 'bank_material_wet', 'lobby_bg'];
const families = ['groundcover', 'persistent-base', 'pipeline-v2', 'rewards', 'canopies', 'rockmoss'];
const woodland = 'public/assets/environment/woodland';
// Their own manifest pins the PNG bytes that the runtime URL serves.
const pinnedBytes = /^assets\/sprites\/pipeline-v2\/powerups\//;
// Every entry ships with the client (WoodlandAssetManifest imports the manifest); below this, a
// publication saves less than its entry costs to fetch and parse.
export const MIN_PUBLISHED_BYTES = 16 * 1024;
// Elevation carries world Z + oct normals; emission carries linear radiance.
// Both must retain their data channels, even when their atlas filenames lack "height".
export const isColourPng = file => file.endsWith('.png') && !/normal|height|elevation|emission|mask|depth|horizon/i.test(file);
export const bossAtlasImages = assets => new Set(assets.filter(a => a.runtimeContract === 'boss')
  .flatMap(a => Object.values(a.atlases).flatMap(pass => Object.values(pass).flatMap(clip => clip.pages.map(page => page.image.replace(/^\.\//, ''))))));
/** Large UI illustrations without game lighting; the loaders request exactly these runtime files. */
export const UI_ART = ['ui/dawn/art/runtime/dawn-victory-1920.webp', 'ui/dawn/art/runtime/dawn-defeat-1920.webp',
  'ui/dawn/art/runtime/dawn-keyart-960.webp', 'ui/dawn/art/runtime/dealer-portrait-256.webp',
  'ui/match-results/runtime/result-banner.webp', 'ui/match-results/runtime/section-title-v2.webp'].map(f => `public/assets/${f}`);

async function familyPngs(published) {
  // The boss residency loader verifies selected PNG bytes itself. Keep its complete
  // atlas publication, including color, independently of generic substitutions.
  const boundImages = bossAtlasImages((await readPipelineRegistry()).assets);
  // Atlas inputs are only read by the packer; publishing new ones would just repack identical pixels.
  const atlasInputs = new Set(Object.values(await atlasSources()).flat().map(a => a.source));
  const files = [];
  const visit = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`, key = file.slice('public/'.length);
      if (entry.isDirectory()) await visit(file);
      else if (file.endsWith('.png') && !boundImages.has(key) && !isNeverRequested(key) && (published[key]
        || !atlasInputs.has(key) && !pinnedBytes.test(key) && (await stat(file)).size >= MIN_PUBLISHED_BYTES)) files.push(file);
    }
  };
  for (const family of families) await visit(`public/assets/sprites/${family}`);
  return files;
}
export async function colourSources() {
  // Explicitly published sheets remain published on later builds too.
  const published = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8')).assets;
  const files = ['rock/mineral-colour.png', 'rock/mineral-colour-2x.png', 'canopy/albedo.png',
    'ecology/rock-colonies-atlas.png', 'ecology/ground-litter-atlas.png', 'ecology/lilies-atlas.png',
    'ecology/shore-stones-atlas.png', 'ecology/void-lilies-atlas.png', 'ecology/void-lilies-emissive-atlas.png',
    'ecology/void-rock-colonies-atlas.png', 'ecology/void-rock-colonies-emissive-atlas.png'].map(f => `${woodland}/${f}`);
  files.push(...materials.map(f => `public/assets/sprites/${f}.png`));
  files.push('public/assets/player/death-a01-r03/death-sheet.png');
  // Existing sprite/atlas keys and frame layouts survive publication unchanged.
  files.push(...(await familyPngs(published)).filter(isColourPng));
  return files.sort();
}
/** Non-colour channels of the same families plus the woodland data passes, published exactly. */
export async function dataSources() {
  const published = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8')).assets;
  const files = ['canopy/normal-ao-thickness.png', 'canopy/horizon-0.png', 'canopy/horizon-1.png', 'rock/mineral-height.png',
    'rock/coverage.png', 'sun/transmission.png', 'ecology/rock-contact-atlas.png'].map(f => `${woodland}/${f}`);
  files.push(...(await familyPngs(published)).filter(file => !isColourPng(file)));
  return files.sort();
}
/** Byte-identical sound targets stay separate authoring files (Audio Studio replaces each on its own). */
export async function audioAliases() {
  const directory = 'public/assets/sounds', groups = new Map();
  for (const name of (await readdir(directory)).sort()) {
    const file = `${directory}/${name}`, hash = sha256(await readFile(file));
    if (!isNeverRequested(file.slice('public/'.length))) groups.set(hash, [...groups.get(hash) ?? [], file]);
  }
  return [...groups.values()].flatMap(([canonical, ...copies]) => copies.map(file => [file, canonical]));
}

const reusable = async (cached, category, file) => cached && (cached.category ?? 'colour') === category
  && cached.sourceSha256 === sha256(await readFile(file))
  && cached.sha256 === sha256(await readFile(`public/${cached.file}`).catch(() => Buffer.alloc(0)))
  && (category !== 'ui-art' || cached.recipe === UI_ART_RECIPE);
export async function prepareRuntimeAssets() {
  const previous = JSON.parse(await readFile('src/assets/manifests/runtime-colours.json', 'utf8').catch(() => '{"assets":{}}')).assets;
  const manifest = {}, totals = {};
  const publish = async (file, category, encode) => {
    const cached = previous[file.slice('public/'.length)];
    const { contract, ...entry } = await reusable(cached, category, file) ? cached : await encode() ?? {};
    if (!entry.file) return;
    manifest[entry.source] = { file: entry.file, source: entry.source, category, ...entry };
    const total = totals[category] ??= { files: 0, before: 0, after: 0 };
    total.files++; total.before += entry.sourceBytes; total.after += entry.downloadBytes;
  };
  for (const file of await colourSources()) await publish(file, 'colour', () => publishColour(file));
  for (const file of await dataSources()) await publish(file, 'data', () => publishData(file));
  for (const file of UI_ART) await publish(file, 'ui-art', () => publishUiArt(file));
  for (const [file, canonical] of await audioAliases()) {
    const alias = await publishAlias(file, canonical);
    manifest[alias.source] = alias;
    const total = totals.alias ??= { files: 0, before: 0, after: 0 };
    total.files++; total.before += alias.sourceBytes;
  }
  const output = 'src/assets/manifests/runtime-colours.json';
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const text = JSON.stringify({ version: 2, contracts: PUBLICATION_CONTRACTS, assets: sorted }, null, 2) + '\n';
  if (await readFile(output, 'utf8').catch(() => '') !== text) await writeFile(output, text);
  await prepareRuntimeAtlases(manifest);
  // URL versions are derived from these bytes per build/dev/test run (scripts/asset-cache.ts), not written here.
  console.log(`Runtime publication (${sha256(text).slice(0, 12)}): ${Object.entries(totals)
    .map(([category, t]) => `${category} ${t.files} files ${t.before} -> ${t.after} bytes`).join('; ')}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await prepareRuntimeAssets();
