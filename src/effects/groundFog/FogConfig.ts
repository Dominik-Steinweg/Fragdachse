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
  trainTrailMs: 10000, trainTrailDecayMs: 4600,
  motionGain: 9, dashGain: 1.35,
  smallProjectileStrength: .48, largeProjectileStrength: .43,
  pressureGain: 38, momentumMix: .10, windRelaxation: .035,
  densityScale: 1.85,
  // Separate banks: soft threshold of elongated patches (world px), thin haze in the gaps.
  bankLength: 580, bankWidth: 330, bankLow: .50, bankHigh: .78, clearHaze: .07, waterHaze: .12, waterBankBias: .06,
  // World px over which the water weight ramps on both sides of the shoreline.
  waterRamp: 160,
  // Bounded sway in world px and its quasi-periodic cycles in seconds.
  meanderAmplitude: 56, meanderPeriods: [83, 127, 61, 50.4],
  // Soft optical saturation instead of a hard opacity clip.
  materialMaxAlpha: .58, materialGain: 2.4, materialEdge: .03,
  materialMargin: 64,
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
