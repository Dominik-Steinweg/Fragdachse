import * as path from 'path';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { runOrganicCoverPipeline } from './lib/organic-cover-pipeline.mjs';

/**
 * Two ground-cover tiers, see GROUND_COVER_TIERS in src/arena/GroundCoverConfig.ts:
 *
 * - ground_patch_XX: large grass/moss patches from tools/source-art/groundcover, feathered and
 *   perforated by the shared organic pipeline, then pulled to the hue and value of the grass tile.
 * - ground_cover_XX: small flat blade tufts from tools/source-art/ground-materials, only trimmed
 *   and downsampled once for native-scale stamps.
 *
 * Run after scripts/generate-grass-tiles.mjs; the patches are graded against its grass tile.
 */
const output = path.join('public', 'assets', 'sprites', 'groundcover');
await mkdir(output, { recursive: true });

await runOrganicCoverPipeline({
  sourceDir: path.join('tools', 'source-art', 'groundcover'),
  outDir: output,
  outPrefix: 'ground_patch_',
  contactSheet: path.join('tools', 'source-art', 'groundcover', '_preview.png'),
  gradeTargetFile: path.join('public', 'assets', 'sprites', 'gras_bg_tile.png'),
  // Stamped at about 64-144 px. No mipmaps: keep minification moderate.
  longSide: 224,
  silhouetteThreshold: 128,
  trimThreshold: 3,
  rgbBleedPx: 12,
  // Wider feather than the rock moss: the patch must dissolve into the grass, not sit on it.
  featherFraction: 0.6,
  featherScalePercentile: 0.85,
  featherFloorFraction: 0.06,
  alphaRampGamma: 0.8,
  edgeNoiseAmplitude: 0.45,
  edgeNoiseWavelengthFraction: 0.08,
  holeOctaves: [
    { wavelength: 0.26, amp: 1.0 },
    { wavelength: 0.13, amp: 0.5 },
    { wavelength: 0.065, amp: 0.25 },
  ],
  holeThreshold: 0.42,
  holeSoftness: 0.18,
  interiorAlphaFloor: 0.4,
  holeDepthRamp: 2.0,
  // The sources are a bright meadow green; the forest floor is darker and cooler.
  gradeStrength: 0.5,
  lumaScale: 0.8,
  seed: 20260814,
});

const tufts = path.join('tools', 'source-art', 'ground-materials');
/** Blade tips must read against the darker grass tile; the sources are very dark. */
const TUFT_GRADE = { brightness: 1.35, saturation: 1.05 };
const trimmedTufts = [];

/**
 * Soft contact shadow below flat vegetation: the blades stand a few centimetres above the
 * ground. Offset toward the scene's usual down-right shading, then the sprite on top.
 */
async function withContactShadow(input, { blur, offset, opacity }) {
  const meta = await sharp(input).metadata();
  const pad = Math.ceil(blur * 2 + offset);
  const alpha = await sharp(input).extractChannel('alpha').raw().toBuffer();
  const shadowAlpha = await sharp(alpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#000000' })
    .blur(blur).linear(opacity, 0).extractChannel(0).raw().toBuffer();
  const width = meta.width + pad * 2, height = meta.height + pad * 2;
  const shadow = await sharp(Buffer.alloc(width * height * 3, 8), { raw: { width, height, channels: 3 } })
    .joinChannel(shadowAlpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, left: offset, top: offset }, { input, left: pad, top: pad }])
    .png().toBuffer();
}
for (let index = 1; index <= 8; index++) {
  const id = String(index).padStart(2, '0');
  const input = path.join(tufts, `tuft_${id}.png`);
  const metadata = await sharp(input).metadata();
  if (!metadata.hasAlpha) throw new Error(`Expected transparent source: ${input}`);
  const trimmed = await sharp(input).trim({ threshold: 5 }).modulate(TUFT_GRADE).png().toBuffer();
  trimmedTufts.push(trimmed);
  // Stamped at up to about 45 px; 64 px keeps blades crisp without heavy minification.
  const stamp = await withContactShadow(await sharp(trimmed).resize(60, 60, { fit: 'inside' }).png().toBuffer(),
    { blur: 1.6, offset: 1, opacity: .55 });
  await sharp(stamp).png().toFile(path.join(output, `ground_cover_${id}.png`));
  console.log(`ground_cover_${id}: transparent native-scale tuft`);
}

/**
 * Leafy clumps: organic cut-outs of the low broad-leaved plants in tools/source-art/rockvegetation.
 * Broad leaves stay readable at stamp size, where thin blades would blur into mush. Each source
 * yields two clumps; a noisy radial falloff gives them an irregular, feathered outline.
 */
const CLUMP_SIZE = 128;
let clumpSeed = 0x2f6a91;
const random = () => { clumpSeed = (Math.imul(clumpSeed, 1664525) + 1013904223) >>> 0; return clumpSeed / 4294967296; };
const vegetation = path.join('tools', 'source-art', 'rockvegetation');
let clumpIndex = 0;
for (let sourceIndex = 1; sourceIndex <= 8; sourceIndex++) {
  const input = path.join(vegetation, `${String(sourceIndex).padStart(2, '0')}.png`);
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let cut = 0; cut < 2; cut++) {
    // Opaque centre: retry until the sample point lies inside dense foliage.
    let cx = 0, cy = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      cx = Math.floor(info.width * (.2 + random() * .6));
      cy = Math.floor(info.height * (.3 + random() * .4));
      if (data[(cy * info.width + cx) * 4 + 3] > 200) break;
    }
    const radius = Math.floor(Math.min(info.height * .32, 170 + random() * 130));
    const size = radius * 2, left = Math.max(0, Math.min(info.width - size, cx - radius));
    const top = Math.max(0, Math.min(info.height - size, cy - radius));
    const lobes = Array.from({ length: 5 }, () => ({ phase: random() * Math.PI * 2, amp: .06 + random() * .1 }));
    const crop = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const source = ((top + y) * info.width + left + x) * 4, target = (y * size + x) * 4;
      const dx = x - radius + .5, dy = y - radius + .5, angle = Math.atan2(dy, dx);
      let edge = .78;
      lobes.forEach((lobe, k) => { edge += lobe.amp * Math.sin(angle * (k + 2) + lobe.phase); });
      const t = Math.max(0, Math.min(1, (edge - Math.hypot(dx, dy) / radius) / .28));
      for (let c = 0; c < 3; c++) crop[target + c] = data[source + c];
      crop[target + 3] = Math.round(data[source + 3] * t * t * (3 - 2 * t));
    }
    const clump = await sharp(crop, { raw: { width: size, height: size, channels: 4 } })
      .resize(CLUMP_SIZE, CLUMP_SIZE, { kernel: 'lanczos3' }).modulate({ brightness: 1.35, saturation: 1.05 }).png().toBuffer();
    const id = String(++clumpIndex).padStart(2, '0');
    await sharp(await withContactShadow(clump, { blur: 3, offset: 2, opacity: .65 }))
      .png().toFile(path.join(output, `ground_clump_${id}.png`));
    console.log(`ground_clump_${id}: leafy clump from ${input}`);
  }
}
