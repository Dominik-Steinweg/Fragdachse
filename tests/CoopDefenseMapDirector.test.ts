import { describe, expect, it, vi } from 'vitest';
import { CoopDefenseMapDirector } from '../src/systems/CoopDefenseMapDirector';

describe('CoopDefenseMapDirector', () => {
  const encounters = [
    {
      id: 'opening',
      startAtMs: 1_000,
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
    expect(director.isEncounterComplete('opening')).toBe(true);
    director.reset();
    expect(director.getElapsedMs()).toBe(0);
    expect(director.hasStartedEncounter('opening')).toBe(false);

    director.hostUpdate(1_000, false);
    expect(spawnGroup).toHaveBeenCalledTimes(3);
  });
});
