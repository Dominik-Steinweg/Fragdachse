import { afterEach, describe, expect, it, vi } from 'vitest';
import { ULTIMATE_CONFIGS, type ArmageddonMeteorConfig } from '../src/loadout/LoadoutConfig';
import { ArmageddonSystem } from '../src/systems/ArmageddonSystem';

const BASE_CONFIG = ULTIMATE_CONFIGS.ARMAGEDDON.armageddon;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ArmageddonSystem', () => {
  it('announces a normal meteor for 1200 ms and resolves its configured fire burst once', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const system = new ArmageddonSystem();
    system.activate('player', BASE_CONFIG, () => ({ x: 500, y: 400 }));

    expect(system.update(1000, 333)).toEqual([]);
    system.update(1000, 1);

    const [warning] = system.getSnapshot();
    expect(warning).toMatchObject({ ownerId: 'player', radius: 96, spawnedAt: 1000, impactAt: 2200 });
    expect(system.update(2199, 0)).toEqual([]);

    const impacts = system.update(2200, 0);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      id: warning.id,
      radius: 96,
      damage: 120,
      damageFalloff: { minDamage: 80 },
      fireChunkBurst: {
        count: 3,
        searchRadius: 96,
        flightMs: 320,
        igniteCenter: true,
        durationMs: 2000,
        burnDurationMs: 2000,
        burnDamagePerTick: 0.5,
      },
    });
    expect(system.getSnapshot()).toEqual([]);
  });

  it('spawns upgraded comet storm meteors regularly at the captured player position', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let playerPosition = { x: 620, y: 480 };
    const config: ArmageddonMeteorConfig = {
      ...BASE_CONFIG,
      meteorsPerSecond: 3.9,
      meteorDamageRadius: 139.2,
      meteorDamage: 156,
      meteorDamageFalloff: { minDamage: 104 },
      fireChunkBurst: { ...BASE_CONFIG.fireChunkBurst, count: 12 },
      cometStormEnabled: 1,
      cometSpawnRateDivisor: 3,
      cometFallDurationFactor: 0.25,
      cometRadiusFactor: 2,
      cometDamageFactor: 3,
      cometChunkCountFactor: 3,
    };
    const system = new ArmageddonSystem();
    system.activate('player', config, () => playerPosition);

    expect(system.update(100, 769)).toEqual([]);
    system.update(100, 1);
    const [warning] = system.getSnapshot();
    expect(warning).toMatchObject({ x: 620, y: 480, radius: 278, spawnedAt: 100, impactAt: 400 });

    playerPosition = { x: 800, y: 700 };
    expect(system.getSnapshot()[0]).toMatchObject({ x: 620, y: 480 });

    const [impact] = system.update(400, 0);
    expect(impact).toMatchObject({
      x: 620,
      y: 480,
      radius: 278,
      damage: 468,
      damageFalloff: { minDamage: 312 },
      fireChunkBurst: { count: 36 },
    });
  });
});
