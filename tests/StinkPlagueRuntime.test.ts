import { describe, it, expect } from 'vitest';
import { plagueHarness, plagueSource, plagueTarget } from './StinkPlagueTestHelper';

describe('plague shared status and generation contract', () => {
  it('refreshes direct infection without moving the shared tick clock and includes terminal ticks', () => {
    const { runtime, damage } = plagueHarness(); const target = plagueTarget(); const source = plagueSource();
    const interval = source.config.tickIntervalMs;
    runtime.applyDirect(target, source, 0);
    runtime.advance([target], interval - 1); expect(damage).not.toHaveBeenCalled();
    runtime.applyDirect(target, source, interval / 2);
    runtime.advance([target], interval); expect(damage).toHaveBeenCalledOnce();
    const end = interval / 2 + source.config.directDurationMs;
    runtime.advance([target], end);
    expect(damage).toHaveBeenCalledTimes(Math.floor(end / interval));
    expect(runtime.getSnapshot(end).targets).toEqual([]);
    runtime.applyDirect(target, source, end);
    runtime.advance([target], end + source.config.directDurationMs);
    expect(damage).toHaveBeenCalledTimes(Math.floor(end / interval) + source.config.directDurationMs / interval);
  });

  it('resolves independent maxima, stable damage attribution and eligible propagation only', () => {
    const { runtime, damage } = plagueHarness(); const a = plagueTarget(), b = plagueTarget('b', 55);
    runtime.applyDirect(a, plagueSource('z', { damagePerTick: 6, lifeLeechFraction: .3, deathChunkCount: 3, vulnerabilityEnabled: 1 }), 0);
    runtime.applyDirect(a, plagueSource('a', { damagePerTick: 3, pandemicEnabled: 1, lifeLeechFraction: .1, deathChunkCount: 1 }, 2), 100);
    runtime.advance([a,b], 500);
    expect(damage).toHaveBeenCalledOnce(); expect(damage.mock.calls[0][1].ownerId).toBe('a');
    expect(runtime.getLifeLeech(a.ref, 'ally', 500)).toBe(.3);
    expect(runtime.getLifeLeech(a.ref, 'enemy-player', 500)).toBe(0);
    runtime.spread([a,b], 500);
    expect(runtime.getLifeLeech(b.ref, 'ally', 500)).toBe(.1);
    expect(runtime.consumeDeath(b.ref, 500)).toEqual({ ownerId: 'a', count: 1 });
    expect(runtime.consumeDeath(a.ref, 500)).toEqual({ ownerId: 'z', count: 3 });
    expect(runtime.consumeDeath(a.ref, 500)).toBeNull();
  });

  it('spreads G0 → G1 → G2 in separate steps, refreshes to G0, and permits reinfection after expiry', () => {
    const { runtime } = plagueHarness(); const targets = [0,1,2,3].map(i => plagueTarget('e'+i, i*60));
    const source = plagueSource('p', { pandemicEnabled: 1 }); const p = source.config;
    runtime.applyDirect(targets[0], source, 0);
    runtime.spread(targets, 0);
    expect(runtime.getSnapshot(0).targets.map(t => t.enemyId)).toEqual(['e0','e1']);
    runtime.spread(targets, p.spreadIntervalMs);
    const g2 = runtime.getSnapshot(p.spreadIntervalMs).targets.find(t => t.enemyId === 'e2')!;
    expect(g2).toMatchObject({ infectiousUntil: 0, expiresAt: p.spreadIntervalMs + p.secondGenerationDurationMs });
    runtime.spread(targets, p.spreadIntervalMs*2); expect(runtime.isInfected(targets[3].ref, p.spreadIntervalMs*2)).toBe(false);
    runtime.applyDirect(targets[2], source, p.spreadIntervalMs*2);
    runtime.spread(targets, p.spreadIntervalMs*3); expect(runtime.isInfected(targets[3].ref, p.spreadIntervalMs*3)).toBe(true);
    runtime.advance(targets, p.firstGenerationDurationMs);
    expect(runtime.isInfected(targets[1].ref, p.firstGenerationDurationMs)).toBe(false);
    runtime.spread(targets, p.firstGenerationDurationMs);
    expect(runtime.isInfected(targets[1].ref, p.firstGenerationDurationMs)).toBe(true);
  });

  it('uses body edges for contact, does not redirect bosses and respects separate route/visibility checks', () => {
    const { runtime, canReach, canTransfer } = plagueHarness();
    const boss = plagueTarget('boss', 0, 0, 150, 1, true), near = plagueTarget('near', 205, 0, 15);
    const far = plagueTarget('far', 400); const source = plagueSource('p', { pandemicEnabled: 1 });
    runtime.applyDirect(boss, source, 0); canTransfer.mockReturnValue(false);
    runtime.spread([boss,near,far], 0); expect(runtime.isInfected(near.ref, 0)).toBe(false);
    canTransfer.mockReturnValue(true); runtime.spread([boss,near,far], 100);
    expect(runtime.isInfected(near.ref, 100)).toBe(true);
    expect(runtime.getMovementTarget(boss.ref, 100)).toBeNull();
    canReach.mockReturnValue(false); runtime.spread([boss,near,far], 200);
    expect(runtime.getMovementTarget(near.ref, 200)).toBeNull();
    canReach.mockReturnValue(true); runtime.spread([boss,near,far], 300);
    expect(runtime.getMovementTarget(near.ref, 300)?.ref.id).toBe('far');
  });

  it('allows multiple contacts and has no result dependence on input order', () => {
    const run = (reverse: boolean) => {
      const { runtime } = plagueHarness(); const targets = [plagueTarget('a'), plagueTarget('b', 50), plagueTarget('c', 0, 50)];
      runtime.applyDirect(targets[0], plagueSource('p', { pandemicEnabled: 1 }), 0);
      runtime.spread(reverse ? targets.reverse() : targets, 0);
      return runtime.getSnapshot(0).targets;
    };
    expect(run(false)).toHaveLength(3); expect(run(false)).toEqual(run(true));
  });

  it('does not infect through non-pandemic contributions and purges detached owners and reincarnated targets', () => {
    const { runtime, vulnerability } = plagueHarness(); const a = plagueTarget(), b = plagueTarget('b', 40);
    runtime.applyDirect(a, plagueSource('one', { vulnerabilityEnabled: 1 }), 0);
    runtime.applyDirect(a, plagueSource('two'), 0); runtime.spread([a,b], 0);
    expect(runtime.isInfected(b.ref, 0)).toBe(false);
    runtime.removeOwner('one', 10); expect(vulnerability).toHaveBeenLastCalledWith(a.ref, null);
    expect(runtime.isInfected(a.ref, 10)).toBe(true);
    const reused = plagueTarget('e1', 0, 0, 10, 2); runtime.advance([reused,b], 500);
    expect(runtime.getSnapshot(500).targets).toEqual([]);
    runtime.applyDirect(reused, plagueSource(), 500); runtime.clear();
    expect(runtime.getSnapshot(500).targets).toEqual([]); expect(runtime.getMovementTarget(reused.ref, 500)).toBeNull();
  });
});
