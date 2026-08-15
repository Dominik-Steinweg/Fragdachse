import { describe, expect, it } from 'vitest';
import type { CoopDefenseEncounterPresentationState } from '../src/types';
import { buildMainObjectiveViewModel } from '../src/ui/coopDefenseMainObjectiveModel';

function encounter(
  sequenceIndex: number,
  phase: CoopDefenseEncounterPresentationState['phase'],
  sequenceCount = 4,
): CoopDefenseEncounterPresentationState {
  return {
    encounterId: `wave-${sequenceIndex}`,
    sequenceIndex,
    sequenceCount,
    phase,
    phaseStartedAtMs: 0,
    phaseEndsAtMs: null,
    encounterFronts: ['west'],
    fronts: ['west'],
  };
}

describe('buildMainObjectiveViewModel', () => {
  it('shows elapsed survival time and fills toward the duration', () => {
    const model = buildMainObjectiveViewModel({
      mapId: 'survival',
      objective: 'survive',
      elapsedMs: 45_000,
      surviveDurationSec: 90,
      encounterCount: 0,
      encounter: null,
      boss: null,
      hostileBases: null,
    });

    expect(model.progressLabel).toBe('0:45 / 1:30');
    expect(model.progress).toBe(0.5);
  });

  it('uses remaining boss health as boss progress', () => {
    const model = buildMainObjectiveViewModel({
      mapId: 'boss',
      objective: 'defeat-boss',
      elapsedMs: 0,
      encounterCount: 0,
      encounter: null,
      boss: { currentHp: 750, maxHp: 1_000 },
      hostileBases: null,
    });

    expect(model.progressLabel).toBe('750 / 1000 HP');
    expect(model.progress).toBe(0.75);
  });

  it('counts destroyed hostile bases when several bases form the objective', () => {
    const model = buildMainObjectiveViewModel({
      mapId: 'bases',
      objective: 'destroy-hostile-bases',
      elapsedMs: 0,
      encounterCount: 0,
      encounter: null,
      boss: null,
      hostileBases: { currentHp: 400, maxHp: 1_200, remaining: 2, total: 3 },
    });

    expect(model.progressLabel).toBe('1 / 3');
    expect(model.progress).toBeCloseTo(1 / 3);
  });

  it('fills toward destruction as a single hostile base loses health', () => {
    const model = buildMainObjectiveViewModel({
      mapId: 'base',
      objective: 'destroy-hostile-bases',
      elapsedMs: 0,
      encounterCount: 0,
      encounter: null,
      boss: null,
      hostileBases: { currentHp: 250, maxHp: 1_000, remaining: 1, total: 1 },
    });

    expect(model.progressLabel).toBe('250 / 1000 HP');
    expect(model.progress).toBe(0.75);
  });

  it('counts only cleared waves and completes after the full sequence', () => {
    const active = buildMainObjectiveViewModel({
      mapId: 'assault',
      objective: 'repel-assault',
      elapsedMs: 0,
      encounterCount: 4,
      encounter: encounter(3, 'active'),
      boss: null,
      hostileBases: null,
    });
    const complete = buildMainObjectiveViewModel({
      mapId: 'assault',
      objective: 'repel-assault',
      elapsedMs: 0,
      encounterCount: 4,
      encounter: encounter(4, 'complete'),
      boss: null,
      hostileBases: null,
    });

    expect(active.progressLabel).toBe('2 / 4');
    expect(active.progress).toBe(0.5);
    expect(complete.progressLabel).toBe('4 / 4');
    expect(complete.progress).toBe(1);
  });
});
