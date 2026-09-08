import { describe, expect, it } from 'vitest';
import { smokeHarness, smokeEffect, smokeTarget, smokeSource, smokeDamage } from './SmokeTestHelper';

describe('smoke perception and lifetime', () => {
  it('uses one dominant exposure for movement and recovery while preserving weaker R2 tails', () => {
    const { runtime, status } = smokeHarness();
    const strong = runtime.createCloud(0, 0, smokeEffect({ confusionFraction: 0.8, aftereffectMs: 200, nearSightPx: 20 }), smokeSource(), 0);
    runtime.createCloud(0, 0, smokeEffect({ confusionFraction: 0.5, aftereffectMs: 400, nearSightPx: 20, vulnerabilityEnabled: 1 }), smokeSource('other'), 0);
    runtime.updateExposure([smokeTarget()], 100);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 200);
    expect(runtime.getConfusion('enemy-1', 300)?.cloudId).toBe(strong);
    expect(runtime.canSee('enemy-1', 200, 0, 260, 0, 120, 300)).toBe(true);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 400);
    expect(runtime.getConfusion('enemy-1', 400)?.cloudId).not.toBe(strong);
    expect(status.isVulnerable({ targetType: 'enemy', targetId: 'enemy-1' }, 400)).toBe(true);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 600);
    expect(runtime.getConfusion('enemy-1', 600)).toBeNull();
    expect(status.isVulnerable({ targetType: 'enemy', targetId: 'enemy-1' }, 600)).toBe(false);
  });
  it('retains confusion after exit, fades movement and gradually restores targeting range', () => {
    const { runtime } = smokeHarness(); const config = smokeEffect({ nearSightPx: 20 });
    runtime.createCloud(0, 0, config, smokeSource(), 0);
    runtime.updateExposure([smokeTarget()], 100);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 200);
    expect(runtime.canSee('enemy-1', 200, 0, 270, 0, 120, 200)).toBe(false);
    expect(runtime.canSee('enemy-1', 200, 0, 270, 0, 120, 310)).toBe(true);
    expect(runtime.getConfusion('enemy-1', 375)?.fraction).toBeCloseTo(config.behavior.confusionFraction / 2);
    expect(runtime.getConfusion('enemy-1', 400)).toBeNull();
    runtime.updateExposure([smokeTarget()], 410);
    expect(runtime.getConfusion('enemy-1', 410)?.fraction).toBe(config.behavior.confusionFraction);
  });
  it('blocks crossing rays, allows near sight and respects shielding obstacles', () => {
    let clear = true; const { runtime } = smokeHarness(() => clear);
    runtime.createCloud(0, 0, smokeEffect({ nearSightPx: 30 }), smokeSource(), 0);
    runtime.updateExposure([smokeTarget('outside', -200)], 100);
    expect(runtime.canSee('outside', -200, 0, 200, 0, 500, 100)).toBe(false);
    expect(runtime.canSee('outside', 0, 0, 20, 0, 500, 100)).toBe(true);
    clear = false; runtime.updateExposure([smokeTarget('shielded')], 110);
    expect(runtime.getConfusion('shielded', 110)).toBeNull();
    expect(runtime.canSee('outside', -200, 0, 200, 0, 500, 110)).toBe(true);
    runtime.advanceStorm(150, () => { throw Error('Shielded enemy was hit'); });
  });
  it('weakens boss confusion and removes retention without weakening vulnerability', () => {
    const { runtime, status } = smokeHarness(); const config = smokeEffect({ retentionBias: 0.75, vulnerabilityEnabled: 1 });
    runtime.createCloud(0, 0, config, smokeSource(), 0);
    runtime.updateExposure([smokeTarget('normal'), smokeTarget('boss', 0, 0, true)], 100);
    expect(runtime.getConfusion('boss', 100)?.fraction).toBe(config.behavior.confusionFraction * config.behavior.bossConfusionFactor);
    expect(runtime.getConfusion('boss', 100)?.retentionBias).toBe(0);
    expect(status.isVulnerable({ targetType: 'enemy', targetId: 'boss' }, 100)).toBe(true);
  });
  it('combines R2 sources without stacking or erasing another vulnerability', () => {
    const { runtime, status } = smokeHarness(); const statusTarget = { targetType: 'enemy' as const, targetId: 'enemy-1' };
    runtime.createCloud(0, 0, smokeEffect({ vulnerabilityEnabled: 1 }), smokeSource(), 0);
    runtime.createCloud(0, 0, smokeEffect({ confusionFraction: 0.8 }), smokeSource('player-2'), 0);
    runtime.updateExposure([smokeTarget()], 100);
    expect(runtime.getConfusion('enemy-1', 100)?.fraction).toBe(0.8);
    status.applyVulnerability(statusTarget, 2000, 100);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 200);
    runtime.updateExposure([smokeTarget('enemy-1', 200)], 400);
    expect(runtime.getConfusion('enemy-1', 400)).toBeNull();
    expect(status.getSnapshot(400)).toHaveLength(1);
    expect(status.isVulnerable(statusTarget, 400)).toBe(true);
    expect(status.isVulnerable(statusTarget, 2100)).toBe(false);
  });
  it('freezes configuration and invalidates status on entity generation changes', () => {
    const { runtime, charge, spawn } = smokeHarness(); const config = smokeEffect();
    const id = runtime.createCloud(0, 0, config, smokeSource(), 0);
    const target = smokeTarget(); runtime.updateExposure([target], 100); charge(target, id, 100);
    config.radius = 5000; expect(runtime.getSnapshots(100)[0].radius).toBe(100);
    const successor = smokeTarget('enemy-1', 500, 0, false, 2); runtime.updateExposure([successor], 200);
    runtime.onDamage(smokeDamage(successor), 500, 0, 200); expect(spawn).not.toHaveBeenCalled();
    runtime.clearTargets(); expect(runtime.getTargetSnapshots(200)).toEqual([]);
    runtime.destroy(); expect(runtime.getSnapshots(200)).toEqual([]);
  });
});

describe('smoke electric combos', () => {
  it('deduplicates confirmed outcomes across frames and keeps the frozen owner damage after departure', () => {
    const { runtime, charge, spawn } = smokeHarness(); const target = smokeTarget();
    const outgoing = { damageMultiplier: 1.2, criticalChance: 1, criticalDamageMultiplier: 2 };
    const config = smokeEffect({}, { sourceDamageMultiplier: 2, sourceOutgoingDamage: outgoing });
    const source = smokeSource('departed-owner');
    const id = runtime.createCloud(0, 0, config, source, 0);
    config.sourceDamageMultiplier = 9; source.attribution.id = 'replacement-owner'; outgoing.criticalChance = 0; outgoing.damageMultiplier = 9;
    runtime.updateExposure([target], 100); charge(target, id, 100);
    const hit = smokeDamage(target, smokeSource('teammate'), 'same-outcome');
    runtime.onDamage(hit, 0, 0, 101);
    runtime.updateExposure([target], 600); runtime.onDamage(hit, 0, 0, 600);
    expect(spawn).toHaveBeenCalledTimes(config.behavior.dischargeCount);
    expect(spawn.mock.calls[0][0]).toMatchObject({ provenance: { attributionId: 'departed-owner' },
      interaction: { directHit: { damage: config.behavior.dischargeDamage * 2 * 1.2 * 2 } } });
    expect(spawn.mock.calls[0][0].interaction.directHit.appliedSourceDamageFactors).toContainEqual({ kind: 'critical', multiplier: 2, resolvedAt: 'execution' });
  });
  it('stacks ticks, retains first-charge ownership and shares the enemy cooldown', () => {
    const { runtime, charge, spawn } = smokeHarness(); const target = smokeTarget();
    const first = runtime.createCloud(0, 0, smokeEffect({ dischargeCount: 1 }, { lingerDuration: 5000 }), smokeSource('first'), 0);
    const second = runtime.createCloud(0, 0, smokeEffect({ dischargeCount: 3 }, { lingerDuration: 5000 }), smokeSource('second'), 0);
    runtime.updateExposure([target], 100);
    let ticks = 0; runtime.advanceStorm(100, () => ticks++); expect(ticks).toBe(2);
    charge(target, first, 100, 'a'); charge(target, second, 150, 'b');
    runtime.onDamage(smokeDamage(target, smokeSource('teammate'), 'trigger'), 0, 0, 160);
    expect(spawn).toHaveBeenCalledTimes(1); expect(spawn.mock.calls[0][0].provenance.attributionId).toBe('first');
    runtime.onDamage(smokeDamage(target, smokeSource(), 'too-early'), 0, 0, 200); expect(spawn).toHaveBeenCalledTimes(1);
    charge(target, second, 2200, 'takeover');
    runtime.onDamage(smokeDamage(target, smokeSource(), 'later'), 0, 0, 2201);
    expect(spawn).toHaveBeenCalledTimes(4); expect(spawn.mock.calls[1][0].provenance.attributionId).toBe('second');
  });
  it('accepts lethal DoT, excludes smoke lightning and zero damage, and deduplicates death', () => {
    const { runtime, charge, spawn } = smokeHarness(); const target = smokeTarget(); const config = smokeEffect();
    const id = runtime.createCloud(0, 0, config, smokeSource(), 0); runtime.updateExposure([target], 100); charge(target, id, 100);
    runtime.onDamage(smokeDamage(target, smokeSource(), 'blocked', false, 0), 0, 0, 110);
    runtime.onDamage(smokeDamage(target, { ...smokeSource(), lineage: { smokeKind: 'discharge', smokeCloudId: id } }, 'bolt'), 0, 0, 120);
    expect(spawn).not.toHaveBeenCalled();
    const burn = { ...smokeSource('teammate'), origin: 'burn' as const };
    const hit = smokeDamage(target, burn, 'lethal-burn', true);
    runtime.onDamage(hit, 12, 9, 150); runtime.onDamage(hit, 12, 9, 150);
    expect(spawn).toHaveBeenCalledTimes(config.behavior.dischargeCount);
    expect(spawn.mock.calls[0][0]).toMatchObject({ origin: { x: 12, y: 9 },
      flight: { collisionFilter: { initialTargetProtection: { targetId: 'enemy-1', durationMs: config.behavior.dischargeHoming.acquireDelayMs } } } });
    expect(runtime.getSnapshots(150)[0].growthSequence).toBe(1);
  });
  it('grows on the first lethal storm tick, interpolates and caps additive growth', () => {
    const { runtime, charge } = smokeHarness(); const config = smokeEffect({ growthRadiusFraction: 0.1, growthMaxProcs: 2 });
    const id = runtime.createCloud(0, 0, config, smokeSource(), 0);
    for (let i = 0; i < 3; i++) {
      const target = smokeTarget(`enemy-${i}`); runtime.updateExposure([target], 100 + i * 200);
      const before = runtime.getSnapshots(100 + i * 200)[0].radius;
      charge(target, id, 100 + i * 200, `kill-${i}`, true);
      expect(runtime.getSnapshots(100 + i * 200)[0].radius).toBe(before);
    }
    const snapshot = runtime.getSnapshots(700)[0];
    expect(snapshot.radius).toBeCloseTo(config.radius * (1 + 2 * config.behavior.growthRadiusFraction));
    expect(snapshot.growthSequence).toBe(2);
    expect(snapshot.activeUntil).toBe(config.spreadDuration + config.lingerDuration + 2 * config.behavior.growthDurationMs);
  });
  it('discharges after field expiry but never revives a finished cloud', () => {
    const { runtime, charge, spawn } = smokeHarness(); const target = smokeTarget();
    const config = smokeEffect(); const id = runtime.createCloud(0, 0, config, smokeSource(), 0);
    runtime.updateExposure([target], 1000); charge(target, id, 1000); runtime.updateExposure([target], 1150);
    runtime.onDamage(smokeDamage(target, smokeSource(), 'late-kill', true), 0, 0, 1150);
    expect(spawn).toHaveBeenCalledTimes(config.behavior.dischargeCount);
    expect(runtime.getSnapshots(1150)[0]).toMatchObject({ phase: 'dissipating', growthSequence: 0 });
  });
});
