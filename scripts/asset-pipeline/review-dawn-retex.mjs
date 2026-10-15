// Mechanical comparison only; no selection, production export or runtime import.
import sharp from 'sharp';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readPipelineRegistry } from './pipeline-registry.mjs';
const { values: args } = parseArgs({ options: {
  'draft-root': { type: 'string' }, label: { type: 'string' }, output: { type: 'string' }, 'detail-root': { type: 'string' },
} });
if (!args['draft-root'] || !/^[a-z0-9-]+$/.test(args.label ?? '') || !args.output) throw Error('Required: --draft-root --label --output');
const runtime = await readPipelineRegistry();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {}, measurements = [];
async function source(file, expected) {
  const bytes = await readFile(file), sha256 = hash(bytes);
  if (expected && sha256 !== expected) throw Error('Source hash mismatch: ' + file);
  sources[file.replaceAll('\\', '/')] = sha256;
  return bytes;
}
const items = [1, 2, 3].map(t => ({ id: `construction_dawn_wreck_t${t}`, label: `WRACK T${t}` }));
items.push({ id: 'construction_dawn_extractor', label: 'EXTRAKTOR / RUHE' },
  ...[3, 9].map(frame => ({ id: 'construction_dawn_extractor', label: `EXTRAKTOR / AKTIV ${frame}/12`, frame })));
const width = 1420, row = 260, height = 116 + row * items.length;
const text = (s, x, y, size = 12, color = '#e5dfcd') => `<text x="${x}" y="${y}" fill="${color}" font-family="Arial" font-size="${size}">${s}</text>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#222520"/>`;
svg += text('DAWN / RETEXTUR-PILOT / ' + args.label + ' / ENTWURF ZUR ABNAHME', 20, 29, 21);
svg += text(`ALT: importierte Produktion dawn-v1-p01 (192 px) | NEU: ${args['detail-root'] ? '384-px-Detailentwurf' : '96-px-Draft, 2x vergroessert'} | gleiche Kamera, Form und Beleuchtung`, 20, 53);
svg += text('Gruen und Nacht sind Vergleichshintergruende, keine neu beleuchteten Szenen. Aktivposen: 25% und 75%.', 20, 74);
const layers = [];
for (const [index, item] of items.entries()) {
  const asset = runtime.assets.find(a => a.id === item.id);
  if (!asset || asset.revision !== 'dawn-v1-p01') throw Error('Unexpected baseline revision');
  const frame = item.frame === undefined ? asset.idleFrame : asset.clips.find(c => c.name === 'active').frames[item.frame];
  const oldPath = path.join('public', asset.sheetPath), layout = asset.layout;
  const old = await sharp(await source(oldPath, asset.hashes.sheet)).extract({
    left: layout.margin + frame % layout.columns * (layout.frameWidth + layout.spacing),
    top: layout.margin + Math.floor(frame / layout.columns) * (layout.frameHeight + layout.spacing),
    width: layout.frameWidth, height: layout.frameHeight,
  }).png().toBuffer();
  const folder = path.join(args['draft-root'], item.id, args.label);
  let newPath = path.join(folder, 'standard/clips', item.frame === undefined ? '__rest' : 'active', `frame-${String(item.frame ?? 0).padStart(4, '0')}-beauty.png`);
  let expected;
  if (args['detail-root']) {
    const detail = path.join(args['detail-root'], item.id);
    const preview = JSON.parse(await source(path.join(detail, 'preview.json')));
    const sample = preview.frames.find(f => f.index === frame);
    if (preview.status !== 'authoring-preview' || !sample) throw Error('Missing detail pose');
    newPath = path.join(detail, sample.path); expected = sample.sha256;
  }
  const fresh = await source(newPath, expected);
  const draft = JSON.parse(await source(path.join(folder, 'draft.json')));
  if (draft.status !== 'complete' || draft.warnings.length) throw Error('Incomplete or warned draft: ' + item.id);
  for (let bg = 0; bg < 2; bg++) {
    const left = 10 + bg * 705, top = 90 + index * row, ink = bg ? '#e5dfcd' : '#172319';
    svg += `<rect x="${left}" y="${top}" width="695" height="250" rx="6" fill="${bg ? '#0b111b' : '#82946a'}"/>`;
    svg += text(item.label + (bg ? ' / NACHT' : ' / GRUEN'), left + 12, top + 22, 13, ink);
    for (const [slot, bytes] of [old, fresh, old, fresh].entries()) {
      const size = slot < 2 ? 96 : 192, x = left + [12, 125, 282, 490][slot], y = top + (slot < 2 ? 96 : 52);
      svg += text(`${slot % 2 ? 'NEU' : 'ALT'} / ${slot < 2 ? '1x' : '2x'}`, x + 6, top + 44, 11, ink);
      layers.push({ input: await sharp(bytes).resize(size, size).png().toBuffer(), left: x, top: y });
    }
  }
  const pixels = await sharp(fresh).resize(96, 96).ensureAlpha().raw().toBuffer();
  let count = 0, luma = 0;
  for (let p = 0; p < pixels.length; p += 4) if (pixels[p + 3] >= 128) {
    count++; luma += .2126 * pixels[p] + .7152 * pixels[p + 1] + .0722 * pixels[p + 2];
  }
  measurements.push({ id: item.id, frame: item.frame ?? 'rest', occupiedPixels: count, meanLumaSrgb: luma / count, modelHash: draft.modelHash });
}
svg += text('Keine Auswahl / kein Import. Materialquellen und Draft-Fingerprints im zugehoerigen JSON. Bewegung/GPU-Laufzeit nicht abgenommen.', 20, height - 10, 11) + '</svg>';
await mkdir(path.dirname(args.output), { recursive: true });
await sharp(Buffer.from(svg)).composite(layers).png().toFile(args.output);
await writeFile(args.output.replace(/\.png$/, '.json'), JSON.stringify({ status: 'draft-pending-lead-review', label: args.label, measurements, sources }, null, 2) + '\n');
console.log(args.output);
