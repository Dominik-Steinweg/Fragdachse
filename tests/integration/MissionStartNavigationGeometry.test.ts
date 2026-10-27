import { describe, expect, it } from 'vitest';
import { ARENA_GENERATOR_VERSION } from '../../src/arena/ArenaGenerator';
import { getAuthoredWorldMetricsProfile } from '../../src/config';
import { resolveCoopDefenseMapMissionProgress } from '../../src/config/coopDefenseMapAuthoring';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { buildMissionStartNavigationGeometry } from '../../src/systems/navigation/MissionStartNavigationGeometry';
import { toWorldDefinitionId } from '../../src/world/arenaDescriptorAdapter';
import { resolveObstacleIdPartition } from '../../src/world/reactiveProps/ReactivePropObstacleIds';
import { generateRoundWorldLayout } from '../../src/world/RoundWorldLayout';
import { resolveWorldDefinition } from '../../src/world/WorldDefinitionResolution';
import { createWorldRuntimeContext } from '../../src/world/WorldRuntimeContext';

/**
 * The situation map plans routes on data geometry. It must speak the obstacle language of the
 * round's index (ArenaBuilder proxies, BaseEntity bodies, barrier bodies), or previewed routes
 * drift from the paths enemies take.
 */
describe('mission start navigation geometry', () => {
  it.each(['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'])('uses the round obstacle ids on map %s', (mapId) => {
    const mapConfig = getCoopDefenseMapConfig(mapId);
    const definition = resolveWorldDefinition({ definitionId: toWorldDefinitionId(mapId) }, null)!;
    const layout = generateRoundWorldLayout(COOP_DEFENSE_MODE, mapConfig, 77);
    const profile = getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells);
    const world = createWorldRuntimeContext({ definition, metricsProfile: { ...profile, arenaOffsetX: 0, arenaOffsetY: 0 },
      descriptor: { worldRevision: 1, definitionId: definition.id, seed: 77, generatorVersion: ARENA_GENERATOR_VERSION,
        layoutFingerprint: 'test', parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 2, persistentBaseHealthRewards: [] } } });
    const bases = world.bases.filter((base) => !base.dormant);
    const barrierCells = resolveCoopDefenseMapMissionProgress(mapConfig)?.barriers.flatMap((barrier) => barrier.cells) ?? [];
    const construction = { gridX: world.persistentBaseSite?.anchor.gridX ?? 1, gridY: (world.persistentBaseSite?.anchor.gridY ?? 1) + 6 };
    const snapshot = buildMissionStartNavigationGeometry({ metrics: world.metrics, layout, bases, barrierCells,
      constructionCells: [construction] });

    // Layout rocks, then reactive props, then runtime constructions: the round's id partition.
    const partition = resolveObstacleIdPartition(layout);
    const rockIds = new Set(snapshot.obstacles.filter((obstacle) => obstacle.kind === 'rock').map((obstacle) => obstacle.id));
    expect(rockIds.size).toBe(partition.firstRuntimeObstacleId + 1);
    expect(rockIds.has(`rock:${partition.firstRuntimeObstacleId}`)).toBe(true);
    // One body per outline rect, otherwise one per cell, as BaseEntity creates them.
    for (const base of bases) {
      expect(snapshot.obstacles.filter((obstacle) => obstacle.id === `base:${base.id}`))
        .toHaveLength(base.collisionRects?.length ?? base.cells.length);
    }
    expect(snapshot.obstacles.filter((obstacle) => obstacle.kind === 'barrier')).toHaveLength(barrierCells.length);
    expect(snapshot.obstacles.filter((obstacle) => obstacle.shape === 'circle')).toHaveLength(layout.trees.length);
  });
});
