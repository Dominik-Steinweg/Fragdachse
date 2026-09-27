import { ADRENALINE_ESSENCE_LIGHTING as CONFIG } from '../effects/LightingConfig';
import type { LightingSystem } from '../effects/LightingSystem';
import type { GraphicsQuality } from '../graphics/GraphicsQuality';

/** Only access-filtered, actually displayed world poses may enter this presentation helper. */
export interface EssenceLightSource {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly value: number;
  readonly alpha: number;
}

export interface EssenceLightView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface EssenceLightingPresentation {
  update(sources: readonly EssenceLightSource[], quality: GraphicsQuality, view: EssenceLightView | null): void;
  clear(immediate?: boolean): void;
  destroy(): void;
}

export interface EssenceLightFrame {
  readonly lights: readonly { x: number; y: number; radiusPx: number; intensity: number }[];
  readonly lightCount: number;
  /** Unattenuated radial light, queried spatially so canopy cost does not grow with drop count. */
  sampleLightAmount(x: number, y: number): number;
}

interface Bucket {
  x: number; y: number; weight: number; alpha: number;
  minX: number; maxX: number; minY: number; maxY: number;
  radiusPx: number; intensity: number;
}

const MAX_GROUP_RADIUS = Math.max(CONFIG.maxRadiusPx, Math.SQRT2 * CONFIG.bucketSizePx + CONFIG.minRadiusPx / 2);

/** One pooled light per occupied cell, with no selection cap or independent light rendering path. */
export class AdrenalineEssenceLighting implements EssenceLightingPresentation {
  private readonly rows = new Map<number, Map<number, Bucket>>();
  private readonly rowPool: Map<number, Bucket>[] = [];
  private readonly bucketPool: Bucket[] = [];
  private readonly frame = {
    lights: this.bucketPool,
    lightCount: 0,
    sampleLightAmount: (x: number, y: number) => this.sampleLightAmount(x, y),
  };
  private destroyed = false;

  constructor(private readonly lighting: Pick<LightingSystem, 'setEssenceLights'>) {}

  update(sources: readonly EssenceLightSource[], _quality: GraphicsQuality, view: EssenceLightView | null): void {
    if (this.destroyed) return;
    this.rows.clear();
    this.frame.lightCount = 0;
    for (const source of sources) {
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)
        || !Number.isFinite(source.value) || !Number.isFinite(source.alpha)
        || source.value <= 0 || source.alpha <= 0) continue;
      if (view && (source.x + MAX_GROUP_RADIUS < view.x || source.y + MAX_GROUP_RADIUS < view.y
        || source.x - MAX_GROUP_RADIUS > view.x + view.width || source.y - MAX_GROUP_RADIUS > view.y + view.height)) continue;
      const cellX = Math.floor(source.x / CONFIG.bucketSizePx);
      const cellY = Math.floor(source.y / CONFIG.bucketSizePx);
      let row = this.rows.get(cellY);
      if (!row) {
        const index = this.rows.size;
        row = this.rowPool[index] ?? (this.rowPool[index] = new Map());
        row.clear();
        this.rows.set(cellY, row);
      }
      let bucket = row.get(cellX);
      if (!bucket) {
        const index = this.frame.lightCount++;
        bucket = this.bucketPool[index] ?? (this.bucketPool[index] = {
          x: 0, y: 0, weight: 0, alpha: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, radiusPx: 0, intensity: 0,
        });
        bucket.x = bucket.minX = bucket.maxX = source.x;
        bucket.y = bucket.minY = bucket.maxY = source.y;
        bucket.weight = bucket.alpha = 0;
        row.set(cellX, bucket);
      }
      const alpha = Math.min(1, source.alpha);
      // Display weights only: neither huge rewards nor subnormal fading values may overflow the centroid.
      const weight = Math.max(Number.MIN_VALUE, Math.min(source.value, CONFIG.valueHalfSaturation * 8) * alpha);
      const combinedWeight = bucket.weight + weight;
      const fraction = weight / combinedWeight;
      bucket.x += (source.x - bucket.x) * fraction;
      bucket.y += (source.y - bucket.y) * fraction;
      bucket.weight = combinedWeight;
      bucket.alpha = Math.max(bucket.alpha, alpha);
      bucket.minX = Math.min(bucket.minX, source.x); bucket.maxX = Math.max(bucket.maxX, source.x);
      bucket.minY = Math.min(bucket.minY, source.y); bucket.maxY = Math.max(bucket.maxY, source.y);
    }
    for (let index = 0; index < this.frame.lightCount; index++) {
      const bucket = this.bucketPool[index];
      const strength = bucket.weight / (bucket.weight + CONFIG.valueHalfSaturation);
      const reach = Math.hypot(Math.max(bucket.x - bucket.minX, bucket.maxX - bucket.x),
        Math.max(bucket.y - bucket.minY, bucket.maxY - bucket.y));
      // Keep a small lit margin around every pearl, including low-value pearls far from the weighted centre.
      bucket.radiusPx = Math.max(CONFIG.minRadiusPx + (CONFIG.maxRadiusPx - CONFIG.minRadiusPx) * strength,
        reach + CONFIG.minRadiusPx / 2);
      bucket.intensity = (CONFIG.minIntensity + (CONFIG.maxIntensity - CONFIG.minIntensity) * strength) * bucket.alpha;
    }
    // Quality changes resolution in LightingSystem, never which visible pearls receive light.
    this.lighting.setEssenceLights(this, this.frame.lightCount > 0 ? this.frame : null);
  }

  /** Scope/visibility changes remove the borrowed frame immediately; fading is already in source alpha. */
  clear(): void {
    this.lighting.setEssenceLights(this, null);
    this.rows.clear();
    this.frame.lightCount = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.bucketPool.length = this.rowPool.length = 0;
    this.destroyed = true;
  }

  private sampleLightAmount(x: number, y: number): number {
    let total = 0;
    const minX = Math.floor((x - MAX_GROUP_RADIUS) / CONFIG.bucketSizePx);
    const maxX = Math.floor((x + MAX_GROUP_RADIUS) / CONFIG.bucketSizePx);
    const minY = Math.floor((y - MAX_GROUP_RADIUS) / CONFIG.bucketSizePx);
    const maxY = Math.floor((y + MAX_GROUP_RADIUS) / CONFIG.bucketSizePx);
    // Relative loop counters also terminate for finite coordinates above Number.MAX_SAFE_INTEGER.
    for (let iy = 0; iy <= maxY - minY; iy++) {
      const row = this.rows.get(minY + iy);
      if (!row) continue;
      for (let ix = 0; ix <= maxX - minX; ix++) {
        const light = row.get(minX + ix);
        if (!light) continue;
        const distance = Math.hypot(x - light.x, y - light.y);
        if (distance < light.radiusPx) total += (1 - distance / light.radiusPx) ** 2 * light.intensity;
      }
    }
    return total;
  }
}
