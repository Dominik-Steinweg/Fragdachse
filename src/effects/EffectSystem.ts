import Phaser from 'phaser';
import type { NetworkBridge } from '../network/NetworkBridge';
import { PLAYER_SIZE, DEPTH_FX, SHOCKWAVE_RADIUS } from '../config';

export class EffectSystem {
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
}
