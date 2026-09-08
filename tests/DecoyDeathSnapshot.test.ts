import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  GameObjects: { Events: { DESTROY: 'destroy' } },
  Scenes: { Events: { DESTROY: 'destroy', POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
  Textures: { FilterMode: { LINEAR: 0 } },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Angle: { Wrap: (angle: number) => angle },
  },
}));

import { decoyInput } from './DecoyTestHelper';
import { DecoySystem } from '../src/systems/DecoySystem';
import type { SyncedDeathEffect } from '../src/types';
import type { CombatSource } from '../src/combat/CombatScope';

describe('Decoy death visual snapshots', () => {
  it('keeps a complete visual snapshot when the decoy is on frame 0', () => {
    const system = new DecoySystem({} as never, {} as never, {} as never);
    const decoy = {
      id: 7,
      color: 0x55cc88,
      position: { x: 480, y: 288 }, rotation: 0.5,
      entity: fakeEntity({ x: 480,
          y: 288,
          rotation: 0.5,
          texture: { key: 'badger_walking' },
          frame: { name: 0 },
          displayWidth: 32,
          displayHeight: 32,
          tint: 0xffffff }),
    };
    const internals = system as unknown as {
      buildDeathEffect: (value: typeof decoy) => SyncedDeathEffect;
    };

    (system as unknown as { entities: Map<number, unknown> }).entities.set(decoy.id, decoy.entity);
    const effect = internals.buildDeathEffect(decoy);

    expect(effect).toMatchObject({
      targetId: 'decoy_7',
      textureKey: 'badger_walking',
      frame: 0,
      displayWidth: 32,
      displayHeight: 32,
      tint: 0xffffff,
    });
  });

  it('returns an immutable overkill receipt and removes the target before its death callback', () => {
    const bridge = { broadcastEffect: vi.fn() };
    const system = new DecoySystem(
      {} as never,
      { getPlayer: () => undefined } as never,
      bridge as never,
    );
    const entity = fakeEntity({
      x: 48,
      y: 28,
      rotation: 0.25,
      texture: { key: 'badger_walking' },
      frame: { name: 0 },
      displayWidth: 32,
      displayHeight: 32,
      tint: 0xffffff,
      updateVitals: vi.fn(),
      destroy: vi.fn(),
    });
    const hostDecoy = system.runtime.activate(decoyInput({
      ownerId: 'owner', position: { x: 48, y: 28 }, hp: 10, armor: 5, maxHp: 10,
    }))!;
    (system as unknown as { entities: Map<number, unknown> }).entities.set(hostDecoy.id, entity);
    const target = system.getCombatTargetRef(hostDecoy.id)!;
    const source: CombatSource = {
      gameplaySource: { kind: 'player', id: 'attacker' },
      attribution: { kind: 'player', id: 'attacker' },
      allegiance: { ownerId: 'attacker' },
      origin: 'direct',
    };
    const callback = vi.fn(() => {
      expect(system.getCombatTargetRef(hostDecoy.id)).toBeNull();
    });
    system.setEndEffectHandler(callback);

    const outcome = system.commitDamage({
      outcomeId: 'decoy-lethal',
      target,
      source,
      damage: {
        amount: 100,
        damageKind: 'direct',
        basis: { kind: 'authored', amount: 100 },
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    }, { dirX: 1, dirY: 0 });

    expect(outcome).toMatchObject({
      kind: 'damage-applied',
      actualDamage: 15,
      armorLost: 5,
      hpLost: 10,
      resultingState: { hp: 0, armor: 0, alive: false },
      transition: { kind: 'dead', facts: { position: { x: 48, y: 28 } } },
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(system.commitDamage({
      outcomeId: 'stale-decoy',
      target,
      source,
      damage: {
        amount: 1,
        damageKind: 'direct',
        basis: { kind: 'authored', amount: 1 },
        sourceFactors: [],
        targetFactors: [],
        isCritical: false,
      },
    })).toMatchObject({ kind: 'rejected', reason: 'target-missing' });
  });
});
