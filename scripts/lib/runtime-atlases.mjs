import { build } from 'esbuild';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { sha256, visiblePixels } from './runtime-colours.mjs';

const output = 'public/assets/atlases';
const manifestFile = 'src/assets/manifests/runtime-atlases.json';
export const ATLAS_EXTRUDE = 2;
export const ATLAS_LIMIT = 2048;

/** Read the same authored registries as the loader, without starting Phaser or a Vite server. */
export async function atlasSources() {
  const bundle = await build({ stdin: { contents: `
    export { GROUND_COVER_TIERS } from './src/arena/GroundCoverConfig.ts';
    export { ARENA_DECAL_CONFIG, DIRT_ROCK_UNDERLAY_DECAL_CONFIG, ROCK_DECAL_CONFIG } from './src/arena/DecalConfig.ts';
  `, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'esm', treeShaking: true,
    plugins: [{ name: 'offline-phaser-types', setup(b) {
      b.onResolve({ filter: /^phaser$/ }, () => ({ path: 'phaser', namespace: 'offline' }));
      b.onLoad({ filter: /.*/, namespace: 'offline' }, () => ({ contents: 'export default {};' }));
    } }] });
  const config = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const catalog = JSON.parse(await readFile('src/loadout/content/data/catalog.json', 'utf8'));
  const upgrades = JSON.parse(await readFile('src/config/coopDefenseUpgradeIcons.json', 'utf8'));
  const iconKeys = [...new Set([...catalog.catalog.map(e => e.iconKey).filter(Boolean),
    ...upgrades.withIcon.map(id => `UPGRADE_${id.toUpperCase()}`)])].sort();
  const variants = tiers => [...new Set(tiers.flatMap(t => t.variants.map(v => v.fileName)))].sort();
  const entries = (names, directory) => names.map(file => ({ id: file.replace(/\.[^.]+$/, ''), source: `assets/sprites/${directory}/${file}` }));
  return {
    icons: entries(iconKeys.map(key => key + '.png'), 'Loadout'),
    decals: entries(variants([...Object.values(config.ARENA_DECAL_CONFIG), config.DIRT_ROCK_UNDERLAY_DECAL_CONFIG, config.ROCK_DECAL_CONFIG]), 'decals'),
    groundcover: entries(variants(config.GROUND_COVER_TIERS), 'groundcover'),
  };
}

const powerOfTwo = n => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
/** Stable shelf packing. Full canvases, no rotation/resampling; edge texels are extruded. */
export function packAtlas(items, limit = ATLAS_LIMIT) {
  const sorted = [...items].sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id, 'en'));
  const area = sorted.reduce((sum, i) => sum + (i.width + 4) * (i.height + 4), 0);
  const width = Math.min(limit, powerOfTwo(Math.max(Math.sqrt(area), ...sorted.map(i => i.width + 4))));
  const pages = [];
  let page = { width, height: 0, items: [] }, x = 0, y = 0, row = 0;
  for (const item of sorted) {
    const w = item.width + 4, h = item.height + 4;
    if (w > limit || h > limit) throw Error(`Atlas canvas exceeds ${limit}: ${item.id}`);
    if (x + w > width) { x = 0; y += row; row = 0; }
    if (y + h > limit) {
      page.height = powerOfTwo(y + row); pages.push(page);
      page = { width, height: 0, items: [] }; x = 0; y = 0; row = 0;
    }
    page.items.push({ ...item, x: x + ATLAS_EXTRUDE, y: y + ATLAS_EXTRUDE });
    x += w; row = Math.max(row, h);
  }
  if (page.items.length) { page.height = powerOfTwo(y + row); pages.push(page); }
  return pages;
}

async function writeChanged(file, data) {
  const bytes = Buffer.from(data);
  if (!(await readFile(file).catch(() => Buffer.alloc(0))).equals(bytes)) await writeFile(file, bytes);
}

export async function prepareRuntimeAtlases(colours, { force = false } = {}) {
  await mkdir(output, { recursive: true });
  const groups = await atlasSources(), manifest = { version: 1, extrude: ATLAS_EXTRUDE, groups: {} };
  const previous = JSON.parse(await readFile(manifestFile, 'utf8').catch(() => '{"groups":{}}'));
  for (const [group, assets] of Object.entries(groups)) {
    const items = [];
    for (const asset of assets) {
      const file = colours[asset.source]?.file ?? asset.source;
      const bytes = await readFile('public/' + file), meta = await sharp(bytes).metadata();
      items.push({ ...asset, file, sha256: sha256(bytes), width: meta.width, height: meta.height, bytes: bytes.length });
    }
    const sourceHash = sha256(JSON.stringify({ recipe: 1, extrude: ATLAS_EXTRUDE, limit: ATLAS_LIMIT, items }));
    const old = previous.groups[group];
    if (!force && old?.sourceHash === sourceHash && (await Promise.all(old.pages.map(async p =>
      sha256(await readFile('public/' + p.image).catch(() => '')) === p.sha256
      && sha256(await readFile('public/' + p.data).catch(() => '')) === p.dataSha256))).every(Boolean)) {
      manifest.groups[group] = old; continue;
    }
    const pages = [];
    for (const [index, page] of packAtlas(items).entries()) {
      const raw = Buffer.alloc(page.width * page.height * 4), frames = {};
      for (const item of page.items) {
        const pixels = await sharp('public/' + item.file).ensureAlpha().raw().toBuffer();
        for (let dy = -ATLAS_EXTRUDE; dy < item.height + ATLAS_EXTRUDE; dy++) {
          for (let dx = -ATLAS_EXTRUDE; dx < item.width + ATLAS_EXTRUDE; dx++) {
            const from = (Math.max(0, Math.min(item.height - 1, dy)) * item.width + Math.max(0, Math.min(item.width - 1, dx))) * 4;
            pixels.copy(raw, ((item.y + dy) * page.width + item.x + dx) * 4, from, from + 4);
          }
        }
        frames[item.id] = { frame: { x: item.x, y: item.y, w: item.width, h: item.height }, rotated: false, trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: item.width, h: item.height }, sourceSize: { w: item.width, h: item.height } };
      }
      const bytes = await sharp(raw, { raw: { width: page.width, height: page.height, channels: 4 } }).webp({ lossless: true, effort: 6 }).toBuffer();
      const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
      if (!visiblePixels(raw).equals(visiblePixels(decoded))) throw Error(`Atlas pixel mismatch: ${group}/${index}`);
      const image = `assets/atlases/${group}-${index}.webp`, data = `assets/atlases/${group}-${index}.json`;
      const json = JSON.stringify({ frames, meta: { image: image.split('/').at(-1), size: { w: page.width, h: page.height }, scale: '1' } });
      await writeChanged('public/' + image, bytes); await writeChanged('public/' + data, json);
      pages.push({ key: `atlas_${group}_${index}`, image, data, width: page.width, height: page.height,
        sha256: sha256(bytes), dataSha256: sha256(json), bytes: bytes.length, dataBytes: Buffer.byteLength(json), frames: page.items.map(i => i.id) });
    }
    manifest.groups[group] = { sourceHash, filter: 'linear', encoding: 'srgb-pma-colour', sources: items, pages };
  }
  await writeChanged(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  // Provenance stays offline; the game only needs group loaders and logical frame ownership.
  const runtime = { groups: Object.fromEntries(Object.entries(manifest.groups).map(([name, group]) =>
    [name, group.pages.map(({ key, image, data, frames }) => ({ key, image, data, frames }))])) };
  await writeChanged('src/assets/manifests/runtime-atlas-frames.json', JSON.stringify(runtime) + '\n');
  return manifest;
}
