import sharp from 'sharp';

/**
 * Export the authored Void atlas, never recolor the friendly base.
 * Regenerate with: node scripts/generate-hostile-base-sheet.mjs
 * Source and generation prompt live in art/hostile-base/.
 * The friendly atlas owns the shared 47-Blob footprint and frame layout.
 */
const SOURCE = 'art/hostile-base/void-atlas-source.png';
const FOOTPRINT = 'public/assets/sprites/base47blob.png';
const TARGET = 'public/assets/sprites/base47blob_hostile.png';
const { data: footprint, info } = await sharp(FOOTPRINT).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
if (width !== 352 || height !== 160) throw new Error('Expected the 11 x 5, 32px Blob atlas');
const authored = await sharp(SOURCE).resize(width, height, { fit: 'fill' })
  .ensureAlpha().raw().toBuffer();
const output = Buffer.from(authored);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    // Preserve concave corners and unused frames exactly. Extend edge color into
    // small generator silhouette deviations before restoring the shared alpha.
    if (footprint[i + 3] > 0 && authored[i + 3] < 240) {
      let nearest = -1;
      let distance = Infinity;
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const px = x + dx, py = y + dy;
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const j = (py * width + px) * 4;
          const d = dx * dx + dy * dy;
          if (authored[j + 3] >= 240 && d < distance) { nearest = j; distance = d; }
        }
      }
      if (nearest < 0) throw new Error(`Missing authored material at ${x},${y}`);
      authored.copy(output, i, nearest, nearest + 3);
    }
    output[i + 3] = footprint[i + 3];
    if (output[i + 3] === 0) output.fill(0, i, i + 3);
  }
}

await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(TARGET);
console.log(`[generate-hostile-base-sheet] ${TARGET} (${width}x${height})`);
