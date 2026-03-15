import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { SyncedHitscanTrace } from '../types';
import { DEPTH_FX, DEPTH_TRACE, PLAYER_SIZE, SHOCKWAVE_RADIUS, getBeamPaletteForPlayerColor } from '../config';

const HITSCAN_TRACER_FADE_MS = 120;

export class EffectSystem {
  private pendingPredictedTracerIds = new Map<number, number>();
  private processedSyncedTracerKeys = new Map<string, number>();

  constructor(
    private scene:  Phaser.Scene,
    private bridge: NetworkBridge,
  ) {}

  /** RPC-Handler registrieren – Effekte werden bei ALLEN Clients (inkl. Host) abgespielt. */
  setup(onLocalConfirmedHit?: () => void): void {
    this.bridge.registerEffectHandler((type, x, y, shooterId) => {
      if (type === 'hit') {
        if (shooterId === this.bridge.getLocalPlayerId()) {
          onLocalConfirmedHit?.();
        }
        this.playHitEffect(x, y);
      }
      if (type === 'death') this.playDeathEffect(x, y);
    });

    this.bridge.registerHitscanTracerHandler((startX, startY, endX, endY, color, thickness, shooterId, shotId) => {
      this.playSyncedHitscanTracer({
        startX,
        startY,
        endX,
        endY,
        color,
        thickness,
        shooterId,
        shotId,
      });
    });
  }

  // ── Treffer-Effekt: kleiner roter Ring ────────────────────────────────────

  private playHitEffect(x: number, y: number): void {
    const ring = this.scene.add.circle(x, y, PLAYER_SIZE * 0.45, 0xff3333, 0.85);
    ring.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     2.8,
      scaleY:     2.8,
      alpha:      0,
      duration:   100,
      ease:       'Power2Out',
      onComplete: () => ring.destroy(),
    });
  }

  // ── Schockwellen-Effekt: expandierender Goldring (Unburrow) ─────────────

  playShockwaveEffect(x: number, y: number): void {
    const startRadius = 10;
    const endScale    = (SHOCKWAVE_RADIUS / startRadius) * 2;
    const ring = this.scene.add.circle(x, y, startRadius, 0xffcc00, 0.7);
    ring.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   350,
      ease:       'Power2Out',
      onComplete: () => ring.destroy(),
    });
    // Kleiner weißer Kernblitz
    const flash = this.scene.add.circle(x, y, 8, 0xffffff, 1);
    flash.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    flash,
      scaleX:     4,
      scaleY:     4,
      alpha:      0,
      duration:   180,
      ease:       'Power3Out',
      onComplete: () => flash.destroy(),
    });
  }

  // ── Granaten-Explosions-Effekt: wachsender roter Kreis ───────────────────

  playExplosionEffect(x: number, y: number, radius: number): void {
    const startRadius = 8;
    const endScale    = (radius / startRadius) * 2;
    const ring = this.scene.add.circle(x, y, startRadius, 0xff2200, 0.7);
    ring.setDepth(DEPTH_FX);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     endScale,
      scaleY:     endScale,
      alpha:      0,
      duration:   600,
      ease:       'Power2Out',
      onComplete: () => ring.destroy(),
    });
  }

  playHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
  ): void {
    const palette = getBeamPaletteForPlayerColor(playerColor);
    const gfx = this.scene.add.graphics();
    gfx.setDepth(DEPTH_TRACE);

    this.strokeTracer(gfx, palette.shadow, Math.max(thickness + 6, 6), 0.20, startX, startY, endX, endY);
    this.strokeTracer(gfx, palette.glow, Math.max(thickness + 3, 4), 0.45, startX, startY, endX, endY);
    this.strokeTracer(gfx, palette.core, Math.max(thickness, 2), 0.95, startX, startY, endX, endY);

    gfx.fillStyle(palette.glow, 0.40);
    gfx.fillCircle(startX, startY, Math.max(thickness * 1.35, 4));
    gfx.fillStyle(palette.core, 0.85);
    gfx.fillCircle(startX, startY, Math.max(thickness * 0.75, 2));
    gfx.fillStyle(palette.core, 0.65);
    gfx.fillCircle(endX, endY, Math.max(thickness * 0.6, 2));

    this.scene.tweens.add({
      targets:    gfx,
      alpha:      0,
      duration:   HITSCAN_TRACER_FADE_MS,
      ease:       'Quad.easeOut',
      onComplete: () => gfx.destroy(),
    });
  }

  playPredictedHitscanTracer(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    playerColor: number,
    thickness: number,
    shotId: number,
  ): void {
    this.pendingPredictedTracerIds.set(shotId, this.scene.time.now + 1000);
    this.playHitscanTracer(startX, startY, endX, endY, playerColor, thickness);
  }

  playSyncedHitscanTracer(trace: SyncedHitscanTrace): void {
    const { startX, startY, endX, endY, color, thickness, shooterId, shotId } = trace;
    if (this.shouldSkipSyncedTracer(shooterId, shotId)) return;
    this.playHitscanTracer(startX, startY, endX, endY, color, thickness);
  }

  private consumePredictedTracerId(shotId: number): boolean {
    const now = this.scene.time.now;

    for (const [id, expiresAt] of this.pendingPredictedTracerIds) {
      if (expiresAt <= now) this.pendingPredictedTracerIds.delete(id);
    }

    if (!this.pendingPredictedTracerIds.has(shotId)) return false;
    this.pendingPredictedTracerIds.delete(shotId);
    return true;
  }

  private shouldSkipSyncedTracer(shooterId?: string, shotId?: number): boolean {
    if (shotId === undefined || !shooterId) return false;

    const now = this.scene.time.now;
    for (const [key, expiresAt] of this.processedSyncedTracerKeys) {
      if (expiresAt <= now) this.processedSyncedTracerKeys.delete(key);
    }

    const tracerKey = `${shooterId}:${shotId}`;
    if (this.processedSyncedTracerKeys.has(tracerKey)) return true;
    this.processedSyncedTracerKeys.set(tracerKey, now + 250);

    return shooterId === this.bridge.getLocalPlayerId() && this.consumePredictedTracerId(shotId);
  }

  // ── Todes-Effekt: drei Explosionsringe + weißer Blitz ────────────────────

  private playDeathEffect(x: number, y: number): void {
    // Drei konzentrische Ringe in unterschiedlichen Farben und Verzögerungen
    const rings: Array<{ color: number; delay: number; scale: number; duration: number }> = [
      { color: 0xff6600, delay: 0,   scale: 12, duration: 550 },
      { color: 0xff3300, delay: 60,  scale: 9,  duration: 380 },
      { color: 0xffcc00, delay: 120, scale: 7,  duration: 240 },
    ];

    for (const r of rings) {
      const ring = this.scene.add.circle(x, y, 8, r.color, 1);
      ring.setDepth(DEPTH_FX);
      this.scene.tweens.add({
        targets:    ring,
        scaleX:     r.scale,
        scaleY:     r.scale,
        alpha:      0,
        delay:      r.delay,
        duration:   r.duration,
        ease:       'Power3Out',
        onComplete: () => ring.destroy(),
      });
    }
  }

  private strokeTracer(
    gfx: Phaser.GameObjects.Graphics,
    color: number,
    width: number,
    alpha: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): void {
    gfx.lineStyle(width, color, alpha);
    gfx.beginPath();
    gfx.moveTo(startX, startY);
    gfx.lineTo(endX, endY);
    gfx.strokePath();
  }
}
