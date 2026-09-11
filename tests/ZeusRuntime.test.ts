import { describe, expect, it } from 'vitest';
import { ZeusRuntime, zeusSweepTime } from '../src/systems/ZeusRuntime';
import { CombatStunStatusSystem } from '../src/systems/CombatStunStatusSystem';
import { zeusFixture, zeusOutcome, zeusRef, zeusTarget } from './ZeusTestHelper';

describe('Zeus body sweep and use lifetime', () => {
  it('stops remaining body contacts immediately when a contact kills the owner', () => {
    const f = zeusFixture({ groundEnabled: 1 });
    f.targets.push(zeusTarget('first', 20), zeusTarget('second', 40));
    f.damage.mockImplementation((_use, target) => { f.isOwnerActive.mockReturnValue(false); return zeusOutcome(target); });
    f.runtime.startBall(f.use, f.movement, 0);
    f.runtime.move({ ...f.movement, x: 60 }, 10);
    expect(f.damage).toHaveBeenCalledOnce();
    expect(f.runtime.snapshot()).toEqual({ balls: [], ground: [], stuns: [] });
  });
  it('hits a fast crossing once across direction changes and recovery growth', () => {
    const f = zeusFixture(); f.targets.push(zeusTarget('a', 50));
    f.runtime.startBall(f.use, f.movement, 0);
    f.runtime.move({ ...f.movement, x: 100 }, 10);
    f.runtime.move({ ...f.movement, x: 0, radius: 10 }, 20);
    expect(f.damage).toHaveBeenCalledTimes(1);
    f.runtime.endBall('owner');
    f.runtime.move({ ...f.movement, x: 100 }, 30);
    expect(f.damage).toHaveBeenCalledTimes(1);
  });
  it('includes initial overlaps and hitbox growth, without inflating the earlier path', () => {
    expect(zeusSweepTime({ x: 0, y: 0, radius: 1 }, { x: 0, y: 0, radius: 6 }, { x: 5, y: 0, radius: 1 })).toBeCloseTo(0.6);
    expect(zeusSweepTime({ x: 0, y: 0, radius: 1 }, { x: 100, y: 0, radius: 12 }, { x: 0, y: 9, radius: 1 })).toBeNull();
    const f = zeusFixture(); f.targets.push(zeusTarget('overlap', 0));
    f.runtime.startBall(f.use, f.movement, 0);
    expect(f.damage).toHaveBeenCalledTimes(1);
  });
  it('does not sweep or lay ground across a teleport, but does hit at the destination', () => {
    const f = zeusFixture({ groundEnabled: 1 }); f.targets.push(zeusTarget('between', 50), zeusTarget('exit', 100));
    f.runtime.startBall(f.use, f.movement, 0);
    f.runtime.move({ ...f.movement, x: 100, positionRevision: 1 }, 10);
    expect(f.damage.mock.calls.map(c => c[1].ref.id)).toEqual(['exit']);
    expect(f.runtime.snapshot().ground).toEqual([]);
  });
  it('keeps target incarnations independent until the timed body expires', () => {
    const f = zeusFixture(); const target = zeusTarget('same-id', 0); f.targets.push(target);
    expect(f.runtime.canApplyDashImpact('owner', target.ref)).toBe(true);
    f.runtime.startBall(f.use, f.movement, 0);
    expect(f.runtime.canApplyDashImpact('owner', target.ref)).toBe(true);
    f.targets[0] = { ...target, ref: zeusRef('same-id', 2) };
    expect(f.runtime.canApplyDashImpact('owner', f.targets[0].ref)).toBe(false);
    f.runtime.move(f.movement, 1);
    expect(f.runtime.canApplyDashImpact('owner', f.targets[0].ref)).toBe(true);
    expect(f.damage).toHaveBeenCalledTimes(2);
    f.runtime.step(f.config.ballDurationMs - 1); expect(f.runtime.snapshot().balls).toHaveLength(1);
    f.runtime.step(f.config.ballDurationMs); expect(f.runtime.snapshot().balls).toEqual([]);
    expect(f.runtime.canApplyDashImpact('owner', null)).toBe(true);
  });
  it('does not react to blocked damage and honours line/blocker checks', () => {
    const f = zeusFixture({ stormEnabled: 1, stunDurationMs: 50 }); const target = zeusTarget('a', 0); f.targets.push(target);
    f.canHit.mockReturnValue(false); f.runtime.startBall(f.use, f.movement, 0);
    expect(f.damage).not.toHaveBeenCalled();
    f.runtime.directHit(f.use, target, null, true, 0);
    expect(f.bolt).not.toHaveBeenCalled(); expect(f.stun).not.toHaveBeenCalled();
  });
});

describe('Zeus confirmed direct reactions', () => {
  it.each([false, true])('emits the configured simultaneous salvo for a direct kill (ball=%s)', ball => {
    const f = zeusFixture({ stormEnabled: 1, extraBolts: 3, killRangeBonus: 0.5 }); const target = zeusTarget('removed', 0);
    f.runtime.directHit(f.use, target, zeusOutcome(target, true), ball, 10);
    expect(f.bolt).toHaveBeenCalledTimes(f.config.boltCount + f.config.extraBolts);
    for (const args of f.bolt.mock.calls) expect(args[3]).toBe(f.config.boltRange * (1 + f.config.killRangeBonus));
    expect(f.stun).not.toHaveBeenCalled();
    const angles = f.bolt.mock.calls.map(c => c[2]);
    expect(angles[0]).toBeCloseTo(ball ? 0 : -Math.PI / 3);
    expect(angles.at(-1)).toBeCloseTo(ball ? 2 * Math.PI * (angles.length - 1) / angles.length : Math.PI / 3);
  });
  it('stuns survivors and keeps their salvo at baseline range', () => {
    const f = zeusFixture({ stormEnabled: 1, stunDurationMs: 50, killRangeBonus: 1 }); const t = zeusTarget('a', 0);
    f.runtime.directHit(f.use, t, zeusOutcome(t), false, 10);
    expect(f.stun).toHaveBeenCalledWith(t.ref, 50, 10);
    expect(f.bolt.mock.calls.every(c => c[3] === f.config.boltRange)).toBe(true);
  });
  it('freezes upgrade tuning and stops reentrant reactions when the world ends', () => {
    const f = zeusFixture({ stormEnabled: 1 }); const t = zeusTarget('a', 0);
    (f.config as { boltCount: number }).boltCount = 99;
    f.bolt.mockImplementationOnce(() => f.runtime.destroy());
    f.runtime.directHit(f.use, t, zeusOutcome(t), true, 0);
    expect(f.bolt).toHaveBeenCalledTimes(1);
    expect(f.runtime.snapshot()).toEqual({ balls: [], ground: [], stuns: [] });
  });
});

describe('electric ground', () => {
  it('lays only movement, merges own overlap, refreshes friendly speed and expires independently', () => {
    const f = zeusFixture({ groundEnabled: 1 });
    f.runtime.startBall(f.use, f.movement, 0); f.runtime.move(f.movement, 5);
    expect(f.runtime.snapshot().ground).toEqual([]);
    f.runtime.move({ ...f.movement, x: 20 }, 10); f.runtime.move(f.movement, 10);
    f.runtime.endBall('owner'); f.targets.push(zeusTarget('a', 10));
    f.runtime.step(10); f.runtime.step(1010);
    expect(f.damage).toHaveBeenCalledTimes(1);
    expect(f.damage.mock.calls[0][2]).toBe(f.config.groundDamagePerSecond);
    expect(f.stun).not.toHaveBeenCalled(); expect(f.bolt).not.toHaveBeenCalled();
    expect(f.runtime.getMoveBonus('friend', 1010)).toBe(f.config.groundMoveBonus);
    f.friendly[0].x = 1000;
    expect(f.runtime.getMoveBonus('friend', 1010 + f.config.groundMoveDurationMs)).toBe(0);
    f.runtime.step(10 + f.config.groundDurationMs);
    expect(f.runtime.snapshot().ground).toEqual([]);
  });
  it('adds independent owner contributions without multiplying same-owner segments', () => {
    const f = zeusFixture({ groundEnabled: 1 });
    for (const owner of ['a','b']) {
      const u = f.runtime.createUse(owner, 0, 0, 1, 1, f.config);
      f.runtime.startBall(u, { ...f.movement, playerId: owner }, 0);
      f.runtime.move({ ...f.movement, playerId: owner, x: 20 }, 1); f.runtime.endBall(owner);
    }
    f.targets.push(zeusTarget('target', 10)); f.runtime.step(1); f.runtime.step(1001);
    expect(f.damage.mock.calls.map(c => c[0].ownerId).sort()).toEqual(['a','b']);
  });
});

describe('hard stun ownership', () => {
  it('refreshes without addition or shortening and ignores successors', () => {
    const s = new CombatStunStatusSystem(), target = zeusRef();
    s.apply(target, 100, 0); s.apply(target, 20, 10);
    expect(s.snapshot(15, () => true)[0].expiresAt).toBe(100);
    s.apply(target, 100, 80); expect(s.snapshot(80, () => true)[0].expiresAt).toBe(180);
    expect(s.isStunned(zeusRef('enemy', 2), 90)).toBe(false);
    expect(s.snapshot(180, () => true)).toEqual([]);
  });
});
