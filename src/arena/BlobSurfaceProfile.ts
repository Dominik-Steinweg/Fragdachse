import { CELL_SIZE } from '../config';

/** A material-specific configuration for a 47-Blob surface. */
export interface BlobSurfaceProfile {
  /** Stable identifier used for generated texture keys and deterministic noise. */
  readonly id: string;
  /** Texture that contains the 47-Blob frames and its repeated material frame. */
  readonly textureKey: string;
  /** Optional alternate material source; defaults to `textureKey` when omitted. */
  readonly materialTextureKey?: string;
  readonly materialFrame: number;
  /** Keeps otherwise identical profiles from sharing visible noise regions. */
  readonly seedSalt: number;
  readonly shading: {
    readonly baseLevel: number;
    readonly washValueAmount: number;
    readonly washValuePeriods: readonly [number, number];
    readonly washHueAmount: number;
    readonly washHuePeriod: number;
    readonly washHues: readonly number[];
    /** Omit for flat surfaces which must not read as raised geometry. */
    readonly directional?: {
      readonly lightDirection: readonly [number, number];
      readonly edgeLift: number;
      readonly edgeShade: number;
    };
  };
  readonly mottle: BlobSurfaceMottleConfig;
  /** Additional compositing passes, rendered in order after `mottle`. */
  readonly additionalMottleLayers?: readonly BlobSurfaceMottleConfig[];
}

interface BlobSurfaceMottleBaseConfig {
  /**
   * Edge length of the stamp texture. Deliberately `CELL_SIZE`: the game runs with
   * `smoothPixelArt`, so a larger stamp would upscale the 32 px material and downscale it
   * again while stamping – two resampling steps that wash out exactly the mid-frequency
   * detail that makes the stamp work.
   */
  readonly textureSize: number;
  /** `multiply` preserves state tints; `normal` is useful for static, colour-matched material replacement. */
  readonly blend: BlobSurfaceMottleBlend;
  readonly passes: readonly BlobSurfaceMottlePass[];
  readonly falloff: readonly (readonly [number, string])[];
}

/** Uses a colour-compatible material as authored – no contrast expansion, no equalization. */
export interface BlobSurfaceMottleNativeConfig extends BlobSurfaceMottleBaseConfig {
  readonly materialMode: 'native';
}

/**
 * Expands material contrast before stamping. In a MULTIPLY layer the amplitude is the
 * *absolute* range of the source divided by 255, so an additive lift towards white only
 * shifts that range – `materialGain` is what widens it by stacking the material on itself.
 */
export interface BlobSurfaceMottleNormalizedConfig extends BlobSurfaceMottleBaseConfig {
  readonly materialMode: 'normalized';
  /** How often the material is stacked additively. Fractional values run a partial last pass. */
  readonly materialGain: number;
  /**
   * Brightest channel after `materialEqualizeTint`; the neutral mottle point. The lift towards
   * white is derived from it so the brightest material value stays a multiplier of exactly 1
   * at any gain, instead of clipping or darkening the whole mass.
   */
  readonly materialPeak: number;
  /**
   * Pulls all three channel maxima onto `materialPeak` before the gain. Without it the
   * strongest channel clips first, loses its variation and tints the stamp.
   */
  readonly materialEqualizeTint: number;
}

export type BlobSurfaceMottleConfig = BlobSurfaceMottleNativeConfig | BlobSurfaceMottleNormalizedConfig;

/**
 * One scatter length. A profile normally needs two with a clear division of labour: stamps in
 * the order of magnitude of the tile motif are what actually covers it, and a sparse large
 * form ties several cells together. Large soft blotches alone add energy at a different
 * spatial frequency and leave the 32 px grid visible next to them.
 */
export interface BlobSurfaceMottlePass {
  /** Expected stamps per occupied cell; the fractional part is decided per cell. */
  readonly perCell: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly alpha: number;
}

export type BlobSurfaceMottleBlend = 'multiply' | 'normal';

/**
 * Collision-free DynamicTexture key for one generated material stamp of a profile. The key
 * names the layer it belongs to, so a profile whose layers use different material modes
 * cannot end up with a key that describes the wrong one.
 */
export function getBlobSurfaceMottleTextureKey(
  profile: BlobSurfaceProfile,
  mottle: BlobSurfaceMottleConfig = profile.mottle,
  layerIndex = 0,
): string {
  const material = profile.materialTextureKey ?? profile.textureKey;
  return `__blob_surface_${profile.id}_${material}_${mottle.materialMode}_mottle_${layerIndex}`;
}

/** Raised rock surface: a light authored replacement pass plus strong proportional material depth. */
export const ROCK_BLOB_SURFACE_PROFILE: BlobSurfaceProfile = {
  id: 'rock',
  textureKey: 'rocks',
  // The authored alternate is substantially lighter and spatially independent from the base
  // rock sheet, allowing a weak NORMAL pass to break phase and lift the overall stone value.
  materialTextureKey: 'rock_mottle',
  materialFrame: 12,
  // Zero deliberately preserves the pre-profile hash inputs exactly.
  seedSalt: 0,
  shading: {
    baseLevel: 0.98,
    washValueAmount: 0.07,
    washValuePeriods: [11, 4.5],
    washHueAmount: 0.26,
    washHuePeriod: 15,
    washHues: [0xd8b088, 0x9cc0d4, 0xa8c489],
    directional: {
      lightDirection: [Math.SQRT1_2, Math.SQRT1_2],
      edgeLift: 0.03,
      edgeShade: 0.2,
    },
  },
  mottle: {
    textureSize: CELL_SIZE,
    blend: 'normal',
    // `rocks47blob_alt.png`, frame 12, is a light blue-grey authored stone texture that is
    // already value-compatible with the base sheet, so it is stamped exactly as authored.
    materialMode: 'native',
    passes: [
      { perCell: 1.15, minScale: 0.6, maxScale: 1.85, alpha: 0.13 },
      { perCell: 0.18, minScale: 2.4, maxScale: 4.6, alpha: 0.15 },
    ],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.62, 'rgba(0,0,0,0.04)'],
      [0.85, 'rgba(0,0,0,0.42)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  },
  // Keep the existing strong multiply character, but normalize the light authored material
  // first. The warm equalization stops the blue-grey source from cooling the rock mass.
  additionalMottleLayers: [{
    textureSize: CELL_SIZE,
    blend: 'multiply',
    materialMode: 'normalized',
    materialGain: 3,
    // Frame maxima (140, 158, 159) after 0xfff1df equalization peak at about 149.
    materialPeak: 199,
    materialEqualizeTint: 0xfff1df,
    passes: [
      { perCell: 1.15, minScale: 0.6, maxScale: 1.85, alpha: 0.96 },
      { perCell: 0.58, minScale: 2.4, maxScale: 4.6, alpha: 0.92 },
    ],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.62, 'rgba(0,0,0,0.04)'],
      [0.85, 'rgba(0,0,0,0.42)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  }],
};

/**
 * The base sheet supplies the clean Blob silhouette; its alternate supplies an independent,
 * colour-compatible material signal for the non-periodic Mottle pass.
 */
export const DIRT_BLOB_SURFACE_PROFILE: BlobSurfaceProfile = {
  id: 'dirt',
  textureKey: 'dirt',
  // The regular sheet's soft waves are the visible repeating motif. Its authored alternate
  // is color-compatible but structurally distinct, so random mottle stamps can decorrelate it.
  materialTextureKey: 'dirt_mottle',
  materialFrame: 12,
  seedSalt: 0x51d7,
  shading: {
    // Dirt lag mit einer mittleren Helligkeit von 93 deutlich über dem Gras (58) und las sich
    // dadurch als beleuchtete Ebene über einem dunklen Grund. Zusammen mit dem angehobenen
    // Gras-Mittelton halbiert diese Absenkung den Abstand, ohne dass Dirt seine Wärme verliert.
    baseLevel: 0.92,
    washValueAmount: 0.024,
    washValuePeriods: [13, 5.5],
    washHueAmount: 0.055,
    washHuePeriod: 18,
    washHues: [0xb58263, 0xa87d62, 0xc29c76],
  },
  mottle: {
    textureSize: CELL_SIZE,
    // Weak phase break: preserve most of the authored base material.
    blend: 'normal',
    // `dirt47blob_alt.png`, frame 12, has compatible earth colours but not the soft repeating
    // wave of the base sheet, so it breaks phase without any brightness remapping.
    materialMode: 'native',
    passes: [
      { perCell: 1.25, minScale: 0.72, maxScale: 1.85, alpha: 0.35 },
      { perCell: 0.12, minScale: 2.6, maxScale: 4.8, alpha: 0.44 },
    ],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.58, 'rgba(0,0,0,0.03)'],
      [0.84, 'rgba(0,0,0,0.35)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  },
  // Strong material-depth pass above the weak replacement pass. It uses the same generic
  // clipped Mottle path, but Multiply restores texture without erasing the phase break.
  additionalMottleLayers: [{
    textureSize: CELL_SIZE,
    blend: 'multiply',
    materialMode: 'normalized',
    materialGain: 3,
    materialPeak: 92,
    materialEqualizeTint: 0x80caff,
    passes: [
      { perCell: 1.8, minScale: 0.62, maxScale: 2.05, alpha: 0.58 },
      { perCell: 0.28, minScale: 2.4, maxScale: 4.8, alpha: 0.94 },
    ],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.58, 'rgba(0,0,0,0.03)'],
      [0.84, 'rgba(0,0,0,0.35)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  }],
};
