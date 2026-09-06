import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

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
  it.each(['persistent', 'construction'] as const)(
    'keeps the %s World pedestal lifecycle independent of Activity and round clocks',
    (kind) => {
      let now = 10_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const system = makePowerUpSystem();
      if (kind === 'persistent') registerRewardPedestal(system);
      else expect(system.registerConstructionPedestal(42, 'HEALTH_PACK', 100, 100)).toBe(true);

      // Activity binding may be waiting for an authoritative start while the World runs.
      const binding = system.createActivityPedestalBinding([{
        id: 'pending', baseId: 'base', gridX: 10, gridY: 10,
        defId: 'HEALTH_PACK', respawnMs: 1_000, spawnOnArenaStart: false,
      }]);
      binding.attach();
      const pedestalId = system.getPedestalSnapshot()[0].id;
      for (let cycle = 0; cycle < 2; cycle++) {
        const item = system.getWorldItemSnapshot()[0];
        expect(system.tryPickup('p1', item.uid, 100, 100)).toBe(true);
        const waiting = system.getPedestalSnapshot().find((p) => p.id === pedestalId)!;
        expect(waiting.nextRespawnAt).toBeGreaterThan(now);
        if (cycle === 1) {
          binding.detach();
          system.setArenaStartTime(now + 1_000_000);
          system.setArenaStartTime(0);
          expect(system.getPedestalSnapshot()).toEqual([waiting]);
        }
        now = waiting.nextRespawnAt - 1;
        system.update(0);
        expect(system.getWorldItemSnapshot()).toEqual([]);
        now++;
        system.update(0);
        const respawned = system.getWorldItemSnapshot();
        expect(respawned).toEqual([expect.objectContaining({ defId: 'HEALTH_PACK', x: 100, y: 100 })]);
        expect(respawned[0].uid).not.toBe(item.uid);
        expect(system.getPedestalSnapshot().find((p) => p.id === pedestalId))
          .toMatchObject({ hasPowerUp: true, nextRespawnAt: 0 });
        system.update(0);
        expect(system.getWorldItemSnapshot()).toEqual(respawned);
      }

      const present = system.getWorldItemSnapshot();
      system.setArenaStartTime(now + 100);
      expect(system.getWorldItemSnapshot()).toEqual(present);
      system.reset();
      now += 1_000_000;
      system.update(0);
      expect(system.getWorldItemSnapshot()).toEqual([]);
      expect(system.getPedestalSnapshot()).toEqual([]);
    },
  );

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
