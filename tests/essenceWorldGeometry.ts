import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { buildLobbyWorldLayout } from '../src/arena/LobbyWorldLayout';
import { CELL_SIZE, getArenaMetricsProfile, getAuthoredWorldMetricsProfile, TRUNK_RADIUS } from '../src/config';
import { getLobbyWorldDefinition } from '../src/config/authoring/lobbyWorld';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { ArenaObstacleIndex, type ObstacleRectBody } from '../src/systems/ArenaObstacleIndex';
import { createWorldGeometryQueries } from '../src/world/WorldGeometryQueries';
import { resolveWorldMetrics, worldCellCenter, worldCellOrigin } from '../src/world/WorldMetrics';

/** Actual authored terrain and numeric obstacle queries, without its Phaser rendering/physics. */
export function essenceWorldGeometry(mode: 'coop_defense' | 'deathmatch' | 'lobby') {
  const map = mode === 'coop_defense' ? getCoopDefenseMapConfig('1') : undefined;
  const definition = getLobbyWorldDefinition();
  const metrics = resolveWorldMetrics(mode === 'lobby'
    ? getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells)
    : getArenaMetricsProfile(mode, 'ARENA', map?.arenaWidthCells, map?.arenaHeightCells));
  const layout = mode === 'lobby' ? buildLobbyWorldLayout()
    : ArenaGenerator.generate(74021, resolveArenaGenerationInput(mode, metrics), map);
  const body = (gridX: number, gridY: number): ObstacleRectBody => {
    const { x, y } = worldCellOrigin(metrics, gridX, gridY);
    return { active: true, getBounds: () => ({ x, y, width: CELL_SIZE, height: CELL_SIZE,
      left: x, top: y, right: x + CELL_SIZE, bottom: y + CELL_SIZE }) as never };
  };
  const rocks = layout.rocks.map(rock => body(rock.gridX, rock.gridY));
  const bases = map ? resolveCoopDefenseBases(map, metrics).flatMap(base => base.cells.map(cell => body(cell.gridX, cell.gridY))) : [];
  const trunks = layout.trees.map(tree => ({ ...worldCellCenter(metrics, tree.gridX, tree.gridY), radius: TRUNK_RADIUS, active: true }));
  const index = new ArenaObstacleIndex({
    bounds: () => ({ offsetX: metrics.offsetX, offsetY: metrics.offsetY, width: metrics.widthPx, height: metrics.heightPx }),
    rocks: () => rocks, bases: () => bases, trunks: () => trunks,
  });
  const geometry = createWorldGeometryQueries({ metrics, index });
  const openPoints = (clearance: number) => {
    const points: { x: number; y: number }[] = [];
    for (let y = 0; y < metrics.gridRows; y++) for (let x = 0; x < metrics.gridCols; x++) {
      const point = worldCellCenter(metrics, x, y);
      if (point.x - clearance < metrics.offsetX || point.x + clearance > metrics.offsetX + metrics.widthPx
        || point.y - clearance < metrics.offsetY || point.y + clearance > metrics.offsetY + metrics.heightPx) continue;
      if (!geometry.isCircleBlocked(point.x, point.y, clearance)) points.push(point);
    }
    return points;
  };
  return { metrics, geometry, index, openPoints };
}
