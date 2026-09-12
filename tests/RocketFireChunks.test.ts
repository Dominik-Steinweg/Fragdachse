import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Distance: { Between: (x: number, y: number, tx: number, ty: number) => Math.hypot(tx-x, ty-y) } },
  Utils: { Array: { Shuffle: (a: unknown[]) => a.reverse() } } }));
import { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import type { FireChunkBurstConfig, FireChunkFlight } from '../src/types';

function fixture() {
  let blocked = false;
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
  const system = new FlamethrowerUpgradeSystem({ getAllPlayers: () => [] } as never,
    { getAllEnemies: () => enemies } as never, { getTravelSamples: () => [] }, {} as never,
    { isAlive: () => true } as never, {} as never,
    { canPlaceGroundCell: () => !blocked, hostRefreshGroundCell: refresh } as never,
    () => false, () => false, () => {}, (_id, _stat, value) => value, fx,
    { hasLineOfSight: (_x, _y, tx) => tx >= 0, canTarget: (_id, enemy) => enemy !== 'ally', explode });
  const burst: FireChunkBurstConfig = { count: 3, searchRadius: 80, flightMs: 400, igniteCenter: false,
    durationMs: 900, burnDurationMs: 700, burnDamagePerTick: 2,
    requireLineOfSight: true, targetSurvivors: true,
    landingExplosion: { radius: 12, maxDamage: 10, knockback: 0, selfDamageMult: 0, excludeFriendlyPlayers: true } };
  const launch = (config = burst) => system.hostCreateFireChunkBurst('p', 0, 0, config, 'test', 1000);
  return { system, burst, launch, fx, explode, placed, refresh, enemies, block: () => { blocked = true; },
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
