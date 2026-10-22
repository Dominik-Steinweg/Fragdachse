import { describe, expect, it } from 'vitest';
import {
  resolveSpawnEmergencePhase, resolveSpawnPitState, resolveSpawnStructureEyes, resolveSpawnStructureFade, resolveSpawnStructureGlow,
  SPAWN_EMERGENCE_PART_MS, SPAWN_EMERGENCE_SWELL_MS, SPAWN_STRUCTURE_STAIN_FADE_DELAY_MS, SPAWN_STRUCTURE_STAIN_FADE_MS,
  type SpawnEmergence, type SpawnStructureView,
} from '../src/effects/spawnStructure/SpawnStructureModel';

const view = (patch: Partial<SpawnStructureView> = {}): SpawnStructureView => ({
  id: 'spawn', x: 0, y: 0, outlet: 'east', hp: 100, maxHp: 100, dormant: false, destroyed: false, live: true,
  hpRevision: 0, wallCells: [], ...patch,
});

describe('spawn structure presentation model', () => {
  it('projects the nest state from replicated dormancy and the bound Activity only', () => {
    expect(resolveSpawnPitState(view())).toBe('active');
    expect(resolveSpawnPitState(view({ dormant: true }))).toBe('sealed');
    expect(resolveSpawnPitState(view({ live: false }))).toBe('sealed');
  });

  it('lets an announced release swell the light and flare the eyes; sealed eyes only smoulder', () => {
    const calm = resolveSpawnStructureGlow(view(), 0, 0), charged = resolveSpawnStructureGlow(view(), 0, 1);
    expect(charged.pit).toBeGreaterThan(calm.pit);
    expect(charged.lightIntensity).toBeGreaterThan(calm.lightIntensity);
    expect(charged.lightRadiusPx).toBeGreaterThan(calm.lightRadiusPx);
    expect(resolveSpawnStructureEyes(view(), 2000, 1)).toBeGreaterThan(resolveSpawnStructureEyes(view(), 2000, 0));
    expect(resolveSpawnStructureEyes(view({ dormant: true }), 2000, 1)).toBeLessThan(0.3);
  });

  it('bursts the skeleton at once and fades the stain softly, never popping', () => {
    expect(resolveSpawnStructureFade(null, 5000)).toMatchObject({ body: true, stain: 1, glow: 1 });
    expect(resolveSpawnStructureFade(1000, 1000)).toMatchObject({ body: false, stain: 1 });
    const mid = resolveSpawnStructureFade(1000, 1000 + SPAWN_STRUCTURE_STAIN_FADE_DELAY_MS + SPAWN_STRUCTURE_STAIN_FADE_MS / 2);
    expect(mid.stain).toBeGreaterThan(0.2);
    expect(mid.stain).toBeLessThan(0.8);
    expect(resolveSpawnStructureFade(1000, 1000 + SPAWN_STRUCTURE_STAIN_FADE_DELAY_MS + SPAWN_STRUCTURE_STAIN_FADE_MS).done).toBe(true);
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
