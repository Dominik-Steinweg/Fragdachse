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

describe.each([
  { preset: 'graveyard-rise' as const, enemyKind: 'grave-titan' as const },
  { preset: 'void-sparks' as const, enemyKind: 'void-hunter' as const },
])('CoopDefenseBossSystem intro $preset', ({ preset, enemyKind }) => {
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
      { enemyKind, spawnAtMs: 1_000, intro: { preset } },
      { hasEnemyKind: (kind: string) => kind === enemyKind && bossActive } as never,
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
    const emergeAtMs = getBossIntroPreset(preset).emergeAtMs;

    system.hostUpdate(1_000, false, 50_000);
    expect(onBossIntroStarted).toHaveBeenCalledWith(expect.objectContaining({
      preset, x: 120, y: 340, startedAtMs: 50_000,
    }));
    expect(spawnBossAt).not.toHaveBeenCalled();
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(emergeAtMs - 1, false, 50_000 + emergeAtMs - 1);
    expect(spawnBossAt).not.toHaveBeenCalled();
    expect(system.isBossDefeated()).toBe(false);

    system.hostUpdate(1, false, 50_000 + emergeAtMs);
    expect(spawnBossAt).toHaveBeenCalledWith(enemyKind, 120, 340, { skipSpawnEffect: true });
    expect(spawnBoss).not.toHaveBeenCalled();
    expect(onBossSpawned).toHaveBeenCalledWith(50_000 + emergeAtMs);
    expect(onBossIntroStarted).toHaveBeenCalledTimes(1);
  });

  it('keeps the intro running until a delayed spawn succeeds and only then allows defeat', () => {
    const { system, spawnBossAt, setBossActive } = createIntroSystem();
    const emergeAtMs = getBossIntroPreset(preset).emergeAtMs;
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

describe('CoopDefenseBossSystem start condition', () => {
  it('waits for the authored start condition and reports time since the actual spawn', () => {
    let waveCleared = false;
    let bossActive = false;
    const spawnBoss = vi.fn(() => {
      bossActive = true;
      return true;
    });
    const system = new CoopDefenseBossSystem(
      { enemyKind: 'grave-titan', spawnAtMs: 0, startAfterEncounterId: 'wave-1' },
      { hasEnemyKind: () => bossActive } as never,
      { hostSpawnBoss: spawnBoss },
      undefined,
      undefined,
      () => 0.5,
      () => waveCleared,
    );

    system.hostUpdate(30_000, false);
    expect(spawnBoss).not.toHaveBeenCalled();
    expect(system.getMsSinceSpawn()).toBeNull();

    waveCleared = true;
    system.hostUpdate(16, false);
    expect(spawnBoss).toHaveBeenCalledTimes(1);
    expect(system.getMsSinceSpawn()).toBe(0);

    system.hostUpdate(7_500, false);
    expect(system.getMsSinceSpawn()).toBe(7_500);
  });
});
