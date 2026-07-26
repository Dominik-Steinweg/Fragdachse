import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      Squared: (x1: number, y1: number, x2: number, y2: number) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return dx * dx + dy * dy;
      },
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { StinkCloudSystem } from '../src/effects/StinkCloudSystem';
import type { FireSystem } from '../src/effects/FireSystem';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { VOID_FIRE_COLOR } from '../src/config';
import type { CombatSystem } from '../src/systems/CombatSystem';
import { CoopDefenseEnemyAbilitySystem } from '../src/systems/CoopDefenseEnemyAbilitySystem';
import type { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';

describe('Inferno Colossus void fire chunks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws twenty player-only purple chunks at an irregular interval around five seconds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const enemy = {
      id: 'boss-1',
      kind: 'inferno-colossus',
      faction: 'hostile',
      sprite: { active: true, x: 520, y: 360 },
      getHp: () => 1_200,
      getCollisionRadius: () => 34,
      isBurrowed: () => false,
    } as unknown as EnemyEntity;
    const enemyManager = {
      getAllEnemies: () => [enemy],
    } as unknown as EnemyManager;
    const hostCreateFireChunkBurst = vi.fn();
    const flamethrowerUpgradeSystem = {
      hostCreateFireChunkBurst,
    } as unknown as FlamethrowerUpgradeSystem;
    const hostRefreshGroundCellsAlongSweptCircle = vi.fn();
    const fireSystem = {
      hostRefreshGroundCellsAlongSweptCircle,
    } as unknown as FireSystem;

    const system = new CoopDefenseEnemyAbilitySystem(
      enemyManager,
      {} as PlayerManager,
      {} as ProjectileManager,
      {} as CombatSystem,
      null as EnergyShieldSystem | null,
      {} as StinkCloudSystem,
      flamethrowerUpgradeSystem,
      fireSystem,
    );

    system.hostUpdate(1_000);
    expect(hostRefreshGroundCellsAlongSweptCircle).toHaveBeenLastCalledWith(
      520,
      360,
      520,
      360,
      34,
      expect.objectContaining({
        sourceKey: 'void-fire-trail:boss-1',
        ownerId: 'boss-1',
        durationMs: 6_000,
        visualStyle: 'void',
        damageTarget: 'players',
      }),
      1_000,
    );
    system.hostUpdate(5_999);
    expect(hostCreateFireChunkBurst).not.toHaveBeenCalled();

    system.hostUpdate(6_000);
    expect(hostCreateFireChunkBurst).toHaveBeenCalledTimes(1);
    expect(hostCreateFireChunkBurst).toHaveBeenCalledWith(
      'boss-1',
      520,
      360,
      expect.objectContaining({
        count: 20,
        searchRadius: 160,
        durationMs: 6_000,
        visualStyle: 'void',
        damageTarget: 'players',
      }),
      'void-fire-chunks:boss-1:6000',
      6_000,
    );

    system.hostUpdate(11_000);
    expect(hostCreateFireChunkBurst).toHaveBeenCalledTimes(2);
  });

  it('uses a boss-only purple flamethrower with a slightly larger range', () => {
    const bossConfig = getCoopDefenseEnemyConfig('inferno-colossus');
    expect(bossConfig.weapons[0]?.weaponId).toBe('INFERNO_COLOSSUS_FLAMETHROWER');
    expect(WEAPON_CONFIGS.INFERNO_COLOSSUS_FLAMETHROWER).toMatchObject({
      range: 300,
      projectileColor: VOID_FIRE_COLOR,
      projectileBurnVisualStyle: 'void',
      allowedSlots: [],
      fire: { type: 'flamethrower' },
    });
    expect(WEAPON_CONFIGS.INFERNO_COLOSSUS_FLAMETHROWER.range)
      .toBeGreaterThan(WEAPON_CONFIGS.FLAMETHROWER.range);
  });
});
