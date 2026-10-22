import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';

/** Ambient emitters at structure sockets: forge embers rise, chimneys and exhausts smoke. */
export interface LobbyStructureEmitter {
  readonly kind: 'ember' | 'smoke';
  readonly x: number;
  readonly y: number;
  /** Mean interval between particles in ms before quality scaling. */
  readonly intervalMs: number;
}

export type LobbyStructureBurst = 'anvil' | 'grind' | 'stamp';

/** Warm forge sparks, cold grinder sparks; both read as metal work, not as fire. */
const SPARK_TINTS = { anvil: [0xffd27a, 0xffa23a, 0xfff0c0], grind: [0xfff4d8, 0xffc070, 0xffffff] } as const;

/**
 * GPU particles of the lobby structures on the scene's shared VFX backend: steady ambient
 * emitters and short bursts the staff animations fire on their markers. Allocation-free per
 * frame; release kills the live members with their sources.
 */
export class LobbyStructureFx {
  private readonly spark: GpuVfxSpawnSpec;
  private readonly ember: GpuVfxSpawnSpec;
  private readonly smoke: GpuVfxSpawnSpec;
  private readonly sparkSource: number;
  private readonly emberSource: number;
  private readonly smokeSource: number;
  private readonly carry: number[];
  private readonly unregister: () => void;
  private active = true;

  constructor(private readonly system: GpuVfxSystem, private readonly emitters: readonly LobbyStructureEmitter[]) {
    this.spark = system.createSpec(GpuVfxEffectId.LobbySpark);
    this.ember = system.createSpec(GpuVfxEffectId.LobbyEmber);
    this.smoke = system.createSpec(GpuVfxEffectId.LobbySmoke);
    this.sparkSource = system.createSource(GpuVfxEffectId.LobbySpark);
    this.emberSource = system.createSource(GpuVfxEffectId.LobbyEmber);
    this.smokeSource = system.createSource(GpuVfxEffectId.LobbySmoke);
    this.carry = emitters.map(() => Math.random());
    this.unregister = system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  /** Hidden Worlds and handoffs pause the ambient emission; live members fade out normally. */
  setActive(active: boolean): void { this.active = active; }

  private emit(deltaMs: number, nowMs: number): void {
    if (!this.active) return;
    this.emitters.forEach((emitter, index) => {
      const effect = emitter.kind === 'ember' ? GpuVfxEffectId.LobbyEmber : GpuVfxEffectId.LobbySmoke;
      const interval = this.system.quality.scaleFrequency(emitter.intervalMs, effect);
      if (interval <= 0) return;
      this.carry[index] += deltaMs / interval;
      while (this.carry[index] >= 1) {
        this.carry[index] -= 1;
        if (emitter.kind === 'ember') this.emitEmber(emitter, nowMs); else this.emitSmoke(emitter, nowMs);
      }
    });
  }

  private emitEmber(emitter: LobbyStructureEmitter, nowMs: number): void {
    const spec = this.ember;
    spec.lifeMs = 700 + Math.random() * 900;
    spec.x = emitter.x + (Math.random() - .5) * 18; spec.y = emitter.y + (Math.random() - .5) * 12;
    spec.vx = (Math.random() - .5) * 14; spec.vy = -10 - Math.random() * 18;
    spec.scaleStart = .12 + Math.random() * .1; spec.scaleEnd = 0;
    spec.alphaStart = .85; spec.alphaEnd = 0;
    spec.tint = Math.random() < .3 ? 0xffd27a : 0xff7a2a;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  private emitSmoke(emitter: LobbyStructureEmitter, nowMs: number): void {
    const spec = this.smoke;
    spec.lifeMs = 2600 + Math.random() * 1600;
    spec.x = emitter.x + (Math.random() - .5) * 6; spec.y = emitter.y + (Math.random() - .5) * 6;
    // Drift with a light, steady breeze; the plume widens and thins as it rises.
    spec.vx = 6 + Math.random() * 6; spec.vy = -4 - Math.random() * 5;
    spec.scaleStart = .22 + Math.random() * .08; spec.scaleEnd = .7 + Math.random() * .25;
    spec.alphaStart = .26; spec.alphaEnd = 0;
    spec.tint = 0x8a8680;
    this.system.spawn(spec, this.smokeSource, nowMs);
  }

  /** A work moment: anvil strike, grinder or spanner tap, or the quiet glint of a stamp. */
  burst(kind: LobbyStructureBurst, x: number, y: number): void {
    const nowMs = this.system.now();
    if (kind === 'stamp') {
      const spec = this.ember;
      spec.lifeMs = 260; spec.x = x; spec.y = y; spec.vx = 0; spec.vy = 0;
      spec.scaleStart = .5; spec.scaleEnd = 1.1; spec.alphaStart = .45; spec.alphaEnd = 0; spec.tint = 0xfff2c8;
      this.system.spawn(spec, this.emberSource, nowMs);
      return;
    }
    const tints = SPARK_TINTS[kind];
    const count = this.system.quality.scaleBurst(GpuVfxEffectId.LobbySpark, kind === 'anvil' ? 12 : 6);
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2, speed = 50 + Math.random() * (kind === 'anvil' ? 90 : 60);
      const spec = this.spark;
      spec.lifeMs = 180 + Math.random() * 260;
      spec.x = x; spec.y = y;
      spec.vx = Math.cos(angle) * speed; spec.vy = Math.sin(angle) * speed;
      spec.scaleStart = .16 + Math.random() * .1; spec.scaleEnd = .02;
      spec.alphaStart = 1; spec.alphaEnd = 0;
      spec.tint = tints[index % tints.length];
      this.system.spawn(spec, this.sparkSource, nowMs);
    }
  }

  destroy(): void {
    this.unregister();
    this.system.releaseSource(this.sparkSource);
    this.system.releaseSource(this.emberSource);
    this.system.releaseSource(this.smokeSource);
    for (const effect of [GpuVfxEffectId.LobbySpark, GpuVfxEffectId.LobbyEmber, GpuVfxEffectId.LobbySmoke]) {
      this.system.quality.resetCarry(effect);
    }
  }
}
