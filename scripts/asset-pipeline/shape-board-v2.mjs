import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { waterTile, waterOptions, submersionDefaults } from './water-preview-v2.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, value, size = 14) => `<text x="${x}" y="${y}" fill="#e1e8ed" font-family="Arial" font-size="${size}">${escape(value)}</text>`;
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

export async function silhouetteMetrics(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1, area = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 128) continue;
    area++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { width: info.width, height: info.height, alphaThreshold: 128, silhouetteArea: area,
    coverage: area / (info.width * info.height), bbox: area ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null,
    canvasMargin: area ? Math.min(left, top, info.width - right - 1, info.height - bottom - 1) : null };
}

/** Center on the fixed export pivot, preserving world-pixel size even after canvas changes. */
export async function differenceOverlay(before, after) {
  const sizes = await Promise.all([before, after].map(file => sharp(file).metadata()));
  const width = Math.max(...sizes.map(s => s.width)), height = Math.max(...sizes.map(s => s.height));
  const pixels = await Promise.all([before, after].map((input, i) => sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite([{ input, left: Math.floor((width - sizes[i].width) / 2), top: Math.floor((height - sizes[i].height) / 2) }]).raw().toBuffer()));
  const out = Buffer.alloc(width * height * 4);
  let changed = 0;
  for (let i = 0; i < out.length; i += 4) {
    const a = pixels[0][i + 3], b = pixels[1][i + 3];
    const delta = Math.max(...[0, 1, 2].map(c => Math.abs(pixels[0][i + c] * a / 255 - pixels[1][i + c] * b / 255)), Math.abs(a - b));
    if (delta > 8) changed++;
    const added = Math.max(0, b - a), removed = Math.max(0, a - b), material = Math.min(a, b) * delta / 255;
    out[i] = Math.min(255, 65 + removed + material);
    out[i + 1] = Math.min(255, 65 + added + material);
    out[i + 2] = Math.min(255, 65 + added);
    out[i + 3] = Math.max(a, b);
  }
  return { png: await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer(), width, height, changedPixels: changed };
}

export async function shapeBoard(folder, spec, { root, views, previous, label }) {
  const topFile = path.join(folder, 'top.png'), top = await readFile(topFile);
  const metrics = await silhouetteMetrics(top), size = metrics.width;
  const { data } = await sharp(top).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = 22;
  const silhouette = await sharp(data, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  await writeFile(path.join(folder, 'silhouette.png'), silhouette);
  const double = await sharp(top).resize(size * 2, size * 2).png().toBuffer();
  await writeFile(path.join(folder, 'top-2x.png'), double);
  const panels = [];
  if (views.includes('top')) {
    panels.push({ title: `Draufsicht 1:1 · Canvas ${size} px`, image: top, badger: true });
    panels.push({ title: 'Draufsicht 2×', image: double });
  }
  if (views.includes('silhouette')) {
    const grassFile = path.join(root, 'public/assets/sprites/gras_bg_tile.png'), grassSize = await sharp(grassFile).metadata();
    const grassTile = await sharp(grassFile).extract({ left: 0, top: 0, width: Math.min(size, grassSize.width), height: Math.min(size, grassSize.height) }).png().toBuffer();
    const grass = await sharp({ create: { width: size, height: size, channels: 4, background: '#354e22' } })
      .composite([{ input: grassTile, tile: true }]).png().toBuffer();
    const grassImage = await sharp(grass).composite([{ input: silhouette }]).png().toBuffer();
    await writeFile(path.join(folder, 'silhouette-grass.png'), grassImage);
    panels.push({ title: 'Silhouette auf Gras · 1:1', image: grassImage, badger: true });
    if (spec.elevation) {
      const water = await waterTile(silhouette, path.join(folder, 'elevation.png'), spec.elevation, size, size, waterOptions(spec), await submersionDefaults());
      await writeFile(path.join(folder, 'silhouette-water.png'), water);
      panels.push({ title: `Silhouette im Wasser · z=${waterOptions(spec).waterLevel} BU`, image: water, badger: true });
    }
  }
  if (views.includes('side')) panels.push({ title: 'Seite orthografisch · nur Formbeurteilung', image: await readFile(path.join(folder, 'side.png')) });
  let comparison = null;
  if (previous) {
    const before = await readFile(path.join(previous.folder, 'top.png'));
    const diff = await differenceOverlay(before, top);
    await writeFile(path.join(folder, 'difference.png'), diff.png);
    comparison = { label: previous.label, changedPixels: diff.changedPixels };
    panels.push({ title: 'Vorher · ' + previous.label, image: before }, { title: 'Jetzt · ' + label, image: top },
      { title: 'Differenz · Cyan hinzu / Rot weg / Gelb Farbe', image: diff.png });
    const w = Math.max(diff.width, size), h = diff.height;
    const comparisonImage = await sharp({ create: { width: w * 3, height: h, channels: 4, background: '#27343b' } })
      .composite(await Promise.all([before, top, diff.png].map(async (input, i) => {
        const m = await sharp(input).metadata(); return { input, left: i * w + Math.floor((w - m.width) / 2), top: Math.floor((h - m.height) / 2) };
      }))).png().toBuffer();
    await writeFile(path.join(folder, 'comparison.png'), comparisonImage);
  }
  const badger = await sharp(path.join(root, 'public/assets/sprites/32x32dachs.png')).resize(32, 32).png().toBuffer();
  // Shelf layout preserves literal 1:1 and 2× pixels in the exported PNG.
  const width = Math.max(1060, size * 3 + 200);
  let x = 20, y = 124, rowHeight = 0;
  const layers = [], titles = [];
  for (const panel of panels) {
    const m = await sharp(panel.image).metadata(), w = Math.max(320, m.width + (panel.badger ? 80 : 24)), h = Math.max(100, m.height + 56);
    if (x + w > width - 20 && x > 20) { x = 20; y += rowHeight + 16; rowHeight = 0; }
    titles.push(text(x, y + 18, panel.title, 13));
    layers.push({ input: panel.image, left: x + 8, top: y + 34 });
    if (panel.badger) {
      layers.push({ input: badger, left: x + m.width + 24, top: y + 34 + Math.floor((m.height - 32) / 2) });
      titles.push(text(x + m.width + 16, y + 34 + Math.max(32, Math.floor(m.height / 2)) + 28, '32 px', 11));
    }
    x += w + 16; rowHeight = Math.max(rowHeight, h);
  }
  const height = y + rowHeight + 24;
  const bb = metrics.bbox;
  const header = text(20, 30, `${spec.label} · Form-Modus · ${label}`, 20)
    + text(20, 55, `Ruhepose ohne Animation · Dachs-Maßstab 32 px · gleicher Exportpivot, keine automatische Ausschnittkorrektur`)
    + text(20, 80, `Silhouette: ${metrics.silhouetteArea} px (${(metrics.coverage * 100).toFixed(1)}%) · Rand: ${metrics.canvasMargin ?? 'leer'} px · BBox: ${bb ? `${bb.x},${bb.y} / ${bb.width}×${bb.height}` : 'leer'}`)
    + text(20, 103, previous ? `Vorher: ${previous.label} · ${comparison.changedPixels} veränderte Pixel (Schwelle 8/255)` : 'Erste Form-Iteration · noch kein Vorgänger');
  await sharp(svg(width, height, `<rect width="100%" height="100%" fill="#27343b"/>${header}${titles.join('')}`)).composite(layers).png().toFile(path.join(folder, 'board.png'));
  return { metrics, comparison };
}
