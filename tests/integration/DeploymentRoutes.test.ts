import { describe, expect, it } from 'vitest';
import { DeploymentRoutePlanner } from '../../src/activity/DeploymentRoutes';
import { CELL_SIZE, getAuthoredWorldMetricsProfile } from '../../src/config';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { getPersistentBaseEditorDetailWindow, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS } from '../../src/persistentBase/PersistentBaseExpansionPreview';
import { resolveWorldDefinition } from '../../src/world/WorldDefinitionResolution';
import { toWorldDefinitionId } from '../../src/world/arenaDescriptorAdapter';
import { createWorldRuntimeContext } from '../../src/world/WorldRuntimeContext';
import { generateRoundWorldLayout } from '../../src/world/RoundWorldLayout';
import { ARENA_GENERATOR_VERSION } from '../../src/arena/ArenaGenerator';

function planFor(mapId: string, seed = 4242) {
  const mapConfig = getCoopDefenseMapConfig(mapId);
  const definition = resolveWorldDefinition({ definitionId: toWorldDefinitionId(mapId) }, null)!;
  const layout = generateRoundWorldLayout(COOP_DEFENSE_MODE, mapConfig, seed);
  const profile = getAuthoredWorldMetricsProfile(definition.metrics.widthCells, definition.metrics.heightCells);
  const world = createWorldRuntimeContext({ definition, metricsProfile: { ...profile, arenaOffsetX: 0, arenaOffsetY: 0 }, descriptor: {
    worldRevision: 1, definitionId: definition.id, seed, generatorVersion: ARENA_GENERATOR_VERSION, layoutFingerprint: 'test',
    parameters: { persistentBaseUnlocked: true, persistentBaseAreaStage: 2, persistentBaseHealthRewards: [] } } });
  const site = world.persistentBaseSite!;
  const detail = getPersistentBaseEditorDetailWindow({ widthCells: world.metrics.gridCols, heightCells: world.metrics.gridRows },
    site.anchor, PERSISTENT_BASE_EDITOR_DETAIL_RADIUS);
  const planner = new DeploymentRoutePlanner({ mapConfig, worldMetrics: world.metrics, layout,
    bases: world.bases.filter((base) => !base.dormant), spawnFocusCell: definition.spawnFocusCell,
    detail: { x: detail.minX * CELL_SIZE, y: detail.minY * CELL_SIZE,
      width: (detail.maxX - detail.minX + 1) * CELL_SIZE, height: (detail.maxY - detail.minY + 1) * CELL_SIZE } });
  return { planner, site, world };
}

describe('situation map routes', () => {
  it.each(['2', '3', '6', '8', '10', '11', '13', '15', '18', '19', '20'])('shows routes that reach the base area on map %s', (mapId) => {
    const { planner } = planFor(mapId);
    const plan = planner.plan([]);
    planner.destroy();
    expect(plan.mode).toBe('routes');
    expect(plan.routes.some((route) => route.relevant && route.reachedGoal)).toBe(true);
  });

  it.each([['4', 'front-base'], ['5', 'front-base'], ['12', 'front-base'], ['14', 'front-base'], ['17', 'front-base'],
    ['16', 'players-away']] as const)('explains on map %s why no route reaches the base (%s)', (mapId, hint) => {
    const { planner } = planFor(mapId);
    const plan = planner.plan([]);
    planner.destroy();
    expect(plan.mode).toBe('terrain');
    expect(plan.hint).toBe(hint);
  });

  it('turns a sealed base into a breach on its wall', () => {
    const { planner, site } = planFor('18');
    // A ring of walls around the core closes every way in.
    const ring: { gridX: number; gridY: number }[] = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 5) ring.push({ gridX: site.anchor.gridX + dx, gridY: site.anchor.gridY + dy });
    }
    const open = planner.plan([]);
    const sealed = planner.plan(ring);
    planner.destroy();
    expect(open.routes.every((route) => route.breach === null)).toBe(true);
    const breached = sealed.routes.filter((route) => route.target.kind === 'bases' && route.breach);
    expect(breached.length).toBeGreaterThan(0);
    for (const route of breached) {
      const cell = { gridX: Math.floor(route.breach!.x / CELL_SIZE), gridY: Math.floor(route.breach!.y / CELL_SIZE) };
      expect(Math.max(Math.abs(cell.gridX - site.anchor.gridX), Math.abs(cell.gridY - site.anchor.gridY))).toBe(5);
    }
  });
});
