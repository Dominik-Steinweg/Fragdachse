// Offline contact sheet; reads published references but never writes runtime assets.
import sharp from 'sharp';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (process.argv.length !== 5) throw Error('Usage: <HQ run> <fire-control draft root> <output folder>');
const [run, draftRoot, out] = process.argv.slice(2).map(p => path.resolve(p));
const root = process.cwd();
const ids = ['fire-control-relay', 'held-fire-control-relay', 'held-fire-control-portal', 'fire-control-portal-flight'];
const sizes = [48, 128, 128, 34];
const display = [24, 32, 32, 34 * .48];
const drafts = ids.map((id, i) => i === 1
  ? path.join(draftRoot, 'v1-h-authoring/art/poc/pipeline-v2/runs/fc-v1-h-draft', id, 'standard/sprite-128.png')
  : path.join(draftRoot, id, `exports/idle-${sizes[i]}.png`));
const hqs = ids.map((id, i) => path.join(run, id, `standard/sprite-${sizes[i]}.png`));
const he = path.join(root, 'public/assets/sprites/pipeline-v2/held-he-grenade/idle.png');
const W = 1200, H = 2000, layers = [], sources = new Map();
let labels = '';
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function text(x, y, value, size = 14, fill = '#dce6e4') {
  labels += `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" fill="${fill}">${esc(value)}</text>`;
}
async function bytes(file) {
  const b = await readFile(file);
  sources.set(file, createHash('sha256').update(b).digest('hex'));
  return b;
}
async function sprite(file, x, y, size) {
  size = Math.round(size);
  const input = await sharp(await bytes(file)).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  layers.push({ input, left: Math.round(x - size / 2), top: Math.round(y - size / 2) });
}
async function terrain(y, light, height = 116) {
  const file = path.join(root, 'public/assets/sprites', light ? 'gras_bg_tile.png' : 'dirt_material.png');
  const tile = await sharp(await bytes(file)).resize(600, 600).modulate({ brightness: light ? 1.6 : .48, saturation: light ? .85 : .6 }).png().toBuffer();
  for (const x of [24, 600]) {
    layers.push({ input: await sharp(tile).extract({ left: 0, top: 0, width: 576, height }).png().toBuffer(), left: x, top: y });
  }
}
text(24, 34, 'FEUERLEIT-GERÄTE / HQ gegen abgenommenen Draft', 26);
text(24, 60, `${path.basename(run)} · 90° orthografisch · gleiche Pivots, Canvases und Clips · keine Runtime-Übernahme`);
text(100, 91, 'Draft 1:1'); text(250, 91, 'HQ 1:1'); text(460, 91, 'Draft 4×'); text(710, 91, 'HQ 4×');
text(942, 91, 'HE gehalten 1:1 / 4×');
for (let i = 0; i < ids.length; i++) {
  const y = 116 + i * 288;
  text(24, y, `${ids[i]} — ${i === 3 ? 'Flugcanvas 16,32 px (34 × 0,48); Rasterdarstellung gerundet' : `${display[i]}-px-Canvas`}`, 16);
  for (const light of [false, true]) {
    const top = y + 12 + Number(light) * 120, cy = top + 58;
    await terrain(top, light);
    await sprite(drafts[i], 130, cy, display[i]); await sprite(hqs[i], 280, cy, display[i]);
    await sprite(drafts[i], 505, cy, display[i] * 4); await sprite(hqs[i], 755, cy, display[i] * 4);
    if (i === 1 || i === 2) { await sprite(he, 955, cy, 32); await sprite(he, 1080, cy, 128); }
    text(32, top + 106, light ? 'Gras' : 'Wald', 11);
  }
}
text(24, 1294, 'DEPLOY / Draft oben, HQ unten · jeweils 1:1 und 4× · 8 Frames bei 24 fps · letzter Frame = idle', 16);
for (let k = 1; k <= 8; k++) {
  const x = 91 + (k - 1) * 145;
  const draft = path.join(draftRoot, 'fire-control-relay/preview', `frame-${String(k).padStart(4, '0')}.png`);
  const hq = path.join(run, 'fire-control-relay/standard/masters', `frame-${String(k).padStart(4, '0')}.png`);
  await sprite(draft, x, 1353, 96); await sprite(draft, x, 1418, 24);
  await sprite(hq, x, 1486, 96); await sprite(hq, x, 1551, 24);
  text(x - 27, 1586, `${k} / ${Math.round((k - 1) / 24 * 1000)} ms`, 11);
}
text(24, 1622, 'MATERIALDETAIL / 256-px-Masteransicht zur Oberflächenprüfung; keine Spielgröße', 16);
for (const [i, x] of [[0, 165], [3, 745]]) {
  await sprite(path.join(draftRoot, ids[i], 'preview/frame-0000.png'), x, 1780, 256);
  await sprite(path.join(run, ids[i], 'standard/masters/frame-0000.png'), x + 285, 1780, 256);
  text(x - 35, 1930, 'Draft', 14); text(x + 250, 1930, 'HQ', 14);
}
text(24, 1965, 'HQ: sparsame Abriebkanten, feine Kratzer, matte Rauheit und bündige Schrauben. Keine zusätzlichen Emissives.', 13);
text(24, 1987, 'Offline-Sichtprüfung; kontinuierliche Bewegung und GPU-/Runtime-Darstellung bleiben ungeprüft.', 13);
await mkdir(out, { recursive: true });
await sharp({ create: { width: W, height: H, channels: 4, background: '#242e32' } })
  .composite([...layers, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels}</svg>`), left: 0, top: 0 }])
  .png().toFile(path.join(out, 'hq-vs-draft.png'));
await writeFile(path.join(out, 'board-sources.json'), JSON.stringify({ run, ids, sourceSizes: sizes, displaySizes: display, resampling: 'lanczos3, nearest integer canvas', sources: Object.fromEntries(sources) }, null, 2) + '\n');
console.log(path.join(out, 'hq-vs-draft.png'));
