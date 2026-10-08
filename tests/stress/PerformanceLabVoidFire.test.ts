import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

vi.mock('phaser', () => ({
  Geom: { Rectangle: class {
    constructor(public x: number, public y: number, public width: number, public height: number) {}
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
    get centerX() { return this.x + this.width / 2; }
    get centerY() { return this.y + this.height / 2; }
  } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
}));

import { ArenaGenerator, resolveArenaGenerationInput } from '../../src/arena/ArenaGenerator';
import { CELL_SIZE, applyArenaMetricsForMode } from '../../src/config';
import { normalizeCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { PERFORMANCE_FIXTURE as fixture } from '../../src/debug/performanceLab/fixtures';
import { referenceMap, VOID_FIRE_MAP_ID, MAP14_FIRE_MAP_ID, MAP15_MAP_ID, REFERENCE_SEED } from '../../src/debug/performanceLab/referenceMap';
import { resolvePerformanceCases } from '../../src/debug/performanceLab/scenarios';
import { FireSystem, GROUND_FIRE_CELL_SIZE } from '../../src/effects/FireSystem';
import { CoopDefenseGroundHazardEventHandler } from '../../src/systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseMapEventDirector } from '../../src/systems/CoopDefenseMapEventDirector';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';

describe('Performance lab VoidFire load', () => {
  it('expands Map 15 patches only after the boss trigger and cleans up all permanent sources', () => {
    const map = normalizeCoopDefenseMapConfig(referenceMap(MAP15_MAP_ID));
    const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
    const layout = ArenaGenerator.generate(REFERENCE_SEED, resolveArenaGenerationInput('coop_defense', metrics), map);
    const expansion = map.mapEvents!.find(event => event.type === 'ground-hazard' && event.start.type === 'boss-phase')!;
    const initial = new Set(layout.groundHazardZones!.filter(zone => zone.eventId !== expansion.id)
      .flatMap(zone => zone.cells.map(cell => `${cell.gridX}:${cell.gridY}`)));
    const full = new Set(layout.groundHazardZones!.flatMap(zone => zone.cells.map(cell => `${cell.gridX}:${cell.gridY}`)));
    const subcells = (CELL_SIZE / GROUND_FIRE_CELL_SIZE) ** 2;
    applyArenaMetricsForMode('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    const fire = new FireSystem({} as Phaser.Scene);
    let now = 1_000_000, phaseTwo = false;
    const handler = new CoopDefenseGroundHazardEventHandler({ fireSystem: fire,
      prebuiltZones: layout.groundHazardZones!, worldMetrics: metrics, worldSeed: REFERENCE_SEED, getNowMs: () => now });
    const director = new CoopDefenseMapEventDirector(map.mapEvents!, [handler], {
      isTriggerSatisfied: start => start.type === 'boss-phase' && phaseTwo,
    });
    const step = (delta: number) => { now += delta; director.hostUpdate(delta, false); return fire.hostUpdate(now).ground; };
    try {
      expect(step(1000).cells).toHaveLength(initial.size * subcells);
      expect(step(60_000).cells).toHaveLength(initial.size * subcells);
      phaseTwo = true;
      step(0);
      step(expansion.spread!.durationMs / 2);
      const grown = step(expansion.spread!.durationMs / 2);
      expect(full.size).toBeGreaterThan(initial.size);
      expect(grown.cells).toHaveLength(full.size * subcells);
      expect(grown.warnings ?? []).toHaveLength(0);
      expect(step(resolvePerformanceCases('boss.map15')[0].durationMs).cells).toHaveLength(full.size * subcells);
      director.reset();
      expect(fire.getGroundState().cells).toHaveLength(0);
    } finally { director.reset(); fire.destroyAll(); applyArenaMetricsForMode('deathmatch', 'LOBBY'); }
  });
  it.each([
    [VOID_FIRE_MAP_ID, 'hazards.void-fire'], [MAP14_FIRE_MAP_ID, 'hazards.map14-fire'],
  ])('%s sustains its generated fire footprint and releases it through the authored event lifecycle', (mapId, caseId) => {
    const map = normalizeCoopDefenseMapConfig(referenceMap(mapId));
    const test = resolvePerformanceCases(caseId)[0];
    const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
    const layout = ArenaGenerator.generate(REFERENCE_SEED, resolveArenaGenerationInput('coop_defense', metrics), map);
    const area = map.mapEvents!.find(event => event.type === 'ground-hazard')!.area;
    if (area.type !== 'rectangle') throw new Error('Expected a firefront rectangle');
    const expected = area.widthCells * area.heightCells * (CELL_SIZE / GROUND_FIRE_CELL_SIZE) ** 2;
    const inArea = (cell: { gridX: number; gridY: number }) => cell.gridX >= area.gridX && cell.gridX < area.gridX + area.widthCells
      && cell.gridY >= area.gridY && cell.gridY < area.gridY + area.heightCells;
    expect(test.mapId).toBe(map.mapId);
    expect(layout.groundHazardZones!.flatMap(zone => zone.cells)).toHaveLength(area.widthCells * area.heightCells);
    if (mapId === VOID_FIRE_MAP_ID) {
      expect([...layout.rocks, ...layout.trees, ...layout.powerUpPedestals].some(inArea)).toBe(false);
      expect(map.water?.some(inArea)).toBe(false);
      expect(layout.rocks.length).toBeGreaterThanOrEqual(fixture.minimumGlobalRocks);
    } else {
      expect(layout.rocks.some(inArea)).toBe(true);
      expect(map.water?.some(inArea)).toBe(true);
    }

    applyArenaMetricsForMode('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    const fire = new FireSystem({} as Phaser.Scene);
    let now = 1_000_000;
    const handler = new CoopDefenseGroundHazardEventHandler({ fireSystem: fire,
      prebuiltZones: layout.groundHazardZones!, worldMetrics: metrics, worldSeed: REFERENCE_SEED, getNowMs: () => now });
    const director = new CoopDefenseMapEventDirector(map.mapEvents!, [handler]);
    const step = (delta: number) => { now += delta; director.hostUpdate(delta, false); return fire.hostUpdate(now).ground; };
    try {
      director.hostUpdate(fixture.voidFire.spread.durationMs, true);
      expect(fire.getGroundState().cells).toHaveLength(0);
      const growing = step(fixture.voidFire.spread.durationMs / 2);
      expect(growing.cells.length).toBeGreaterThan(0);
      expect(growing.cells.length).toBeLessThan(expected);
      const full = step(fixture.voidFire.spread.durationMs / 2);
      expect(full.cells).toHaveLength(expected);
      expect(full.cells.every(cell => cell.visualStyle === 'void' && cell.expiresAt === Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(full.warnings ?? []).toHaveLength(0);
      for (let elapsed = 0; elapsed <= test.durationMs + test.tailMs; elapsed += 500) {
        expect(step(500).cells).toHaveLength(expected);
      }
      director.reset();
      expect(fire.getGroundState().cells).toHaveLength(0);
      expect(fire.getGroundState().warnings ?? []).toHaveLength(0);
    } finally {
      director.reset(); fire.destroyAll();
      applyArenaMetricsForMode('deathmatch', 'LOBBY');
    }
  });
});
