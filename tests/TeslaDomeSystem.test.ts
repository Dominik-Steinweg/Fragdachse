import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../src/loadout/LoadoutConfig';
import { TeslaDomeSystem } from '../src/systems/TeslaDomeSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { ResourceSystem } from '../src/systems/ResourceSystem';
import type { TeslaDomeTargetType } from '../src/types';

interface TestBase {
  id: string;
  faction: 'friendly' | 'hostile';
  getHp: () => number;
  getNearestSurfacePoint: (x: number, y: number) => { x: number; y: number; distance: number } | null;
}

function makeBase(
  id: string,
  faction: TestBase['faction'],
  hp: number,
  surface: { x: number; y: number; distance: number } | null,
): TestBase {
  return {
    id,
    faction,
    getHp: vi.fn(() => hp),
    getNearestSurfacePoint: vi.fn(() => surface),
  };
}

function makeConfig(targetTypes: readonly TeslaDomeTargetType[]): WeaponConfig & { fire: TeslaDomeWeaponFireConfig } {
  return {
    ...WEAPON_CONFIGS.TESLA_DOME,
    fire: {
      ...WEAPON_CONFIGS.TESLA_DOME.fire,
      adrenalineDrainPerSecond: 0,
      targetTypes,
    },
  } as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
}

function makeSystem(bases: readonly TestBase[]) {
  const owner = { id: 'player-1', sprite: { x: 0, y: 0, active: true } };
  const enemies: { id: string; x: number; y: number }[] = [];
  const damageHandler = vi.fn();
  const lineOfSight = vi.fn(() => true);
  const playerManager = {
    getPlayer: vi.fn(() => owner),
    getAllPlayers: vi.fn(() => [owner]),
  } as unknown as PlayerManager;
  const combatSystem = {
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    canDamageTarget: vi.fn(() => true),
    applyDamage: vi.fn(),
  } as unknown as CombatSystem;
  const resourceSystem = {
    getAdrenaline: vi.fn(() => 100),
    drainAdrenaline: vi.fn(),
  } as unknown as ResourceSystem;

  const system = new TeslaDomeSystem(playerManager, combatSystem, resourceSystem);
  system.setLineOfSightChecker(lineOfSight);
  system.setBaseCallbacks(() => bases, damageHandler);
  system.setEnemyTargetProvider(() => enemies);

  return { system, damageHandler, lineOfSight, owner, enemies, combatSystem };
}

describe('Tesla dome base targets', () => {
  it('damages an active hostile base through the ordinary Tesla tick path', () => {
    const base = makeBase('hostile-base', 'hostile', 100, { x: 120, y: 0, distance: 120 });
    const config = makeConfig(['bases']);
    const { system, damageHandler, lineOfSight } = makeSystem([base]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).toHaveBeenCalledWith(
      'hostile-base',
      config.fire.damagePerTick,
      'player-1',
      'weapon2',
    );
    expect(synced[0]?.targets).toContainEqual({ x: 120, y: 0, type: 'bases' });
    expect(base.getNearestSurfacePoint).toHaveBeenCalledWith(0, 0);
    expect(lineOfSight).toHaveBeenCalledWith(0, 0, 120, 0, undefined);
  });

  it('never targets friendly or destroyed bases', () => {
    const friendly = makeBase('friendly-base', 'friendly', 100, { x: 40, y: 0, distance: 40 });
    const destroyed = makeBase('destroyed-base', 'hostile', 0, { x: 50, y: 0, distance: 50 });
    const config = makeConfig(['bases']);
    const { system, damageHandler } = makeSystem([friendly, destroyed]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).not.toHaveBeenCalled();
    expect(synced[0]?.targets).toEqual([]);
    expect(friendly.getNearestSurfacePoint).not.toHaveBeenCalled();
    expect(destroyed.getNearestSurfacePoint).not.toHaveBeenCalled();
  });

  it('uses the nearest surface point for a large base instead of its center', () => {
    // Der gedachte Mittelpunkt liegt außerhalb des Tesla-Radius; die nächstgelegene
    // Oberfläche liegt innerhalb und muss deshalb als Zielpunkt verwendet werden.
    const base = makeBase('large-hostile-base', 'hostile', 100, { x: 180, y: 0, distance: 180 });
    const config = makeConfig(['bases']);
    const { system, damageHandler, lineOfSight } = makeSystem([base]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).toHaveBeenCalledTimes(1);
    expect(synced[0]?.targets).toContainEqual({ x: 180, y: 0, type: 'bases' });
    expect(lineOfSight).toHaveBeenCalledWith(0, 0, 180, 0, undefined);
  });
});

describe('Tesla turret construction', () => {
  it('stays dormant without enemies and activates with the shared Tesla dome visual contract', () => {
    const config = makeConfig(['enemies']);
    const { system, enemies, combatSystem } = makeSystem([]);
    const source = {
      id: 7,
      ownerId: 'player-1',
      x: 100,
      y: 100,
      color: 0x9ae7ff,
      damageMultiplier: 1.5,
      config,
    };
    system.setConstructionSourceProvider(() => [source]);

    expect(system.hostUpdate(0)).toEqual([]);

    enemies.push({ id: 'enemy-1', x: 150, y: 100 });
    const activated = system.hostUpdate(0);
    expect(activated[0]).toMatchObject({
      ownerId: 'tesla-turret:7',
      weaponId: config.id,
      radius: config.fire.radius,
      targets: [{ x: 150, y: 100, type: 'enemies' }],
    });

    system.hostUpdate(config.fire.tickInterval);
    expect(combatSystem.applyDamage).toHaveBeenCalledWith(
      'enemy-1',
      config.fire.damagePerTick * 1.5,
      false,
      'player-1',
      'TESLA_DOME',
      { sourceX: 100, sourceY: 100 },
      { damageKind: 'chain', sourceSlot: 'utility', allowCritical: true },
    );
  });
});
