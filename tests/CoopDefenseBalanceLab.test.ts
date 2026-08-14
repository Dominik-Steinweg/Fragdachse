import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAllCoopDefenseBalanceMapSnapshots,
  buildCoopDefenseBalanceMapSnapshot,
  getCoopDefenseMapBalanceSignature,
  resolveEnemyLifecycleTotals,
} from '../src/debug/coopDefenseBalance/analyzer';
import { buildCoopDefenseBalanceReport, classifyBalanceRound } from '../src/debug/coopDefenseBalance/report';
import { toBalanceRoundsCsv, toBalanceSummaryCsv } from '../src/debug/coopDefenseBalance/csv';
import {
  COOP_DEFENSE_BALANCE_MAX_ROUNDS,
  COOP_DEFENSE_BALANCE_RULESET_VERSION,
  type BalanceBuildSnapshot,
  type BalanceRoundRecord,
} from '../src/debug/coopDefenseBalance/types';
import { COOP_DEFENSE_ENEMY_CONFIGS } from '../src/config/coopDefenseEnemies';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';
import {
  exportStoredGameProgressJson,
  getStoredCoopDefenseBalanceLab,
  invalidateLocalStorageCache,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseBalanceRecordingEnabled,
  updateStoredCoopDefenseBalanceFeedback,
  upsertStoredCoopDefenseBalanceRound,
} from '../src/utils/localPreferences';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const EMPTY_BUILD: BalanceBuildSnapshot = {
  coopXpBefore: 0,
  levelBefore: 1,
  classId: null,
  weapon1: 'GLOCK',
  weapon2: null,
  utility: 'HE_GRENADE',
  ultimate: 'DASH',
  upgradeProfile: {},
  items: [],
};

function round(roundEndedAt: number, mapId = '1', signature = 'sig'): BalanceRoundRecord {
  return {
    roundEndedAt,
    mapId,
    outcome: 'victory',
    durationMs: 60_000,
    sharedXp: 100,
    frags: 4,
    playerHp: 50,
    playerMaxHp: 100,
    playerHpPercent: 0.5,
    armor: 2,
    ownMainBaseHp: 20,
    ownMainBaseMaxHp: 100,
    ownMainBaseHpPercent: 0.2,
    hostileMainBaseHp: null,
    hostileMainBaseMaxHp: null,
    hostileMainBaseHpPercent: null,
    survivalRemainingRespawns: null,
    build: EMPTY_BUILD,
    mapBalanceSignature: signature,
    rulesetVersion: COOP_DEFENSE_BALANCE_RULESET_VERSION,
    feedback: null,
  };
}

describe('Coop Defense Balance Lab', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage, confirm: () => true });
    invalidateLocalStorageCache();
  });

  afterEach(() => {
    invalidateLocalStorageCache();
    vi.unstubAllGlobals();
  });

  it('liefert fuer jede authored Map endliche, nicht-negative 1P-Kennzahlen', () => {
    const snapshots = buildAllCoopDefenseBalanceMapSnapshots();
    expect(snapshots.length).toBe(COOP_DEFENSE_MAP_CONFIGS.length);
    for (const snapshot of snapshots) {
      for (const value of [
        snapshot.finiteEnemyCount, snapshot.finiteEnemyHp, snapshot.finiteEnemyXp,
        snapshot.persistentReferenceEnemyCount, snapshot.persistentReferenceHp,
        snapshot.persistentReferenceXp, snapshot.persistentReferenceHpPerMinute,
        snapshot.totalReferenceHp,
      ]) {
        expect(Number.isFinite(value), snapshot.mapId).toBe(true);
        expect(value, snapshot.mapId).toBeGreaterThanOrEqual(0);
      }
      expect(snapshot.persistentSources.reduce((sum, source) => sum + source.referenceHp, 0))
        .toBe(snapshot.persistentReferenceHp);
    }
  });

  it('rechnet Death-Spawns deterministisch und markiert SpawnThrow dynamisch', () => {
    const deathSpawnKind = Object.keys(COOP_DEFENSE_ENEMY_CONFIGS)
      .find((kind) => (COOP_DEFENSE_ENEMY_CONFIGS[kind].deathSpawns?.length ?? 0) > 0);
    expect(deathSpawnKind).toBeTruthy();
    const first = resolveEnemyLifecycleTotals(deathSpawnKind!);
    const second = resolveEnemyLifecycleTotals(deathSpawnKind!);
    expect(second).toEqual(first);
    expect(first.count).toBeGreaterThanOrEqual(1);

    const spawnThrowKind = Object.keys(COOP_DEFENSE_ENEMY_CONFIGS)
      .find((kind) => COOP_DEFENSE_ENEMY_CONFIGS[kind].spawnThrow !== undefined);
    expect(spawnThrowKind).toBeTruthy();
    const fixture = {
      ...COOP_DEFENSE_MAP_CONFIGS[0],
      encounters: [{
        id: 'balance-fixture',
        start: { type: 'time' as const, atMs: 0 },
        groups: [{ enemyKind: spawnThrowKind!, count: 1 }],
      }],
    };
    const snapshot = buildCoopDefenseBalanceMapSnapshot(fixture);
    expect(snapshot.modelQuality).toBe('DYNAMIC');
    expect(snapshot.dynamicFactors.some((entry) => entry.includes('spawnThrow'))).toBe(true);
  });

  it('hält Map-Signaturen bei reinen Textänderungen stabil, aber nicht bei Balanceänderungen', () => {
    const map = COOP_DEFENSE_MAP_CONFIGS[1];
    const displayOnly = { ...map, displayName: `${map.displayName} Test`, tutorialText: `${map.tutorialText ?? ''} Test` };
    const balanceChanged = { ...map, balanceReferenceDurationSec: map.balanceReferenceDurationSec + 1 };
    expect(getCoopDefenseMapBalanceSignature(displayOnly)).toBe(getCoopDefenseMapBalanceSignature(map));
    expect(getCoopDefenseMapBalanceSignature(balanceChanged)).not.toBe(getCoopDefenseMapBalanceSignature(map));
  });

  it('schliesst veraltete Runden aus Aggregaten aus und berechnet Median/Mittelwerte', () => {
    const snapshots = buildAllCoopDefenseBalanceMapSnapshots();
    const map = snapshots.find((entry) => entry.mapId === '1')!;
    const current = round(1, '1', map.balanceSignature);
    const currentLong = { ...round(2, '1', map.balanceSignature), durationMs: 120_000, feedback: { difficulty: 4 as const, pacing: 5 as const, comment: '' } };
    const stale = { ...round(3, '1', 'old-signature'), feedback: { difficulty: 1 as const, pacing: 1 as const, comment: '' } };
    const rulesetStale = { ...round(4, '1', map.balanceSignature), rulesetVersion: COOP_DEFENSE_BALANCE_RULESET_VERSION + 1 };
    const report = buildCoopDefenseBalanceReport(snapshots, [current, currentLong, stale, rulesetStale]);
    const mapReport = report.maps.find((entry) => entry.snapshot.mapId === '1')!;
    expect(mapReport.metrics.currentRounds).toBe(2);
    expect(mapReport.metrics.medianDurationMs).toBe(90_000);
    expect(mapReport.metrics.ratedRounds).toBe(1);
    expect(mapReport.metrics.averageDifficulty).toBe(4);
    expect(mapReport.metrics.staleRounds).toBe(2);
    expect(classifyBalanceRound(rulesetStale, new Map([[map.mapId, map]])).status).toBe('STALE');
  });

  it('ist standardmaessig aus, upsertet nach roundEndedAt und begrenzt auf 500 Runden', () => {
    expect(getStoredCoopDefenseBalanceLab().recordingEnabled).toBe(false);
    upsertStoredCoopDefenseBalanceRound(round(7));
    upsertStoredCoopDefenseBalanceRound({ ...round(7), sharedXp: 999 });
    expect(getStoredCoopDefenseBalanceLab().rounds).toHaveLength(1);
    for (let index = 0; index < COOP_DEFENSE_BALANCE_MAX_ROUNDS + 1; index += 1) {
      upsertStoredCoopDefenseBalanceRound(round(100 + index));
    }
    const rounds = getStoredCoopDefenseBalanceLab().rounds;
    expect(rounds).toHaveLength(COOP_DEFENSE_BALANCE_MAX_ROUNDS);
    expect(rounds[0].roundEndedAt).toBe(101);
  });

  it('speichert Feedback per Upsert auf derselben Runde und trennt den Progress-Export', () => {
    const map = buildAllCoopDefenseBalanceMapSnapshots().find((entry) => entry.mapId === '1')!;
    setStoredCoopDefenseBalanceRecordingEnabled(true);
    upsertStoredCoopDefenseBalanceRound(round(42, '1', map.balanceSignature));
    expect(updateStoredCoopDefenseBalanceFeedback(42, { difficulty: 5, pacing: 4, comment: '=test' })).toBe(true);
    expect(getStoredCoopDefenseBalanceLab().rounds).toHaveLength(1);
    expect(getStoredCoopDefenseBalanceLab().rounds[0].feedback?.comment).toBe('=test');
    resetStoredCoopDefenseCharacter();
    expect(getStoredCoopDefenseBalanceLab().rounds).toHaveLength(1);
    expect(exportStoredGameProgressJson()).not.toContain('balance_lab');
  });

  it('exportiert BOM/Semikolon und schützt Spreadsheet-Formeln', () => {
    const map = buildAllCoopDefenseBalanceMapSnapshots().find((entry) => entry.mapId === '1')!;
    const stored = buildCoopDefenseBalanceReport(map ? [map] : [], [{ ...round(1, '1', map.balanceSignature), feedback: { difficulty: 3, pacing: 3, comment: '=SUM(A1)' } }]);
    const csv = toBalanceRoundsCsv(stored);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(';');
    expect(csv).toContain("'=SUM(A1)");
    expect(toBalanceSummaryCsv(stored).startsWith('\uFEFF')).toBe(true);
  });
});
