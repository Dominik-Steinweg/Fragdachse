import { describe, expect, it } from 'vitest';
import { CoopMissionVoidDanger, resolvePermanentVoidHazardSources } from '../src/activity/CoopMissionVoidDanger';
import { COOP_DEFENSE_MAP_CONFIGS, isPermanentVoidGroundHazard, type CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { ArenaLayout, CoopDefenseSecondaryObjectivePresentationState } from '../src/types';

const layoutWith = (zones: ArenaLayout['groundHazardZones']): ArenaLayout =>
  ({ seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [], groundHazardZones: zones }) as ArenaLayout;

describe('Coop mission void danger (GDD Void-Gefahrenzonen V1)', () => {
  it('turns every permanent void hazard into one danger source over its generated cells', () => {
    const maps = COOP_DEFENSE_MAP_CONFIGS.filter(map => (map.mapEvents ?? []).some(isPermanentVoidGroundHazard));
    expect(maps.length).toBeGreaterThan(0);
    for (const map of maps) {
      const events = map.mapEvents!.filter(isPermanentVoidGroundHazard);
      const layout = layoutWith(events.map(event => ({ eventId: event.id, cells: [{ gridX: 3, gridY: 4 }, { gridX: 4, gridY: 4 }] })) as ArenaLayout['groundHazardZones']);
      const sources = resolvePermanentVoidHazardSources(map, layout, 0, 0);
      expect(sources.map(source => source.id), map.mapId).toEqual(events.map(event => `hazard:${event.id}`));
    }
    // Hazards that start later or spread are warnings of their own, not standing danger.
    const later = COOP_DEFENSE_MAP_CONFIGS.flatMap(map => map.mapEvents ?? []).filter(event => event.type === 'ground-hazard' && !isPermanentVoidGroundHazard(event));
    for (const event of later) expect(event.spread !== undefined || event.start.type !== 'time' || event.start.atMs > 0 || (event.delayMs ?? 0) > 0
      || event.effect.visualStyle !== 'void').toBe(true);
  });

  it('lifts the haze of destroyed bases and closed sites, and of nothing else', () => {
    let objectives: CoopDefenseSecondaryObjectivePresentationState = [];
    const bases = new Map([
      ['hive', { destroyed: false, spec: {} }],
      ['site-a', { destroyed: false, spec: { dormantObjectiveId: 'salvage-a' } }],
    ]);
    const danger = new CoopMissionVoidDanger({
      getMapConfig: () => COOP_DEFENSE_MAP_CONFIGS[0] as CoopDefenseMapConfig,
      getLayout: () => layoutWith([]),
      getOffset: () => ({ offsetX: 0, offsetY: 0 }),
      getBase: id => { const base = bases.get(id); return base && { isDestroyed: () => base.destroyed, getSpec: () => base.spec }; },
      getObjectives: () => objectives,
    });
    expect(danger.read()).toBe(danger);
    expect(danger.presenceOf('base:hive')).toBe(1);
    expect(danger.presenceOf('zone:nest-1')).toBe(1);
    expect(danger.presenceOf('base:unknown')).toBe(1);
    bases.get('hive')!.destroyed = true;
    expect(danger.presenceOf('base:hive')).toBe(0);
    const entry = (state: 'active' | 'failed' | 'completed') => [{ objectiveId: 'salvage-a', type: 'destroy-target', state, focused: false,
      progressCurrent: 0, progressTotal: 1, stateChangedAtMs: 0 }] as unknown as CoopDefenseSecondaryObjectivePresentationState;
    objectives = entry('active');
    expect(danger.presenceOf('base:site-a')).toBe(1);
    // A Dawn site closed at dusk fails its objective; its base still stands.
    objectives = entry('failed');
    expect(danger.presenceOf('base:site-a')).toBe(0);
  });

  it('answers nothing while no mission World is laid out', () => {
    const danger = new CoopMissionVoidDanger({
      getMapConfig: () => null, getLayout: () => null, getOffset: () => null, getBase: () => undefined, getObjectives: () => null,
    });
    expect(danger.read()).toBeNull();
    expect(danger.sources).toEqual([]);
  });
});
