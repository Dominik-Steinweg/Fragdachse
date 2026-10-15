#!/usr/bin/env node
// Contact sheet ("Kontaktbogen") from existing images: a labelled grid with optional crop and zoom.
//   npm run board -- <board.json>
//   npm run board -- a.png b.png=Label [--out build/boards/x.png] [--title T] [--columns 3] [--tile 640]
//                    [--crop x,y,w,h] [--zoom 3] [--with-full]
// JSON: { "out", "title", "subtitle", "columns", "tileWidth", "tileHeight", "background",
//         "tiles": [ { "src", "label", "note", "crop": [x,y,w,h], "zoom": 3, "fit": "contain|cover|fill" } ] }
// Paths in a JSON board are relative to that file. A crop is in source pixels; zoom > 1 upscales it with
// nearest-neighbour (pixels stay pixels), without zoom the tile is resampled with lanczos3 to fit.
// Each tile shows label, note and the source size/crop, so the sheet documents itself.
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

// Expected refusals print one line; DEBUG=1 shows the stack.
process.on('uncaughtException', error => { console.error(`✗ ${process.env.DEBUG ? error.stack : error.message}`); process.exit(1); });
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n')); process.exit(argv.length ? 0 : 1); }

const VALUED = ['--out', '--title', '--subtitle', '--columns', '--tile', '--crop', '--zoom'];
const flags = {}, positional = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUED.includes(argv[i])) flags[argv[i].slice(2)] = argv[++i];
  else if (argv[i] === '--with-full') flags.withFull = true;
  else if (argv[i].startsWith('--')) throw Error(`Unknown flag ${argv[i]}`);
  else positional.push(argv[i]);
}
const rect = value => {
  const r = Array.isArray(value) ? value.map(Number) : value && typeof value === 'object' ? [value.x, value.y, value.w ?? value.width, value.h ?? value.height].map(Number) : String(value).split(',').map(Number);
  if (r.length !== 4 || r.some(n => !Number.isFinite(n)) || r[2] <= 0 || r[3] <= 0) throw Error(`crop must be x,y,w,h: ${JSON.stringify(value)}`);
  return r;
};

let spec, baseDir;
if (positional.length === 1 && extname(positional[0]).toLowerCase() === '.json') {
  baseDir = dirname(resolve(positional[0]));
  spec = JSON.parse(readFileSync(positional[0], 'utf8'));
} else {
  baseDir = process.cwd();
  const tiles = [];
  for (const arg of positional) {
    const [src, label] = arg.split(/=(.*)/su);
    const name = label ?? basename(src, extname(src));
    if (!flags.crop || flags.withFull) tiles.push({ src, label: name });
    if (flags.crop) tiles.push({ src, label: flags.withFull ? `${name} (crop)` : name, crop: rect(flags.crop), zoom: Number(flags.zoom ?? 1) });
  }
  spec = { title: flags.title, subtitle: flags.subtitle, columns: flags.columns && Number(flags.columns), tileWidth: flags.tile && Number(flags.tile), tiles };
}
if (!spec.tiles?.length) throw Error('No tiles');
const out = flags.out ? resolve(flags.out) : spec.out ? resolve(baseDir, spec.out)
  : resolve(`build/boards/board-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);

// Prepare every tile: crop, then zoom (nearest) before it is fitted into the grid cell.
const tiles = [];
for (const tile of spec.tiles) {
  const path = resolve(baseDir, tile.src);
  const meta = await sharp(path).metadata();
  let image = sharp(path), width = meta.width, height = meta.height, crop = null;
  if (tile.crop) {
    const [x, y, w, h] = rect(tile.crop);
    const left = Math.max(0, Math.round(x)), top = Math.max(0, Math.round(y));
    crop = { left, top, width: Math.min(Math.round(w), meta.width - left), height: Math.min(Math.round(h), meta.height - top) };
    if (crop.width <= 0 || crop.height <= 0) throw Error(`${tile.src}: crop outside the ${meta.width}×${meta.height} image`);
    image = image.extract(crop);
    ({ width, height } = crop);
  }
  const zoom = Number(tile.zoom ?? 1);
  if (!(zoom > 0)) throw Error(`${tile.src}: zoom must be > 0`);
  let buffer = await image.png().toBuffer();
  if (zoom !== 1) {
    width = Math.round(width * zoom); height = Math.round(height * zoom);
    buffer = await sharp(buffer).resize(width, height, { kernel: zoom > 1 ? 'nearest' : 'lanczos3' }).png().toBuffer();
  }
  const detail = [`${meta.width}×${meta.height}`, crop && `crop ${crop.left},${crop.top} ${crop.width}×${crop.height}`, zoom !== 1 && `×${zoom}${zoom > 1 ? ' nearest' : ''}`].filter(Boolean).join(' · ');
  tiles.push({ buffer, width, height, zoom, fit: tile.fit ?? 'contain', lines: [tile.label ?? basename(tile.src), [tile.note, detail].filter(Boolean).join(' · ')] });
}

const columns = Math.max(1, Math.min(Number(spec.columns) || Math.ceil(Math.sqrt(tiles.length)), tiles.length));
const tileW = Math.round(Number(spec.tileWidth) || Math.min(640, tiles[0].width));
const tileH = Math.round(Number(spec.tileHeight) || tileW * tiles[0].height / tiles[0].width);
const gap = 8, labelH = 48, headerH = spec.title && spec.subtitle ? 60 : spec.title || spec.subtitle ? 40 : 0;
const rows = Math.ceil(tiles.length / columns);
const width = columns * tileW + (columns + 1) * gap, height = headerH + rows * (labelH + tileH + gap) + gap;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Rough width budget (about 0.55 em per character) so long labels end in "…" instead of overflowing.
const fit = (s, px, size) => { const max = Math.floor(px / (size * 0.55)); return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s; };
const text = (w, h, lines, { bg, size }) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/>` +
  lines.filter(Boolean).map((line, i) => `<text x="8" y="${size + 2 + i * (size + 4)}" font-family="Segoe UI, Arial, sans-serif" font-size="${i ? size - 4 : size}" font-weight="${i ? 400 : 600}" fill="${i ? '#9fb0bf' : '#f0ece2'}">${esc(fit(line, w - 16, i ? size - 4 : size))}</text>`).join('') + '</svg>');

/** A zoomed tile keeps its exact scale when it fits (centred) and is only ever shrunk; the label then
 * names the shown scale. Unzoomed tiles fill the cell, small ones upscaled with crisp pixels. */
async function cell(tile) {
  const background = '#0b0e11';
  if (tile.zoom !== 1 && tile.width <= tileW && tile.height <= tileH) {
    const left = Math.floor((tileW - tile.width) / 2), top = Math.floor((tileH - tile.height) / 2);
    return sharp(tile.buffer).extend({ left, top, right: tileW - tile.width - left, bottom: tileH - tile.height - top, background }).png().toBuffer();
  }
  if (tile.zoom !== 1) {
    const shown = Math.min(tileW / tile.width, tileH / tile.height) * tile.zoom;
    tile.lines[1] += ` · shown ×${+shown.toFixed(2)}`;
  }
  const kernel = tile.zoom > 1 || (tile.width < tileW && tile.height < tileH) ? 'nearest' : 'lanczos3';
  return sharp(tile.buffer).resize(tileW, tileH, { fit: tile.fit, background, kernel }).png().toBuffer();
}

const layers = [];
if (headerH) layers.push({ input: text(width, headerH, [spec.title, spec.subtitle], { bg: '#14181d', size: 20 }), left: 0, top: 0 });
for (const [i, tile] of tiles.entries()) {
  const x = gap + (i % columns) * (tileW + gap), y = headerH + gap + Math.floor(i / columns) * (labelH + tileH + gap);
  const image = await cell(tile); // may append the shown scale to the label
  layers.push({ input: text(tileW, labelH, tile.lines, { bg: '#1e252c', size: 16 }), left: x, top: y }, { input: image, left: x, top: y + labelH });
}
mkdirSync(dirname(out), { recursive: true });
await sharp({ create: { width, height, channels: 3, background: spec.background ?? '#0f1215' } }).composite(layers).png().toFile(out);
console.log(`${out} (${width}×${height}, ${tiles.length} tiles, ${columns} columns)`);
