import { GpuVfxFrameId } from '../../effects/gpu/GpuVfxAtlas';
import { GpuVfxEase } from '../../effects/gpu/GpuVfxEase';
import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';

/** Socket kinds of the fort asset that carry particles; positions are world pixels. */
export type BaseFortEmitterKind = 'torch' | 'bowl' | 'hearth';
export interface BaseFortEmitter { readonly kind: BaseFortEmitterKind; readonly x: number; readonly y: number }

/** The breeze the asset's pennants show: towards world +X, a little north. */
const WIND = { x: 1, y: -.2 };
const WIND_ANGLE = Math.atan2(WIND.y, WIND.x);
/**
 * Three fires of one fort. Torches burn pitch: a yellow-orange flame with a pale core. The fire bowls
 * burn wood on coal: a wider, redder flame with more smoke and sparks. The hearth in the courtyard is
 * a log fire: the largest, a hot yellow heart in a ring of orange tongues, with a steady smoke column.
 * All are seen from above, where a flame rises towards the camera and leans downwind; daylight washes
 * them out a little.
 */
const FIRE = {
  torch: { core: 0xffd8a0, flame: 0xffe0b8, dayAlpha: .75 },
  bowl: { core: 0xff7a34, flame: 0xff8a48, dayAlpha: .9 },
  hearth: { core: 0xffb050, flame: 0xff9a4c, dayAlpha: .95 },
} as const;
const SPARKS = [0xffc070, 0xff8a40] as const;
const SMOKE = 0x4c4540;
/** The flame motif's head sits this far behind the frame centre (px of the 32 px frame). */
const FLAME_HEAD_OFFSET = 8;

/**
 * One particle stream at an emitter: mean interval by day and at night, scaled by the shared GPU
 * quality. Night is the World's artificial-light factor (0 noon … 1 night).
 */
interface Channel {
  readonly emitter: BaseFortEmitter;
  readonly dayMs: number;
  readonly nightMs: number;
  readonly effect: GpuVfxEffectId;
  readonly spawn: (emitter: BaseFortEmitter, night: number, nowMs: number) => void;
  carry: number;
}

/**
 * GPU particles of the persistent base fort on the scene's shared VFX backend: large torches and
 * fire bowls, each a slowly breathing flame over a steady glow, with sparks and smoke. The night's
 * atmosphere comes from these fires and their light. Allocation-free per frame; release kills the
 * live members with their sources.
 */
export class BaseFortFx {
  private readonly flame: GpuVfxSpawnSpec;
  private readonly ember: GpuVfxSpawnSpec;
  private readonly smoke: GpuVfxSpawnSpec;
  private readonly flameSource: number;
  private readonly emberSource: number;
  private readonly smokeSource: number;
  private readonly channels: Channel[] = [];
  private readonly unregister: () => void;
  private active = true;
  private night = 0;

  constructor(private readonly system: GpuVfxSystem, emitters: readonly BaseFortEmitter[]) {
    this.flame = system.createSpec(GpuVfxEffectId.BaseFortFlame);
    this.ember = system.createSpec(GpuVfxEffectId.BaseFortEmber);
    this.smoke = system.createSpec(GpuVfxEffectId.BaseFortSmoke);
    this.flameSource = system.createSource(GpuVfxEffectId.BaseFortFlame);
    this.emberSource = system.createSource(GpuVfxEffectId.BaseFortEmber);
    this.smokeSource = system.createSource(GpuVfxEffectId.BaseFortSmoke);
    const flame = GpuVfxEffectId.BaseFortFlame, ember = GpuVfxEffectId.BaseFortEmber, smoke = GpuVfxEffectId.BaseFortSmoke;
    for (const emitter of emitters) {
      const add = (dayMs: number, nightMs: number, effect: GpuVfxEffectId, spawn: Channel['spawn']) =>
        this.channels.push({ emitter, dayMs, nightMs, effect, spawn, carry: Math.random() });
      if (emitter.kind === 'torch') {
        add(170, 170, flame, (e, n, t) => this.emitTorchCore(e, n, t));
        add(130, 130, flame, (e, n, t) => this.emitTorchFlame(e, n, t));
        add(1500, 900, ember, (e, n, t) => this.emitSpark(e, .8, SPARKS[0], t));
        add(800, 1000, smoke, (e, n, t) => this.emitSmoke(e, n, .8, t));
      } else if (emitter.kind === 'hearth') {
        add(150, 150, flame, (e, n, t) => this.emitHearthCore(e, n, t));
        add(70, 70, flame, (e, n, t) => this.emitHearthFlame(e, n, t));
        add(170, 130, ember, (e, n, t) => this.emitSpark(e, 1.2, SPARKS[Math.random() < .5 ? 0 : 1], t));
        add(240, 300, smoke, (e, n, t) => this.emitSmoke(e, n, 2, t));
      } else {
        add(190, 190, flame, (e, n, t) => this.emitBowlCore(e, n, t));
        add(130, 130, flame, (e, n, t) => this.emitBowlFlame(e, n, t));
        add(380, 280, ember, (e, n, t) => this.emitSpark(e, 1, SPARKS[Math.random() < .4 ? 0 : 1], t));
        add(420, 520, smoke, (e, n, t) => this.emitSmoke(e, n, 1.3, t));
      }
    }
    this.unregister = system.registerEmission((deltaMs, nowMs) => this.emit(deltaMs, nowMs));
  }

  /** A fallen fort and a World without lighting stop emitting; live members fade out normally. */
  setActive(active: boolean): void { this.active = active; }

  setNight(night: number): void { this.night = Math.min(1, Math.max(0, night)); }

  private emit(deltaMs: number, nowMs: number): void {
    if (!this.active) return;
    const night = this.night;
    for (const channel of this.channels) {
      const base = channel.dayMs + (channel.nightMs - channel.dayMs) * night;
      const interval = this.system.quality.scaleFrequency(base, channel.effect);
      if (interval <= 0) continue;
      channel.carry += deltaMs / interval;
      while (channel.carry >= 1) {
        channel.carry -= 1;
        channel.spawn(channel.emitter, night, nowMs);
      }
    }
  }

  /** Daylight washes a flame out; at night it burns at full strength. */
  private static dayFade(dayAlpha: number, night: number): number {
    return dayAlpha + (1 - dayAlpha) * night;
  }

  /** A steady glow under a flame: long, overlapping lives and next to no motion keep it from strobing. */
  private glow(emitter: BaseFortEmitter, scale: number, alpha: number, tint: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.FlameCore;
    spec.lifeMs = 700 + Math.random() * 160;
    spec.x = emitter.x + (Math.random() - .5); spec.y = emitter.y + (Math.random() - .5);
    spec.vx = WIND.x * 1.5; spec.vy = WIND.y * 1.5;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale; spec.scaleEnd = scale * .9; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1; spec.stretchEnd = 1.1;
    spec.alphaStart = alpha; spec.alphaEnd = alpha * .25;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.rotation = WIND_ANGLE; spec.angularVelocity = 0;
    spec.tint = tint; spec.tintBlendStart = 1; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /**
   * One soft flame motif with its head over the fire, leaning `lean`. It rises towards the camera, so
   * it grows a little, stretches downwind and fades; many overlapping members make one flame whose
   * outline changes slowly.
   */
  private lick(x: number, y: number, lean: number, scale: number, lifeMs: number, alpha: number,
    tint: number, cooling: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.TorchFlame;
    spec.lifeMs = lifeMs;
    spec.x = x + Math.cos(lean) * FLAME_HEAD_OFFSET * scale; spec.y = y + Math.sin(lean) * FLAME_HEAD_OFFSET * scale;
    const speed = 2 + Math.random() * 2;
    spec.vx = WIND.x * speed; spec.vy = WIND.y * speed;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale * .85; spec.scaleEnd = scale * 1.05; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = .8; spec.stretchEnd = 1.05;
    spec.alphaStart = alpha; spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.rotation = lean; spec.angularVelocity = (Math.random() - .5) * .25;
    spec.tint = tint; spec.tintBlendStart = cooling; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  private emitTorchCore(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    this.glow(emitter, .24, .5 * BaseFortFx.dayFade(FIRE.torch.dayAlpha, night), FIRE.torch.core, nowMs);
  }

  /** The torch flame: a narrow fan of soft licks downwind, each slow and long-lived. */
  private emitTorchFlame(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    this.lick(emitter.x + (Math.random() - .5) * 1.2, emitter.y + (Math.random() - .5) * 1.2,
      WIND_ANGLE + (Math.random() - .5) * .5, .44 + Math.random() * .08, 820 + Math.random() * 220,
      (.3 + .06 * night) * BaseFortFx.dayFade(FIRE.torch.dayAlpha, night), FIRE.torch.flame, 1, nowMs);
  }

  private emitBowlCore(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    this.glow(emitter, .32, .5 * BaseFortFx.dayFade(FIRE.bowl.dayAlpha, night), FIRE.bowl.core, nowMs);
  }

  /** The bowl fire: licks rise from all over the coal bed, spread wider and redder than a torch's. */
  private emitBowlFlame(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const a = Math.random() * Math.PI * 2, d = 2.6 * Math.sqrt(Math.random());
    this.lick(emitter.x + Math.cos(a) * d, emitter.y + Math.sin(a) * d,
      WIND_ANGLE + (Math.random() - .5) * 1.4, .36 + Math.random() * .1, 900 + Math.random() * 260,
      (.26 + .06 * night) * BaseFortFx.dayFade(FIRE.bowl.dayAlpha, night), FIRE.bowl.flame, .45, nowMs);
  }

  private emitHearthCore(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    this.glow(emitter, .5, .55 * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, night), FIRE.hearth.core, nowMs);
  }

  /** The log fire: tongues rise from the whole bed between the logs and lean downwind, larger than a bowl's. */
  private emitHearthFlame(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const a = Math.random() * Math.PI * 2, d = 5 * Math.sqrt(Math.random());
    this.lick(emitter.x + Math.cos(a) * d, emitter.y + Math.sin(a) * d,
      WIND_ANGLE + (Math.random() - .5) * 1.2, .5 + Math.random() * .16, 1000 + Math.random() * 300,
      (.28 + .06 * night) * BaseFortFx.dayFade(FIRE.hearth.dayAlpha, night), FIRE.hearth.flame, .5, nowMs);
  }

  /** Sparks break off, drift with the breeze and burn out. */
  private emitSpark(emitter: BaseFortEmitter, size: number, tint: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 650 + Math.random() * 400;
    spec.x = emitter.x + (Math.random() - .5) * 3; spec.y = emitter.y + (Math.random() - .5) * 3;
    const lean = WIND_ANGLE + (Math.random() - .5) * 1.6, speed = 8 + Math.random() * 14;
    spec.vx = Math.cos(lean) * speed; spec.vy = Math.sin(lean) * speed;
    spec.scaleStart = (.045 + Math.random() * .025) * size; spec.scaleEnd = .015;
    spec.alphaStart = 1; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = tint;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Smoke drifting off downwind, visible by day; at night it is lit by the light map and thinner. */
  private emitSmoke(emitter: BaseFortEmitter, night: number, size: number, nowMs: number): void {
    const spec = this.smoke;
    spec.lifeMs = 2200 + Math.random() * 900;
    spec.x = emitter.x + WIND.x * 4; spec.y = emitter.y + WIND.y * 4;
    const speed = 6 + Math.random() * 5;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 3; spec.vy = WIND.y * speed + (Math.random() - .5) * 3;
    spec.scaleStart = (.12 + Math.random() * .04) * size; spec.scaleEnd = (.48 + Math.random() * .16) * size;
    spec.alphaStart = .28 - .1 * night; spec.alphaEnd = 0;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = (Math.random() - .5) * .4;
    spec.tint = SMOKE;
    this.system.spawn(spec, this.smokeSource, nowMs);
  }

  destroy(): void {
    this.unregister();
    this.system.releaseSource(this.flameSource);
    this.system.releaseSource(this.emberSource);
    this.system.releaseSource(this.smokeSource);
    for (const effect of [GpuVfxEffectId.BaseFortFlame, GpuVfxEffectId.BaseFortEmber, GpuVfxEffectId.BaseFortSmoke]) {
      this.system.quality.resetCarry(effect);
    }
  }
}
