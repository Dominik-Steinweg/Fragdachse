import { expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { ProjectileCollisionProcessor } from '../../src/projectile/ProjectileCollisionProcessor';
import { ArenaObstacleIndex, OBSTACLE_ROCK } from '../../src/systems/ArenaObstacleIndex';
import type { ProjectileCollisionTargetQueryPort, ProjectileCollisionTargetSink } from '../../src/projectile/ProjectileTargetPort';
import { collisionRecord, collisionRock } from '../projectileCollisionFixture';

// Explicit opt-in: ordinary stress runs execute the parity tests, not this measurement matrix.
it.skipIf(!process.env.PROJECTILE_BENCH)('measures rock preparation and collision search', () => {
  const optimized = process.env.PROJECTILE_BENCH === 'spatial';
  for (const rockCount of [4000, 20000]) for (const projectileCount of [0, 8, 1500]) {
    const repetitions = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      let seed = 731;
      const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
      const rocks = Array.from({ length: rockCount }, (_, i) => collisionRock(
        (i % 200) * 128 + random() * 16, Math.floor(i / 200) * 128 + random() * 16));
      const index = new ArenaObstacleIndex({ rocks: () => rocks, trunks: () => null, bases: () => null,
        bounds: () => ({ offsetX: -128, offsetY: -128, width: 26000, height: 14000 }) });
      const buildStart = performance.now(); index.prepare(); const buildMs = performance.now() - buildStart;
      index.markDirty(); const rebuildStart = performance.now(); index.prepare();
      const rebuildMs = performance.now() - rebuildStart;
      for (const rock of rocks) rock.reads = 0;
      const records = Array.from({ length: projectileCount }, (_, i) => {
        const y = (i % 24) * 128;
        return collisionRecord(i, -100, y, 140, y, 12, i % 2 ? 'overlap' : 'sweep');
      });
      const processor = new ProjectileCollisionProcessor();
      let emitted = 0, contacts = 0;
      const emitRock = (sink: ProjectileCollisionTargetSink, id: number, l: number, t: number, r: number, b: number) => {
        emitted++; sink('rock', id, '__world__', (l + r) / 2, (t + b) / 2,
          Math.hypot(r - l, b - t) / 2, l, t, r, b, 'rock');
      };
      const full: ProjectileCollisionTargetQueryPort = { readCollisionTargets: sink => {
        // Baseline reproduces the composition's temporary target/Bounds projection.
        const targets = rocks.flatMap((rock, id) => rock.active ? [{ id, ...rock.getBounds() }] : []);
        for (const target of targets) emitRock(sink, target.id, target.left, target.top, target.right, target.bottom);
      } };
      const spatial: ProjectileCollisionTargetQueryPort = { readCollisionTargets: () => {},
        queryWorldCollisionTargets: (region, sink) => {
          index.queryProjectileSegment(region.startX, region.startY, region.endX, region.endY,
            region.padding, region.sweepCircles, (kind, id, l, t, r, b) => {
              if (kind === OBSTACLE_ROCK) emitRock(sink, id, l, t, r, b);
              return false;
            });
        },
      };
      const deps = { targetQuery: optimized ? spatial : full, targetability: null, worldBlocker: null,
        directImpact: null, destroyProjectile: () => {}, applyDefense: () => {},
        resolveWorldImpact: () => { contacts++; return 'passed' as const; } };
      const samples: number[] = [];
      let expectedContacts = -1;
      for (let frame = 0; frame < 60; frame++) {
        const before = contacts;
        const start = performance.now(); processor.run(records, frame * 16, deps);
        const ms = performance.now() - start;
        if (frame === 0) expectedContacts = contacts - before;
        expect(contacts - before).toBe(expectedContacts);
        if (frame >= 10) samples.push(ms);
      }
      if (projectileCount) expect(contacts).toBeGreaterThan(0);
      samples.sort((a, b) => a - b);
      repetitions.push({ medianMs: samples[25], p95Ms: samples[47], buildMs, rebuildMs,
        boundsReads: rocks.reduce((sum, rock) => sum + rock.reads, 0), emitted, contacts });
      processor.reset();
    }
    console.info('PROJECTILE_BENCH', JSON.stringify({ mode: process.env.PROJECTILE_BENCH,
      node: process.version, rockCount, projectileCount, repetitions }));
  }
}, 1_800_000);
