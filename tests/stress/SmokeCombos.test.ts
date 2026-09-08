import { describe, expect, it } from 'vitest';
import { smokeHarness, smokeEffect, smokeTarget, smokeSource, smokeDamage } from '../SmokeTestHelper';

describe('smoke electric group load', () => {
  it('processes every eligible target and every overlapping storm without a shared proc budget', () => {
    const { runtime, spawn } = smokeHarness();
    const config = smokeEffect({ dischargeCount: 3, growthMaxProcs: 6 });
    const targets = Array.from({ length: 600 }, (_, i) => smokeTarget(`enemy-${i}`, i % 20, Math.floor(i / 20)));
    const cloudCount = 6;
    for (let c = 0; c < cloudCount; c++) runtime.createCloud(0, 0, config, smokeSource(`owner-${c}`), 0);
    runtime.updateExposure(targets, 100);
    let ticks = 0;
    runtime.advanceStorm(100, (cloud, target, _damage, source) => {
      runtime.onDamage(smokeDamage(target, source, `storm:${cloud.id}:${target.ref.id}`), target.x, target.y, 100);
      ticks++;
    });
    expect(ticks).toBe(targets.length * cloudCount);
    for (const t of targets) {
      runtime.onDamage(smokeDamage(t, { ...smokeSource(), origin: 'burn' }, `burn:${t.ref.id}`), t.x, t.y, 110);
      runtime.onDamage(smokeDamage(t, { ...smokeSource(), origin: 'ground' }, `ground:${t.ref.id}`), t.x, t.y, 120);
    }
    expect(spawn).toHaveBeenCalledTimes(targets.length * config.behavior.dischargeCount);
    const later = 110 + config.behavior.dischargeCooldownMs;
    runtime.updateExposure(targets, later);
    for (const t of targets) runtime.onDamage(smokeDamage(t, smokeSource(), `kill:${t.ref.id}`, true), t.x, t.y, later);
    expect(spawn).toHaveBeenCalledTimes(targets.length * config.behavior.dischargeCount * 2);
    expect(runtime.getSnapshots(later).map(c => c.growthSequence)).toEqual([config.behavior.growthMaxProcs, 0, 0, 0, 0, 0]);
    expect(runtime.getTargetSnapshots(later)).toEqual([]);
    runtime.destroy();
  });
});
