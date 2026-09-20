import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
const directory = 'public/assets/ui/upgrades';
await mkdir(`${directory}/runtime`, { recursive: true });
for (const name of ['category-frame', 'xp-frame-v2', 'apply-button-v2']) {
  await sharp(`${directory}/${name}.png`).trim().resize({ width: name.startsWith('apply-button') ? 780 : 1200, withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(`${directory}/runtime/${name}.webp`);
  console.log(name, await sharp(`${directory}/runtime/${name}.webp`).metadata(), (await stat(`${directory}/runtime/${name}.webp`)).size);
}
