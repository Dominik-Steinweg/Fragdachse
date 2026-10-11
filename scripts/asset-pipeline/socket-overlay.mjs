/** Annotate an accepted full-canvas smoke frame; never modify its master or metadata. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { requiredSockets, validateSocketFrames } from './socket-anchors.mjs';

const [buildFile, variant, indexText, output] = process.argv.slice(2);
const index = Number(indexText);
if (!buildFile || !variant || !Number.isInteger(index) || index < 0 || !output) throw new Error('Usage: node socket-overlay.mjs <build.json> <variant> <frame-index> <new.png>');
const build = JSON.parse(await readFile(buildFile, 'utf8'));
const frames = build.variants?.[variant]?.frames;
validateSocketFrames(frames?.map(f => f.sockets), frames?.length, requiredSockets(build.id));
const frame = frames.find(f => f.index === index);
if (!frame) throw new Error('Frame has not been rendered');
const root = path.dirname(path.resolve(buildFile)), source = path.resolve(root, frame.relative);
if (!source.startsWith(root + path.sep)) throw new Error('Frame escapes build folder');
const bytes = await readFile(source);
if (createHash('sha256').update(bytes).digest('hex') !== frame.sha256) throw new Error('Master hash differs');
const { width, height } = await sharp(bytes).metadata();
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const colors = ['#ffed72', '#5ffaff', '#ff839f', '#8cff93', '#c5a4ff', '#ffb45f', '#ffffff'];
const annotations = Object.entries(frame.sockets).map(([name, p], i) => {
  const x = p.x * width, y = p.y * height, color = colors[i % colors.length];
  const labelX = x > width / 2 ? x - 12 : x + 12;
  return `<g stroke="${color}" fill="none" stroke-width="2"><circle cx="${x}" cy="${y}" r="7"/>
    <path d="M${x - 12},${y}h24 M${x},${y - 12}v24"/></g>
    <text x="${labelX}" y="${y - 13}" text-anchor="${x > width / 2 ? 'end' : 'start'}" fill="${color}" stroke="#121827" stroke-width="4" paint-order="stroke">${escape(name)}</text>
    <text x="20" y="${height - 25 - (Object.keys(frame.sockets).length - 1 - i) * 23}" fill="${color}">${escape(name)}: x=${p.x.toFixed(5)} y=${p.y.toFixed(5)} z=${p.z.toFixed(5)}</text>`;
}).join('');
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g font-family="monospace" font-size="18" font-weight="bold">
  <text x="20" y="28" fill="white">${escape(build.id)} / ${escape(build.revision)} / frame ${index}</text>${annotations}</g></svg>`);
const png = await sharp(bytes).flatten({ background: '#18232b' }).composite([{ input: svg }]).png().toBuffer();
await writeFile(output, png, { flag: 'wx' });
console.log(JSON.stringify({ output, masterSha256: frame.sha256, sockets: frame.sockets }));
