import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Geom: {
    Circle: class {},
    Line: class {},
    Rectangle: class {
      setTo(): this { return this; }
    },
  },
  Math: {
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import {
  COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
  TEAM_RED_COLOR,
} from '../src/config';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectilePhysicsBinding } from '../src/projectile/ProjectilePhysicsBinding';
import {
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  type PlaceableTurretUtilityConfig,
} from '../src/loadout/LoadoutConfig';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import { CombatSystem } from '../src/systems/CombatSystem';
import { TurretSystem } from '../src/systems/TurretSystem';

describe('hostile base turrets', () => {
  it('multiplies both automated projectile variants with the selected construct bonus', () => {
    const playerManager = {
      getAllPlayers: () => [
        fakeEntity({ id: 'owner', x: 0, y: 0, active: true }),
        fakeEntity({ id: 'target', x: 100, y: 0, active: true }),
        fakeEntity({ id: 'target-2', x: 120, y: 0, active: true }),
      ],
    } as unknown as PlayerManager;
    const combatSystem = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    } as unknown as CombatSystem;
    const fire = vi.fn();
    const turrets = new TurretSystem(playerManager, combatSystem);
    const source = {
      id: 7,
      x: 0,
      y: 0,
      ownerId: 'owner',
      ownerColor: 0xffffff,
      weaponId: 'SPORES' as const,
      secondProjectileDamageFactor: 0.5,
    };
    turrets.setTurretProvider(() => [source], null);
    turrets.setTurretDamageMultiplierProvider(() => 1.25);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.SPORES,
    );

    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire.mock.calls[0][8]).toBeCloseTo(1.25, 10);
    expect(fire.mock.calls[1][8]).toBeCloseTo(0.625, 10);
  });

    it('targets a living player instead of a closer zombie and fires BASE_SPORES', () => {
    const playerManager = {
      getAllPlayers: () => [fakeEntity({ id: 'player-a', x: 100, y: 0, active: true })],
    } as unknown as PlayerManager;
    const combatSystem = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    } as unknown as CombatSystem;
    const fire = vi.fn();
    const turrets = new TurretSystem(playerManager, combatSystem);
    turrets.setEnemyTargetProvider(() => [{ id: 'zombie-a', x: 20, y: 0 }]);
    turrets.setTurretProvider(() => [{
      id: 'hostile-base:rear-top',
      x: 0,
      y: 0,
      ownerId: COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
      ownerColor: TEAM_RED_COLOR,
      weaponId: 'BASE_SPORES',
      targetMode: 'players',
    }], null);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.BASE_SPORES,
    );

    expect(fire).toHaveBeenCalledOnce();
    expect(fire.mock.calls[0][0]).toBe(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID);
    expect(fire.mock.calls[0][1]).toBe(TEAM_RED_COLOR);
    expect(fire.mock.calls[0][2]).toBe('BASE_SPORES');
    expect(fire.mock.calls[0][6]).toBe(100);
    expect(fire.mock.calls[0][7]).toBe(0);
  });

  it('marks base-mounted turrets as exempt from base line-of-fire blockers', () => {
    const playerManager = {
      getAllPlayers: () => [fakeEntity({ id: 'player-a', x: 100, y: 0, active: true })],
    } as unknown as PlayerManager;
    const combatSystem = {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
    } as unknown as CombatSystem;
    const lineOfFire = vi.fn(() => true);
    const turrets = new TurretSystem(playerManager, combatSystem);
    turrets.setLineOfFireChecker(lineOfFire);
    turrets.setTurretProvider(() => [{
      id: 'hostile-base:rear-top',
      x: 0,
      y: 0,
      ownerId: COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID,
      ownerColor: TEAM_RED_COLOR,
      weaponId: 'BASE_SPORES',
      targetMode: 'players',
      ignoreBaseObstacles: true,
    }], null);

    turrets.hostUpdate(
      0,
      UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.BASE_SPORES,
    );

    expect(lineOfFire).toHaveBeenCalledOnce();
    expect(lineOfFire.mock.calls[0][5]).toBe(true);
  });

  it('treats hostile base spores as zombie-faction damage', () => {
    const combat = new CombatSystem(
      {} as PlayerManager,
      {} as ProjectilePhysicsBinding,
      { areTeammates: () => true } as unknown as NetworkBridge,
    );
    const enemies = new Map([
      ['hostile-zombie', { faction: 'hostile', isBurrowed: () => false }],
      ['revived-zombie', { faction: 'allied', isBurrowed: () => false }],
    ]);
    combat.setEnemyManager({
      getEnemy: (id: string) => enemies.get(id),
    } as unknown as EnemyManager);

    expect(combat.canDamageTarget(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, 'player-a')).toBe(true);
    expect(combat.canDamageTarget(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, 'hostile-zombie')).toBe(false);
    expect(combat.canDamageTarget(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID, 'revived-zombie')).toBe(true);
  });
});
