import sharp from 'sharp';

/** RGBA max-channel difference; alpha participates, masked pixels never enter the denominator. */
export function comparePixels(expected, actual, { width, height, delta = 12, maxRatio = .001, masks = [] }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || expected.length !== width * height * 4 || actual.length !== expected.length) throw Error('Image dimensions differ');
  if (!Number.isFinite(delta) || delta < 0 || delta > 255 || !Number.isFinite(maxRatio) || maxRatio < 0 || maxRatio > 1) throw Error('Invalid tolerance');
  const ignored = new Uint8Array(width * height);
  for (const { x, y, width: w, height: h } of masks) {
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) throw Error('Mask outside image');
    for (let row = y; row < y + h; row++) ignored.fill(1, row * width + x, row * width + x + w);
  }
  let changed = 0, compared = 0, maxDelta = 0, totalDelta = 0;
  const diff = Buffer.alloc(actual.length);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    diff[i + 3] = 255;
    if (ignored[p]) { diff[i + 2] = 80; continue; }
    compared++;
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(actual[i + c] - expected[i + c]));
    maxDelta = Math.max(maxDelta, d); totalDelta += d;
    if (d > delta) { changed++; diff[i] = 255; diff[i + 2] = 100; }
    else { diff[i] = diff[i + 1] = diff[i + 2] = Math.round((actual[i] + actual[i + 1] + actual[i + 2]) / 9); }
  }
  if (!compared) throw Error('All pixels masked');
  const ratio = changed / compared;
  return { passed: ratio <= maxRatio, changed, compared, ratio, maxDelta, meanDelta: totalDelta / compared, diff };
}

export async function compareImages(expected, actual, options) {
  const decode = input => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [a, b] = await Promise.all([decode(expected), decode(actual)]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw Error('Image dimensions differ');
  return { ...comparePixels(a.data, b.data, { ...options, width: a.info.width, height: a.info.height }), width: a.info.width, height: a.info.height };
}
