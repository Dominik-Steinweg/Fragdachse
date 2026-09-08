import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) } }));
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import { UTILITY_CONFIGS, type UtilityConfig } from '../src/loadout/LoadoutConfig';
import type { UtilityChargeState } from '../src/loadout/UtilityChargeState';
import { resolvedHe, fullHeProfile } from './HeGrenadeTestHelper';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';

function fixture(realLoadout = false) {
  let config: UtilityConfig = resolvedHe();
  let equipped: UtilityConfig = config;
  let alive = true;
  let spawnAccepted = true;
  let state: UtilityChargeState | null = null;
  const held = new HostHeldActionSystem();
  const spawn = vi.fn(() => spawnAccepted ? 1 : null);
  const publish = vi.fn((_p, _id, value) => { state = value; });
  const manager = new LoadoutManager({} as never, { getGameMode: () => 'coop_defense' });
  if (realLoadout) {
    manager.assignDefaultLoadout('p1', { utility: equipped });
    manager.setUtilityConfigModifierSource(() => getCoopDefenseResolvedEffectTotals(fullHeProfile, 'dachs_nukem'));
  }
  const runtime = new PlayerUtilityActionRuntime({
    projectileSpawn: { spawnProjectile: spawn },
    combatSystem: {} as never,
    actor: { getPlayer: () => ({ x: 0, y: 0, color: 0xffffff }), canInteract: () => true,
      isAlive: () => alive, isUtilityBlocked: () => false },
    loadout: realLoadout ? manager : { getEquippedUtilityConfig: () => equipped,
      resolveUtilityConfig: (_p, value) => value.id === 'HE_GRENADE' ? config : value, noteUtilityUsed: vi.fn() },
    heldAction: held, translocator: null, decoy: null, stinkCloud: null,
    gameAudioSystem: { playShot: vi.fn(), playShotSuccess: vi.fn() } as never,
    network: { loadout: { publishUtilityChargeState: publish, publishUtilityCooldownUntil: vi.fn(),
      publishTemporaryUtilityInstances: vi.fn(), publishHeldUtilityId: vi.fn() },
      roundStats: { recordUtilityUsed: vi.fn(), recordConstructionBuilt: vi.fn() } },
    dropBeer: vi.fn(), nukeStrike: () => false, placeable: null,
    resolveToolUtilityConfig: () => config, isToolAuthorized: () => true,
  });
  runtime.syncEquippedUtility('p1');
  const start = (id: string, now: number, tool = false, temporary?: string) => runtime.startHeldAction(
    'p1', id, 'charged_throw', now, tool ? { kind: 'utility', id: 'HE_GRENADE' } : undefined, temporary);
  const commit = (id: string, now: number, tool = false, temporary?: string) => {
    const params = { heldActionId: id, attemptId: 'attempt-' + id, temporaryUtilityInstanceId: temporary };
    return tool ? runtime.useInspectorUtility('p1', { kind: 'utility', id: 'HE_GRENADE' }, config, 0, 100, 0, now, params)
      : runtime.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 100, targetY: 0,
        hostNowMs: now, attemptId: params.attemptId, params });
  };
  return { runtime, manager, start, commit, held, spawn, publish, state: () => state!,
    setAlive: (value: boolean) => { alive = value; },
    setSpawnAccepted: (value: boolean) => { spawnAccepted = value; },
    setConfig: (value: UtilityConfig) => { config = value; if (equipped.id === value.id) equipped = value; },
    equip: (value: UtilityConfig) => { equipped = value; runtime.syncEquippedUtility('p1'); } };
}

describe('host HE charge owner', () => {
  it('retains resolved upgrades through the real loadout reconciliation and recharge loop', () => {
    const f = fixture(true);
    const effective = resolvedHe();
    expect(f.state()).toMatchObject({ availableCharges: effective.charges!.maxCharges,
      maxCharges: effective.charges!.maxCharges });
    f.start('upgraded', 0);
    expect(f.commit('upgraded', 0).ok).toBe(true);
    expect(f.spawn).toHaveBeenLastCalledWith(expect.objectContaining({
      interaction: { grenadeEffect: expect.objectContaining({
        impactFuse: true, clusterCount: effective.clusterCount, demolitionLevel: effective.demolitionLevel,
        damage: effective.aoeDamage, radius: effective.aoeRadius,
      }) },
    }));
    // ArenaLifecycleCoordinator reconciles the same effective selection while the World ticks.
    // Neither path may restore the baseline capacity or postpone a running recharge.
    for (let now = 0; now <= effective.cooldown * 2; now += effective.cooldown / 4) {
      expect(f.manager.syncSelectedLoadout('p1', { utility: { ...effective } })).toBe(false);
      f.runtime.syncEquippedUtility('p1');
      f.runtime.update(now);
      expect(f.state().maxCharges).toBe(effective.charges!.maxCharges);
    }
    expect(f.state().availableCharges).toBe(effective.charges!.maxCharges);
    expect(f.state().nextChargeAt).toBeNull();
  });

  it('allows bursts after the separate lockout, preserves recharge progress and deduplicates commits', () => {
    const f = fixture();
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges);
    expect(f.start('one', 0)).toBe(true);
    const first = f.commit('one', 0);
    expect(first.ok).toBe(true);
    expect(f.commit('one', 200)).toEqual(first);
    expect(f.spawn).toHaveBeenCalledTimes(1);
    const next = f.state().nextChargeAt;
    expect(f.start('blocked', 99)).toBe(false);
    expect(f.start('two', 100)).toBe(true);
    expect(f.commit('two', 100).ok).toBe(true);
    expect(f.state().nextChargeAt).toBe(next);
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges - 2);
    f.runtime.update(next!);
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges - 1);
  });

  it('does not spend on cancelled charging, an unstarted commit, death, or failed spawning', () => {
    const f = fixture();
    const count = f.state().availableCharges;
    f.start('cancelled', 0); f.held.cancel('p1', 'cancelled');
    expect(f.commit('cancelled', 200).ok).toBe(false);
    expect(f.commit('missing', 300).ok).toBe(false);
    f.start('dead', 400); f.setAlive(false);
    expect(f.commit('dead', 500).ok).toBe(false);
    f.setAlive(true); f.setSpawnAccepted(false); f.start('failed', 600);
    expect(f.commit('failed', 650).ok).toBe(false);
    expect(f.state().availableCharges).toBe(count);
    expect(f.state().nextChargeAt).toBeNull();
  });

  it('shares the stock with Inspector tools, retains it through equipment/config changes and death', () => {
    const f = fixture();
    f.start('one', 0); f.commit('one', 0);
    f.equip(UTILITY_CONFIGS.BFG);
    expect(f.start('tool', 100, true)).toBe(true);
    expect(f.commit('tool', 100, true).ok).toBe(true);
    expect(f.commit('tool', 100, true).ok).toBe(true);
    f.equip({ ...resolvedHe() });
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges - 2);
    f.setAlive(false); f.runtime.update(200); f.setAlive(true);
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges - 2);
    expect(f.spawn).toHaveBeenCalledTimes(2);
    f.runtime.removePlayer('p1');
    expect(f.state()).toBeNull();
    f.runtime.syncEquippedUtility('p1');
    expect(f.state().availableCharges).toBe(resolvedHe().charges!.maxCharges);
    f.runtime.destroy();
    expect(f.state()).toBeNull();
  });

  it('adds empty capacity, clamps reductions and retains relative cooldown progress', () => {
    const f = fixture();
    const original = resolvedHe();
    f.start('one', 0); f.commit('one', 0);
    f.runtime.update(original.cooldown / 2);
    f.setConfig({ ...original, cooldown: original.cooldown * 2,
      charges: { ...original.charges!, maxCharges: original.charges!.maxCharges + 1 } });
    f.runtime.update(original.cooldown / 2);
    expect(f.state().availableCharges).toBe(original.charges!.maxCharges - 1);
    expect(f.state().maxCharges).toBe(original.charges!.maxCharges + 1);
    expect(f.state().nextChargeAt).toBeCloseTo(original.cooldown * 1.5);
    f.setConfig({ ...original, charges: { ...original.charges!, maxCharges: 1 } });
    f.runtime.update(original.cooldown / 2);
    expect(f.state()).toMatchObject({ availableCharges: 1, maxCharges: 1, nextChargeAt: null });
  });

  it('keeps temporary HE pickups finite and independent from the rechargeable stock', () => {
    const f = fixture();
    const id = f.runtime.addTemporaryUtility('p1', resolvedHe(), 1)!;
    const count = f.state().availableCharges;
    expect(f.start('pickup', 0, false, id)).toBe(true);
    expect(f.commit('pickup', 0, false, id).ok).toBe(true);
    expect(f.state().availableCharges).toBe(count);
    expect(f.runtime.getTemporaryUtilityConfig('p1', id)).toBeNull();
  });
});
