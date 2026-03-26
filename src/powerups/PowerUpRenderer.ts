import Phaser from 'phaser';
import type { SyncedPowerUp, SyncedPowerUpPedestal } from '../types';
import { DEPTH } from '../config';
import { configureAdditiveImage, fillRadialGradientTexture } from '../effects/EffectUtils';
import { POWERUP_DEFS, POWERUP_PEDESTAL_CONFIG, POWERUP_RENDER_SIZE } from './PowerUpConfig';

const TEX_POWERUP_PEDESTAL_GLOW = '__powerup_pedestal_glow';

interface PedestalVisual {
  container: Phaser.GameObjects.Container;
  glow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Ellipse;
  top: Phaser.GameObjects.Ellipse;
  accent: Phaser.GameObjects.Ellipse;
  anchorY: number;
  state: SyncedPowerUpPedestal;
}

/**
 * Rendert Power-Up-Items auf dem Spielfeld (Host + Client).
 *
 * Aufbau je Container (Schicht-Reihenfolge = Render-Reihenfolge):
 *   [0] Image | Rectangle – die eigentliche Grafik (feste Größe)
 *       └─ preFX.addGlow()  – Pixel-Lichtaura direkt an der Grafikkante,
 *                             outerStrength pulsiert via Tween
 *
 * Der preFX-Glow rendert die Aura hinter dem Sprite-Pixel, die Grafik bleibt
 * immer sichtbar vorne. Der Glow-Tween-Cleanup erfolgt über das destroy-Event
 * der Grafik – keine separate Tween-Map nötig.
 * Container.destroy(true) räumt Grafik + deren Tweens automatisch auf.
 */
export class PowerUpRenderer {
  private sprites = new Map<number, Phaser.GameObjects.Container>();
  private pedestals = new Map<number, PedestalVisual>();

  constructor(private scene: Phaser.Scene) {
    this.ensureTextures();
  }

  /**
   * Synchronisiert die sichtbaren PowerUp-Container mit dem aktuellen Netzwerk-Snapshot.
   */
  sync(powerups: SyncedPowerUp[]): void {
    const activeUids = new Set<number>();

    for (const pu of powerups) {
      activeUids.add(pu.uid);
      if (this.sprites.has(pu.uid)) {
        this.sprites.get(pu.uid)!.setPosition(pu.x, pu.y);
        continue;
      }

      const def       = POWERUP_DEFS[pu.defId];
      const glowColor = def?.color ?? 0xffffff;
      // Deterministischer Phasen-Offset: Items pulsieren leicht gegeneinander versetzt
      const phaseMs   = (pu.uid * 137) % 1400;

      // ── Container ─────────────────────────────────────────────────────────
      const container = this.scene.add.container(pu.x, pu.y);
      container.setDepth(DEPTH.PLAYERS - 1);

      // ── Grafik: feste Größe, kein Scale-Tween ─────────────────────────────
      const graphic: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle =
        def?.spriteKey
          ? this.scene.add.image(0, 0, def.spriteKey).setDisplaySize(POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE)
          : this.scene.add.rectangle(0, 0, POWERUP_RENDER_SIZE, POWERUP_RENDER_SIZE, glowColor);
      container.add(graphic);

      // ── preFX-Glow: Pixel-Aura, outerStrength pulsiert ───────────────────
      const glow = graphic.preFX?.addGlow(glowColor, 2, 0, false, 0.1, 14);
      if (glow) {
        const glowTween = this.scene.tweens.add({
          targets:       glow,
          outerStrength: { from: 2, to: 8 },
          duration:      900,
          yoyo:          true,
          repeat:        -1,
          ease:          'Sine.easeInOut',
          delay:         phaseMs,
        });
        // Tween-Cleanup ohne separate Map: destroy-Event der Grafik abfangen
        graphic.once(Phaser.GameObjects.Events.DESTROY, () => glowTween.stop());
      }

      this.sprites.set(pu.uid, container);
    }

    // Entfernte Items aufräumen
    for (const [uid, container] of this.sprites) {
      if (!activeUids.has(uid)) {
        container.destroy(true); // Kinder (Arc, Grafik) + deren Tweens werden mitgelöscht
        this.sprites.delete(uid);
      }
    }
  }

  syncPedestals(pedestals: SyncedPowerUpPedestal[]): void {
    const activeIds = new Set<number>();

    for (const pedestal of pedestals) {
      activeIds.add(pedestal.id);
      const existing = this.pedestals.get(pedestal.id);
      if (existing) {
        existing.state = pedestal;
        existing.anchorY = pedestal.y;
        existing.container.setPosition(pedestal.x, pedestal.y);
        continue;
      }

      const def = POWERUP_DEFS[pedestal.defId];
      const glowColor = def?.color ?? 0xffffff;
      const container = this.scene.add.container(pedestal.x, pedestal.y);
      container.setDepth(DEPTH.PLAYERS - 2);

      const shadow = this.scene.add.ellipse(0, 5, POWERUP_PEDESTAL_CONFIG.renderBaseWidth + 6, POWERUP_PEDESTAL_CONFIG.renderBaseHeight, 0x05070b, 0.5);
      const base = this.scene.add.ellipse(0, 2, POWERUP_PEDESTAL_CONFIG.renderBaseWidth, POWERUP_PEDESTAL_CONFIG.renderBaseHeight, 0x10141f, 0.92)
        .setStrokeStyle(2, 0x394a50, 0.85);
      const top = this.scene.add.ellipse(0, -1, POWERUP_PEDESTAL_CONFIG.renderBaseWidth - 5, POWERUP_PEDESTAL_CONFIG.renderBaseHeight - 5, glowColor, 0.42)
        .setStrokeStyle(2, glowColor, 0.9);
      const accent = this.scene.add.ellipse(0, -2, POWERUP_PEDESTAL_CONFIG.renderBaseWidth - 11, 4, 0xffffff, 0.3);
      const ring = this.scene.add.ellipse(0, -1, POWERUP_PEDESTAL_CONFIG.renderBaseWidth + 2, POWERUP_PEDESTAL_CONFIG.renderBaseHeight + 2)
        .setStrokeStyle(2, glowColor, 0.85);
      const glow = configureAdditiveImage(
        this.scene.add.image(0, -1, TEX_POWERUP_PEDESTAL_GLOW),
        DEPTH.PLAYERS - 2.2,
        0.3,
        glowColor,
      ).setScale(0.8);

      container.add([glow, shadow, base, top, accent, ring]);
      this.pedestals.set(pedestal.id, {
        container,
        glow,
        ring,
        top,
        accent,
        anchorY: pedestal.y,
        state: pedestal,
      });
    }

    for (const [id, visual] of this.pedestals) {
      if (!activeIds.has(id)) {
        visual.container.destroy(true);
        this.pedestals.delete(id);
      }
    }
  }

  updatePedestals(now: number): void {
    for (const [id, visual] of this.pedestals) {
      const phase = now / 1000 + id * 0.37;
      const breath = 0.5 + 0.5 * Math.sin(phase * 2.2);
      const hasPowerUp = visual.state.hasPowerUp;
      const timeUntilRespawn = visual.state.nextRespawnAt > 0 ? visual.state.nextRespawnAt - now : Number.POSITIVE_INFINITY;
      const isAnnouncing = !hasPowerUp && Number.isFinite(timeUntilRespawn) && timeUntilRespawn > 0 && timeUntilRespawn <= POWERUP_PEDESTAL_CONFIG.announceLeadMs;

      let glowAlpha = 0.2 + breath * 0.06;
      let glowScale = 0.78 + breath * 0.04;
      let ringAlpha = 0.58 + breath * 0.08;
      let topAlpha = 0.34 + breath * 0.08;
      let accentAlpha = 0.18 + breath * 0.06;
      let yOffset = Math.sin(phase * 1.4) * 0.45;
      let containerScale = 1;

      if (hasPowerUp) {
        glowAlpha = 0.42 + breath * 0.14;
        glowScale = 0.88 + breath * 0.08;
        ringAlpha = 0.82 + breath * 0.12;
        topAlpha = 0.52 + breath * 0.18;
        accentAlpha = 0.28 + breath * 0.12;
        yOffset = Math.sin(phase * 2.1) * 0.8;
      } else if (isAnnouncing) {
        const blink = 0.5 + 0.5 * Math.sin(now / 90 + id * 1.7);
        const progress = 1 - (timeUntilRespawn / POWERUP_PEDESTAL_CONFIG.announceLeadMs);
        glowAlpha = 0.22 + blink * (0.26 + progress * 0.12);
        glowScale = 0.82 + blink * 0.12 + progress * 0.08;
        ringAlpha = 0.52 + blink * 0.38;
        topAlpha = 0.24 + blink * 0.24;
        accentAlpha = 0.2 + blink * 0.16;
        yOffset = Math.sin(phase * 8.5) * (0.8 + progress * 1.1);
        containerScale = 1 + blink * 0.03;
      }

      visual.container.setY(visual.anchorY + yOffset);
      visual.container.setScale(containerScale);
      visual.glow.setAlpha(glowAlpha).setScale(glowScale);
      visual.ring.setAlpha(ringAlpha);
      visual.top.setAlpha(topAlpha);
      visual.accent.setAlpha(accentAlpha);
    }
  }

  /** Alle Container aufräumen (Arena-Teardown). */
  clear(): void {
    for (const container of this.sprites.values()) container.destroy(true);
    this.sprites.clear();
    for (const visual of this.pedestals.values()) visual.container.destroy(true);
    this.pedestals.clear();
  }

  private ensureTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_POWERUP_PEDESTAL_GLOW, POWERUP_PEDESTAL_CONFIG.renderGlowSize, [
      [0, 'rgba(255,255,255,0.8)'],
      [0.28, 'rgba(255,255,255,0.28)'],
      [0.62, 'rgba(160,200,255,0.1)'],
      [1, 'rgba(0,0,0,0.0)'],
    ]);
  }
}
