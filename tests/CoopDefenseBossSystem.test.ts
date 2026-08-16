import { describe, expect, it, vi } from 'vitest';

import { CoopDefenseBossSystem } from '../src/systems/CoopDefenseBossSystem';

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
