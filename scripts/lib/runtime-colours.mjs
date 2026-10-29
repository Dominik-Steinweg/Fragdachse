import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { encodeExactWebp } from './webp-exact.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Colour textures are uploaded premultiplied. Transparent RGB is never material data. */
export function visiblePixels(bytes) {
  const pixels = Buffer.from(bytes);
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 0) pixels.fill(0, i, i + 3);
  return pixels;
}
/** What a premultiplied upload shows: RGB scaled by alpha, alpha unchanged. */
export function premultipliedPixels(bytes) {
  const pixels = Buffer.from(bytes);
  for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * pixels[i + 3] / 255);
  return pixels;
}
export function psnr(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return sum ? 10 * Math.log10(255 * 255 * a.length / sum) : Infinity;
}
export const UI_ART_MIN_PSNR = 40;
/** Shared rules per manifest category; entries name their category instead of repeating these. */
export const PUBLICATION_CONTRACTS = {
  colour: 'lossless; exact alpha and RGB at alpha > 0; premultiplied colour upload',
  data: 'lossless exact; every channel, including RGB under alpha 0; unchanged (non-PMA) data upload',
  'ui-art': `lossy UI illustration without game lighting; alpha exact; premultiplied PSNR >= ${UI_ART_MIN_PSNR} dB`,
  alias: 'byte-identical file; served from one URL',
};
/** Selection margin above the contract floor: the smallest ladder step at or above it wins. */
const UI_ART_TARGET_PSNR = 41;
const UI_ART_LADDER = [...[90, 92, 94, 96, 98, 100].map(quality => ({ name: `q${quality}`, quality, smartSubsample: true })),
  ...[40, 60].map(quality => ({ name: `near-lossless-${quality}`, nearLossless: true, quality }))];
export const UI_ART_RECIPE = `smallest of ${UI_ART_LADDER.map(s => s.name).join('/')} at PSNR >= ${UI_ART_TARGET_PSNR} dB`;

const entry = (category, sourcePath, file, source, bytes, info) => ({ file: file.replace(/^public\//, ''),
  source: sourcePath.replace(/^public\//, ''), category, width: info.width, height: info.height,
  sourceBytes: source.length, downloadBytes: bytes.length, sourceSha256: sha256(source), sha256: sha256(bytes) });

/** Publication stage shared by authored PNGs and procedural exporters; no resampling. */
export async function publishColour(pngPath) {
  const source = await readFile(pngPath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bytes = await sharp(source).webp({ lossless: true, effort: 6 }).toBuffer();
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
  if (!visiblePixels(data).equals(visiblePixels(decoded))) throw Error(`Lossless colour mismatch: ${pngPath}`);
  if (bytes.length >= source.length) return null;
  const file = pngPath.replace(/\.png$/, '.webp');
  await writeFile(file, bytes);
  return { ...entry('colour', pngPath, file, source, bytes, info), visiblePixelSha256: sha256(visiblePixels(data)) };
}

/** Data textures (normals, heights, horizons, coverage, emission): every decoded channel stays bit-identical. */
export async function publishData(pngPath) {
  const source = await readFile(pngPath);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bytes = encodeExactWebp(pngPath);
  // Grey, 16-bit or otherwise non-RGBA8 sources do not round-trip and stay PNG.
  if (bytes.length >= source.length || !data.equals(await sharp(bytes).ensureAlpha().raw().toBuffer())) return null;
  const file = pngPath.replace(/\.png$/, '.webp');
  await writeFile(file, bytes);
  return { ...entry('data', pngPath, file, source, bytes, info), pixelSha256: sha256(data) };
}

/** Large UI illustrations only. Game textures never use this path. */
export async function publishUiArt(path) {
  const source = await readFile(path);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const reference = premultipliedPixels(data);
  let best = null;
  for (const { name, ...options } of UI_ART_LADDER) {
    const bytes = await sharp(source).webp({ ...options, alphaQuality: 100, effort: 6 }).toBuffer();
    if (best && bytes.length >= best.bytes.length) continue;
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    const alphaExact = data.every((value, i) => i % 4 !== 3 || decoded[i] === value);
    const quality = psnr(reference, premultipliedPixels(decoded));
    if (alphaExact && quality >= UI_ART_TARGET_PSNR) best = { name, bytes, quality };
  }
  if (!best || best.bytes.length >= source.length) return null;
  const file = path.replace(/\.(png|webp)$/, '.lossy.webp');
  await writeFile(file, best.bytes);
  return { ...entry('ui-art', path, file, source, best.bytes, info), recipe: UI_ART_RECIPE, encoding: best.name,
    psnr: Math.round(best.quality * 100) / 100 };
}

/** Byte-identical files resolve to one canonical URL: one request, one cache entry. */
export async function publishAlias(path, canonicalPath) {
  const source = await readFile(path), bytes = await readFile(canonicalPath);
  if (!source.equals(bytes)) throw Error(`Alias is not byte-identical: ${path}`);
  return { file: canonicalPath.replace(/^public\//, ''), source: path.replace(/^public\//, ''), category: 'alias',
    sourceBytes: source.length, downloadBytes: bytes.length, sourceSha256: sha256(source), sha256: sha256(bytes) };
}
