import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

vi.mock('phaser', async () => {
  const fake = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  const require = createRequire(import.meta.url);
  const root = require.resolve('phaser/package.json').replace(/package\.json$/, '');
  return { ...fake, Geom: { ...fake.Geom,
    Line: require(root + 'src/geom/line/Line.js'),
    Rectangle: require(root + 'src/geom/rectangle/Rectangle.js'),
    Intersects: require(root + 'src/geom/intersects/index.js'),
  } };
});

import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../../src/config/coopDefenseEnemies';
import { WEAPON_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { CoopDefenseFirestarterSystem } from '../../src/systems/CoopDefenseFirestarterSystem';
import { findFirestarterCombo, FirestarterPositioning } from '../../src/systems/firestarterPositioning';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { DetonationSystem } from '../../src/systems/DetonationSystem';
import { resolveDetonations, type DetonationEffectSink } from '../../src/systems/DetonationResolver';
import { FlamethrowerUpgradeSystem } from '../../src/systems/FlamethrowerUpgradeSystem';
import { FireSystem } from '../../src/effects/FireSystem';
import { createProjectileRuntimeTestWorld } from '../ProjectileRuntimeTestHelper';
import { headlessProjectileSpawnRequest } from '../HeadlessProjectileSpawnHelper';
import type { EnemyEntity } from '../../src/entities/EnemyEntity';
import type { ProjectileDetonableSample } from '../../src/projectile/ProjectileGameplayPort';

const authored = getCoopDefenseEnemyConfig('firestarter-badger');
const config = authored.firestarter!;
const ballWeapon = WEAPON_CONFIGS[config.fireballWeaponId];
const lanceWeapon = WEAPON_CONFIGS[config.lanceWeaponId];
const burst = ballWeapon.detonable!.explosion!.fireChunkBurst!;
const stages = [1, 2, 4, 8, 16, 32, 64];
const seeds = [17, 71, 313];
afterEach(() => vi.restoreAllMocks());

function random(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}

function actor(id: number, x = 0, y = 0) {
  let action = 'none';
  const enemy = { id: `firestarter:${id}`, kind: 'firestarter-badger', faction: 'hostile',
    sprite: { active: true, x, y }, getHp: () => authored.maxHp,
    isBurrowed: () => false, isAttackMovementPaused: () => false,
    faceAngle() {}, stopMovement() {}, setSpecialAction(next: string) { action = next; },
  } as unknown as EnemyEntity;
  return { enemy, action: () => action };
}

/** Analytical rock rectangles at the geometry port; no renderer, navigation or physics timing. */
function arena(corridor: boolean, seed: number) {
  const gapY = 55 + random(seed)() * 25;
  const rocks = corridor ? [new Phaser.Geom.Rectangle(240, -500, 32, gapY + 500),
    new Phaser.Geom.Rectangle(240, gapY + 96, 32, 500)] : [];
  return (x: number, y: number, tx: number, ty: number, radius = 0) => !rocks.some(rock =>
    Phaser.Geom.Intersects.LineToRectangle(new Phaser.Geom.Line(x, y, tx, ty),
      new Phaser.Geom.Rectangle(rock.x - radius, rock.y - radius, rock.width + 2 * radius, rock.height + 2 * radius)));
}

function decisionFixture(n: number, players: number, corridor: boolean, seed: number, ballCount = 4 * n) {
  const rng = random(seed), line = arena(corridor, seed);
  const actors = Array.from({ length: n }, (_, i) => actor(i, rng() * 20, rng() * 30));
  const enemies = [...actors.map(a => a.enemy), ...Array.from({ length: 100 }, (_, i) =>
    ({ ...actor(n + i).enemy, kind: 'zombie-badger' } as EnemyEntity))];
  const catalog = new EnemyAiTargetCatalog();
  catalog.updateTargets(Array.from({ length: players }, (_, i) => ({ kind: 'player' as const,
    id: `p:${i}`, x: 550 + rng() * 25, y: i * 24, isTargetable: () => true })));
  const balls: ProjectileDetonableSample[] = Array.from({ length: ballCount }, (_, i) => ({
    projectileId: i, ownerId: `firestarter:${i % n}`, tag: ballWeapon.detonable!.tag, allowCrossTeam: true,
    x: 500 + rng() * 120, y: rng() * 160 - 40, vx: 20, vy: 0,
    remainingLifetimeMs: config.lance.telegraphMs * 10,
  }));
  const counts = { reads: 0, visits: 0, maxVisitsPerTick: 0, lineOfFire: 0, shots: 0, balls: 0, lances: 0, dodges: 0 };
  const read = { readDetonableProjectiles(visit: (ball: ProjectileDetonableSample) => void) {
    counts.reads++; for (const ball of balls) { counts.visits++; visit(ball); }
  } };
  let stunned = false;
  const geometry = { hasClearLineOfFire(x: number, y: number, tx: number, ty: number, opts?: { clearanceRadius?: number }) {
    counts.lineOfFire++; return line(x, y, tx, ty, opts?.clearanceRadius);
  }, isStunned: () => stunned };
  const dodge = { isDodging: () => false, getDodgeDistance: (_id: string, mode: string) => mode === 'short' ? 70 : 140,
    canDodgeTo: () => true, requestDodge: () => {
      counts.dodges++; return true;
    } };
  const system = new CoopDefenseFirestarterSystem({ getAllEnemies: () => enemies }, geometry,
    { fire: weapon => { counts.shots++; weapon.id === config.lanceWeaponId ? counts.lances++ : counts.balls++; return true; },
      fireGauss: () => false }, read, catalog, dodge);
  return { actors, enemies, balls, counts, read, geometry, dodge, catalog, system,
    stun: () => { stunned = true; },
    tick(now: number) { const before = counts.visits; system.hostUpdate(now);
      counts.maxVisitsPerTick = Math.max(counts.maxVisitsPerTick, counts.visits - before); },
    teardown(now = 1000000) {
      system.clear(); enemies.length = 0; system.hostUpdate(now); system.refreshPresentation(now);
      for (const { enemy, action } of actors) {
        expect(action()).toBe('none'); expect(system.blocksDodge(enemy.id)).toBe(false);
        expect(system.blocksRegularAttacks(enemy.id)).toBe(false);
        expect(system.getChargeSnapshot(enemy.id, now)).toBeNull();
      }
    },
  };
}

// Runner watchdog only; performance assertions below use operations, never elapsed wall time.
describe('firestarter decision work budgets', { timeout: 60000 }, () => {
  it.each(stages)('%i shooters: open/corridors, 1/4 players, three seeds, 3N/4N balls', n => {
    for (const players of [1, 4]) for (const corridor of [false, true]) {
      const runs = [];
      for (const seed of seeds) for (const stock of [3, 4]) {
        const f = decisionFixture(n, players, corridor, seed, stock * n);
        for (let frame = 0; frame < 120; frame++) f.tick(frame * 1000 / 60);
        runs.push({ seed, stock, ...f.counts });
        expect(f.counts.lineOfFire).toBeGreaterThan(0);
        // At most two reposition horizons, one combo scan and one direct read per player per tick.
        expect(f.counts.maxVisitsPerTick).toBeLessThanOrEqual(n * stock * n * (3 + players));
        f.teardown();
      }
      console.log('FIRESTARTER_MATRIX', JSON.stringify({ n, players, arena: corridor ? 'corridor' : 'open', runs }));
    }
  });

  it.each(stages)('%i blocked shooters retry combo scans at authored intervals, independent of player count', n => {
    for (const players of [1, 4]) {
      const f = decisionFixture(n, players, false, 17);
      f.geometry.hasClearLineOfFire = () => { f.counts.lineOfFire++; return false; };
      const duration = 1000;
      for (let now = 0; now < duration; now += 10) f.tick(now);
      const maxReads = n * (2 * Math.ceil(duration / config.positioning.reevaluateIntervalMs)
        + Math.ceil(duration / authored.attackScanIntervalMs));
      console.log('FIRESTARTER_BLOCKED', JSON.stringify({ n, players, ...f.counts, maxReads }));
      expect.soft(f.counts.reads).toBeLessThanOrEqual(maxReads);
      expect.soft(f.counts.visits).toBeLessThanOrEqual(maxReads * f.balls.length);
      const positionDecisions = Math.ceil(duration / config.positioning.reevaluateIntervalMs);
      const attackDecisions = Math.ceil(duration / authored.attackScanIntervalMs);
      expect.soft(f.counts.lineOfFire).toBeLessThanOrEqual(n * (5 * positionDecisions * (f.balls.length + players)
        + attackDecisions * f.balls.length + duration / 10 * 2 * players));
      expect(f.counts.shots).toBe(0); expect(f.counts.dodges).toBe(0);
      f.teardown();
    }
  });

  it.each([128, 256, 512])('filters %i distant balls before any per-player combo scoring, retaining inward flights', count => {
    let targetReads = 0, visits = 0;
    const target = { get x() { targetReads++; return config.lance.rangePx - 10; }, y: 0 };
    const distant = Array.from({ length: count }, (_, i) => ({ projectileId: i, ownerId: 'foreign',
      tag: ballWeapon.detonable!.tag, allowCrossTeam: true, x: 10000 + i, y: 0 }));
    const read = { readDetonableProjectiles: (visit: (ball: ProjectileDetonableSample) => void) => {
      for (const ball of distant) { visits++; visit(ball); }
    } };
    const geometry = { hasClearLineOfFire: vi.fn(() => true) };
    expect(findFirestarterCombo('e', { x: 0, y: 0 }, [target, target, target, target], config, read, geometry)).toBeNull();
    expect(visits).toBe(count); expect(targetReads).toBe(0); expect(geometry.hasClearLineOfFire).not.toHaveBeenCalled();
    const incoming = { ...distant[0], x: config.lance.rangePx + 10, vx: -20 / (config.lance.telegraphMs / 1000) };
    expect(findFirestarterCombo('e', { x: 0, y: 0 }, [target], config,
      { readDetonableProjectiles: visit => visit(incoming) }, geometry)).toEqual({ x: config.lance.rangePx - 10, y: 0 });
  });

  it('bounds reposition reads by prediction horizons instead of candidate positions and players', () => {
    const f = decisionFixture(1, 4, false, 17, 512);
    f.balls.forEach(ball => Object.assign(ball, { x: 10000 }));
    new FirestarterPositioning().tryReposition(f.actors[0].enemy,
      Array.from({ length: 4 }, (_, i) => ({ x: 550, y: i * 10 })), config, f.read, f.geometry, f.dodge, 0);
    expect(f.counts.reads).toBeLessThanOrEqual(2);
    expect(f.counts.visits).toBeLessThanOrEqual(2 * 512);
    f.teardown();
  });

  it('reacquires a new combo at the next attack scan after a failed search', () => {
    const f = decisionFixture(1, 1, false, 17, 0);
    f.geometry.hasClearLineOfFire = (_x, _y, _tx, ty) => ty === 10;
    f.dodge.canDodgeTo = () => false;
    f.tick(0);
    f.balls.push({ projectileId: 1, ownerId: 'foreign', tag: ballWeapon.detonable!.tag,
      allowCrossTeam: true, x: 550, y: 10 });
    f.tick(authored.attackScanIntervalMs - 1);
    expect(f.actors[0].action()).toBe('none');
    f.tick(authored.attackScanIntervalMs);
    expect(f.actors[0].action()).toBe('fire-lance-charge');
    f.tick(authored.attackScanIntervalMs + config.lance.telegraphMs);
    expect(f.counts.lances).toBe(1); f.teardown();
  });

  it.each([60000, 600000])('keeps blocked decisions bounded through %i ms of virtual host time', duration => {
    const f = decisionFixture(duration === 60000 ? 32 : 1, 4, false, 71);
    f.geometry.hasClearLineOfFire = () => { f.counts.lineOfFire++; return false; };
    for (let now = 0; now < duration; now += 20) f.tick(now);
    expect(f.counts.reads).toBeLessThanOrEqual(f.actors.length *
      (2 * Math.ceil(duration / config.positioning.reevaluateIntervalMs) + Math.ceil(duration / authored.attackScanIntervalMs)));
    f.teardown(duration + 1);
  });
});

function payloadFixture(seed: number, corridor = false) {
  const world = createProjectileRuntimeTestWorld();
  const detonation = new DetonationSystem(world.runtime);
  const fire = new FireSystem({} as never);
  const line = arena(corridor, seed);
  fire.setGroundResolvers(bounds => corridor && !line(bounds.left, bounds.centerY, bounds.right, bounds.centerY), null);
  let chunks = 0, refreshes = 0, los = 0;
  const refresh = fire.hostRefreshGroundCell.bind(fire);
  vi.spyOn(fire, 'hostRefreshGroundCell').mockImplementation((...args) => { refreshes++; return refresh(...args); });
  const system = new FlamethrowerUpgradeSystem({ getAllPlayers: () => [] } as never, null,
    { getTravelSamples: () => [] }, {} as never, {} as never, {} as never, fire,
    () => false, () => false, () => {}, (_id, _stat, value) => value,
    (_x, _y, targets) => { chunks += targets.length; },
    { hasLineOfSight: (x, y, tx, ty) => { los++; return line(x, y, tx, ty); }, canTarget: () => false, explode() {} });
  const sink: DetonationEffectSink = {
    resolveProjectileExplosion(event, explosion) {
      system.hostCreateFireChunkBurst(event.detonatorOwnerId, event.x, event.y,
        { ...explosion.fireChunkBurst!, randomSeed: seed }, `combo:${event.projectileId}`, 0);
    },
    spawnComboEssence() {}, applyComboLightning() {}, applyAoeDamage() {}, applyRadialImpulse() {},
    applyEnvironmentDamage() {}, playExplosion() {}, spawnDotArea() {}, resolveOwnerColor: () => undefined,
  };
  const spawn = (index: number, x = 200 + index % 8 * 64, y = 300 + Math.floor(index / 8) % 8 * 64) => {
    const fireConfig = ballWeapon.fire;
    if (fireConfig.type !== 'projectile') throw new Error('Expected firestarter projectile');
    const request = headlessProjectileSpawnRequest(x, y, 0, `firestarter:${index}`,
      { speed: fireConfig.projectileSpeed, size: fireConfig.projectileSize,
        lifetimeMs: 1000 * ballWeapon.range / fireConfig.projectileSpeed, weaponSourceId: ballWeapon.id });
    return world.runtime.spawnProjectile({ ...request, interaction: { ...request.interaction, detonable: ballWeapon.detonable } })!;
  };
  return { ...world, detonation, fire, system, sink, spawn,
    counts: () => ({ chunks, refreshes, los, cells: fire.getGroundState().cells.length }),
    teardown() {
      system.clear(); detonation.reset(); world.runtime.destroy(); fire.destroyAll();
      const before = refreshes;
      system.hostUpdate(1000000);
      expect(refreshes).toBe(before); expect(world.runtime.activeCount).toBe(0);
      expect(detonation.flushDetonations()).toEqual([]);
      expect(fire.hostUpdate(1000000)).toMatchObject({ ground: { cells: [] }, damageEvents: [] });
      const samples: unknown[] = []; world.runtime.readDetonableProjectiles(sample => samples.push(sample));
      expect(samples).toEqual([]);
    },
  };
}

describe('firestarter projectile, chunk and ground lifetime stress', () => {
  it('expires 512 travelling balls without leaving detonables or physics handles active', () => {
    const f = payloadFixture(17);
    const ids = Array.from({ length: 512 }, (_, index) => f.spawn(index));
    const lifetime = 1000 * ballWeapon.range / (ballWeapon.fire.type === 'projectile' ? ballWeapon.fire.projectileSpeed : NaN);
    for (const id of ids) {
      const handle = f.physics.handles.get(id)!;
      f.physics.observe(id, handle.sprite.x + 10, handle.sprite.y, handle.body.velocity.x, 0);
    }
    f.setHostNowMs(lifetime + 1); f.runtime.runHostProjectileStage(lifetime + 1, lifetime + 1);
    expect(f.runtime.activeCount).toBe(0);
    expect(f.physics.released).toHaveLength(ids.length);
    for (const id of ids) expect(f.detonation.detonateProjectile(id, 'late-lance')).toBe(false);
    f.teardown();
  });
  it.each(stages)('%i simultaneous owners consume every ball once across the full charge stock', n => {
    for (const seed of seeds) for (const corridor of [false, true]) {
      const f = payloadFixture(seed, corridor), ids: number[] = [], detonated = new Set<number>();
      for (let charge = 0; charge < config.charges.maxCharges; charge++) {
        for (let i = 0; i < n; i++) {
          const id = f.spawn(i + charge * n); ids.push(id);
          expect(f.detonation.detonateProjectile(id, 'foreign-firestarter')).toBe(true);
          expect(f.detonation.detonateProjectile(id, 'second-lance')).toBe(false);
        }
        const events = f.detonation.flushDetonations();
        for (const event of events) { expect(detonated.has(event.projectileId)).toBe(false); detonated.add(event.projectileId); }
        resolveDetonations(f.sink, events);
      }
      expect(detonated.size).toBe(n * config.charges.maxCharges);
      expect(f.runtime.activeCount).toBe(0);
      f.system.hostUpdate(burst.flightMs + 1);
      const counts = f.counts();
      expect(counts.chunks).toBeLessThanOrEqual(ids.length * burst.count);
      if (!corridor) expect(counts.chunks).toBe(ids.length * burst.count);
      expect(counts.refreshes).toBe(counts.chunks + ids.length * Number(burst.igniteCenter));
      expect(counts.cells).toBeGreaterThan(0); expect(counts.cells).toBeLessThanOrEqual(counts.refreshes);
      f.system.hostUpdate(burst.flightMs + 2); expect(f.counts()).toEqual(counts);
      expect(f.fire.hostUpdate(burst.flightMs + burst.durationMs + 2).ground.cells).toEqual([]);
      console.log('FIRESTARTER_PAYLOAD', JSON.stringify({ n, seed, corridor, detonations: detonated.size, ...counts }));
      f.teardown();
    }
  });

  it.each(['death', 'stun', 'conversion', 'clear'] as const)('handles %s during telegraph and projectile/chunk flight', cause => {
    const f = decisionFixture(32, 4, false, 17, 0), payload = payloadFixture(17);
    f.tick(0); expect(f.actors.every(a => a.action() === 'fire-lance-charge')).toBe(true);
    const ids = f.actors.map((_, index) => payload.spawn(index));
    if (cause === 'death') for (const { enemy } of f.actors) { f.system.handleKilled(enemy); enemy.sprite.active = false; }
    if (cause === 'stun') f.stun();
    if (cause === 'conversion') for (const { enemy } of f.actors) enemy.faction = 'allied';
    if (cause === 'clear') { f.system.clear(); f.enemies.length = 0; }
    f.tick(config.lance.telegraphMs); expect(f.counts.shots).toBe(0);
    expect(f.actors.every(a => a.action() === 'none')).toBe(true);
    for (const { enemy } of f.actors) expect(f.system.blocksDodge(enemy.id)).toBe(false);
    // Committed projectiles belong to the world, not the living/stunned/converted attack owner.
    expect(payload.runtime.activeCount).toBe(ids.length);
    for (const id of ids) expect(payload.detonation.detonateProjectile(id, 'other')).toBe(true);
    resolveDetonations(payload.sink, payload.detonation.flushDetonations());
    expect(payload.counts().chunks).toBe(ids.length * burst.count);
    // Teardown while chunks are airborne must prevent delayed ground sources.
    payload.teardown(); f.teardown();
  });

  it('stops each simultaneous lance at its first orb and drains the event queue only once', () => {
    const f = payloadFixture(71);
    const ids = Array.from({ length: 64 }, (_, index) => f.spawn(index, 200, index * 40));
    const behind = Array.from({ length: 64 }, (_, index) => f.spawn(index + 64, 400, index * 40));
    for (let i = 0; i < ids.length; i++) {
      const y = i * 40;
      const hit = f.detonation.checkHitscanDetonations(0, y, config.lance.rangePx, y, 'foreign', lanceWeapon.detonator!);
      expect(hit).not.toBeNull(); expect(hit!.x).toBeLessThan(200);
    }
    expect(f.detonation.flushDetonations().map(event => event.projectileId)).toEqual(ids);
    expect(f.runtime.activeCount).toBe(behind.length);
    expect(f.detonation.flushDetonations()).toEqual([]); f.teardown();
  });
});
