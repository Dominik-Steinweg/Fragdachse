import { describe, expect, it, vi } from 'vitest';

import { CoopDefenseBossSystem } from '../src/systems/CoopDefenseBossSystem';
import { getBossIntroPreset } from '../src/config/bossIntros';

describe('CoopDefenseBossSystem', () => {
  it('owns boss timing and reports defeat only after a successful spawn disappears', () => {
    let bossActive = false;
    const spawnBoss = vi.fn(() => {
      bossActive = true;
      return true;
    });
    const onBossSpawned = vi.fn();
    const system = new CoopDefenseBossSystem(
      { enemyKind: 'void-hunter', spawnAtMs: 1_000 },
      { hasEnemyKind: (kind: string) => kind === 'void-hunter' && bossActive } as never,
      { hostSpawnBoss: spawnBoss },
      onBossSpawned,
    );

    system.hostUpdate(999, false);
    expect(spawnBoss).not.toHaveBeenCalled();
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(1, false, 42_000);
    expect(spawnBoss).toHaveBeenCalledTimes(1);
    expect(onBossSpawned).toHaveBeenCalledWith(42_000);
    expect(system.isBossDefeated()).toBe(false);

    bossActive = false;
    expect(system.isBossDefeated()).toBe(true);
  });
});

describe('CoopDefenseBossSystem intro', () => {
  function createIntroSystem() {
    let bossActive = false;
    const spawnBossAt = vi.fn(() => {
      bossActive = true;
      return true;
    });
    const spawnBoss = vi.fn(() => true);
    const onBossSpawned = vi.fn();
    const onBossIntroStarted = vi.fn();
    const system = new CoopDefenseBossSystem(
      { enemyKind: 'grave-titan', spawnAtMs: 1_000, intro: { preset: 'graveyard-rise' } },
      { hasEnemyKind: (kind: string) => kind === 'grave-titan' && bossActive } as never,
      {
        hostSpawnBoss: spawnBoss,
        hostResolveBossSpawnPoint: () => ({ x: 120, y: 340 }),
        hostSpawnBossAt: spawnBossAt,
      },
      onBossSpawned,
      onBossIntroStarted,
      () => 0.5,
    );
    return { system, spawnBoss, spawnBossAt, onBossSpawned, onBossIntroStarted, setBossActive: (v: boolean) => { bossActive = v; } };
  }

  it('announces the reserved point first and spawns there only after the authored emerge delay', () => {
    const { system, spawnBoss, spawnBossAt, onBossSpawned, onBossIntroStarted } = createIntroSystem();
    const emergeAtMs = getBossIntroPreset('graveyard-rise').emergeAtMs;

    system.hostUpdate(1_000, false, 50_000);
    expect(onBossIntroStarted).toHaveBeenCalledWith(expect.objectContaining({
      preset: 'graveyard-rise', x: 120, y: 340, startedAtMs: 50_000,
    }));
    expect(spawnBossAt).not.toHaveBeenCalled();
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(emergeAtMs - 1, false, 50_000 + emergeAtMs - 1);
    expect(spawnBossAt).not.toHaveBeenCalled();
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(1, false, 50_000 + emergeAtMs);
    expect(spawnBossAt).toHaveBeenCalledWith('grave-titan', 120, 340, { skipSpawnEffect: true });
    expect(spawnBoss).not.toHaveBeenCalled();
    expect(onBossSpawned).toHaveBeenCalledWith(50_000 + emergeAtMs);
    expect(onBossIntroStarted).toHaveBeenCalledTimes(1);
  });

  it('keeps the intro running until a delayed spawn succeeds and only then allows defeat', () => {
    const { system, spawnBossAt, setBossActive } = createIntroSystem();
    const emergeAtMs = getBossIntroPreset('graveyard-rise').emergeAtMs;
    spawnBossAt.mockImplementationOnce(() => false);

    system.hostUpdate(1_000 + emergeAtMs, false);
    system.hostUpdate(emergeAtMs, false);
    expect(spawnBossAt).toHaveBeenCalledTimes(1);
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(16, false);
    expect(spawnBossAt).toHaveBeenCalledTimes(2);
    setBossActive(false);
    expect(system.isBossDefeated()).toBe(true);
  });

  it('restarts the intro after reset', () => {
    const { system, onBossIntroStarted } = createIntroSystem();
    system.hostUpdate(1_000, false);
    system.reset();
    system.hostUpdate(999, false);
    expect(onBossIntroStarted).toHaveBeenCalledTimes(1);
    system.hostUpdate(1, false);
    expect(onBossIntroStarted).toHaveBeenCalledTimes(2);
  });
});
