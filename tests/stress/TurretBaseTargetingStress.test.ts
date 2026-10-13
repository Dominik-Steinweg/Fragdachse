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

// Actual binding method and geometry/cache; synthetic dense concave base footprints.
// Wall-clock is diagnostic only. Assertions protect D25 and catch catastrophic regressions.
describe('turret base target search: four inspectors and twelve parallel copies', () => {
  it.each([3, 4])('bounds %i bases, invalidates generation, and measures real LOS', baseCount => {
    const metrics = resolveCoopDefenseWorldMetrics(80, 80);
    const combat = new WorldCombatCore({ getAllPlayers: () => [] } as never, {} as never);
    combat.setWorldMetrics(metrics);
    let generation = 1, geometryReads = 0;
    const bases = Array.from({ length: baseCount }, (_, b) => {
      const cells = Array.from({ length: 12 * 12 }, (_, i) => ({ gridX: 30 + b * 5 + i % 12, gridY: 30 + Math.floor(i / 12) }))
        .filter(c => !(c.gridX % 3 === 0 && c.gridY > 34));
      return { id: `concave-${b}`, getHp: () => 1000000, isDamageable: () => true,
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
    // No firing: every frame is a search frame, not hidden by burst/cooldown work.
    turret.setFireHandler(null);
    let searches = 0, los = 0, largestCandidates = 0;
    turret.setBaseTargetCandidateProvider((s, x, y, range) => {
      searches++;
      const candidates = owner.getHostileBaseAimCandidates(s, x, y, range);
      largestCandidates = Math.max(largestCandidates, candidates.length);
      return candidates;
    });
    let blocked = false;
    turret.setLineOfFireChecker((sx, sy, ex, ey) => {
      los++;
      const clear = combat.hasClearLineOfFire(sx, sy, ex, ey);
      return !blocked && clear;
    });
    const tick = () => turret.hostUpdate(1000, UTILITY_CONFIGS.SPORE_TURRET as never, WEAPON_CONFIGS.SPORES, 16);
    tick(); const coldReads = geometryReads;
    expect(coldReads).toBe(baseCount);
    for (const allBlocked of [false, true]) {
      blocked = allBlocked;
      for (let warm = 0; warm < 100; warm++) tick();
      searches = 0; los = 0;
      const samples: number[] = [];
      for (let batch = 0; batch < 20; batch++) {
        const start = performance.now();
        for (let i = 0; i < 50; i++) tick();
        samples.push((performance.now() - start) / 50);
      }
      samples.sort((a, b) => a - b);
      expect(largestCandidates).toBeLessThanOrEqual(4);
      expect(searches).toBe(36 * 1000);
      expect(los).toBeLessThanOrEqual(searches * 4);
      expect(geometryReads).toBe(coldReads);
      // Intentionally generous: diagnostic milliseconds are NOT a device-independent SLA.
      expect(samples.reduce((a, b) => a + b, 0) / samples.length).toBeLessThan(50);
      console.info('FC_SEARCH ' + JSON.stringify({ baseCount, sources: sources.length, allBlocked,
        searchesPerTick: searches / 1000, losPerTick: los / 1000, largestCandidates,
        meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95BatchMs: samples[18], geometryReads }));
    }
    generation++; tick(); expect(geometryReads).toBe(baseCount * 2);
    tick(); expect(geometryReads).toBe(baseCount * 2);
    copies.clear(); combat.setBaseObstacles(null);
  }, 25000);
});
