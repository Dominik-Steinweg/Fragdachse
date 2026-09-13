import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// The user explicitly approved local cleanup of ImageGen's painted transparency grid.
// Pass the four original generated PNGs in variant order; never modify the originals.
const sources = process.argv.slice(2);
if (sources.length !== 4) throw new Error('Expected four generated gravel PNG paths.');
const output = resolve('public/assets/sprites/tracks');
await mkdir(output, { recursive: true });
for (const [index, source] of sources.entries()) {
  const metadata = await sharp(source).metadata();
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (!metadata.hasAlpha) {
    // The painted backdrop is bright and achromatic; the gravel is darker blue-grey.
    // Soft matting also removes antialiased light fringes around the stones.
    for (let i = 0; i < data.length; i += 4) {
      const low = Math.min(data[i], data[i + 1], data[i + 2]);
      const high = Math.max(data[i], data[i + 1], data[i + 2]);
      const neutral = Math.max(0, Math.min(1, (22 - (high - low)) / 10));
      const bright = Math.max(0, Math.min(1, (low - 162) / 36));
      data[i + 3] = Math.round(255 * (1 - neutral * bright));
      if (data[i + 3] === 0) data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  const path = resolve(output, `track_gravel_${String(index + 1).padStart(2, '0')}.png`);
  await sharp(data, { raw: info }).resize(1024, 1024).png().toFile(path);
  console.log(path);
}
