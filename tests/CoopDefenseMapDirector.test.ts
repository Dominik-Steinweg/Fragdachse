import { describe, expect, it, vi } from 'vitest';
import { CoopDefenseMapDirector } from '../src/systems/CoopDefenseMapDirector';

describe('CoopDefenseMapDirector', () => {
  const encounters = [
    {
      id: 'opening',
      startAtMs: 1_000,
      restAfterMs: 0,
      groups: [
        { enemyKind: 'zombie-badger', count: 3, delayMs: 0 },
        { enemyKind: 'demon-badger', count: 2, delayMs: 500 },
      ],
    },
  ] as const;

  it('does not count down time as encounter time and starts exactly once', () => {
    const spawnGroup = vi.fn();
    const director = new CoopDefenseMapDirector(encounters, spawnGroup);

    director.hostUpdate(1_000, true);
    expect(spawnGroup).not.toHaveBeenCalled();
    expect(director.getElapsedMs()).toBe(0);

    director.hostUpdate(999, false);
    expect(spawnGroup).not.toHaveBeenCalled();
    director.hostUpdate(1, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    director.hostUpdate(10_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(2);
  });

  it('fires delayed groups at relative times and does not lose groups on large deltas', () => {
    const spawnGroup = vi.fn();
    const director = new CoopDefenseMapDirector(encounters, spawnGroup);

    director.hostUpdate(999, false);
    expect(spawnGroup).not.toHaveBeenCalled();
    director.hostUpdate(1, false);
    expect(spawnGroup).toHaveBeenCalledWith('zombie-badger', 3);
    director.hostUpdate(499, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    director.hostUpdate(1, false);
    expect(spawnGroup).toHaveBeenCalledWith('demon-badger', 2);

    const largeDeltaSpawn = vi.fn();
    const largeDeltaDirector = new CoopDefenseMapDirector(encounters, largeDeltaSpawn);
    largeDeltaDirector.hostUpdate(2_000, false);
    expect(largeDeltaSpawn).toHaveBeenCalledTimes(2);
  });

  it('resets all encounter execution state', () => {
    const spawnGroup = vi.fn();
    const director = new CoopDefenseMapDirector(encounters, spawnGroup);

    director.hostUpdate(2_000, false);
    expect(director.isEncounterSpawnComplete('opening')).toBe(true);
    director.reset();
    expect(director.getElapsedMs()).toBe(0);
    expect(director.hasStartedEncounter('opening')).toBe(false);

    director.hostUpdate(1_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(3);
  });

  it('runs repel-assault as first-clear-rest-next and tracks only encounter enemies', () => {
    const activeEnemyIds = new Set<string>();
    let nextEnemyId = 1;
    const spawnGroup = vi.fn((_kind: string, count: number) => {
      const ids = Array.from({ length: count }, () => `encounter-${nextEnemyId++}`);
      for (const id of ids) activeEnemyIds.add(id);
      return ids;
    });
    const director = new CoopDefenseMapDirector([
      {
        id: 'opening',
        startAtMs: 0,
        restAfterMs: 5_000,
        groups: [{ enemyKind: 'zombie-badger', count: 2, delayMs: 0 }],
      },
      {
        id: 'final',
        startAtMs: 99_000,
        restAfterMs: 0,
        groups: [{ enemyKind: 'demon-badger', count: 1, delayMs: 0 }],
      },
    ], spawnGroup, {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
    });

    activeEnemyIds.add('independent-enemy');
    director.hostUpdate(0, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    expect(director.isEncounterSpawnComplete('opening')).toBe(true);
    expect(director.isEncounterCleared('opening')).toBe(false);
    expect(director.getActiveEncounterId()).toBe('opening');

    director.hostUpdate(10_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);

    for (const enemyId of [...activeEnemyIds]) {
      if (enemyId !== 'independent-enemy') activeEnemyIds.delete(enemyId);
    }
    director.hostUpdate(0, false);
    expect(director.isEncounterCleared('opening')).toBe(true);
    expect(director.getRestRemainingMs()).toBe(5_000);
    expect(spawnGroup).toHaveBeenCalledTimes(1);

    director.hostUpdate(4_999, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    director.hostUpdate(1, false);
    expect(spawnGroup).toHaveBeenCalledTimes(2);
    expect(director.getActiveEncounterId()).toBe('final');

    expect(director.isAssaultRepelled()).toBe(false);
    activeEnemyIds.delete('independent-enemy');
    for (const enemyId of [...activeEnemyIds]) activeEnemyIds.delete(enemyId);
    director.hostUpdate(0, false);
    expect(director.isEncounterCleared('final')).toBe(true);
    expect(director.isAssaultRepelled()).toBe(true);
  });

  it('keeps the authored rest as a minimum while faster clears shorten the assault', () => {
    const run = (clearDelayMs: number): number => {
      const activeEnemyIds = new Set<string>();
      let nextEnemyId = 1;
      const director = new CoopDefenseMapDirector([
        {
          id: 'opening',
          startAtMs: 0,
          restAfterMs: 5_000,
          groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
        },
        {
          id: 'final',
          startAtMs: 0,
          restAfterMs: 0,
          groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
        },
      ], (_kind, count) => {
        const ids = Array.from({ length: count }, () => `e${nextEnemyId++}`);
        for (const id of ids) activeEnemyIds.add(id);
        return ids;
      }, {
        mode: 'repel-assault',
        isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
      });

      director.hostUpdate(0, false);
      director.hostUpdate(clearDelayMs, false);
      for (const enemyId of [...activeEnemyIds]) activeEnemyIds.delete(enemyId);
      director.hostUpdate(0, false);
      director.hostUpdate(5_000, false);
      for (const enemyId of [...activeEnemyIds]) activeEnemyIds.delete(enemyId);
      director.hostUpdate(0, false);
      return director.getElapsedMs();
    };

    const fast = run(1_000);
    const slow = run(8_000);
    expect(fast).toBe(6_000);
    expect(slow).toBe(13_000);
    expect(fast).toBeLessThan(slow);
  });

  it('does not spend active director time during countdown and resets repel state', () => {
    const activeEnemyIds = new Set<string>();
    const director = new CoopDefenseMapDirector([
      {
        id: 'opening',
        startAtMs: 0,
        restAfterMs: 0,
        groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
      },
    ], () => ['encounter-1'], {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
    });

    director.hostUpdate(10_000, true);
    expect(director.getElapsedMs()).toBe(0);
    expect(director.hasStartedEncounter('opening')).toBe(false);
    director.hostUpdate(0, false);
    expect(director.hasStartedEncounter('opening')).toBe(true);
    director.reset();
    expect(director.getElapsedMs()).toBe(0);
    expect(director.hasStartedEncounter('opening')).toBe(false);
    expect(director.isAssaultRepelled()).toBe(false);
  });
});
