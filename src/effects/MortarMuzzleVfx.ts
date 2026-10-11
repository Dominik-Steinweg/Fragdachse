import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

/** Shared GPU lanes; no emitters, timers or per-particle GameObjects. Sources kill on clear. */
export class MortarMuzzleVfx {
  private readonly charge: GpuVfxSpawnSpec;
  private readonly spark: GpuVfxSpawnSpec;
  private readonly smoke: GpuVfxSpawnSpec;
  private readonly bursts: { source: number; until: number }[] = [];
  constructor(private readonly gpu: GpuVfxSystem) {
    this.charge = gpu.createSpec(GpuVfxEffectId.MortarCharge);
    this.spark = gpu.createSpec(GpuVfxEffectId.MortarBurst);
    this.smoke = gpu.createSpec(GpuVfxEffectId.MortarSmoke);
  }
  private count(effect: GpuVfxSpawnSpec['effect'], requested: number): number {
    const count = this.gpu.quality.scaleBurst(effect, requested);
    if (count < requested) this.gpu.recordQualityDrop(effect, requested - count);
    return count;
  }
  createCharge(): number { return this.gpu.createSource(GpuVfxEffectId.MortarCharge); }
  release(source: number): void { this.gpu.releaseSource(source); }
  chargeAt(source: number, x: number, y: number, progress: number, color: number): void {
    if (source < 0) return;
    const count = this.count(this.charge.effect, 1 + Math.floor(progress * 3));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 18;
      Object.assign(this.charge, { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
        vx: -Math.cos(a) * r * 2, vy: -Math.sin(a) * r * 2,
        lifeMs: 300 + progress * 130, scaleStart: 0.3 + progress * 0.25, scaleEnd: 0.05,
        alphaStart: 0.6 + progress * 0.3, alphaEnd: 0, tint: color });
      this.gpu.spawn(this.charge, source, this.gpu.now());
    }
  }
  thump(x: number, y: number, color: number, smokeColor: number, ageMs: number): void {
    const source = this.gpu.createSource(GpuVfxEffectId.MortarSmoke);
    if (source < 0) return;
    this.bursts.push({ source, until: this.gpu.now() + 1500 - ageMs });
    const smokeCount = this.count(this.smoke.effect, 22);
    for (let i = 0; i < smokeCount; i++) {
      const a = i / smokeCount * Math.PI * 2, speed = 20 + Math.random() * 36;
      Object.assign(this.smoke, { x: x + Math.cos(a) * 7, y: y + Math.sin(a) * 7,
        vx: Math.cos(a) * speed + 10, vy: Math.sin(a) * speed,
        lifeMs: 1100 + Math.random() * 400, scaleStart: 1.1 + Math.random() * 0.3,
        scaleEnd: 1.4 + Math.random() * 0.7, scaleEase: GpuVfxEase.QuadOut,
        // The existing neutral billowed volume adds opaque folds; soft lobes dissipate around it.
        frame: i % 3 ? GpuVfxFrameId.ExplosionFireballB : GpuVfxFrameId.ExplosionSmoke,
        alphaStart: 0.85, alphaEnd: 0, tint: i % 7 ? 0x68666d : smokeColor,
        rotation: a, angularVelocity: (i % 2 ? -1 : 1) * 0.25 });
      this.gpu.spawn(this.smoke, source, this.gpu.now(), ageMs);
    }
    const sparkCount = this.count(this.spark.effect, 24);
    for (let i = 0; i < sparkCount; i++) {
      const a = i / sparkCount * Math.PI * 2, speed = 60 + Math.random() * 115;
      Object.assign(this.spark, { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        lifeMs: 180 + Math.random() * 240, scaleStart: 0.55 + Math.random() * 0.5, scaleEnd: 0,
        rotation: a, alphaStart: 0.9, alphaEnd: 0, tint: color });
      this.gpu.spawn(this.spark, source, this.gpu.now(), ageMs);
    }
  }
  update(): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) if (this.gpu.now() >= this.bursts[i].until) {
      this.release(this.bursts[i].source); this.bursts.splice(i, 1);
    }
  }
  clear(): void { for (const burst of this.bursts) this.release(burst.source); this.bursts.length = 0; }
}
