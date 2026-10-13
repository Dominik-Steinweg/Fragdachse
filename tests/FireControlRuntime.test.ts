import { describe, expect, it, vi } from 'vitest';
import { FireControlRuntime } from '../src/systems/fireControl/FireControlRuntime';
import type { FireControlConstructionFacts } from '../src/systems/fireControl/FireControlCopyPlan';
import type { ResolvedFireControlRelayConfig } from '../src/world/FireControlUtilityPort';
import { parseFireControlUtilityState } from '../src/loadout/FireControlUtilityState';

const config: ResolvedFireControlRelayConfig = { durationMs: 1000, cooldownMs: 500, maxCopies: 3, parallel: false,
  buildRangePx: 200, ringRadiusPx: 36, clearanceRadiusPx: 16, singleCopyOffsetPx: 30, materializeMs: 100 };
const fact = (id = 7): FireControlConstructionFacts => ({ id, ownerId: 'owner', baseOwned: false,
  constructionId: 'machine_gun_turret', weaponFireType: 'projectile', weaponId: 'TURRET_MG',
  combatReady: true, manned: false, x: 0, y: 0, angle: .7 });
function fixture() {
  let facts = [fact()];
  const ended = vi.fn();
  const runtime = new FireControlRuntime({ readConstructions: () => facts, readSlotOrder: () => [],
    isPointFree: () => true, onDeploymentEnded: ended });
  const activate = (overrides: Partial<ResolvedFireControlRelayConfig> = {}, pointX = 100) => runtime.activateCopies({
    ownerId: 'owner', ownerColor: 123, playerX: 0, playerY: 0, pointX, pointY: 0, nowMs: 100,
    config: { ...config, ...overrides } });
  return { runtime, ended, activate, set: (next: FireControlConstructionFacts[]) => { facts = next; },
    sources: (now = 200) => runtime.deriveFireSources(facts.map(f => ({ ...f, ownerColor: 123, targetRange: 333,
      sourceCarrierBaseId: 'carrier', footprint: { left: 0, top: 0, right: 10, bottom: 10 }, skipRockIndex: f.id })), now) };
}

describe('host copy deployment facts', () => {
  it('copies the activation config instead of retaining the caller object', () => {
    const f = fixture(), supplied = { ...config };
    expect(f.runtime.activateCopies({ ownerId: 'owner', ownerColor: 123, playerX: 0, playerY: 0,
      pointX: 100, pointY: 0, nowMs: 100, config: supplied }).ok).toBe(true);
    supplied.parallel = true; supplied.durationMs = 1; supplied.materializeMs = 0;
    expect(f.sources(199).map(s => s.fireState)).toEqual(['paused', 'paused']);
    expect(f.sources(200)[1].sequenceKey).toBe(7);
    f.runtime.update(200);
    expect(f.runtime.getSnapshot(200).deployments[0]).toMatchObject({ parallel: false, expiresAt: 1100 });
    f.runtime.update(1100); expect(f.ended).toHaveBeenCalledExactlyOnceWith(1, 'owner', 1100);
  });

  it('commits atomically, blocks a second use and ends once at the exact deadline on a late tick', () => {
    const f = fixture();
    expect(f.activate({}, 201)).toEqual({ ok: false, reason: 'placement' });
    expect(f.runtime.getSnapshot(0).deployments).toEqual([]);
    expect(f.activate()).toEqual({ ok: true, deploymentId: 1, expiresAt: 1100 });
    expect(f.activate()).toEqual({ ok: false, reason: 'blocked' });
    f.runtime.update(2000); f.runtime.update(3000);
    expect(f.ended.mock.calls).toEqual([[1, 'owner', 1100]]);
    expect(f.runtime.getPausedOriginalIds().size).toBe(0);
  });

  it.each([false, true])('derives live turret stats, independent aim and materialization (parallel=%s)', parallel => {
    const f = fixture(); f.activate({ parallel });
    const [original, copy] = f.sources(199);
    expect(original.fireState).toBe(parallel ? 'active' : 'paused');
    expect(copy).toMatchObject({ id: 'fc-copy:1:0', identityId: 7, visualId: 'fc-copy:1:0', angle: .7,
      sequenceKey: parallel ? 'fc-copy:1:0' : 7, fireState: 'paused', x: 130, targetRange: 333 });
    expect(copy.sequenceSeedKey).toBe(parallel ? 7 : undefined);
    expect(copy.footprint).toBeUndefined(); expect(copy.sourceCarrierBaseId).toBeUndefined(); expect(copy.skipRockIndex).toBeUndefined();
    f.runtime.setCopyAngle('fc-copy:1:0', 1.2);
    f.set([{ ...fact(), weaponId: 'SPORES', angle: 2 }]);
    expect(f.sources()[1]).toMatchObject({ angle: 1.2, weaponId: 'SPORES', fireState: 'active' });
    expect(f.sources()[0].angle).toBe(2);
    expect(f.runtime.getSnapshot(200).deployments[0]).toMatchObject({ id: 1, ownerId: 'owner', ownerColor: 123,
      x: 100, y: 0, startedAt: 100, expiresAt: 1100, parallel,
      copies: [{ sourceId: 'fc-copy:1:0', constructionId: 'machine_gun_turret', weaponId: 'SPORES',
        materializedAt: 200, originalPaused: !parallel, status: 'active', angle: 1.2 }] });
  });

  it.each(['removed', 'unready', 'owner', 'base'] as const)('ends when the last source becomes %s', cause => {
    for (const parallel of [false, true]) {
      const f = fixture(); f.activate({ parallel });
      f.set(cause === 'removed' ? [] : [{ ...fact(), combatReady: cause !== 'unready',
        ownerId: cause === 'owner' ? 'other' : 'owner', baseOwned: cause === 'base' }]);
      f.runtime.update(300); f.runtime.update(301);
      expect(f.runtime.getSnapshot(301).deployments).toEqual([]);
      expect(f.ended.mock.calls).toEqual([[1, 'owner', 300]]);
    }
  });

  it.each([false, true])('handles unmanned -> manned -> unmanned without recreating copies (parallel=%s)', parallel => {
    const f = fixture(); f.activate({ parallel });
    f.set([{ ...fact(), manned: true }]); f.runtime.update(300);
    expect(f.runtime.getSnapshot(300).deployments).toHaveLength(parallel ? 1 : 0);
    expect(f.runtime.getPausedOriginalIds().size).toBe(0);
    expect(f.ended.mock.calls).toEqual(parallel ? [] : [[1, 'owner', 300]]);
    f.set([fact()]); f.runtime.update(301);
    expect(f.sources().map(s => s.id)).toEqual(parallel ? [7, 'fc-copy:1:0'] : [7]);
    if (parallel) {
      f.runtime.update(100 + config.durationMs);
      expect(f.ended).toHaveBeenCalledExactlyOnceWith(1, 'owner', 100 + config.durationMs);
    }
  });

  it('keeps slots stable and never restores a removed copy after dismounting', () => {
    const f = fixture(); f.set([fact(7), fact(8)]); f.activate();
    f.set([{ ...fact(7), manned: true }, fact(8)]); f.runtime.update(200);
    f.set([fact(7), fact(8)]); f.runtime.update(201);
    expect(f.sources().map(s => s.id)).toEqual([7, 8, 'fc-copy:1:1']);
    expect([...f.runtime.getPausedOriginalIds()]).toEqual([8]); expect(f.ended).not.toHaveBeenCalled();
  });

  it('silently clears owners/deployments, preserves world ID uniqueness and freezes utility config', () => {
    const f = fixture(); f.activate(); f.runtime.removeOwner('someone-else');
    expect(f.runtime.getSnapshot(100).deployments).toHaveLength(1);
    f.runtime.removeOwner('owner'); f.activate(); f.runtime.clear(); f.runtime.clear(); f.runtime.update(5000);
    expect(f.ended).not.toHaveBeenCalled(); expect(f.sources()).toHaveLength(1);
    expect(f.activate()).toMatchObject({ deploymentId: 3 });
  });

  it('parses only valid active/cooldown relay state', () => {
    const state = { phase: 'active', utilityId: 'FIRE_CONTROL_RELAY', cooldownDurationMs: 200, deploymentId: 1 };
    expect(parseFireControlUtilityState(state)).toEqual(state);
    expect(parseFireControlUtilityState({ ...state, deploymentId: NaN })).toBeNull();
    expect(parseFireControlUtilityState({ ...state, utilityId: 'TIME_BUBBLE' })).toBeNull();
    expect(parseFireControlUtilityState({ ...state, phase: 'flying' })).toBeNull();
    expect(parseFireControlUtilityState({ ...state, phase: 'cooldown', cooldownUntil: 500 })).toEqual({
      phase: 'cooldown', utilityId: state.utilityId, cooldownDurationMs: 200, cooldownUntil: 500 });
  });
});
