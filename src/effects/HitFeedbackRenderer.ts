import * as Phaser from 'phaser';
import { HIT_FEEDBACK_VFX } from '../config';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import type { SyncedHitEffect } from '../types';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import type { CameraPostFxController } from './postfx/CameraPostFxController';
import { CAMERA_FEEDBACK_PRIORITY } from './camera/cameraFeedbackPresets';
import type { EntityJoltRegistry, JoltTarget } from './EntityJoltRegistry';
import { resolveJoltPx } from './entityJoltModel';
import {
  type HitBand,
  type HitFlashProfile,
  mixFlashColor,
  flashEnvelope,
  HIT_FEEDBACK_TIMING,
  resolveFlashAction,
  resolveHitFlashProfile,
} from './hitFeedbackModel';

/**
 * Alles, was die Trefferreaktion über ein Ziel wissen muss. Bewusst der Sprite selbst und nicht
 * eine Kopie seiner Felder: der Blitz folgt dem Ziel über seine gesamte Lebensdauer, und der
 * Impuls braucht ohnehin dieselbe Objektreferenz.
 */
export interface HitTargetSilhouette {
  readonly sprite: Phaser.GameObjects.Image;
  /** Besitzer- beziehungsweise Gegnerfarbe. Nur für die Silhouette, nie für das Ziel selbst. */
  readonly materialColor: number;
  /** Inverse Gewichtsangabe aus der Gegnerkonfiguration: leichte Ziele zucken stärker. */
  readonly knockbackFactor: number;
  readonly isLocalPlayer: boolean;
}

export type HitTargetSilhouetteProvider = (targetId: string) => HitTargetSilhouette | null;

interface FlashSlot {
  readonly image: Phaser.GameObjects.Image;
  targetId: string | null;
  sprite: Phaser.GameObjects.Image | null;
  band: HitBand;
  intensity: number;
  darkRemainingMs: number;
  ageMs: number;
  totalLifeMs: number;
  durationMs: number;
  peakAlpha: number;
  scaleBoost: number;
}

const FALLBACK_TEXTURE = '__WHITE';
const DEPTH_OFFSET = 0.02;

/**
 * Unmittelbare Reaktion der getroffenen Figur: eine kurzlebige gefüllte Kopie ihrer eigenen
 * Textur plus ein rein visueller Positionsimpuls.
 *
 * Bewusste Eigenschaften:
 *
 * - **Keine Filterinstanz pro Treffer.** Der Blitz ist eine gefüllte Texturkopie, kein
 *   Glow- oder Farbfilter. Bei zwanzig Treffern pro Sekunde wäre alles andere untragbar.
 * - **Kein Tween pro Treffer.** Der Renderer hält eine Aktivliste und wird pro Frame getaktet.
 *   Das hält das Abklingen prüfbar und vermeidet ein Tween-Objekt je Minigun-Treffer.
 * - **Das Ziel wird nie verändert.** Tint, Glow, Besitzer- und Statusfarben sowie Alpha der
 *   Entity bleiben unangetastet. Deshalb funktioniert derselbe Effekt für den nie getinteten
 *   Spieler-Sprite und den immer getinteten Gegner-Sprite.
 * - **Fester Image-Pool und wiederverwendetes Profil.** Bei Überlauf wird der am weitesten
 *   fortgeschrittene Slot übernommen.
 */
export class HitFeedbackRenderer {
  private readonly slots: FlashSlot[] = [];
  private readonly byTarget = new Map<string, FlashSlot>();
  private readonly profile = {} as HitFlashProfile;
  // Evicting an image must not let its former target bypass the required dark gap.
  private evictedUntil = new WeakMap<Phaser.GameObjects.Image, number>();
  private elapsedMs = 0;
  private provider: HitTargetSilhouetteProvider | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;
  private postFx: CameraPostFxController | null = null;
  private getLocalPlayerId: (() => string) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly jolt: EntityJoltRegistry,
  ) {}

  /** Legt den Pool an. Aufruf beim Zusammenbau des Renderer-Bündels, wie bei den übrigen Renderern. */
  generateTextures(): void {
    if (this.slots.length > 0) return;
    const size = Math.max(1, getGraphicsQualityProfile(this.scene).hitFlashPoolSize);
    for (let i = 0; i < size; i += 1) {
      const image = this.scene.add.image(0, 0, FALLBACK_TEXTURE)
        .setBlendMode(Phaser.BlendModes.NORMAL)
        .setTintMode(Phaser.TintModes.FILL)
        .setActive(false)
        .setVisible(false);
      this.slots.push({
        image,
        targetId: null,
        sprite: null,
        band: 'light',
        intensity: 0,
        darkRemainingMs: 0,
        ageMs: 0,
        totalLifeMs: 0,
        durationMs: 0,
        peakAlpha: 0,
        scaleBoost: 1,
      });
    }
  }

  setSilhouetteProvider(provider: HitTargetSilhouetteProvider | null): void {
    this.provider = provider;
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void {
    this.cameraFeedback = controller;
  }

  setPostFx(controller: CameraPostFxController | null): void {
    this.postFx = controller;
  }

  setLocalPlayerIdProvider(provider: (() => string) | null): void {
    this.getLocalPlayerId = provider;
  }

  playHit(effect: SyncedHitEffect): void {
    const target = this.provider?.(effect.targetId) ?? null;
    if (!target || !target.sprite.active || !target.sprite.visible) return;

    const profile = resolveHitFlashProfile(effect, HIT_FEEDBACK_VFX, this.profile);
    if (profile.intensity <= 0) return;
    this.applyJolt(effect, target, profile);
    this.applyCameraKick(effect, profile.cameraKickPx);
    if (!getGraphicsQualityProfile(this.scene).hitFlash || profile.alpha <= 0 || this.slots.length === 0) return;
    if ((this.evictedUntil.get(target.sprite) ?? 0) > this.elapsedMs) return;

    const existing = this.byTarget.get(effect.targetId) ?? null;
    const action = resolveFlashAction(existing, profile.intensity);
    if (action === 'skip') return;

    const slot = existing ?? this.acquireSlot();

    slot.targetId = effect.targetId;
    slot.sprite = target.sprite;
    slot.ageMs = 0;
    if (!existing) slot.totalLifeMs = 0;
    if (!existing || profile.intensity >= slot.intensity) {
      slot.band = profile.band;
      slot.intensity = profile.intensity;
      slot.durationMs = profile.durationMs;
      slot.peakAlpha = profile.alpha;
      slot.scaleBoost = profile.scaleBoost;
      slot.image.setTint(mixFlashColor(target.materialColor, profile.whiteMix));
    }
    this.byTarget.set(effect.targetId, slot);

    slot.image
      .setActive(true)
      .setVisible(true);
    this.syncSlot(slot);
  }

  update(deltaMs: number): void {
    deltaMs = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    this.elapsedMs += deltaMs;
    for (const slot of this.slots) {
      if (!slot.targetId) continue;
      if (!slot.sprite?.active || !slot.sprite.visible) {
        this.releaseSlot(slot);
        continue;
      }
      if (slot.darkRemainingMs > 0) {
        slot.darkRemainingMs -= deltaMs;
        if (slot.darkRemainingMs <= 0) this.releaseSlot(slot);
        continue;
      }
      slot.ageMs += deltaMs;
      slot.totalLifeMs += deltaMs;
      if (slot.ageMs >= slot.durationMs || slot.totalLifeMs >= HIT_FEEDBACK_TIMING.maxRearmLifetimeMs) {
        slot.darkRemainingMs = HIT_FEEDBACK_TIMING.darkMs;
        slot.image.setActive(false).setVisible(false).setAlpha(0);
        continue;
      }
      this.syncSlot(slot);
    }
  }

  /** Rundenende: alle laufenden Blitze fallen lassen, der Pool selbst bleibt bestehen. */
  clear(): void {
    for (const slot of this.slots) this.releaseSlot(slot);
    this.byTarget.clear();
    this.evictedUntil = new WeakMap();
    this.elapsedMs = 0;
  }

  destroyAll(): void {
    this.clear();
    for (const slot of this.slots) slot.image.destroy();
    this.slots.length = 0;
  }

  private syncSlot(slot: FlashSlot): void {
    const sprite = slot.sprite;
    if (!sprite) return;
    const t = slot.durationMs > 0 ? Math.min(1, slot.ageMs / slot.durationMs) : 1;
    // Der Blitz folgt dem gezuckten Körper. Der Versatz liegt als Datum in der Registry vor,
    // aufgetragen wird er erst im Renderfenster – hier wird er deshalb ausdrücklich addiert.
    const offset = this.jolt.getOffset(sprite as unknown as JoltTarget);
    const lifeFade = Math.min(1, Math.max(0, (HIT_FEEDBACK_TIMING.maxRearmLifetimeMs - slot.totalLifeMs) / HIT_FEEDBACK_TIMING.fadeMs));
    const envelope = flashEnvelope(t) * lifeFade;
    const scale = 1 + (slot.scaleBoost - 1) * envelope;
    if (slot.image.texture.key !== sprite.texture.key || slot.image.frame?.name !== sprite.frame?.name) {
      slot.image.setTexture(sprite.texture.key, sprite.frame?.name);
    }
    slot.image
      .setOrigin(sprite.originX, sprite.originY)
      .setFlip(sprite.flipX, sprite.flipY)
      .setDepth(sprite.depth + DEPTH_OFFSET)
      .setPosition(sprite.x + offset.x, sprite.y + offset.y)
      .setRotation(sprite.rotation)
      .setDisplaySize(sprite.displayWidth * scale, sprite.displayHeight * scale)
      .setAlpha(slot.peakAlpha * envelope * sprite.alpha)
      .setVisible(sprite.visible);
  }

  private applyJolt(
    effect: SyncedHitEffect,
    target: HitTargetSilhouette,
    profile: HitFlashProfile,
  ): void {
    if (!getGraphicsQualityProfile(this.scene).entityJolt) return;
    const scale = target.isLocalPlayer ? HIT_FEEDBACK_VFX.localPlayerJoltFactor : 1;
    const px = resolveJoltPx(profile.joltPx, target.knockbackFactor, scale,
      Math.min(target.sprite.displayWidth, target.sprite.displayHeight));
    if (px <= 0) return;
    this.jolt.jolt(
      target.sprite as unknown as JoltTarget,
      effect.dirX,
      effect.dirY,
      px,
      profile.joltMs,
    );
  }

  /**
   * Kamerastoß nur, wenn der lokale Spieler beteiligt ist. Ohne diese Einschränkung würde jeder
   * schwere Treffer an irgendeinem der vielen Gegner die Kamera anstoßen, und aus Feedback
   * würde Rauschen.
   */
  private applyCameraKick(effect: SyncedHitEffect, kickPx: number): void {
    if (kickPx <= 0 || !this.cameraFeedback) return;
    const localId = this.getLocalPlayerId?.();
    if (!localId) return;

    const isTarget = effect.targetId === localId;
    const isShooter = effect.shooterId === localId;
    if (!isTarget && !isShooter) return;

    // Globale Bildreaktion ausschliesslich, wenn es den lokalen Spieler selbst schwer trifft.
    if (isTarget) this.postFx?.pulseEvent('heavyLocalHit');

    this.cameraFeedback.request({
      channel: 'kick',
      amplitudePx: isTarget ? kickPx : kickPx * 0.4,
      durationMs: 170,
      priority: CAMERA_FEEDBACK_PRIORITY.lightImpact,
      dirX: effect.dirX,
      dirY: effect.dirY,
      decay: 'impulse',
    });
  }

  private acquireSlot(): FlashSlot {
    let free: FlashSlot | null = null;
    let oldest: FlashSlot | null = null;
    let oldestProgress = -1;

    for (const slot of this.slots) {
      if (!slot.targetId) {
        free = slot;
        break;
      }
      const progress = slot.durationMs > 0 ? slot.ageMs / slot.durationMs : 1;
      if (progress > oldestProgress) {
        oldestProgress = progress;
        oldest = slot;
      }
    }

    const slot = free ?? oldest!;
    if (slot.sprite) this.evictedUntil.set(slot.sprite, this.elapsedMs + HIT_FEEDBACK_TIMING.darkMs);
    this.releaseSlot(slot);
    return slot;
  }

  private releaseSlot(slot: FlashSlot): void {
    if (slot.targetId && this.byTarget.get(slot.targetId) === slot) this.byTarget.delete(slot.targetId);
    slot.targetId = null;
    slot.sprite = null;
    slot.ageMs = 0;
    slot.totalLifeMs = 0;
    slot.durationMs = 0;
    slot.darkRemainingMs = 0;
    slot.intensity = 0;
    slot.image.setActive(false).setVisible(false).setAlpha(0);
  }
}
