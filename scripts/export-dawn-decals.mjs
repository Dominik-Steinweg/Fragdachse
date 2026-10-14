import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const assets = new URL('../public/assets/sprites/dawn-decals/', import.meta.url);
const runtime = new URL('runtime/', assets);
const provenance = JSON.parse(await readFile(new URL('prompts.json', assets), 'utf8'));
const sizes = [256, 512];
const manifest = { schemaVersion: 1, assets: [] };
const names = new Set();

async function writeIfChanged(url, bytes) {
  try {
    if ((await readFile(url)).equals(bytes)) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(url, bytes);
}

await mkdir(runtime, { recursive: true });
for (const spec of provenance.assets) {
  if (!/^[a-z]+(?:-[a-z]+)*-\d{2}$/.test(spec.name) || names.has(spec.name)) {
    throw new Error(`Invalid or duplicate decal name: ${spec.name}`);
  }
  names.add(spec.name);
  const original = await readFile(new URL(`${spec.name}.png`, assets));
  const hash = createHash('sha256').update(original).digest('hex');
  if (hash !== spec.sha256) throw new Error(`${spec.name}: PNG differs from provenance`);
  const metadata = await sharp(original).metadata();
  if (metadata.format !== 'png' || metadata.width !== 1024 || metadata.height !== 1024 || !metadata.hasAlpha) {
    throw new Error(`${spec.name}: expected a 1024x1024 PNG with alpha`);
  }

  const entry = { name: spec.name, sizes: [] };
  for (const size of sizes) {
    // Keep the entire authored square, including its centered motif and alpha padding.
    // No trimming, new bounding box, tint, gamma, opacity adjustment or sharpening.
    const encoded = await sharp(original)
      .resize(size, size, { kernel: 'lanczos3' })
      .webp({ lossless: true, effort: 6 }).toBuffer();
    const file = `${spec.name}-${size}.webp`;
    await writeIfChanged(new URL(file, runtime), encoded);
    entry.sizes.push({ width: size, height: size, file });
  }
  manifest.assets.push(entry);
}

await writeIfChanged(new URL('manifest.json', runtime), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(`Exported ${manifest.assets.length} Dawn decals at 256/512 px and runtime/manifest.json`);
