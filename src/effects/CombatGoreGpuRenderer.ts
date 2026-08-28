import type * as Phaser from 'phaser';
import { BLOOD_HIT_VFX, COLORS, DEATH_DISINTEGRATION_VFX } from '../config';
import type { SyncedDeathEffect, SyncedHitEffect } from '../types';
import { createSeededRandom, mixColors } from './EffectUtils';
import {
  DeathFragmentTemplateCache,
  type DeathFragmentCanvasFactory,
  type DeathFragmentTemplateChunk,
} from './gpu/DeathFragmentTemplateCache';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import {
  GPU_VFX_NO_FRAME_ANIMATION,
  GpuVfxFrameAnimationId,
} from './gpu/GpuVfxFrameAnimations';
import { GPU_VFX_NO_SOURCE_HANDLE, GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

const DEATH_FRAGMENT_TEXTURE_SIZE = 4;
/** Die authored Death-Morph-Quellen sind jetzt 24px statt 12px – gleicher World-Space-Footprint. */
const DEATH_MORPH_SCALE_COMPENSATION = 0.5;
const DEATH_GLOW_TEXTURE_SIZE = 24;

const DEATH_DUST_MOTE_FRAMES = [
  GpuVfxFrameId.DeathDustMoteA,
  GpuVfxFrameId.DeathDustMoteB,
  GpuVfxFrameId.DeathDustMoteC,
] as const;

/** Sink fuer den unveraenderten, persistenten Blood-Stain-Lifecycle. */
export type BloodStainSink = (
  x: number,
  y: number,
  scale: number,
  alpha: number,
  fadeMs: number,
  tint: number,
  rotation: number,
  flightDelayMs: number,
) => void;

interface DeathProfile {
  readonly main: number;
  readonly micro: number;
  readonly glow: number;
  readonly travelScale: number;
}

/**
 * Gemeinsamer Controller fuer kurzlebiges Combat-Gore.
 *
 * Death-Fragmente, Glows und Blood sind hier nur logische Effekte. Pools, Admission, Quality,
 * Profiler, Lifetime und das eigentliche Rendering bleiben vollstaendig im bestehenden
 * `GpuVfxSystem`; pro Event entstehen keine Phaser-GameObjects und keine Tweens.
 */
export class CombatGoreGpuRenderer {
  readonly fragmentTemplateCache: DeathFragmentTemplateCache;

  private gpu: GpuVfxSystem | null = null;
  private deathFragmentSpec: GpuVfxSpawnSpec | null = null;
  private deathMicroFragmentSpec: GpuVfxSpawnSpec | null = null;
  private deathGlowSpec: GpuVfxSpawnSpec | null = null;
  private deathFragmentGlowSpec: GpuVfxSpawnSpec | null = null;
  private bloodCoreSpec: GpuVfxSpawnSpec | null = null;
  private bloodStreakSpec: GpuVfxSpawnSpec | null = null;
  private bloodDropletSpec: GpuVfxSpawnSpec | null = null;
  private bloodMicroDropletSpec: GpuVfxSpawnSpec | null = null;

  constructor(scene: Phaser.Scene, createCanvas?: DeathFragmentCanvasFactory) {
    this.fragmentTemplateCache = new DeathFragmentTemplateCache(scene.textures, createCanvas);
  }

  /** Erstellt nur die sieben logischen Vorlagen; die physischen Lanes gehoeren dem Backend. */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpu === system) return;
    this.gpu = system;
    this.deathFragmentSpec = system.createSpec(GpuVfxEffectId.DeathFragment);
    this.deathMicroFragmentSpec = system.createSpec(GpuVfxEffectId.DeathMicroFragment);
    this.deathGlowSpec = system.createSpec(GpuVfxEffectId.DeathGlow);
    this.deathFragmentGlowSpec = system.createSpec(GpuVfxEffectId.DeathFragmentGlow);
    this.bloodCoreSpec = system.createSpec(GpuVfxEffectId.BloodCore);
    this.bloodStreakSpec = system.createSpec(GpuVfxEffectId.BloodStreak);
    this.bloodDropletSpec = system.createSpec(GpuVfxEffectId.BloodDroplet);
    this.bloodMicroDropletSpec = system.createSpec(GpuVfxEffectId.BloodMicroDroplet);
  }

  /**
   * Zerlegt exakt den replizierten Texture-/Frame-Snapshot. Fehlende Visualdaten bedeuten keinen
   * erfundenen Badger-Fallback: alte oder unvollstaendige Peers bekommen schlicht keinen
   * Disintegration-Burst.
   */
  playDeath(effect: SyncedDeathEffect, isPlayerDeath = false): void {
    const gpu = this.gpu;
    const mainSpec = this.deathFragmentSpec;
    const microSpec = this.deathMicroFragmentSpec;
    const glowSpec = this.deathGlowSpec;
    const fragmentGlowSpec = this.deathFragmentGlowSpec;
    const displayWidth = effect.displayWidth ?? 0;
    const displayHeight = effect.displayHeight ?? 0;
    if (
      !gpu || !mainSpec || !microSpec || !glowSpec
      || !effect.textureKey
      || displayWidth <= 0
      || displayHeight <= 0
    ) return;

    const template = this.fragmentTemplateCache.get(effect.textureKey, effect.frame);
    if (template.chunks.length === 0) return;

    const maxDimension = Math.max(displayWidth, displayHeight);
    const profile = resolveDeathProfile(maxDimension, template.chunks.length);
    const rng = createSeededRandom(effect.seed);
    const entityTint = effect.tint ?? 0xffffff;
    const auraColor = effect.targetColor ?? COLORS.GREY_2;
    const neutralTargetColorBoost = !isPlayerDeath
      && entityTint === 0xffffff && effect.targetColor !== undefined
      ? DEATH_DISINTEGRATION_VFX.neutralTargetColorBoost
      : 0;
    const rotation = Number.isFinite(effect.rotation) ? effect.rotation : 0;
    const hitX = effect.dirX ?? 0;
    const hitY = effect.dirY ?? 0;
    const hitLength = Math.hypot(hitX, hitY);
    const normalizedHitX = hitLength > 0.0001 ? hitX / hitLength : 0;
    const normalizedHitY = hitLength > 0.0001 ? hitY / hitLength : 0;
    const nowMs = gpu.now();

    const mainCount = this.scaleBurst(GpuVfxEffectId.DeathFragment, profile.main);
    const requestedFragmentGlowCount = isPlayerDeath && fragmentGlowSpec
      ? Math.min(
        mainCount,
        Math.min(
          DEATH_DISINTEGRATION_VFX.playerFragmentGlowMaxCount,
          Math.max(1, Math.round(profile.main * DEATH_DISINTEGRATION_VFX.playerFragmentGlowRatio)),
        ),
      )
      : 0;
    const fragmentGlowCount = requestedFragmentGlowCount > 0
      ? this.scaleBurst(GpuVfxEffectId.DeathFragmentGlow, requestedFragmentGlowCount)
      : 0;
    let nextFragmentGlowIndex = 0;
    for (let index = 0; index < mainCount; index += 1) {
      // Die Qualitaet darf die tatsaechliche Silhouettenabdeckung nicht auf den Anfang der
      // Chunk-Liste zusammenschieben: mainCount ist die Zahl der wirklich emittierten
      // Hauptfragmente, ueber die deshalb gleichmaessig verteilt wird.
      const chunk = template.chunks[Math.min(
        template.chunks.length - 1,
        Math.floor(index * template.chunks.length / Math.max(1, mainCount)),
      )];
      if (!chunk) continue;
      const selectedForFragmentGlow = fragmentGlowCount > 0
        && nextFragmentGlowIndex < fragmentGlowCount
        && index >= Math.floor(nextFragmentGlowIndex * mainCount / fragmentGlowCount);
      this.spawnDeathFragment(
        mainSpec,
        chunk,
        displayWidth,
        displayHeight,
        template.sourceWidth,
        template.sourceHeight,
        effect.x,
        effect.y,
        rotation,
        entityTint,
        auraColor,
        neutralTargetColorBoost,
        isPlayerDeath,
        normalizedHitX,
        normalizedHitY,
        hitLength > 0.0001,
        rng,
        profile.travelScale,
        false,
        nowMs,
        selectedForFragmentGlow ? fragmentGlowSpec : null,
      );
      if (selectedForFragmentGlow) nextFragmentGlowIndex += 1;
    }

    const microCount = this.scaleBurst(GpuVfxEffectId.DeathMicroFragment, profile.micro);
    for (let index = 0; index < microCount; index += 1) {
      const chunk = template.chunks[Math.floor(rng() * template.chunks.length)];
      if (!chunk) continue;
      this.spawnDeathFragment(
        microSpec,
        chunk,
        displayWidth,
        displayHeight,
        template.sourceWidth,
        template.sourceHeight,
        effect.x,
        effect.y,
        rotation,
        entityTint,
        auraColor,
        neutralTargetColorBoost,
        isPlayerDeath,
        normalizedHitX,
        normalizedHitY,
        hitLength > 0.0001,
        rng,
        profile.travelScale * 1.16,
        true,
        nowMs,
        null,
      );
    }

    const glowCount = this.scaleBurst(GpuVfxEffectId.DeathGlow, profile.glow);
    for (let index = 0; index < glowCount; index += 1) {
      const angle = rng() * Math.PI * 2;
      const travel = randomBetween(
        rng,
        DEATH_DISINTEGRATION_VFX.glowTravelMinPx,
        DEATH_DISINTEGRATION_VFX.glowTravelMaxPx,
      ) * profile.travelScale;
      const hitImpulse = hitLength > 0.0001
        ? travel * DEATH_DISINTEGRATION_VFX.glowHitImpulse
        : 0;
      const lifeMs = randomBetween(rng, 430, 760);
      glowSpec.lifeMs = lifeMs;
      glowSpec.x = effect.x;
      glowSpec.y = effect.y;
      glowSpec.vx = (Math.cos(angle) * travel + normalizedHitX * hitImpulse) * 1000 / lifeMs;
      glowSpec.vy = (Math.sin(angle) * travel + normalizedHitY * hitImpulse) * 1000 / lifeMs;
      glowSpec.positionEase = GpuVfxEase.QuadOut;
      glowSpec.yMode = GpuVfxEase.Linear;
      glowSpec.gravityFactor = 1;
      glowSpec.rotation = rng() * Math.PI * 2;
      glowSpec.angularVelocity = (rng() - 0.5) * 2.4;
      glowSpec.scaleStart = randomBetween(
        rng,
        DEATH_DISINTEGRATION_VFX.glowScaleMin,
        DEATH_DISINTEGRATION_VFX.glowScaleMax,
      ) * Math.min(1.35, 0.8 + profile.travelScale * 0.22);
      glowSpec.scaleEnd = glowSpec.scaleStart * 0.3;
      glowSpec.scaleEase = GpuVfxEase.QuadOut;
      glowSpec.stretchStart = 1;
      glowSpec.stretchEnd = 1;
      glowSpec.alphaStart = DEATH_DISINTEGRATION_VFX.glowAlpha * randomBetween(rng, 0.72, 1.08);
      glowSpec.alphaEnd = 0;
      glowSpec.alphaEase = GpuVfxEase.QuadOut;
      glowSpec.tint = mixColors(auraColor, entityTint, 0.12);
      glowSpec.tintBlendStart = 1;
      glowSpec.tintBlendEnd = 1;
      gpu.spawn(glowSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }

  /** Spielt Core-Splash, Streaks, Droplets und wenige Mikrotröpfchen als GPU-Burst. */
  playHit(effect: SyncedHitEffect, onBloodStain?: BloodStainSink): void {
    const gpu = this.gpu;
    const coreSpec = this.bloodCoreSpec;
    const streakSpec = this.bloodStreakSpec;
    const dropletSpec = this.bloodDropletSpec;
    const microSpec = this.bloodMicroDropletSpec;
    if (!gpu || !coreSpec || !streakSpec || !dropletSpec || !microSpec) return;

    const rng = createSeededRandom(effect.seed);
    const band = getBloodBand(effect.totalDamage);
    const killshot = effect.isKill;
    const baseDirectionLength = Math.hypot(effect.dirX, effect.dirY);
    const baseAngle = baseDirectionLength > 0.0001
      ? Math.atan2(effect.dirY, effect.dirX)
      : rng() * Math.PI * 2;
    const directionX = Math.cos(baseAngle);
    const directionY = Math.sin(baseAngle);
    const originX = effect.x + directionX * BLOOD_HIT_VFX.spawnPushPx;
    const originY = effect.y + directionY * BLOOD_HIT_VFX.spawnPushPx;
    const nowMs = gpu.now();
    const coreTint = pickBloodTint(rng);
    const coreIntensity = killshot
      ? BLOOD_HIT_VFX.killshotMultiplier
      : (effect.isCritical ? 1.1 : 1);

    if (this.scaleBurst(GpuVfxEffectId.BloodCore, 1) > 0) {
      coreSpec.lifeMs = BLOOD_HIT_VFX.coreSplashDurationMs;
      coreSpec.x = originX;
      coreSpec.y = originY;
      coreSpec.vx = directionX * (killshot ? 16 : 7);
      coreSpec.vy = directionY * (killshot ? 16 : 7);
      coreSpec.positionEase = GpuVfxEase.QuadOut;
      coreSpec.yMode = GpuVfxEase.Linear;
      coreSpec.gravityFactor = 1;
      coreSpec.rotation = (rng() - 0.5) * 0.4;
      coreSpec.angularVelocity = (rng() - 0.5) * 0.9;
      coreSpec.scaleStart = BLOOD_HIT_VFX.coreSplashScale * coreIntensity;
      coreSpec.scaleEnd = coreSpec.scaleStart * 1.28;
      coreSpec.scaleEase = GpuVfxEase.QuadOut;
      coreSpec.stretchStart = 1;
      coreSpec.stretchEnd = 1;
      coreSpec.alphaStart = BLOOD_HIT_VFX.coreSplashAlpha;
      coreSpec.alphaEnd = 0;
      coreSpec.alphaEase = GpuVfxEase.QuadOut;
      coreSpec.tint = coreTint;
      coreSpec.tintBlendStart = 1;
      coreSpec.tintBlendEnd = 1;
      gpu.spawn(coreSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }

    const spreadScale = killshot ? 1.38 : (effect.isCritical ? 1.14 : 1);
    const streakRequested = randomInt(rng, band.streakCountMin, band.streakCountMax)
      + 1
      + (killshot ? 2 : effect.isCritical ? 1 : 0);
    const dropletRequested = randomInt(rng, band.dropletCountMin, band.dropletCountMax)
      + 1
      + (killshot ? 1 : 0);
    const stainCount = randomInt(rng, band.stainCountMin, band.stainCountMax);
    let stainsCreated = 0;

    const streakCount = this.scaleBurst(GpuVfxEffectId.BloodStreak, streakRequested);
    for (let index = 0; index < streakCount; index += 1) {
      const angle = baseAngle + degToRad((rng() - 0.5) * band.spreadDeg * 2 * spreadScale);
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const lateralX = -direction.y;
      const lateralY = direction.x;
      const lateral = (rng() - 0.5) * BLOOD_HIT_VFX.lateralJitterPx;
      const startX = originX + lateralX * lateral;
      const startY = originY + lateralY * lateral;
      const travel = randomBetween(rng, band.travelMinPx, band.travelMaxPx)
        * (killshot
          ? BLOOD_HIT_VFX.killshot.streakTravelScale
          : effect.isCritical ? 1.08 : 1);
      const endX = startX + direction.x * travel + lateralX * (rng() - 0.5) * (killshot ? 20 : 14);
      const endY = startY + direction.y * travel + lateralY * (rng() - 0.5) * (killshot ? 20 : 14);
      const duration = randomBetween(rng, band.flightMinMs, band.flightMaxMs)
        * (killshot ? 0.9 : 1);
      const speed = Math.hypot(endX - startX, endY - startY) * 1000 / Math.max(1, duration);
      const scale = randomBetween(rng, band.streakScaleMin, band.streakScaleMax)
        * 1.1
        * (killshot ? BLOOD_HIT_VFX.killshot.streakScale : 1);
      const stretchStart = clamp(0.98 + speed / 115, 1, killshot ? 2.9 : 2.55);
      const leaveStain = stainsCreated < stainCount && (index < stainCount || rng() > 0.45);
      if (leaveStain) stainsCreated += 1;

      streakSpec.lifeMs = duration;
      streakSpec.x = startX;
      streakSpec.y = startY;
      streakSpec.vx = (endX - startX) * 1000 / Math.max(1, duration);
      streakSpec.vy = (endY - startY) * 1000 / Math.max(1, duration);
      streakSpec.positionEase = GpuVfxEase.QuadOut;
      streakSpec.yMode = GpuVfxEase.Linear;
      streakSpec.gravityFactor = 1;
      streakSpec.rotation = angle;
      streakSpec.angularVelocity = (rng() - 0.5) * (killshot ? 2.1 : 1.4);
      streakSpec.scaleStart = scale;
      streakSpec.scaleEnd = scale * 0.72;
      streakSpec.scaleEase = GpuVfxEase.QuadOut;
      streakSpec.stretchStart = stretchStart;
      streakSpec.stretchEnd = Math.max(0.78, stretchStart * 0.48);
      streakSpec.alphaStart = 0.98;
      streakSpec.alphaEnd = 0;
      streakSpec.alphaEase = GpuVfxEase.QuadOut;
      streakSpec.tint = pickBloodTint(rng);
      streakSpec.tintBlendStart = 1;
      streakSpec.tintBlendEnd = 1;
      gpu.spawn(streakSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);

      if (leaveStain && onBloodStain) {
        onBloodStain(
          endX,
          endY,
          randomBetween(rng, band.stainScaleMin, band.stainScaleMax)
            * (killshot ? BLOOD_HIT_VFX.killshot.stainScale : 1),
          band.stainAlpha,
          band.stainFadeMs,
          streakSpec.tint,
          (rng() - 0.5) * Math.PI,
          duration,
        );
      }
    }

    const dropletCount = this.scaleBurst(GpuVfxEffectId.BloodDroplet, dropletRequested);
    for (let index = 0; index < dropletCount; index += 1) {
      const angle = baseAngle + degToRad(
        (rng() - 0.5) * Math.max(14, band.spreadDeg * 1.35) * 2 * spreadScale,
      );
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const travel = randomBetween(rng, band.travelMinPx * 0.5, band.travelMaxPx * 0.75)
        * (killshot ? BLOOD_HIT_VFX.killshot.dropletTravelScale : 1);
      const startX = effect.x + direction.x * BLOOD_HIT_VFX.spawnPushPx * 0.7;
      const startY = effect.y + direction.y * BLOOD_HIT_VFX.spawnPushPx * 0.7;
      const duration = randomBetween(rng, band.flightMinMs, band.flightMaxMs) * 0.82;
      const endX = startX + direction.x * travel;
      const endY = startY + direction.y * travel;

      dropletSpec.lifeMs = duration;
      dropletSpec.x = startX;
      dropletSpec.y = startY;
      dropletSpec.vx = (endX - startX) * 1000 / Math.max(1, duration);
      dropletSpec.vy = (endY - startY) * 1000 / Math.max(1, duration);
      dropletSpec.positionEase = GpuVfxEase.QuadOut;
      dropletSpec.yMode = GpuVfxEase.Linear;
      dropletSpec.gravityFactor = 1;
      dropletSpec.rotation = angle + (rng() - 0.5) * 0.8;
      dropletSpec.angularVelocity = (rng() - 0.5) * (killshot ? 4.4 : 3.1);
      dropletSpec.scaleStart = randomBetween(rng, band.dropletScaleMin, band.dropletScaleMax)
        * 1.1
        * (killshot ? BLOOD_HIT_VFX.killshot.dropletScale : 1);
      dropletSpec.scaleEnd = dropletSpec.scaleStart * 0.42;
      dropletSpec.scaleEase = GpuVfxEase.QuadOut;
      dropletSpec.stretchStart = 1;
      dropletSpec.stretchEnd = 1;
      dropletSpec.alphaStart = 0.9;
      dropletSpec.alphaEnd = 0;
      dropletSpec.alphaEase = GpuVfxEase.QuadOut;
      dropletSpec.tint = pickBloodTint(rng);
      dropletSpec.tintBlendStart = 1;
      dropletSpec.tintBlendEnd = 1;
      gpu.spawn(dropletSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }

    const microRequested = killshot
      ? randomInt(rng, 4, 8)
      : Math.max(1, Math.round(dropletRequested * (effect.isCritical ? 0.3 : 0.16)));
    const microCount = this.scaleBurst(GpuVfxEffectId.BloodMicroDroplet, microRequested);
    for (let index = 0; index < microCount; index += 1) {
      const angle = baseAngle + degToRad((rng() - 0.5) * (killshot ? 115 : 80));
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const travel = randomBetween(rng, band.travelMinPx * 0.72, band.travelMaxPx)
        * (killshot ? 1.2 : 0.92);
      const startX = originX + direction.x * randomBetween(rng, 0, 4);
      const startY = originY + direction.y * randomBetween(rng, 0, 4);
      const duration = randomBetween(rng, 80, 150);

      microSpec.lifeMs = duration;
      microSpec.x = startX;
      microSpec.y = startY;
      microSpec.vx = direction.x * travel * 1000 / duration;
      microSpec.vy = direction.y * travel * 1000 / duration;
      microSpec.positionEase = GpuVfxEase.QuadOut;
      microSpec.yMode = GpuVfxEase.Linear;
      microSpec.gravityFactor = 1;
      microSpec.rotation = angle + (rng() - 0.5) * 1.5;
      microSpec.angularVelocity = (rng() - 0.5) * 7.5;
      microSpec.scaleStart = randomBetween(rng, 0.22, 0.42)
        * (killshot ? BLOOD_HIT_VFX.killshot.microDropletScale : 1);
      microSpec.scaleEnd = microSpec.scaleStart * 0.28;
      microSpec.scaleEase = GpuVfxEase.QuadOut;
      microSpec.stretchStart = rng() < 0.28 ? randomBetween(rng, 1.1, 1.7) : 1;
      microSpec.stretchEnd = microSpec.stretchStart * 0.62;
      microSpec.alphaStart = 0.82;
      microSpec.alphaEnd = 0;
      microSpec.alphaEase = GpuVfxEase.QuadOut;
      microSpec.tint = pickBloodTint(rng);
      microSpec.tintBlendStart = 1;
      microSpec.tintBlendEnd = 1;
      gpu.spawn(microSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }

  destroy(): void {
    this.fragmentTemplateCache.clear();
    this.gpu = null;
  }

  private scaleBurst(effect: GpuVfxEffectId, requested: number): number {
    const gpu = this.gpu;
    if (!gpu || requested <= 0) return 0;
    const emitted = gpu.quality.scaleBurst(effect, requested);
    if (emitted < requested) gpu.recordQualityDrop(effect, requested - emitted);
    return emitted;
  }

  private spawnDeathFragment(
    spec: GpuVfxSpawnSpec,
    chunk: DeathFragmentTemplateChunk,
    displayWidth: number,
    displayHeight: number,
    sourceWidth: number,
    sourceHeight: number,
    originX: number,
    originY: number,
    entityRotation: number,
    entityTint: number,
    auraColor: number,
    targetColorBoost: number,
    playerDeath: boolean,
    hitX: number,
    hitY: number,
    hasHitDirection: boolean,
    rng: () => number,
    travelScale: number,
    micro: boolean,
    nowMs: number,
    fragmentGlowSpec: GpuVfxSpawnSpec | null,
  ): void {
    const gpu = this.gpu;
    if (!gpu) return;
    const offsetX = chunk.offsetX * displayWidth;
    const offsetY = chunk.offsetY * displayHeight;
    const cos = Math.cos(entityRotation);
    const sin = Math.sin(entityRotation);
    const rotatedX = offsetX * cos - offsetY * sin;
    const rotatedY = offsetX * sin + offsetY * cos;
    const radialLength = Math.hypot(rotatedX, rotatedY);
    const radialAngle = radialLength > 0.15
      ? Math.atan2(rotatedY, rotatedX)
      : rng() * Math.PI * 2;
    const angle = radialAngle + (rng() - 0.5) * (micro ? 1.65 : 1.2);
    const travel = randomBetween(
      rng,
      DEATH_DISINTEGRATION_VFX.travelMinPx * (micro ? 1.12 : 0.72),
      DEATH_DISINTEGRATION_VFX.travelMaxPx * (micro ? 1.15 : 1),
    ) * travelScale;
    const jitter = DEATH_DISINTEGRATION_VFX.jitterPx * (micro ? 1.4 : 1);
    const cohesionHitDrift = hasHitDirection
      ? DEATH_DISINTEGRATION_VFX.cohesionHitDriftPx
      : 0;
    const startX = rotatedX + hitX * cohesionHitDrift;
    const startY = rotatedY + hitY * cohesionHitDrift;
    const hitImpulse = hasHitDirection
      ? travel * (micro
        ? DEATH_DISINTEGRATION_VFX.microHitImpulse
        : DEATH_DISINTEGRATION_VFX.mainHitImpulse)
      : 0;
    const endX = startX
      + Math.cos(angle) * travel
      + (rng() - 0.5) * jitter
      + hitX * hitImpulse;
    const endY = startY
      + Math.sin(angle) * travel
      + (rng() - 0.5) * jitter
      + hitY * hitImpulse;
    const lifeMs = randomBetween(
      rng,
      micro
        ? DEATH_DISINTEGRATION_VFX.durationMs - 300
        : DEATH_DISINTEGRATION_VFX.durationMs - DEATH_DISINTEGRATION_VFX.lifetimeVarianceMs,
      DEATH_DISINTEGRATION_VFX.durationMs + DEATH_DISINTEGRATION_VFX.lifetimeVarianceMs,
    );
    // The template deliberately stays on the fixed 4x4 source-pixel analysis grid. Convert
    // only the visible chunk size here so a source block occupies the same World-space size
    // across 32x32, 64x64 and higher-resolution frames. Chunk offsets remain normalized and
    // therefore keep the existing silhouette positions and sampling order.
    const width = Math.max(
      0.8,
      chunk.width * displayWidth * sourceWidth / DEATH_DISINTEGRATION_VFX.referenceDisplaySizePx,
    );
    const height = Math.max(
      0.8,
      chunk.height * displayHeight * sourceHeight / DEATH_DISINTEGRATION_VFX.referenceDisplaySizePx,
    );
    const baseScale = clamp(
      height / DEATH_FRAGMENT_TEXTURE_SIZE
        * DEATH_DISINTEGRATION_VFX.scaleStart
        * (micro ? 1 : DEATH_DISINTEGRATION_VFX.mainFragmentScaleBoost),
      0.2,
      16,
    );
    const morphScale = baseScale * DEATH_MORPH_SCALE_COMPENSATION;
    const aspect = clamp(width / Math.max(0.8, height), 0.38, 3.2);
    const smallMass = micro || rng() > 0.72;
    const largeMass = !micro && rng() < 0.24;
    const stretch = smallMass && rng() < 0.24
      ? aspect * randomBetween(rng, 1.15, 1.8)
      : aspect;
    const auraMix = playerDeath
      ? 0
      : Math.min(
        1,
        DEATH_DISINTEGRATION_VFX.auraTintMix * Math.max(0.18, chunk.brightness)
          + targetColorBoost,
      );
    const tint = mixColors(
      multiplyColors(chunk.color, entityTint),
      auraColor,
      auraMix,
    );
    const visibleTint = micro
      ? tint
      : mixColors(tint, COLORS.GREY_1, DEATH_DISINTEGRATION_VFX.mainFragmentContrast);

    spec.lifeMs = lifeMs;
    spec.frame = micro
      ? DEATH_DUST_MOTE_FRAMES[
        Math.min(DEATH_DUST_MOTE_FRAMES.length - 1, Math.floor(rng() * DEATH_DUST_MOTE_FRAMES.length))
      ]
      : GpuVfxFrameId.DeathMorphCompact;
    spec.frameAnimation = micro
      ? GPU_VFX_NO_FRAME_ANIMATION
      : GpuVfxFrameAnimationId.DeathDisintegration;
    spec.x = originX + startX;
    spec.y = originY + startY;
    spec.vx = (endX - startX) * 1000 / lifeMs;
    spec.vy = (endY - startY) * 1000 / lifeMs;
    // Cubic-In haelt nach rund 400 ms erst wenige Prozent der Gesamtstrecke zurueck. Der kleine
    // gemeinsame Startversatz oben reagiert trotzdem sofort auf die Treffer-Richtung.
    spec.positionEase = GpuVfxEase.CubicIn;
    spec.yMode = GpuVfxEase.Linear;
    spec.gravityFactor = 1;
    spec.rotation = entityRotation + (rng() - 0.5) * (micro ? 1.2 : 0.18);
    const rotationFactor = largeMass ? 0.45 : smallMass ? 1.65 : 1;
    spec.angularVelocity = (rng() - 0.5)
      * (micro ? 2.4 : DEATH_DISINTEGRATION_VFX.rotationMaxDeg * Math.PI / 180 * 2)
      * rotationFactor;
    spec.rotationEase = GpuVfxEase.CubicIn;
    spec.scaleStart = morphScale * (micro ? 0.72 : 1);
    spec.scaleEnd = micro
      ? spec.scaleStart * 0.62
      : morphScale * DEATH_DISINTEGRATION_VFX.scaleEnd;
    spec.scaleEase = micro ? GpuVfxEase.QuadOut : GpuVfxEase.CubicIn;
    spec.stretchStart = stretch;
    spec.stretchEnd = Math.max(0.72, stretch * (smallMass ? 0.68 : 0.84));
    spec.alphaStart = Math.min(
      1,
      DEATH_DISINTEGRATION_VFX.alpha
        * randomBetween(rng, micro ? 0.3 : 0.98, micro ? 0.48 : 1.08),
    );
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.CubicIn;
    spec.tint = visibleTint;
    spec.tintBlendStart = 1;
    spec.tintBlendEnd = 1;
    gpu.spawn(spec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);

    if (fragmentGlowSpec) {
      const glowScaleStart = baseScale
        * DEATH_FRAGMENT_TEXTURE_SIZE / DEATH_GLOW_TEXTURE_SIZE
        * DEATH_DISINTEGRATION_VFX.playerFragmentGlowScale;
      fragmentGlowSpec.lifeMs = lifeMs;
      fragmentGlowSpec.frameAnimation = GPU_VFX_NO_FRAME_ANIMATION;
      fragmentGlowSpec.x = spec.x;
      fragmentGlowSpec.y = spec.y;
      fragmentGlowSpec.vx = spec.vx;
      fragmentGlowSpec.vy = spec.vy;
      fragmentGlowSpec.positionEase = spec.positionEase;
      fragmentGlowSpec.yMode = spec.yMode;
      fragmentGlowSpec.gravityFactor = spec.gravityFactor;
      fragmentGlowSpec.rotation = spec.rotation;
      fragmentGlowSpec.angularVelocity = spec.angularVelocity;
      fragmentGlowSpec.rotationEase = spec.rotationEase;
      fragmentGlowSpec.scaleStart = glowScaleStart;
      fragmentGlowSpec.scaleEnd = glowScaleStart * (largeMass ? 0.28 : 0.34);
      fragmentGlowSpec.scaleEase = GpuVfxEase.QuadOut;
      fragmentGlowSpec.stretchStart = spec.stretchStart;
      fragmentGlowSpec.stretchEnd = spec.stretchEnd;
      fragmentGlowSpec.alphaStart = DEATH_DISINTEGRATION_VFX.playerFragmentGlowAlpha;
      fragmentGlowSpec.alphaEnd = 0;
      fragmentGlowSpec.alphaEase = GpuVfxEase.QuadOut;
      fragmentGlowSpec.tint = auraColor;
      fragmentGlowSpec.tintBlendStart = 1;
      fragmentGlowSpec.tintBlendEnd = 1;
      gpu.spawn(fragmentGlowSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }
}

function resolveDeathProfile(maxDimension: number, chunkCount: number): DeathProfile {
  const profile = maxDimension <= 24
    ? { main: 24, micro: 3, glow: 2, travelScale: 0.78 }
    : maxDimension <= 36
      ? { main: 36, micro: 6, glow: 3, travelScale: 0.94 }
      : maxDimension <= 64
        ? { main: 44, micro: 10, glow: 5, travelScale: 1.14 }
        : { main: 48, micro: 14, glow: 8, travelScale: 1.34 };
  return {
    main: Math.min(chunkCount, Math.min(DEATH_DISINTEGRATION_VFX.maxChunksPerEffect, profile.main)),
    micro: Math.min(chunkCount, profile.micro),
    glow: profile.glow,
    travelScale: profile.travelScale,
  };
}

function getBloodBand(totalDamage: number) {
  if (totalDamage <= BLOOD_HIT_VFX.bands.light.maxDamage) return BLOOD_HIT_VFX.bands.light;
  if (totalDamage <= BLOOD_HIT_VFX.bands.medium.maxDamage) return BLOOD_HIT_VFX.bands.medium;
  return BLOOD_HIT_VFX.bands.heavy;
}

function pickBloodTint(rng: () => number): number {
  const index = Math.min(
    BLOOD_HIT_VFX.palette.length - 1,
    Math.floor(rng() * BLOOD_HIT_VFX.palette.length),
  );
  const baseTint = BLOOD_HIT_VFX.palette[index] ?? BLOOD_HIT_VFX.palette[0];
  // Keep the established dark-crimson palette, but lift it enough for the GPU layer to read
  // clearly against grass, dirt and night grading. This only affects transient/stain blood;
  // the low-health overlay keeps its existing palette contract.
  return mixColors(baseTint, COLORS.RED_3, 0.24);
}

function randomBetween(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min + 1));
}

function degToRad(value: number): number {
  return value * Math.PI / 180;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function multiplyColors(colorA: number, colorB: number): number {
  const red = Math.round(((colorA >> 16) & 0xff) * ((colorB >> 16) & 0xff) / 255);
  const green = Math.round(((colorA >> 8) & 0xff) * ((colorB >> 8) & 0xff) / 255);
  const blue = Math.round((colorA & 0xff) * (colorB & 0xff) / 255);
  return (red << 16) | (green << 8) | blue;
}
