import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx-x, ty-y) } },
  Utils: { Array: { Shuffle: (a: unknown[]) => a.reverse() } } }));
import { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import type { FireChunkBurstConfig, FireChunkFlight } from '../src/types';

function fixture() {
  let blocked = false;
  let groundFilter = (_x: number, _y: number) => true;
  const enemies = [
    { id: 'a', sprite: { x: 20, y: 0 }, getHp: () => 30, isBurrowed: () => false },
    { id: 'b', sprite: { x: 60, y: 0 }, getHp: () => 30, isBurrowed: () => false },
    { id: 'dead', sprite: { x: 30, y: 0 }, getHp: () => 0, isBurrowed: () => false },
    { id: 'ally', sprite: { x: 40, y: 0 }, getHp: () => 30, isBurrowed: () => false },
  ];
  enemies.forEach(e => Object.assign(e, { getCollisionRadius: () => 5 }));
  const placed = vi.fn();
  const refresh = vi.fn((...args: unknown[]) => { if (!blocked) placed(...args); });
  const fx = vi.fn(); const explode = vi.fn();
  const hasLineOfSight = vi.fn((_x: number, _y: number, tx: number) => tx >= 0);
  const system = new FlamethrowerUpgradeSystem({ getAllPlayers: () => [] } as never,
    { getAllEnemies: () => enemies } as never, { getTravelSamples: () => [] }, {} as never,
    { isAlive: () => true } as never, {} as never,
    { canPlaceGroundCell: (x: number, y: number) => !blocked && groundFilter(x, y), hostRefreshGroundCell: refresh } as never,
    () => false, () => false, () => {}, (_id, _stat, value) => value, fx,
    { hasLineOfSight, canTarget: (_id, enemy) => enemy !== 'ally', explode });
  const burst: FireChunkBurstConfig = { count: 3, searchRadius: 80, flightMs: 400, igniteCenter: false,
    durationMs: 900, burnDurationMs: 700, burnDamagePerTick: 2,
    requireLineOfSight: true, targetSurvivors: true,
    landingExplosion: { radius: 12, maxDamage: 10, knockback: 0, selfDamageMult: 0, excludeFriendlyPlayers: true } };
  const launch = (config = burst) => system.hostCreateFireChunkBurst('p', 0, 0, config, 'test', 1000);
  return { system, burst, launch, fx, explode, placed, refresh, enemies, hasLineOfSight, block: () => { blocked = true; },
    setGroundFilter: (filter: typeof groundFilter) => { groundFilter = filter; },
    flights: () => fx.mock.calls[0][2] as FireChunkFlight[] };
}

describe('shared fire-chunk landing contract', () => {
  it('targets distinct living enemies, snapshots their position and lands exactly once at individual times', () => {
    const f = fixture(); f.launch();
    const targets = f.flights();
    expect(targets.slice(0, 2)).toEqual([{ x: 60, y: 0, landsAt: 1300 }, { x: 20, y: 0, landsAt: 1100 }]);
    expect(targets.every(t => t.x >= 0 && Math.hypot(t.x, t.y) <= f.burst.searchRadius)).toBe(true);
    expect(targets).toHaveLength(3);
    f.enemies[0].sprite.x = 10000;
    f.system.hostUpdate(1099); expect(f.explode).not.toHaveBeenCalled();
    f.system.hostUpdate(1100); expect(f.explode).toHaveBeenCalledWith(expect.objectContaining({ x: 20, y: 0 }));
    f.system.hostUpdate(1500); f.system.hostUpdate(1600);
    expect(f.explode).toHaveBeenCalledTimes(targets.length); expect(f.placed).toHaveBeenCalledTimes(targets.length);
    expect(f.fx).toHaveBeenCalledOnce();
  });

  it('stops flight-line queries once an ordinary burst has enough valid landings', () => {
    const f = fixture();
    f.launch({ ...f.burst, count: 1, targetSurvivors: false });
    expect(f.flights()).toHaveLength(1);
    expect(f.hasLineOfSight).toHaveBeenCalledOnce();
  });

  it('uses distance-dependent timing for existing producers without the rocket options', () => {
    const f = fixture(); f.launch({ ...f.burst, targetSurvivors: false, requireLineOfSight: false, count: 30, landingExplosion: undefined });
    expect(new Set(f.flights().map(t => t.landsAt)).size).toBeGreaterThan(1);
    for (const target of f.flights()) expect(target.landsAt).toBeCloseTo(1000 + Math.max(1, Math.hypot(target.x, target.y) / 80 * 400));
    f.system.hostUpdate(1400); expect(f.explode).not.toHaveBeenCalled();
    expect(f.placed).toHaveBeenCalledTimes(f.flights().length);
  });

  it('does not invent landings when all cells are blocked, and keeps explosion independent of a later ground obstruction', () => {
    const f = fixture(); f.block(); f.launch(); expect(f.fx).not.toHaveBeenCalled();
    const g = fixture(); g.launch(); g.block(); g.system.hostUpdate(1500);
    expect(g.placed).not.toHaveBeenCalled(); expect(g.explode).toHaveBeenCalledTimes(g.flights().length);
    g.system.hostUpdate(1600); expect(g.explode).toHaveBeenCalledTimes(g.flights().length);
  });

  it('clears all pending landings at lifecycle end', () => {
    const f = fixture(); f.launch(); f.system.clear(); f.system.hostUpdate(2000);
    expect(f.refresh).not.toHaveBeenCalled(); expect(f.explode).not.toHaveBeenCalled();
  });
});


it('validates optional preferred positions and snapshots them before filling random landings', () => {
  const f = fixture();
  const preferred = [{ x: 40, y: 0 }, { x: -40, y: 0 }, { x: 999, y: 0 }];
  f.system.hostCreateFireChunkBurst('p', 0, 0, f.burst, 'preferred', 1000, undefined, preferred);
  expect(f.flights()[0]).toEqual({ x: 40, y: 0, landsAt: 1200 });
  preferred[0].x = 500;
  f.system.hostUpdate(1500);
  expect(f.explode).toHaveBeenCalledWith(expect.objectContaining({ x: 40, y: 0 }));
  expect(f.flights().every(p => p.x >= 0 && Math.hypot(p.x,p.y) <= f.burst.searchRadius)).toBe(true);
});

it('stops the remaining due landings if one aftershock ends the lifecycle', () => {
  const f = fixture(); f.launch();
  f.explode.mockImplementationOnce(() => f.system.clear());
  expect(() => f.system.hostUpdate(2000)).not.toThrow();
  expect(f.explode).toHaveBeenCalledOnce();
  expect(f.refresh).toHaveBeenCalledOnce();
  f.system.hostUpdate(2100); expect(f.explode).toHaveBeenCalledOnce();
});


describe('targeted fire chunks near survivors', () => {
  const key = (p: { x: number; y: number }) => Math.floor(p.x / 16) + ':' + Math.floor(p.y / 16);
  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const point = (x: number, y: number) => ({ x, y });

  it('sends all direct chunks first, distributes extras round-robin and only then fills randomly', () => {
    const f = fixture();
    f.enemies[0].sprite = point(40, 24); f.enemies[1].sprite = point(120, 24);
    const count = 9, perTarget = 3, radius = 32;
    f.launch({ ...f.burst, count, searchRadius: 180, nearbyChunksPerTarget: perTarget,
      landingExplosion: { ...f.burst.landingExplosion!, radius } });
    const flights = f.flights(), direct = flights.slice(0, 2);
    expect(direct.map(({ x, y }) => ({ x, y }))).toEqual([f.enemies[1].sprite, f.enemies[0].sprite]);
    for (let index = 0; index < perTarget * direct.length; index++) {
      expect(distance(flights[direct.length + index], direct[index % direct.length])).toBeLessThanOrEqual(radius);
    }
    expect(flights).toHaveLength(count);
    expect(direct.every(p => distance(flights.at(-1)!, p) > radius)).toBe(true);
    expect(new Set(flights.map(key)).size).toBe(count);
    for (const flight of flights) {
      expect(distance(flight, point(0, 0))).toBeLessThanOrEqual(180);
      expect(flight.landsAt).toBeCloseTo(1000 + Math.max(1, f.burst.flightMs * distance(flight, point(0, 0)) / 180));
    }
    const snapshot = flights.map(({ x, y }) => ({ x, y }));
    f.enemies[0].sprite.x += 1000; f.enemies[1].sprite.x += 1000;
    f.system.hostUpdate(2000); f.system.hostUpdate(2001);
    expect(f.explode).toHaveBeenCalledTimes(count);
    for (const target of snapshot) expect(f.explode).toHaveBeenCalledWith(expect.objectContaining(target));
  });

  it('prioritizes direct chunks when the budget is smaller than the survivor list', () => {
    const f = fixture();
    f.launch({ ...f.burst, count: 1, nearbyChunksPerTarget: 4 });
    expect(f.flights()).toEqual([expect.objectContaining(f.enemies[1].sprite)]);
  });

  it('prefers spread-out valid cells over clustering next to the direct landing', () => {
    const f = fixture(); f.enemies.splice(1); f.enemies[0].sprite = point(56, 56);
    const center = f.enemies[0].sprite;
    const cells = [center, point(24, 56), point(88, 56), point(56, 24), point(56, 88), point(72, 56)];
    f.setGroundFilter((x, y) => cells.some(p => p.x === x && p.y === y));
    f.launch({ ...f.burst, count: 3, searchRadius: 140, nearbyChunksPerTarget: 2,
      landingExplosion: { ...f.burst.landingExplosion!, radius: 40 } });
    const extra = f.flights().slice(1);
    expect(extra).toHaveLength(2);
    extra.forEach(p => expect(distance(p, center)).toBe(32));
    expect(distance(extra[0], extra[1])).toBeGreaterThanOrEqual(32);
  });

  it('reassigns an earlier cell so a later survivor can use its only reachable landing', () => {
    const launch = (count: number) => {
      const f = fixture(); f.enemies.splice(2);
      f.enemies[0].sprite = point(82, 24); f.enemies[1].sprite = point(30, 24);
      const shared = point(56, 24), alternative = point(24, 40), fallback = point(120, 72);
      const allowed = [shared, alternative, fallback, ...f.enemies.map(e => e.sprite)];
      f.setGroundFilter((x, y) => allowed.some(p => p.x === x && p.y === y));
      f.launch({ ...f.burst, count, searchRadius: 160, nearbyChunksPerTarget: 1,
        landingExplosion: { ...f.burst.landingExplosion!, radius: 30 } });
      return { f, shared, alternative };
    };
    const first = launch(3);
    expect(first.f.flights()[2]).toMatchObject(first.shared);
    const both = launch(4);
    expect(both.f.flights().slice(2)).toEqual([
      expect.objectContaining(both.alternative), expect.objectContaining(both.shared),
    ]);
  });

  it.each([0, 2])('uses random fallback after a nearby quota of %s and emits fewer chunks if the pool is exhausted', perTarget => {
    const f = fixture(); f.enemies.splice(1); f.enemies[0].sprite = point(56, 24);
    const close = [point(40, 24), point(72, 24)];
    const far = [point(120, 24), point(136, 24)];
    const allowed = [f.enemies[0].sprite, ...close, ...far];
    f.setGroundFilter((x, y) => allowed.some(p => p.x === x && p.y === y));
    f.launch({ ...f.burst, count: 9, searchRadius: 160, nearbyChunksPerTarget: perTarget,
      landingExplosion: { ...f.burst.landingExplosion!, radius: 20 } });
    expect(f.flights()).toHaveLength(allowed.length);
    if (perTarget) {
      expect(f.flights().slice(1, 3).every(p => distance(p, f.enemies[0].sprite) <= 20)).toBe(true);
      expect(f.flights().slice(3).every(p => distance(p, f.enemies[0].sprite) > 20)).toBe(true);
    }
    expect(new Set(f.flights().map(key)).size).toBe(allowed.length);
  });

  it('keeps preferred points independent of the survivor-specific extra quota', () => {
    const launch = (nearbyChunksPerTarget?: number) => {
      const f = fixture();
      f.system.hostCreateFireChunkBurst('p', 0, 0, { ...f.burst, count: 5, nearbyChunksPerTarget },
        'preferred', 1000, undefined, [point(40, 0)]);
      return f.flights();
    };
    expect(launch(3)).toEqual(launch());
  });

  it('rejects blocked or occluded near cells and falls back when none is reachable', () => {
    const f = fixture(); f.enemies.splice(1); f.enemies[0].sprite = point(4, 24);
    const blocked = point(8, 40), occluded = point(-8, 24), far = point(72, 24);
    const allowed = [f.enemies[0].sprite, occluded, far]; // The other near cell has no valid ground.
    f.setGroundFilter((x, y) => allowed.some(p => p.x === x && p.y === y));
    f.launch({ ...f.burst, count: 4, searchRadius: 90, nearbyChunksPerTarget: 3,
      landingExplosion: { ...f.burst.landingExplosion!, radius: 24 } });
    expect(f.flights()).toEqual([expect.objectContaining(f.enemies[0].sprite), expect.objectContaining(far)]);
    expect(f.flights()).not.toContainEqual(expect.objectContaining(blocked));
    expect(f.flights()).not.toContainEqual(expect.objectContaining(occluded));
  });
});
