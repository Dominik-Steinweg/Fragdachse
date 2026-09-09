import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)) } }));
import { PlayerUtilityActionRuntime } from '../../src/world/PlayerUtilityActionRuntime';
import { TranslocatorSystem, type TranslocatorActor } from '../../src/systems/TranslocatorSystem';
import { HostHeldActionSystem } from '../../src/systems/HostHeldActionSystem';
import { UTILITY_CONFIGS, type UtilityConfig } from '../../src/loadout/LoadoutConfig';
import { resolveRadialActions } from '../../src/systems/RadialActionModel';

function fixture(boss: boolean) {
  const base = UTILITY_CONFIGS.TRANSLOCATOR;
  if (base.type !== 'translocator') throw Error('Expected translocator');
  const config = { ...base, portalEnabled: Number(boss), cooldown: 310 };
  let equipped: UtilityConfig = config;
  let actor: TranslocatorActor = { id: 'p', kind: 'player', x: 0, y: 0, radius: 12, revision: 0, alive: true, surface: true };
  let puck: { x: number; y: number } | null = null;
  const cooldown = vi.fn(), inventory = vi.fn(), used = vi.fn();
  const translocator = new TranslocatorSystem({ getPlayer: () => actor } as never, {
    spawnPuck: () => { puck = { x: 200, y: 0 }; return 1; }, getPuckPosition: () => puck,
    consumePuck: () => { const existed = puck !== null; puck = null; return existed; },
  }, { isAlive: () => actor.alive, applyDamage: vi.fn() } as never, {
    getPlayerColor: () => 0xffffff, broadcastTranslocatorFlash() {}, broadcastExplosionEffect() {},
  });
  translocator.bindWorld({ getActors: () => [actor], canOccupy: () => true,
    transferActor: (_a, x, y) => { actor = { ...actor, x, y, revision: actor.revision + 1 }; },
    isFriendly: () => true, canDamage: () => true, collapseEnemy() {},
  });
  const action = new PlayerUtilityActionRuntime({ captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }),
    projectileSpawn: { spawnProjectile: () => 0 }, combatSystem: {} as never,
    actor: { getPlayer: () => ({ ...actor, color: 0xffffff }), canInteract: () => true,
      isAlive: () => actor.alive, isUtilityBlocked: () => false },
    loadout: { getEquippedUtilityConfig: () => equipped, resolveUtilityConfig: (_p, c) => c, noteUtilityUsed() {} },
    heldAction: new HostHeldActionSystem(), translocator, decoy: null, stinkCloud: null,
    gameAudioSystem: {} as never, dropBeer() {}, nukeStrike: () => false, placeable: null,
    network: { loadout: { publishUtilityCooldownUntil: cooldown, publishTemporaryUtilityInstances: inventory,
      publishHeldUtilityId() {} }, roundStats: { recordUtilityUsed: used, recordConstructionBuilt() {} } },
  });
  action.syncEquippedUtility('p');
  cooldown.mockClear();
  let sequence = 0;
  const cast = (now: number, temporary?: string) => {
    const id = `throw-${++sequence}`;
    expect(action.startHeldAction('p', id, 'charged_throw', now, undefined, temporary)).toBe(true);
    return action.execute({ category: 'utility', playerId: 'p', angle: 0, targetX: 200, targetY: 0,
      hostNowMs: now + 20, attemptId: id, params: { heldActionId: id, temporaryUtilityInstanceId: temporary } });
  };
  const followup = (useId: string, now: number, attemptId = `followup-${++sequence}`) => action.execute({
    category: 'utility', playerId: 'p', angle: 0, targetX: 0, targetY: 0, hostNowMs: now, attemptId,
    params: { translocatorUseId: useId },
  });
  return { action, config, translocator, cooldown, inventory, used, cast, followup,
    equip: (value: UtilityConfig) => { equipped = value; action.syncEquippedUtility('p'); } };
}

describe('Translocator action, inventory and domain integration', () => {
  it.each([false, true])('keeps the final temporary charge reachable through its frozen use (%s)', boss => {
    const f = fixture(boss);
    const temporary = f.action.addTemporaryUtility('p', f.config, 1)!;
    expect(f.cast(100, temporary).ok).toBe(true);
    expect(f.cooldown).not.toHaveBeenCalled();
    const state = f.translocator.getUseState('p')!;
    expect(state.temporaryUtilityInstanceId).toBe(temporary);
    f.equip(UTILITY_CONFIGS.HE_GRENADE);
    const actions = resolveRadialActions({ gameMode: 'deathmatch', tools: [], temporaryUtilities: [],
      persistentRewardIds: [], usedCapacity: 0, capacityMax: 0, now: 130,
      canUseUtility: true, canPlace: true, canManage: true, translocatorState: state });
    expect(actions).toEqual([expect.objectContaining({ available: true,
      ref: { kind: 'temporary-utility', instanceId: temporary, utilityId: 'TRANSLOCATOR' } })]);
    expect(f.followup(state.useId, 130, 'teleport').ok).toBe(true);
    expect(f.translocator.getUseState('p')?.phase).toBe(boss ? 'portals' : 'cooldown');
    expect(f.followup(state.useId, 131, 'teleport').ok).toBe(true);
    expect(f.translocator.getUseState('p')?.phase).toBe(boss ? 'portals' : 'cooldown');
    if (boss) expect(f.followup(state.useId, 132, 'close').ok).toBe(true);
    expect(f.translocator.getUseState('p')?.phase).toBe('cooldown');
    expect(f.used).toHaveBeenCalledTimes(1);
    f.action.destroy(); f.translocator.clear();
  });

  it('starts cooldown at completion and rejects stale use identities', () => {
    const f = fixture(false);
    expect(f.cast(100).ok).toBe(true);
    const use = f.translocator.getUseState('p')!.useId;
    expect(f.followup('wrong-use', 130).ok).toBe(false);
    expect(f.translocator.getUseState('p')?.phase).toBe('puck');
    expect(f.followup(use, 150).ok).toBe(true);
    expect(f.translocator.getUseState('p')).toMatchObject({ cooldownUntil: 150 + f.config.cooldown });
    f.translocator.update(150 + f.config.cooldown);
    expect(f.cast(150 + f.config.cooldown).ok).toBe(true);
    expect(f.cooldown).not.toHaveBeenCalled();
    f.action.destroy(); f.translocator.clear();
  });
});
