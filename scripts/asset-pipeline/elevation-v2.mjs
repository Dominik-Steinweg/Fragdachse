import sharp from 'sharp';
import { resizeMaster } from './export.mjs';

export const elevationEncoding = 'linear-unorm8-world-z';

export function validateElevationManifest(m) {
  if (!m.elevation) return;
  const p = m.elevationPass;
  if (!p || p.encoding !== elevationEncoding || p.min !== m.elevation.min || p.max !== m.elevation.max
    || p.scale !== (m.elevation.scale ?? .5) || p.waterline !== 0 || p.alpha !== 'beauty-coverage'
    || p.masterSize !== m.masterSize || p.premultiplied !== false || p.colorSpace !== 'non-color') throw new Error('Invalid elevation pass metadata');
  for (const frame of m.frames) {
    const e = frame.elevation, base = `elevation/masters/frame-${String(frame.index).padStart(4, '0')}`;
    if (!e || e.file !== base + '.png' || e.exrFile !== base + '.exr' || !/^[a-f0-9]{64}$/.test(e.sha256)
      || !/^[a-f0-9]{64}$/.test(e.exrSha256) || e.width !== m.masterSize || e.height !== m.masterSize
      || e.encoding !== elevationEncoding) throw new Error('Invalid elevation frame metadata');
  }
}

export async function verifyElevationPixels(elevation, beauty, size) {
  const [e, b] = await Promise.all([elevation, beauty].map(input => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if ([e.info, b.info].some(i => i.width !== size || i.height !== size || i.channels !== 4)) throw new Error('Elevation dimensions differ from Beauty');
  for (let offset = 0; offset < e.data.length; offset += 4) {
    if (Math.abs(e.data[offset + 3] - b.data[offset + 3]) > 1) throw new Error('Elevation alpha differs from Beauty');
    if (e.data[offset] !== e.data[offset + 1] || e.data[offset] !== e.data[offset + 2]) throw new Error('Elevation must contain scalar linear RGB');
  }
}

/** Nearest data sampling; alpha is resized directly from the original Beauty master.
 * No sRGB curve, premultiplication or sharpening is applied to height values.
 */
export async function resizeElevation(elevation, beauty, size) {
  const [height, coverage] = await Promise.all([
    sharp(elevation).resize(size, size, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer(),
    resizeMaster(beauty, size).then(input => sharp(input).ensureAlpha().raw().toBuffer()),
  ]);
  for (let i = 3; i < height.length; i += 4) height[i] = coverage[i];
  return sharp(height, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}
