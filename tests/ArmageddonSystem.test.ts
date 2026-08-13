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

    const firstSpawnDelta = Math.ceil(1000 / BASE_CONFIG.meteorsPerSecond);
    expect(system.update(1000, Math.max(0, firstSpawnDelta - 1))).toEqual([]);
    system.update(1000, 1);

    const [warning] = system.getSnapshot();
    expect(warning).toMatchObject({
      ownerId: 'player',
      radius: BASE_CONFIG.meteorDamageRadius,
      spawnedAt: 1000,
      impactAt: 1000 + Math.max(1, Math.round(BASE_CONFIG.meteorFallDuration)),
      variant: 'normal',
    });
    const impactAt = 1000 + Math.max(1, Math.round(BASE_CONFIG.meteorFallDuration));
    expect(system.update(impactAt - 1, 0)).toEqual([]);

    const impacts = system.update(impactAt, 0);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({
      id: warning.id,
      radius: BASE_CONFIG.meteorDamageRadius,
      damage: BASE_CONFIG.meteorDamage,
      damageFalloff: BASE_CONFIG.meteorDamageFalloff,
      fireChunkBurst: BASE_CONFIG.fireChunkBurst,
    });
    expect(system.getSnapshot()).toEqual([]);
  });

  it('keeps the Void variant on warning and impact snapshots', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const system = new ArmageddonSystem();
    system.activate('void-boss', { ...BASE_CONFIG, variant: 'void' }, () => ({ x: 500, y: 400 }));
    system.update(1000, Math.ceil(1000 / BASE_CONFIG.meteorsPerSecond));
    expect(system.getSnapshot()[0].variant).toBe('void');
    expect(system.update(
      1000 + Math.max(1, Math.round(BASE_CONFIG.meteorFallDuration)),
      0,
    )[0].variant).toBe('void');
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

    const firstSpawnDelta = Math.ceil(1000 / (config.meteorsPerSecond / config.cometSpawnRateDivisor));
    expect(system.update(100, Math.max(0, firstSpawnDelta - 1))).toEqual([]);
    system.update(100, 1);
    const [warning] = system.getSnapshot();
    const expectedRadius = Math.round(config.meteorDamageRadius * config.cometRadiusFactor);
    const expectedImpactAt = 100 + Math.max(
      1,
      Math.round(config.meteorFallDuration * config.cometFallDurationFactor),
    );
    expect(warning).toMatchObject({
      x: 620,
      y: 480,
      radius: expectedRadius,
      spawnedAt: 100,
      impactAt: expectedImpactAt,
    });

    playerPosition = { x: 800, y: 700 };
    expect(system.getSnapshot()[0]).toMatchObject({ x: 620, y: 480 });

    const [impact] = system.update(expectedImpactAt, 0);
    expect(impact).toMatchObject({
      x: 620,
      y: 480,
      radius: expectedRadius,
      damage: config.meteorDamage * config.cometDamageFactor,
      damageFalloff: {
        minDamage: config.meteorDamageFalloff!.minDamage * config.cometDamageFactor,
      },
      fireChunkBurst: {
        count: Math.floor(config.fireChunkBurst.count * config.cometChunkCountFactor),
      },
    });
  });
});
