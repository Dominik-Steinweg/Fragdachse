import * as Phaser from 'phaser';
import { DASH_T2_S } from '../config';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { EffectSystem } from './EffectSystem';
import type { EnemyEntity } from '../entities/EnemyEntity';

/** Abstand zwischen zwei Trail-Geistern – identisch zum Spieler-Dash. */
const TRAIL_INTERVAL_MS = 50;

/**
 * Darstellung des Gegner-Ausweichschritts: Trail-Geister, Dash-Sound und die verkleinerte
 * Silhouette – exakt die Präsentation des Spieler-Dashs, nur mit dem Gegner-Sprite.
 *
 * Host und Client teilen sich diese Klasse. Der Host skaliert den Gegner bereits in der Physik
 * (dort hängt die Trefferkugel dran), der Client leitet die Skalierung aus der übertragenen
 * Dash-Phase ab – deshalb der Schalter `applyScale`.
 */
export class EnemyDashVisualTracker {
  private readonly previousPhases = new Map<string, number>();
  private readonly phase2StartTimes = new Map<string, number>();
  private readonly trailTimers = new Map<string, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly effectSystem: EffectSystem,
    private readonly audioSystem: GameAudioSystem,
    private readonly applyScale: boolean,
  ) {}

  /** Einmal pro Frame für jeden aktiven Gegner aufrufen. */
  sync(enemy: EnemyEntity): void {
    const phase = enemy.getDashPhase();
    const previousPhase = this.previousPhases.get(enemy.id) ?? 0;
    this.previousPhases.set(enemy.id, phase);

    if (phase === 1 && previousPhase === 0) {
      this.audioSystem.playSound('sfx_dash', enemy.sprite.x, enemy.sprite.y);
    }
    if (phase === 2 && previousPhase !== 2) {
      this.phase2StartTimes.set(enemy.id, this.scene.time.now);
    }

    if (phase === 0) {
      if (previousPhase === 0) return;
      this.forget(enemy.id);
      // Volle Größe sicherstellen, falls ein Snapshot der Erholungsphase verloren ging.
      if (this.applyScale) enemy.setDashScale(1);
      return;
    }

    if (phase === 1) {
      if (this.applyScale) enemy.setDashScale(0.5);
      const now = this.scene.time.now;
      if (now >= (this.trailTimers.get(enemy.id) ?? 0)) {
        this.effectSystem.playDashTrailGhost(
          enemy.sprite.x,
          enemy.sprite.y,
          enemy.getTintColor(),
          0.5,
          enemy.sprite.rotation,
          enemy.getImageKey(),
          enemy.getSize(),
        );
        this.trailTimers.set(enemy.id, now + TRAIL_INTERVAL_MS);
      }
      return;
    }

    this.trailTimers.delete(enemy.id);
    if (!this.applyScale) return;
    // Aufrappeln: dieselbe Quad.easeIn-Kurve, die der Host auf die Trefferkugel anwendet.
    const phase2StartedAt = this.phase2StartTimes.get(enemy.id);
    const progress = phase2StartedAt === undefined
      ? 1
      : Math.min(1, (this.scene.time.now - phase2StartedAt) / (DASH_T2_S * 1000));
    enemy.setDashScale(0.5 + 0.5 * progress * progress);
  }

  /** Aufräumen, sobald ein Gegner verschwindet oder seinen Schritt beendet hat. */
  forget(enemyId: string): void {
    this.previousPhases.delete(enemyId);
    this.phase2StartTimes.delete(enemyId);
    this.trailTimers.delete(enemyId);
  }

  reset(): void {
    this.previousPhases.clear();
    this.phase2StartTimes.clear();
    this.trailTimers.clear();
  }
}
