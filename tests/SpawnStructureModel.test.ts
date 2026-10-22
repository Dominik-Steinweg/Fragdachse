import { describe, expect, it } from 'vitest';
import {
  resolveSpawnEmergencePhase, resolveSpawnPitState, resolveSpawnStructureBuildingState, resolveSpawnStructureGlow,
  SPAWN_EMERGENCE_PART_MS, SPAWN_EMERGENCE_SWELL_MS, type SpawnEmergence, type SpawnStructureView,
} from '../src/effects/spawnStructure/SpawnStructureModel';

const view = (patch: Partial<SpawnStructureView> = {}): SpawnStructureView => ({
  id: 'spawn', x: 0, y: 0, outlet: 'east', hp: 100, maxHp: 100, dormant: false, destroyed: false, live: true,
  hpRevision: 0, wallCells: [], ...patch,
});

describe('spawn structure presentation model', () => {
  it('projects building and pit state from replicated HP, dormancy and the bound Activity only', () => {
    expect(resolveSpawnStructureBuildingState(view())).toBe('intact');
    expect(resolveSpawnStructureBuildingState(view({ hp: 40 }))).toBe('damaged');
    expect(resolveSpawnStructureBuildingState(view({ hp: 0, destroyed: true }))).toBe('rubble');
    expect(resolveSpawnPitState(view())).toBe('active');
    expect(resolveSpawnPitState(view({ dormant: true }))).toBe('sealed');
    expect(resolveSpawnPitState(view({ live: false }))).toBe('sealed');
    expect(resolveSpawnPitState(view({ destroyed: true }))).toBe('dry');
  });

  it('keeps the eyes smouldering while the structure stands and lets an announced release build up', () => {
    expect(resolveSpawnStructureGlow(view({ destroyed: true }), 0, 1).pit).toBe(0);
    expect(resolveSpawnStructureGlow(view({ dormant: true }), 0, 0).core).toBeGreaterThan(0);
    const calm = resolveSpawnStructureGlow(view(), 0, 0), charged = resolveSpawnStructureGlow(view(), 0, 1);
    expect(charged.pit).toBeGreaterThan(calm.pit);
    expect(charged.lightIntensity).toBeGreaterThan(calm.lightIntensity);
  });

  it('swells while the body is underground, parts once it surfaces and closes afterwards', () => {
    const emergence: SpawnEmergence = { enemyId: 'e', x: 0, y: 0, claimedAt: 1000, surfacedAt: null };
    expect(resolveSpawnEmergencePhase(emergence, 1000)).toBe(0);
    expect(resolveSpawnEmergencePhase(emergence, 1000 + SPAWN_EMERGENCE_SWELL_MS * 4)).toBeLessThan(0.75);
    emergence.surfacedAt = 2400;
    expect(resolveSpawnEmergencePhase(emergence, 2400)).toBe(0.75);
    expect(resolveSpawnEmergencePhase(emergence, 2400 + SPAWN_EMERGENCE_PART_MS / 2)).toBeCloseTo(0.875);
    expect(resolveSpawnEmergencePhase(emergence, 2400 + SPAWN_EMERGENCE_PART_MS)).toBeNull();
  });
});
