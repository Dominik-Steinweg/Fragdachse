import * as Phaser from 'phaser';
import { EnemyEyeBatch } from './EnemyEyeBatch';

/** Authored stain timeline: pop-in, hold, fade. Evaluated per frame instead of two tweens per decal. */
export interface BloodStainAnimation {
  readonly bornAt: number;
  readonly alpha: number;
  readonly scale: number;
  readonly holdMs: number;
  readonly fadeMs: number;
}

/** One decal as pure data; no Phaser object exists per stain. */
export interface BloodStainRecord {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly tint: number;
  readonly animation: BloodStainAnimation;
}

interface StainGroup {
  readonly batch: EnemyEyeBatch;
  readonly stains: BloodStainRecord[];
}

interface ScheduledStain { readonly at: number; readonly spawn: () => void }

export const BLOOD_STAIN_POP_MS = 80;
export const BLOOD_STAIN_POP_SCALE = 0.82;

/** Alpha and scale of an animated stain, or null once its fade has completed. */
export function sampleBloodStain(animation: BloodStainAnimation, now: number): { alpha: number; scale: number } | null {
  const age = now - animation.bornAt;
  if (age < BLOOD_STAIN_POP_MS) {
    // Quad.easeOut, like the former arrival tween.
    const t = Math.max(0, age) / BLOOD_STAIN_POP_MS, k = t * (2 - t);
    return { alpha: animation.alpha * k, scale: animation.scale * (BLOOD_STAIN_POP_SCALE + (1 - BLOOD_STAIN_POP_SCALE) * k) };
  }
  if (age < animation.holdMs) return { alpha: animation.alpha, scale: animation.scale };
  const fade = (age - animation.holdMs) / Math.max(1, animation.fadeMs);
  if (fade >= 1) return null;
  // Sine.easeIn, like the former fade tween.
  return { alpha: animation.alpha * Math.cos(fade * Math.PI * 0.5), scale: animation.scale };
}

/**
 * WebGL blood stains of one Scene. Stains own a ground depth beneath every figure, so they no
 * longer interleave with actors in the display list: each depth is a single textured-quad batch,
 * written from the stain timelines. Insertion order keeps the alpha compositing of overlaps; the
 * oldest stain gives way once `maxStains` is reached.
 */
export class BloodStainBatch {
  private readonly groups = new Map<number, StainGroup>();
  private readonly scheduled: ScheduledStain[] = [];
  private count = 0;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly texture: string,
    private readonly maxStains: number, private readonly onDestroy: () => void) {
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  get stainCount(): number { return this.count; }

  add(depth: number, stain: BloodStainRecord): void {
    if (this.destroyed) return;
    let group = this.groups.get(depth);
    if (!group) {
      const batch = new EnemyEyeBatch(this.scene, this.texture, 32, depth);
      batch.layer.setName('blood-stains');
      group = { batch, stains: [] };
      this.groups.set(depth, group);
    }
    group.stains.push(stain);
    this.count++;
    while (this.count > this.maxStains) this.evictOldest();
  }

  /** Runs `spawn` in the first post-update at or after `at` (scene clock); cleared with the batch. */
  schedule(at: number, spawn: () => void): void {
    let low = 0, high = this.scheduled.length;
    while (low < high) { const mid = (low + high) >> 1; if (this.scheduled[mid].at <= at) low = mid + 1; else high = mid; }
    this.scheduled.splice(low, 0, { at, spawn });
  }

  private evictOldest(): void {
    let oldest: StainGroup | null = null;
    for (const group of this.groups.values()) {
      if (group.stains.length && (!oldest || group.stains[0].animation.bornAt < oldest.stains[0].animation.bornAt)) oldest = group;
    }
    if (!oldest) { this.count = 0; return; }
    oldest.stains.shift();
    this.count--;
  }

  private runScheduled(): void {
    if (!this.scheduled.length) return;
    const now = this.scene.time.now;
    let due = 0;
    while (due < this.scheduled.length && this.scheduled[due].at <= now) due++;
    if (!due) return;
    for (const { spawn } of this.scheduled.splice(0, due)) {
      spawn();
      if (this.destroyed) return;
    }
  }

  private sync(): void {
    this.runScheduled();
    if (this.destroyed) return;
    const now = this.scene.time.now;
    for (const { batch, stains } of this.groups.values()) {
      const frameWidth = batch.layer.frame.realWidth, frameHeight = batch.layer.frame.realHeight;
      batch.begin(stains.length);
      let kept = 0;
      for (let index = 0; index < stains.length; index++) {
        const stain = stains[index];
        const sample = sampleBloodStain(stain.animation, now);
        if (!sample) continue;
        stains[kept++] = stain;
        if (sample.alpha <= 0) continue;
        // Phaser's Image submitter packed alpha into an 8-bit tint channel; keep that quantization.
        const alpha = ((sample.alpha * 255) | 0) / 255;
        batch.write(stain.x, stain.y, frameWidth * sample.scale, frameHeight * sample.scale, stain.rotation, stain.tint, alpha);
      }
      this.count -= stains.length - kept;
      stains.length = kept;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    for (const { batch, stains } of this.groups.values()) { batch.destroy(); stains.length = 0; }
    this.groups.clear();
    this.scheduled.length = 0;
    this.count = 0;
    this.onDestroy();
  }
}
