import type { SunCloudState } from '../sunlight/cloudShadow';
import type * as Phaser from 'phaser';
import type { SunTuning } from '../sunlight/SunTuning';

/** Borrowed presentation data. Fog never owns this texture, its clock or the
 * surface geometry that produced the receiver; only these shared light fields
 * are consumed. Mutable uniform values may advance while the binding is stable. */
export interface FogWoodlandLight {
  transmissionTexture?: Phaser.Textures.Texture;
  sunStrength?: number;
  sun: readonly [number, number, number];
  /** Global sunlight replaces local transmission; no second ground modulation here. */
  sunCompositeTuning?: SunTuning;
  /** Original presentation settings for exact darkness when direct sunlight is zero. */
  baseFogOpacity?: number;
  baseFogDetail?: number;
  clouds?: SunCloudState;
}
