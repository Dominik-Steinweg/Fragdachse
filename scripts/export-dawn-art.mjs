import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Run from any working directory: node scripts/export-dawn-art.mjs
// Sources and provenance are self-contained; no candidate folder is needed.
const assets = new URL('../public/assets/ui/dawn/art/', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('prompts.json', assets), 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const expected = new Map([
  ['dealer-portrait', { ratio: [1, 1], widths: [128, 256, 512] }],
  ['dawn-keyart', { ratio: [16, 9], widths: [960, 1920] }],
  ['dawn-victory', { ratio: [16, 9], widths: [960, 1920] }],
  ['dawn-defeat', { ratio: [16, 9], widths: [960, 1920] }],
]);
const encoding = { lossless: true, effort: 6 };
const manifest = {
  schemaVersion: 1,
  generator: 'scripts/export-dawn-art.mjs',
  urlBase: '/assets/ui/dawn/art/',
  encoder: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, webp: sharp.versions.webp },
  resize: { kernel: 'lanczos3', colourspace: 'srgb' },
  encoding,
  assets: {},
};

async function writeIfChanged(url, bytes) {
  try {
    if ((await readFile(url)).equals(bytes)) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(url, bytes);
}

// Validate the complete input set before producing any outputs.
if (provenance.assets.length !== expected.size) throw new Error('Expected four Dawn art assets');
const prepared = [];
const seen = new Set();
for (const spec of provenance.assets) {
  const contract = expected.get(spec.key);
  if (!contract || seen.has(spec.key) || spec.original !== `${spec.key}.png`) {
    throw new Error(`Invalid or duplicate source: ${spec.key}`);
  }
  seen.add(spec.key);
  const source = await readFile(new URL(spec.original, assets));
  const meta = await sharp(source).metadata();
  if (sha256(source) !== spec.sha256) throw new Error(`${spec.key}: source hash changed; review prompts.json`);
  if (meta.format !== 'png' || meta.width !== spec.width || meta.height !== spec.height ||
      meta.width * contract.ratio[1] !== meta.height * contract.ratio[0]) {
    throw new Error(`${spec.key}: unexpected source dimensions or format`);
  }
  if (JSON.stringify(spec.widths) !== JSON.stringify(contract.widths)) {
    throw new Error(`${spec.key}: unexpected export widths`);
  }
  prepared.push({ spec, source, contract });
}

await mkdir(new URL('runtime/', assets), { recursive: true });
for (const { spec, source, contract } of prepared) {
  const exports = [];
  for (const width of contract.widths) {
    const height = width * contract.ratio[1] / contract.ratio[0];
    const bytes = await sharp(source)
      .toColourspace('srgb')
      .resize(width, height, { kernel: 'lanczos3', fit: 'fill' })
      .webp(encoding).toBuffer();
    const file = `runtime/${spec.key}-${width}.webp`;
    await writeIfChanged(new URL(file, assets), bytes);
    exports.push({ file, width, height, bytes: bytes.length, sha256: sha256(bytes), upscaled: width > spec.width });
  }
  manifest.assets[spec.key] = {
    original: spec.original,
    selectedCandidate: spec.selectedCandidate,
    sha256: spec.sha256,
    width: spec.width,
    height: spec.height,
    exports,
  };
}
await writeIfChanged(new URL('runtime/manifest.json', assets), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log('Dawn art: 9 lossless WebP files and runtime/manifest.json verified/written.');
