import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { ProjectileCollisionProcessor, type ProjectileCollisionDependencies } from '../src/projectile/ProjectileCollisionProcessor';
import { ArenaObstacleIndex, OBSTACLE_ROCK } from '../src/systems/ArenaObstacleIndex';
import { resolveProjectileTargetImpact } from '../src/combat/rules/ProjectileImpactResolver';
import type { ProjectileCollisionTargetQueryPort, ProjectileCollisionTargetSink } from '../src/projectile/ProjectileTargetPort';
import { collisionRecord, collisionRock } from './projectileCollisionFixture';

function world(initial = [collisionRock(64, 0)]) {
  let rocks = initial;
  let live = true;
  const index = new ArenaObstacleIndex({ rocks: () => rocks, trunks: () => null, bases: () => null,
    bounds: () => ({ offsetX: -1024, offsetY: -1024, width: 4096, height: 4096 }) });
  const emit = (sink: ProjectileCollisionTargetSink, id: number, l: number, t: number, r: number, b: number) =>
    sink('rock', id, '__world__', (l + r) / 2, (t + b) / 2, Math.hypot(r - l, b - t) / 2, l, t, r, b, 'rock');
  const full: ProjectileCollisionTargetQueryPort = { readCollisionTargets: sink => {
    if (!live) return;
    rocks.forEach((rock, id) => { if (rock?.active) {
      const b = rock.getBounds(); emit(sink, id, b.left, b.top, b.right, b.bottom);
    } });
  } };
  const spatial: ProjectileCollisionTargetQueryPort = {
    readCollisionTargets: () => {},
    queryWorldCollisionTargets: (r, sink) => {
      if (!live) return;
      index.queryProjectileSegment(r.startX, r.startY, r.endX, r.endY, r.padding, r.sweepCircles,
        (kind, id, l, t, right, b) => { if (kind === OBSTACLE_ROCK) emit(sink, id, l, t, right, b); return false; });
    },
  };
  return { index, full, spatial, get rocks() { return rocks; },
    replace(next: typeof rocks) { rocks = next; }, destroy() { live = false; rocks = []; index.clear(); } };
}

function execution(port: ProjectileCollisionTargetQueryPort) {
  const processor = new ProjectileCollisionProcessor();
  const hits: Array<{ projectile: number; kind: string; id: string | number; x: number; y: number; distance?: number }> = [];
  const deps: ProjectileCollisionDependencies = {
    targetQuery: port, targetability: null, worldBlocker: null, directImpact: null,
    destroyProjectile: () => {}, applyDefense: () => {},
    resolveWorldImpact: (record, hit) => {
      hits.push({ projectile: record.id, kind: hit.target.kind, id: hit.target.id,
        x: hit.x, y: hit.y, distance: hit.distanceAlongTravel });
      return 'passed';
    },
  };
  return { processor, hits, deps };
}

describe('spatial projectile candidates', () => {
  it.each(['sweep', 'overlap'] as const)('keeps %s ties and epsilon chains independent of bucket order', mode => {
    const positions = [24 + 1.5e-6, 24 + 0.75e-6, 24, 24, 20];
    const emit = (sink: ProjectileCollisionTargetSink, order: number[]) => {
      for (const id of order) sink('rock', id, 'world', positions[id], 0, 8,
        positions[id] - 8, -8, positions[id] + 8, 8, 'rock');
    };
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [1, 3, 0, 4, 2]]) {
      const full = execution({ readCollisionTargets: sink => emit(sink, order) });
      const spatial = execution({ readCollisionTargets: () => {}, queryWorldCollisionTargets: (_region, sink) => {
        emit(sink, order);
        // Duplicate reports from cells/adapters still give one hit chance.
        emit(sink, order);
      } });
      full.processor.run([collisionRecord(1, 0, 0, 30, 0, 12, mode)], 0, full.deps);
      spatial.processor.run([collisionRecord(1, 0, 0, 30, 0, 12, mode)], 0, spatial.deps);
      expect(spatial.hits).toEqual(full.hits);
      expect(spatial.hits.map(h => h.id)).toEqual([4, 0, 1, 2, 3]);
    }
  });

  it('keeps grenade character contacts in front of rectangular blockers', () => {
    const w = world([collisionRock(128, 0)]);
    const result: number[][] = [];
    for (const port of [w.full, w.spatial]) {
      const query = { ...port, readCollisionTargets: (sink: ProjectileCollisionTargetSink) => {
        port.readCollisionTargets(sink);
        for (const x of [50, 200]) sink('enemy', String(x), 'enemy', x, 0, 8, x - 8, -8, x + 8, 8);
      } };
      const run = execution(query);
      const contacts: number[] = [];
      const record = collisionRecord(1, -100, 0, 300, 0, 40);
      record.spec = { ...record.spec, flight: { ...record.spec.flight, isGrenade: true },
        interaction: { ...record.spec.interaction, grenadeEffect: { type: 'damage', impactFuse: true } as never } };
      const deps = { ...run.deps, targetability: { getGrenadeContactRole: (_source: unknown, target: { kind: string }) =>
        target.kind === 'enemy' ? 'character' : null } as never,
      onGrenadeContact: (_record: unknown, hit: { target: { id: string | number } }) => contacts.push(Number(hit.target.id)) };
      run.processor.run([record], 0, deps);
      result.push(contacts);
    }
    expect(result).toEqual([[50], [50]]);
  });

  it('preserves mixed World/Combat order, penetration damage and projectile consumption', () => {
    const w = world([collisionRock(80, 0, 10)]);
    const outcomes = [];
    for (const port of [w.full, w.spatial]) {
      const run = execution({ ...port, readCollisionTargets: sink => {
        port.readCollisionTargets(sink);
        for (const x of [50, 100, 150]) sink('enemy', String(x), 'enemy', x, 0, 8, x - 8, -8, x + 8, 8);
      } });
      const record = collisionRecord(1, 0, 0, 200, 0);
      record.contacts.penetrationHitIds = new Set();
      record.interaction.penetrationRemaining = 1;
      record.spec = { ...record.spec, flight: { ...record.spec.flight, penetration: { damageRetention: 0.5 } } };
      const hits: Array<[string, number]> = [];
      run.processor.run([record], 0, { ...run.deps,
        resolveWorldImpact: (_record, hit) => { hits.push([`rock:${hit.target.id}`, record.damage]); return 'passed'; },
        destroyProjectile: () => { record.pendingDestroy = true; },
        directImpact: { resolveDirectImpact: request => {
          hits.push([`enemy:${request.target.id}`, request.directHit.damage]); return { accepted: true };
        } } as never,
      });
      outcomes.push({ hits, consumed: record.pendingDestroy, penetration: record.interaction.penetrationRemaining });
    }
    expect(outcomes[0]).toEqual({ hits: [['enemy:50', 10], ['rock:0', 5], ['enemy:100', 5]], consumed: true, penetration: 0 });
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it.each(['sweep', 'overlap'] as const)('%s matches full search and a brute-force geometric oracle', mode => {
    let seed = 917;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const w = world(Array.from({ length: 180 }, () => collisionRock(random() * 2800 - 900,
      random() * 2800 - 900, 8 + random() * 200, 8 + random() * 160)));
    const full = execution(w.full), spatial = execution(w.spatial);
    for (let i = 0; i < 120; i++) {
      const sx = random() * 3400 - 1200, sy = random() * 3400 - 1200;
      const ex = random() * 3400 - 1200, ey = random() * 3400 - 1200, size = 2 + random() * 320;
      const a = collisionRecord(i, sx, sy, ex, ey, size, mode);
      const b = collisionRecord(i, sx, sy, ex, ey, size, mode);
      full.hits.length = 0; spatial.hits.length = 0;
      full.processor.run([a], 0, full.deps); spatial.processor.run([b], 0, spatial.deps);
      expect(spatial.hits).toEqual(full.hits);
      const expectedIds = w.rocks.flatMap((rock, id) => {
        if (mode === 'sweep') return resolveProjectileTargetImpact({ startX: sx, startY: sy, endX: ex, endY: ey,
          targetX: rock.x, targetY: rock.y, radius: Math.hypot(rock.width, rock.height) / 2 + size / 2,
          ignoreStartingOverlap: true }) ? [id] : [];
        return ex - size / 2 < rock.x + rock.width / 2 && ex + size / 2 > rock.x - rock.width / 2
          && ey - size / 2 < rock.y + rock.height / 2 && ey + size / 2 > rock.y - rock.height / 2 ? [id] : [];
      });
      expect(spatial.hits.map(hit => hit.id).sort((a, b) => Number(a) - Number(b))).toEqual(expectedIds);
    }
  });

  it('includes circle overhangs, wide bodies, cell corners and zero-length overlaps without duplicates', () => {
    const w = world([collisionRock(128, 128, 256, 8), collisionRock(-128, -128, 256), collisionRock(512, 512)]);
    const full = execution(w.full), spatial = execution(w.spatial);
    for (const [sx, sy, ex, ey, size] of [[-500, 30, 800, 30, 4], [-500, 512, 800, 512, 600],
      [-128, -128, -128, -128, 16], [128, 0, 128, 256, 4], [-256, -256, 256, 256, 12]]) {
      full.processor.run([collisionRecord(1, sx, sy, ex, ey, size)], 0, full.deps);
      spatial.processor.run([collisionRecord(1, sx, sy, ex, ey, size)], 0, spatial.deps);
      expect(spatial.hits).toEqual(full.hits);
    }
    expect(spatial.hits.length).toBeGreaterThan(0);
  });

  it('sees removal, movement, additions and replaced World arrays on the next same-stage projectile', () => {
    const w = world([collisionRock(64, 0), collisionRock(1000, 0)]);
    const run = execution(w.spatial);
    const recordA = collisionRecord(1), recordB = collisionRecord(2);
    const live = new Set([recordA]);
    const originalImpact = run.deps.resolveWorldImpact!;
    run.deps.resolveWorldImpact = (record, hit) => {
      const result = originalImpact(record, hit);
      if (record.id === 1) {
        w.rocks[0].active = false;
        w.rocks[1].x = 100;
        w.index.markDirty();
        w.rocks.push(collisionRock(70, 0));
        live.add(recordB);
      }
      return result;
    };
    run.processor.withTargetSnapshot(() => run.processor.run(live, 0, run.deps));
    expect(run.hits.filter(h => h.projectile === 1).map(h => h.id)).toEqual([0]);
    expect(run.hits.filter(h => h.projectile === 2).map(h => h.id)).toEqual([2, 1]);
    w.replace([collisionRock(80, 0)]);
    run.hits.length = 0; run.processor.run([collisionRecord(3)], 0, run.deps);
    expect(run.hits.map(h => h.id)).toEqual([0]);
    w.destroy(); run.hits.length = 0; run.processor.run([collisionRecord(4)], 0, run.deps);
    expect(run.hits).toEqual([]);
    run.processor.reset();
  });

  it('reads activity live without rebuilding unchanged bounds', () => {
    const w = world([collisionRock(64, 0), collisionRock(1200, 0)]);
    w.index.prepare();
    const reads = w.rocks.map(r => r.reads);
    const run = execution(w.spatial);
    run.processor.run([collisionRecord(1)], 0, run.deps);
    w.rocks[0].active = false;
    run.processor.run([collisionRecord(2)], 0, run.deps);
    expect(run.hits.map(h => h.projectile)).toEqual([1]);
    expect(w.rocks.map(r => r.reads)).toEqual(reads);
    w.rocks[0].active = true;
    run.processor.run([collisionRecord(3)], 0, run.deps);
    expect(run.hits.map(h => h.projectile)).toEqual([1, 3]);
  });

  it('deduplicates multi-cell geometry across the query-stamp wrap of a long-lived World', () => {
    const w = world([collisionRock(0, 0, 512)]);
    w.index.prepare();
    // Advance only the clock, avoiding billions of queries to exercise the real wrap boundary.
    Reflect.set(w.index, 'queryStamp', 0x7ffffffe);
    for (let i = 0; i < 3; i++) {
      const ids: number[] = [];
      w.index.queryProjectileSegment(-1000, 0, 1000, 0, 12, true,
        (_kind, id) => { ids.push(id); return false; });
      expect(ids).toEqual([0]);
    }
  });

  it('does not prepare targets for empty, consumed, deferred or collision-irrelevant records', () => {
    const read = vi.fn(), query = vi.fn();
    const run = execution({ readCollisionTargets: read, queryWorldCollisionTargets: query });
    const records = Array.from({ length: 7 }, (_, id) => collisionRecord(id));
    records[0].pendingDestroy = true;
    records[1].miniRocket.spent = true;
    records[2].miniRocket.deferredExplosion = true;
    records[3].spec = { ...records[3].spec, flight: { ...records[3].spec.flight, collisionMode: 'none' } };
    records[4].spec = { ...records[4].spec, flight: { ...records[4].spec.flight, collisionMode: 'physics' } };
    records[5].spec = { ...records[5].spec, flight: { ...records[5].spec.flight, isGrenade: true } };
    records[6].spec = { ...records[6].spec, flight: { ...records[6].spec.flight, isGrenade: true },
      interaction: { ...records[6].spec.interaction,
        grenadeEffect: { type: 'damage', role: 'cluster', impactFuse: true } as never } };
    run.processor.run([], 0, run.deps); run.processor.run(records, 0, run.deps);
    expect(read).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });

  it('keeps dynamic snapshot positions and live targetability across portal prefixes', () => {
    let x = 64, alive = true;
    const read = vi.fn((sink: ProjectileCollisionTargetSink) => sink('enemy', 'enemy', 'enemy', x, 0, 8, x - 8, -8, x + 8, 8));
    const run = execution({ readCollisionTargets: read });
    const hit = vi.fn(() => { x = 1000; return { accepted: false }; });
    const deps = { ...run.deps, directImpact: { resolveDirectImpact: hit } as never,
      targetability: { canDamage: () => alive } as never };
    run.processor.withTargetSnapshot(() => {
      run.processor.run([collisionRecord(1)], 0, deps);
      run.processor.run([collisionRecord(2)], 0, deps);
      alive = false;
      run.processor.run([collisionRecord(3)], 0, deps);
    });
    expect(read).toHaveBeenCalledOnce(); expect(hit).toHaveBeenCalledTimes(2);
    alive = true;
    run.processor.run([collisionRecord(4)], 0, deps);
    expect(read).toHaveBeenCalledTimes(2); expect(hit).toHaveBeenCalledTimes(2);
  });

  it('advances swarm-origin exit state even when its target lies outside the search region', () => {
    const run = execution({ readCollisionTargets: sink => sink('enemy', 'origin', 'enemy', 1000, 0, 8, 992, -8, 1008, 8) });
    const record = collisionRecord(1, 0, 0, 0, 0, 12, 'overlap');
    record.provenance = { ...record.provenance, lineage: { plasmaSwarmOriginEnemyId: 'origin', plasmaSwarmChild: true } } as never;
    run.processor.run([record], 0, run.deps);
    expect(record.contacts.swarmOriginExited).toBe(true);
  });
});
