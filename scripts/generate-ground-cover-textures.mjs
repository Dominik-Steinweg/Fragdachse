import * as path from 'path';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { runOrganicCoverPipeline } from './lib/organic-cover-pipeline.mjs';
import {
  FOREST_LITTER_CONFIG, FOREST_VEGETATION_CONFIG, GROUND_AREA_COLOR_CONFIG, GROUND_AREA_GREEN_CONFIG,
  GROUND_AREA_SOIL_CONFIG,
} from '../src/arena/GroundCoverConfig.ts';

/**
 * Textures of GROUND_COVER_TIERS (src/arena/GroundCoverConfig.ts):
 *
 * - ground_patch_XX: large moss/grass patches from tools/source-art/groundcover, feathered and
 *   perforated by the shared organic pipeline, then pulled to the hue and value of the grass tile.
 * - ground_cover_XX: small flat blade tufts from tools/source-art/ground-materials.
 * - forest_*: litter and vegetation from tools/source-art/forest-detail, see below.
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
 * Soft contact shadow below flat vegetation and litter. Centred by default: stamps rotate
 * freely, so an offset shadow would point in random directions.
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
    { blur: 1.6, offset: 0, opacity: .55 });
  await sharp(stamp).png().toFile(path.join(output, `ground_cover_${id}.png`));
  console.log(`ground_cover_${id}: transparent native-scale tuft`);
}

/**
 * Forest detail from tools/source-art/forest-detail: litter and vegetation tiers of
 * GROUND_COVER_TIERS. The runtime variant table is the single source of names and physical
 * sizes; each stamp is exported just above its largest display size (no mipmaps at runtime)
 * with a soft, centred contact shadow that stays correct under random stamp rotation.
 */
const FOREST_SOURCE = path.join('tools', 'source-art', 'forest-detail');
/** Per motif family: grade towards the dark forest floor and contact-shadow strength. */
const FOREST_FAMILIES = {
  grass: { modulate: { brightness: .95, saturation: 1.25 }, shadow: .5 },
  plant: { modulate: { brightness: 1.05, saturation: 1.15 }, shadow: .55 },
  flowers: { modulate: { brightness: 1, saturation: .95 }, shadow: .35 },
  stone: { modulate: { brightness: 1.05, saturation: .8 }, shadow: .65 },
  twig: { modulate: { brightness: 1, saturation: .85 }, shadow: .5 },
  leaf: { modulate: { brightness: .95, saturation: .85 }, shadow: .3 },
};
/** The green set was painted for the current grass: exported as authored, only the shadow differs. */
const FOREST_SET_FAMILIES = {
  'candidates-03-color': {
    small: { modulate: { brightness: 1, saturation: 1 }, shadow: .35 },
  },
  'candidates-02-green': {
    grass: { modulate: { brightness: 1, saturation: 1 }, shadow: .5 },
    fern: { modulate: { brightness: 1, saturation: 1 }, shadow: .55 },
    plant: { modulate: { brightness: 1, saturation: 1 }, shadow: .55 },
  },
};
const EXPORT_OVERSAMPLE = 1.3;
for (const tier of [FOREST_LITTER_CONFIG, FOREST_VEGETATION_CONFIG]) {
  for (const variant of tier.variants) {
    const source = variant.fileName.replace(/^forest_/, '').replace(/\.png$/, '');
    const set = variant.sourceSet ?? 'candidates-01';
    const family = (FOREST_SET_FAMILIES[set] ?? FOREST_FAMILIES)[source.split('-')[0]];
    if (!family) throw new Error(`No export family for ${source}`);
    const input = path.join(FOREST_SOURCE, set, `${source}.png`);
    const metadata = await sharp(input).metadata();
    if (!metadata.hasAlpha) throw new Error(`Expected transparent source: ${input}`);
    const longSide = Math.max(12, Math.ceil(variant.sizeCells[1] * 32 * EXPORT_OVERSAMPLE));
    const blur = Math.max(.8, longSide * .035);
    // Sprite plus shadow margin together fill the long side.
    const body = Math.max(8, longSide - Math.ceil(blur * 2) * 2);
    const sprite = await sharp(input).trim({ threshold: 5 }).modulate(family.modulate)
      .resize(body, body, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
    await sharp(await withContactShadow(sprite, { blur, offset: 0, opacity: family.shadow }))
      .png().toFile(path.join(output, variant.fileName));
    console.log(`${variant.fileName}: ${longSide} px from ${source}`);
  }
}

/**
 * Large flat ground surfaces (moss, clover, creeping cover, soil and litter; 2-7 m radius) from
 * tools/source-art (groundcover, forest-detail colour set). Trimmed to the visible surface and exported at their largest
 * world size: flat colour layers without a contact shadow, below the upright vegetation.
 */
const AREA_SOURCE = path.join('tools', 'source-art');
for (const tier of [GROUND_AREA_GREEN_CONFIG, GROUND_AREA_SOIL_CONFIG, GROUND_AREA_COLOR_CONFIG]) {
  for (const variant of tier.variants) {
    const source = variant.fileName.replace(/^ground_area_/, '').replace(/\.png$/, '');
    const input = path.join(AREA_SOURCE, variant.sourceSet, `${source}.png`);
    const metadata = await sharp(input).metadata();
    if (!metadata.hasAlpha) throw new Error(`Expected transparent source: ${input}`);
    const longSide = Math.ceil(variant.sizeCells[1] * 32);
    await sharp(await sharp(input).trim({ threshold: 5 }).png().toBuffer())
      .resize(longSide, longSide, { fit: 'inside', kernel: 'lanczos3' })
      .png({ compressionLevel: 9 }).toFile(path.join(output, variant.fileName));
    console.log(`${variant.fileName}: ${longSide} px from ${source}`);
  }
}
