import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_MAP_CONFIGS,
  getCoopDefenseCampaignAudit,
  getCoopDefenseMapConfig,
  WEAPON_BALANCE_LAB_MAP_ID,
} from '../src/config/coopDefenseMaps';
import { getUnlockedCoopDefenseMapConfigs } from '../src/config/coopDefenseMapUnlocks';
import { buildNeutralWeaponBenchmarkCommit } from '../src/debug/coopDefenseBalance/WeaponBalanceLabRuntime';
import {
  loadRuntimeBenchmarkResults,
  runtimeBenchmarkResultsToCsv,
  selectBestObservedRuntimeResults,
  storeRuntimeBenchmarkResult,
} from '../src/debug/coopDefenseBalance/runtimeBenchmarkStorage';
import type { RuntimeBenchmarkResult } from '../src/debug/coopDefenseBalance/runtimeBenchmarkTypes';
import { sanitizeCoopDefenseUpgradeProfile } from '../src/utils/coopDefenseUpgrades';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function result(runId: string): RuntimeBenchmarkResult {
  return {
    schemaVersion: 1,
    runId,
    createdAt: '2026-08-24T10:00:00.000Z',
    weaponId: 'GLOCK',
    slot: 'weapon1',
    scenario: 'single_target',
    targetCount: 1,
    distance: 180,
    warmupMs: 1000,
    measurementMs: 8000,
    settleMs: 2000,
    upgradeLevels: { glock_stopping_power: 2 },
    buildSignature: 'glock_stopping_power:2',
    shotsFired: 10,
    damagingHitEvents: 8,
    criticalDamageEvents: 1,
    targetsDamaged: 1,
    totalDamage: 800,
    dps: 100,
    damageByKind: { direct: 700, burn: 100 },
    tailDamage: 25,
    adrenalineGenerated: 16,
    adrenalineGeneratedPerSecond: 2,
    adrenalineConsumed: 0,
    adrenalinePerSecond: 0,
    tailStatus: 'complete',
    activeOwnedProjectilesAtEnd: 0,
    activeBurnSourcesAtEnd: 0,
  };
}

describe('Weapon Balance Lab 2.0 runtime contracts', () => {
  it('resolves the internal range without exposing it as selectable campaign content', () => {
    const map = getCoopDefenseMapConfig(WEAPON_BALANCE_LAB_MAP_ID);
    expect(map.mapId).toBe(WEAPON_BALANCE_LAB_MAP_ID);
    expect(map.rockFillRatio).toBe(0);
    expect(map.treeCount).toBe(0);
    expect(map.encounters).toEqual([]);
    expect(map.persistentSpawns).toEqual([]);
    expect(COOP_DEFENSE_MAP_CONFIGS.map((entry) => entry.mapId)).not.toContain(WEAPON_BALANCE_LAB_MAP_ID);
    expect(getCoopDefenseCampaignAudit().map((entry) => entry.mapId)).not.toContain(WEAPON_BALANCE_LAB_MAP_ID);
    expect(getUnlockedCoopDefenseMapConfigs('17').map((entry) => entry.mapId)).not.toContain(WEAPON_BALANCE_LAB_MAP_ID);
  });

  it('keeps only the selected weapon branch in the committed benchmark profile', () => {
    const sourceProfile = sanitizeCoopDefenseUpgradeProfile({ upgrades: {
      critical_chance: { unlocked: true, level: 2 },
      glock_adrenaline_gain: { unlocked: true, level: 1 },
      glock_stopping_power: { unlocked: true, level: 2 },
      p90_range: { unlocked: true, level: 3 },
    } });
    const build = buildNeutralWeaponBenchmarkCommit({
      weapon1: 'GLOCK',
      weapon2: 'P90',
      utility: 'HE_GRENADE',
      ultimate: 'HONEY_BADGER_RAGE',
      coopDefenseClassId: 'dachs_nukem',
      coopDefenseProfile: sourceProfile,
      equippedItems: [{
        uid: 'ignored-item', slot: 'gloves', rarity: 'blue', itemLevel: 5, baseValue: 4, affixes: [],
      }],
    }, 'weapon1');

    expect(build.weaponId).toBe('GLOCK');
    expect(build.commit.coopDefenseClassId).toBeNull();
    expect(build.commit.equippedItems).toEqual([]);
    expect(build.upgradeLevels.glock_stopping_power).toBe(2);
    expect(build.upgradeLevels).not.toHaveProperty('critical_chance');
    expect(build.upgradeLevels).not.toHaveProperty('p90_range');
  });

  it('persists bounded results and emits spreadsheet-safe CSV', () => {
    const storage = new MemoryStorage();
    storeRuntimeBenchmarkResult(result('run-1'), storage);
    storeRuntimeBenchmarkResult({ ...result('run-2'), buildSignature: '=unsafe' }, storage);
    expect(loadRuntimeBenchmarkResults(storage).map((entry) => entry.runId)).toEqual(['run-2', 'run-1']);
    expect(runtimeBenchmarkResultsToCsv(loadRuntimeBenchmarkResults(storage)))
      .toContain("\"'=unsafe\"");
  });

  it('labels the highest measured value only within a comparable runtime group', () => {
    const runs = [
      result('run-1'),
      { ...result('run-2'), dps: 115, totalDamage: 920 },
      { ...result('run-3'), scenario: 'five_target' as const, targetCount: 5, dps: 240 },
    ];
    const bestObserved = selectBestObservedRuntimeResults(runs);

    expect(bestObserved).toHaveLength(2);
    expect(bestObserved.find((entry) => entry.result.scenario === 'single_target')).toMatchObject({
      result: { runId: 'run-2', dps: 115 },
      sampleCount: 2,
    });
  });
});
