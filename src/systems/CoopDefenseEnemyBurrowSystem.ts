import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyBurrowConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyBurrowMovementSource, EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';

/**
 * Grund, aus dem ein Gegner gerade eingebuddelt ist.
 * - `spawn-tunnel`: Anfahrt vom linken Spielfeldrand, bis ein freies Feld erreicht ist.
 * - `train-crossing`: kurzes Untertauchen, um die Gleise trotz fahrendem Zug zu queren.
 * - `scripted-phase`: zeitlich exakt festgelegtes Untertauchen einer Bossphase.
 */
type EnemyBurrowReason = 'spawn-tunnel' | 'spawn-point' | 'train-crossing' | 'scripted-phase';

interface EnemyBurrowState {
  readonly reason: EnemyBurrowReason;
  readonly endsAt: number;
  /** Startposition der Anfahrt – Grundlage für die Mindest-Grabstrecke. */
  readonly startX: number;
}

const SPAWN_POINT_BURROW_DURATION_MS = 1_200;

/** Prueft, ob der Koerper an einer Weltposition physisch freien Boden hat. */
export type FreeGroundResolver = (x: number, y: number, radius: number) => boolean;
export type SafeGroundPositionResolver = (
  x: number,
  y: number,
  radius: number,
  maxRadiusCells: number,
) => { x: number; y: number } | null;

const BURROW_SAFE_SEARCH_RADIUS_CELLS = 4;
const BURROW_SAFE_RETRY_INTERVAL_MS = 250;

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
    private readonly findSafeGroundPosition?: SafeGroundPositionResolver,
  ) {}

  /**
   * Setzt frisch erzeugte Gegner, die eingebuddelt starten, direkt in die Anfahrt.
   * Wird für jeden Spawn aufgerufen (Welle, Death-Spawn, Fähigkeit).
   */
  notifyEnemySpawned(
    enemy: EnemyEntity,
    optionsOrNow: EnemySpawnOptions | number = {},
    now = Date.now(),
  ): void {
    // Keep the old `(enemy, now)` call contract for scripted/test callers while allowing the
    // spawn-point path to pass explicit spawn options.
    const options = typeof optionsOrNow === 'number' ? {} : optionsOrNow;
    const spawnNow = typeof optionsOrNow === 'number' ? optionsOrNow : now;
    if (options.spawnBurrowed) {
      this.startBurrow(enemy, 'spawn-point', spawnNow + SPAWN_POINT_BURROW_DURATION_MS);
      return;
    }
    const burrow = this.getBurrowConfig(enemy);
    if (!burrow?.spawnBurrowedAtLeftEdge) return;
    this.startBurrow(enemy, 'spawn-tunnel', spawnNow + burrow.spawnTunnelTimeoutMs);
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
    const reason = this.states.get(enemyId)?.reason;
    if (reason === 'spawn-tunnel') return { x: 1, y: 0 };
    if (reason === 'spawn-point') return { x: 0, y: 0 };
    return null;
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

  /** Startet ein nicht vorzeitig abbrechbares, geskriptetes Untertauchen bis `endsAt`. */
  startScriptedBurrow(enemyId: string, endsAt: number): boolean {
    const enemy = this.enemyManager.getEnemy(enemyId);
    if (!enemy?.sprite.active || !this.getBurrowConfig(enemy)) return false;
    this.startBurrow(enemy, 'scripted-phase', endsAt);
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
      // Boden erreicht. Die maximale Grabzeit loest nur den begrenzten Sicherheitsversuch aus;
      // ein blockierter Gegner bleibt bis zu einer sicheren Position unter der Erde.
      const reachedFreeGround = state.reason === 'spawn-tunnel'
        && enemy.sprite.x - state.startX >= (this.getBurrowConfig(enemy)?.spawnTunnelMinDistancePx ?? 0)
        && this.isFreeGroundAt(enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius());
      if (reachedFreeGround) {
        this.endBurrow(enemy);
        continue;
      }
      if (now < state.endsAt) continue;

      const radius = enemy.getCollisionRadius();
      if (this.isFreeGroundAt(enemy.sprite.x, enemy.sprite.y, radius)) {
        this.endBurrow(enemy);
        continue;
      }

      // Ein Timeout ist kein Freibrief, den Collider im Hindernis zu reaktivieren. Die Suche ist
      // bewusst klein und selten; zwischen erfolglosen Versuchen bleibt der Gegner unsichtbar und
      // kollisionsfrei, statt sich in die Topologie einzubetten.
      const safePosition = this.findSafeGroundPosition?.(
        enemy.sprite.x,
        enemy.sprite.y,
        radius,
        BURROW_SAFE_SEARCH_RADIUS_CELLS,
      ) ?? null;
      if (!safePosition) {
        this.states.set(enemyId, { ...state, endsAt: now + BURROW_SAFE_RETRY_INTERVAL_MS });
        continue;
      }

      enemy.setPosition(safePosition.x, safePosition.y);
      this.endBurrow(enemy);
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
