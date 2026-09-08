import { describe, expect, it } from 'vitest';
import { DecoyRuntime } from '../src/systems/DecoyRuntime';
import { decoyInput, resolvedDecoy } from './DecoyTestHelper';

describe('DecoyRuntime', () => {
  it('copies current life exactly, snapshots activation tuning and admits one decoy per owner', () => {
    const runtime = new DecoyRuntime();
    const config = { ...resolvedDecoy(), fireChunkBurst: { ...resolvedDecoy().fireChunkBurst } };
    const input = decoyInput({ hp: 0.5, maxHp: 250, armor: 7.25, config });
    const decoy = runtime.activate(input)!;
    input.hp = 200; config.stealthHpRegenPerSecond = 999; config.fireChunkBurst.count = 0;
    expect(decoy).toMatchObject({ hp: 0.5, maxHp: 250, armor: 7.25, speed: input.speed });
    expect(decoy.config.stealthHpRegenPerSecond).toBe(resolvedDecoy().stealthHpRegenPerSecond);
    expect(decoy.config.fireChunkBurst.count).toBe(resolvedDecoy().fireChunkBurst.count);
    expect(runtime.activate(input)).toBeNull();
    expect(runtime.activate({ ...input, ownerId: 'other' })).not.toBeNull();
  });

  it('separates decoy damage and death from stealth and renews remaining stealth on recast', () => {
    const runtime = new DecoyRuntime(), input = decoyInput({ config: resolvedDecoy() });
    const first = runtime.activate(input)!;
    expect(runtime.damage(first.id, 1000)).toEqual({ hpLost: input.hp, armorLost: input.armor });
    runtime.end(first.id, 'killed');
    expect(runtime.getStealth(input.ownerId)?.expiresAt).toBe(input.now + input.config.stealthDurationMs);
    const next = runtime.activate({ ...input, now: input.now + 1000 })!;
    expect(next.id).not.toBe(first.id);
    expect(runtime.getStealth(input.ownerId)?.expiresAt).toBe(next.expiresAt);
    runtime.breakStealth(input.ownerId);
    expect(runtime.get(next.id)).toBeDefined();
    expect(runtime.getStealth(input.ownerId)).toBeUndefined();
  });

  it('expires independent lifetimes and processes each end only once, including reentrant damage', () => {
    const runtime = new DecoyRuntime();
    const input = decoyInput({ config: { ...resolvedDecoy(), decoyLifetimeMs: 100, stealthDurationMs: 400 } });
    const decoy = runtime.activate(input)!;
    expect(runtime.expired(input.now + 99)).toEqual([]);
    expect(runtime.expired(input.now + 5000)).toEqual([decoy.id]);
    expect(runtime.end(decoy.id, 'expired')?.reason).toBe('expired');
    expect(runtime.damage(decoy.id, 1)).toBeNull();
    expect(runtime.end(decoy.id, 'killed')).toBeNull();
    runtime.expireStealth(input.now + 399);
    expect(runtime.getStealth(input.ownerId)).toBeDefined();
    runtime.expireStealth(input.now + 400);
    expect(runtime.getStealth(input.ownerId)).toBeUndefined();
  });
});
