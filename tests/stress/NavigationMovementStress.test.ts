import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { createHash } from 'node:crypto';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
import { EnemyManager } from '../../src/entities/EnemyManager';
import { EnemyFlowFieldService } from '../../src/systems/EnemyFlowFieldService';
import { FlowFieldCoordinator } from '../../src/systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldTuning } from '../../src/systems/flowfield/FlowFieldSources';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../../src/systems/navigation/EnemyIntentSystem';
import { NavigationGeometry, type NavigationObstacle } from '../../src/systems/navigation/NavigationGeometry';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { NAVIGATION_BENCHMARK_SEEDS, navigationRandom, summarizeNavigationSamples } from '../../src/debug/navigationLab/scenarios';
import { healthBarTestScene } from '../healthBarTestScene';

const enabled = process.env.NAVIGATION_STRESS === '1';
describe.skipIf(!enabled)('Navigation movement under sustained load', () => {
  it('reaches the goal safely across rock fields and bottlenecks with fixed populations', () => {
    const reports: unknown[] = [];
    const failures: string[] = [];
    const smoke = process.env.NAVIGATION_SMOKE === '1';
    for (const scenario of ['rocks', 'bottleneck', 'two-routes'] as const) for (const seed of smoke ? [183] : NAVIGATION_BENCHMARK_SEEDS) for (const count of smoke ? [20] : [20, 50, 100]) {
      const random = navigationRandom(seed), rocks: { gridX: number; gridY: number }[] = [];
      if (scenario === 'rocks') {
        for (let row = 2; row < 30; row++) for (let col = 12; col < 52; col++) if (random() < .1) rocks.push({ gridX: col, gridY: row });
      } else for (let row = 0; row < 32; row++) {
        if (row === 16 || (scenario === 'two-routes' && row >= 7 && row <= 9)) continue;
        rocks.push({ gridX: 32, gridY: row });
      }
      const obstacles: NavigationObstacle[] = rocks.map((rock, i) => ({ id: `rock:${i}`, kind: 'rock', shape: 'rect',
        left: rock.gridX * 32, top: rock.gridY * 32, right: rock.gridX * 32 + 32, bottom: rock.gridY * 32 + 32 }));
      const snapshot = { left: 0, top: 0, right: 2048, bottom: 1024, obstacles }, geometry = new NavigationGeometry(snapshot);
      const starts = Array.from({ length: count }, (_, i) => ({ x: 48 + (i % 8) * 32, y: 48 + Math.floor(i / 8) * 32 }));
      // The constructed bottlenecks keep their geometry, but seeds vary which unit enters each lane.
      for (let i = starts.length - 1; i > 0; i--) {
        const other = Math.floor(random() * (i + 1));
        [starts[i], starts[other]] = [starts[other], starts[i]];
      }
      const layoutFingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const configs = resolveCoopDefenseEnemyConfigs(1);
      const manager = new EnemyManager(healthBarTestScene().scene, configs);
      const metrics = { cols: 129, rows: 65, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
      const coordinator = new FlowFieldCoordinator({ metrics,
        tuning: createFlowFieldTuning(), staticKind: new Uint8Array(129 * 65), bases: [], activeBaseIds: new Set(),
        geometryProvider: () => snapshot, obstacleCellProvider: () => [], navTickIntervalMs: 100 });
      const field = EnemyFlowFieldService.fromView(coordinator.registerField('reference', { goalMode: 'dynamic', bodyRadius: 15 }));
      coordinator.setGoalCells('reference', [33 * 129 + 121]); coordinator.prepareNow();
      const catalog = new EnemyAiTargetCatalog(); catalog.updateTargets([{ kind: 'player', id: 'goal', x: 1936, y: 528 }]);
      const intents = new EnemyIntentSystem(coordinator, catalog);
      manager.setNavigationIntents(intents);
      const units = starts.map(p => manager.hostSpawnAtWorld(p.x, p.y, 'void-stalker'));
      let unsafeSegments = 0, stationaryMs = 0, reached = 0, arrivalSumMs = 0, completedTrips = 0;
      const arrivals = new Set<string>(), times: number[] = [];
      const durationMs = 60_000, dt = 1000 / 60;
      for (let step = 0; step < durationMs / dt; step++) {
        const now = step * dt, started = performance.now();
        coordinator.advance(dt); intents.update(units, now);
        manager.hostUpdateMovement(field, field, field, null, false, now, dt);
        times.push(performance.now() - started);
        for (const unit of units) {
          const { vx, vy } = unit.getDesiredVelocity(), x = unit.sprite.x, y = unit.sprite.y;
          const nx = x + vx * dt / 1000, ny = y + vy * dt / 1000;
          // Mirror the executed velocity for the next physical neighbor snapshot.
          (unit.sprite.body as { setVelocity(x: number, y: number): void }).setVelocity(vx, vy);
          // Instrumented body sweep: reject unsafe proposals and count them. No combat/physics timing claim.
          if (!geometry.canMove(x, y, nx, ny, unit.getSize() / 2)) { unsafeSegments++; stationaryMs += dt; }
          else { unit.sprite.setPosition(nx, ny); if (Math.hypot(nx - x, ny - y) < .1) stationaryMs += dt; }
          if (Math.hypot(unit.sprite.x - 1936, unit.sprite.y - 528) < 90) {
            if (!arrivals.has(unit.id)) { arrivals.add(unit.id); reached++; arrivalSumMs += now; }
            completedTrips++;
            // A closed-loop load keeps population constant and frees the exit for followers.
            // This scenario reset is not a gameplay recovery/teleport rule.
            const start = starts[units.indexOf(unit)]; unit.setPosition(start.x, start.y); unit.stopMovement();
          }
        }
      }
      reports.push({ scenario, seed, count, durationMs, layoutFingerprint, starts,
        configuration: { enemyKind: 'void-stalker', enemy: configs['void-stalker'],
          weapons: units[0].getAttackWeapons().map(attack => ({ targetMode: attack.targetMode, config: attack.weapon.config })),
          stepMs: dt, fixedPopulation: true },
        reached, unresolved: count - reached, completedTrips,
        meanArrivalMs: reached ? arrivalSumMs / reached : null, unsafeSegments, stationaryMs,
        navigationCpuMs: summarizeNavigationSamples(times), fields: Object.keys(coordinator.getDiagnostics().fields).length,
        navigationWork: manager.getNavigationWorkCounters(),
        finalUnits: units.map(unit => ({ id: unit.id, arrived: arrivals.has(unit.id), x: unit.sprite.x, y: unit.sprite.y,
          intent: intents.get(unit.id), movement: manager.getMovementFeedback(unit.id) })) });
      intents.clear(); coordinator.destroy(); field.destroy(); manager.destroy();
      if (unsafeSegments > 0) failures.push(`${scenario}/${seed}/${count}: unsafe movement`);
      if (reached !== count) {
        failures.push(`${scenario}/${seed}/${count}: ${count - reached} units did not arrive`);
      }
    }
    mkdirSync('build/navigation-results', { recursive: true });
    writeFileSync(`build/navigation-results/movement${smoke ? '-smoke' : ''}.json`, JSON.stringify({ schemaVersion: 1,
      generatedAt: new Date().toISOString(), sourceIdentity: process.env.NAVIGATION_SOURCE_IDENTITY ?? null,
      environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model },
      scope: 'Current navigation with an inline runner and body-sweep harness; no combat or Arcade timing.', reports }, null, 2));
    expect(failures).toEqual([]);
  }, 600_000);
});
