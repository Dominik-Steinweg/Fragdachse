import * as Phaser from 'phaser';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyCombatPositioningConfig,
} from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyCombatPositioningSource, EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from './CombatSystem';

/** Prüft, ob an einer Weltposition genug freier, erreichbarer Boden für den Gegner ist. */
export type FreeGroundResolver = (x: number, y: number, radius: number) => boolean;

/**
 * Ausweichwinkel für den Rückzug. Ist der direkte Weg nach hinten verbaut, weicht der Gegner
 * schräg aus, statt sich in die Felswand zu drücken.
 */
const RETREAT_FALLBACK_ANGLES_RAD = [0, 0.6, -0.6, 1.2, -1.2] as const;

/** Wie weit voraus der Rückzugsweg auf freien Boden geprüft wird. */
const RETREAT_PROBE_DISTANCE_PX = 40;

/**
 * Gefechtsabstand für Fernkämpfer: Gegner mit `combatPositioning` laufen weiterhin auf die
 * Spieler zu, bleiben aber auf ihrem Wunschabstand stehen und weichen zurück, wenn ein Spieler
 * näher herankommt. Damit beschießen sie den Spieler aus kurzer Distanz, statt in den Nahkampf
 * zu rennen.
 *
 * Rein konfigurationsgetrieben – jede weitere Gegner-Art bekommt das Verhalten allein über den
 * Config-Block, ohne Codeänderung.
 */
export class CoopDefenseEnemyCombatPositioningSystem implements EnemyCombatPositioningSource {
  private readonly overrides = new Map<string, { vx: number; vy: number }>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly isFreeGroundAt: FreeGroundResolver,
  ) {}

  getMovementOverride(enemyId: string): { vx: number; vy: number } | null {
    return this.overrides.get(enemyId) ?? null;
  }

  hostUpdate(): void {
    this.overrides.clear();

    for (const enemy of this.enemyManager.getAllEnemies()) {
      if (enemy.faction !== 'hostile' || !enemy.sprite.active) continue;
      if (enemy.isBurrowed() || this.enemyManager.isEnemyPanicking(enemy.id)) continue;

      const positioning = getCoopDefenseEnemyConfig(enemy.kind).combatPositioning;
      if (!positioning) continue;

      const target = this.findClosestEngageablePlayer(enemy, positioning);
      if (!target) continue;

      // Zu weit weg: normale Wegfindung übernimmt und schließt die Lücke.
      if (target.distance > positioning.preferredDistancePx + positioning.toleranceP) continue;

      // Innerhalb der Totzone: stehen bleiben und feuern.
      if (target.distance >= positioning.preferredDistancePx - positioning.toleranceP) {
        this.overrides.set(enemy.id, { vx: 0, vy: 0 });
        continue;
      }

      const retreat = this.findRetreatDirection(enemy, target.x, target.y);
      // Steht der Gegner mit dem Rücken zur Wand, bleibt er wenigstens stehen, statt sich
      // weiter an den Spieler heranschieben zu lassen.
      if (!retreat) {
        this.overrides.set(enemy.id, { vx: 0, vy: 0 });
        continue;
      }

      const speed = enemy.getMoveSpeed() * positioning.retreatSpeedFactor;
      this.overrides.set(enemy.id, { vx: retreat.x * speed, vy: retreat.y * speed });
    }
  }

  clear(): void {
    this.overrides.clear();
  }

  private findClosestEngageablePlayer(
    enemy: EnemyEntity,
    positioning: CoopDefenseEnemyCombatPositioningConfig,
  ): { x: number; y: number; distance: number } | null {
    let best: { x: number; y: number; distance: number } | null = null;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.sprite.active || !this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;

      const distance = Phaser.Math.Distance.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        player.sprite.x,
        player.sprite.y,
      );
      if (best && distance >= best.distance) continue;
      if (
        positioning.requireLineOfSight
        && !this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, player.sprite.x, player.sprite.y)
      ) continue;

      best = { x: player.sprite.x, y: player.sprite.y, distance };
    }

    return best;
  }

  /** Richtung weg vom Spieler, notfalls schräg – nur über Boden, auf dem der Gegner Platz hat. */
  private findRetreatDirection(
    enemy: EnemyEntity,
    playerX: number,
    playerY: number,
  ): { x: number; y: number } | null {
    const awayAngle = Phaser.Math.Angle.Between(playerX, playerY, enemy.sprite.x, enemy.sprite.y);
    const radius = enemy.getCollisionRadius();

    for (const offset of RETREAT_FALLBACK_ANGLES_RAD) {
      const angle = awayAngle + offset;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const probeX = enemy.sprite.x + directionX * RETREAT_PROBE_DISTANCE_PX;
      const probeY = enemy.sprite.y + directionY * RETREAT_PROBE_DISTANCE_PX;
      if (this.isFreeGroundAt(probeX, probeY, radius)) return { x: directionX, y: directionY };
    }

    return null;
  }
}
