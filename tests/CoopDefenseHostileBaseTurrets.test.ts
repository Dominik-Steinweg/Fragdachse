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
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import {
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
  type PlaceableTurretUtilityConfig,
} from '../src/loadout/LoadoutConfig';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import { CombatSystem } from '../src/systems/CombatSystem';
import { TurretSystem } from '../src/systems/TurretSystem';

describe('hostile base turrets', () => {
  it('targets a living player instead of a closer zombie and fires BASE_SPOREN', () => {
    const playerManager = {
      getAllPlayers: () => [{
        id: 'player-a',
        sprite: { x: 100, y: 0, active: true },
      }],
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
      weaponId: 'BASE_SPOREN',
      targetMode: 'players',
    }], null);
    turrets.setFireHandler(fire);

    turrets.hostUpdate(
      0,
      UTILITY_CONFIGS.FLIEGENPILZ as PlaceableTurretUtilityConfig,
      WEAPON_CONFIGS.BASE_SPOREN,
    );

    expect(fire).toHaveBeenCalledOnce();
    expect(fire.mock.calls[0][0]).toBe(COOP_DEFENSE_HOSTILE_BASE_TURRET_OWNER_ID);
    expect(fire.mock.calls[0][1]).toBe(TEAM_RED_COLOR);
    expect(fire.mock.calls[0][2]).toBe('BASE_SPOREN');
    expect(fire.mock.calls[0][6]).toBe(100);
    expect(fire.mock.calls[0][7]).toBe(0);
  });

  it('treats hostile base spores as zombie-faction damage', () => {
    const combat = new CombatSystem(
      {} as PlayerManager,
      {} as ProjectileManager,
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
