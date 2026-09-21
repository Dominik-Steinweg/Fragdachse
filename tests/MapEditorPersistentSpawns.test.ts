import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import sources from '../src/config/coopDefenseMapSources.json';
import { resolveCoopDefenseEnemyConfigs } from '../src/config/coopDefenseEnemies';
import { resolveEnemyLifecycleTotals } from '../src/config/coopDefenseEnemyLifecycle';
import { getCoopDefenseMapScheduledXp, getCoopDefenseMapXpReference, normalizeCoopDefenseMapConfig, resolveCoopDefenseMapPersistentSpawnConfigs } from '../src/config/coopDefenseMapAuthoring';
import { persistentSpawnXp } from '../tools/map-editor/shared/persistentSpawnXp';
import { array } from '../tools/map-editor/shared/json';

describe('Map editor permanent XP planning', () => {
  it('counts the initial spawn, delay and repeats strictly before the planning endpoint', () => {
    const spawn = { enemyKind: 'zombie-badger', countPerTick: 2, intervalMs: 10000, startAtMs: 20000 };
    expect(persistentSpawnXp(spawn, 19).count).toBe(0);
    expect(persistentSpawnXp(spawn, 20).count).toBe(0);
    expect(persistentSpawnXp(spawn, 21).count).toBe(2);
    expect(persistentSpawnXp(spawn, 30).count).toBe(2);
    expect(persistentSpawnXp(spawn, 31).count).toBe(4);
    expect(persistentSpawnXp({ ...spawn, startAtMs: undefined }, 10).count).toBe(2);
    expect(persistentSpawnXp({ ...spawn, intervalMs: 5000 }, 31).count).toBe(6);
  });
  it('shares the game reference and lifecycle XP without changing any authored document', () => {
    for (const source of sources.maps) {
      const raw = JSON.parse(readFileSync(new URL(`../src/config/coopDefenseMaps/${source.file}`, import.meta.url), 'utf8'));
      const original = structuredClone(raw), map = normalizeCoopDefenseMapConfig(structuredClone(raw));
      const finite = getCoopDefenseMapScheduledXp(map, 1), resolved = resolveCoopDefenseMapPersistentSpawnConfigs(map, 1);
      const estimate = array(raw.persistentSpawns).map(s => persistentSpawnXp(s, raw.balanceReferenceDurationSec));
      expect(estimate.every(e => e.complete), source.file).toBe(true);
      expect(Math.max(1, finite + estimate.reduce((sum, e) => sum + e.xp, 0)), source.file).toBe(getCoopDefenseMapXpReference(map, resolved, 1));
      expect(raw).toEqual(original);
    }
    const enemies = resolveCoopDefenseEnemyConfigs(1), kind = Object.keys(enemies).find(k => enemies[k].deathSpawns?.length)!;
    const life = resolveEnemyLifecycleTotals(kind), estimate = persistentSpawnXp({ enemyKind: kind, intervalMs: 10000, countPerTick: 2 }, 11);
    expect(estimate).toMatchObject({ count: 4, xp: life.xp * 4, direct: life.directXp * 4, follow: life.followXp * 4, complete: true });
    const dynamicKind = Object.keys(enemies).find(k => resolveEnemyLifecycleTotals(k).dynamic)!;
    expect(persistentSpawnXp({ enemyKind: dynamicKind, intervalMs: 10000, countPerTick: 1 }, 10).dynamic).toBe(true);
  });
  it('marks invalid inputs and unknown enemy kinds incomplete without producing infinite XP', () => {
    for (const spawn of [
      { enemyKind: 'zombie-badger', intervalMs: 0, countPerTick: 1 },
      { enemyKind: 'zombie-badger', intervalMs: 1000, countPerTick: 0.5 },
      { enemyKind: 'missing', intervalMs: 1000, countPerTick: 1 },
    ]) expect(persistentSpawnXp(spawn, 30)).toMatchObject({ complete: false, xp: 0 });
    expect(persistentSpawnXp({ enemyKind: 'zombie-badger', intervalMs: 1000, countPerTick: 1 }, 0)).toMatchObject({ complete: false, xp: 0 });
  });
});
