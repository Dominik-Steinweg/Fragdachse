import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/ui/dawn/', root);
const review = new URL('art/poc/dawn/icons/v2/', root);
const provenance = JSON.parse(await readFile(new URL('prompts.json', assets), 'utf8'));
await mkdir(new URL('runtime/', assets), { recursive: true });
await mkdir(review, { recursive: true });
const manifest = { paddingFraction: 0.0625, alphaThreshold: 1, sourceEdgeGuard: 2, assets: {} };

async function sampleSquare(square, size, backgroundMode) {
  if (backgroundMode === 'dark-print-plate') {
    return sharp(square).resize(size, size, { kernel: 'cubic' }).png().toBuffer();
  }
  // Round to whole pixels: 24px receives 2px per side, all older sizes are unchanged.
  const margin = Math.round(size * manifest.paddingFraction);
  return sharp(square).resize(size - 2 * margin, size - 2 * margin, { kernel: 'cubic' })
    .extend({ left: margin, right: margin, top: margin, bottom: margin,
      background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

async function prepareSquare(original, key, backgroundMode) {
  const metadata = await sharp(original).metadata();
  if (backgroundMode === 'dark-print-plate') {
    if (metadata.width !== metadata.height) throw new Error(key + ': printing plate must be square');
    if (metadata.hasAlpha) {
      const stats = await sharp(original).stats();
      if (stats.channels.at(-1).min !== 255) throw new Error(key + ': printing plate must be opaque');
    }
    return { square: original, crop: { left: 0, top: 0, width: metadata.width, height: metadata.height }, side: metadata.width };
  }
  if (!metadata.hasAlpha) throw new Error(`${key}: source needs real transparency`);
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + info.channels - 1] > manifest.alphaThreshold) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < 0) throw new Error(`${key}: empty alpha`);
  left = Math.max(0, left - manifest.sourceEdgeGuard);
  top = Math.max(0, top - manifest.sourceEdgeGuard);
  right = Math.min(info.width - 1, right + manifest.sourceEdgeGuard);
  bottom = Math.min(info.height - 1, bottom + manifest.sourceEdgeGuard);
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  if (crop.width === info.width && crop.height === info.height) {
    throw new Error(`${key}: alpha fills canvas; inspect background before exporting`);
  }
  const side = Math.max(crop.width, crop.height);
  const square = await sharp(original).extract(crop).extend({
    left: Math.floor((side - crop.width) / 2), right: Math.ceil((side - crop.width) / 2),
    top: Math.floor((side - crop.height) / 2), bottom: Math.ceil((side - crop.height) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  return { square, crop, side };
}

for (const spec of provenance.assets) {
  const original = await readFile(new URL(spec.original, assets));
  const hash = createHash('sha256').update(original).digest('hex');
  if (hash !== spec.sha256) throw new Error(`${spec.key}: original changed; review provenance first`);
  const { square, crop, side } = await prepareSquare(original, spec.key, spec.backgroundMode);
  const exports = [];
  for (const size of spec.sizes) {
    if (!Number.isInteger(size) || size < 1 || size > side) throw new Error(spec.key + ': invalid export size');
    // Opaque plates already contain their authored margin; do not add a second border.
    const margin = spec.backgroundMode === 'dark-print-plate' ? 0 : Math.round(size * manifest.paddingFraction);
    let sampled = sharp(square).resize(size - margin * 2, size - margin * 2, { kernel: 'cubic' });
    if (margin) sampled = sampled.extend({ left: margin, right: margin, top: margin, bottom: margin,
      background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const pixels = await sampled.raw().toBuffer({ resolveWithObject: true });
    const encoded = await sharp(pixels.data, { raw: pixels.info }).webp({ lossless: true, effort: 6 }).toBuffer();
    const file = `runtime/${spec.key}-${size}.webp`;
    await writeFile(new URL(file, assets), encoded);
    exports.push({ file, width: size, height: size, bytes: encoded.length });
  }
  manifest.assets[spec.key] = { original: spec.original, sha256: hash, backgroundMode: spec.backgroundMode ?? 'transparent', crop, exports };
}
await writeFile(new URL('runtime/manifest.json', assets), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Exported ${provenance.assets.length} Dawn originals and runtime/manifest.json`);

// Local review sources are optional; shipping exports only need the tracked originals.
const icons = provenance.assets.filter(spec => spec.reviewGroup === 'druck-v2');
let forest, candidates;
try {
  forest = await readFile(new URL('forest-review.png', review));
  candidates = await Promise.all(icons.map(spec => Promise.all(spec.candidatePrompts.map(async candidate => {
    const original = await readFile(new URL(candidate.file, review));
    if (createHash('sha256').update(original).digest('hex') !== candidate.sha256) {
      throw new Error(`${candidate.file}: candidate changed since selection`);
    }
    return original;
  }))));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Skipping V2 board: local candidates or forest-review.png unavailable.');
}
if (icons.length && forest && candidates) {
  const width = 1440, cardWidth = 480, cardHeight = 270;
  const top = 110, gridBottom = top + Math.ceil(icons.length / 3) * cardHeight;
  const height = gridBottom + 150;
  const layers = [], labels = [];
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const label = (x, y, value, size = 13, fill = '#d9cfb6') => labels.push(
    `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${fill}">${escape(value)}</text>`);
  const solid = (w, h, color) => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();
  label(20, 32, 'FROM DACHS TILL DAWN / S-2 / DRUCKREGISTER', 25);
  label(20, 58, 'Wahl: echte Runtime bei 16 / 24 / 32 / 48 px. Darunter alle drei Kandidaten bei 64 px.', 16);
  label(20, 82, 'HUD: dunkle Walnuss #2a241d | Wald: Nacht-Konzeptausschnitt | 100 % = 1 Bildpixel pro Anzeigepixel.');
  const forestStrip = await sharp(forest).resize(456, 58, { fit: 'cover' }).png().toBuffer();
  for (const [index, spec] of icons.entries()) {
    const x = (index % 3) * cardWidth + 12, y = top + Math.floor(index / 3) * cardHeight;
    label(x + 8, y + 20, `${spec.key} / WAHL ${String(spec.selectedCandidate).padStart(2, '0')}`, 16);
    layers.push({ input: await solid(456, 58, '#2a241d'), left: x, top: y + 38 });
    layers.push({ input: forestStrip, left: x, top: y + 102 });
    label(x + 8, y + 72, 'HUD');
    label(x + 8, y + 136, 'WALD');
    for (const [column, size] of [16, 24, 32, 48].entries()) {
      const cx = x + 155 + column * 80;
      label(cx - 9, y + 34, size, 10);
      const runtimeSize = spec.sizes.includes(size) ? size : size <= 32 ? 32 : 64;
      const input = await sharp(await readFile(new URL(`runtime/${spec.key}-${runtimeSize}.webp`, assets)))
        .resize(size, size, { kernel: 'cubic' }).png().toBuffer();
      for (const cy of [y + 67, y + 131]) layers.push({ input, left: cx - size / 2, top: cy - size / 2 });
    }
    label(x + 8, y + 204, 'KANDIDATEN', 11);
    for (let candidate = 0; candidate < 3; candidate++) {
      const cx = x + 155 + candidate * 96;
      layers.push({ input: await sampleSquare(candidates[index][candidate], 64, spec.backgroundMode), left: cx - 32, top: y + 175 });
      label(cx - 16, y + 255, `0${candidate + 1}${candidate + 1 === spec.selectedCandidate ? ' *' : ''}`, 12);
    }
  }
  label(20, gridBottom + 25, 'ELITES / GRAUSTUFEN / 16 + 24 px: Formvergleich ohne Farbsignal', 17);
  for (const [i, spec] of icons.filter(spec => spec.key.startsWith('elite-')).entries()) {
    const x = 20 + i * 280;
    label(x, gridBottom + 51, spec.key, 14);
    for (const [j, size] of [16, 24].entries()) {
      const input = await sharp(await readFile(new URL(`runtime/${spec.key}-${size}.webp`, assets))).greyscale().png().toBuffer();
      layers.push({ input, left: x + j * 50, top: gridBottom + 65 });
    }
  }
  label(20, height - 18, '24 px: Nicht-Elites aus 32; 48 px aus 64. Keine Browser-/Spielabnahme. Kandidaten: integriertes image_gen, 2026-10-14.', 12);
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join('')}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width, height, channels: 4, background: '#191c19' } }).composite(layers)
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL('set-board.png', review)));
  console.log('Wrote art/poc/dawn/icons/v2/set-board.png');
}
