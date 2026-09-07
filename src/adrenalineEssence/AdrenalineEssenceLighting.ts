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

interface Bucket {
  key: string;
  x: number;
  y: number;
  weight: number;
  alpha: number;
  visible: boolean;
  distance: number;
}

interface LightSlot {
  readonly key: string;
  bucket: string | null;
  active: boolean;
}

let nextPresentationId = 0;

/** Bounded local light ownership; no gameplay state, clocks, or new light rendering path. */
export class AdrenalineEssenceLighting implements EssenceLightingPresentation {
  private readonly buckets = new Map<string, Bucket>();
  private readonly bucketPool: Bucket[] = [];
  private readonly ranking: Bucket[] = [];
  private readonly selected = new Set<string>();
  private readonly slots: LightSlot[];
  private destroyed = false;

  constructor(private readonly lighting: Pick<LightingSystem, 'setLight' | 'releaseLight'>) {
    const prefix = `adrenaline-essence:${++nextPresentationId}`;
    this.slots = Array.from({ length: CONFIG.maxLights.high }, (_, index) => ({
      key: `${prefix}:${index}`, bucket: null, active: false,
    }));
  }

  update(sources: readonly EssenceLightSource[], quality: GraphicsQuality, view: EssenceLightView | null): void {
    if (this.destroyed) return;
    this.buckets.clear();
    this.ranking.length = 0;
    this.selected.clear();
    let usedBuckets = 0;
    const reach = CONFIG.maxRadiusPx;
    for (const source of sources) {
      if (!Number.isFinite(source.x) || !Number.isFinite(source.y)
        || !Number.isFinite(source.value) || !Number.isFinite(source.alpha)
        || source.value <= 0 || source.alpha <= 0) continue;
      if (view && (source.x + reach < view.x || source.y + reach < view.y
        || source.x - reach > view.x + view.width || source.y - reach > view.y + view.height)) continue;
      const key = `${Math.floor(source.x / CONFIG.bucketSizePx)}:${Math.floor(source.y / CONFIG.bucketSizePx)}`;
      let bucket = this.buckets.get(key);
      if (!bucket) {
        bucket = this.bucketPool[usedBuckets];
        if (!bucket) {
          bucket = { key, x: 0, y: 0, weight: 0, alpha: 0, visible: false, distance: 0 };
          this.bucketPool.push(bucket);
        }
        usedBuckets += 1;
        bucket.key = key;
        bucket.x = bucket.y = bucket.weight = bucket.alpha = bucket.distance = 0;
        bucket.visible = false;
        this.buckets.set(key, bucket);
        this.ranking.push(bucket);
      }
      const alpha = Math.min(1, source.alpha);
      // These are display weights only. Subnormal values must not become a zero divisor,
      // and arbitrarily large valid rewards must not overflow the shared centroid.
      const weight = Math.max(Number.MIN_VALUE, Math.min(source.value, CONFIG.valueHalfSaturation * 8) * alpha);
      const combinedWeight = bucket.weight + weight;
      const fraction = weight / combinedWeight;
      if (bucket.weight === 0) {
        bucket.x = source.x;
        bucket.y = source.y;
      } else {
        // Positions share a spatial cell: interpolate their small difference instead of
        // multiplying world coordinates by reward values and summing those products.
        bucket.x += (source.x - bucket.x) * fraction;
        bucket.y += (source.y - bucket.y) * fraction;
      }
      bucket.weight = combinedWeight;
      bucket.alpha = Math.max(bucket.alpha, alpha);
      bucket.visible ||= !view || (source.x >= view.x && source.x <= view.x + view.width
        && source.y >= view.y && source.y <= view.y + view.height);
    }
    for (const bucket of this.ranking) {
      if (view) {
        bucket.distance = Math.hypot(bucket.x - view.x - view.width / 2, bucket.y - view.y - view.height / 2);
        // A small retention margin prevents swapping equally useful neighbours each frame.
        if (this.slots.some(slot => slot.active && slot.bucket === bucket.key)) bucket.distance *= 0.9;
      }
    }
    this.ranking.sort((left, right) => Number(right.visible) - Number(left.visible)
      || left.distance - right.distance || left.key.localeCompare(right.key));
    const budget = CONFIG.maxLights[quality];
    if (this.ranking.length > budget) this.ranking.length = budget;
    for (const bucket of this.ranking) this.selected.add(bucket.key);

    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      if (index >= budget) {
        this.release(slot, true);
      } else if (slot.active && !this.selected.has(slot.bucket!)) {
        this.release(slot, false);
      }
    }
    for (const bucket of this.ranking) {
      let slot = this.slots.find((candidate, index) => index < budget && candidate.bucket === bucket.key);
      if (!slot) {
        slot = this.slots.find((candidate, index) => index < budget
          && (candidate.bucket === null || !this.selected.has(candidate.bucket)))!;
        // Reuse a fixed key instead of accumulating an unbounded trail of fading lights.
        this.release(slot, true);
        slot.bucket = bucket.key;
      }
      slot.active = true;
      const strength = bucket.weight / (bucket.weight + CONFIG.valueHalfSaturation);
      this.lighting.setLight(slot.key, 'adrenalineEssence', bucket.x, bucket.y, {
        radiusPx: CONFIG.minRadiusPx + (CONFIG.maxRadiusPx - CONFIG.minRadiusPx) * strength,
        intensity: (CONFIG.minIntensity + (CONFIG.maxIntensity - CONFIG.minIntensity) * strength) * bucket.alpha,
        occludes: false,
      });
    }
  }

  /** Visibility/scope changes default to immediate removal, including all fading slots. */
  clear(immediate = true): void {
    for (const slot of this.slots) this.release(slot, immediate);
    this.buckets.clear();
    this.ranking.length = 0;
    this.selected.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.bucketPool.length = 0;
    this.destroyed = true;
  }

  private release(slot: LightSlot, immediate: boolean): void {
    if (slot.bucket === null) return;
    if (immediate) {
      this.lighting.releaseLight(slot.key, { immediate: true });
      slot.bucket = null;
    } else if (slot.active) {
      this.lighting.releaseLight(slot.key);
    }
    slot.active = false;
  }
}
