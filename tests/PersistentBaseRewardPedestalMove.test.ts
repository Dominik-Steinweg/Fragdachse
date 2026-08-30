import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { ArenaLayout } from '../src/types';

const EMPTY_LAYOUT: ArenaLayout = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
};

function makePowerUpSystem(): PowerUpSystem {
  const combat = {
    healToFull: vi.fn(),
    addArmor: vi.fn(),
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    applyDamage: vi.fn(),
    applyExplosionDamage: vi.fn(),
  };
  return new PowerUpSystem(null as never, combat as never, EMPTY_LAYOUT, {});
}

function registerRewardPedestal(system: PowerUpSystem): void {
  expect(system.registerPersistentBaseRewardPedestal(
    'base_health_pedestal',
    'HEALTH_PACK',
    100,
    100,
    5_000,
    true,
  )).toBe(true);
}

function rewardPedestal(system: PowerUpSystem) {
  const pedestal = system.getPedestalSnapshot()
    .find((entry) => entry.persistentRewardId === 'base_health_pedestal');
  if (!pedestal) throw new Error('reward pedestal is not registered');
  return pedestal;
}

describe('Persistent-Base-Reward-Podest verschieben', () => {
  it('nimmt ein noch vorhandenes Power-up mit derselben UID mit', () => {
    const system = makePowerUpSystem();
    registerRewardPedestal(system);
    const before = rewardPedestal(system);
    const item = system.getWorldItemSnapshot()[0];
    expect(before).toMatchObject({ x: 100, y: 100, hasPowerUp: true });
    expect(item).toMatchObject({ x: 100, y: 100, defId: 'HEALTH_PACK' });

    expect(system.repositionPersistentBaseRewardPedestal('base_health_pedestal', 320, 480)).toBe(true);

    const after = rewardPedestal(system);
    expect(after.id).toBe(before.id);
    expect(after).toMatchObject({ x: 320, y: 480, hasPowerUp: true, nextRespawnAt: 0 });
    // Kein neues Item: dieselbe UID liegt jetzt auf der neuen Podestposition.
    expect(system.getWorldItemSnapshot()).toEqual([{ ...item, x: 320, y: 480 }]);
  });

  it('erzeugt kein Item neu, wenn es waehrend der Vorschau eingesammelt wurde', () => {
    const system = makePowerUpSystem();
    registerRewardPedestal(system);
    const pedestalId = rewardPedestal(system).id;
    const item = system.getWorldItemSnapshot()[0];

    expect(system.tryPickup('p1', item.uid, 100, 100)).toBe(true);
    const respawnAfterPickup = rewardPedestal(system).nextRespawnAt;
    expect(respawnAfterPickup).toBeGreaterThan(0);

    expect(system.repositionPersistentBaseRewardPedestal('base_health_pedestal', 320, 480)).toBe(true);

    const after = rewardPedestal(system);
    expect(after.id).toBe(pedestalId);
    expect(after).toMatchObject({ x: 320, y: 480, hasPowerUp: false });
    // Der bestehende Respawn-Timer laeuft unveraendert weiter.
    expect(after.nextRespawnAt).toBe(respawnAfterPickup);
    expect(system.getWorldItemSnapshot()).toEqual([]);
  });

  it('meldet die neue Position im Delta-Snapshot statt erst beim naechsten Vollsnapshot', () => {
    const system = makePowerUpSystem();
    registerRewardPedestal(system);
    system.getPedestalNetSnapshot();
    system.getNetSnapshot();
    expect(system.getPedestalNetSnapshot()?.upserts ?? []).toEqual([]);

    expect(system.repositionPersistentBaseRewardPedestal('base_health_pedestal', 320, 480)).toBe(true);

    expect(system.getPedestalNetSnapshot()?.upserts).toEqual([
      expect.objectContaining({ x: 320, y: 480, persistentRewardId: 'base_health_pedestal' }),
    ]);
    expect(system.getNetSnapshot()?.upserts).toEqual([
      expect.objectContaining({ x: 320, y: 480, defId: 'HEALTH_PACK' }),
    ]);
  });

  it('kennt kein nicht registriertes Podest', () => {
    const system = makePowerUpSystem();
    expect(system.repositionPersistentBaseRewardPedestal('base_health_pedestal', 10, 10)).toBe(false);
    registerRewardPedestal(system);
    expect(system.repositionPersistentBaseRewardPedestal('base_health_pedestal', Number.NaN, 10)).toBe(false);
    expect(rewardPedestal(system)).toMatchObject({ x: 100, y: 100 });
  });
});
