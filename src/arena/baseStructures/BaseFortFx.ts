import { GpuVfxFrameId } from '../../effects/gpu/GpuVfxAtlas';
import { GpuVfxEase } from '../../effects/gpu/GpuVfxEase';
import { GpuVfxEffectId } from '../../effects/gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../../effects/gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../../effects/gpu/GpuVfxSystem';

/** Socket kinds of the fort asset that carry particles; positions are world pixels. */
export type BaseFortEmitterKind = 'torch' | 'torchlet' | 'lamp' | 'glade';
export interface BaseFortEmitter { readonly kind: BaseFortEmitterKind; readonly x: number; readonly y: number }

/** The breeze the asset's pennants show: towards world +X, a little north. */
const WIND = { x: 1, y: -.2 };
const WIND_ANGLE = Math.atan2(WIND.y, WIND.x);
/**
 * Pitch fire: the flame motif bakes its own colour (white-hot head to red tip); the core is pale and
 * licks cool towards red. Daylight washes the flame out.
 */
const FLAME = { core: 0xfff2c8, lick: 0xffa060, dayAlpha: .72 } as const;
/** The flame motif's head sits this far behind the frame centre (px of the 32 px frame). */
const FLAME_HEAD_OFFSET = 8;

/**
 * One particle stream at an emitter: mean interval by day and at night (0 = silent), scaled by the
 * shared GPU quality. Night is the World's artificial-light factor (0 noon … 1 night).
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
 * GPU particles of the persistent base fort on the scene's shared VFX backend: torch flames,
 * embers and thin smoke at the torches, a breathing glow and moths at the lanterns, fireflies over
 * the moss at dusk. Allocation-free per frame; release kills the live members with their sources.
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
      switch (emitter.kind) {
        case 'torch':
          add(90, 90, flame, (e, n, t) => this.emitCore(e, 1, n, t));
          add(70, 70, flame, (e, n, t) => this.emitFlame(e, 1, n, t));
          add(420, 380, flame, (e, n, t) => this.emitLick(e, 1, n, t));
          add(1800, 900, ember, (e, n, t) => this.emitEmber(e, 1, t));
          add(700, 900, smoke, (e, n, t) => this.emitSmoke(e, n, t));
          break;
        case 'torchlet':
          add(100, 100, flame, (e, n, t) => this.emitCore(e, .7, n, t));
          add(85, 85, flame, (e, n, t) => this.emitFlame(e, .7, n, t));
          add(640, 560, flame, (e, n, t) => this.emitLick(e, .7, n, t));
          add(3400, 1700, ember, (e, n, t) => this.emitEmber(e, .7, t));
          break;
        case 'lamp':
          add(0, 700, ember, (e, n, t) => this.emitHalo(e, n, t));
          add(0, 1300, ember, (e, n, t) => this.emitMoth(e, t));
          break;
        case 'glade':
          add(0, 1100, ember, (e, n, t) => this.emitFirefly(e, t));
          break;
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
      // Night-only streams fade in with the dusk instead of switching on at a threshold.
      const base = channel.dayMs > 0 ? channel.dayMs + (channel.nightMs - channel.dayMs) * night
        : night > .15 ? channel.nightMs / night : 0;
      const interval = base > 0 ? this.system.quality.scaleFrequency(base, channel.effect) : 0;
      if (interval <= 0) continue;
      channel.carry += deltaMs / interval;
      while (channel.carry >= 1) {
        channel.carry -= 1;
        channel.spawn(channel.emitter, night, nowMs);
      }
    }
  }

  /** Daylight washes the flame out; at night it burns at full strength. */
  private flameAlpha(night: number): number {
    return FLAME.dayAlpha + (1 - FLAME.dayAlpha) * night;
  }

  /**
   * Places a flame motif with its head on the torch: the frame centre lies downwind of the head
   * along the member's own lean.
   */
  private placeFlame(spec: GpuVfxSpawnSpec, emitter: BaseFortEmitter, lean: number, scale: number, jitter: number): void {
    const back = FLAME_HEAD_OFFSET * scale;
    spec.x = emitter.x + Math.cos(lean) * back + (Math.random() - .5) * jitter;
    spec.y = emitter.y + Math.sin(lean) * back + (Math.random() - .5) * jitter;
    spec.rotation = lean;
  }

  /**
   * The hot core at the torch head: small, pale and nearly still. Members live several spawn
   * intervals, so the core holds steady instead of strobing.
   */
  private emitCore(emitter: BaseFortEmitter, size: number, night: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.FlameCore;
    spec.lifeMs = 300 + Math.random() * 80;
    spec.x = emitter.x + (Math.random() - .5) * .8 * size; spec.y = emitter.y + (Math.random() - .5) * .8 * size;
    spec.vx = WIND.x * 2; spec.vy = WIND.y * 2;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = .11 * size; spec.scaleEnd = .09 * size; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1; spec.stretchEnd = 1;
    spec.alphaStart = .7 * this.flameAlpha(night); spec.alphaEnd = .15;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = FLAME.core; spec.tintBlendStart = 1; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /**
   * The flame itself, seen from above: it rises towards the camera, so it shows as short tongues
   * fanning out of the hot core, most of them downwind. A few overlap at any time and each curls
   * and stretches slowly while it fades, so the outline changes calmly.
   */
  private emitFlame(emitter: BaseFortEmitter, size: number, night: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.TorchFlame;
    spec.lifeMs = 320 + Math.random() * 120;
    const scale = (.2 + Math.random() * .06) * size, lean = WIND_ANGLE + (Math.random() - .5) * 2.4;
    this.placeFlame(spec, emitter, lean, scale, .6 * size);
    const speed = (3 + Math.random() * 3) * size;
    spec.vx = Math.cos(lean) * speed + WIND.x * 2; spec.vy = Math.sin(lean) * speed + WIND.y * 2;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale; spec.scaleEnd = scale * .85; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = .7; spec.stretchEnd = .95;
    spec.alphaStart = (.48 + .12 * night) * this.flameAlpha(night); spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.angularVelocity = (Math.random() - .5) * 1.2;
    spec.tint = 0xffffff; spec.tintBlendStart = 1; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /** Now and then a thin lick stretches off the flame's tip with the breeze and cools to red. */
  private emitLick(emitter: BaseFortEmitter, size: number, night: number, nowMs: number): void {
    const spec = this.flame;
    spec.frame = GpuVfxFrameId.TorchFlame;
    spec.lifeMs = 220 + Math.random() * 80;
    const scale = .26 * size, lean = WIND_ANGLE + (Math.random() - .5) * 1;
    this.placeFlame(spec, emitter, lean, scale, .6 * size);
    const speed = (9 + Math.random() * 5) * size;
    spec.vx = Math.cos(lean) * speed; spec.vy = Math.sin(lean) * speed;
    spec.positionEase = GpuVfxEase.Linear;
    spec.scaleStart = scale; spec.scaleEnd = scale * .7; spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = .95; spec.stretchEnd = 1.3;
    spec.alphaStart = .4 * this.flameAlpha(night); spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.angularVelocity = 0;
    spec.tint = FLAME.lick; spec.tintBlendStart = .3; spec.tintBlendEnd = 1;
    this.system.spawn(spec, this.flameSource, nowMs);
  }

  /** Small embers break off, ride the breeze and burn out. */
  private emitEmber(emitter: BaseFortEmitter, size: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 600 + Math.random() * 600;
    spec.x = emitter.x + (Math.random() - .5) * 2; spec.y = emitter.y + (Math.random() - .5) * 2;
    const speed = 10 + Math.random() * 12;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 8; spec.vy = WIND.y * speed + (Math.random() - .5) * 8;
    spec.scaleStart = (.045 + Math.random() * .02) * size; spec.scaleEnd = .015;
    spec.alphaStart = 1; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = Math.random() < .4 ? 0xffd88a : 0xffa04a;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Thin pitch smoke, visible by day; at night it is lit by the light map and mostly gone. */
  private emitSmoke(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const spec = this.smoke;
    spec.lifeMs = 2000 + Math.random() * 1200;
    spec.x = emitter.x + WIND.x * 3; spec.y = emitter.y + WIND.y * 3;
    const speed = 7 + Math.random() * 6;
    spec.vx = WIND.x * speed + (Math.random() - .5) * 3; spec.vy = WIND.y * speed + (Math.random() - .5) * 3;
    spec.scaleStart = .1 + Math.random() * .04; spec.scaleEnd = .42 + Math.random() * .16;
    spec.alphaStart = .26 - .1 * night; spec.alphaEnd = 0;
    spec.rotation = Math.random() * Math.PI * 2; spec.angularVelocity = (Math.random() - .5) * .6;
    spec.tint = 0x5f5850;
    this.system.spawn(spec, this.smokeSource, nowMs);
  }

  /** A slow, soft breathing of the lantern glass at dusk and night. */
  private emitHalo(emitter: BaseFortEmitter, night: number, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    spec.lifeMs = 1300 + Math.random() * 400;
    spec.x = emitter.x; spec.y = emitter.y; spec.vx = 0; spec.vy = 0;
    spec.scaleStart = .75 + Math.random() * .15; spec.scaleEnd = 1.15;
    spec.alphaStart = .14 * night; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xffc070;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Moths flitting through the lantern light: pale specks on short crossing arcs. */
  private emitMoth(emitter: BaseFortEmitter, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    const angle = Math.random() * Math.PI * 2, radius = 5 + Math.random() * 8;
    spec.lifeMs = 450 + Math.random() * 400;
    spec.x = emitter.x + Math.cos(angle) * radius; spec.y = emitter.y + Math.sin(angle) * radius;
    const turn = angle + (Math.random() < .5 ? 1 : -1) * Math.PI / 2, speed = 18 + Math.random() * 16;
    spec.vx = Math.cos(turn) * speed; spec.vy = Math.sin(turn) * speed;
    spec.scaleStart = .1; spec.scaleEnd = .08;
    spec.alphaStart = .75; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xfff0d6;
    this.system.spawn(spec, this.emberSource, nowMs);
  }

  /** Fireflies over the moss: a slow drift and a single fading blink each. */
  private emitFirefly(emitter: BaseFortEmitter, nowMs: number): void {
    const spec = this.ember;
    spec.frame = GpuVfxFrameId.DeathGlow;
    const angle = Math.random() * Math.PI * 2, speed = 3 + Math.random() * 6;
    spec.lifeMs = 1500 + Math.random() * 1100;
    spec.x = emitter.x + (Math.random() - .5) * 44; spec.y = emitter.y + (Math.random() - .5) * 44;
    spec.vx = Math.cos(angle) * speed; spec.vy = Math.sin(angle) * speed;
    spec.scaleStart = .22; spec.scaleEnd = .14;
    spec.alphaStart = .85; spec.alphaEnd = 0;
    spec.rotation = 0; spec.angularVelocity = 0;
    spec.tint = 0xd8f27a;
    this.system.spawn(spec, this.emberSource, nowMs);
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
