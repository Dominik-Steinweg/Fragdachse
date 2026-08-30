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
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { TemporaryUtilityCollection } from '../src/loadout/TemporaryUtilityCollection';

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
    const manager = Object.create(LoadoutManager.prototype) as any;
    manager.bridge = { publishTemporaryUtilityInstances };
    manager.loadouts = new Map([['player-a', {}]]);
    manager.temporaryUtilities = new TemporaryUtilityCollection();
    manager.utilityConfigModifierSource = null;

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
});
