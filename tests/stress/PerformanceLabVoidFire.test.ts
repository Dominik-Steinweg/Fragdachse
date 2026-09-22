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
import { referenceMap, VOID_FIRE_MAP_ID, REFERENCE_SEED } from '../../src/debug/performanceLab/referenceMap';
import { resolvePerformanceCases } from '../../src/debug/performanceLab/scenarios';
import { FireSystem, GROUND_FIRE_CELL_SIZE } from '../../src/effects/FireSystem';
import { CoopDefenseGroundHazardEventHandler } from '../../src/systems/CoopDefenseGroundHazardEventHandler';
import { CoopDefenseMapEventDirector } from '../../src/systems/CoopDefenseMapEventDirector';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';

describe('Performance lab VoidFire load', () => {
  it('ignites the full generated footprint, sustains it and releases it through the authored event lifecycle', () => {
    const map = normalizeCoopDefenseMapConfig(referenceMap(VOID_FIRE_MAP_ID));
    const test = resolvePerformanceCases('hazards.void-fire')[0];
    const metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
    const layout = ArenaGenerator.generate(REFERENCE_SEED, resolveArenaGenerationInput('coop_defense', metrics), map);
    const area = fixture.voidFire.area;
    const expected = area.widthCells * area.heightCells * (CELL_SIZE / GROUND_FIRE_CELL_SIZE) ** 2;
    const inArea = (cell: { gridX: number; gridY: number }) => cell.gridX >= area.gridX && cell.gridX < area.gridX + area.widthCells
      && cell.gridY >= area.gridY && cell.gridY < area.gridY + area.heightCells;
    expect(test.mapId).toBe(map.mapId);
    expect(layout.groundHazardZones!.flatMap(zone => zone.cells)).toHaveLength(area.widthCells * area.heightCells);
    expect([...layout.rocks, ...layout.trees, ...layout.powerUpPedestals].some(inArea)).toBe(false);
    expect(map.water?.some(inArea)).toBe(false);
    expect(layout.rocks.length).toBeGreaterThanOrEqual(fixture.minimumGlobalRocks);

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
