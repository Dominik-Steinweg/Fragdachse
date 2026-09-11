import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Palette-only derivative: keep every pixel, atlas slot and alpha byte in place.
const input = fileURLToPath(new URL('../public/assets/sprites/rocks47blob.png', import.meta.url));
const output = fileURLToPath(new URL('../public/assets/sprites/walls47blob.png', import.meta.url));
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  const luminance = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
  const gray = Math.min(255, Math.round(34 + luminance * 0.92));
  data[i] = gray; data[i + 1] = gray; data[i + 2] = gray;
}
await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(output);
console.log(`Generated walls47blob.png (${info.width} x ${info.height}); alpha unchanged.`);
