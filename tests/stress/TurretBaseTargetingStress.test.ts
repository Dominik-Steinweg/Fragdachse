import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const phaser = (await import('../fakeArenaRenderScene')).createFakePhaserModule() as unknown as typeof import('phaser');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  const Line = require(root + 'src/geom/line/Line.js');
  return { ...phaser, Math: { ...phaser.Math, Distance: { ...phaser.Math.Distance,
    Squared: (x: number, y: number, tx: number, ty: number) => (tx - x) ** 2 + (ty - y) ** 2,
  } }, Geom: { ...phaser.Geom,
    Intersects: require(root + 'src/geom/intersects/index.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Circle: require(root + 'src/geom/circle/Circle.js'),
    Line: Object.assign(Line, { Length: (l: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }),
  } };
});

import { WorldCombatGameplayBinding } from '../../src/world/WorldCombatGameplayBinding';
import { ExposedBaseFaceCache, type BaseAimPoint } from '../../src/systems/TurretBaseTargeting';
import { TurretSystem, type TurretFireSource, type AutomatedTurret } from '../../src/systems/TurretSystem';
import { FireControlRuntime } from '../../src/systems/fireControl/FireControlRuntime';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../../src/config/coopDefenseConstructions';
import { resolveCoopDefenseWorldMetrics } from '../../src/world/WorldMetrics';
import { WorldCombatCore } from '../../src/combat/WorldCombatCore';
import { fakeEntity } from '../fakeEntity';
import { CELL_SIZE } from '../../src/config';
import * as targeting from '../../src/systems/TurretBaseTargeting';
import { Session } from 'node:inspector';

// Actual binding method and geometry/cache; synthetic dense concave base footprints.
// Counts enforce cadence independently of machine load; wall-clock has headroom above the 1 ms goal.
describe('turret base target search: four inspectors and twelve parallel copies', () => {
  it.each([3, 4])('bounds %i bases, invalidates generation, and measures real LOS', async baseCount => {
    const metrics = resolveCoopDefenseWorldMetrics(80, 80);
    const combat = new WorldCombatCore({ getAllPlayers: () => [] } as never, {} as never);
    combat.setWorldMetrics(metrics);
    let generation = 1, geometryReads = 0;
    const bases = Array.from({ length: baseCount }, (_, b) => {
      const cells = Array.from({ length: 12 * 12 }, (_, i) => ({ gridX: 30 + b * 5 + i % 12, gridY: 30 + Math.floor(i / 12) }))
        .filter(c => !(c.gridX % 3 === 0 && c.gridY > 34));
      return { id: `concave-${b}`, faction: 'hostile', isInert: () => false, getHp: () => 1000000, isDamageable: () => true,
        getSpec: () => { geometryReads++; return { cells }; }, cells };
    });
    const bodies = bases.flatMap(b => b.cells.map(c => {
      const left = metrics.offsetX + c.gridX * CELL_SIZE, top = metrics.offsetY + c.gridY * CELL_SIZE;
      return fakeEntity({ x: left + CELL_SIZE / 2, y: top + CELL_SIZE / 2, active: true,
        width: CELL_SIZE, height: CELL_SIZE, getData: () => b.id,
        getBounds: () => ({ left, top, right: left + CELL_SIZE, bottom: top + CELL_SIZE }) });
    }));
    combat.setBaseObstacles(bodies as never);
    const owner = Object.assign(Object.create(WorldCombatGameplayBinding.prototype), {
      options: { baseManager: { getObstacleGeneration: () => generation, getBasesByFaction: () => bases },
        worldMetrics: metrics, isCoopDefense: () => true,
        combatSystem: { captureWorldDamageSource: () => ({}), canDamageStructure: () => true } },
      turretBaseFaces: new ExposedBaseFaceCache(),
    }) as { getHostileBaseAimCandidates(s: TurretFireSource, x: number, y: number, range: number): readonly (BaseAimPoint & { id: string })[] };
    const cfg = COOP_DEFENSE_CONSTRUCTIONS.rocket_turret;
    if (cfg.kind !== 'turret') throw Error('Expected rocket');
    const poses: AutomatedTurret[] = Array.from({ length: 24 }, (_, i) => ({ ...cfg, id: i + 1,
      ownerId: `p${Math.floor(i / 6)}`, ownerColor: 1, x: metrics.offsetX + 27 * CELL_SIZE,
      y: metrics.offsetY + (30 + i % 6) * CELL_SIZE, angle: 0, targetMode: 'enemies' }));
    const relay = UTILITY_CONFIGS.FIRE_CONTROL_RELAY;
    if (relay.type !== 'fire_control_relay') throw Error('Expected relay');
    const copies = new FireControlRuntime({ readConstructions: () => poses.map(p => ({ ...p, id: Number(p.id),
      constructionId: 'rocket_turret', weaponFireType: 'projectile', baseOwned: false, combatReady: true, manned: false })),
      readSlotOrder: () => ['rocket_turret'], isPointFree: () => true, onDeploymentEnded() {} });
    for (let i = 0; i < 4; i++) expect(copies.activateCopies({ ownerId: `p${i}`, ownerColor: 1,
      playerX: poses[i * 6].x, playerY: poses[i * 6].y, pointX: poses[i * 6].x, pointY: poses[i * 6].y, nowMs: 0,
      config: { ...relay, maxCopies: 3, parallel: true, cooldownMs: relay.cooldown } }).ok).toBe(true);
    const sources = copies.deriveFireSources(poses, relay.materializeMs);
    expect(sources).toHaveLength(36);
    const turret = new TurretSystem({ getAllPlayers: () => [] } as never, { isAlive: () => true } as never);
    turret.setTurretProvider(() => poses, () => {});
    turret.setFireSourceProvider(() => sources);
    // No firing: acquisition/holding work cannot hide behind bursts or cooldowns.
    turret.setFireHandler(null);
    let searches = 0, los = 0, largestCandidates = 0;
    let candidateMs = 0, losMs = 0, rankMs = 0, cacheMs = 0, rankedFaces = 0;
    const profile = process.env.FC_SEARCH_PROFILE === '1';
    const rank = targeting.rankBaseAimPoints;
    const rankSpy = profile ? vi.spyOn(targeting, 'rankBaseAimPoints').mockImplementation((...args) => {
      const start = performance.now();
      const result = rank(...args);
      rankMs += performance.now() - start; rankedFaces += args[0].length;
      return result;
    }) : null;
    const cacheGet = ExposedBaseFaceCache.prototype.get;
    const cacheSpy = profile ? vi.spyOn(ExposedBaseFaceCache.prototype, 'get').mockImplementation(function (this: ExposedBaseFaceCache, ...args) {
      const start = performance.now();
      const result = cacheGet.apply(this, args);
      cacheMs += performance.now() - start;
      return result;
    }) : null;
    turret.setBaseTargetCandidateProvider((s, x, y, range) => {
      searches++;
      const start = profile ? performance.now() : 0;
      const candidates = owner.getHostileBaseAimCandidates(s, x, y, range);
      if (profile) candidateMs += performance.now() - start;
      largestCandidates = Math.max(largestCandidates, candidates.length);
      return candidates;
    });
    let blocked = false;
    turret.setLineOfFireChecker((sx, sy, ex, ey) => {
      los++;
      const start = profile ? performance.now() : 0;
      const clear = combat.hasClearLineOfFire(sx, sy, ex, ey);
      if (profile) losMs += performance.now() - start;
      return !blocked && clear;
    });
    let now = 1000;
    const tick = () => { now += 16; turret.hostUpdate(now, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, 16); };
    for (let i = 0; i < 16; i++) tick();
    const coldReads = geometryReads;
    expect(coldReads).toBe(baseCount);
    for (const allBlocked of [false, true]) {
      blocked = allBlocked;
      for (let warm = 0; warm < 100; warm++) tick();
      searches = 0; los = 0;
      candidateMs = losMs = rankMs = cacheMs = rankedFaces = 0;
      const heap = process.env.FC_SEARCH_HEAP === '1' ? new Session() : null;
      if (heap) {
        heap.connect();
        await new Promise<void>((resolve, reject) => heap.post('HeapProfiler.startSampling', {
          samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true,
        }, error => error ? reject(error) : resolve()));
      }
      const samples: number[] = [];
      let maxSearchesPerTick = 0;
      for (let batch = 0; batch < 20; batch++) {
        const start = performance.now();
        for (let i = 0; i < 50; i++) {
          const before = searches; tick();
          maxSearchesPerTick = Math.max(maxSearchesPerTick, searches - before);
        }
        samples.push((performance.now() - start) / 50);
      }
      samples.sort((a, b) => a - b);
      if (heap) {
        const allocation = await new Promise<import('node:inspector').HeapProfiler.SamplingHeapProfile>((resolve, reject) =>
          heap.post('HeapProfiler.stopSampling', (error, result) => error ? reject(error) : resolve(result.profile)));
        heap.disconnect();
        const bytes = { ranking: 0, candidates: 0, los: 0, cache: 0, other: 0 };
        const visit = (node: typeof allocation.head, bucket: keyof typeof bytes = 'other'): void => {
          const name = node.callFrame.functionName;
          if (name === 'rankBaseAimPoints') bucket = 'ranking';
          else if (name === 'getHostileBaseAimCandidates' || name === 'getBaseAimCandidates') bucket = 'candidates';
          else if (name === 'hasClearLineOfFire' || name === 'hasLineOfFireFromMuzzle') bucket = 'los';
          else if (name === 'get' && node.callFrame.url.includes('TurretBaseTargeting')) bucket = 'cache';
          bytes[bucket] += node.selfSize;
          for (const child of node.children) visit(child, bucket);
        };
        visit(allocation.head);
        console.info('FC_ALLOC_SAMPLED_BYTES_PER_TICK ' + JSON.stringify({ baseCount, allBlocked,
          ...Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, Math.round(value / 1000)])) }));
      }
      expect(largestCandidates).toBeLessThanOrEqual(4);
      expect(searches).toBeLessThanOrEqual(36 * Math.ceil(16000 / 200));
      expect(maxSearchesPerTick).toBeLessThanOrEqual(8);
      if (allBlocked) {
        expect(searches).toBeGreaterThanOrEqual(36 * Math.floor(16000 / 250));
        expect(los).toBeLessThanOrEqual(searches * 4);
      } else expect(searches).toBe(0); // Stable targets survive well beyond a search period.
      expect(geometryReads).toBe(coldReads);
      // 2x target headroom for shared CI hosts; cadence/peak work remain deterministic gates.
      if (!heap) expect(samples.reduce((a, b) => a + b, 0) / samples.length).toBeLessThan(2);
      console.info('FC_SEARCH ' + JSON.stringify({ baseCount, sources: sources.length, allBlocked,
        searchesPerTick: searches / 1000, maxSearchesPerTick, losPerTick: los / 1000, largestCandidates,
        meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95BatchMs: samples[18], geometryReads }));
      if (profile) console.info('FC_PROFILE ' + JSON.stringify({ baseCount, allBlocked,
        candidateMs: candidateMs / 1000, rankMs: rankMs / 1000, cacheMs: cacheMs / 1000,
        losMs: losMs / 1000, rankedFacesPerTick: rankedFaces / 1000 }));
    }
    generation++;
    for (let i = 0; i < 16; i++) tick();
    expect(geometryReads).toBe(baseCount * 2);
    tick(); expect(geometryReads).toBe(baseCount * 2);
    copies.clear(); combat.setBaseObstacles(null);
    rankSpy?.mockRestore(); cacheSpy?.mockRestore();
  }, 25000);
});
