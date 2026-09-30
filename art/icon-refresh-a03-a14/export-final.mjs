import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import sharp from 'sharp';

const root = 'art/icon-refresh-a03-a14';
const manifest = JSON.parse(await fs.readFile(`${root}/final-manifest.json`, 'utf8'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const background = await fs.readFile(`${root}/r05/layers/background.png`);
for (const layer of manifest.symbolLayers) {
  const source = await fs.readFile(layer.symbolSource);
  if (hash(source) !== layer.sourceSymbolSHA256 || hash(background) !== layer.backgroundSHA256) {
    throw new Error(`Source changed: ${layer.id}`);
  }
  const symbol = await sharp(source).resize(layer.symbolBox, layer.symbolBox).png().toBuffer();
  const icon = await sharp(background).composite([
    { input: symbol, left: layer.symbolOffset, top: layer.symbolOffset },
  ]).png().toBuffer();
  if (hash(icon) !== layer.iconSHA256) throw new Error(`Export differs from approval: ${layer.id}`);
  await fs.writeFile(`${root}/r05/icons/${layer.id}.png`, icon);
}
for (const asset of manifest.assets) {
  if (hash(await fs.readFile(asset.source)) !== asset.sha256) throw new Error(`Invalid final: ${asset.id}`);
}
console.log('All 12 approved exports verified; 8 power-up icons reproduced exactly.');
