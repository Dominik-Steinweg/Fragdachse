import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyBurrowConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyBurrowMovementSource, EnemyManager } from '../entities/EnemyManager';

/**
 * Grund, aus dem ein Gegner gerade eingebuddelt ist.
 * - `spawn-tunnel`: Anfahrt vom linken Spielfeldrand, bis ein freies Feld erreicht ist.
 * - `train-crossing`: kurzes Untertauchen, um die Gleise trotz fahrendem Zug zu queren.
 */
type EnemyBurrowReason = 'spawn-tunnel' | 'train-crossing';

interface EnemyBurrowState {
  readonly reason: EnemyBurrowReason;
  readonly endsAt: number;
  /** Startposition der Anfahrt – Grundlage für die Mindest-Grabstrecke. */
  readonly startX: number;
}

/** Prüft, ob an einer Weltposition genug freier, erreichbarer Boden zum Auftauchen ist. */
export type FreeGroundResolver = (x: number, y: number, radius: number) => boolean;

/**
 * Host-seitiges Einbuddeln für Coop-Defense-Gegner. Unter der Erde gelten dieselben
 * Einschränkungen wie beim Spieler: keine Kollisionen, keine Angriffe, unverwundbar.
 *
 * Zwei Anwendungsfälle, beide rein datengetrieben über {@link CoopDefenseEnemyBurrowConfig}:
 *  1. Gegner mit `spawnBurrowedAtLeftEdge` erscheinen eingebuddelt am linken Rand und graben sich
 *     geradeaus nach rechts, bis ein freies Feld erreicht ist – dann tauchen sie auf.
 *  2. Gegner mit `crossesTrainTracks` buddeln sich ein, statt vor den Gleisen auf den Zug zu warten.
 */
export class CoopDefenseEnemyBurrowSystem implements EnemyBurrowMovementSource {
  private readonly states = new Map<string, EnemyBurrowState>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly setEnemyCollisionsEnabled: (enemyId: string, enabled: boolean) => void,
    private readonly isFreeGroundAt: FreeGroundResolver,
  ) {}

  /**
   * Setzt frisch erzeugte Gegner, die eingebuddelt starten, direkt in die Anfahrt.
   * Wird für jeden Spawn aufgerufen (Welle, Death-Spawn, Fähigkeit).
   */
  notifyEnemySpawned(enemy: EnemyEntity, now = Date.now()): void {
    const burrow = this.getBurrowConfig(enemy);
    if (!burrow?.spawnBurrowedAtLeftEdge) return;
    this.startBurrow(enemy, 'spawn-tunnel', now + burrow.spawnTunnelTimeoutMs);
  }

  isBurrowed(enemyId: string): boolean {
    return this.states.has(enemyId);
  }

  getSpeedFactor(enemyId: string): number {
    const enemy = this.states.has(enemyId) ? this.enemyManager.getEnemy(enemyId) : undefined;
    return enemy ? (this.getBurrowConfig(enemy)?.speedFactor ?? 1) : 1;
  }

  getForcedDirection(enemyId: string): { x: number; y: number } | null {
    // Nur die Anfahrt gräbt stur geradeaus; beim Gleis-Queren bleibt die normale Wegfindung aktiv.
    return this.states.get(enemyId)?.reason === 'spawn-tunnel' ? { x: 1, y: 0 } : null;
  }

  /**
   * Fordert ein Einbuddeln zum Queren der Gleise an. Liefert true, solange der Gegner deshalb
   * unter der Erde ist – der Aufrufer darf ihn dann ohne Rücksicht auf den Zug weiterlaufen lassen.
   */
  requestTrainCrossingBurrow(enemyId: string, now: number): boolean {
    const existing = this.states.get(enemyId);
    if (existing) return existing.reason === 'train-crossing';

    const enemy = this.enemyManager.getEnemy(enemyId);
    const burrow = enemy ? this.getBurrowConfig(enemy) : undefined;
    if (!enemy || !burrow?.crossesTrainTracks) return false;

    this.startBurrow(enemy, 'train-crossing', now + burrow.maxDurationMs);
    return true;
  }

  hostUpdate(now: number): void {
    for (const [enemyId, state] of [...this.states]) {
      const enemy = this.enemyManager.getEnemy(enemyId);
      if (!enemy?.sprite.active) {
        this.states.delete(enemyId);
        continue;
      }

      // Die Anfahrt endet, sobald der Gegner die Mindest-Grabstrecke hinter sich hat UND freien
      // Boden erreicht. Die maximale Grabzeit ist nur der Not-Aus, damit niemand dauerhaft
      // unter der Erde stecken bleibt.
      const reachedFreeGround = state.reason === 'spawn-tunnel'
        && enemy.sprite.x - state.startX >= (this.getBurrowConfig(enemy)?.spawnTunnelMinDistancePx ?? 0)
        && this.isFreeGroundAt(enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius());
      if (reachedFreeGround || now >= state.endsAt) {
        this.endBurrow(enemy);
      }
    }
  }

  clear(): void {
    for (const enemyId of [...this.states.keys()]) {
      const enemy = this.enemyManager.getEnemy(enemyId);
      if (enemy) this.endBurrow(enemy);
      else this.states.delete(enemyId);
    }
  }

  private startBurrow(enemy: EnemyEntity, reason: EnemyBurrowReason, endsAt: number): void {
    this.states.set(enemy.id, { reason, endsAt, startX: enemy.sprite.x });
    this.enemyManager.setEnemyBurrowed(enemy.id, true);
    this.setEnemyCollisionsEnabled(enemy.id, false);
  }

  private endBurrow(enemy: EnemyEntity): void {
    this.states.delete(enemy.id);
    this.enemyManager.setEnemyBurrowed(enemy.id, false);
    this.setEnemyCollisionsEnabled(enemy.id, true);
  }

  private getBurrowConfig(enemy: EnemyEntity): CoopDefenseEnemyBurrowConfig | undefined {
    return enemy.faction === 'hostile' ? getCoopDefenseEnemyConfig(enemy.kind).burrow : undefined;
  }
}
