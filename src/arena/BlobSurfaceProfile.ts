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

/**
 * Maximaler Ueberstand eines Mottle-Stamps ueber seine Quellzelle hinaus.
 *
 * Dirty-Region-Bakes koennen damit Quellzellen konservativ vorfiltern, ohne wieder alle
 * Felsen der Arena zu stempeln. Die Stamp-Mitte liegt innerhalb der Zelle; der Radius ergibt
 * sich aus `maxScale * CELL_SIZE / 2` und ist unabhaengig von der Texturaufloesung. Die Ecken des
 * gedrehten Quadrats zaehlen nicht mit: Die Falloff-Maske radiert den Stempel bereits auf seinem
 * Innkreis vollstaendig weg.
 *
 * Bewusst hier und nicht in `BlobSurfaceMottle`: Die Zahl folgt allein aus dem Profil, und die
 * Chunk-Geometrie braucht sie ohne Phaser-Abhaengigkeit.
 */
export function getBlobSurfaceMottleReachPx(profile: BlobSurfaceProfile): number {
  let maxScale = 0;
  for (const mottle of [profile.mottle, ...(profile.additionalMottleLayers ?? [])]) {
    for (const pass of mottle.passes) maxScale = Math.max(maxScale, pass.maxScale);
  }
  return maxScale * CELL_SIZE * 0.5;
}

/**
 * Raised rock surface. The continuous authored material, silhouette and edge light live in the
 * rock base atlas (RockBaseConfig); this profile only adds corner tints and a broad, weak
 * value variation on top, so the stone structure stays readable.
 */
export const ROCK_BLOB_SURFACE_PROFILE: BlobSurfaceProfile = {
  id: 'rock',
  textureKey: 'rocks',
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
    // The base atlas no longer repeats per cell, so no replacement pass is needed.
    materialMode: 'native',
    passes: [],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.62, 'rgba(0,0,0,0.04)'],
      [0.85, 'rgba(0,0,0,0.42)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  },
  // Broad, weak value variation only: small stamps would lay the old sheet's grain over the
  // new stone. Normalized with a warm equalization so the blue-grey source adds no cast.
  additionalMottleLayers: [{
    textureSize: CELL_SIZE,
    blend: 'multiply',
    materialMode: 'normalized',
    materialGain: 3,
    // Frame maxima (140, 158, 159) after 0xfff1df equalization peak at about 149.
    materialPeak: 199,
    materialEqualizeTint: 0xfff1df,
    passes: [
      { perCell: 0.58, minScale: 2.4, maxScale: 4.6, alpha: 0.4 },
    ],
    falloff: [
      [0, 'rgba(0,0,0,0)'],
      [0.62, 'rgba(0,0,0,0.04)'],
      [0.85, 'rgba(0,0,0,0.42)'],
      [1, 'rgba(0,0,0,1)'],
    ],
  }],
};

/** Flat soil colour policy. DirtSurfaceField owns coverage; the authored material owns detail. */
export const DIRT_BLOB_SURFACE_PROFILE: BlobSurfaceProfile = {
  id: 'dirt',
  textureKey: 'dirt_material',
  materialFrame: 0,
  seedSalt: 0x51d7,
  shading: {
    baseLevel: 1,
    washValueAmount: 0,
    washValuePeriods: [13, 5.5],
    washHueAmount: 0,
    washHuePeriod: 18,
    washHues: [0xffffff],
  },
  // Soil is a continuous authored material. It needs no per-cell material replacement.
  mottle: { textureSize: CELL_SIZE, blend: 'normal', materialMode: 'native', passes: [], falloff: [] },
};

