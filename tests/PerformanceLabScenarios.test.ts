import { describe, expect, it } from 'vitest';
import { allPerformanceCases, resolvePerformanceCases, registerReferenceMap } from '../src/debug/performanceLab/scenarios';
import { isCoopDefenseReadyLoadoutComplete } from '../src/loadout/LoadoutRules';
import { getCoopDefenseMapConfig, isDiagnosticMapId } from '../src/config/coopDefenseMaps';
import { PERFORMANCE_MAP_ID } from '../src/debug/performanceLab/referenceMap';

describe('Performance reference fixtures', () => {
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
      const map = getCoopDefenseMapConfig(PERFORMANCE_MAP_ID);
      expect(map.persistentBase).toBeUndefined();
      expect(map.water?.length).toBeGreaterThan(0);
      expect(map.rockWalls?.length).toBeGreaterThan(0);
      expect(isDiagnosticMapId(PERFORMANCE_MAP_ID)).toBe(true);
    } finally { cleanup(); }
    expect(isDiagnosticMapId(PERFORMANCE_MAP_ID)).toBe(false);
  });
});
