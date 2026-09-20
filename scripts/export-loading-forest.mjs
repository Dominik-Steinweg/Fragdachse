import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = new URL('../public/assets/ui/loading/', import.meta.url);
await mkdir(new URL('runtime/', assets), { recursive: true });
const output = new URL('runtime/forest.webp', assets);
await sharp(fileURLToPath(new URL('forest.png', assets)))
  .resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 84, effort: 6 })
  .toFile(fileURLToPath(output));
console.log(`Loading forest: ${(await stat(output)).size} bytes`);
