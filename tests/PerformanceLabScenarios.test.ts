import { describe, expect, it } from 'vitest';
import { allPerformanceCases, resolvePerformanceCases, registerReferenceMap } from '../src/debug/performanceLab/scenarios';
import { isCoopDefenseReadyLoadoutComplete } from '../src/loadout/LoadoutRules';
import { getCoopDefenseMapConfig, isDiagnosticMapId, normalizeCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { PERFORMANCE_MAP_ID, VOID_FIRE_MAP_ID, MAP14_FIRE_MAP_ID, referenceMap } from '../src/debug/performanceLab/referenceMap';
import { PERFORMANCE_FIXTURE } from '../src/debug/performanceLab/fixtures';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { buildPerformanceLoadout, presets } from '../src/debug/performanceLab/loadouts';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../src/utils/coopDefenseUpgrades';

describe('Performance reference fixtures', () => {
  it('derives the Map 14 fire case without modifying campaign terrain or encounters', () => {
    const campaign = getCoopDefenseMapConfig('14');
    const before = structuredClone(campaign);
    const map = normalizeCoopDefenseMapConfig(referenceMap(MAP14_FIRE_MAP_ID));
    expect(resolvePerformanceCases('hazards.map14-fire')[0].mapId).toBe(map.mapId);
    for (const key of ['arenaWidthCells', 'arenaHeightCells', 'timeOfDay', 'rockField', 'water', 'waterAreas',
      'bases', 'persistentBase', 'encounters', 'persistentSpawns'] as const) expect(map[key]).toEqual(campaign[key]);
    const fire = map.mapEvents?.find(event => event.type === 'ground-hazard');
    const original = campaign.mapEvents?.find(event => event.type === 'ground-hazard');
    expect(fire?.area).toEqual(original?.area);
    expect(fire?.effect).toEqual(original?.effect);
    expect(fire?.spread?.durationMs).toBeLessThan(original!.spread!.durationMs);
    expect(campaign).toEqual(before);
  });
  it('exercises the fully upgraded Tesla dome beyond full charge', () => {
    const [scenario] = resolvePerformanceCases('weapon.tesla');
    const loadout = buildPerformanceLoadout('TESLA_DOME');
    const upgrades = scenario.commit.coopDefenseProfile?.upgrades;
    const teslaDefinitions = Object.entries(COOP_DEFENSE_UPGRADE_DEFINITIONS)
      .filter(([id]) => id === 'unlock_tesla_dome' || id.startsWith('tesla_dome_'));
    expect(teslaDefinitions.length).toBeGreaterThan(1);
    for (const [id, definition] of teslaDefinitions) {
      expect(upgrades?.[id], id).toEqual({ unlocked: true, level: definition.maxLevel });
    }
    expect(scenario.commit).toEqual(loadout.commit);
    expect(scenario.buildSignature).toBe(loadout.buildSignature);
    const fire = loadout.effective.weapon2.fire;
    expect(fire.type).toBe('tesla_dome');
    if (fire.type !== 'tesla_dome') throw new Error('Expected a Tesla dome loadout');
    expect(fire.overchargePulseEnabled).toBe(1);
    expect(fire.stormEnabled).toBe(1);
    expect(fire.maxChargeStacks).toBeGreaterThan(0);
    expect(fire.chargeIntervalMs).toBeGreaterThan(0);
    expect(scenario.continuous).toBe(true);
    expect(scenario.durationMs).toBeGreaterThanOrEqual(
      (fire.maxChargeStacks! + 2) * fire.chargeIntervalMs!,
    );
  });

  it('combines weapon and utility upgrades without replacing either ready selection', () => {
    const base = buildPerformanceLoadout('P90');
    const combined = buildPerformanceLoadout('P90', false, 'TIME_BUBBLE');
    expect(isCoopDefenseReadyLoadoutComplete(combined.commit)).toBe(true);
    expect(combined.commit[presets.P90.slot as 'weapon1' | 'weapon2']).toBe('P90');
    expect(combined.commit.utility).toBe('TIME_BUBBLE');
    for (const id of Object.keys(presets.P90.upgrades))
      expect(combined.commit.coopDefenseProfile?.upgrades[id]).toEqual(base.commit.coopDefenseProfile?.upgrades[id]);
    expect(() => buildPerformanceLoadout('P90', false, 'GLOCK')).toThrow('utility');
  });
  it('keeps fixed enemy loads free of population-growing abilities', () => {
    for (const kind of PERFORMANCE_FIXTURE.enemyKinds) {
      const config = getCoopDefenseEnemyConfig(kind);
      expect(config.spawnThrow, kind).toBeUndefined();
      expect(config.deathSpawns ?? [], kind).toHaveLength(0);
    }
  });

  it('resolves every frozen build through legal ready contracts and supports independent cases', () => {
    const cases = allPerformanceCases();
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    for (const test of cases) {
      expect(isCoopDefenseReadyLoadoutComplete(test.commit), test.id).toBe(true);
      expect(resolvePerformanceCases(test.id).map(c => c.id)).toEqual([test.id]);
    }
    expect(resolvePerformanceCases('combat.day-night').map(c => c.id)).toEqual(['combat.day', 'combat.night', 'recovery.idle']);
    expect(() => resolvePerformanceCases('unknown')).toThrow('Unknown');
  });
  it('validates the internal reference maps and unregisters them without a persistent base', () => {
    const cleanup = registerReferenceMap();
    try {
      for (const id of new Set(allPerformanceCases().map(test => test.mapId ?? PERFORMANCE_MAP_ID))) {
        expect(getCoopDefenseMapConfig(id).mapId).toBe(id);
        expect(isDiagnosticMapId(id)).toBe(true);
      }
      const map = getCoopDefenseMapConfig(PERFORMANCE_MAP_ID);
      expect(map.persistentBase).toBeUndefined();
      expect(map.water?.length).toBeGreaterThan(0);
      expect(map.rockWalls?.length).toBeGreaterThan(0);
      expect(isDiagnosticMapId(PERFORMANCE_MAP_ID)).toBe(true);
    } finally { cleanup(); }
    expect(isDiagnosticMapId(PERFORMANCE_MAP_ID)).toBe(false);
    expect(isDiagnosticMapId(VOID_FIRE_MAP_ID)).toBe(false);
    expect(isDiagnosticMapId(MAP14_FIRE_MAP_ID)).toBe(false);
  });
});
