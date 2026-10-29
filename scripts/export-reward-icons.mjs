import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Reward icons are only drawn by the radial action menu: at most 42 px x 1.16 (focus) x 1.035
// (close tween) = 50.4 design px, i.e. ~101 canvas px at the highest render scale (2).
// 128 px covers that with a single, mild minification step.
const SIZE = 128;
const root = new URL('../', import.meta.url);
await mkdir(new URL('public/assets/sprites/rewards/', root), { recursive: true });
for (const id of ['plasma_turret', 'watchtower']) {
  const source = await readFile(new URL(`tools/source-art/rewards/${id}-source.png`, root));
  const icon = await sharp(source).resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const target = new URL(`public/assets/sprites/rewards/${id}.png`, root);
  if (!(await readFile(target).catch(() => Buffer.alloc(0))).equals(icon)) await writeFile(target, icon);
  console.log(`${id}: ${source.length} -> ${icon.length} bytes, ${SIZE}x${SIZE}`);
}
