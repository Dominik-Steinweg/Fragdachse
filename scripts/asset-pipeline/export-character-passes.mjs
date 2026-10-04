import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { digest, relativePath, validatePassManifest } from './character-pass-contract.mjs';

const json = async file => JSON.parse(await readFile(file, 'utf8'));
export async function decodePassImage(root, img) {
  const bytes = await readFile(path.join(root, relativePath(img.file)));
  if (digest(bytes) !== img.sha256 || bytes.length !== img.downloadBytes) throw Error('Changed pass image: ' + img.file);
  const metadata = await sharp(bytes).metadata();
  if (metadata.width !== img.width || metadata.height !== img.height || metadata.format !== 'png'
    || metadata.channels !== img.channels) throw Error('Pass PNG layout mismatch: ' + img.file);
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  // sharp converts gray to RGB on decode; the first component retains exact mask bytes.
  if (img.channels === 1) {
    const mono = Buffer.alloc(img.width * img.height);
    for (let i = 0; i < mono.length; i++) mono[i] = data[i * info.channels];
    return mono;
  }
  if (info.channels !== 4) throw Error('Expected raw RGBA data');
  return data;
}

/** Pure byte copy: fourth channel is a mask, NEVER source-over alpha. */
export function interleaveMasks(masks, width, height) {
  if (masks.length < 1 || masks.length > 4 || masks.some(m => m.length !== width * height)) throw Error('Invalid channel packing');
  const data = Buffer.alloc(width * height * 4);
  for (let c = 0; c < masks.length; c++) for (let i = 0; i < width * height; i++) data[i * 4 + c] = masks[c][i];
  return data;
}

/** Bounded shelf pages with explicit pixel rectangles. Does not rotate/recenter frames. */
export function layoutTiles(tiles, maxSize, gutter) {
  if (!Number.isInteger(maxSize) || maxSize < 1 || !Number.isInteger(gutter) || gutter < 1) throw Error('Invalid page bounds');
  const pages = [];
  let page, x = 0, y = 0, row = 0;
  for (const tile of tiles) {
    const width = tile.width + gutter * 2, height = tile.height + gutter * 2;
    if (width > maxSize || height > maxSize) throw Error('Sample exceeds atlas page');
    if (!page) { page = { width: 0, height: 0, tiles: [] }; pages.push(page); x = y = row = 0; }
    if (x + width > maxSize) { x = 0; y += row; row = 0; }
    if (y + height > maxSize) { page = { width: 0, height: 0, tiles: [] }; pages.push(page); x = y = row = 0; }
    page.tiles.push({ ...tile, x: x + gutter, y: y + gutter, page: pages.length - 1 });
    page.width = Math.max(page.width, x + width); page.height = Math.max(page.height, y + height);
    x += width; row = Math.max(row, height);
  }
  return pages;
}

export async function verifyPassPixels(root, manifest) {
  validatePassManifest(manifest);
  for (const img of manifest.images) {
    const data = await decodePassImage(root, img);
    if (img.pass === 'shadow') {
      let max = 0;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const v = data[y * img.width + x]; max = Math.max(max, v);
        if ((x < 2 || y < 2 || x >= img.width - 2 || y >= img.height - 2) && v > 4) throw Error('Shadow clips padding');
      }
      if (max < 64) throw Error('Empty shadow');
    } else if (img.pass === 'normal') {
      const alphaImage = manifest.images.find(i => i.pass === 'albedo' && i.pose === img.pose && i.width === img.width);
      const color = await decodePassImage(root, alphaImage);
      for (let i = 0; i < data.length; i += 4) if (color[i + 3] > 127) {
        const length = Math.hypot(data[i] / 127.5 - 1, data[i + 1] / 127.5 - 1, data[i + 2] / 127.5 - 1);
        if (Math.abs(length - 1) > .015) throw Error('Normal not normalized');
      }
    }
  }
}

export async function verifyPackedPasses(root) {
  const rawManifest = await readFile(path.join(root, 'render-passes.json'));
  const m = validatePassManifest(JSON.parse(rawManifest));
  const atlas = await json(path.join(root, 'atlas-passes.json'));
  if (atlas.schema !== 'fd-character-pass-atlas' || atlas.version !== 1 || atlas.status !== m.status
    || atlas.renderManifestSha256 !== digest(rawManifest) || JSON.stringify(atlas.source) !== JSON.stringify(m.source)
    || JSON.stringify(atlas.canvases) !== JSON.stringify(m.canvases) || JSON.stringify(atlas.poses) !== JSON.stringify(m.poses)
    || JSON.stringify(atlas.coordinates) !== JSON.stringify(m.spec.coordinates) || JSON.stringify(atlas.grid) !== JSON.stringify(m.spec.grid)
    || atlas.mipmaps !== false) throw Error('Atlas source/layout binding mismatch');
  const decoded = [];
  let bytes = 0, gpu = 0;
  for (const page of atlas.pages) {
    const buffer = await readFile(path.join(root, relativePath(page.file)));
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const expectedEncoding = page.pass === 'shadow' ? 'rgba-four-unorm8-linear-masks' : m.spec.material[page.pass]?.encoding;
    if (!expectedEncoding || page.encoding !== expectedEncoding || page.premultiplied !== false || info.channels !== 4
      || info.width !== page.width || info.height !== page.height || digest(buffer) !== page.sha256
      || buffer.length !== page.downloadBytes || data.length !== page.gpuBytes
      || page.width > m.spec.shadow.maximumPageSize || page.height > m.spec.shadow.maximumPageSize) throw Error('Invalid atlas page');
    bytes += buffer.length; gpu += data.length; decoded.push(data);
  }
  if (atlas.totalDownloadBytes !== bytes || atlas.totalGpuBytes !== gpu || atlas.samples.length !== m.images.length) throw Error('Atlas totals/count mismatch');
  const remaining = new Set(m.images);
  for (const s of atlas.samples) {
    const img = m.images.find(i => i.pass === s.pass && i.pose === s.pose
      && (s.pass === 'shadow' ? i.canvasIndex === s.canvasIndex : i.width === s.sourceSize));
    if (!img || !remaining.delete(img) || !Number.isInteger(s.page) || !atlas.pages[s.page]) throw Error('Invalid atlas sample');
    const page = atlas.pages[s.page], data = decoded[s.page], [x, y, w, h] = s.rect ?? [];
    if (page.pass !== s.pass || ![x, y, w, h].every(Number.isInteger) || x < 2 || y < 2 || w !== img.width || h !== img.height
      || x + w + 2 > page.width || y + h + 2 > page.height
      || (s.pass === 'shadow' && (!Number.isInteger(s.channel) || s.channel < 0 || s.channel > 3))) throw Error('Invalid atlas rectangle/channel');
    const original = await decodePassImage(root, img);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const packed = ((y + yy) * page.width + x + xx) * 4, source = yy * w + xx;
      if (s.pass === 'shadow') {
        if (data[packed + s.channel] !== original[source]) throw Error('Packed mask changed');
      } else for (let c = 0; c < 4; c++) if (data[packed + c] !== original[source * 4 + c]) throw Error('Packed material changed');
    }
  }
  return { pages: atlas.pages.length, samples: atlas.samples.length, downloadBytes: bytes, gpuBytes: gpu };
}

export async function exportCharacterPasses(root) {
  const m = await json(path.join(root, 'render-passes.json'));
  await verifyPassPixels(root, m);
  const destination = path.join(root, 'packed');
  if (await access(destination).then(() => true, () => false)) throw Error('Packed output already exists; use a new run');
  await mkdir(destination);
  const maxSize = m.spec.shadow.maximumPageSize, gutter = m.spec.shadow.gutterTexels;
  const result = { schema: 'fd-character-pass-atlas', version: 1, status: m.status,
    provenance: m.provenance, source: m.source, renderManifestSha256: digest(await readFile(path.join(root, 'render-passes.json'))),
    coordinates: m.spec.coordinates, grid: m.spec.grid, canvases: m.canvases,
    poses: m.poses, pages: [], samples: [], mipmaps: false };
  async function writePages(tiles, family, encoding) {
    const pages = layoutTiles(tiles, maxSize, gutter);
    for (const [index, page] of pages.entries()) {
      const data = Buffer.alloc(page.width * page.height * 4);
      const pageId = result.pages.length;
      for (const tile of page.tiles) {
        for (let y = 0; y < tile.height; y++) {
          tile.data.copy(data, ((tile.y + y) * page.width + tile.x) * 4, y * tile.width * 4, (y + 1) * tile.width * 4);
        }
        // Materials use replicated gutters; shadow edges were verified clear.
        if (family !== 'shadow') for (let y = -gutter; y < tile.height + gutter; y++) for (let x = -gutter; x < tile.width + gutter; x++) {
          if (x >= 0 && y >= 0 && x < tile.width && y < tile.height) continue;
          const source = (Math.max(0, Math.min(tile.height - 1, y)) * tile.width + Math.max(0, Math.min(tile.width - 1, x))) * 4;
          tile.data.copy(data, ((tile.y + y) * page.width + tile.x + x) * 4, source, source + 4);
        }
        for (const sample of tile.samples) result.samples.push({ ...sample, page: pageId, rect: [tile.x, tile.y, tile.width, tile.height] });
      }
      const buffer = await sharp(data, { raw: { width: page.width, height: page.height, channels: 4 } }).png().toBuffer();
      const decoded = await sharp(buffer).raw().toBuffer();
      if (!decoded.equals(data)) throw Error('Data channels changed during PNG encoding');
      const file = `packed/${family}-${index}.png`;
      await writeFile(path.join(root, file), buffer, { flag: 'wx' });
      result.pages.push({ pass: family.split('-')[0], file, width: page.width, height: page.height,
        encoding, premultiplied: false, downloadBytes: buffer.length, gpuBytes: data.length, sha256: digest(buffer) });
    }
  }
  const tiles = [];
  for (let canvasIndex = 0; canvasIndex < m.canvases.length; canvasIndex++) {
    const images = m.poses.map(p => m.images.find(i => i.pass === 'shadow' && i.pose === p.index && i.canvasIndex === canvasIndex));
    for (let first = 0; first < images.length; first += 4) {
      const group = images.slice(first, first + 4), { width, height } = group[0];
      const masks = await Promise.all(group.map(img => decodePassImage(root, img)));
      tiles.push({ width, height, data: interleaveMasks(masks, width, height),
        samples: group.map((img, channel) => ({ pass: 'shadow', pose: img.pose, canvasIndex, channel })) });
    }
  }
  await writePages(tiles, 'shadow', 'rgba-four-unorm8-linear-masks');
  for (const pass of ['albedo', 'normal']) for (const size of m.spec.material.sourceSizes) {
    const materialTiles = [];
    for (const img of m.images.filter(i => i.pass === pass && i.width === size)) materialTiles.push({
      width: size, height: size, data: await decodePassImage(root, img), samples: [{ pass, pose: img.pose, sourceSize: size }] });
    await writePages(materialTiles, `${pass}-${size}`, m.spec.material[pass].encoding);
  }
  result.totalDownloadBytes = result.pages.reduce((n, p) => n + p.downloadBytes, 0);
  result.totalGpuBytes = result.pages.reduce((n, p) => n + p.gpuBytes, 0);
  await writeFile(path.join(root, 'atlas-passes.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  await verifyPackedPasses(root);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(process.argv[2]);
  console.log(JSON.stringify(await (process.argv.includes('--verify') ? verifyPackedPasses(root) : exportCharacterPasses(root)), null, 2));
}
