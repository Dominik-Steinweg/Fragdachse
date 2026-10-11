import sharp from 'sharp';

/** Deterministic shelf packing, transparent two-pixel gutters, no rotation.
 * Pixel copies are raw: data-pass RGB must never be alpha-composited or gamma transformed.
 */
export async function packAtlas(frames, { frameNames, sourceFrames, size, pivot, prefix, maxSize = 4096 }) {
  if (!Number.isInteger(maxSize) || maxSize < 5 || maxSize > 4096 || frames.length !== frameNames.length
    || new Set(frameNames).size !== frames.length) throw new Error('Invalid atlas inputs');
  const entries = [];
  for (let index = 0; index < frames.length; index++) {
    const { data, info } = await sharp(frames[index]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== size || info.height !== size) throw new Error('Atlas source size mismatch');
    let left = size, top = size, right = -1, bottom = -1;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[(y * size + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < 0) { left = top = right = bottom = 0; }
    const w = right - left + 1, h = bottom - top + 1;
    if (w + 4 > maxSize || h + 4 > maxSize) throw new Error('Trimmed frame exceeds atlas page limit');
    entries.push({ index, data, left, top, w, h });
  }
  const pages = [];
  let page = { entries: [], width: 0, height: 0 }, x = 0, y = 0, rowHeight = 0;
  for (const entry of entries) {
    if (x + entry.w + 4 > maxSize) { x = 0; y += rowHeight; rowHeight = 0; }
    if (y + entry.h + 4 > maxSize) { pages.push(page); page = { entries: [], width: 0, height: 0 }; x = y = rowHeight = 0; }
    page.entries.push({ ...entry, x: x + 2, y: y + 2 });
    x += entry.w + 4; rowHeight = Math.max(rowHeight, entry.h + 4);
    page.width = Math.max(page.width, x); page.height = Math.max(page.height, y + rowHeight);
  }
  if (page.entries.length) pages.push(page);
  return Promise.all(pages.map(async (page, pageIndex) => {
    const raw = Buffer.alloc(page.width * page.height * 4), hash = {};
    for (const entry of page.entries) {
      for (let row = 0; row < entry.h; row++) {
        const offset = ((entry.top + row) * size + entry.left) * 4;
        entry.data.copy(raw, ((entry.y + row) * page.width + entry.x) * 4, offset, offset + entry.w * 4);
      }
      hash[frameNames[entry.index]] = { frame: { x: entry.x, y: entry.y, w: entry.w, h: entry.h }, rotated: false,
        trimmed: entry.w !== size || entry.h !== size,
        spriteSourceSize: { x: entry.left, y: entry.top, w: entry.w, h: entry.h }, sourceSize: { w: size, h: size },
        pivot: { x: pivot[0], y: pivot[1] }, sourceFrame: sourceFrames[entry.index] };
    }
    const image = `${prefix}-${pageIndex}.png`, json = `${prefix}-${pageIndex}.json`;
    const metadata = { frames: hash, meta: { app: 'Fragdachse V2', version: '1', image: image.split('/').at(-1),
      format: 'RGBA8888', size: { w: page.width, h: page.height }, scale: '1' } };
    return { image, json, width: page.width, height: page.height, gpuBytesRGBA8: page.width * page.height * 4,
      png: await sharp(raw, { raw: { width: page.width, height: page.height, channels: 4 } }).png().toBuffer(),
      metadata };
  }));
}
