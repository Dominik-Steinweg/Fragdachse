import { describe, expect, it } from 'vitest';
import { COOP_DEFENSE_CLASS_IDS } from '../src/config/coopDefenseClasses';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS, isCoopDefenseUpgradeAvailableForClass } from '../src/utils/coopDefenseUpgrades';
import { buildScenarioProfile, defaultScenario, parseScenario, scenarioLoadout, encodeScenario, decodeScenario } from '../src/dev/scenario/config';
import { createMemoryStorage } from '../src/dev/scenario/memoryStorage';
import { ScenarioClock } from '../src/dev/scenario/clock';

describe('Dev scenario contract', () => {
  it.each(COOP_DEFENSE_CLASS_IDS)('round-trips a complete %s loadout without real progression', classId => {
    const config = defaultScenario(classId);
    expect(decodeScenario(encodeScenario(config))).toEqual(config);
    const commit = scenarioLoadout(config);
    expect(commit.coopDefenseClassId).toBe(classId);
    expect(commit.weapon2).toBe(config.weapon2);
    expect(commit.tools).toEqual(config.tools);
  });
  it('includes prerequisites and rejects impossible tuning instead of silently clamping', () => {
    const classId = 'inspector_gadachs';
    const definition = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS).find(value => value.kind === 'upgrade'
      && value.requires.length > 0 && isCoopDefenseUpgradeAvailableForClass(value.id, classId))!;
    const profile = buildScenarioProfile(classId, { [definition.id]: definition.maxLevel }, []);
    expect(profile.upgrades[definition.id].level).toBe(definition.maxLevel);
    for (const requirement of definition.requires) expect(profile.upgrades[requirement.upgradeId].level).toBeGreaterThanOrEqual(requirement.minLevel);
    expect(() => buildScenarioProfile(classId, { [definition.id]: definition.maxLevel + 1 }, [])).toThrow();
    expect(() => buildScenarioProfile(classId, { missing_upgrade: 1 }, [])).toThrow();
  });
  it('rejects unknown schema, maps, equipment, geometry and corrupted items', () => {
    const config = defaultScenario();
    for (const change of [{ version: 2 }, { mapId: 'missing' }, { weapon2: 'missing' }, { typo: true },
      { player: { gridX: NaN, gridY: 1 } }, { items: [{ uid: 'invalid' }] }, { seed: 1.25 }]) {
      expect(() => parseScenario({ ...config, ...change })).toThrow();
    }
  });
  it('keeps storage instances isolated', () => {
    const first = createMemoryStorage(), second = createMemoryStorage();
    first.setItem('progress', 'scenario');
    expect(second.getItem('progress')).toBeNull();
    first.clear(); expect(first.length).toBe(0);
  });
  it('freezes gameplay time, advances exact steps and restores the clock owner', () => {
    const realNow = Date.now;
    const deltas: number[] = [];
    const original = (_time: number, delta: number) => { deltas.push(delta); };
    const loop = { callback: original };
    const clock = new ScenarioClock(loop);
    try {
      clock.paused = true; const pausedAt = Date.now();
      loop.callback(1000, 16); expect(Date.now()).toBe(pausedAt); expect(deltas).toEqual([]);
      clock.step(2); loop.callback(1016, 99); loop.callback(1032, 99); loop.callback(1048, 99);
      expect(deltas).toHaveLength(2); expect(Date.now() - pausedAt).toBe(Math.floor(1000 / 30));
      expect(Number.isSafeInteger(Date.now())).toBe(true);
      clock.paused = false; clock.speed = 0.25; loop.callback(1064, 16);
      expect(deltas[2]).toBe(4);
    } finally { clock.destroy(); }
    expect(Date.now).toBe(realNow); expect(loop.callback).toBe(original);
  });
});
