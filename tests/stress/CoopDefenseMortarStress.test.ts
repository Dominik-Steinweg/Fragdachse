import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { CoopDefenseMortarSystem } from '../../src/systems/CoopDefenseMortarSystem';
import { CoopDefenseMortarStrikeSystem } from '../../src/systems/CoopDefenseMortarStrikeSystem';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { EnemyFlowFieldService } from '../../src/systems/EnemyFlowFieldService';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { resolveActiveArenaWorldMetrics } from '../../src/world/WorldMetrics';
import { getCoopDefenseEnemyConfig } from '../../src/config/coopDefenseEnemies';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';
import type { ArenaLayout, SyncedPlaceableRock } from '../../src/types';

describe('mortar spatial work budget', () => {
  it('keeps query and LoS work independent of distant construction count with 100 enemies and eight mortars', () => {
    const config = getCoopDefenseEnemyConfig('mortar-badger').mortar!;
    const run = (distantCount: number) => {
      const layout: ArenaLayout = { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
      const grid = new RockGridIndex([], { cols: 512, rows: 512 });
      const placement = new PlacementSystem(layout, grid, { getAllPlayers: () => [] } as never,
        { ...resolveActiveArenaWorldMetrics(), offsetX: 0, offsetY: 0, maxX: 16384, maxY: 16384,
          widthPx: 16384, heightPx: 16384, gridCols: 512, gridRows: 512 });
      const rock = (id: number, gridX: number, gridY: number) => ({ id, gridX, gridY, hp: 100, maxHp: 100,
        kind: 'turret', targetRange: config.maxRangePx, turretWeaponId: 'TURRET_ROCKET_BURST',
        ownerId: 'builder', ownerColor: 0xffffff, angle: 0 } as SyncedPlaceableRock);
      placement.syncFromSnapshot([
        ...Array.from({ length: 32 }, (_, id) => rock(id, 32 + id % 8, 12 + Math.floor(id / 8))),
        ...Array.from({ length: distantCount }, (_, id) => rock(id + 32, 200 + id % 200, 200 + Math.floor(id / 200))),
      ]);
      const scan = vi.spyOn(grid, 'getIndex');
      const globalScan = vi.spyOn(placement, 'getAllRuntimeRocks').mockImplementation(() => { throw new Error('Mortar performed a world scan'); });
      const visited = new Set<number>();
      const query = placement.forEachRuntimeRockInRadius.bind(placement);
      vi.spyOn(placement, 'forEachRuntimeRockInRadius').mockImplementation((x, y, radius, visit) => query(x, y, radius, entry => {
        visited.add(entry.id); visit(entry);
      }));
      const field = new EnemyFlowFieldService(layout, [], { cols: 128, rows: 128, cellSize: 32, arenaOffsetX: 0, arenaOffsetY: 0 },
        { goalMode: 'dynamic', dynamicGoalCells: [{ gridX: 32, gridY: 16 }] });
      const enemies = Array.from({ length: 100 }, (_, index) => ({ id: `enemy:${index}`, kind: index < 8 ? 'mortar-badger' : 'zombie-badger',
        faction: 'hostile', sprite: { active: true, x: 528, y: 528 }, getHp: () => 45,
        getMoveSpeed: () => 60, getCollisionRadius: () => 15, getAttackWeapons: () => [],
        faceAngle: () => {}, stopMovement: () => {}, pauseAttackMovement: () => {},
      } as unknown as EnemyEntity));
      const players = Array.from({ length: 4 }, (_, id) => ({ id: `player:${id}`, active: true, x: 1200, y: 528 + id * 32 }));
      const catalog = new EnemyAiTargetCatalog();
      catalog.updateTargets(players.map(player => ({ ...player, kind: 'player' as const })));
      const los = vi.fn(() => true);
      const mortar = new CoopDefenseMortarSystem({ getAllEnemies: () => enemies }, { getAllPlayers: () => players } as never,
        { isAlive: () => true, hasLineOfSight: los }, catalog, null, placement, new CoopDefenseMortarStrikeSystem({ impact: () => {} }), field);
      mortar.hostUpdate(0);
      expect(los.mock.calls.length).toBeLessThanOrEqual(8 * (1 + config.positionCandidateRings * config.positionCandidateDirections) * config.maxCoverThreats);
      expect(los.mock.calls.length).toBeGreaterThan(0);
      expect([...visited].every(id => id < 32)).toBe(true);
      expect(globalScan).not.toHaveBeenCalled();
      const costs = { cells: scan.mock.calls.length, los: los.mock.calls.length };
      los.mockClear(); scan.mockClear();
      for (let frame = 1; frame < 10; frame++) mortar.hostUpdate(frame);
      expect(los).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
      mortar.clear(); field.destroy();
      return costs;
    };
    expect(run(30000)).toEqual(run(0));
  });
});
