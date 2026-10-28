/** Cosmetic tuning only. World geometry and gameplay never read these values. */
export const FOG = {
  chunkSize: 512, cellSize: 8, atlasCols: 16, atlasRows: 10,
  activeChunks: 96, cachedChunks: 64, cacheMs: 8000, margin: 384,
  stepMs: 1000 / 30, maxSteps: 2, maxSpeed: 144,
  impulses: { high: 256, medium: 128, low: 32 },
  impulsesPerChunk: 16,
  trailCapacity: 8192, trailTextureWidth: 1024, trailMs: 3200, trailDecayMs: 1100, trailRadius: 5,
  trailEdgeExtent: 1.8, trailEdgeFalloff: 1.65, trailEndFeather: 3, trailEndFeatherMin: 18,
  trailSectorFeather: .45,
  // Gaussian reconstruction footprint in trail-mask texels: a wake never gets thinner than the
  // mask can represent, otherwise its core would bead with the pixel phase along diagonals.
  trailPixelFootprint: 1.1,
  // The wake mask follows screen resolution up to this width; the material stays reduced.
  trailMaskMaxWidth: 2560,
  trainTrailMs: 10000, trainTrailDecayMs: 4600,
  motionGain: 9, dashGain: 1.35,
  smallProjectileStrength: .48, largeProjectileStrength: .43,
  pressureGain: 38, momentumMix: .10, windRelaxation: .035,
  densityScale: 1.85,
  // Separate banks: soft threshold of elongated patches (world px), thin haze in the gaps.
  // A high, narrow threshold keeps banks dense but leaves most of the ground clear; a low one
  // spreads thin fog over the whole view and greys out the ground colours.
  bankLength: 580, bankWidth: 330, bankLow: .56, bankHigh: .74, clearHaze: .035, waterHaze: .09, waterBankBias: .06,
  // A denser Activity fog (Dawn fog night) lowers the threshold by these amounts at full extra cover.
  extraBankLow: .17, extraBankHigh: .11, extraHaze: .04, extraMaxAlpha: .23,
  // World px over which the water weight ramps on both sides of the shoreline.
  waterRamp: 160,
  // Bounded sway in world px and its quasi-periodic cycles in seconds.
  meanderAmplitude: 56, meanderPeriods: [83, 127, 61, 50.4],
  // Soft optical saturation instead of a hard opacity clip.
  materialMaxAlpha: .62, materialGain: 2.4, materialEdge: .03,
  materialMargin: 64,
  // Shaped fog (fogShape): extra peak alpha of its banks; over danger the void haze's own coverage,
  // density gain and optical opacity replace the time-of-day values (GDD Void-Gefahrenzonen V1).
  // voidHue is how far the fog's colour turns violet over danger.
  // voidLuma darkens it to a plum-grey (the night glow lights it from inside).
  // The shape pass runs at this fraction of the material's resolution; the field is far softer.
  shapeDownscale: 4,
  shapedExtraAlpha: .20, voidCover: .72, voidGain: 1.35, voidOpacity: 1.15, voidHue: 1, voidLuma: .74,
  // Fresh void trails flare up as a paler, brighter fog body up to this structure (E12).
  voidFlareBody: .9,
  // Shaped fog's coverage thins to obstacleFloor at an obstacle and is whole obstacleReach px away; the band's
  // contour is eroded by up to obstacleErode px.
  obstacleFloor: .3, obstacleReach: 64, obstacleErode: 44,
  // Wind travel of shaped fog (share of the cloud travel; the patch field drifts .18), how far
  // (world px) a wake's edge is torn and how wide its shoulder is softened.
  // wakeFloor is the share of coverage a fully cleared wake keeps (a faint veil, never a cut).
  shapedDrift: .32, wakeTear: 22, wakeSoft: 11, wakeFloor: .06,
} as const;
export type FogQuality = 'high' | 'medium' | 'low';
export type FogDebug = 'normal' | 'barriers' | 'water' | 'density' | 'unreached' | 'velocity' | 'impulses' | 'surface';
export const FOG_DEBUG: readonly FogDebug[] = ['normal', 'barriers', 'water', 'density', 'unreached', 'velocity', 'impulses', 'surface'];
export interface FogTuning { opacity: number; detail: number; windX: number; windY: number; reaction: number; meander: number }
export function fogTuning(seed: number): FogTuning {
  const angle = ((seed >>> 0) % 997) / 997 * Math.PI * 2;
  return { opacity: .50, detail: .65, windX: Math.cos(angle) * 3.5, windY: Math.sin(angle) * 3.5, reaction: 1, meander: 1 };
}
/** Periodic smooth curve, independent of lighting brightness. [land, water]. */
export function fogDensityAt(minutes: number): readonly [number, number] {
  const keys = [[0, .38, .60], [240, .55, .77], [360, .85, 1], [540, .30, .5],
    [720, .008, .065], [900, .04, .14], [1140, .35, .58], [1440, .38, .60]];
  const time = ((minutes % 1440) + 1440) % 1440;
  for (let i = 1; i < keys.length; i++) if (time <= keys[i][0]) {
    const a = keys[i - 1], b = keys[i];
    let t = (time - a[0]) / (b[0] - a[0]); t = t * t * (3 - 2 * t);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  return [.38, .6];
}
export interface FogRect { x: number; y: number; width: number; height: number }
export interface FogFrame { offsetX: number; offsetY: number; width: number; height: number }
