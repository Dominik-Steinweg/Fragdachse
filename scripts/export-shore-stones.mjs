import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Mechanical atlas slicing only: preserve generated colours and authored alpha.
const source = 'tools/source-art/shore-stones';
const output = 'public/assets/environment/woodland/ecology/shore-stones-atlas.png';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFile = 'source-v5.png';
const bytes = await readFile(`${source}/${sourceFile}`);
const metadata = await sharp(bytes).metadata();
if (!metadata.hasAlpha) throw new Error('Shore stones require generated transparency');
const size = 192, frames = {}, assets = [];
const atlasPixels = Buffer.alloc(size * size * 9 * 4);
for (let i = 0; i < 9; i++) {
  const col = i % 3, row = Math.floor(i / 3);
  const left = Math.round(col * metadata.width / 3), top = Math.round(row * metadata.height / 3);
  const width = Math.round((col + 1) * metadata.width / 3) - left;
  const height = Math.round((row + 1) * metadata.height / 3) - top;
  const name = `${['bank', 'shoal', 'scree'][row]}-0${col + 1}`;
  const cell = await sharp(bytes).extract({left, top, width, height}).png().toBuffer();
  const image = await sharp(cell).trim().resize(size - 12, size - 12, {
    fit: 'contain', background: '#00000000',
  }).extend({top: 6, bottom: 6, left: 6, right: 6, background: '#00000000'}).png().toBuffer();
  const pixels = await sharp(image).ensureAlpha().raw().toBuffer();
  for (let y = 0; y < size; y++) pixels.copy(atlasPixels,
    ((row * size + y) * size * 3 + col * size) * 4, y * size * 4, (y + 1) * size * 4);
  frames[name] = {frame: {x: col * size, y: row * size, w: size, h: size}, rotated: false,
    trimmed: false, spriteSourceSize: {x: 0, y: 0, w: size, h: size}, sourceSize: {w: size, h: size}};
  assets.push({name, source: sourceFile, sourceSha256: hash(bytes), width: size, height: size,
    pixelSha256: hash(pixels)});
}
const atlas = await sharp(atlasPixels, {raw: {width: size * 3, height: size * 3, channels: 4}}).png().toBuffer();
await writeFile(output, atlas);
await writeFile('src/assets/manifests/shore-stones.json', JSON.stringify({version: 7, source,
  recipe: 'scripts/export-shore-stones.mjs', generator: 'built-in image_gen',
  alpha: 'Generated alpha retained; trimmed and resized; transparent 6px frame padding',
  atlas: {file: 'shore-stones-atlas.png', width: size * 3, height: size * 3,
    rgbaBytes: size * size * 9 * 4, downloadBytes: atlas.length, sha256: hash(atlas), frames}, assets,
}, null, 2) + '\n');
console.log(`Exported ${assets.length} shore stone frames, ${atlas.length} bytes.`);
