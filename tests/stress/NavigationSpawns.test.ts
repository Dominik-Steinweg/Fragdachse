import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
vi.mock('phaser', async () => {
  const fake = (await import('../fakeArenaRenderScene')).createFakePhaserModule() as any;
  fake.Math.Distance.Squared = (x: number, y: number, a: number, b: number) => (x - a) ** 2 + (y - b) ** 2;
  return fake;
});
import { ArenaGenerator, resolveArenaGenerationInput } from '../../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../../src/arena/BaseRegistry';
import { createRockPhysicsProxy } from '../../src/arena/rocks/RockPhysicsProxy';
import { createTreePhysicsProxy } from '../../src/arena/trees/TreePhysicsProxy';
import { WaterGeometry } from '../../src/arena/WaterGeometry';
import { getCoopDefenseMapConfig, resolveCoopDefenseMapEncounterConfigs, resolveCoopDefenseMapMissionProgress } from '../../src/config/coopDefenseMaps';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { EnemyManager } from '../../src/entities/EnemyManager';
import { CoopDefenseSpawnExecutor } from '../../src/systems/CoopDefenseSpawnExecutor';
import { CoopDefenseMapDirector } from '../../src/systems/CoopDefenseMapDirector';
import { CoopDefenseMissionProgressSystem } from '../../src/systems/CoopDefenseMissionProgressSystem';
import { ArenaObstacleIndex } from '../../src/systems/ArenaObstacleIndex';
import { EnemyFlowFieldService } from '../../src/systems/EnemyFlowFieldService';
import { FlowFieldCoordinator } from '../../src/systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldTuning } from '../../src/systems/flowfield/FlowFieldSources';
import { resolveCoopDefenseWorldMetrics, worldCellCenter } from '../../src/world/WorldMetrics';
import { NAVIGATION_BENCHMARK_SEEDS } from '../../src/debug/navigationLab/scenarios';
import { SPAWN_FRONTS } from '../../src/utils/spawnFront';
import { healthBarTestScene } from '../healthBarTestScene';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../../src/systems/navigation/EnemyIntentSystem';

function spawnWorld(mapId: string, seed: number) {
  const map = getCoopDefenseMapConfig(mapId), metrics = resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells);
  const layout = ArenaGenerator.generate(seed, resolveArenaGenerationInput('coop_defense', metrics), map);
  const scene = healthBarTestScene().scene;
  const addBody = scene.physics.add.existing;
  scene.physics.add.existing = (object: any) => {
    addBody(object);
    Object.defineProperty(object.body, 'halfWidth', { get: () => object.displayWidth / 2 });
    Object.defineProperty(object.body, 'halfHeight', { get: () => object.displayHeight / 2 });
  };
  const manager = new EnemyManager(scene, resolveCoopDefenseEnemyConfigs(1));
  manager.setWorldMetrics(metrics);
  const water = new WaterGeometry(layout.water ?? [], metrics); manager.setWaterGeometry(water);
  const rect = (cell: { gridX: number; gridY: number }) => {
    const p = worldCellCenter(metrics, cell.gridX, cell.gridY); return createRockPhysicsProxy(scene, p.x, p.y);
  };
  const rocks = layout.rocks.map(rect), bases = resolveCoopDefenseBases(map, metrics).flatMap(base => base.cells.map(rect));
  const trunks = layout.trees.map(cell => { const p = worldCellCenter(metrics, cell.gridX, cell.gridY); return createTreePhysicsProxy(scene, p.x, p.y); });
  const route = resolveCoopDefenseMapMissionProgress(map), cleared = new Set<string>();
  const progress = route && new CoopDefenseMissionProgressSystem(route, { roundRevision: 1, worldMetrics: metrics,
    isEncounterCleared: id => cleared.has(id), getDefenseObjectiveState: () => 'completed' });
  const barriers = route?.barriers.map(barrier => ({ id: barrier.id, bodies: barrier.cells.map(rect) })) ?? [];
  const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: metrics.offsetX, offsetY: metrics.offsetY, width: metrics.widthPx, height: metrics.heightPx }),
    rocks: () => rocks, bases: () => bases, trunks: () => trunks, barriers: () => barriers.flatMap(entry => entry.bodies) });
  index.setWaterGeometry(water);
  const nav = { cols: metrics.gridCols * 2 + 1, rows: metrics.gridRows * 2 + 1,
    cellSize: 16, pointOffset: 0, arenaOffsetX: metrics.offsetX, arenaOffsetY: metrics.offsetY };
  const coordinator = new FlowFieldCoordinator({ metrics: nav, tuning: createFlowFieldTuning(),
    staticKind: new Uint8Array(nav.cols * nav.rows), bases: [], activeBaseIds: new Set(), obstacleCellProvider: () => [],
    geometryProvider: () => index.snapshotMovementGeometry(), navTickIntervalMs: 100 });
  const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: 15 }));
  const executor = new CoopDefenseSpawnExecutor(manager, field, metrics, undefined, field);
  const target = (gx: number, gy: number) => {
    for (const barrier of barriers) for (const body of barrier.bodies) body.active = !progress?.isBarrierOpen(barrier.id);
    coordinator.invalidateGeometry();
    const center = worldCellCenter(metrics, gx, gy), geometry = coordinator.getGeometry()!;
    let chosen = center, distance = Infinity;
    for (let y = 0; y < metrics.gridRows; y++) for (let x = 0; x < metrics.gridCols; x++) {
      const p = worldCellCenter(metrics, x, y), d = Math.hypot(p.x - center.x, p.y - center.y);
      if (d < distance && geometry.isFree(p.x, p.y, 15)) { chosen = p; distance = d; }
    }
    const goal = field.worldToGrid(chosen.x, chosen.y)!;
    coordinator.setGoalCells('player', [goal.gridY * nav.cols + goal.gridX]); coordinator.prepareNow();
  };
  return { map, layout, metrics, manager, coordinator, field, executor, progress, route, cleared, target,
    clear: () => { for (const enemy of manager.getAllEnemies()) manager.hostRemoveEnemy(enemy.id); },
    destroy: () => { manager.destroy(); coordinator.destroy(); } };
}

describe('Authored spawns with body navigation', () => {
  it('pursues players through generated Map 3 rock layouts without persistent solitary stops', () => {
    const reports: unknown[] = [], failures: unknown[] = [];
    const layouts: { seed: number; fingerprint: string }[] = [], skipped: unknown[] = [];
    for (const seed of NAVIGATION_BENCHMARK_SEEDS) {
      const world = spawnWorld('3', seed), geometry = world.coordinator.getGeometry()!;
      layouts.push({ seed, fingerprint: ArenaGenerator.fingerprint(world.layout) });
      const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(world.coordinator, catalog);
      world.manager.setNavigationIntents(intents);
      const free: { x: number; y: number }[] = [];
      for (let y = 1; y < world.metrics.gridRows - 1; y++) for (let x = 1; x < world.metrics.gridCols - 1; x++) {
        const point = worldCellCenter(world.metrics, x, y);
        if (geometry.isFree(point.x, point.y, 15)) free.push(point);
      }
      for (const fraction of [.2, .5, .8]) {
        const target = free[Math.floor(free.length * fraction)];
        const targetRadius = 12;
        catalog.updateTargets([{ kind: 'player', id: 'runner', radius: targetRadius, ...target }]);
        for (let sample = 0; sample < 16; sample++) {
          const start = free[Math.floor((sample + .5) * free.length / 16)];
          const unit = world.manager.hostSpawnAtWorld(start.x, start.y, 'rabid-badger');
          intents.update([unit], 0); world.coordinator.prepareNow(); intents.update([unit], 120);
          const route = intents.get(unit.id)?.navigation;
          if (route?.status !== 'ready') { skipped.push({ seed, start, target, route }); world.clear(); continue; }
          let arrived = false, stillMs = 0, unsafe = 0;
          const attackRange = unit.getAttackWeapons()[0].weapon.config.range;
          const dt = 1000 / 60;
          for (let step = 0; step < 1800; step++) {
            const now = 240 + step * dt;
            world.coordinator.advance(dt); intents.update([unit], now);
            world.manager.hostUpdateMovement(world.field, world.field, world.field, null, false, now, dt);
            const { vx, vy } = unit.getDesiredVelocity(), x = unit.sprite.x, y = unit.sprite.y;
            const nx = x + vx * dt / 1000, ny = y + vy * dt / 1000;
            if (!geometry.canMove(x, y, nx, ny, unit.getSize() / 2)) { unsafe++; break; }
            unit.setPosition(nx, ny);
            (unit.sprite.body as { setVelocity(x: number, y: number): void }).setVelocity(vx, vy);
            if (Math.hypot(nx - target.x, ny - target.y) <= attackRange + targetRadius
              && geometry.canMove(nx, ny, target.x, target.y, 0)) { arrived = true; break; }
            stillMs = Math.hypot(nx - x, ny - y) < .05 ? stillMs + dt : 0;
            if (stillMs >= 10000) break;
          }
          const result = { seed, start, target, arrived, unsafe, stillMs, position: { x: unit.sprite.x, y: unit.sprite.y },
            intent: intents.get(unit.id), movement: world.manager.getMovementFeedback(unit.id),
            nearbyObstacles: !arrived ? geometry.snapshot.obstacles.filter(shape => shape.shape === 'rect'
              && Math.abs((shape.left + shape.right) / 2 - unit.sprite.x) < 48
              && Math.abs((shape.top + shape.bottom) / 2 - unit.sprite.y) < 48) : undefined };
          reports.push(result);
          if (!arrived || unsafe) failures.push(result);
          world.clear();
        }
      }
      intents.clear(); world.destroy();
    }
    mkdirSync('build/navigation-results', { recursive: true });
    writeFileSync('build/navigation-results/map3-pursuit.json', JSON.stringify({ scenarioVersion: 1, mapId: '3',
      scope: 'Generated World geometry, productive intents/locomotion, isolated body sweeps; no Arcade or combat execution.',
      layouts, skipped, reports, failures }, null, 2));
    expect(failures, JSON.stringify(failures.slice(0, 3))).toHaveLength(0);
  }, 180000);

  it('materializes normal enemies inside current free geometry across every map and ten seeds', () => {
    const reports: unknown[] = [];
    for (let id = 0; id <= 17; id++) for (const seed of NAVIGATION_BENCHMARK_SEEDS) {
      const world = spawnWorld(String(id), seed);
      world.target(Math.floor(world.metrics.gridCols / 2), Math.floor(world.metrics.gridRows / 2));
      let count = 0;
      for (const front of SPAWN_FRONTS) {
        // Closed fronts may legitimately have no route; every materialized body must be free.
        world.executor.hostSpawnEncounterGroup('zombie-badger', 10, 'spawn-audit', front);
        for (const enemy of world.manager.getAllEnemies()) {
          expect(world.coordinator.getGeometry()!.isFree(enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius()),
            `${id}/${seed}/${front}/${enemy.id}`).toBe(true);
          expect(world.field.queryNavigation(enemy.sprite.x, enemy.sprite.y).status).toBe('ready');
          count++;
        }
        world.clear();
      }
      reports.push({ mapId: id, seed, layoutFingerprint: ArenaGenerator.fingerprint(world.layout), spawned: count });
      world.destroy();
    }
    mkdirSync('build/navigation-results', { recursive: true });
    writeFileSync('build/navigation-results/spawn-maps.json', JSON.stringify({ scenarioVersion: 1, reports }, null, 2));
  }, 180_000);

  it.each(['1', '7'])('runs every Map %s encounter including delayed waves against the real generated geometry and mission barriers', mapId => {
    const reports: unknown[] = [];
    for (const seed of NAVIGATION_BENCHMARK_SEEDS) {
      const world = spawnWorld(mapId, seed), checkpoints = world.route!.checkpoints;
      let reached = -1;
      for (const encounter of resolveCoopDefenseMapEncounterConfigs(world.map, 1)) {
        if (encounter.start.type === 'after-checkpoint') {
          const goalId = encounter.start.checkpointId;
          const destination = checkpoints.findIndex(cp => cp.id === goalId);
          while (reached < destination) {
            const cp = checkpoints[++reached], p = worldCellCenter(world.metrics, cp.gridX, cp.gridY);
            world.progress!.hostUpdate(16, false, [{ playerId: 'reference', eligible: true, ...p }]);
          }
        }
        const cp = checkpoints[Math.max(0, reached)]; world.target(cp.gridX, cp.gridY);
        const director = new CoopDefenseMapDirector([encounter], (...args) => world.executor.hostSpawnEncounterGroup(...args),
          { isEncounterStartSatisfied: () => true, random: () => .5 });
        const expected = encounter.groups.reduce((sum, group) => sum + group.count, 0);
        for (let ms = 0; ms < 180_000 && world.manager.getAllEnemies().length < expected; ms += 250) director.hostUpdate(250, false);
        const enemies = world.manager.getAllEnemies();
        const unsafe = enemies.filter(enemy => !world.coordinator.getGeometry()!.isFree(enemy.sprite.x, enemy.sprite.y, enemy.getCollisionRadius()));
        reports.push({ seed, encounter: encounter.id, expected, spawned: enemies.length, unsafe: unsafe.length });
        expect(enemies.length, `${seed}/${encounter.id}`).toBe(expected);
        expect(unsafe, `${seed}/${encounter.id}`).toHaveLength(0);
        world.cleared.add(encounter.id); world.progress!.hostUpdate(16, false, []); world.clear();
      }
      world.destroy();
    }
    mkdirSync('build/navigation-results', { recursive: true });
    writeFileSync(`build/navigation-results/spawn-map${mapId}-encounters.json`, JSON.stringify({ scenarioVersion: 1, reports }, null, 2));
  }, 180_000);
});
