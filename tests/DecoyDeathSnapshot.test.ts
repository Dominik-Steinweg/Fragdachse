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

import { DecoySystem } from '../src/systems/DecoySystem';
import type { SyncedDeathEffect } from '../src/types';

describe('Decoy death visual snapshots', () => {
  it('keeps a complete visual snapshot when the decoy is on frame 0', () => {
    const system = new DecoySystem({} as never, {} as never, {} as never);
    const decoy = {
      id: 7,
      color: 0x55cc88,
      entity: {
        sprite: {
          x: 480,
          y: 288,
          rotation: 0.5,
          texture: { key: 'badger_walking' },
          frame: { name: 0 },
          displayWidth: 32,
          displayHeight: 32,
          tint: 0xffffff,
        },
      },
    };
    const internals = system as unknown as {
      buildDeathEffect: (value: typeof decoy) => SyncedDeathEffect;
    };

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
});
