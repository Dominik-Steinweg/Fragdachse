/**
 * Exportiert Ring, Nabenring und Verwaltungs-Icons des Utility-Rads in einen kleinen Atlas.
 *
 * Quellen sind die unveränderten Generator-Sheets unter `output/imagegen/radial-wheel/`
 * (Prompts dort in `prompts.json`): der Waldboden-Ring oben links aus `radial-ring-sheet.png`
 * und Reihe 1 der gedeckten Icon-Variante `radial-icons-sheet-v5.png`. Ring und Nabe werden als
 * zusammenhängende Alphaflächen erkannt; Mittelpunkt sowie Innen- und Außenradius des
 * Holzbands werden entlang radialer Strahlen gemessen, damit die Laufzeit die Glassegmente
 * exakt unter die Innenkante legen kann.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const sources = new URL('output/imagegen/radial-wheel/', root);
const runtime = new URL('public/assets/ui/radial-wheel/', root);
const RING_SOURCE = 'radial-ring-sheet.png';
const ICON_SOURCE = 'radial-icons-sheet-v5.png';
/** Oberes linkes Viertel des Ring-Sheets: großer Ring plus Nabenring. */
const RING_QUADRANT = { left: 0, top: 0, width: 627, height: 627 };
/** Reihe 1 des Icon-Sheets (3 × 4 gleich große Zellen). */
const ICON_ROW = 0;
const ICON_ACTIONS = ['reposition', 'dismantle', 'dismantle-own-all'];
/**
 * Zielgrößen etwa 1,5 × der Anzeige bei 1080p: genug Reserve für höhere Renderauflösungen,
 * ohne dass die Laufzeit ohne Mipmaps stark verkleinern muss und die Kanten flimmern.
 */
const ICON_SIZE = 64;
const HUB_SIZE = 128;
const GAP = 2;
const SOLID = 128;

async function readRgba(file, region) {
  const { data, info } = await sharp(await readFile(new URL(file, sources)))
    .extract(region).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Zusammenhängende Flächen (Alpha > 16, 8er-Nachbarschaft). */
function components(image) {
  const { data, width, height } = image;
  const label = new Int32Array(width * height).fill(-1);
  const result = [];
  for (let start = 0; start < width * height; start += 1) {
    if (label[start] !== -1 || data[start * 4 + 3] <= 16) continue;
    const id = result.length;
    const entry = { id, count: 0, minX: width, minY: height, maxX: 0, maxY: 0, sumX: 0, sumY: 0 };
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      entry.count += 1; entry.sumX += x; entry.sumY += y;
      entry.minX = Math.min(entry.minX, x); entry.maxX = Math.max(entry.maxX, x);
      entry.minY = Math.min(entry.minY, y); entry.maxY = Math.max(entry.maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx; const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (label[next] !== -1 || data[next * 4 + 3] <= 16) continue;
          label[next] = id;
          stack.push(next);
        }
      }
    }
    result.push(entry);
  }
  return { label, list: result };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Misst ein Holzband: Von einem Startmittelpunkt aus läuft jeder Strahl bis zum ersten
 * deckenden Pixel (Innenkante) und weiter bis zum letzten deckenden Pixel des Bands
 * (Außenkante). Der Mittelpunkt wird aus den Innenkanten iterativ nachgeführt.
 */
function measureBand(alphaAt, cx, cy, maxRadius) {
  let centerX = cx; let centerY = cy;
  let inner = []; let outer = [];
  for (let pass = 0; pass < 4; pass += 1) {
    inner = []; outer = [];
    const innerPoints = [];
    for (let step = 0; step < 360; step += 1) {
      const angle = (step / 360) * Math.PI * 2;
      const cos = Math.cos(angle); const sin = Math.sin(angle);
      let first = -1; let last = -1;
      for (let r = 0; r < maxRadius; r += 0.5) {
        const solid = alphaAt(Math.round(centerX + cos * r), Math.round(centerY + sin * r)) > SOLID;
        if (solid && first < 0) first = r;
        if (solid) last = r;
        else if (first >= 0 && r - last > 4) break;
      }
      if (first < 0) continue;
      inner.push(first); outer.push(last);
      innerPoints.push([centerX + cos * first, centerY + sin * first]);
    }
    centerX = innerPoints.reduce((sum, [x]) => sum + x, 0) / innerPoints.length;
    centerY = innerPoints.reduce((sum, [, y]) => sum + y, 0) / innerPoints.length;
  }
  return { centerX, centerY, innerRadius: median(inner), outerRadius: median(outer) };
}

async function extractCircle(image, mask, band, pad) {
  const extent = Math.ceil(band.extent + pad);
  const size = extent * 2;
  const out = Buffer.alloc(size * size * 4);
  const left = Math.round(band.centerX) - extent;
  const top = Math.round(band.centerY) - extent;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = left + x; const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const index = sy * image.width + sx;
      if (!mask(index)) continue;
      image.data.copy(out, (y * size + x) * 4, index * 4, index * 4 + 4);
    }
  }
  return {
    buffer: await sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer(),
    size,
    centerX: band.centerX - left,
    centerY: band.centerY - top,
  };
}

// ── Ring und Nabe ────────────────────────────────────────────────────────────
const ringImage = await readRgba(RING_SOURCE, RING_QUADRANT);
const { label, list } = components(ringImage);
const byCount = [...list].sort((a, b) => b.count - a.count);
const ringPart = byCount[0];
const ringCenter = { x: (ringPart.minX + ringPart.maxX) / 2, y: (ringPart.minY + ringPart.maxY) / 2 };
const ringRadius = Math.max(ringPart.maxX - ringPart.minX, ringPart.maxY - ringPart.minY) / 2;
const hubPart = byCount.find((part) => part !== ringPart
  && Math.hypot(part.sumX / part.count - ringCenter.x, part.sumY / part.count - ringCenter.y) > ringRadius);
if (!hubPart) throw new Error('Nabenring nicht gefunden');
const hubCenter = { x: (hubPart.minX + hubPart.maxX) / 2, y: (hubPart.minY + hubPart.maxY) / 2 };
const hubRadius = Math.max(hubPart.maxX - hubPart.minX, hubPart.maxY - hubPart.minY) / 2;
// Kleine lose Blätter gehören zu dem Ring, in dessen Nähe ihr Schwerpunkt liegt.
const owner = new Map();
for (const part of list) {
  const px = part.sumX / part.count; const py = part.sumY / part.count;
  const dRing = Math.hypot(px - ringCenter.x, py - ringCenter.y) - ringRadius;
  const dHub = Math.hypot(px - hubCenter.x, py - hubCenter.y) - hubRadius;
  owner.set(part.id, dHub < dRing ? 'hub' : 'ring');
}
owner.set(ringPart.id, 'ring');
owner.set(hubPart.id, 'hub');
const alphaOf = (which) => (x, y) => {
  if (x < 0 || y < 0 || x >= ringImage.width || y >= ringImage.height) return 0;
  const index = y * ringImage.width + x;
  return owner.get(label[index]) === which ? ringImage.data[index * 4 + 3] : 0;
};
const extentOf = (which, center) => {
  let extent = 0;
  for (let index = 0; index < label.length; index += 1) {
    if (label[index] < 0 || owner.get(label[index]) !== which) continue;
    const x = index % ringImage.width; const y = (index - x) / ringImage.width;
    extent = Math.max(extent, Math.hypot(x - center.centerX, y - center.centerY));
  }
  return extent;
};
const ringBand = measureBand(alphaOf('ring'), ringCenter.x, ringCenter.y, ringRadius + 20);
ringBand.extent = extentOf('ring', ringBand);
const hubBand = measureBand(alphaOf('hub'), hubCenter.x, hubCenter.y, hubRadius + 10);
hubBand.extent = extentOf('hub', hubBand);
const ring = await extractCircle(ringImage, (index) => owner.get(label[index]) === 'ring', ringBand, 2);
const hubSource = await extractCircle(ringImage, (index) => owner.get(label[index]) === 'hub', hubBand, 2);
const hubScale = HUB_SIZE / hubSource.size;
const hub = {
  buffer: await sharp(hubSource.buffer).resize(HUB_SIZE, HUB_SIZE, { kernel: 'lanczos3' }).png().toBuffer(),
  size: HUB_SIZE,
  centerX: hubSource.centerX * hubScale,
  centerY: hubSource.centerY * hubScale,
};

// ── Icons ────────────────────────────────────────────────────────────────────
const iconMeta = await sharp(await readFile(new URL(ICON_SOURCE, sources))).metadata();
const cell = Math.floor(iconMeta.width / 3);
const icons = [];
// Flächen werden über die ganze Reihe erkannt und nach ihrem Schwerpunkt einer Spalte zugeordnet:
// Pfeilspitzen dürfen über die Zellgrenze ragen, winzige Generatorreste fallen weg.
const rowImage = await readRgba(ICON_SOURCE, { left: 0, top: ICON_ROW * cell, width: cell * 3, height: cell });
const rowParts = components(rowImage);
for (const [column, action] of ICON_ACTIONS.entries()) {
  const kept = new Set(rowParts.list
    .filter((part) => part.count >= 60 && Math.floor(part.sumX / part.count / cell) === column)
    .map((part) => part.id));
  const data = Buffer.alloc(rowImage.data.length);
  let minX = rowImage.width; let minY = rowImage.height; let maxX = 0; let maxY = 0;
  for (let index = 0; index < rowImage.width * rowImage.height; index += 1) {
    if (!kept.has(rowParts.label[index])) continue;
    rowImage.data.copy(data, index * 4, index * 4, index * 4 + 4);
    const x = index % rowImage.width; const y = (index - x) / rowImage.width;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const side = Math.max(maxX - minX, maxY - minY) + 1;
  const trimmed = await sharp(data, { raw: { width: rowImage.width, height: rowImage.height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png().toBuffer();
  // Quadratisch zentriert; alle drei Icons behalten dieselbe Skalierung relativ zur Quelle.
  const padded = await sharp(trimmed).extend({
    left: Math.floor((side - (maxX - minX + 1)) / 2), right: Math.ceil((side - (maxX - minX + 1)) / 2),
    top: Math.floor((side - (maxY - minY + 1)) / 2), bottom: Math.ceil((side - (maxY - minY + 1)) / 2),
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
  icons.push({ action, side, padded });
}
const iconSide = Math.max(...icons.map((icon) => icon.side));

// ── Atlas ────────────────────────────────────────────────────────────────────
const frames = {};
const composites = [];
const place = (name, input, x, y, w, h) => {
  composites.push({ input, left: x, top: y });
  frames[name] = { frame: { x, y, w, h } };
};
place('ring', ring.buffer, 0, 0, ring.size, ring.size);
const columnX = ring.size + GAP;
place('hub', hub.buffer, columnX, 0, hub.size, hub.size);
let iconY = hub.size + GAP;
for (const icon of icons) {
  const size = Math.round((ICON_SIZE * icon.side) / iconSide);
  const offset = Math.floor((ICON_SIZE - size) / 2);
  const resized = await sharp(icon.padded).resize(size, size, { kernel: 'lanczos3' })
    .extend({ left: offset, top: offset, right: ICON_SIZE - size - offset, bottom: ICON_SIZE - size - offset,
      background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  place(`icon-${icon.action}`, resized, columnX, iconY, ICON_SIZE, ICON_SIZE);
  iconY += ICON_SIZE + GAP;
}
const atlasW = columnX + Math.max(hub.size, ICON_SIZE);
const atlasH = Math.max(ring.size, iconY - GAP);
const atlas = await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites).png().toBuffer();
const webp = await sharp(atlas).webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true }).toBuffer();
await mkdir(runtime, { recursive: true });
await writeFile(new URL('radial-wheel.webp', runtime), webp);

for (const entry of Object.values(frames)) {
  Object.assign(entry, { rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: entry.frame.w, h: entry.frame.h },
    sourceSize: { w: entry.frame.w, h: entry.frame.h } });
}
const round = (value) => Math.round(value * 10) / 10;
await writeFile(new URL('src/ui/radialWheelExports.json', root), JSON.stringify({
  file: 'radial-wheel.webp',
  sources: { ring: RING_SOURCE, icons: ICON_SOURCE, iconRow: ICON_ROW + 1 },
  width: atlasW,
  height: atlasH,
  // Geometrie in Frame-Pixeln: Mittelpunkt sowie Innenkante (inklusive farbigem Innensaum) und
  // Außenkante des Holzbands, gemessen als Median über 360 Strahlen bei Alpha > 128.
  ring: { size: ring.size, centerX: round(ring.centerX), centerY: round(ring.centerY),
    innerRadius: round(ringBand.innerRadius), outerRadius: round(ringBand.outerRadius) },
  hub: { size: hub.size, centerX: round(hub.centerX), centerY: round(hub.centerY),
    innerRadius: round(hubBand.innerRadius * hubScale), outerRadius: round(hubBand.outerRadius * hubScale) },
  iconSize: ICON_SIZE,
  atlas: { frames, meta: { image: 'radial-wheel.webp', size: { w: atlasW, h: atlasH }, scale: '1' } },
}, null, 2) + '\n');
console.log(`radial-wheel.webp ${atlasW}×${atlasH}, ${webp.length} bytes`);
console.log('ring', ringBand, 'hub', hubBand);
