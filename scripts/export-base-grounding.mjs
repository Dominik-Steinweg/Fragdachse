import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Technical export only: retain ImageGen's RGBA, crop empty padding, resample and pad.
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = resolve(root, 'art/base-grounding');
const output = resolve(root, 'public/assets/sprites/base-grounding');
const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'prompts.json'), 'utf8'));
await mkdir(output, { recursive: true });
for (const asset of manifest.assets) {
  if (asset.active === false) continue;
  const source = resolve(sourceRoot, asset.source);
  const metadata = await sharp(source).metadata();
  if (!metadata.hasAlpha) throw new Error(`${asset.name}: source has no alpha`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      // ImageGen can leave nearly invisible alpha specks across the whole canvas.
      // They must not determine runtime scale; retain the original alpha inside the crop.
      if (data[(y * info.width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error(`${asset.name}: empty source`);
  const elongated = asset.name.startsWith('edge-') || asset.name.startsWith('soil-');
  const width = elongated ? 256 : 128;
  // A fixed tall canvas shrinks the visible fringe when the renderer assigns its display size.
  // Keep strips close to their actual aspect ratio and only reserve a small filtering gutter.
  const height = elongated
    ? Math.ceil((bottom - top + 1) / (right - left + 1) * (width - 8)) + 8 : 128;
  await sharp(source)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(width - 8, height - 8, { fit: 'contain', background: '#00000000' })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' })
    .png().toFile(resolve(output, `${asset.name}.png`));
  console.log(`${asset.name}: ${width}x${height} RGBA`);
}
