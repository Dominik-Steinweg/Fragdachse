import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Colour textures are uploaded premultiplied. Transparent RGB is never material data. */
export function visiblePixels(bytes) {
  const pixels = Buffer.from(bytes);
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 0) pixels.fill(0, i, i + 3);
  return pixels;
}
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
  return { file: file.replace(/^public\//, ''), source: pngPath.replace(/^public\//, ''),
    width: info.width, height: info.height, sourceBytes: source.length, downloadBytes: bytes.length,
    sourceSha256: sha256(source), sha256: sha256(bytes), visiblePixelSha256: sha256(visiblePixels(data)),
    contract: 'lossless; exact alpha and RGB at alpha > 0; premultiplied colour upload' };
}
