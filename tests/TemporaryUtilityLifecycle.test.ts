import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { createCoopDefensePlaceablePedestalUtility } from '../src/loadout/CoopDefenseMissionUtility';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { TemporaryUtilityCollection } from '../src/loadout/TemporaryUtilityCollection';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';

describe('temporary utility collection lifecycle', () => {
  it('keeps duplicate utility types as independent, pickup-ordered instances', () => {
    const collection = new TemporaryUtilityCollection();
    const first = collection.add('player-a', UTILITY_CONFIGS.BFG, 2, { kind: 'utility' });
    const second = collection.add('player-a', UTILITY_CONFIGS.BFG, 1, { kind: 'utility' });

    expect(first?.instanceId).not.toBe(second?.instanceId);
    expect(collection.getDescriptors('player-a')).toEqual([
      expect.objectContaining({ instanceId: first?.instanceId, utilityId: 'BFG', charges: 2, acquisitionOrder: 0 }),
      expect.objectContaining({ instanceId: second?.instanceId, utilityId: 'BFG', charges: 1, acquisitionOrder: 1 }),
    ]);
  });

  it('tracks charges and cooldown on the used instance only', () => {
    const collection = new TemporaryUtilityCollection();
    const first = collection.add('player-a', UTILITY_CONFIGS.BFG, 2, { kind: 'utility' });
    const second = collection.add('player-a', UTILITY_CONFIGS.BFG, 1, { kind: 'utility' });
    if (!first || !second) throw new Error('fixture failed');

    expect(collection.recordSuccessfulUse('player-a', first.instanceId, 1_000)).toBe(true);
    expect(collection.getDescriptors('player-a')).toEqual([
      expect.objectContaining({
        instanceId: first.instanceId,
        charges: 1,
        cooldownUntil: 1_000 + UTILITY_CONFIGS.BFG.cooldown,
      }),
      expect.objectContaining({ instanceId: second.instanceId, charges: 1, cooldownUntil: 0 }),
    ]);

    expect(collection.recordSuccessfulUse('player-a', second.instanceId, 2_000)).toBe(true);
    expect(collection.get('player-a', second.instanceId)).toBeNull();
    expect(collection.get('player-a', first.instanceId)).not.toBeNull();
  });

  it('removes only the temporary instance belonging to an unavailable objective', () => {
    const collection = new TemporaryUtilityCollection();
    const first = createCoopDefensePlaceablePedestalUtility('hold-a', 'HOLY_HAND_GRENADE');
    const second = createCoopDefensePlaceablePedestalUtility('hold-b', 'BFG');
    collection.add('player-a', first, 1, {
      kind: 'objective-placement', objectiveId: 'hold-a', powerUpDefId: 'HOLY_HAND_GRENADE',
    });
    collection.add('player-a', second, 1, {
      kind: 'objective-placement', objectiveId: 'hold-b', powerUpDefId: 'BFG',
    });

    expect(collection.removeForObjective('player-a', 'hold-a')).toBe(true);
    expect(collection.getDescriptors('player-a')).toEqual([
      expect.objectContaining({ kind: 'objective-placement', objectiveId: 'hold-b' }),
    ]);
  });

  it('publishes the complete authoritative collection after add and clear', () => {
    const publishTemporaryUtilityInstances = vi.fn();
    const manager = new PlayerUtilityActionRuntime({
      playerManager: {} as never,
      projectileSpawn: {} as never,
      combatSystem: {} as never,
      actor: {} as never,
      loadout: {
        getEquippedUtilityConfig: vi.fn(() => UTILITY_CONFIGS.HE_GRENADE),
        resolveUtilityConfig: (_playerId, config) => config,
        noteUtilityUsed: vi.fn(),
      },
      heldAction: {} as never,
      translocator: null,
      decoy: null,
      stinkCloud: null,
      gameAudioSystem: {} as never,
      network: {
        loadout: {
          publishUtilityCooldownUntil: vi.fn(),
          publishTemporaryUtilityInstances,
          publishHeldUtilityId: vi.fn(),
        },
        roundStats: {
          recordUtilityUsed: vi.fn(),
          recordConstructionBuilt: vi.fn(),
        },
      },
      dropBeer: vi.fn(),
      nukeStrike: vi.fn(() => false),
      placeable: null,
    });

    const firstId = manager.addTemporaryUtility('player-a', UTILITY_CONFIGS.BFG, 1);
    const secondId = manager.addTemporaryUtility('player-a', UTILITY_CONFIGS.BFG, 1);

    expect(firstId).not.toBeNull();
    expect(secondId).not.toBe(firstId);
    expect(publishTemporaryUtilityInstances).toHaveBeenLastCalledWith('player-a', [
      expect.objectContaining({ instanceId: firstId, utilityId: 'BFG', acquisitionOrder: 0 }),
      expect.objectContaining({ instanceId: secondId, utilityId: 'BFG', acquisitionOrder: 1 }),
    ]);

    manager.clearTemporaryUtilities('player-a');
    expect(publishTemporaryUtilityInstances).toHaveBeenLastCalledWith('player-a', []);
  });

  it('starts a newly equipped utility ready instead of transferring the previous cooldown', () => {
    let config = UTILITY_CONFIGS.HE_GRENADE;
    const publishCooldown = vi.fn();
    const manager = new PlayerUtilityActionRuntime({
      playerManager: {} as never,
      projectileSpawn: {} as never,
      combatSystem: {} as never,
      actor: {} as never,
      loadout: {
        getEquippedUtilityConfig: vi.fn(() => config),
        resolveUtilityConfig: (_playerId, value) => value,
        noteUtilityUsed: vi.fn(),
      },
      heldAction: {} as never,
      translocator: null,
      decoy: null,
      stinkCloud: null,
      gameAudioSystem: {} as never,
      network: {
        loadout: {
          publishUtilityCooldownUntil: publishCooldown,
          publishTemporaryUtilityInstances: vi.fn(),
          publishHeldUtilityId: vi.fn(),
        },
        roundStats: { recordUtilityUsed: vi.fn(), recordConstructionBuilt: vi.fn() },
      },
      dropBeer: vi.fn(),
      nukeStrike: vi.fn(() => false),
      placeable: null,
    });

    manager.syncEquippedUtility('player-a');
    manager.beginUtilityCooldown('player-a', UTILITY_CONFIGS.HE_GRENADE.id, 1_000);
    config = UTILITY_CONFIGS.BFG;
    manager.syncEquippedUtility('player-a');

    const equipped = (manager as unknown as { equippedUtilities: Map<string, { getLastUsedAt(): number }> })
      .equippedUtilities.get('player-a');
    expect(equipped?.getLastUsedAt()).toBe(-Infinity);
    expect(publishCooldown).toHaveBeenLastCalledWith('player-a', 0, '__clear__');
  });

  it('does not republish temporary utility state for a no-op equipment sync', () => {
    const publishTemporaryUtilityInstances = vi.fn();
    const config = UTILITY_CONFIGS.HE_GRENADE;
    const manager = new PlayerUtilityActionRuntime({
      playerManager: {} as never,
      projectileSpawn: {} as never,
      combatSystem: {} as never,
      actor: {} as never,
      loadout: {
        getEquippedUtilityConfig: vi.fn(() => config),
        resolveUtilityConfig: (_playerId, value) => value,
        noteUtilityUsed: vi.fn(),
      },
      heldAction: {} as never,
      translocator: null,
      decoy: null,
      stinkCloud: null,
      gameAudioSystem: {} as never,
      network: {
        loadout: {
          publishUtilityCooldownUntil: vi.fn(),
          publishTemporaryUtilityInstances,
          publishHeldUtilityId: vi.fn(),
        },
        roundStats: { recordUtilityUsed: vi.fn(), recordConstructionBuilt: vi.fn() },
      },
      dropBeer: vi.fn(),
      nukeStrike: vi.fn(() => false),
      placeable: null,
    });

    manager.syncEquippedUtility('player-a');
    publishTemporaryUtilityInstances.mockClear();
    manager.syncEquippedUtility('player-a');
    expect(publishTemporaryUtilityInstances).not.toHaveBeenCalled();
  });
});
