import { describe, expect, it, vi } from 'vitest';

// Phaser braucht ein DOM; für die reine Zielauswahl reichen die beiden Geometrie-Helfer.
vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import { CoopDefenseEnemyAttackSystem } from '../src/systems/CoopDefenseEnemyAttackSystem';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { LoadoutManager } from '../src/loadout/LoadoutManager';
import type { CombatSystem } from '../src/systems/CombatSystem';

// Kennwerte des Pyro-Dachses aus der Gegner-Registry.
const OBSTACLE_ATTACK_DELAY_MS = 500;
const ATTACK_SCAN_INTERVAL_MS = 140;
const ATTACK_STOP_DURATION_MS = 120;

/**
 * Gegner, der genau die Situation aus dem Bug abbildet: er steht fest (Position ändert sich nie),
 * feuert aber im Takt seiner Fernwaffe weiter. Vor dem Fix hat jede Angriffspause den
 * Blockier-Zähler zurückgesetzt, sodass der Biss auf den Felsen nie freigeschaltet wurde.
 */
function createStuckEnemy(movement: { wantsToMove: boolean; pathBlocked: boolean }): EnemyEntity & {
  attackPauseUntil: number;
} {
  const bite = new GenericWeapon(WEAPON_CONFIGS.PYRO_BADGER_BITE);
  const glock = new GenericWeapon(WEAPON_CONFIGS.PYRO_BADGER_GLOCK);

  return {
    id: 'e1',
    kind: 'pyro-badger',
    faction: 'hostile',
    attackPauseUntil: 0,
    nextScanAt: 0,
    sprite: { x: 100, y: 100, active: true },
    wantsToMove: () => movement.wantsToMove,
    isPathBlocked: () => movement.pathBlocked,
    getAttackWeapons: () => [
      { weapon: bite, targetMode: 'structures', minimumFireDurationMs: 0, playerMeleeWindupMs: 0 },
      { weapon: glock, targetMode: 'players', minimumFireDurationMs: 0, playerMeleeWindupMs: 0 },
    ],
    getObstacleAttackDelayMs: () => OBSTACLE_ATTACK_DELAY_MS,
    isBurrowed: () => false,
    decayWeaponSpread: () => {},
    rollWeaponSpreadOffset: () => 0,
    faceAngle: () => {},
    stopMovement: () => {},
    getCollisionRadius: () => 15,
    // Ab hier identisch zur echten EnemyEntity – Waffen-Cooldown, Scan-Takt und Angriffspause
    // bestimmen zusammen, wie viel Zeit dem Gegner zum Laufen bleibt.
    canScanForAttack(now: number) { return now >= this.nextScanAt; },
    scheduleNextAttackScan(now: number) { this.nextScanAt = now + ATTACK_SCAN_INTERVAL_MS; },
    isWeaponReady: (weapon: GenericWeapon, now: number) => !weapon.isOnCooldown(now),
    recordWeaponUse: (weapon: GenericWeapon, now: number) => { weapon.recordUse(now); weapon.addSpread(); },
    isAttackMovementPaused(now: number) { return now < this.attackPauseUntil; },
    pauseAttackMovement(now: number) { this.attackPauseUntil = now + ATTACK_STOP_DURATION_MS; },
  } as unknown as EnemyEntity & { attackPauseUntil: number };
}

function createSystem(enemy: EnemyEntity, rock: { x: number; y: number; active: boolean }) {
  const firedWeaponIds: string[] = [];
  // Spieler in Glock-, aber weit außerhalb von Bissreichweite: der festhängende Gegner feuert
  // dadurch die ganze Zeit weiter und pausiert seine Bewegung nach jedem Schuss.
  const player = { id: 'p1', sprite: { x: 400, y: 100, active: true } };

  const enemyManager = {
    getAllEnemies: () => [enemy],
    getAlliedEnemies: () => [],
    getEnemy: () => undefined,
    hasEnemy: (id: string) => id === enemy.id,
    isEnemyPanicking: () => false,
  } as unknown as EnemyManager;

  const system = new CoopDefenseEnemyAttackSystem(
    enemyManager,
    {
      getAllPlayers: () => [player],
      getPlayer: (id: string) => (id === player.id ? player : undefined),
    } as unknown as PlayerManager,
    { getBases: () => [] } as unknown as BaseManager,
    {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
    } as unknown as CombatSystem,
    {
      fireAutomatedWeapon: (config: { id: string }) => {
        firedWeaponIds.push(config.id);
        return true;
      },
    } as unknown as LoadoutManager,
    () => [rock as unknown as Phaser.GameObjects.Image],
  );

  return { system, firedWeaponIds };
}

describe('Enemy stuck in a rock', () => {
  it('bites the rock once it has been unable to move for the obstacle delay', () => {
    // Genau die Klemme aus dem Bug: die Wegfindung findet keine Route (Mittelpunkt in einer
    // Felszelle), deshalb wird die Wunschgeschwindigkeit auf 0 gesetzt – der Gegner steht still.
    const enemy = createStuckEnemy({ wantsToMove: false, pathBlocked: true });
    // Fels direkt vor der Nase – innerhalb der kurzen Reichweite des Pyro-Dachsbisses.
    const rock = { x: 128, y: 100, active: true };
    const { system, firedWeaponIds } = createSystem(enemy, rock);

    // Zwei Sekunden in 16-ms-Frames: der Gegner bewegt sich keinen Pixel, schießt aber weiter.
    for (let frame = 0; frame < 125; frame++) {
      system.hostUpdate(16, 1_000 + frame * 16);
    }

    expect(firedWeaponIds).toContain('PYRO_BADGER_GLOCK');
    expect(firedWeaponIds).toContain('PYRO_BADGER_BITE');
  });

  it('leaves rocks alone while the enemy is still making progress', () => {
    const enemy = createStuckEnemy({ wantsToMove: true, pathBlocked: false });
    const rock = { x: 128, y: 100, active: true };
    const { system, firedWeaponIds } = createSystem(enemy, rock);

    for (let frame = 0; frame < 125; frame++) {
      // Der Gegner kommt voran – der Blockier-Zähler darf nie die Freigabe erreichen.
      (enemy.sprite as { x: number }).x += 5;
      rock.x += 5;
      system.hostUpdate(16, 1_000 + frame * 16);
    }

    expect(firedWeaponIds).not.toContain('PYRO_BADGER_BITE');
  });
});
