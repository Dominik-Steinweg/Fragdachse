import { describe, expect, it, vi } from 'vitest';
import { CoopDefenseMapDirector } from '../src/systems/CoopDefenseMapDirector';

describe('CoopDefenseMapDirector', () => {
  const encounters = [
    {
      id: 'opening',
      start: { type: 'time', atMs: 1_000 },
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
    expect(spawnGroup).toHaveBeenCalledWith('zombie-badger', 3, 'opening');
    director.hostUpdate(499, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    director.hostUpdate(1, false);
    expect(spawnGroup).toHaveBeenCalledWith('demon-badger', 2, 'opening');

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
        start: { type: 'time', atMs: 0 },
        restAfterMs: 5_000,
        groups: [{ enemyKind: 'zombie-badger', count: 2, delayMs: 0 }],
      },
      {
        id: 'final',
        start: { type: 'after-previous' },
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
          start: { type: 'time', atMs: 0 },
          restAfterMs: 5_000,
          groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
        },
        {
          id: 'final',
          start: { type: 'after-previous' },
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
        start: { type: 'time', atMs: 0 },
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

  it('keeps partial groups pending and retries only on a later update', () => {
    const activeEnemyIds = new Set<string>();
    let calls = 0;
    const spawnGroup = vi.fn((_kind: string, count: number) => {
      calls += 1;
      const ids = calls === 1 ? ['first'] : Array.from({ length: count }, (_, index) => `rest-${index}`);
      for (const id of ids) activeEnemyIds.add(id);
      return ids;
    });
    const director = new CoopDefenseMapDirector([{
      id: 'opening',
      start: { type: 'time', atMs: 0 },
      restAfterMs: 0,
      groups: [{ enemyKind: 'zombie-badger', count: 3, delayMs: 0 }],
    }], spawnGroup, {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
    });

    director.hostUpdate(0, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
    expect(spawnGroup).toHaveBeenLastCalledWith('zombie-badger', 3, 'opening');
    expect(director.isEncounterSpawnComplete('opening')).toBe(false);

    director.hostUpdate(0, false);
    expect(spawnGroup).toHaveBeenCalledTimes(2);
    expect(spawnGroup).toHaveBeenLastCalledWith('zombie-badger', 2, 'opening');
    expect(director.isEncounterSpawnComplete('opening')).toBe(true);
  });

  it('retries a zero spawn and uses a long no-progress backstop without removing live enemies', () => {
    const activeEnemyIds = new Set<string>();
    let shouldSpawn = false;
    const spawnGroup = vi.fn((_kind: string, _count: number) => {
      if (!shouldSpawn) return [];
      activeEnemyIds.add('later');
      return ['later'];
    });
    const director = new CoopDefenseMapDirector([{
      id: 'opening',
      start: { type: 'time', atMs: 0 },
      restAfterMs: 0,
      groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
    }], spawnGroup, {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
      spawnBackstopAfterMs: 100,
    });

    director.hostUpdate(0, false);
    director.hostUpdate(99, false);
    expect(director.isAssaultRepelled()).toBe(false);
    shouldSpawn = true;
    director.hostUpdate(1, false);
    expect(director.isEncounterSpawnComplete('opening')).toBe(true);
    expect(director.isAssaultRepelled()).toBe(false);

    activeEnemyIds.clear();
    director.hostUpdate(0, false);
    expect(director.isAssaultRepelled()).toBe(true);

    const blockedDirector = new CoopDefenseMapDirector([{
      id: 'blocked',
      start: { type: 'time', atMs: 0 },
      restAfterMs: 0,
      groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
    }], () => [], {
      mode: 'repel-assault',
      isEnemyActive: () => false,
      spawnBackstopAfterMs: 100,
    });
    blockedDirector.hostUpdate(0, false);
    blockedDirector.hostUpdate(1_000, false);
    expect(blockedDirector.isAssaultRepelled()).toBe(true);
  });

  it('keeps inherited encounter enemies in clear and removes only proven technical stragglers', () => {
    const activeEnemyIds = new Set(['parent']);
    const originEnemyIds = new Set(['parent']);
    let stuck = false;
    const director = new CoopDefenseMapDirector([{
      id: 'opening',
      start: { type: 'time', atMs: 0 },
      restAfterMs: 0,
      groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
    }], () => ['parent'], {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
      isEnemyOriginActive: () => originEnemyIds.size > 0,
      getActiveEnemyIdsForOrigin: () => [...originEnemyIds],
      isEnemyTechnicallyStuck: () => stuck,
      technicalStuckBackstopAfterMs: 100,
      removeEnemy: (enemyId) => {
        activeEnemyIds.delete(enemyId);
        originEnemyIds.delete(enemyId);
        return true;
      },
    });

    director.hostUpdate(0, false);
    activeEnemyIds.delete('parent');
    originEnemyIds.delete('parent');
    originEnemyIds.add('death-add');
    activeEnemyIds.add('death-add');
    director.hostUpdate(0, false);
    expect(director.isAssaultRepelled()).toBe(false);

    stuck = true;
    director.hostUpdate(0, false);
    director.hostUpdate(100, false);
    expect(director.isAssaultRepelled()).toBe(true);
  });

  it('waits for an opening airstrike trigger after the authored repel rest and starts once', () => {
    const activeEnemyIds = new Set<string>();
    let nextId = 0;
    let barrageComplete = false;
    const director = new CoopDefenseMapDirector([
      {
        id: 'opening',
        start: { type: 'time', atMs: 0 },
        restAfterMs: 1_000,
        groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
      },
      {
        id: 'after-barrage',
        start: { type: 'opening-airstrike-complete' },
        groups: [{ enemyKind: 'demon-badger', count: 1, delayMs: 250 }],
      },
    ], (_kind, count) => {
      const ids = Array.from({ length: count }, () => `trigger-${nextId++}`);
      for (const id of ids) activeEnemyIds.add(id);
      return ids;
    }, {
      mode: 'repel-assault',
      isEnemyActive: (enemyId) => activeEnemyIds.has(enemyId),
      isEncounterStartSatisfied: (start) => start.type === 'opening-airstrike-complete' && barrageComplete,
    });

    director.hostUpdate(0, false);
    activeEnemyIds.clear();
    director.hostUpdate(0, false);
    director.hostUpdate(1_000, false);
    expect(director.hasStartedEncounter('after-barrage')).toBe(false);

    barrageComplete = true;
    director.hostUpdate(249, false);
    expect(director.hasStartedEncounter('after-barrage')).toBe(true);
    expect(director.isEncounterSpawnComplete('after-barrage')).toBe(false);
    director.hostUpdate(250, false);
    expect(director.isEncounterSpawnComplete('after-barrage')).toBe(true);
    expect(nextId).toBe(2);
  });

  it('opens a boss-phase trigger only after phase two and does not repeat it', () => {
    let phase = 1;
    const spawnGroup = vi.fn(() => ['boss-trigger-enemy']);
    const director = new CoopDefenseMapDirector([{
      id: 'phase-two-support',
      start: { type: 'boss-phase', phase: 2 },
      groups: [{ enemyKind: 'void-stalker', count: 1, delayMs: 0 }],
    }], spawnGroup, {
      isEncounterStartSatisfied: (start) => start.type === 'boss-phase' && phase >= start.phase,
    });

    director.hostUpdate(1_000, false);
    expect(spawnGroup).not.toHaveBeenCalled();
    phase = 2;
    director.hostUpdate(0, false);
    director.hostUpdate(10_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
  });

  it('opens a base-destroyed trigger only for the configured base', () => {
    const destroyedBases = new Set<string>();
    const spawnGroup = vi.fn(() => ['base-trigger-enemy']);
    const director = new CoopDefenseMapDirector([{
      id: 'counterattack',
      start: { type: 'base-destroyed', baseId: 'outpost-a' },
      groups: [{ enemyKind: 'zombie-badger', count: 1, delayMs: 0 }],
    }], spawnGroup, {
      isEncounterStartSatisfied: (start) => start.type === 'base-destroyed' && destroyedBases.has(start.baseId),
    });

    destroyedBases.add('outpost-b');
    director.hostUpdate(1_000, false);
    expect(spawnGroup).not.toHaveBeenCalled();
    destroyedBases.add('outpost-a');
    director.hostUpdate(0, false);
    director.hostUpdate(1_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(1);
  });
});
