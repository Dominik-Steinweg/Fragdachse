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
  resolveFlashAction,
  resolveHitBand,
  resolveHitFlashProfile,
  strongerBand,
} from './hitFeedbackModel';

/**
 * Alles, was die Trefferreaktion über ein Ziel wissen muss. Bewusst der Sprite selbst und nicht
 * eine Kopie seiner Felder: der Blitz folgt dem Ziel über seine gesamte Lebensdauer, und der
 * Impuls braucht ohnehin dieselbe Objektreferenz.
 */
export interface HitTargetSilhouette {
  readonly sprite: Phaser.GameObjects.Image;
  /** Besitzer- beziehungsweise Gegnerfarbe. Nur für den additiven Blitz, nie für das Ziel selbst. */
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
  ageMs: number;
  totalLifeMs: number;
  durationMs: number;
  peakAlpha: number;
  scaleBoost: number;
  baseWidth: number;
  baseHeight: number;
}

const FALLBACK_TEXTURE = '__WHITE';
const DEPTH_OFFSET = 0.02;

/**
 * Unmittelbare Reaktion der getroffenen Figur: eine kurzlebige additive Kopie ihrer **eigenen**
 * Textur plus ein rein visueller Positionsimpuls.
 *
 * Bewusste Eigenschaften:
 *
 * - **Keine Filterinstanz pro Treffer.** Der Blitz ist eine getintete additive Kopie, kein
 *   Glow- oder Farbfilter. Bei zwanzig Treffern pro Sekunde wäre alles andere untragbar.
 * - **Kein Tween pro Treffer.** Der Renderer hält eine Aktivliste und wird pro Frame getaktet.
 *   Das hält das Abklingen prüfbar und vermeidet ein Tween-Objekt je Minigun-Treffer.
 * - **Das Ziel wird nie verändert.** Tint, Glow, Besitzer- und Statusfarben sowie Alpha der
 *   Entity bleiben unangetastet. Deshalb funktioniert derselbe Effekt für den nie getinteten
 *   Spieler-Sprite und den immer getinteten Gegner-Sprite.
 * - **Fester Pool.** Zur Laufzeit wird nichts allokiert; bei Überlauf wird der am weitesten
 *   fortgeschrittene Slot übernommen.
 */
export class HitFeedbackRenderer {
  private readonly slots: FlashSlot[] = [];
  private readonly byTarget = new Map<string, FlashSlot>();
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
        .setBlendMode(Phaser.BlendModes.ADD)
        .setActive(false)
        .setVisible(false);
      this.slots.push({
        image,
        targetId: null,
        sprite: null,
        band: 'light',
        ageMs: 0,
        totalLifeMs: 0,
        durationMs: 0,
        peakAlpha: 0,
        scaleBoost: 1,
        baseWidth: 0,
        baseHeight: 0,
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
    if (!getGraphicsQualityProfile(this.scene).hitFlash) return;
    const target = this.provider?.(effect.targetId) ?? null;
    if (!target || !target.sprite.active || !target.sprite.visible) return;

    const band = resolveHitBand(
      effect.totalDamage,
      effect.hpLost,
      effect.armorLost,
      effect.isKill,
      effect.isCritical === true,
    );

    const existing = this.byTarget.get(effect.targetId) ?? null;
    const action = resolveFlashAction(
      existing ? { band: existing.band, ageMs: existing.ageMs, totalLifeMs: existing.totalLifeMs } : null,
      band,
    );
    if (action === 'skip') return;

    const resolvedBand = existing && action === 'rearm' ? strongerBand(existing.band, band) : band;
    const profile = resolveHitFlashProfile(resolvedBand);
    const slot = action === 'rearm' && existing ? existing : this.acquireSlot(effect.targetId);

    slot.targetId = effect.targetId;
    slot.sprite = target.sprite;
    slot.band = resolvedBand;
    slot.ageMs = 0;
    if (action !== 'rearm') slot.totalLifeMs = 0;
    slot.durationMs = profile.durationMs;
    slot.peakAlpha = profile.alpha;
    slot.scaleBoost = profile.scaleBoost;
    slot.baseWidth = target.sprite.displayWidth;
    slot.baseHeight = target.sprite.displayHeight;
    this.byTarget.set(effect.targetId, slot);

    const frame = target.sprite.frame?.name;
    slot.image
      .setTexture(target.sprite.texture.key, frame)
      .setDisplaySize(slot.baseWidth, slot.baseHeight)
      .setTint(mixFlashColor(target.materialColor, profile.whiteMix))
      .setFlipX(target.sprite.flipX)
      .setDepth(target.sprite.depth + DEPTH_OFFSET)
      .setActive(true)
      .setVisible(true);
    this.syncSlot(slot);

    this.applyJolt(effect, target, profile);
    this.applyCameraKick(effect, profile.cameraKickPx);
  }

  update(deltaMs: number): void {
    for (const slot of this.slots) {
      if (!slot.image.active) continue;
      slot.ageMs += deltaMs;
      slot.totalLifeMs += deltaMs;
      if (slot.ageMs >= slot.durationMs || !slot.sprite?.active) {
        this.releaseSlot(slot);
        continue;
      }
      this.syncSlot(slot);
    }
  }

  /** Rundenende: alle laufenden Blitze fallen lassen, der Pool selbst bleibt bestehen. */
  clear(): void {
    for (const slot of this.slots) this.releaseSlot(slot);
    this.byTarget.clear();
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
    const scale = 1 + (slot.scaleBoost - 1) * t;
    slot.image
      .setPosition(sprite.x + offset.x, sprite.y + offset.y)
      .setRotation(sprite.rotation)
      .setDisplaySize(slot.baseWidth * scale, slot.baseHeight * scale)
      .setAlpha(slot.peakAlpha * (1 - t * t));
  }

  private applyJolt(
    effect: SyncedHitEffect,
    target: HitTargetSilhouette,
    profile: HitFlashProfile,
  ): void {
    if (!getGraphicsQualityProfile(this.scene).entityJolt) return;
    const scale = target.isLocalPlayer ? HIT_FEEDBACK_VFX.localPlayerJoltFactor : 1;
    const px = resolveJoltPx(profile.joltPx, target.knockbackFactor, scale);
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

  private acquireSlot(targetId: string): FlashSlot {
    let free: FlashSlot | null = null;
    let oldest: FlashSlot | null = null;
    let oldestProgress = -1;

    for (const slot of this.slots) {
      if (!slot.image.active) {
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
    if (slot.targetId && slot.targetId !== targetId) this.byTarget.delete(slot.targetId);
    return slot;
  }

  private releaseSlot(slot: FlashSlot): void {
    if (slot.targetId && this.byTarget.get(slot.targetId) === slot) this.byTarget.delete(slot.targetId);
    slot.targetId = null;
    slot.sprite = null;
    slot.ageMs = 0;
    slot.totalLifeMs = 0;
    slot.durationMs = 0;
    slot.image.setActive(false).setVisible(false).setAlpha(0);
  }
}
