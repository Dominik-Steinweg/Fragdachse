import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { navigationTestWorld } from '../navigationTestWorld';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';
import { getCoopDefenseEnemyConfig } from '../../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { NavigationGeometry, type NavigationObstacle } from '../../src/systems/navigation/NavigationGeometry';
import { BreachSearch } from '../../src/systems/navigation/BreachPlanner';
import { FlowFieldCoordinator } from '../../src/systems/flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from '../../src/systems/flowfield/FlowFieldRunner';
import { collectResultTransferables } from '../../src/systems/flowfield/FlowFieldProtocol';
import { createFlowFieldTuning } from '../../src/systems/flowfield/FlowFieldSources';
import { summarizeNavigationSamples } from '../../src/debug/navigationLab/scenarios';

// Opt-in measurements of the current implementation; no historical AI path or timing assertions.
describe.skipIf(!process.env.NAVIGATION_REVIEW)('Navigation review measurements', () => {
  it('records intent, opening search and field-transfer work', () => {
    const reports: unknown[] = [];
    const config = getCoopDefenseEnemyConfig('rabid-badger');
    for (const blocked of [false, true]) {
      const world = navigationTestWorld(blocked ? [{ id: 'rock:0', kind: 'rock', shape: 'rect', left: 112, top: 0, right: 144, bottom: 256 }] : []);
      const units = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, kind: 'rabid-badger', faction: 'hostile',
        sprite: { active: true, x: 32, y: 128 }, getSize: () => config.size, getMoveSpeed: () => config.moveSpeed,
        getAttackWeapons: () => config.weapons.map(w => ({ ...w, weapon: { config: WEAPON_CONFIGS[w.weaponId] } })) } as unknown as EnemyEntity));
      let perceptionChecks = 0;
      world.intents.setPerception(() => { perceptionChecks++; return true; });
      world.intents.setObstacleIntegrityResolver(() => 10);
      world.catalog.updateTargets(Array.from({ length: 4 }, (_, i) => ({ kind: 'player' as const, id: `p${i}`, x: 224, y: 48 + i * 48 })));
      const samples: number[] = [];
      for (let step = 0; step < 660; step++) {
        world.coordinator.advance(1000 / 60);
        const start = performance.now(); world.intents.update(units, step * 1000 / 60);
        if (step >= 60) samples.push(performance.now() - start);
        else if (step === 59) perceptionChecks = 0;
      }
      reports.push({ case: blocked ? 'intent-blocked-100' : 'intent-free-100', samples: summarizeNavigationSamples(samples),
        perceptionChecks, work: world.intents.getWorkCounters() });
      world.destroy();
    }
    for (const base of [false, true]) {
      const obstacles: NavigationObstacle[] = [{ id: 'gate', kind: base ? 'base' : 'rock', shape: 'rect', left: 320, right: 352, top: 0, bottom: 384 }];
      for (let i = 0; i < 30; i++) obstacles.push({ id: `irrelevant:${i}`, kind: 'rock', shape: 'circle', x: 80 + (i % 6) * 32, y: 32 + Math.floor(i / 6) * 32, radius: 7 });
      let integrityReads = 0;
      const geometry = new NavigationGeometry({ left: 0, top: 0, right: 640, bottom: 384, obstacles });
      const metrics = { cols: 41, rows: 25, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
      const beforeHeap = process.memoryUsage().heapUsed, start = performance.now();
      const search = new BreachSearch({ version: { generation: 1, topology: 1, goal: 1, profile: 'body' },
        startIndex: 12 * 41 + 3, startRegion: 1, goals: [12 * 41 + 37], radius: 15, speed: 100,
        destructionSeconds: () => { integrityReads++; return 1; } }, metrics, geometry);
      let plan = search.step(0), steps = 0;
      const slices: number[] = [];
      while (plan.status === 'pending' && steps++ < 128) {
        const before = performance.now(); plan = search.step(64); slices.push(performance.now() - before);
      }
      reports.push({ case: base ? 'base-with-irrelevant-rocks' : 'rock-with-irrelevant-rocks', status: plan.status,
        totalMs: performance.now() - start, slices: summarizeNavigationSamples(slices), visited: search.visited, integrityReads,
        search: search.getDiagnostics(),
        heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap, heapCaveat: 'Uncontrolled GC; allocation observation only.' });
    }
    class RecordingRunner extends InlineFlowFieldRunner {
      bytes = 0;
      override onResult(listener: Parameters<InlineFlowFieldRunner['onResult']>[0]): void {
        super.onResult(result => { this.bytes += collectResultTransferables(result).reduce((sum, buffer) => sum + buffer.byteLength, 0); listener(result); });
      }
    }
    const metrics = { cols: 129, rows: 65, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const runner = new RecordingRunner(), obstacles: NavigationObstacle[] = [];
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(), runner,
      staticKind: new Uint8Array(129 * 65), bases: [], activeBaseIds: new Set(), obstacleCellProvider: () => [],
      geometryProvider: () => ({ left: 0, top: 0, right: 2048, bottom: 1024, obstacles }), navTickIntervalMs: 100 });
    for (let i = 0; i < 8; i++) { coordinator.registerField(`f${i}`, { goalMode: 'dynamic', bodyRadius: 15 }); coordinator.setGoalCells(`f${i}`, [32 * 129 + 120 - i]); }
    const buildAt = performance.now(); coordinator.prepareNow();
    reports.push({ case: 'eight-fields-one-profile', totalMs: performance.now() - buildAt, transferBytes: runner.bytes });
    const rebuilds: number[] = [], projections: number[] = [];
    for (let i = 0; i < 10; i++) {
      obstacles.push({ id: `change:${i}`, kind: 'rock', shape: 'circle', x: 64 + i * 64, y: 64, radius: 12 });
      const start = performance.now(); coordinator.invalidateGeometry(); coordinator.getGeometry(); projections.push(performance.now() - start);
      coordinator.runSynchronously(false); rebuilds.push(performance.now() - start);
    }
    reports.push({ case: 'small-geometry-changes', samples: summarizeNavigationSamples(rebuilds),
      mainThreadGeometry: summarizeNavigationSamples(projections), transferBytes: runner.bytes });
    coordinator.destroy();
    const name = process.env.NAVIGATION_REVIEW === 'before' ? 'before' : 'after';
    mkdirSync('build/navigation-results', { recursive: true });
    writeFileSync(`build/navigation-results/review-${name}.json`, JSON.stringify({ commit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
      sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'src'])).digest('hex'),
      generatedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
      scope: 'Current navigation, inline execution, no rendering or combat; review microbenchmarks.', reports }, null, 2));
  }, 60_000);
});
