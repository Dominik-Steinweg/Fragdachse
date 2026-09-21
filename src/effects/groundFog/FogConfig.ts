/** Cosmetic tuning only. World geometry and gameplay never read these values. */
export const FOG = {
  chunkSize: 512, cellSize: 8, atlasCols: 16, atlasRows: 10,
  activeChunks: 96, cachedChunks: 64, cacheMs: 8000, margin: 384,
  stepMs: 1000 / 30, maxSteps: 2, maxSpeed: 144,
  impulses: { high: 256, medium: 128, low: 32 },
  impulsesPerChunk: 16,
  trailCapacity: 2048, trailMs: 320, trailTile: 128, trailsPerTile: 32,
  densityScale: 1.85,
  materialMargin: 64,
} as const;
export type FogQuality = 'high' | 'medium' | 'low';
export type FogDebug = 'normal' | 'barriers' | 'water' | 'density' | 'unreached' | 'velocity' | 'impulses' | 'surface';
export const FOG_DEBUG: readonly FogDebug[] = ['normal', 'barriers', 'water', 'density', 'unreached', 'velocity', 'impulses', 'surface'];
export interface FogTuning { opacity: number; detail: number; windX: number; windY: number; reaction: number }
export function fogTuning(seed: number): FogTuning {
  const angle = ((seed >>> 0) % 997) / 997 * Math.PI * 2;
  return { opacity: .50, detail: .65, windX: Math.cos(angle) * 12, windY: Math.sin(angle) * 12, reaction: 1 };
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
