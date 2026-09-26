import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('prompts.json', root), 'utf8'));
const layers = [];
for (const [index, asset] of manifest.assets.entries()) {
  const source = new URL(asset.source, root);
  const metadata = await sharp(fileURLToPath(source)).metadata();
  if (!metadata.hasAlpha) throw new Error(`${asset.id}: missing transparency`);
  const path = fileURLToPath(source);
  const output = fileURLToPath(new URL(asset.runtime, root));
  await sharp(path).resize(64, 64, { fit: 'contain', background: '#00000000' }).png().toFile(output);
  const x = (index % 5) * 240;
  const y = Math.floor(index / 5) * 220;
  layers.push({ input: await sharp(path).resize(144, 144).png().toBuffer(), left: x + 48, top: y + 8 });
  layers.push({ input: await sharp(output).resize(32, 32).png().toBuffer(), left: x + 76, top: y + 157 });
  layers.push({ input: await sharp(output).png().toBuffer(), left: x + 120, top: y + 149 });
  const label = asset.id.replace('unlock_', '').replace('plasma_burner_', 'plasma: ').replace('attack_drone_', 'drone: ');
  layers.push({ input: Buffer.from(`<svg width="240" height="22"><text x="120" y="16" text-anchor="middle" fill="#e1e8ed" font-family="Arial" font-size="12">${label}</text></svg>`), left: x, top: y + 196 });
}
await sharp({ create: { width: 1200, height: 880, channels: 4, background: '#17212a' } })
  .composite(layers).png().toFile(fileURLToPath(new URL('overview.png', root)));
console.log(`Exported ${manifest.assets.length} transparent 64px upgrade icons and overview (144/32/64px).`);
