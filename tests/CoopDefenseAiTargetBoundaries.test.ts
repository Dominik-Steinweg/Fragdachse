import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Linear: (from: number, to: number, t: number) => from + (to - from) * t,
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      Squared: (x1: number, y1: number, x2: number, y2: number) => (x2 - x1) ** 2 + (y2 - y1) ** 2,
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import { CoopDefenseEnemyAbilitySystem } from '../src/systems/CoopDefenseEnemyAbilitySystem';
import { CoopDefenseVoidHunterSystem } from '../src/systems/CoopDefenseVoidHunterSystem';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../src/loadout/LoadoutConfig';

describe('targeted AI versus untargeted effects', () => {
  it('keeps a stealthed real player in the hostile Tesla dome AoE path', () => {
    const applyDamage = vi.fn();
    const system = Object.create(CoopDefenseEnemyAbilitySystem.prototype) as CoopDefenseEnemyAbilitySystem;
    Object.assign(system as unknown as Record<string, unknown>, {
      lastMiniDomeTickAt: new Map([['enemy-1', 0]]),
      playerManager: {
        getAllPlayers: () => [fakeEntity({ id: 'player-1', x: 20, y: 0, active: true })],
      },
      combatSystem: {
        isAlive: () => true,
        isBurrowed: () => false,
        canDamageTarget: () => true,
        hasClearLineOfFire: () => true,
        applyDamage,
      },
      energyShieldSystem: null,
      targetCatalog: new EnemyAiTargetCatalog(),
    });

    const enemy = fakeEntity({ id: 'enemy-1',
      faction: 'hostile', x: 0, y: 0, active: true }) as unknown as EnemyEntity;
    const weapon = { id: 'MINI_TESLA_DOME' } as WeaponConfig;
    const fire = {
      type: 'tesla_dome',
      radius: 100,
      damagePerTick: 7,
      tickInterval: 100,
      requireLineOfSight: false,
    } as TeslaDomeWeaponFireConfig;

    (system as unknown as {
      updateMiniDome: (enemy: EnemyEntity, weapon: WeaponConfig, fire: TeslaDomeWeaponFireConfig, now: number) => void;
    }).updateMiniDome(enemy, weapon, fire, 100);

    expect(applyDamage).toHaveBeenCalledWith(
      'player-1',
      7,
      false,
      'enemy-1',
      'MINI_TESLA_DOME',
      { sourceX: 0, sourceY: 0 },
    );
  });

  it('computes the Void Hunter nuke center from real players, excluding catalog decoys', () => {
    const config = getCoopDefenseEnemyConfig('void-hunter');
    const enemy = fakeEntity({ id: 'void-1',
      kind: 'void-hunter',
      faction: 'hostile', x: 0, y: 0, active: true, getHp: () => config.maxHp * config.voidHunterBoss!.phaseTwoHpRatio * 0.5,
      getMaxHp: () => config.maxHp,
      setMoveSpeedMultiplier: vi.fn(),
      setSpecialAction: vi.fn(),
      stopMovement: vi.fn() }) as unknown as EnemyEntity;
    const scheduleNuke = vi.fn();
    const targetCatalog = new EnemyAiTargetCatalog();
    targetCatalog.updateTargets([{
      kind: 'decoy',
      id: '9',
      x: 900,
      y: 900,
      isTargetable: () => true,
    }]);
    const playerManager = {
      getAllPlayers: () => [
        fakeEntity({ id: 'player-1', x: 300, y: 200, active: true }),
        fakeEntity({ id: 'player-2', x: 400, y: 200, active: true }),
      ],
    };

    const system = new CoopDefenseVoidHunterSystem(
      { getAllEnemies: () => [enemy], getEnemy: () => enemy } as never,
      playerManager as never,
      { isAlive: () => true } as never,
      {} as never,
      { scheduleConfiguredNukeStrike: scheduleNuke } as never,
      {} as never,
      { startScriptedBurrow: vi.fn() } as never,
      {} as never,
      targetCatalog,
    );

    system.hostUpdate(0);

    expect(scheduleNuke).toHaveBeenCalled();
    expect(scheduleNuke.mock.calls[0]?.[1]).toBe(350);
    expect(scheduleNuke.mock.calls[0]?.[2]).toBe(200);
  });
});
