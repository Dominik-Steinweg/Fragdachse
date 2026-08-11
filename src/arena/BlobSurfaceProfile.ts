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

export interface BlobSurfaceMottleConfig {
    readonly textureSize: number;
    /** `multiply` preserves state tints; `normal` is useful for static, colour-matched material replacement. */
    readonly blend: BlobSurfaceMottleBlend;
    /** `normalized` expands material contrast; `native` uses a compatible material without brightness remapping. */
    readonly materialMode: BlobSurfaceMottleMaterialMode;
    readonly materialGain: number;
    /** Brightest channel after `materialEqualizeTint`; the neutral mottle point. */
    readonly materialPeak: number;
    readonly materialEqualizeTint: number;
    readonly passes: readonly BlobSurfaceMottlePass[];
    readonly falloff: readonly (readonly [number, string])[];
}

export interface BlobSurfaceMottlePass {
  readonly perCell: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly alpha: number;
}

export type BlobSurfaceMottleBlend = 'multiply' | 'normal';
export type BlobSurfaceMottleMaterialMode = 'normalized' | 'native';

/** Collision-free DynamicTexture key for a profile's generated material stamp. */
export function getBlobSurfaceMottleTextureKey(profile: BlobSurfaceProfile): string {
  const material = profile.materialTextureKey ?? profile.textureKey;
  return `__blob_surface_${profile.id}_${material}_${profile.mottle.materialMode}_mottle`;
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
    materialMode: 'native',
    // `rocks47blob_alt.png`, frame 12, is a light blue-grey authored stone texture.
    materialGain: 1,
    materialPeak: 159,
    materialEqualizeTint: 0xffffff,
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
    baseLevel: 0.99,
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
    materialMode: 'native',
    // `dirt47blob_alt.png`, frame 12: RGB maxima (143, 91, 72). The alternate has compatible
    // earth colours but not the soft repeating wave of the base sheet.
    materialGain: 1,
    materialPeak: 72,
    materialEqualizeTint: 0x80caff,
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
