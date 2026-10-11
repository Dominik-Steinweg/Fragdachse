import { VOID_PALETTE } from '../config';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { getGpuVfxFrame, GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

const EFFECTS = [GpuVfxEffectId.VoidMeteorPlasma, GpuVfxEffectId.VoidMeteorSpark,
  GpuVfxEffectId.VoidMeteorSmoke, GpuVfxEffectId.VoidMeteorFragment, GpuVfxEffectId.VoidMeteorSpark] as const;
const BASE_RATES = [260, 190, 72, 12, 420];
const EDGE_MEMBERS_PER_TICK = 3;
/** Edge fibres burn out in the void family instead of reading as white rain. */
const EDGE_TINTS = [VOID_PALETTE.primary, VOID_PALETTE.primary, VOID_PALETTE.bright, 0xe86bff] as const;

/** One bounded source per material, scheduled by the shared GPU tick after retirement.
 * Impact only stops emission; clear/teardown kills all surviving members with their sources. */
export class VoidMeteorParticleTrail {
  private readonly specs: GpuVfxSpawnSpec[];
  private readonly glow: GpuVfxSpawnSpec;
  private readonly sources = new Int32Array(EFFECTS.length).fill(-1);
  private readonly flows = EFFECTS.map(() => new ParticleFlowScheduler(0));
  private readonly widths: number[];
  private readonly glowWidth: number;
  private readonly stopEmission: () => void;
  private generation: number;
  private active = false;
  private destroyed = false;
  private randomState = 1;
  private edgeRandomState = 1;
  private x = 0; private y = 0;
  private previousX = 0; private previousY = 0;
  private dx = 0; private dy = 0; private angle = 0; private speed = 0;

  constructor(private readonly gpu: GpuVfxSystem) {
    this.specs = EFFECTS.map(effect => gpu.createSpec(effect));
    this.specs[3].frame = GpuVfxFrameId.DeathMorphFrayed;
    this.glow = gpu.createSpec(GpuVfxEffectId.VoidMeteorPlasma);
    this.glow.frame = GpuVfxFrameId.DeathGlow;
    this.glowWidth = getGpuVfxFrame(this.glow.frame).width;
    this.widths = this.specs.map(spec => getGpuVfxFrame(spec.frame).width);
    this.generation = gpu.emissionGeneration;
    this.stopEmission = gpu.registerEmission((delta, now) => this.emit(delta, now));
  }

  start(seed: number): void {
    this.clear(); this.randomState = seed || 1;
    this.edgeRandomState = (seed ^ 0x6d2b79f5) >>> 0;
  }

  sync(x: number, y: number, angle: number, speed: number, active: boolean): void {
    if (this.destroyed) return;
    if (!this.active) { this.previousX = x; this.previousY = y; }
    this.x = x; this.y = y; this.angle = angle;
    this.dx = Math.cos(angle); this.dy = Math.sin(angle);
    this.speed = speed; this.active = active;
  }

  clear(): void {
    this.active = false;
    for (let i = 0; i < EFFECTS.length; i++) {
      // releaseAll invalidates handles; never release a newly recycled source owned elsewhere.
      if (this.generation === this.gpu.emissionGeneration && this.sources[i] >= 0) this.gpu.releaseSource(this.sources[i]);
      this.sources[i] = -1;
      this.flows[i].resetCountdown();
    }
    this.generation = this.gpu.emissionGeneration;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear(); this.stopEmission(); this.destroyed = true;
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  private edgeRandom(): number {
    // Independent stream: edge detail must not reshuffle the existing smoke and fragments.
    this.edgeRandomState = (Math.imul(this.edgeRandomState, 1664525) + 1013904223) >>> 0;
    return this.edgeRandomState / 4294967296;
  }

  private emit(delta: number, now: number): void {
    if (this.generation !== this.gpu.emissionGeneration || this.gpu.isSuppressed()) { this.clear(); return; }
    if (!this.active || delta <= 0) return;
    const dt = Math.min(100, delta);
    const rateFactor = Math.min(1.55, 0.7 + this.speed / 200);
    for (let layer = 0; layer < EFFECTS.length; layer++) {
      const frequency = this.gpu.quality.scaleFrequency(1000 / (BASE_RATES[layer] * rateFactor), EFFECTS[layer]);
      if (frequency <= 0) continue;
      if (this.sources[layer] < 0) this.sources[layer] = this.gpu.createSource(EFFECTS[layer]);
      if (this.sources[layer] < 0) continue;
      const flow = this.flows[layer];
      flow.setFrequency(frequency);
      // Keep quality-scaled scheduling below 1 kHz; three interleaved fibres per edge tick
      // avoid the scheduler's 1 ms floor and retain the same scaling on every quality tier.
      const count = Math.min(50, flow.tick(dt)) * (layer === 4 ? EDGE_MEMBERS_PER_TICK : 1);
      for (let i = 0; i < count; i++) this.spawn(layer, now, (i + 0.5) / count);
    }
    this.previousX = this.x; this.previousY = this.y;
  }

  private spawn(layer: number, now: number, fraction: number): void {
    if (layer === 4) { this.spawnEdge(now, fraction); return; }
    const spec = this.specs[layer];
    const dx = this.dx, dy = this.dy;
    const side = layer === 3 ? (this.random() < 0.5 ? -1 : 1) * (70 + this.random() * 45)
      : (this.random() - 0.5) * (layer === 1 ? 210 : layer === 2 ? 180 : 135);
    const along = layer === 1 || layer === 3 ? 45 + this.random() * 65 : -65 - this.random() * 95;
    const spread = layer === 3 ? Math.sign(side) * (45 + this.random() * 100)
      : (this.random() - 0.5) * (layer === 1 ? 320 : layer === 2 ? 100 : 65);
    const retreat = layer === 0 ? 210 + this.random() * 210 : layer === 1 ? 190 + this.random() * 440
      : layer === 3 ? 120 + this.random() * 220 : 35 + this.random() * 80;
    spec.x = this.previousX + (this.x - this.previousX) * fraction + dx * along - dy * side;
    spec.y = this.previousY + (this.y - this.previousY) * fraction + dy * along + dx * side;
    spec.vx = -dx * retreat - dy * spread; spec.vy = -dy * retreat + dx * spread;
    spec.rotation = layer === 1 ? Math.atan2(spec.vy, spec.vx) : this.angle + (this.random() - 0.5) * 1.6;
    spec.angularVelocity = layer >= 2 ? (this.random() - 0.5) * 3 : 0;
    spec.tintBlendStart = layer === 0 ? 0.8 : layer === 1 ? 0.2 : 1;
    spec.tintBlendEnd = 1;
    if (layer === 0) {
      spec.lifeMs = 320 + this.random() * 230;
      spec.scaleStart = (40 + this.random() * 40) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 0.55;
      spec.stretchStart = 1.6; spec.stretchEnd = 2.6;
      spec.alphaStart = 0.06 + this.random() * 0.05; spec.tint = 0x8031d9;
    } else if (layer === 1) {
      spec.lifeMs = 500 + this.random() * 700;
      spec.scaleStart = (2 + this.random() * 2) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 0.2;
      spec.stretchStart = 5 + this.random() * 5; spec.stretchEnd = 2;
      spec.alphaStart = 0.8; spec.tint = 0xb75fff;
    } else if (layer === 2) {
      spec.lifeMs = 2200 + this.random() * 800;
      spec.scaleStart = (90 + this.random() * 50) / this.widths[layer];
      spec.scaleEnd = spec.scaleStart * 2.1;
      spec.alphaStart = 0.62; spec.tint = 0x674773;
    } else {
      spec.lifeMs = 1400 + this.random() * 700;
      // The chipped motif occupies ~42% of its padded frame. One dark member, no bright
      // polygon copy: the old translucent six-sided rim read as a large bokeh disc.
      spec.scaleStart = (10 + this.random() * 8) / (this.widths[layer] * 0.42);
      spec.scaleEnd = spec.scaleStart * 0.6;
      spec.stretchStart = 0.7 + this.random() * 0.85; spec.stretchEnd = spec.stretchStart;
      spec.alphaStart = 1; spec.tint = 0x160a22;
    }
    this.gpu.spawn(spec, this.sources[layer], now);
    if (layer >= 2 && this.sources[0] >= 0) {
      // Smoke underlighting is unchanged. Fragments carry only a small core-facing ember,
      // never a luminous copy of their full silhouette.
      const glow = this.glow;
      glow.x = spec.x; glow.y = spec.y; glow.vx = spec.vx; glow.vy = spec.vy;
      glow.lifeMs = layer === 2 ? 1800 : spec.lifeMs;
      const width = spec.scaleStart * this.widths[layer] * (layer === 3 ? 0.42 : 1);
      if (layer === 3) {
        const towardCore = width * 0.28 / Math.hypot(along, side);
        const offsetX = (-dx * along + dy * side) * towardCore;
        const offsetY = (-dy * along - dx * side) * towardCore;
        glow.x += offsetX; glow.y += offsetY;
        // Follow the body's shrinking edge over its lifetime.
        glow.vx -= offsetX * 0.4 / (spec.lifeMs / 1000);
        glow.vy -= offsetY * 0.4 / (spec.lifeMs / 1000);
      }
      glow.scaleStart = width * (layer === 2 ? 1.5 : 0.45) / this.glowWidth;
      glow.scaleEnd = glow.scaleStart * (layer === 2 ? 2.0 : 0.6);
      glow.alphaStart = layer === 2 ? 0.012 : 0.65;
      glow.tint = layer === 2 ? 0x642b95 : 0xbe68f7;
      this.gpu.spawn(glow, this.sources[0], now);
    }
  }

  private spawnEdge(now: number, fraction: number): void {
    const spec = this.specs[4];
    const dx = this.dx, dy = this.dy;
    let along: number, side: number;
    const region = this.edgeRandom();
    const front = region < 0.60;
    if (region < 0.72) {
      const angle = front ? (this.edgeRandom() - 0.5) * 2.9 : this.edgeRandom() * Math.PI * 2;
      const radius = 112 + this.edgeRandom() * 24;
      along = Math.cos(angle) * radius;
      side = Math.sin(angle) * radius;
    } else {
      const tail = this.edgeRandom();
      along = -110 - tail * 310;
      side = (this.edgeRandom() < 0.5 ? -1 : 1) * (68 + this.edgeRandom() * 26) * (1 - tail * 0.25);
    }
    // Small, asynchronous eddies peel fibres off both flanks; motion and rotation run on GPU.
    const eddy = Math.sin(now * 0.009 + along * 0.035 + side * 0.021);
    const spread = Math.sign(side) * ((front ? 85 : 20) + this.edgeRandom() * 40) + eddy * 28;
    const retreat = 160 + this.edgeRandom() * 160;
    spec.x = this.previousX + (this.x - this.previousX) * fraction + dx * along - dy * side;
    spec.y = this.previousY + (this.y - this.previousY) * fraction + dy * along + dx * side;
    spec.vx = -dx * retreat - dy * spread; spec.vy = -dy * retreat + dx * spread;
    spec.rotation = Math.atan2(spec.vy, spec.vx) + eddy * 0.2;
    spec.angularVelocity = eddy * 1.4;
    spec.lifeMs = 400 + this.edgeRandom() * 500;
    spec.scaleStart = (2.8 + this.edgeRandom() * 1.4) / this.widths[4];
    spec.scaleEnd = spec.scaleStart * 0.35;
    spec.stretchStart = 3 + this.edgeRandom() * 4; spec.stretchEnd = 5;
    spec.alphaStart = 1;
    spec.tint = EDGE_TINTS[Math.floor(this.edgeRandom() * EDGE_TINTS.length)];
    spec.tintBlendStart = 0.6; spec.tintBlendEnd = 1;
    this.gpu.spawn(spec, this.sources[4], now);
  }
}
