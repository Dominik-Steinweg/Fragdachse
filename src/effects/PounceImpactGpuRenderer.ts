import type { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';
import { mixColors } from './EffectUtils';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_EVENTS = 16;

/** Tuning of the pounce landing: fine grit, a soft dust ring at the hit edge and a few void glints. */
export const POUNCE_IMPACT_FX = {
  terrainFallback: 0x8f7d5e,
  /** Grit alternates darker and lighter than the ground, so it reads on grass, gravel and sand alike. */
  gritDark: 0x2e2117, gritLight: 0xe6d8b4, gritTintMix: 0.6,
  dustTint: 0xe2d6b8, dustTintMix: 0.7,
  /** Grains of 2–3 world px (the fragment frame is 4 px). */
  grit: { count: 120, scaleMin: 0.42, scaleMax: 0.8, originShare: 0.1, travelMin: 0.15, travelMax: 1.02, lifeMinMs: 480, lifeMaxMs: 860, alpha: 1 },
  /** Soft puffs of 12–20 px that grow and settle at the hit edge. */
  dust: { count: 28, diameterMin: 12, diameterMax: 20, growth: 2.2, travelMin: 0.7, travelMax: 1, lifeMinMs: 700, lifeMaxMs: 1000, alpha: 0.42 },
  /** Fine void specks spread over the whole hit area; emissive, so the hit stays readable at night. */
  glint: { count: 34, scaleMin: 0.06, scaleMax: 0.11, startShare: 0.12, travelMin: 0.4, travelMax: 1, lifeMinMs: 420, lifeMaxMs: 780,
    alpha: 0.95, whiteMin: 0.02, whiteMax: 0.18 },
} as const;

interface ImpactEvent { x: number; y: number; radius: number; glint: number }

function between(min: number, max: number): number { return min + Math.random() * (max - min); }

/**
 * Landing of a pounce on the ground as GPU particles: many fine grains thrown out across the hit
 * area, soft dust settling into a ring at its edge (so the size of the hit reads) and a few short
 * void glints that keep the burst visible at night. Events are deferred to the GPU emission tick
 * so every member is born on the same frame boundary.
 */
export class PounceImpactGpuRenderer {
  private readonly grit: GpuVfxSpawnSpec;
  private readonly dust: GpuVfxSpawnSpec;
  private readonly glint: GpuVfxSpawnSpec;
  private readonly gritSource: number;
  private readonly dustSource: number;
  private readonly glintSource: number;
  private readonly events = Array.from({ length: MAX_EVENTS }, (): ImpactEvent => ({ x: 0, y: 0, radius: 0, glint: 0 }));
  private eventCount = 0;
  private terrain: TerrainColorSnapshot | null = null;
  private destroyed = false;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.grit = gpu.createSpec(GpuVfxEffectId.PounceGrit);
    this.dust = gpu.createSpec(GpuVfxEffectId.PounceDust);
    this.glint = gpu.createSpec(GpuVfxEffectId.PounceGlint);
    this.gritSource = gpu.createSource(GpuVfxEffectId.PounceGrit);
    this.dustSource = gpu.createSource(GpuVfxEffectId.PounceDust);
    this.glintSource = gpu.createSource(GpuVfxEffectId.PounceGlint);
    gpu.registerEmission(() => this.emitFrame());
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void { this.terrain = snapshot; }

  /** Queues one landing at the announced point; `radius` is the hit radius, `glint` the void accent colour. */
  play(x: number, y: number, radius: number, glint: number): void {
    if (this.destroyed || !Number.isFinite(x + y + radius) || radius <= 0 || this.eventCount >= this.events.length) return;
    const event = this.events[this.eventCount++];
    event.x = x; event.y = y; event.radius = radius; event.glint = glint;
  }

  clear(): void {
    this.eventCount = 0;
    this.gpu.clearSource(this.gritSource); this.gpu.clearSource(this.dustSource); this.gpu.clearSource(this.glintSource);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.terrain = null;
    this.gpu.releaseSource(this.gritSource); this.gpu.releaseSource(this.dustSource); this.gpu.releaseSource(this.glintSource);
  }

  private emitFrame(): void {
    if (this.destroyed || !this.eventCount) return;
    const count = this.eventCount;
    this.eventCount = 0;
    if (this.gpu.isSuppressed()) return;
    for (let i = 0; i < count; i++) {
      const event = this.events[i];
      const ground = this.terrain?.sample(event.x, event.y) ?? POUNCE_IMPACT_FX.terrainFallback;
      this.spawnGrit(event, ground);
      this.spawnDust(event, ground);
      this.spawnGlints(event);
    }
  }

  private scaledCount(effect: GpuVfxEffectId, count: number): number {
    const result = this.gpu.quality.scaleDiscreteBurst(effect, count);
    if (result < count) this.gpu.recordQualityDrop(effect, count - result);
    return result;
  }

  /** Fine grit fanned out evenly (golden angle) across the whole hit area, darker than the ground. */
  private spawnGrit(event: ImpactEvent, ground: number): void {
    const tuning = POUNCE_IMPACT_FX.grit, spec = this.grit, now = this.gpu.now();
    const count = this.scaledCount(GpuVfxEffectId.PounceGrit, tuning.count);
    const phase = between(0, TAU);
    for (let i = 0; i < count; i++) {
      const direction = phase + i * GOLDEN_ANGLE + between(-0.12, 0.12);
      const distance = event.radius * between(tuning.travelMin, tuning.travelMax);
      spec.lifeMs = between(tuning.lifeMinMs, tuning.lifeMaxMs);
      // Grains start across a small core rather than one point, so the first frame is no clump.
      const start = event.radius * tuning.originShare * Math.sqrt(Math.random());
      spec.x = event.x + Math.cos(direction) * start; spec.y = event.y + Math.sin(direction) * start;
      spec.vx = Math.cos(direction) * Math.max(0, distance - start) * 1000 / spec.lifeMs;
      spec.vy = Math.sin(direction) * Math.max(0, distance - start) * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = between(0, TAU); spec.angularVelocity = between(-6, 6); spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(tuning.scaleMin, tuning.scaleMax); spec.scaleEnd = spec.scaleStart * 0.7;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = between(1, 1.8); spec.stretchEnd = 1;
      spec.alphaStart = tuning.alpha; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
      spec.tint = mixColors(ground, i % 2 === 0 ? POUNCE_IMPACT_FX.gritDark : POUNCE_IMPACT_FX.gritLight,
        POUNCE_IMPACT_FX.gritTintMix + between(-0.12, 0.12));
      this.gpu.spawn(spec, this.gritSource, now);
    }
  }

  /** Soft dust that slides out and settles near the hit edge, so the size of the hit stays readable. */
  private spawnDust(event: ImpactEvent, ground: number): void {
    const tuning = POUNCE_IMPACT_FX.dust, spec = this.dust, now = this.gpu.now();
    const count = this.scaledCount(GpuVfxEffectId.PounceDust, tuning.count);
    const phase = between(0, TAU);
    for (let i = 0; i < count; i++) {
      const direction = phase + i / count * TAU + between(-0.1, 0.1);
      const distance = event.radius * between(tuning.travelMin, tuning.travelMax);
      const body = i % 2 === 0;
      spec.frame = body ? GpuVfxFrameId.ExplosionSmoke : GpuVfxFrameId.LeafBlowerDust;
      spec.lifeMs = between(tuning.lifeMinMs, tuning.lifeMaxMs);
      spec.x = event.x + Math.cos(direction) * 6; spec.y = event.y + Math.sin(direction) * 6;
      spec.vx = Math.cos(direction) * distance * 1000 / spec.lifeMs;
      spec.vy = Math.sin(direction) * distance * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction; spec.angularVelocity = between(-0.8, 0.8); spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(tuning.diameterMin, tuning.diameterMax) / (body ? 56 : 18);
      spec.scaleEnd = spec.scaleStart * tuning.growth;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = 1.5; spec.stretchEnd = 1.1;
      spec.alphaStart = tuning.alpha * (body ? 1 : 0.8); spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
      spec.tint = mixColors(ground, POUNCE_IMPACT_FX.dustTint, POUNCE_IMPACT_FX.dustTintMix + between(-0.08, 0.08));
      this.gpu.spawn(spec, this.dustSource, now);
    }
  }

  /** Fine emissive specks in the rabbit's void colour, starting off-centre and spreading to the hit edge. */
  private spawnGlints(event: ImpactEvent): void {
    const tuning = POUNCE_IMPACT_FX.glint, spec = this.glint, now = this.gpu.now();
    const count = this.scaledCount(GpuVfxEffectId.PounceGlint, tuning.count);
    const phase = between(0, TAU);
    for (let i = 0; i < count; i++) {
      const direction = phase + i * GOLDEN_ANGLE;
      const distance = event.radius * between(tuning.travelMin, tuning.travelMax);
      // An uneven start keeps the first frame from reading as a stamped ring.
      const start = event.radius * tuning.startShare * between(0.3, 1.4);
      spec.lifeMs = between(tuning.lifeMinMs, tuning.lifeMaxMs);
      spec.x = event.x + Math.cos(direction) * start; spec.y = event.y + Math.sin(direction) * start;
      spec.vx = Math.cos(direction) * (distance - start) * 1000 / spec.lifeMs;
      spec.vy = Math.sin(direction) * (distance - start) * 1000 / spec.lifeMs;
      spec.positionEase = GpuVfxEase.QuadOut;
      spec.rotation = direction; spec.angularVelocity = 0; spec.rotationEase = GpuVfxEase.QuadOut;
      spec.scaleStart = between(tuning.scaleMin, tuning.scaleMax); spec.scaleEnd = spec.scaleStart * 0.55;
      spec.scaleEase = GpuVfxEase.QuadOut;
      spec.stretchStart = 1.7; spec.stretchEnd = 1;
      spec.alphaStart = tuning.alpha; spec.alphaEnd = 0; spec.alphaEase = GpuVfxEase.CubicIn;
      spec.tint = mixColors(event.glint, 0xffffff, between(tuning.whiteMin, tuning.whiteMax));
      this.gpu.spawn(spec, this.glintSource, now);
    }
  }
}
