import Phaser from 'phaser';
import type { SyncedPowerUp } from '../types';
import { POWERUP_DEFS, POWERUP_RENDER_SIZE } from './PowerUpConfig';
import { DEPTH } from '../config';

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

  constructor(private scene: Phaser.Scene) {}

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

  /** Alle Container aufräumen (Arena-Teardown). */
  clear(): void {
    for (const container of this.sprites.values()) container.destroy(true);
    this.sprites.clear();
  }
}
