import { describe, expect, it } from 'vitest';
import { plagueHarness, plagueSource, plagueTarget } from '../StinkPlagueTestHelper';

describe('plague horde processing', () => {
  it('processes 600 targets, multiple owners and every death with one shared damage tick per target', () => {
    const { runtime, damage } = plagueHarness();
    const targets = Array.from({ length: 600 }, (_, i) => plagueTarget('e'+i, i % 30 * 45, Math.floor(i / 30)*45));
    for (const target of targets) for (let owner=0; owner<4; owner++) {
      runtime.applyDirect(target, plagueSource('p'+owner, { damagePerTick: owner + 1, deathChunkCount: owner, pandemicEnabled: 1 }), 0);
    }
    runtime.advance(targets, 500); runtime.spread(targets, 500);
    expect(runtime.getSnapshot(500).targets).toHaveLength(targets.length);
    expect(damage).toHaveBeenCalledTimes(targets.length);
    expect(damage.mock.calls.every(([,source]) => source.ownerId === 'p3')).toBe(true);
    let chunks=0;
    for(const target of targets) { chunks += runtime.consumeDeath(target.ref, 500)?.count ?? 0; expect(runtime.consumeDeath(target.ref, 500)).toBeNull(); }
    expect(chunks).toBe(targets.length*3); expect(runtime.getSnapshot(500).targets).toEqual([]);
  });
  it('uses local buckets to infect every nearby target without full pair scans', () => {
    const { runtime, canReach, canTransfer } = plagueHarness();
    const targets = Array.from({ length: 600 }, (_, i) => plagueTarget('e'+i, Math.floor(i/2)*1000 + i%2*50));
    for(let i=0;i<targets.length;i+=2) runtime.applyDirect(targets[i], plagueSource('p'+(i%4), { pandemicEnabled: 1 }), 0);
    runtime.spread(targets, 0);
    expect(runtime.getSnapshot(0).targets).toHaveLength(targets.length);
    expect(canReach.mock.calls.length + canTransfer.mock.calls.length).toBeLessThan(targets.length * 4);
  });
});
