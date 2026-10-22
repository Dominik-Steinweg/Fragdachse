import { describe, expect, it } from 'vitest';
import { BeeFlockModel, type BeeHivePresentation, type BeeInstance } from '../src/effects/beeSwarm/BeeFlockModel';
import type { SyncedBeeSwarm } from '../src/types';

const hive: BeeHivePresentation = { index: 3, entranceX: 100, entranceY: 100, phase: 'recharging', progress: .1 };
const swarm = (patch: Partial<SyncedBeeSwarm>): SyncedBeeSwarm => ({ id: 7, hiveIndex: 3, phase: 'hunting', phaseStartedAt: 0,
  releasedAt: 0, x: 220, y: 140, target: null, hostile: false, stingSequence: 0, ...patch });

function run(model: BeeFlockModel, frames: number, swarms: (frame: number) => SyncedBeeSwarm[], start = 0) {
  const out: BeeInstance[] = [];
  let count = 0;
  for (let i = 0; i < frames; i++) {
    const time = (start + i) / 60;
    count = model.update({ swarms: swarms(i), hives: new Map([[3, hive]]), syncNow: time * 1000, time, dt: 1 / 60,
      beesPerSwarm: 22, targetPosition: () => null }, out);
  }
  return out.slice(0, count);
}

describe('BeeFlockModel', () => {
  it('is deterministic for the same swarm and frames', () => {
    const a = run(new BeeFlockModel(), 90, () => [swarm({})]);
    const b = run(new BeeFlockModel(), 90, () => [swarm({})]);
    expect(a).toEqual(b);
  });

  it('pours out of the hive and keeps its bees in a bounded cloud around the centre', () => {
    const early = run(new BeeFlockModel(), 2, () => [swarm({})]).filter(bee => !bee.veil);
    for (const bee of early) expect(Math.hypot(bee.x - hive.entranceX, bee.y - hive.entranceY)).toBeLessThan(12);
    const settled = run(new BeeFlockModel(), 240, () => [swarm({})]).filter(bee => !bee.veil);
    expect(settled.length).toBeGreaterThan(15);
    for (const bee of settled) expect(Math.hypot(bee.x - 220, bee.y - 140)).toBeLessThan(70);
  });

  it('lets bees circle the hive only once its cooldown is over', () => {
    const idle = (phase: BeeHivePresentation['phase'], progress: number) => {
      const out: BeeInstance[] = [];
      const count = new BeeFlockModel().update({ swarms: [], hives: new Map([[3, { ...hive, phase, progress }]]),
        syncNow: 0, time: 1, dt: 1 / 60, beesPerSwarm: 22, targetPosition: () => null }, out);
      return count;
    };
    expect(idle('recharging', .1)).toBe(0);
    expect(idle('recharging', .95)).toBe(0);
    expect(idle('idle', 0)).toBeGreaterThan(0);
  });

  it('flows back into the hive entrance when returning', () => {
    const model = new BeeFlockModel();
    run(model, 120, () => [swarm({})]);
    const back = run(model, 150, () => [swarm({ phase: 'returning', phaseStartedAt: 2000, x: 104, y: 102 })], 120)
      .filter(bee => !bee.veil);
    for (const bee of back) expect(Math.hypot(bee.x - hive.entranceX, bee.y - hive.entranceY)).toBeLessThan(20);
  });
});
