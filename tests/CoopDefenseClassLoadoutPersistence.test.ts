import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStoredCoopDefenseLoadout,
  getStoredCoopDefenseLoadoutSlot,
  getStoredCoopDefenseProgress,
  exportStoredGameProgressJson,
  invalidateLocalStorageCache,
  LOCAL_PROGRESS_STORAGE_KEY,
  resetStoredCoopDefenseCharacter,
  setStoredCoopDefenseClassesUnlocked,
  setStoredCoopDefenseLoadoutSlot,
  setStoredLoadoutSlot,
  switchStoredCoopDefenseClassLoadout,
} from '../src/utils/localPreferences';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getAvailableCoopDefenseBossPoints,
  getAvailableCoopDefenseUpgradePoints,
  getCoopDefenseUpgradeLoadoutSelection,
  getSpentCoopDefenseBossPoints,
  getSpentCoopDefenseUpgradePoints,
} from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseXpThresholdForLevel } from '../src/utils/coopDefenseProgression';
import { resolveLoadoutSelectionIds } from '../src/loadout/LoadoutRules';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writeCount = 0;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.writeCount += 1;
    this.values.set(key, value);
  }
}

describe('coop-defense class loadout persistence', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('releases old Inspector ultimate investments on reload without changing other class profiles', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    const oldUltimates = ['ARMAGEDDON', 'GAUSS_RIFLE', 'AIRSTRIKE', 'HONEY_BADGER_RAGE'];
    const oldBranches = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
      .filter(definition => oldUltimates.includes(getCoopDefenseUpgradeLoadoutSelection(definition.id)?.itemId ?? ''));
    const normalCost = oldBranches.reduce((sum, definition) => sum + (definition.maxLevel - definition.startingLevel) * definition.costPerLevel, 0);
    const bossCost = oldBranches.reduce((sum, definition) => sum + (definition.maxLevel - definition.startingLevel) * definition.bossPointCostPerLevel, 0);
    expect(normalCost).toBeGreaterThan(0);
    expect(bossCost).toBeGreaterThan(0);
    const level = normalCost + 1;
    const raw = JSON.parse(exportStoredGameProgressJson()).progress;
    raw.coopDefense.totalXp = getCoopDefenseXpThresholdForLevel(level);
    raw.coopDefense.dawn.purchasedBossPoints = bossCost;
    raw.coopDefense.loadoutsByClass = {};
    for (const classId of ['inspector_gadachs', 'dachs_nukem', 'dachs_of_steel'] as const) {
      raw.coopDefense.profilesByClass[classId] = {
        ...raw.coopDefense.profilesByClass[classId],
        levels: Object.fromEntries(oldBranches.map(definition => [definition.id, definition.maxLevel])),
      };
      raw.coopDefense.loadoutsByClass[classId] = { ultimate: 'GAUSS_RIFLE' };
    }
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(raw));
    invalidateLocalStorageCache();
    const once = getStoredCoopDefenseProgress();
    const inspector = once.profilesByClass.inspector_gadachs;
    for (const definition of oldBranches) {
      expect(inspector.upgrades[definition.id], definition.id).toEqual({ level: 0, unlocked: false });
    }
    expect(getAvailableCoopDefenseUpgradePoints(level, inspector, 'inspector_gadachs')).toBe(normalCost);
    expect(getAvailableCoopDefenseBossPoints(bossCost, inspector, 'inspector_gadachs')).toBe(bossCost);
    const resolveStoredUltimate = () => resolveLoadoutSelectionIds({
      ultimate: ULTIMATE_CONFIGS[getStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'ultimate')!],
    }, 'coop_defense', getStoredCoopDefenseProgress().profilesByClass.inspector_gadachs, 'inspector_gadachs').ultimate;
    expect(resolveStoredUltimate()).toBe('HOLO_OFFENSIVE');
    for (const classId of ['dachs_nukem', 'dachs_of_steel'] as const) {
      const profile = once.profilesByClass[classId];
      for (const definition of oldBranches) expect(profile.upgrades[definition.id].level, `${classId}:${definition.id}`).toBe(definition.maxLevel);
      expect(getSpentCoopDefenseUpgradePoints(profile, classId)).toBe(normalCost);
      expect(getSpentCoopDefenseBossPoints(profile, classId)).toBe(bossCost);
      expect(getStoredCoopDefenseLoadoutSlot(classId, 'ultimate')).toBe('GAUSS_RIFLE');
    }
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress()).toEqual(once);
    expect(resolveStoredUltimate()).toBe('HOLO_OFFENSIVE');
    // Re-encoding drops the old investments rather than crediting points a second time.
    storage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(JSON.parse(exportStoredGameProgressJson()).progress));
    invalidateLocalStorageCache();
    expect(getStoredCoopDefenseProgress()).toEqual(once);
  });

  it('keeps each class loadout independent', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1', 'AK47');
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon2', 'P90');
    setStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon1', 'GLOCK');
    setStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon2', 'OVERCHARGE_CORE');

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBe('AK47');
    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon2')).toBe('P90');
    expect(getStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon1')).toBe('GLOCK');
    expect(getStoredCoopDefenseLoadoutSlot('inspector_gadachs', 'weapon2')).toBe('OVERCHARGE_CORE');
  });

  it('switches class and both loadouts in one preferences write', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    const writesBeforeSwitch = storage.writeCount;

    switchStoredCoopDefenseClassLoadout(
      'dachs_nukem',
      'inspector_gadachs',
      { weapon1: 'AK47', utility: 'FELSEN' },
      { weapon1: 'GLOCK', weapon2: 'ENERGY_INJECTOR' },
    );

    expect(storage.writeCount).toBe(writesBeforeSwitch + 1);
    expect(getStoredCoopDefenseProgress().selectedClassId).toBe('inspector_gadachs');
    expect(getStoredCoopDefenseLoadout('dachs_nukem')).toMatchObject({
      weapon1: 'AK47',
      utility: 'HE_GRENADE',
    });
    expect(getStoredCoopDefenseLoadout('inspector_gadachs')).toMatchObject({
      weapon1: 'GLOCK',
      weapon2: 'ENERGY_INJECTOR',
    });
  });

  it('copies the old shared selection to Dachs Nukem when classes unlock', () => {
    setStoredLoadoutSlot('weapon1', 'AK47');
    setStoredCoopDefenseClassesUnlocked(true);

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBe('AK47');
    expect(getStoredCoopDefenseProgress().profilesByClass.inspector_gadachs.toolLoadout).toEqual([
      { kind: 'construction', id: 'rocket_turret' }, { kind: 'utility', id: 'HE_GRENADE' },
      { kind: 'utility', id: 'FIRE_CONTROL_RELAY' },
    ]);
  });

  it('clears class loadouts with the character reset', () => {
    setStoredCoopDefenseClassesUnlocked(true);
    setStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1', 'AK47');

    resetStoredCoopDefenseCharacter();

    expect(getStoredCoopDefenseLoadoutSlot('dachs_nukem', 'weapon1')).toBeNull();
  });
});
