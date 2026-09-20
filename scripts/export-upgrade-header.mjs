import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
const directory = 'public/assets/ui/upgrades';
await mkdir(`${directory}/runtime`, { recursive: true });
await sharp(`${directory}/header.png`).trim().resize({ width: 1200, withoutEnlargement: true })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(`${directory}/runtime/header.webp`);
console.log(`Upgrade header: ${(await stat(`${directory}/runtime/header.webp`)).size} bytes`);
