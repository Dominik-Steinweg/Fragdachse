import { describe, expect, it } from 'vitest';
import {
  getCoopMissionTimeLimitSec,
  normalizeCoopDefenseMapConfig,
  resolveCoopDefenseRespawnDelayMs,
  type CoopDefenseMapAuthoringConfig,
} from '../src/config/coopDefenseMapAuthoring';
import { toAuthoredScenario, toCoopDefenseMapConfig } from '../src/config/authoring/coopDefenseAuthoringAdapter';
import { getDawnSchedule } from '../src/config/dawn/dawnContent';
import { parseDawnWorldPlan } from '../src/dawn/contracts/DawnPlans';
import { resolveDawnPhase, toDawnDynamicTimeOfDay } from '../src/dawn/rules/DawnPhase';

/** Kleinste Map mit den Dawn-Erweiterungen des Coop-Authorings. */
function dawnLikeMap(overrides: Partial<CoopDefenseMapAuthoringConfig> = {}): CoopDefenseMapAuthoringConfig {
  return {
    mapId: 'dawn-authoring-contract',
    objective: 'defend-until-dawn',
    surviveDurationSec: 480,
    balanceReferenceDurationSec: 480,
    arenaWidthCells: 80,
    arenaHeightCells: 60,
    trackMode: 'none',
    persistentBase: { baseId: 'core', anchor: { gridX: 40, gridY: 30 } },
    bases: [{
      id: 'wreck-near-1', role: 'outpost', faction: 'hostile', hpMax: 200, dormant: true,
      anchor: { kind: 'grid', gridX: 10, gridY: 8 },
      shape: { kind: 'cells', cells: [{ gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 0, gridY: 1 }, { gridX: 1, gridY: 1 }] },
    }],
    powerUps: [],
    siteClearings: [{ id: 'near-1', gridX: 11, gridY: 9, radiusCells: 3 }],
    secondaryObjectives: [{
      id: 'site-near-1', type: 'destroy',
      start: { type: 'site-activated', siteId: 'near-1' },
      expiresAt: { type: 'time', atMs: 210_000 },
      concurrent: true,
      targets: ['wreck-near-1'],
    }],
    ...overrides,
  } as CoopDefenseMapAuthoringConfig;
}

describe('Dawn extensions of the Coop authoring contract', () => {
  it('normalizes surfaces without changing default configs and keeps them on the World side', () => {
    const input = dawnLikeMap();
    const withSurface = (surface: unknown) => ({ ...input,
      bases: input.bases!.map(base => ({ ...base, surface })),
    }) as CoopDefenseMapAuthoringConfig;
    const baseline = normalizeCoopDefenseMapConfig(input);
    expect(normalizeCoopDefenseMapConfig(withSurface('cells'))).toEqual(baseline);
    expect(baseline.bases.every(base => !Object.hasOwn(base, 'surface'))).toBe(true);
    const map = normalizeCoopDefenseMapConfig(withSurface('none'));
    const scenario = toAuthoredScenario(map);
    expect(scenario.world.bases.find(base => base.id === input.bases![0].id)?.surface).toBe('none');
    expect(JSON.stringify(scenario.activity)).not.toContain('surface');
    expect(toCoopDefenseMapConfig(scenario)).toEqual(map);
    for (const invalid of ['invalid', '', null, false, 1]) {
      expect(() => normalizeCoopDefenseMapConfig(withSurface(invalid))).toThrow('surface');
    }
  });
  it('normalizes a timed defend-until-dawn mission with site-bound objectives', () => {
    const map = normalizeCoopDefenseMapConfig(dawnLikeMap());

    expect(map.objective).toBe('defend-until-dawn');
    expect(getCoopMissionTimeLimitSec(map)).toBe(map.surviveDurationSec);
    expect(map.secondaryObjectives?.[0].start).toEqual({ type: 'site-activated', siteId: 'near-1' });
    expect(map.secondaryObjectives?.[0].expiresAt).toEqual({ type: 'time', atMs: 210_000 });
    expect(map.siteClearings).toEqual(dawnLikeMap().siteClearings);
  });

  it('keeps site clearings on the World side of the adapter round trip', () => {
    const map = normalizeCoopDefenseMapConfig(dawnLikeMap());
    const scenario = toAuthoredScenario(map);

    expect(scenario.world.terrain.siteClearings).toEqual(map.siteClearings);
    expect(toCoopDefenseMapConfig(scenario)).toEqual(map);
  });

  it('rejects unknown sites, missing mission time and misplaced clearings', () => {
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({ siteClearings: [] }))).toThrow('unknown site');
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({ surviveDurationSec: undefined })))
      .toThrow('surviveDurationSec');
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({
      siteClearings: [{ id: 'near-1', gridX: 200, gridY: 9, radiusCells: 3 }],
    }))).toThrow('outside the arena');
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({
      siteClearings: [{ id: 'near-1', gridX: 11, gridY: 9, radiusCells: 0 }],
    }))).toThrow('radius');
  });

  it('resolves a phase-based respawn delay schedule and keeps it on the Activity side', () => {
    const respawnDelaySchedule = [{ fromMs: 0, delayMs: 2000 }, { fromMs: 255_000, delayMs: 6000 }];
    const map = normalizeCoopDefenseMapConfig(dawnLikeMap({ respawnDelaySchedule }));

    expect(toAuthoredScenario(map).activity?.respawnDelaySchedule).toEqual(respawnDelaySchedule);
    expect(resolveCoopDefenseRespawnDelayMs(map.respawnDelaySchedule, 254_999)).toBe(2000);
    expect(resolveCoopDefenseRespawnDelayMs(map.respawnDelaySchedule, 255_000)).toBe(6000);
    expect(resolveCoopDefenseRespawnDelayMs(undefined, 1)).toBeNull();
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({ respawnDelaySchedule: [{ fromMs: 5, delayMs: 1 }] })))
      .toThrow('respawnDelaySchedule');
  });

  it('keeps concurrent site objectives free of a focus window', () => {
    expect(normalizeCoopDefenseMapConfig(dawnLikeMap()).secondaryObjectives?.[0].concurrent).toBe(true);
    const [objective] = dawnLikeMap().secondaryObjectives!;
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({
      secondaryObjectives: [{ ...objective, focusUntil: { type: 'time', atMs: 1 } }],
    }))).toThrow('must not declare focusUntil');
  });

  it('lets encounters start on a known site activation only', () => {
    const encounter = { id: 'site-assault', start: { type: 'site-activated', siteId: 'near-1' } as const,
      groups: [{ enemyKind: 'zombie-badger', count: 3, spawnArea: { gridX: 12, gridY: 9, widthCells: 3, heightCells: 3 } }] };
    expect(normalizeCoopDefenseMapConfig(dawnLikeMap({ encounters: [encounter] })).encounters?.[0].start)
      .toEqual({ type: 'site-activated', siteId: 'near-1' });
    expect(() => normalizeCoopDefenseMapConfig(dawnLikeMap({
      encounters: [{ ...encounter, start: { type: 'site-activated', siteId: 'elsewhere' } }],
    }))).toThrow('unknown site');
  });

  it('has no time limit for untimed objectives', () => {
    expect(getCoopMissionTimeLimitSec({ objective: 'repel-assault' })).toBeNull();
  });
});

describe('Dawn phase rules', () => {
  const schedule = getDawnSchedule('standard');

  it('resolves every phase boundary from the schedule alone', () => {
    for (const [index, phase] of schedule.phases.entries()) {
      const state = resolveDawnPhase(schedule, phase.startMs);
      expect(state.phase).toBe(phase.id);
      expect(state.phaseStartMs).toBe(phase.startMs);
      expect(state.phaseEndMs).toBe(schedule.phases[index + 1]?.startMs ?? schedule.durationMs);
      expect(state.finished).toBe(false);
    }
    expect(resolveDawnPhase(schedule, -5).phase).toBe(schedule.phases[0].id);
    expect(resolveDawnPhase(schedule, schedule.durationMs).finished).toBe(true);
  });

  it('derives continuous time-of-day transitions the Coop normalizer accepts', () => {
    const dynamicTimeOfDay = toDawnDynamicTimeOfDay(schedule);
    const map = normalizeCoopDefenseMapConfig(dawnLikeMap({ dynamicTimeOfDay }));

    expect(map.dynamicTimeOfDay?.transitions).toHaveLength(schedule.phases.length);
    expect(dynamicTimeOfDay.transitions?.reduce((sum, transition) => sum + transition.durationMs, 0))
      .toBe(schedule.durationMs);
  });
});

describe('Dawn world plan sites', () => {
  const plan = { version: 1, templateId: 'clearing', contentHash: '0123456789abcdef', sites: [] as unknown[] };

  it('accepts occupied slots and rejects duplicates and unknown tiers', () => {
    const site = { slotId: 'near-1', archetypeId: 'wreck', tier: 1 };
    expect(parseDawnWorldPlan({ ...plan, sites: [site] })?.sites).toEqual([site]);
    expect(parseDawnWorldPlan({ ...plan, sites: [site, site] })).toBeNull();
    expect(parseDawnWorldPlan({ ...plan, sites: [{ ...site, tier: 0 }] })).toBeNull();
    expect(parseDawnWorldPlan({ ...plan, sites: undefined })).toBeNull();
  });
});
