import { describe, expect, it } from 'vitest';
import { DEPLOYMENT_ROUTE_START, DeploymentRoutePlanner } from '../../src/activity/DeploymentRoutes';
import { CELL_SIZE, getAuthoredWorldMetricsProfile } from '../../src/config';
import { getCoopDefenseMapConfig } from '../../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { getPersistentBaseEditorDetailRect } from '../../src/persistentBase/PersistentBaseExpansionPreview';
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
  const detail = getPersistentBaseEditorDetailRect({ widthCells: world.metrics.gridCols, heightCells: world.metrics.gridRows }, site.anchor);
  const planner = new DeploymentRoutePlanner({ mapConfig, worldMetrics: world.metrics, layout,
    bases: world.bases.filter((base) => !base.dormant), persistentBaseId: world.persistentBaseSite?.baseId ?? null,
    spawnFocusCell: definition.spawnFocusCell,
    detail });
  return { planner, site, world };
}

describe('situation map routes', () => {
  it.each(['2', '3', '5', '6', '8', '10', '11', '13', '15', '18', '19', '20'])('shows routes that reach the base area on map %s', (mapId) => {
    const { planner } = planFor(mapId);
    const plan = planner.plan([]);
    planner.destroy();
    expect(plan.mode).toBe('routes');
    expect(plan.routes.some((route) => route.relevant && route.reachedGoal)).toBe(true);
  });

  it.each([['4', 'front-base'], ['12', 'front-base'], ['14', 'front-base'], ['17', 'front-base'],
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

  it.each(['2', '3', '6', '8', '10', '11', '13', '15', '18', '19', '20'])('ends routes at the base wall, never deep inside it, on map %s', (mapId) => {
    const { planner, site } = planFor(mapId);
    const plan = planner.plan([]);
    planner.destroy();
    // The persistent core spans three cells to every side of the hearth; enemies stop at its walls.
    for (const route of plan.routes) {
      const end = route.points[route.points.length - 1];
      if (!route.reachedGoal || !end) continue;
      const cell = { gridX: Math.floor(end.x / CELL_SIZE), gridY: Math.floor(end.y / CELL_SIZE) };
      expect(Math.max(Math.abs(cell.gridX - site.anchor.gridX), Math.abs(cell.gridY - site.anchor.gridY))).toBeGreaterThanOrEqual(3);
    }
  });

  it('offers only the what-ifs a map has: fallen outposts, blown bridges, open teleporters', () => {
    const options = (mapId: string) => { const { planner } = planFor(mapId); const result = planner.scenarioOptions; planner.destroy(); return result; };
    expect(options('4')).toEqual({ outposts: true, bridges: false, teleporters: false });
    expect(options('12')).toMatchObject({ outposts: true, bridges: true });
    expect(options('8')).toMatchObject({ teleporters: true, bridges: false });
  });

  it('sends the enemies to the persistent base once the forward base has fallen', () => {
    const { planner } = planFor('4');
    expect(planner.plan([]).mode).toBe('terrain');
    const fallen = planner.plan([], { ...DEPLOYMENT_ROUTE_START, outpostsDestroyed: true });
    expect(fallen.mode).toBe('routes');
    expect(fallen.routes.some((route) => route.relevant && route.reachedGoal)).toBe(true);
    // Back to the round as it starts.
    expect(planner.plan([]).mode).toBe('terrain');
    planner.destroy();
  });

  // On map 12 the routes reach the river only once the forward base has fallen.
  it.each([['12', { outpostsDestroyed: true }, 'bridgesDestroyed'], ['8', {}, 'teleportersOpen']] as const)('replans the routes on map %s for %s', (mapId, base, flag) => {
    const { planner } = planFor(mapId);
    const shape = (plan: ReturnType<typeof planner.plan>) => plan.routes.map((route) => route.points.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`).join(' ')).join('|');
    const scenario = { ...DEPLOYMENT_ROUTE_START, ...base };
    const start = shape(planner.plan([], scenario));
    const whatIf = shape(planner.plan([], { ...scenario, [flag]: true }));
    expect(whatIf).not.toBe(start);
    expect(shape(planner.plan([], scenario))).toBe(start);
    planner.destroy();
  });
});
