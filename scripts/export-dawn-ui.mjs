import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/ui/dawn/', root);
const review = new URL('art/poc/dawn/v1-review/', root);
const provenance = JSON.parse(await readFile(new URL('prompts.json', assets), 'utf8'));
await mkdir(new URL('runtime/', assets), { recursive: true });
await mkdir(review, { recursive: true });
const manifest = { paddingFraction: 0.0625, alphaThreshold: 1, sourceEdgeGuard: 2, assets: {} };

async function prepareSquare(original, key) {
  const metadata = await sharp(original).metadata();
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
  const { square, crop, side } = await prepareSquare(original, spec.key);
  const exports = [];
  for (const size of spec.sizes) {
    const margin = size * manifest.paddingFraction;
    const inner = size - 2 * margin;
    if (!Number.isInteger(margin) || inner > side) throw new Error(`${spec.key}: invalid export size`);
    // Cubic filtering keeps antialiased edges soft; no sharpening, tint or alpha thresholding.
    const pixels = await sharp(square).resize(inner, inner, { kernel: 'cubic' }).extend({
      left: margin, right: margin, top: margin, bottom: margin,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).raw().toBuffer({ resolveWithObject: true });
    const encoded = await sharp(pixels.data, { raw: pixels.info }).webp({ lossless: true, effort: 6 }).toBuffer();
    const file = `runtime/${spec.key}-${size}.webp`;
    await writeFile(new URL(file, assets), encoded);
    exports.push({ file, width: size, height: size, bytes: encoded.length });
  }
  manifest.assets[spec.key] = { original: spec.original, sha256: hash, crop, exports };
}
await writeFile(new URL('runtime/manifest.json', assets), JSON.stringify(manifest, null, 2) + '\n');

// Actual runtime samples, shown at 1 output pixel per labelled display pixel.
// FOREST.wood: lerpColor(BROWN_6=0x4d2b32, GOLD_4=0x884b2b, .38).
const backgrounds = ['#63372f', '#f2eee5'];
const icons = provenance.assets.filter(spec => spec.key !== 'dealer-portrait');
const portraitLabelY = 151 + icons.length * 67;
const width = 1120, height = portraitLabelY + 390, panelWidth = width / 2;
const layers = [];
const labels = [];
function label(x, y, text, color, size = 15) {
  labels.push(`<text x="${x}" y="${y}" fill="${color}" font-family="DejaVu Sans, sans-serif" font-size="${size}">${text}</text>`);
}
for (let panel = 0; panel < 2; panel++) {
  const offset = panel * panelWidth;
  const color = panel ? '#302820' : '#f2eee5';
  layers.push({ input: await sharp({ create: { width: panelWidth, height, channels: 4, background: backgrounds[panel] } }).png().toBuffer(), left: offset, top: 0 });
  label(offset + 20, 32, panel ? 'HELL #f2eee5' : 'HOLZ / FOREST.wood #63372f', color, 19);
  label(offset + 20, 58, 'Dawn UI · Runtime-Exporte · 1:1 Pixel', color);
  const sizes = [20, 24, 32, 48];
  const centers = [282, 354, 426, 510];
  sizes.forEach((size, i) => label(offset + centers[i] - 17, 91, `${size}px`, color));
  for (const [row, spec] of icons.entries()) {
    const y = 130 + row * 67;
    label(offset + 20, y + 5, spec.key, color);
    for (const [column, size] of sizes.entries()) {
      const runtimeSize = size <= 32 ? 32 : 64;
      const input = await sharp(fileURLToPath(new URL(`runtime/${spec.key}-${runtimeSize}.webp`, assets)))
        .resize(size, size, { kernel: 'cubic' }).png().toBuffer();
      layers.push({ input, left: offset + centers[column] - size / 2, top: y - size / 2 });
    }
  }
  label(offset + 20, portraitLabelY, 'dealer-portrait · 128px / 256px', color, 18);
  const portrait = await readFile(new URL('runtime/dealer-portrait-256.webp', assets));
  for (const [size, x] of [[128, 30], [256, 245]]) {
    layers.push({ input: await sharp(portrait).resize(size, size, { kernel: 'cubic' }).png().toBuffer(), left: offset + x, top: portraitLabelY + 30 });
  }
  label(offset + 20, height - 55, 'Icons: 20/24/32 aus 32px; 48 aus 64px.', color);
  label(offset + 20, height - 29, 'Portraet: beide Ansichten aus 256px.', color);
}
layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels.join('')}</svg>`), left: 0, top: 0 });
await sharp({ create: { width, height, channels: 4, background: '#ffffff' } }).composite(layers)
  .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL('ui-icons.png', review)));
console.log(`Exported ${provenance.assets.length} Dawn assets, runtime/manifest.json and art/poc/dawn/v1-review/ui-icons.png`);

// Local candidate sources live in git-ignored art/poc; runtime export also works without them.
const candidateRoot = new URL('art/poc/dawn/icons/candidates/', root);
const candidateSources = [];
for (let i = 1; i <= 4; i++) {
  const file = `icon-scrap-magnet-0${i}.png`;
  try {
    candidateSources.push({ file, original: await readFile(new URL(file, candidateRoot)) });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (candidateSources.length === 4) {
  const sheetWidth = 720, sheetHeight = 600;
  const samples = [], captions = [];
  const caption = (x, y, text, size = 15) => captions.push(`<text x="${x}" y="${y}" fill="#f2eee5" font-family="DejaVu Sans, sans-serif" font-size="${size}">${text}</text>`);
  caption(24, 32, 'Schrottmagnet - Kandidaten / Auswahl', 22);
  caption(24, 58, 'Dunkler HUD-Ton #24282b | Anzeige 1:1 Pixel');
  const columns = [310, 410, 530, 650];
  [72, 24, 32, 48].forEach((size, i) => caption(columns[i] - 22, 89, `${size}px`));
  for (const [row, candidate] of candidateSources.entries()) {
    const { square } = await prepareSquare(candidate.original, candidate.file);
    const centerY = 144 + row * 88;
    const selected = provenance.assets.find(spec => spec.key === 'scrap-magnet');
    const isSelected = selected?.source.endsWith(candidate.file);
    caption(24, centerY, `Kandidat 0${row + 1}${isSelected ? ' - WAHL' : ''}`);
    // 128px detail preview is reduced to 72px to keep this review sheet compact.
    for (const [column, size] of [72, 24, 32, 48].entries()) {
      const runtimeSize = size <= 32 ? 32 : size <= 48 ? 64 : 128;
      const margin = runtimeSize * manifest.paddingFraction;
      const input = await sharp(square).resize(runtimeSize - margin * 2, runtimeSize - margin * 2, { kernel: 'cubic' })
        .extend({ left: margin, right: margin, top: margin, bottom: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      samples.push({ input: await sharp(input).resize(size, size, { kernel: 'cubic' }).png().toBuffer(), left: columns[column] - size / 2, top: centerY - size / 2 });
    }
  }
  caption(24, 500, 'Wahl / Runtime');
  for (const [column, size] of [24, 32, 48].entries()) {
    const input = await sharp(fileURLToPath(new URL(`runtime/scrap-magnet-${size <= 32 ? 32 : 64}.webp`, assets)))
      .resize(size, size, { kernel: 'cubic' }).png().toBuffer();
    samples.push({ input, left: columns[column + 1] - size / 2, top: 495 - size / 2 });
  }
  caption(24, 548, '02: klare U-Form, helle Pole, passende Metalltextur.');
  caption(24, 575, '24px: Magnet lesbar; einzelne Schrottteile nur eingeschraenkt.');
  samples.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">${captions.join('')}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width: sheetWidth, height: sheetHeight, channels: 4, background: '#24282b' } }).composite(samples)
    .png({ compressionLevel: 9 }).toFile(fileURLToPath(new URL('ui-scrap-magnet.png', review)));
} else {
  console.log('Skipping magnet candidate sheet: local art/poc candidates are unavailable.');
}
