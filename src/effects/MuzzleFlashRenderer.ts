import * as Phaser from 'phaser';
import { MUZZLE_FLASH_VFX, VOID_FIRE_COLOR } from '../config';
import type { BulletVisualPreset, EnergyBallVariant, HitscanVisualPreset, ProjectileStyle } from '../types';
import { mixColors } from './EffectUtils';
import { getEmissiveScale } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import { ensureMuzzleFlashTextures } from './gpu/GpuVfxSourceTextures';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GPU_VFX_NO_SOURCE_HANDLE, GpuVfxSystem, createGpuVfxMemberHandle, type GpuVfxMemberHandle } from './gpu/GpuVfxSystem';
import type { OwnerVisualSource, OwnerRenderPose, OwnerHeldWeaponPose } from '../entities/OwnerVisualSource';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { type MuzzleFlashPreset, type MuzzleProfile, resolveMuzzleProfile, resolveProjectileMuzzlePreset } from './muzzleFlashModel';

const emissiveAlpha = (alpha: number) => alpha * (0.9 + getEmissiveScale() * 0.1);

/** Two persistent GPU templates plus sparks. No per-shot Phaser objects, timers or tweens. */
export class MuzzleFlashRenderer {
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private outerSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  private readonly profile = {} as MuzzleProfile;
  private readonly lightOverrides = { color: 0, radiusPx: 0, intensity: 0, durationMs: 0 };
  private readonly repeats = Array.from({ length: 128 }, () => ({ source: '', preset: '', until: 0 }));
  private owners: OwnerVisualSource | null = null;
  private readonly pose: OwnerRenderPose = { x: 0, y: 0, rotation: 0 };
  private readonly weaponPose: OwnerHeldWeaponPose = { x: 0, y: 0, rotation: 0, itemId: '' };
  private readonly attachments = Array.from({ length: 128 }, () => ({
    source: '', core: createGpuVfxMemberHandle(), outer: createGpuVfxMemberHandle(),
    localX: 0, localY: 0, localAngle: 0, x: 0, y: 0, rotation: 0, offset: 0,
    itemId: null as string | null, firstFollow: true,
  }));
  private readonly followTick = (): void => {
    const system = this.gpuVfx;
    if (!system) return;
    for (const entry of this.attachments) {
      if (!entry.source) continue;
      if (!system.isMemberLive(entry.core) && !system.isMemberLive(entry.outer)) { entry.source = ''; continue; }
      const hasWeapon = this.owners?.readOwnerHeldWeaponPose?.(entry.source, this.weaponPose) ?? false;
      const attachWeaponNow = entry.firstFollow && hasWeapon;
      if (attachWeaponNow) {
        // The accepted-shot event may follow projectile creation in the same frame.
        entry.itemId = this.weaponPose.itemId;
        entry.localX = entry.localY = 0;
      }
      entry.firstFollow = false;
      if (entry.itemId !== null && (!hasWeapon || entry.itemId !== this.weaponPose.itemId)) {
        system.releaseMember(entry.core); system.releaseMember(entry.outer); entry.source = ''; continue;
      }
      if (entry.itemId === null && !this.owners?.readOwnerRenderPose?.(entry.source, this.pose)) {
        system.releaseMember(entry.core); system.releaseMember(entry.outer); entry.source = ''; continue;
      }
      const pose = entry.itemId === null ? this.pose : this.weaponPose;
      if (!attachWeaponNow && pose.x === entry.x && pose.y === entry.y && pose.rotation === entry.rotation) continue;
      entry.x = pose.x; entry.y = pose.y; entry.rotation = pose.rotation;
      const c = Math.cos(pose.rotation), s = Math.sin(pose.rotation);
      const x = pose.x + entry.localX * c - entry.localY * s;
      const y = pose.y + entry.localX * s + entry.localY * c;
      const angle = pose.rotation + entry.localAngle;
      this.moveBody(entry.core, x, y, angle, entry.offset, 1.15);
      this.moveBody(entry.outer, x, y, angle, entry.offset * 1.25, 1.08);
    }
  };

  setOwnerVisualSource(owners: OwnerVisualSource): void { this.owners = owners; }

  private moveBody(handle: GpuVfxMemberHandle, x: number, y: number, angle: number, offset: number, growth: number): void {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const speed = offset * (growth - 1) * 1000 / handle.lifeMs;
    this.gpuVfx!.updateTransform(handle, x + dx * offset, y + dy * offset, dx * speed, dy * speed, angle);
  }

  constructor(private readonly scene: Phaser.Scene) {}
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; }
  generateTextures(): void { ensureMuzzleFlashTextures(this.scene); }
  clear(): void {
    for (const entry of this.repeats) { entry.source = ''; entry.until = 0; }
    for (const entry of this.attachments) {
      this.gpuVfx?.releaseMember(entry.core); this.gpuVfx?.releaseMember(entry.outer); entry.source = '';
    }
  }

  private acceptRepeat(source: string | undefined, preset: MuzzleFlashPreset, now: number, life: number): boolean {
    if (!source || (preset !== 'p90' && preset !== 'negev')) return true;
    let free = null;
    for (const entry of this.repeats) {
      if (entry.source === source && entry.preset === preset) {
        if (now < entry.until) return false;
        entry.until = now + life + 10;
        return true;
      }
      if (!free && entry.until <= now) free = entry;
    }
    if (!free) return false;
    free.source = source; free.preset = preset; free.until = now + life + 10;
    return true;
  }

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;
    system.registerEmission(this.followTick);
    this.coreSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashBody);
    this.outerSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashBody);
    this.sparkSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashSpark);
    this.coreSpec.positionEase = GpuVfxEase.QuadOut;
    this.coreSpec.scaleEase = GpuVfxEase.QuadOut;
    this.coreSpec.alphaEase = GpuVfxEase.CubicInOut;
    this.outerSpec.positionEase = GpuVfxEase.Linear;
    this.outerSpec.scaleEase = GpuVfxEase.Linear;
    this.outerSpec.alphaEase = GpuVfxEase.CubicInOut;
    this.outerSpec.tintBlendStart = 0.42;
    this.outerSpec.tintBlendEnd = 1;
    this.sparkSpec.positionEase = GpuVfxEase.Linear;
    this.sparkSpec.scaleEase = GpuVfxEase.Linear;
    this.sparkSpec.alphaEase = GpuVfxEase.Linear;
  }

  playProjectileFlash(x: number, y: number, vx: number, vy: number, style?: ProjectileStyle,
    bulletPreset?: BulletVisualPreset, energyBallVariant?: EnergyBallVariant, color?: number, sourceId?: string): void {
    const preset = resolveProjectileMuzzlePreset(style, bulletPreset, energyBallVariant);
    if (preset) this.playFlash(x, y, vx, vy, preset, color, sourceId,
      style !== 'bfg' && style !== 'gauss' && bulletPreset !== 'gauss');
  }

  playHitscanFlash(x: number, y: number, vx: number, vy: number,
    preset: HitscanVisualPreset = 'default', color?: number, sourceId?: string): void {
    this.playFlash(x, y, vx, vy, preset === 'asmd_primary' ? preset : 'default', color, sourceId);
  }

  private playFlash(x: number, y: number, vx: number, vy: number, preset: MuzzleFlashPreset,
    color?: number, sourceId?: string, bindHeldWeapon = true): void {
    const cfg = resolveMuzzleProfile(preset, MUZZLE_FLASH_VFX, this.profile);
    if (cfg.alpha <= 0) return;
    const now = this.gpuVfx?.now() ?? this.scene.time.now;
    if (!this.acceptRepeat(sourceId, preset, now, cfg.outerDuration)) return;
    const angle = Math.atan2(vy, vx);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const voidFlame = preset === 'flame' && color === VOID_FIRE_COLOR;
    const lightColor = voidFlame ? mixColors(color!, 0xffffff, 0.58) : color ?? cfg.tint;
    this.lightOverrides.color = lightColor;
    this.lightOverrides.radiusPx = cfg.lightRadius;
    this.lightOverrides.intensity = cfg.lightIntensity;
    this.lightOverrides.durationMs = cfg.lightDuration;
    this.lighting?.pulse('muzzleFlash', x, y, this.lightOverrides);
    const system = this.gpuVfx, core = this.coreSpec, outer = this.outerSpec, spark = this.sparkSpec;
    if (!system || !core || !outer || !spark) return;

    const frame = cfg.useEnergyCore ? GpuVfxFrameId.MuzzleEnergy : GpuVfxFrameId.MuzzleFlash;
    // Source motifs begin at x=2/3, relative to centered 32/36 px frames.
    const anchor = cfg.useEnergyCore ? 15 : 14;
    let attachment: (typeof this.attachments)[number] | undefined;
    if (sourceId && this.owners?.readOwnerRenderPose?.(sourceId, this.pose)) {
      for (const entry of this.attachments) {
        if (entry.source && (system.isMemberLive(entry.core) || system.isMemberLive(entry.outer))) continue;
        attachment = entry; break;
      }
      if (attachment) {
        const pose = this.pose, c = Math.cos(pose.rotation), s = Math.sin(pose.rotation);
        attachment.source = sourceId;
        attachment.itemId = null;
        attachment.firstFollow = bindHeldWeapon;
        attachment.localX = (x - pose.x) * c + (y - pose.y) * s;
        attachment.localY = -(x - pose.x) * s + (y - pose.y) * c;
        attachment.localAngle = angle - pose.rotation;
        attachment.x = pose.x; attachment.y = pose.y; attachment.rotation = pose.rotation;
        attachment.offset = anchor * cfg.scaleX;
      }
    }
    this.configureBody(core, x, y, dx, dy, angle, anchor, cfg, 1, 1.15, cfg.duration, cfg.alpha, color ?? cfg.tint, frame);
    system.spawn(core, GPU_VFX_NO_SOURCE_HANDLE, now, 0, attachment?.core);
    this.configureBody(outer, x, y, dx, dy, angle, anchor, cfg, 1.25, 1.08, cfg.outerDuration, cfg.alpha * 0.38, color ?? cfg.tint, frame);
    system.spawn(outer, GPU_VFX_NO_SOURCE_HANDLE, now, 0, attachment?.outer);

    const count = system.quality.scaleDiscreteBurst(GpuVfxEffectId.MuzzleFlashSpark, cfg.sparkCount);
    if (count < cfg.sparkCount) system.recordQualityDrop(GpuVfxEffectId.MuzzleFlashSpark, cfg.sparkCount - count);
    spark.x = x; spark.y = y;
    spark.scaleStart = cfg.sparkScale; spark.scaleEnd = cfg.sparkScale * 0.35;
    spark.alphaStart = emissiveAlpha(0.95); spark.alphaEnd = 0;
    spark.tintBlendStart = 1; spark.tintBlendEnd = 1;
    for (let i = 0; i < count; i++) {
      spark.lifeMs = Phaser.Math.FloatBetween(cfg.sparkLifeMin, cfg.sparkLifeMax);
      const direction = angle + Phaser.Math.FloatBetween(-cfg.sparkSpread, cfg.sparkSpread) * Math.PI / 180;
      const speed = Phaser.Math.FloatBetween(cfg.sparkSpeed * 0.5, cfg.sparkSpeed);
      spark.vx = Math.cos(direction) * speed; spark.vy = Math.sin(direction) * speed;
      spark.rotation = direction;
      spark.stretchStart = cfg.sparkStretch + (i % 3) * 0.35;
      spark.stretchEnd = cfg.sparkStretch * 0.7 + (i % 3) * 0.2;
      const tintIndex = Math.floor(Phaser.Math.FloatBetween(0, cfg.sparkTints.length)) % cfg.sparkTints.length;
      spark.tint = voidFlame ? (tintIndex % 3 === 0 ? 0xffffff : tintIndex % 3 === 1 ? lightColor : color!) : cfg.sparkTints[tintIndex];
      system.spawn(spark, GPU_VFX_NO_SOURCE_HANDLE, now);
    }
  }

  private configureBody(spec: GpuVfxSpawnSpec, x: number, y: number, dx: number, dy: number,
    angle: number, anchor: number, cfg: MuzzleProfile, size: number, growth: number,
    life: number, alpha: number, tint: number, frame: GpuVfxFrameId): void {
    const offset = anchor * cfg.scaleX * size;
    spec.lifeMs = life;
    spec.x = x + dx * offset; spec.y = y + dy * offset;
    // Position and scale use the same ease: the rear tip stays on the muzzle throughout growth.
    spec.vx = dx * offset * (growth - 1) * 1000 / life;
    spec.vy = dy * offset * (growth - 1) * 1000 / life;
    spec.rotation = angle;
    spec.scaleStart = cfg.scaleY * size; spec.scaleEnd = cfg.scaleY * size * growth;
    spec.stretchStart = cfg.scaleX / cfg.scaleY; spec.stretchEnd = spec.stretchStart;
    spec.alphaStart = emissiveAlpha(alpha); spec.alphaEnd = 0;
    spec.tint = tint; spec.frame = frame;
  }
}
